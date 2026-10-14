// tests/unit/driver-apply.test.js — the self-service "Apply to drive" request
// schema, tested without any database.
//
// Anyone signed in can apply, so this is the one driver endpoint a CUSTOMER can
// reach. Bad input must be stopped at the edge, before it reaches the model that
// flips the account's role. These pin down what the form may submit and what it
// must refuse — in particular the vehicle type whitelist and the loose-but-real
// plate/colour bounds.

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { validate } from "../../backend/src/validators/validate.js";
import { driverApplySchema } from "../../backend/src/validators/driverSchemas.js";

// Run a validate() middleware synchronously and return the error it passed to
// next() (undefined when the request was accepted).
function run(schema, source, data) {
  let captured;
  validate(schema, source)({ [source]: data }, {}, (err) => {
    captured = err;
  });
  return captured;
}

const VALID = {
  vehicleType: "CAR",
  carMakeModel: "Toyota Corolla",
  carColor: "Silver",
  plateNumber: "LAG-123-XY",
};

describe("driverApplySchema", () => {
  test("accepts a complete application for each allowed vehicle type", () => {
    for (const vehicleType of ["CAR", "VAN", "BIKE"]) {
      assert.equal(run(driverApplySchema, "body", { ...VALID, vehicleType }), undefined);
    }
  });

  test("rejects a vehicle type outside the whitelist", () => {
    assert.equal(run(driverApplySchema, "body", { ...VALID, vehicleType: "TRUCK" }).code, "VALIDATION_ERROR");
  });

  test("rejects any missing required field", () => {
    for (const field of ["vehicleType", "carMakeModel", "carColor", "plateNumber"]) {
      const body = { ...VALID };
      delete body[field];
      assert.equal(run(driverApplySchema, "body", body).code, "VALIDATION_ERROR", `missing ${field}`);
    }
  });

  test("rejects values that are too short", () => {
    assert.equal(run(driverApplySchema, "body", { ...VALID, carMakeModel: "X" }).code, "VALIDATION_ERROR");
    assert.equal(run(driverApplySchema, "body", { ...VALID, carColor: "R" }).code, "VALIDATION_ERROR");
    assert.equal(run(driverApplySchema, "body", { ...VALID, plateNumber: "AB" }).code, "VALIDATION_ERROR");
  });

  test("rejects values that are too long", () => {
    assert.equal(run(driverApplySchema, "body", { ...VALID, carMakeModel: "x".repeat(81) }).code, "VALIDATION_ERROR");
    assert.equal(run(driverApplySchema, "body", { ...VALID, carColor: "x".repeat(41) }).code, "VALIDATION_ERROR");
    assert.equal(run(driverApplySchema, "body", { ...VALID, plateNumber: "x".repeat(21) }).code, "VALIDATION_ERROR");
  });
});
