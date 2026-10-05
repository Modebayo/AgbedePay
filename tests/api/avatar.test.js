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
import { app } from "../../backend/src/app.js";
import { pool, query } from "../../backend/src/config/db.js";
import { AVATAR_DIR } from "../../backend/src/middleware/uploadAvatar.js";

// ---- Safety rail -----------------------------------------------------------

const DB_URL = process.env.DATABASE_URL || "";
if (!/(test|verify|ci)/i.test(DB_URL)) {
  throw new Error(
    `Refusing to run: DATABASE_URL "${DB_URL}" does not look like a throwaway database.`
  );
}

// ---- Fixtures --------------------------------------------------------------

const PNG = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.from("agbedepay-avatar-fixture"),
]);
const JPEG = Buffer.concat([
  Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46]),
  Buffer.from("agbedepay-avatar-fixture"),
]);
const SVG = Buffer.from(
  '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>',
  "utf8"
);

const PIN = "482913";
const PHONE = "08012345678";

// ---- Tiny HTTP client ------------------------------------------------------

let base = "";
let server = null;

function makeClient() {
  let cookie = "";

  async function call(path_, { method = "GET", body, headers = {} } = {}) {
    const res = await fetch(`${base}${path_}`, {
      method,
      headers: {
        ...(body ? { "Content-Type": "application/json" } : {}),
        ...(cookie ? { cookie } : {}),
        ...headers,
      },
      body: body ? JSON.stringify(body) : undefined,
      redirect: "manual",
    });
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
    return call("/api/users/avatar", { method: "POST", body: form });
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

before(async () => {
  server = app.listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  base = `http://127.0.0.1:${server.address().port}`;
  client = makeClient();

  const login = await client.login();
  assert.equal(login.status, 200, "seeded user must be able to log in");
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
  const res = await anon.call("/api/users/avatar", { method: "POST", body: form });
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
  const res = await client.uploadAvatar(PNG, { field: "notAvatar" });
  assert.ok(res.status === 400 || res.status === 422, `got ${res.status}`);
  const row = await query("SELECT avatar_filename FROM users WHERE phone = $1", [PHONE]);
  assert.equal(row.rows[0].avatar_filename, null, "a bad field name must not set an avatar");
});

test("a request with no file at all is a clean 400, not a 500", async () => {
  const res = await client.call("/api/users/avatar", {
    method: "POST",
    body: new FormData(),
    headers: { "Content-Type": "multipart/form-data; boundary=x" },
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
  const before = (await avatarFilesOnDisk()).length;
  for (let i = 0; i < 4; i++) {
    const res = await client.uploadAvatar(i % 2 ? JPEG : PNG, {
      filename: "x.png",
      type: "image/png",
    });
    assert.equal(res.status, 200);
  }
  const after = (await avatarFilesOnDisk()).length;
  assert.equal(after, before + 1, "only the current avatar should remain on disk");
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
