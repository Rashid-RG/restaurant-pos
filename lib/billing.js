/**
 * lib/billing.js — Server-authoritative billing engine for GastroFlow POS.
 *
 * The key design rule: the server is always authoritative on money. Clients
 * send intent (item IDs, quantities, modifier IDs, promo code, tip); this
 * module prices everything from the database. Never trust a client amount.
 *
 * DB helpers are injected ({ dbGet, dbAll }) so this module is fully unit-testable
 * without a running SQLite process — tests pass mock implementations.
 */

/**
 * Resolve items + modifiers from the DB, apply all discount/charge/tax/tip logic,
 * and return a fully-priced bill. Throws on invalid items, stock shortage,
 * invalid promo codes, or minimum-spend violations.
 *
 * @param {Object} deps               - Injected DB helpers { dbGet, dbAll }
 * @param {Array}  items              - Cart items [{ menuItemId|id, quantity, selectedModifiers? }]
 * @param {string|null} discountType  - 'percent' | 'flat' | null
 * @param {number} discountValue      - discount magnitude (0 = none)
 * @param {number} loyaltyPointsToRedeem - loyalty points (100 pts = 1 LKR)
 * @param {number} tip                - tip amount in LKR (clamped to ≥0)
 * @param {string|null} promoCode     - promotional code string or null
 * @param {number} deliveryFee        - flat delivery fee in LKR (0 for non-delivery)
 * @returns {Promise<Object>} Fully priced bill object
 */
export async function resolveAndCalculateBill(
  { dbGet },
  items,
  discountType,
  discountValue,
  loyaltyPointsToRedeem,
  tip = 0,
  promoCode = null,
  deliveryFee = 0
) {
  let subtotal = 0;
  const resolvedItems = [];

  for (const item of items) {
    const dbItem = await dbGet('SELECT * FROM menu_items WHERE id = ?', [item.menuItemId || item.id]);
    if (!dbItem) {
      throw new Error(`Menu item not found: ${item.menuItemId || item.id}`);
    }
    if (dbItem.stock < item.quantity) {
      throw new Error(`Insufficient stock for item: ${dbItem.name} (Only ${dbItem.stock} left)`);
    }

    // Resolve modifiers — always fetched from DB to prevent client price spoofing
    let modifiersCost = 0;
    const resolvedMods = [];
    if (item.selectedModifiers && Array.isArray(item.selectedModifiers)) {
      for (const modSelection of item.selectedModifiers) {
        const dbMod = await dbGet(
          'SELECT id, name, priceDelta FROM modifiers WHERE id = ? AND menuItemId = ?',
          [modSelection.id, dbItem.id]
        );
        if (dbMod) {
          modifiersCost += dbMod.priceDelta;
          resolvedMods.push({
            id: dbMod.id,
            name: dbMod.name,
            priceDelta: dbMod.priceDelta
          });
        }
      }
    }

    const unitPrice = dbItem.price + modifiersCost;
    const lineTotal = unitPrice * item.quantity;
    subtotal += lineTotal;

    resolvedItems.push({
      id: dbItem.id,
      name: dbItem.name,
      price: dbItem.price,
      cost: dbItem.cost,
      quantity: item.quantity,
      notes: item.notes || '',
      selectedModifiers: resolvedMods,
      unitPrice,
      lineTotal
    });
  }

  // --- Regular (staff-applied) discount ---
  let discount = 0;
  const dValue = parseFloat(discountValue) || 0;
  if (discountType === 'percent') {
    discount = (subtotal * dValue) / 100;
  } else if (discountType === 'flat') {
    discount = dValue;
  }
  discount = Math.min(discount, subtotal); // cannot exceed subtotal

  // --- Promo code discount ---
  let promoDiscount = 0;
  let appliedPromoCode = null;
  if (promoCode) {
    const promo = await dbGet(
      'SELECT * FROM promotions WHERE code = ? AND isActive = 1',
      [promoCode.toUpperCase()]
    );
    if (promo) {
      if (subtotal >= promo.minSpend) {
        if (promo.type === 'percent') {
          promoDiscount = (subtotal * promo.value) / 100;
        } else if (promo.type === 'flat') {
          promoDiscount = promo.value;
        }
        appliedPromoCode = promo.code;
      } else {
        throw new Error(`Minimum spend of Rs. ${promo.minSpend} required for promo code ${promoCode}.`);
      }
    } else {
      throw new Error(`Invalid or expired promo code: ${promoCode}`);
    }
  }

  // --- Loyalty discount (100 points = 1 LKR) ---
  let loyaltyDiscount = 0;
  if (loyaltyPointsToRedeem && loyaltyPointsToRedeem > 0) {
    loyaltyDiscount = Math.floor(loyaltyPointsToRedeem / 100);
  }

  // Total discount cannot exceed subtotal
  const totalDiscount = Math.min(discount + promoDiscount + loyaltyDiscount, subtotal);

  // --- Service charge (fetched from settings) ---
  const serviceChargeSetting = await dbGet('SELECT value FROM settings WHERE key = "serviceChargeRate"');
  const serviceChargeRate = parseFloat(serviceChargeSetting?.value || 0);
  const serviceCharge = ((subtotal - totalDiscount) * serviceChargeRate) / 100;

  // --- Tax (fetched from settings) ---
  const taxRateSetting = await dbGet('SELECT value FROM settings WHERE key = "taxRate"');
  const taxRate = parseFloat(taxRateSetting?.value || 0);
  const tax = ((subtotal - totalDiscount + serviceCharge) * taxRate) / 100;

  // --- Tip (clamped to non-negative) ---
  const tipAmount = Math.max(0, parseFloat(tip) || 0);

  // --- Final total (LKR rounding: round to nearest whole unit) ---
  const rawTotal =
    subtotal - totalDiscount + serviceCharge + tax + tipAmount + parseFloat(deliveryFee || 0);
  const total = Math.round(rawTotal);
  const roundedAmount = parseFloat((total - rawTotal).toFixed(2));

  return {
    resolvedItems,
    subtotal: parseFloat(subtotal.toFixed(2)),
    discount: parseFloat(discount.toFixed(2)),
    promoDiscount: parseFloat(promoDiscount.toFixed(2)),
    loyaltyDiscount: parseFloat(loyaltyDiscount.toFixed(2)),
    totalDiscount: parseFloat(totalDiscount.toFixed(2)),
    appliedPromoCode,
    serviceCharge: parseFloat(serviceCharge.toFixed(2)),
    tax: parseFloat(tax.toFixed(2)),
    tip: parseFloat(tipAmount.toFixed(2)),
    roundedAmount,
    total
  };
}

/**
 * Allocate the next gapless fiscal invoice number.
 * MUST be called inside an already-open transaction so the increment and the
 * order settlement commit atomically — guaranteeing the sequence is gapless
 * and never reused.
 *
 * @param {Object} deps - Injected DB helpers { dbGet, dbRun }
 * @returns {Promise<number>} The newly allocated invoice number
 */
export async function allocateInvoiceNumber({ dbGet, dbRun }) {
  await dbRun('UPDATE invoice_counter SET lastNumber = lastNumber + 1 WHERE id = 1');
  const row = await dbGet('SELECT lastNumber FROM invoice_counter WHERE id = 1');
  return row.lastNumber;
}
