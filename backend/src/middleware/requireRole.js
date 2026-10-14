// requireRole — role-based access control on top of requireAuth.
// requireAuth establishes WHO the caller is (req.user); this gate decides
// whether that user is ALLOWED to reach the route. Always mount requireAuth
// before a role guard, e.g.:
//   router.get("/admin/x", requireAuth, requireRole("ADMIN"), handler);
//
// The role is read on demand from the users table rather than carried on every
// session lookup, so role-guarded routes can ship before the roles migration
// is applied without breaking any existing endpoint.

import * as usersModel from "../models/users.js";
import { ApiError, ErrorCodes, asyncHandler } from "../utils/errors.js";

export function requireRole(...roles) {
  const allowed = new Set(roles);
  return asyncHandler(async (req, _res, next) => {
    if (!req.user) {
      throw new ApiError(401, "Authentication required", ErrorCodes.UNAUTHORIZED);
    }
    const role = req.user.role ?? (await usersModel.getRoleById(req.user.id));
    if (!allowed.has(role)) {
      throw new ApiError(403, "You do not have access to this resource", ErrorCodes.FORBIDDEN);
    }
    req.user.role = role;
    next();
  });
}
