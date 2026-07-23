/**
 * lib/aggregators.js — Third-Party Aggregator Webhook Normalizer
 *
 * Normalizes incoming delivery aggregator webhooks (PickMe Food, UberEats, FoodPanda)
 * into GastroFlow's unified order format for immediate KDS display and till tracking.
 */

/**
 * Normalize PickMe Food Webhook Payload
 */
export function normalizePickMeOrder(payload, tenantId = 'default_tenant') {
  const {
    order_id,
    customer,
    items = [],
    pricing = {},
    delivery_info = {}
  } = payload || {};

  if (!order_id || !items.length) {
    throw new Error('Invalid PickMe order payload: order_id and items are required.');
  }

  const mappedItems = items.map(item => ({
    menuItemId: item.item_id || item.id,
    name: item.name || 'PickMe Item',
    price: Number(item.unit_price || item.price || 0),
    quantity: Number(item.quantity || 1),
    modifiers: (item.options || []).map(opt => ({
      name: opt.name,
      priceDelta: Number(opt.price || 0)
    }))
  }));

  const subtotal = Number(pricing.subtotal || mappedItems.reduce((sum, i) => sum + i.price * i.quantity, 0));
  const deliveryFee = Number(pricing.delivery_fee || 0);
  const tax = Number(pricing.tax || 0);
  const total = Number(pricing.total || (subtotal + deliveryFee + tax));

  return {
    orderId: `pickme_${order_id}`,
    source: 'pickme',
    orderType: 'delivery',
    status: 'pending',
    paymentStatus: 'paid', // Aggregators collect money online
    paymentMethod: 'pickme_online',
    customerName: customer?.name || 'PickMe Customer',
    customerPhone: customer?.phone || '0000000000',
    deliveryAddress: delivery_info.address || 'PickMe Delivery',
    items: mappedItems,
    subtotal,
    deliveryFee,
    tax,
    total,
    tenant_id: tenantId,
    timestamp: Date.now()
  };
}

/**
 * Normalize UberEats Webhook Payload
 */
export function normalizeUberEatsOrder(payload, tenantId = 'default_tenant') {
  const {
    id,
    eater,
    cart = {},
    payment = {},
    deliveries = []
  } = payload || {};

  if (!id || !cart.items) {
    throw new Error('Invalid UberEats order payload: id and cart.items are required.');
  }

  const mappedItems = cart.items.map(item => ({
    menuItemId: item.id,
    name: item.title || 'UberEats Item',
    price: Number(item.price?.unit_price?.amount || 0) / 100, // UberEats sends cents
    quantity: Number(item.quantity || 1),
    modifiers: (item.selected_options || []).map(opt => ({
      name: opt.title,
      priceDelta: Number(opt.price?.amount || 0) / 100
    }))
  }));

  const total = Number(payment.charges?.total?.amount || 0) / 100;
  const subtotal = Number(payment.charges?.subtotal?.amount || 0) / 100;
  const tax = Number(payment.charges?.tax?.amount || 0) / 100;

  return {
    orderId: `ubereats_${id}`,
    source: 'ubereats',
    orderType: 'delivery',
    status: 'pending',
    paymentStatus: 'paid',
    paymentMethod: 'ubereats_online',
    customerName: eater ? `${eater.first_name || ''} ${eater.last_name || ''}`.trim() : 'UberEats Customer',
    customerPhone: eater?.phone || '0000000000',
    deliveryAddress: deliveries[0]?.location?.address?.formatted_address || 'UberEats Delivery',
    items: mappedItems,
    subtotal,
    tax,
    total,
    tenant_id: tenantId,
    timestamp: Date.now()
  };
}
