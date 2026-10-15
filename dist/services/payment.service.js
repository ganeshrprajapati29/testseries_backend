import crypto from 'node:crypto';
import { env } from '../config/env.js';
import { logger } from '../config/logger.js';
import { withTransaction } from '../config/database.js';
import { OrderModel } from '../models/Order.model.js';
import { PaymentModel } from '../models/Payment.model.js';
import { TestSeriesModel } from '../models/TestSeries.model.js';
import { UserModel } from '../models/User.model.js';
import { ApiError } from '../utils/ApiError.js';
import { buildMeta, pageParams } from '../utils/pagination.js';
import { safeEqual } from '../utils/tokens.js';
import { activeEnrollment, grantEnrollment } from './access.service.js';
const RAZORPAY_API = 'https://api.razorpay.com/v1';
export function paymentConfig() {
    return { enabled: env.paymentsConfigured, provider: 'razorpay', keyId: env.paymentsConfigured ? env.RAZORPAY_KEY_ID : null, currency: 'INR' };
}
function assertConfigured() {
    if (!env.paymentsConfigured)
        throw ApiError.unavailable('Online payments are not enabled yet. Please contact Civil Sansad to enrol.');
}
async function razorpayRequest(path, body) {
    const auth = Buffer.from(`${env.RAZORPAY_KEY_ID}:${env.RAZORPAY_KEY_SECRET}`).toString('base64');
    const res = await fetch(`${RAZORPAY_API}${path}`, {
        method: 'POST',
        headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) {
        const text = await res.text().catch(() => '');
        logger.error({ status: res.status, body: text.slice(0, 500) }, 'Razorpay request failed');
        throw ApiError.unavailable('Payment gateway is unavailable. Please try again later.');
    }
    return (await res.json());
}
export async function createOrder(seriesId, studentId) {
    assertConfigured();
    const series = await TestSeriesModel.findOne({ _id: seriesId, publicationStatus: 'published' }).lean();
    if (!series)
        throw ApiError.notFound('Test series not found');
    if (series.accessType !== 'paid' || !series.price)
        throw ApiError.badRequest('This test series is free. Enrol directly.');
    if (await activeEnrollment(studentId, series._id))
        throw ApiError.conflict('You already have access to this test series', 'ALREADY_ENROLLED');
    const amount = Math.round(series.price * 100);
    const receipt = `cs_${crypto.randomBytes(8).toString('hex')}`;
    const providerOrder = await razorpayRequest('/orders', {
        amount,
        currency: 'INR',
        receipt,
        notes: { seriesId: String(series._id), studentId },
    });
    const order = await OrderModel.create({
        studentId,
        testSeriesId: series._id,
        amount,
        currency: 'INR',
        orderStatus: 'created',
        paymentProvider: 'razorpay',
        providerOrderId: providerOrder.id,
        receipt,
    });
    const user = await UserModel.findById(studentId).lean();
    return {
        orderId: String(order._id),
        providerOrderId: providerOrder.id,
        amount,
        currency: 'INR',
        keyId: env.RAZORPAY_KEY_ID,
        seriesTitle: series.title,
        prefill: { name: user?.name ?? '', email: user?.email ?? '', contact: user?.mobile ?? '' },
    };
}
function hmac(secret, payload) {
    return crypto.createHmac('sha256', secret).update(payload).digest('hex');
}
/** Marks an order paid exactly once and grants access. Safe to call from both verify and webhook. */
async function markOrderPaid(params) {
    return withTransaction(async (session) => {
        const order = await OrderModel.findOne({ providerOrderId: params.providerOrderId }).session(session ?? null);
        if (!order)
            throw ApiError.notFound('Order not found');
        if (params.amount !== undefined && params.amount !== order.amount) {
            logger.error({ orderId: order.id, expected: order.amount, received: params.amount }, 'Payment amount mismatch');
            throw ApiError.badRequest('Payment amount mismatch');
        }
        const existingPayment = await PaymentModel.findOne({ providerPaymentId: params.providerPaymentId }).session(session ?? null);
        if (!existingPayment) {
            await PaymentModel.create([
                {
                    orderId: order._id,
                    providerPaymentId: params.providerPaymentId,
                    amount: order.amount,
                    paymentStatus: 'captured',
                    verifiedAt: new Date(),
                    webhookEventId: params.webhookEventId ?? null,
                    method: params.method ?? '',
                },
            ], { session });
        }
        if (order.orderStatus !== 'paid') {
            order.orderStatus = 'paid';
            order.paidAt = new Date();
            await order.save({ session });
            const series = await TestSeriesModel.findById(order.testSeriesId).session(session ?? null).lean();
            await grantEnrollment({
                studentId: order.studentId,
                seriesId: order.testSeriesId,
                validityDays: series?.validityDays ?? 365,
                source: 'purchase',
                orderId: order._id,
                session,
            });
        }
        return order;
    });
}
export async function verifyPayment(input, studentId) {
    assertConfigured();
    const order = await OrderModel.findOne({ providerOrderId: input.razorpayOrderId, studentId }).lean();
    if (!order)
        throw ApiError.notFound('Order not found');
    const expected = hmac(env.RAZORPAY_KEY_SECRET, `${input.razorpayOrderId}|${input.razorpayPaymentId}`);
    if (!safeEqual(expected, input.razorpaySignature)) {
        await OrderModel.updateOne({ _id: order._id, orderStatus: 'created' }, { orderStatus: 'failed' });
        throw ApiError.badRequest('Payment verification failed');
    }
    const paid = await markOrderPaid({ providerOrderId: input.razorpayOrderId, providerPaymentId: input.razorpayPaymentId });
    return { orderId: String(paid._id), status: paid.orderStatus, testSeriesId: String(paid.testSeriesId) };
}
export async function handleWebhook(rawBody, signature, eventId) {
    if (!env.paymentsConfigured || !env.RAZORPAY_WEBHOOK_SECRET)
        throw ApiError.unavailable('Payments not configured');
    if (!rawBody || !signature)
        throw ApiError.badRequest('Missing signature');
    const expected = hmac(env.RAZORPAY_WEBHOOK_SECRET, rawBody);
    if (!safeEqual(expected, signature))
        throw ApiError.badRequest('Invalid signature');
    if (eventId && (await PaymentModel.exists({ webhookEventId: eventId })))
        return { duplicate: true };
    let event;
    try {
        event = JSON.parse(rawBody.toString('utf8'));
    }
    catch {
        throw ApiError.badRequest('Invalid payload');
    }
    const payment = event.payload?.payment?.entity;
    if ((event.event === 'payment.captured' || event.event === 'order.paid') && payment?.order_id) {
        await markOrderPaid({
            providerOrderId: payment.order_id,
            providerPaymentId: payment.id,
            amount: payment.amount,
            method: payment.method,
            webhookEventId: eventId ?? null,
        });
    }
    else if (event.event === 'payment.failed' && payment?.order_id) {
        await OrderModel.updateOne({ providerOrderId: payment.order_id, orderStatus: 'created' }, { orderStatus: 'failed' });
    }
    return { received: true };
}
export async function studentOrders(studentId) {
    return OrderModel.find({ studentId }).populate('testSeriesId', 'title slug').sort({ createdAt: -1 }).limit(100).lean();
}
export async function adminListOrders(q) {
    const { page, limit, skip } = pageParams(q.page, q.limit);
    const filter = {};
    if (q.status)
        filter.orderStatus = q.status;
    const [items, total] = await Promise.all([
        OrderModel.find(filter).populate('studentId', 'name email').populate('testSeriesId', 'title').sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
        OrderModel.countDocuments(filter),
    ]);
    return { items, meta: buildMeta(page, limit, total) };
}
//# sourceMappingURL=payment.service.js.map