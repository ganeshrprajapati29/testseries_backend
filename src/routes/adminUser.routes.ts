import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { requireRole } from '../middleware/authorize.js';
import { validate } from '../middleware/validate.js';
import { audit } from '../services/audit.service.js';
import * as adminUsers from '../services/adminUser.service.js';
import { ACCOUNT_STATUSES } from '../types/enums.js';
import { created, ok } from '../utils/ApiResponse.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { emailSchema, nameSchema, passwordSchema } from '../validators/auth.validator.js';
import { idParams } from '../validators/common.js';

/** Admin accounts - super admins only. */
export const adminUserRouter = Router();
adminUserRouter.use(requireRole('superadmin'));

const role = z.enum(['admin', 'superadmin']);

adminUserRouter.get(
  '/',
  asyncHandler(async (_req: Request, res: Response) => ok(res, await adminUsers.listAdmins())),
);

adminUserRouter.post(
  '/',
  validate({ body: z.object({ name: nameSchema, email: emailSchema, password: passwordSchema, role: role.default('admin') }) }),
  asyncHandler(async (req: Request, res: Response) => {
    const admin = await adminUsers.createAdmin(req.body);
    await audit(req, { action: 'admin_user.create', entityType: 'User', entityId: String(admin!._id), summary: `${admin!.email} (${admin!.role})` });
    return created(res, admin, 'Admin account created');
  }),
);

adminUserRouter.patch(
  '/:id',
  validate({
    params: idParams,
    body: z
      .object({ name: nameSchema.optional(), email: emailSchema.optional(), role: role.optional(), accountStatus: z.enum(ACCOUNT_STATUSES).optional() })
      .refine((v) => Object.keys(v).length > 0, 'Nothing to update'),
  }),
  asyncHandler(async (req: Request, res: Response) => {
    const admin = await adminUsers.updateAdmin(String(req.params.id), req.auth!.user.id, req.body);
    await audit(req, { action: 'admin_user.update', entityType: 'User', entityId: String(req.params.id), summary: admin?.email, metadata: { fields: Object.keys(req.body) } });
    return ok(res, admin, 'Admin updated');
  }),
);

adminUserRouter.post(
  '/:id/reset-password',
  validate({ params: idParams, body: z.object({ password: passwordSchema }) }),
  asyncHandler(async (req: Request, res: Response) => {
    const r = await adminUsers.resetAdminPassword(String(req.params.id), req.auth!.user.id, req.body.password);
    await audit(req, { action: 'admin_user.reset_password', entityType: 'User', entityId: String(req.params.id), summary: r.email });
    return ok(res, null, 'Password reset. The admin has been signed out of all devices.');
  }),
);
