// validate(schema, source) returns Express MIDDLEWARE that checks a request
// before the controller runs. If any field fails, we respond 400 immediately.

import { rules } from "./rules.js";
import { ApiError, ErrorCodes } from "../utils/errors.js";

export function validate(schema, source = "body") {
  return (req, res, next) => {
    const errors = [];
    const data = req[source];

    for (const [field, spec] of Object.entries(schema)) {
      const value = data?.[field];

      // "optional" first: if the field is empty, skip every other rule.
      if (spec[0] === "optional" && (value === undefined || value === null || value === "")) {
        continue;
      }

      for (const item of spec) {
        const [name, arg] = Array.isArray(item) ? item : [item];
        const rule = rules[name];
        if (!rule) continue; // unknown rule: skip, don't crash

        const ok = rule.args ? rule.run(value, [arg]) : rule.run(value);
        if (!ok) {
          errors.push({
            field,
            rule: name,
            message: `${field} failed "${name}${arg !== undefined ? `=${arg}` : ""}"`,
          });
          break; // one error per field is enough
        }
      }
    }

    if (errors.length > 0) {
      return next(
        new ApiError(400, "Request validation failed", ErrorCodes.VALIDATION, errors)
      );
    }

    next();
  };
}

// Pre-built schemas reused by several routes.
export const schemas = {
  phoneParam: { phone: ["required", "string", "phone"] },
};