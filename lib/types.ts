export interface MenuItem {
  id: string;
  name: string;
  price: number;
  cost?: number;
  category: string;
  emoji?: string;
  stock: number;
  minStock?: number;
  description?: string;
  imageUrl?: string;
  dietaryTags?: string;
  isAvailable?: number;
}

export interface OrderItem {
  id: string;
  orderId: string;
  menuItemId: string;
  name: string;
  price: number;
  quantity: number;
  notes?: string;
}

export interface BillCalculationResult {
  resolvedItems: Array<{
    id: string;
    name: string;
    unitPrice: number;
    quantity: number;
    notes?: string;
    itemTotal: number;
  }>;
  subtotal: number;
  discountType: 'percent' | 'flat' | 'promo' | 'loyalty' | null;
  discountValue: number;
  appliedPromoCode?: string | null;
  promoDiscount: number;
  loyaltyDiscount: number;
  totalDiscount: number;
  serviceCharge: number;
  tax: number;
  deliveryFee: number;
  tip: number;
  total: number;
  roundedAmount: number;
}

export interface Table {
  id: string;
  number: string;
  capacity: number;
  status: 'free' | 'occupied' | 'billing';
  currentOrderId?: string | null;
}

export interface Shift {
  id: string;
  userId: string;
  username: string;
  startTime: number;
  endTime?: number;
  startFloat: number;
  endFloat?: number;
  actualCash?: number;
  expectedCash?: number;
  status: 'open' | 'closed';
  notes?: string;
}
