import { z } from 'zod';

export const orderSchema = z.object({
  items: z.array(z.object({
    id: z.string(),
    name: z.string(),
    price: z.number().nonnegative(),
    quantity: z.number().positive(),
    notes: z.string().optional()
  })).min(1, 'Order must contain at least one item'),
  diningType: z.enum(['dine-in', 'takeaway', 'delivery']),
  customerName: z.string().min(1, 'Customer name is required'),
  customerPhone: z.string().min(1, 'Customer phone number is required'),
  customerEmail: z.string().email().nullable().optional(),
  deliveryAddress: z.string().nullable().optional(),
  deliveryLat: z.number().nullable().optional(),
  deliveryLng: z.number().nullable().optional(),
  loyaltyPointsToRedeem: z.number().nonnegative().optional(),
  promoCode: z.string().nullable().optional(),
  scheduledTime: z.number().nullable().optional(),
  tip: z.number().nonnegative().optional(),
  paymentMethod: z.string().optional()
});

export const authLoginSchema = z.object({
  username: z.string().min(1, 'Username is required'),
  password: z.string().min(1, 'Password is required')
});

export const shiftOpenSchema = z.object({
  startFloat: z.number().nonnegative(),
  notes: z.string().optional()
});

export const shiftCloseSchema = z.object({
  actualCash: z.number().nonnegative(),
  notes: z.string().optional()
});

export const cashMovementSchema = z.object({
  type: z.enum(['cash_in', 'cash_out']),
  amount: z.number().positive('Amount must be greater than 0'),
  reason: z.string().optional()
});

export const validateRequest = (schema) => (req, res, next) => {
  try {
    req.body = schema.parse(req.body);
    next();
  } catch (err) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ error: 'Validation Error', details: err.errors });
    }
    next(err);
  }
};
