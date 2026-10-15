import type { Request, Response } from 'express';
import * as authService from '../services/auth.service.js';
import { ok } from '../utils/ApiResponse.js';

export async function getProfile(req: Request, res: Response) {
  const user = await authService.getUserById(req.auth!.user.id);
  return ok(res, { user: authService.publicUser(user) });
}

export async function updateProfile(req: Request, res: Response) {
  const user = await authService.updateProfile(req.auth!.user.id, req.body);
  return ok(res, { user: authService.publicUser(user) }, 'Profile updated');
}
