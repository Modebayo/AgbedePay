// /api/users/* routes — all protected. Ownership is derived from the session,
// never from anything the client sends.

import { Router } from "express";
import { requireAuth } from "../middleware/requireAuth.js";
import * as userController from "../controllers/userController.js";

const router = Router();

router.get("/me", requireAuth, userController.getMe);

// GET /api/users/avatar — the signed-in user's own picture.
//
// Served by us rather than by express.static because frontend/ is public. The
// order of the two middleware matters and is easy to get wrong: requireAuth runs
// FIRST so an unauthenticated request is rejected before any file is opened.
//
// The bytes are never written into frontend/ in the first place (see
// uploadAvatar.js), so a leaked filename is not enough to fetch them.
router.get("/avatar", requireAuth, userController.getMyAvatar);

// POST /api/users/avatar — upload or replace the picture. multipart/form-data
// with a single "avatar" field.
router.post("/avatar", requireAuth, userController.uploadAvatar);

// DELETE /api/users/avatar — remove the picture.
router.delete("/avatar", requireAuth, userController.removeAvatar);

export default router;