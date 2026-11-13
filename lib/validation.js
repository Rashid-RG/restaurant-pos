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
  customerPhone: z.string().min(1, 'Customer phone number is required').max(20),
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
  username: z.string().min(1, 'Username is required').max(50),
  password: z.string().min(1, 'Password is required').max(72),
  expectedTenantId: z.string().trim().min(1).max(200).optional()
});

export const shiftOpenSchema = z.object({
  startFloat: z.coerce.number().nonnegative(),
  notes: z.string().optional()
});

export const shiftCloseSchema = z.object({
  actualCash: z.coerce.number().nonnegative(),
  notes: z.string().optional()
});

export const cashMovementSchema = z.object({
  type: z.enum(['cash_in', 'cash_out']),
  amount: z.coerce.number().positive('Amount must be greater than 0'),
  reason: z.string().optional()
});

// ── Phase 6: schemas matching real request bodies. All use .passthrough() so
// unknown fields the handlers read are preserved (zod strips by default). Only
// genuinely-required fields are enforced, to avoid rejecting valid requests. ──

// Public online order (POST /api/public/orders). Items carry menuItemId|id + qty;
// the server re-prices everything, so we only validate shape + required contact.
export const publicOrderSchema = z.object({
  items: z.array(z.object({
    menuItemId: z.string().optional(),
    id: z.string().optional(),
    quantity: z.coerce.number().int().positive('Quantity must be greater than 0').max(1000),
    selectedModifiers: z.array(z.any()).optional(),
    notes: z.string().optional()
  }).passthrough().refine(item => Boolean(item.id || item.menuItemId), 'An item ID is required')).min(1, 'Order must contain at least one item').max(100),
  customerName: z.string().min(1, 'Customer name is required'),
  customerPhone: z.string().min(1, 'Customer phone number is required').max(20)
}).passthrough();

// Staff user creation (POST /api/users).
export const userCreateSchema = z.object({
  username: z.string().min(1, 'Username is required').max(50),
  role: z.enum(['owner', 'manager', 'cashier', 'kitchen', 'staff']),
  pin: z.string().regex(/^\d{4,8}$/, 'PIN must contain 4 to 8 digits').optional(),
  password: z.string().min(8).max(72).optional()
}).passthrough();

// Driver login (POST /api/driver/auth/login).
export const driverLoginSchema = z.object({
  phone: z.string().min(1, 'Phone is required').max(20),
  password: z.string().min(1, 'Password is required').max(72)
}).passthrough();

// Driver self-registration (POST /api/public/drivers/register).
export const driverRegisterSchema = z.object({
  name: z.string().min(1, 'Full name is required'),
  phone: z.string().min(1, 'Phone is required').max(20),
  password: z.string().min(6, 'Password must be at least 6 characters').max(72),
  email: z.string().email().nullable().optional(),
  vehicleType: z.string().optional(),
  plateNumber: z.string().optional()
}).passthrough();

// SaaS tenant provisioning (POST /api/saas/tenants).
export const tenantCreateSchema = z.object({
  name: z.string().min(1, 'Name is required'),
  subdomain: z.string().min(1, 'Subdomain is required'),
  ownerEmail: z.string().email('A valid owner email is required')
}).passthrough();

export const validateRequest = (schema) => (req, res, next) => {
  try {
    req.body = schema.parse(req.body);
    next();
  } catch (err) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ error: 'Validation Error', details: err.issues });
    }
    next(err);
  }
};
