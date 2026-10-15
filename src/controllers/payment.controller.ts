import type { Request, Response } from 'express';
import * as paymentService from '../services/payment.service.js';
import { ok } from '../utils/ApiResponse.js';

export async function config(_req: Request, res: Response) {
  return ok(res, paymentService.paymentConfig());
}

export async function createOrder(req: Request, res: Response) {
  return ok(res, await paymentService.createOrder(req.body.testSeriesId, req.auth!.user.id));
}

export async function verify(req: Request, res: Response) {
  return ok(res, await paymentService.verifyPayment(req.body, req.auth!.user.id), 'Payment successful. You now have access.');
}

export async function webhook(req: Request, res: Response) {
  const result = await paymentService.handleWebhook(req.rawBody, req.get('x-razorpay-signature'), req.get('x-razorpay-event-id'));
  return ok(res, result);
}
