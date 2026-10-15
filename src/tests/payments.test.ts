import crypto from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { env } from '../config/env.js';
import { EnrollmentModel } from '../models/Enrollment.model.js';
import { OrderModel } from '../models/Order.model.js';
import { PaymentModel } from '../models/Payment.model.js';
import { app, makePublishedTest, studentClient } from './helpers.js';
import request from 'supertest';

function enablePayments() {
  Object.assign(env, {
    paymentsConfigured: true,
    PAYMENTS_ENABLED: true,
    RAZORPAY_KEY_ID: 'rzp_test_key',
    RAZORPAY_KEY_SECRET: 'secret_key',
    RAZORPAY_WEBHOOK_SECRET: 'webhook_secret',
  });
}

function disablePayments() {
  Object.assign(env, { paymentsConfigured: false, PAYMENTS_ENABLED: false });
}

describe('payments', () => {
  it('reports when payments are disabled and refuses to create orders', async () => {
    disablePayments();
    const { series } = await makePublishedTest({ accessType: 'paid' });
    const { c } = await studentClient();
    expect((await c.get('/api/payments/config')).body.data.enabled).toBe(false);
    expect((await c.post('/api/payments/orders', { testSeriesId: String(series._id) })).status).toBe(503);
  });

  it('creates an order, verifies the signature and grants access exactly once', async () => {
    enablePayments();
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ id: 'order_TEST123', amount: 49900, currency: 'INR' }), { status: 200 }),
    );
    try {
      const { series, test } = await makePublishedTest({ accessType: 'paid' });
      const { c } = await studentClient();

      const order = await c.post('/api/payments/orders', { testSeriesId: String(series._id) });
      expect(order.status).toBe(200);
      expect(order.body.data.amount).toBe(49900);

      const bad = await c.post('/api/payments/verify', { razorpayOrderId: 'order_TEST123', razorpayPaymentId: 'pay_TEST1', razorpaySignature: 'a'.repeat(64) });
      expect(bad.status).toBe(400);

      // A failed signature marks the order failed; create a new one for the success path.
      await OrderModel.updateOne({ providerOrderId: 'order_TEST123' }, { orderStatus: 'created' });
      const signature = crypto.createHmac('sha256', 'secret_key').update('order_TEST123|pay_TEST1').digest('hex');
      const good = await c.post('/api/payments/verify', { razorpayOrderId: 'order_TEST123', razorpayPaymentId: 'pay_TEST1', razorpaySignature: signature });
      expect(good.status).toBe(200);
      expect(await EnrollmentModel.countDocuments({ testSeriesId: series._id, source: 'purchase' })).toBe(1);

      // Webhook for the same payment is idempotent.
      const body = JSON.stringify({ event: 'payment.captured', payload: { payment: { entity: { id: 'pay_TEST1', order_id: 'order_TEST123', amount: 49900, method: 'upi' } } } });
      const sig = crypto.createHmac('sha256', 'webhook_secret').update(body).digest('hex');
      const hook = await request(app).post('/api/payments/webhook').set('Content-Type', 'application/json').set('X-Razorpay-Signature', sig).set('X-Razorpay-Event-Id', 'evt_1').send(body);
      expect(hook.status).toBe(200);
      expect(await PaymentModel.countDocuments()).toBe(1);

      expect((await c.post(`/api/exams/tests/${test._id}/start`)).status).toBe(201);
    } finally {
      fetchMock.mockRestore();
      disablePayments();
    }
  });

  it('rejects webhooks with an invalid signature', async () => {
    enablePayments();
    try {
      const res = await request(app).post('/api/payments/webhook').set('Content-Type', 'application/json').set('X-Razorpay-Signature', 'deadbeef').send('{"event":"payment.captured"}');
      expect(res.status).toBe(400);
    } finally {
      disablePayments();
    }
  });
});
