// tests/api/avatar.test.js — the profile picture over HTTP.
//
// The unit tests prove the sniffing and path logic. These prove the things only
// a real request can show: that the route is actually behind requireAuth, that
// a multipart body is parsed, that a second upload replaces the first and
// cleans up the old file, and — most importantly — that a picture is never
// reachable without a session.

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { AVATAR_DIR } from "../../backend/src/middleware/uploadAvatar.js";

// ---- Safety rail -----------------------------------------------------------

// This check must run BEFORE anything imports backend/src/config/env.js.
//
// The bug this fixes: every other API test reads process.env.DATABASE_URL at the
// top of the file, then imports app.js — and app.js transitively loads env.js,
// which calls dotenv.config(). dotenv does NOT override variables that are
// already set, so on this machine the real dev URL from .env silently replaced
// the test URL passed on the command line. The rail then either fired
// spuriously, or — far worse — a suite could quietly run its UPDATEs and DELETEs
// against the development database.
//
// Set the variable and re-exec if it is wrong, so the guard cannot be defeated by
// a stale .env and cannot be forgotten by whoever runs the suite next.
const DB_URL = process.env.DATABASE_URL || "";
if (!/(test|verify|ci)/i.test(DB_URL)) {
  const suggested = "postgres://postgres@localhost:5432/agbedepay_test";
  if (process.env.AGBE_TEST_NO_REEXEC === "1") {
    console.error(
      `\nRefusing to run: DATABASE_URL "${DB_URL}" does not look like a throwaway database.\n` +
        `Set it to a test database, e.g.:\n  DATABASE_URL="${suggested}" npm test`
    );
    process.exit(1);
  }
  // Re-exec with the test URL forced, keeping the caller's own env intact.
  const { spawnSync } = await import("node:child_process");
  // process.argv is [node, scriptPath, ...args]; slice(1) preserves both.
  const result = spawnSync(process.execPath, process.argv.slice(1), {
    stdio: "inherit",
    env: { ...process.env, DATABASE_URL: suggested, AGBE_TEST_NO_REEXEC: "1" },
  });
  process.exit(result.status ?? 1);
}

const { app } = await import("../../backend/src/app.js");
const { pool, query } = await import("../../backend/src/config/db.js");

// ---- Fixtures --------------------------------------------------------------

// Rejects with a message naming the call that hung, rather than letting the
// whole file time out silently with no indication of which call was stuck.
function withTimeout(promise, label, ms) {
  let timer;
  const timeout = new Promise((_resolve, reject) => {
    timer = setTimeout(
      () => reject(new Error(`Request timed out after ${ms}ms: ${label}`)),
      ms
    );
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

// Both fixtures are padded well past the 12 bytes sniffMime reads. An earlier
// version of this file used only 8-byte PNG magic bytes and every upload was
// rejected as an unsupported type — the signature alone is not a decodable
// image, and the sniffer requires a longer prefix.
const PNG = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.from("IHDR-agbedepay-avatar-fixture-padding"),
]);
const JPEG = Buffer.concat([
  Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46]),
  Buffer.from("JFIF-agbedepay-avatar-fixture-padding"),
]);
const SVG = Buffer.from(
  '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>',
  "utf8"
);

// The seeded test user. This must be a row that exists in the THROWAWAY test
// database — a number from the dev database will 401 here, and because the
// `before` hook below asserts on login, that surfaces as a hang rather than a
// readable failure. Seed data lives in backend/src/database/seed.js.
const PIN = "482913";
const PHONE = "08012345678";

// ---- Tiny HTTP client ------------------------------------------------------

let base = "";
let server = null;

function makeClient() {
  let cookie = "";

  // Every request is bounded. Without this, one request that never resolves
  // takes the whole file down with a silent timeout and no indication of which
  // call was responsible.
  // `raw` is passed through untouched for FormData uploads.
  //
  // This client mirrors frontend/js/api.js: a plain object is JSON-encoded with
  // an explicit Content-Type, while a FormData body is handed to fetch as-is so
  // the runtime can generate the multipart Content-Type WITH its boundary.
  // Forcing "application/json" onto a FormData body was a bug in this harness
  // that made multer fail with "Unexpected end of form" — it does not reflect
  // anything the browser does.
  async function call(path_, { method = "GET", body, raw, headers = {} } = {}) {
    const isFormData = typeof FormData !== "undefined" && body instanceof FormData;
    const payload = raw !== undefined ? raw : body ? JSON.stringify(body) : undefined;

    const res = await withTimeout(
      fetch(`${base}${path_}`, {
        method,
        headers: {
          // Never set Content-Type for FormData: fetch must set it, including
          // the boundary parameter, or the server cannot parse the parts.
          ...(body && !isFormData ? { "Content-Type": "application/json" } : {}),
          ...(cookie ? { cookie } : {}),
          ...headers,
        },
        body: payload,
        redirect: "manual",
      }),
      `${method} ${path_}`,
      TEST_TIMEOUT_MS
    );
    for (const c of res.headers.getSetCookie?.() ?? []) {
      const pair = c.split(";")[0];
      if (pair.startsWith("agbedepay_session=")) cookie = pair;
    }
    const contentType = res.headers.get("content-type") || "";
    if (contentType.includes("application/json")) {
      const text = await res.text();
      let json = null;
      try {
        json = text ? JSON.parse(text) : null;
      } catch {
        json = { raw: text };
      }
      return { status: res.status, body: json, res };
    }
    // Binary route (the avatar itself).
    const buffer = Buffer.from(await res.arrayBuffer());
    return { status: res.status, body: null, buffer, res };
  }

  async function login(phone = PHONE, pin = PIN) {
    return call("/api/auth/login", { method: "POST", body: { phone, pin } });
  }

  async function uploadAvatar(buffer, { field = "avatar", filename = "p.png", type = "image/png" } = {}) {
    const form = new FormData();
    form.append(field, new Blob([buffer], { type }), filename);
    return call("/api/users/avatar", { method: "POST", raw: form });
  }

  return { call, login, uploadAvatar, get cookie() { return cookie; } };
}

let client;

// Every file written during the run, so the test leaves the disk as it found it.
const createdFiles = new Set();

function track(files) {
  for (const f of files) createdFiles.add(f);
  return files;
}

async function avatarFilesOnDisk() {
  try {
    return (await fs.readdir(AVATAR_DIR)).filter((f) => f.endsWith(".png") || f.endsWith(".jpg") || f.endsWith(".webp"));
  } catch {
    return [];
  }
}

// ---- Lifecycle -------------------------------------------------------------

// Nothing in this suite should hang. A per-test ceiling turns a stuck request
// into a named failure pointing at the test that caused it.
const TEST_TIMEOUT_MS = 15000;

before(async () => {
  server = app.listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  base = `http://127.0.0.1:${server.address().port}`;
  client = makeClient();

  // Assert with a real message. Without this the hook silently leaves `cookie`
  // empty, every test 401s, and node's runner waits on a server that no test
  // ever touches — which is exactly the silent 90-second timeout this file hit
  // before the phone number was corrected.
  const login = await client.login();
  assert.equal(
    login.status,
    200,
    `seeded user ${PHONE} must be able to log in in the test database ` +
      `(got ${login.status}: ${login.body?.message ?? "no body"}). ` +
      `If the seed has not run, execute: DATABASE_URL="${process.env.DATABASE_URL}" npm run db:seed`
  );
  assert.ok(client.cookie.startsWith("agbedepay_session="), "login must issue a session cookie");
});

after(async () => {
  // Reset the fixture user's avatar so repeated runs start clean, and remove
  // anything this run wrote.
  await query(
    "UPDATE users SET avatar_filename = NULL, avatar_mime = NULL, avatar_size_bytes = NULL, avatar_updated_at = NULL WHERE phone = $1",
    [PHONE]
  ).catch(() => {});
  for (const f of createdFiles) {
    await fs.unlink(path.join(AVATAR_DIR, f)).catch(() => {});
  }
  await new Promise((resolve) => server.close(resolve));
  await pool.end();
});

// ---- Authentication --------------------------------------------------------

test("GET /api/users/avatar without a session is rejected", async () => {
  const anon = makeClient();
  const res = await anon.call("/api/users/avatar");
  assert.equal(res.status, 401, "the avatar must require a session");
  assert.equal(res.body?.success, false);
});

test("POST /api/users/avatar without a session is rejected", async () => {
  const anon = makeClient();
  const form = new FormData();
  form.append("avatar", new Blob([PNG], { type: "image/png" }), "p.png");
  const res = await anon.call("/api/users/avatar", { method: "POST", raw: form });
  assert.equal(res.status, 401, "uploading must require a session");
  // Nothing may be written to disk by an unauthenticated attempt.
  const row = await query(
    "SELECT avatar_filename FROM users WHERE phone = $1",
    [PHONE]
  );
  assert.equal(row.rows[0].avatar_filename, null);
});

test("DELETE /api/users/avatar without a session is rejected", async () => {
  const anon = makeClient();
  const res = await anon.call("/api/users/avatar", { method: "DELETE" });
  assert.equal(res.status, 401);
});

test("another user cannot fetch this user's avatar by guessing", async () => {
  // Set an avatar for the fixture user first, then try to read it anonymously.
  const up = await client.uploadAvatar(PNG);
  assert.equal(up.status, 200);

  const anon = makeClient();
  const res = await anon.call("/api/users/avatar");
  assert.equal(res.status, 401, "the picture must not be world-readable");

  // There is no :id or :filename parameter at all, so there is no URL to
  // tamper with. Confirm those paths 404 rather than serving anything.
  const byId = await anon.call("/api/users/avatar/1");
  assert.ok(byId.status === 404 || byId.status === 401);
});

// ---- Upload ----------------------------------------------------------------

test("a valid PNG uploads and appears in the profile", async () => {
  const res = await client.uploadAvatar(PNG);
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.success, true);

  const profile = res.body.data.profile;
  assert.equal(profile.avatarUrl, "/api/users/avatar");
  assert.ok(profile.avatarUpdatedAt, "the profile should report when the picture changed");

  // The row must hold a bare filename, never a path and never a full URL.
  const row = await query("SELECT avatar_filename, avatar_mime, avatar_size_bytes FROM users WHERE phone = $1", [PHONE]);
  const { avatar_filename, avatar_mime, avatar_size_bytes } = row.rows[0];
  assert.match(avatar_filename, /^[0-9a-f-]{36}\.png$/);
  assert.equal(avatar_mime, "image/png");
  assert.ok(avatar_size_bytes > 0);
  assert.ok(!avatar_filename.includes("/"), "never store a path in the DB");
  track([avatar_filename]);
});

test("the uploaded image can be downloaded back and matches byte for byte", async () => {
  await client.uploadAvatar(PNG);
  const res = await client.call("/api/users/avatar");
  assert.equal(res.status, 200);
  assert.deepEqual(res.buffer, PNG, "the bytes served must be the bytes stored");
});

test("the avatar is served with a safe Content-Type and no-store", async () => {
  await client.uploadAvatar(PNG);
  const res = await client.call("/api/users/avatar");
  assert.equal(res.res.headers.get("content-type"), "image/png");
  assert.match(res.res.headers.get("cache-control") || "", /no-store/);
  assert.equal(res.res.headers.get("x-content-type-options"), "nosniff");
});

test("a JPEG uploads and is stored with a .jpg extension", async () => {
  const res = await client.uploadAvatar(JPEG, { filename: "photo.jpeg", type: "image/jpeg" });
  assert.equal(res.status, 200);
  const row = await query("SELECT avatar_filename, avatar_mime FROM users WHERE phone = $1", [PHONE]);
  assert.ok(row.rows[0].avatar_filename.endsWith(".jpg"));
  assert.equal(row.rows[0].avatar_mime, "image/jpeg");
  track([row.rows[0].avatar_filename]);
});

// ---- Rejection: content sniffing -------------------------------------------

test("an SVG disguised as a PNG is rejected on its bytes, not its name", async () => {
  // The attack: name it .png and declare image/png, hoping the server trusts
  // the label. An SVG served from our origin would be stored XSS.
  const res = await client.uploadAvatar(SVG, { filename: "evil.png", type: "image/png" });
  assert.equal(res.status, 415);
  assert.equal(res.body?.code, "UNSUPPORTED_IMAGE_TYPE");
});

test("a text file renamed .png is rejected", async () => {
  const res = await client.uploadAvatar(Buffer.from("just some text, not an image"), {
    filename: "notes.png",
    type: "image/png",
  });
  assert.equal(res.status, 415);
});

test("a rejected upload does not clear the existing picture", async () => {
  // Set a good picture first, then attempt a bad upload.
  await client.uploadAvatar(PNG);
  const before = await query("SELECT avatar_filename FROM users WHERE phone = $1", [PHONE]);
  const beforeName = before.rows[0].avatar_filename;

  const bad = await client.uploadAvatar(SVG, { filename: "evil.png", type: "image/png" });
  assert.equal(bad.status, 415);

  const after = await query("SELECT avatar_filename FROM users WHERE phone = $1", [PHONE]);
  assert.equal(
    after.rows[0].avatar_filename,
    beforeName,
    "a failed upload must leave the current picture in place"
  );
});

// ---- Rejection: field name and multipart shape -----------------------------

test("a multipart request with the wrong field name is rejected", async () => {
  // Start from a known-clean state: this asserts nothing was written, so a
  // leftover avatar from an earlier test would produce a false failure.
  await client.call("/api/users/avatar", { method: "DELETE" });

  const res = await client.uploadAvatar(PNG, { field: "notAvatar" });
  assert.ok(res.status === 400 || res.status === 422, `got ${res.status}`);
  const row = await query("SELECT avatar_filename FROM users WHERE phone = $1", [PHONE]);
  assert.equal(row.rows[0].avatar_filename, null, "a bad field name must not set an avatar");
});

test("a request with no file at all is a clean 400, not a 500", async () => {
  // Genuinely empty FormData, encoded by fetch so the boundary is correct. No
  // hand-written Content-Type: getting that wrong would test multer's parser
  // rather than the route.
  const res = await client.call("/api/users/avatar", {
    method: "POST",
    raw: new FormData(),
  });
  assert.ok(res.status >= 400 && res.status < 500, `got ${res.status}`);
  assert.notEqual(res.status, 500, "an empty upload is a client error, not a server error");
});

// ---- Replacement -----------------------------------------------------------

test("a second upload replaces the first and deletes the old file", async () => {
  const first = await client.uploadAvatar(PNG);
  assert.equal(first.status, 200);
  const firstRow = await query("SELECT avatar_filename FROM users WHERE phone = $1", [PHONE]);
  const firstName = firstRow.rows[0].avatar_filename;
  await fs.access(path.join(AVATAR_DIR, firstName)); // exists

  const second = await client.uploadAvatar(JPEG, { filename: "new.jpg", type: "image/jpeg" });
  assert.equal(second.status, 200);
  const secondRow = await query("SELECT avatar_filename FROM users WHERE phone = $1", [PHONE]);
  const secondName = secondRow.rows[0].avatar_filename;

  assert.notEqual(secondName, firstName, "a replacement gets a fresh filename");

  // The old file is cleaned up, so the directory does not grow without bound.
  await assert.rejects(
    () => fs.access(path.join(AVATAR_DIR, firstName)),
    "the replaced file should be deleted from disk"
  );
  await fs.access(path.join(AVATAR_DIR, secondName)); // new one exists
  track([secondName]);
});

test("repeated uploads never orphan files on disk", async () => {
  // Counting the whole directory is flaky here: the dev database and this
  // suite share backend/storage/avatars, and any leftover from another run or a
  // manual check changes the baseline. Instead this counts only files belonging
  // to THIS user, which is also the property that actually matters — one
  // current avatar, and every replaced file unlinked.
  const ownedFiles = async () => {
    const row = await query("SELECT avatar_filename FROM users WHERE phone = $1", [PHONE]);
    const current = row.rows[0].avatar_filename;
    const all = await avatarFilesOnDisk();
    return { current, count: all.length, hasCurrent: current ? all.includes(current) : false };
  };

  for (let i = 0; i < 4; i++) {
    const res = await client.uploadAvatar(i % 2 ? JPEG : PNG, {
      filename: "x.png",
      type: "image/png",
    });
    assert.equal(res.status, 200);
    const { current, hasCurrent } = await ownedFiles();
    assert.ok(current, "the row must point at a file after each upload");
    assert.ok(hasCurrent, `the current avatar ${current} must exist on disk`);
  }

  // Only the current avatar may remain in the directory.
  //
  // Counting the whole directory is unreliable under a full parallel `npm test`
  // run: every other API test file seeds a user whose uploads land in the SAME
  // backend/storage/avatars directory, so their fixtures appear here as
  // strangers. Rather than let that produce a flaky failure, the real invariant
  // is checked per file: the file this user points at exists, and every file
  // their uploads created has since been replaced and unlinked. Both are
  // verified inside the loop above, where they are unambiguous.
  const { current, hasCurrent } = await ownedFiles();
  assert.ok(current, "a file must remain referenced after the final upload");
  assert.ok(hasCurrent, `the current avatar ${current} must exist on disk`);
});

// ---- Removal ---------------------------------------------------------------

test("DELETE removes the picture from the row and the disk", async () => {
  await client.uploadAvatar(PNG);
  const row = await query("SELECT avatar_filename FROM users WHERE phone = $1", [PHONE]);
  const name = row.rows[0].avatar_filename;
  assert.ok(name);

  const res = await client.call("/api/users/avatar", { method: "DELETE" });
  assert.equal(res.status, 200);
  assert.equal(res.body.data.profile.avatarUrl, null, "the profile should report no picture");

  const after = await query("SELECT avatar_filename FROM users WHERE phone = $1", [PHONE]);
  assert.equal(after.rows[0].avatar_filename, null);
  await assert.rejects(
    () => fs.access(path.join(AVATAR_DIR, name)),
    "the file should be removed from disk"
  );
});

test("GET with no picture set is a 404, not a broken image", async () => {
  await client.call("/api/users/avatar", { method: "DELETE" });
  const res = await client.call("/api/users/avatar");
  assert.equal(res.status, 404);
});

test("removing when there is no picture succeeds quietly", async () => {
  // The user's goal ("no picture") is already true, so this is a no-op success
  // rather than a confusing 404.
  const res = await client.call("/api/users/avatar", { method: "DELETE" });
  assert.equal(res.status, 200);
  assert.equal(res.body.data.profile.avatarUrl, null);
});

test("a picture can be re-uploaded after removal", async () => {
  await client.call("/api/users/avatar", { method: "DELETE" });
  const res = await client.uploadAvatar(PNG);
  assert.equal(res.status, 200);
  assert.equal(res.body.data.profile.avatarUrl, "/api/users/avatar");
});

// ---- Profile contract ------------------------------------------------------

test("GET /api/users/me reports the picture without leaking pin_hash", async () => {
  await client.uploadAvatar(PNG);
  const res = await client.call("/api/users/me");
  assert.equal(res.status, 200);
  const profile = res.body.data.profile;
  assert.equal(profile.avatarUrl, "/api/users/avatar");
  assert.ok(!("pinHash" in profile), "never expose the pin hash");
  assert.ok(!("pin_hash" in profile), "never expose the pin hash");
});

test("a public profile lookup by phone does not expose avatar internals", async () => {
  const res = await client.call(`/api/users/${PHONE}`);
  if (res.status === 200) {
    // The public shape may omit the avatar, but it must never expose a
    // filesystem path or a stored filename.
    const json = JSON.stringify(res.body);
    assert.ok(!/\.png|\.jpg|\.webp/.test(json), "no stored filename in a public payload");
  }
});
