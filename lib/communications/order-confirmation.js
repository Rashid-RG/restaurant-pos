/**
 * Best-effort order receipt notifications.
 *
 * Database and messaging adapters are injected by the server. This function
 * never opens a transaction and keeps the existing email/SMS failure behavior:
 * an email failure is logged, and a later SMS failure is swallowed by the
 * outer catch so successful payment settlement is not rolled back.
 */
export function createOrderConfirmationSender({
  getSettingAny, dbAll, customerAppUrl, buildOrderConfirmationEmail,
  sendEmail, sendSms, logger = console
}) {
  for (const [name, dependency] of Object.entries({
    getSettingAny, dbAll, customerAppUrl, buildOrderConfirmationEmail, sendEmail, sendSms
  })) {
    if (typeof dependency !== 'function') throw new TypeError(`Order confirmation requires ${name}`);
  }
  return async function sendOrderConfirmation(order) {
    try {
      const business = await getSettingAny(order.tenant_id || 'default_tenant', ['businessName', 'restaurantName'], 'GastroFlow');
      const inv = order.invoiceNumber ? `INV-${String(order.invoiceNumber).padStart(6, '0')}` : order.id;
      const total = Number(order.total || 0).toFixed(2);
      const email = order.customerEmail;
      const phone = order.customerPhone;
      const trackUrl = `${customerAppUrl()}/?track=${order.id}`;

      // Retains the existing order-items query and email receipt schema.
      const items = await dbAll('SELECT name, quantity, price FROM order_items WHERE orderId = ?', [order.id]);
      if (email) {
        const orderConfirmHtml = buildOrderConfirmationEmail({
          order, invoiceNumber: inv, items, businessName: business, trackingUrl: trackUrl
        });
        await sendEmail({
          to: email,
          subject: `GastroFlow · Order received from ${business} (${inv})`,
          html: orderConfirmHtml
        }).catch(e => logger.error('[EMAIL] Order confirmation email failed:', e.message));
      }
      if (phone) {
        await sendSms({
          to: phone,
          message: `${business}: Order ${inv} confirmed! Total: LKR ${total}. Track: ${trackUrl}`
        });
      }
    } catch (e) {
      logger.error('sendOrderConfirmation error:', e.message);
    }
  };
}
