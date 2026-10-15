import { Schema, model, type InferSchemaType } from 'mongoose';
import { PAYMENT_STATUSES } from '../types/enums.js';

const paymentSchema = new Schema(
  {
    orderId: { type: Schema.Types.ObjectId, ref: 'Order', required: true },
    providerPaymentId: { type: String, required: true },
    amount: { type: Number, required: true, min: 0 },
    paymentStatus: { type: String, enum: PAYMENT_STATUSES, required: true },
    verifiedAt: { type: Date, default: null },
    webhookEventId: { type: String, default: null },
    method: { type: String, default: '' },
  },
  { timestamps: true },
);

paymentSchema.index({ providerPaymentId: 1 }, { unique: true });
paymentSchema.index({ webhookEventId: 1 }, { unique: true, partialFilterExpression: { webhookEventId: { $type: 'string' } } });
paymentSchema.index({ orderId: 1 });

export type Payment = InferSchemaType<typeof paymentSchema>;
export const PaymentModel = model('Payment', paymentSchema);
