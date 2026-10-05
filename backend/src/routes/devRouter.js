// DEV routes — a working example of the full layered pattern
// (route -> validator -> controller -> service -> model -> PostgreSQL).
// Mounted ONLY in development; removed from production. Real, protected
// endpoints arrive in Phases 5+.

import { Router } from "express";
import { validate, schemas } from "../validators/validate.js";
import * as userController from "../controllers/userController.js";

const router = Router();

// GET  /api/dev/users                  -> list every user (dev only)
// GET  /api/dev/users/:phone           -> one user + wallet
// GET  /api/dev/users/:phone/wallet    -> alias for the wallet view
// PATCH /api/dev/users/:phone          -> rename a user (demonstrates PATCH + UPDATE + trigger)

router.get("/users", userController.listUsers);

router.get(
  "/users/:phone",
  validate(schemas.phoneParam, "params"),
  userController.getUserByPhone
);

router.get(
  "/users/:phone/wallet",
  validate(schemas.phoneParam, "params"),
  userController.getUserByPhone
);

router.patch(
  "/users/:phone",
  validate(schemas.phoneParam, "params"),
  validate({ fullName: ["required", "string", ["maxLen", 120]] }),
  userController.renameUser
);

export default router;