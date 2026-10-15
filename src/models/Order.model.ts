import { Schema, model, type InferSchemaType, type HydratedDocument } from 'mongoose';
import { ORDER_STATUSES } from '../types/enums.js';

const orderSchema = new Schema(
  {
    studentId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    testSeriesId: { type: Schema.Types.ObjectId, ref: 'TestSeries', required: true },
    /** Amount in the smallest currency unit (paise). */
    amount: { type: Number, required: true, min: 0 },
    currency: { type: String, default: 'INR', uppercase: true, maxlength: 3 },
    orderStatus: { type: String, enum: ORDER_STATUSES, default: 'created' },
    paymentProvider: { type: String, enum: ['razorpay'], default: 'razorpay' },
    providerOrderId: { type: String, required: true },
    receipt: { type: String, required: true },
    paidAt: { type: Date, default: null },
  },
  { timestamps: true },
);

orderSchema.index({ providerOrderId: 1 }, { unique: true });
orderSchema.index({ studentId: 1, createdAt: -1 });
orderSchema.index({ orderStatus: 1, createdAt: -1 });

export type Order = InferSchemaType<typeof orderSchema>;
export type OrderDocument = HydratedDocument<Order>;
export const OrderModel = model('Order', orderSchema);
