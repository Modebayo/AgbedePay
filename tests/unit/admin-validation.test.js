// tests/unit/admin-validation.test.js — the admin console's request schemas,
// tested without any database.
//
// The console is the one place a non-financial admin can change platform state
// (approve a driver, price cargo, resolve a ticket). Bad input must be stopped
// at the edge, before it reaches a model, so the validator is worth pinning
// down directly: what it accepts, and — more importantly — what it refuses.

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { validate } from "../../backend/src/validators/validate.js";
import {
  driverStatusSchema,
  cargoQuoteSchema,
  supportReplySchema,
  reconcileParams,
  adminIdParams,
} from "../../backend/src/validators/adminSchemas.js";

// Run a validate() middleware synchronously and return the error it passed to
// next() (undefined when the request was accepted).
function run(schema, source, data) {
  let captured;
  validate(schema, source)({ [source]: data }, {}, (err) => {
    captured = err;
  });
  return captured;
}

describe("driverStatusSchema", () => {
  test("accepts the three statuses the console can set", () => {
    for (const status of ["ACTIVE", "SUSPENDED", "PENDING"]) {
      assert.equal(run(driverStatusSchema, "body", { status }), undefined);
    }
  });

  test("rejects an unknown status and a missing one", () => {
    assert.equal(run(driverStatusSchema, "body", { status: "DELETED" }).code, "VALIDATION_ERROR");
    assert.equal(run(driverStatusSchema, "body", {}).code, "VALIDATION_ERROR");
  });
});

describe("cargoQuoteSchema", () => {
  test("an amount-only body is valid (the common 'price this request' case)", () => {
    assert.equal(run(cargoQuoteSchema, "body", { quotedAmountMinor: 250000 }), undefined);
  });

  test("a note-only body is valid", () => {
    assert.equal(run(cargoQuoteSchema, "body", { adminNote: "Call customer first" }), undefined);
  });

  test("a zero or negative quote is refused", () => {
    assert.equal(run(cargoQuoteSchema, "body", { quotedAmountMinor: 0 }).code, "VALIDATION_ERROR");
    assert.equal(run(cargoQuoteSchema, "body", { quotedAmountMinor: -5 }).code, "VALIDATION_ERROR");
  });

  test("a status outside the cargo lifecycle is refused", () => {
    assert.equal(run(cargoQuoteSchema, "body", { status: "PAID" }).code, "VALIDATION_ERROR");
  });
});

describe("supportReplySchema", () => {
  test("a non-empty reply is valid", () => {
    assert.equal(run(supportReplySchema, "body", { reply: "We're on it" }), undefined);
  });

  test("an empty reply is refused", () => {
    assert.equal(run(supportReplySchema, "body", { reply: "" }).code, "VALIDATION_ERROR");
    assert.equal(run(supportReplySchema, "body", {}).code, "VALIDATION_ERROR");
  });
});

describe("params", () => {
  test("adminIdParams requires a uuid", () => {
    assert.equal(run(adminIdParams, "params", { id: "11111111-1111-1111-1111-111111111111" }), undefined);
    assert.equal(run(adminIdParams, "params", { id: "not-a-uuid" }).code, "VALIDATION_ERROR");
  });

  test("reconcileParams accepts a payment reference", () => {
    assert.equal(run(reconcileParams, "params", { reference: "PAY-ABC123" }), undefined);
    assert.equal(run(reconcileParams, "params", { reference: "" }).code, "VALIDATION_ERROR");
  });
});
