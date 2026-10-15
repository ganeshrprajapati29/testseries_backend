import * as paymentService from '../services/payment.service.js';
import { ok } from '../utils/ApiResponse.js';
export async function config(_req, res) {
    return ok(res, paymentService.paymentConfig());
}
export async function createOrder(req, res) {
    return ok(res, await paymentService.createOrder(req.body.testSeriesId, req.auth.user.id));
}
export async function verify(req, res) {
    return ok(res, await paymentService.verifyPayment(req.body, req.auth.user.id), 'Payment successful. You now have access.');
}
export async function webhook(req, res) {
    const result = await paymentService.handleWebhook(req.rawBody, req.get('x-razorpay-signature'), req.get('x-razorpay-event-id'));
    return ok(res, result);
}
//# sourceMappingURL=payment.controller.js.map