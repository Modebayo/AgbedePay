// tests/unit/transfer-account.test.js — the account-number transfer feature,
// tested without a database.
//
// Two things are pinned down here:
//   1. the request schemas that let a wallet transfer name its recipient by
//      phone OR by a 10-digit AgbedePay account number (and the reverse-lookup
//      preview schema); and
//   2. the central error handler's multer mapping, which used to swallow our own
//      LIMIT_EXCEEDED (KYC limit) errors because that code also starts "LIMIT_".

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { validate } from "../../backend/src/validators/validate.js";
import {
  sendMoneySchema,
  verifyAgbedeAccountSchema,
} from "../../backend/src/validators/transferSchemas.js";
import { ApiError } from "../../backend/src/utils/errors.js";
import { errorHandler } from "../../backend/src/middleware/errorHandler.js";

// Run a validate() middleware synchronously and return the error it passed to
// next() (undefined when the request was accepted).
function run(schema, data) {
  let captured;
  validate(schema, "body")({ body: data }, {}, (err) => {
    captured = err;
  });
  return captured;
}

const VALID_PIN = "482913";

describe("sendMoneySchema — recipient by phone or account number", () => {
  test("accepts a recipient account number with no phone", () => {
    const err = run(sendMoneySchema, {
      recipientAccount: "2100000000",
      amountMinor: 10000,
      pin: VALID_PIN,
    });
    assert.equal(err, undefined);
  });

  test("accepts a recipient phone with no account number", () => {
    const err = run(sendMoneySchema, {
      recipientPhone: "08087654321",
      amountMinor: 10000,
      pin: VALID_PIN,
    });
    assert.equal(err, undefined);
  });

  test("accepts BOTH fields at the schema layer (the service enforces exactly one)", () => {
    // The rule engine has no "exactly one of" primitive, so the schema stays
    // permissive here and transferService.sendMoney rejects an ambiguous request
    // with a 400. This test documents that division of labour.
    const err = run(sendMoneySchema, {
      recipientPhone: "08087654321",
      recipientAccount: "2100000000",
      amountMinor: 10000,
      pin: VALID_PIN,
    });
    assert.equal(err, undefined);
  });

  test("rejects an account number that is not exactly 10 digits", () => {
    for (const bad of ["12345", "21000000000", "210000000a"]) {
      const err = run(sendMoneySchema, { recipientAccount: bad, amountMinor: 10000, pin: VALID_PIN });
      assert.equal(err?.code, "VALIDATION_ERROR", `expected ${bad} to be rejected`);
    }
  });

  test("rejects a malformed phone number", () => {
    for (const bad of ["12345", "080876543210", "0908765432"]) {
      const err = run(sendMoneySchema, { recipientPhone: bad, amountMinor: 10000, pin: VALID_PIN });
      assert.equal(err?.code, "VALIDATION_ERROR", `expected ${bad} to be rejected`);
    }
  });

  test("still requires amount and pin", () => {
    assert.equal(run(sendMoneySchema, { recipientAccount: "2100000000", pin: VALID_PIN }).code, "VALIDATION_ERROR");
    assert.equal(run(sendMoneySchema, { recipientAccount: "2100000000", amountMinor: 10000 }).code, "VALIDATION_ERROR");
    assert.equal(run(sendMoneySchema, { recipientAccount: "2100000000", amountMinor: 0, pin: VALID_PIN }).code, "VALIDATION_ERROR");
  });
});

describe("verifyAgbedeAccountSchema — reverse lookup", () => {
  test("accepts an account number or a phone number", () => {
    assert.equal(run(verifyAgbedeAccountSchema, { accountNumber: "2100000000" }), undefined);
    assert.equal(run(verifyAgbedeAccountSchema, { phone: "08033333333" }), undefined);
  });

  test("accepts an empty body at the schema layer (service enforces one-of)", () => {
    assert.equal(run(verifyAgbedeAccountSchema, {}), undefined);
  });

  test("rejects a bad account number or phone format", () => {
    assert.equal(run(verifyAgbedeAccountSchema, { accountNumber: "123" }).code, "VALIDATION_ERROR");
    assert.equal(run(verifyAgbedeAccountSchema, { phone: "123" }).code, "VALIDATION_ERROR");
  });
});

// ---- error handler: LIMIT_EXCEEDED must survive the multer mapping ----------

function fakeRes() {
  return {
    headersSent: false,
    statusCode: null,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
    end() {
      this.ended = true;
    },
  };
}

const REQ = { method: "POST", originalUrl: "/api/transactions/send" };

describe("errorHandler — multer codes vs our own LIMIT_EXCEEDED", () => {
  test("a KYC LIMIT_EXCEEDED keeps its 403 status and its real message", () => {
    const res = fakeRes();
    const err = new ApiError(403, "You've used today's send limit. ₦0.00 left today.", "LIMIT_EXCEEDED");
    errorHandler(err, REQ, res, () => {});

    assert.equal(res.statusCode, 403);
    assert.equal(res.body.code, "LIMIT_EXCEEDED");
    assert.match(res.body.message, /send limit/);
    assert.doesNotMatch(res.body.message, /upload/i);
  });

  test("a real multer LIMIT_FILE_SIZE is still mapped to a 413", () => {
    const res = fakeRes();
    const err = new Error("File too large");
    err.name = "MulterError";
    err.code = "LIMIT_FILE_SIZE";
    errorHandler(err, REQ, res, () => {});

    assert.equal(res.statusCode, 413);
    assert.match(res.body.message, /too large/i);
  });

  test("a multer LIMIT_UNEXPECTED_FILE is mapped to a 400", () => {
    const res = fakeRes();
    const err = new Error("Unexpected field");
    err.name = "MulterError";
    err.code = "LIMIT_UNEXPECTED_FILE";
    errorHandler(err, REQ, res, () => {});

    assert.equal(res.statusCode, 400);
    assert.match(res.body.message, /single file/i);
  });
});
