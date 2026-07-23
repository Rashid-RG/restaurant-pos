/**
 * lib/printer.js — ESC/POS Thermal Receipt Engine & Network Printer Spooler
 *
 * Supports raw ESC/POS byte generation for 80mm and 58mm thermal printers
 * and direct TCP network socket printing (port 9100) for kitchen/receipt printers.
 */
import net from 'net';

// ESC/POS Command Constants
export const ESC = '\x1B';
export const GS = '\x1D';

export const COMMANDS = {
  RESET: `${ESC}@`,
  TEXT_NORMAL: `${ESC}!`,
  TEXT_BOLD_ON: `${ESC}E\x01`,
  TEXT_BOLD_OFF: `${ESC}E\x00`,
  TEXT_DOUBLE_HEIGHT: `${ESC}!`,
  ALIGN_LEFT: `${ESC}a\x00`,
  ALIGN_CENTER: `${ESC}a\x01`,
  ALIGN_RIGHT: `${ESC}a\x02`,
  CUT_FULL: `${GS}V\x00`,
  CUT_PARTIAL: `${GS}V\x01`,
  DRAWER_KICK: `${ESC}p\x00\x19\xFA`, // Pin 2 kick
  LINE_FEED: '\n'
};

/**
 * Format a clean ESC/POS thermal receipt buffer.
 */
export function buildEscPosReceipt({
  restaurantName = 'GastroFlow Bistro',
  address = 'Colombo, Sri Lanka',
  phone = '+94 11 234 5678',
  orderId,
  invoiceNumber,
  orderType = 'dine_in',
  tableName,
  customerName,
  items = [],
  subtotal = 0,
  tax = 0,
  serviceCharge = 0,
  deliveryFee = 0,
  discount = 0,
  total = 0,
  paymentMethod = 'Cash',
  timestamp = Date.now(),
  paperWidth = 80 // 80mm = ~48 chars, 58mm = ~32 chars
}) {
  const lineLen = paperWidth === 58 ? 32 : 48;
  const divider = '-'.repeat(lineLen);
  const doubleDivider = '='.repeat(lineLen);

  const padBoth = (str, len) => {
    const space = Math.max(0, len - str.length);
    const left = Math.floor(space / 2);
    const right = space - left;
    return ' '.repeat(left) + str + ' '.repeat(right);
  };

  const padRow = (left, right, len) => {
    const space = Math.max(1, len - left.length - right.length);
    return left + ' '.repeat(space) + right;
  };

  let out = '';
  out += COMMANDS.RESET;
  out += COMMANDS.ALIGN_CENTER;
  out += COMMANDS.TEXT_BOLD_ON;
  out += `${restaurantName.toUpperCase()}\n`;
  out += COMMANDS.TEXT_BOLD_OFF;
  out += `${address}\nTel: ${phone}\n`;
  out += `${divider}\n`;

  out += COMMANDS.ALIGN_LEFT;
  out += `Order #: ${orderId}\n`;
  if (invoiceNumber) out += `Invoice: INV-${String(invoiceNumber).padStart(6, '0')}\n`;
  out += `Type: ${orderType.toUpperCase()}${tableName ? ` | Table: ${tableName}` : ''}\n`;
  if (customerName) out += `Customer: ${customerName}\n`;
  out += `Date: ${new Date(timestamp).toLocaleString()}\n`;
  out += `${divider}\n`;

  out += padRow('QTY ITEM', 'AMOUNT (LKR)', lineLen) + '\n';
  out += `${divider}\n`;

  for (const item of items) {
    const itemTitle = `${item.quantity}x ${item.name || item.menuItemId}`;
    const priceStr = (Number(item.price || 0) * Number(item.quantity || 1)).toFixed(2);
    out += padRow(itemTitle.slice(0, lineLen - priceStr.length - 2), priceStr, lineLen) + '\n';

    if (item.modifiers && item.modifiers.length > 0) {
      for (const mod of item.modifiers) {
        out += `   + ${mod.name} (+LKR ${Number(mod.priceDelta || 0).toFixed(2)})\n`;
      }
    }
  }

  out += `${divider}\n`;
  out += padRow('Subtotal:', subtotal.toFixed(2), lineLen) + '\n';
  if (tax > 0) out += padRow('Tax:', tax.toFixed(2), lineLen) + '\n';
  if (serviceCharge > 0) out += padRow('Service Charge:', serviceCharge.toFixed(2), lineLen) + '\n';
  if (deliveryFee > 0) out += padRow('Delivery Fee:', deliveryFee.toFixed(2), lineLen) + '\n';
  if (discount > 0) out += padRow('Discount:', `-${discount.toFixed(2)}`, lineLen) + '\n';
  out += `${doubleDivider}\n`;

  out += COMMANDS.TEXT_BOLD_ON;
  out += padRow('TOTAL:', `LKR ${total.toFixed(2)}`, lineLen) + '\n';
  out += COMMANDS.TEXT_BOLD_OFF;
  out += padRow('Payment Method:', paymentMethod.toUpperCase(), lineLen) + '\n';
  out += `${doubleDivider}\n`;

  out += COMMANDS.ALIGN_CENTER;
  out += 'Thank you for dining with us!\n';
  out += padBoth('Powered by GastroFlow POS', lineLen) + '\n\n\n';

  out += COMMANDS.CUT_PARTIAL;
  out += COMMANDS.DRAWER_KICK;

  return Buffer.from(out, 'binary');
}

/**
 * Print ESC/POS payload directly over TCP network socket to thermal printer IP.
 */
export function sendToNetworkPrinter(ip, port = 9100, dataBuffer) {
  return new Promise((resolve, reject) => {
    const client = new net.Socket();
    client.setTimeout(5000);

    client.connect(port, ip, () => {
      client.write(dataBuffer, () => {
        client.end();
        resolve({ success: true, message: `Printed successfully to ${ip}:${port}` });
      });
    });

    client.on('error', (err) => {
      client.destroy();
      reject(new Error(`Network printer error (${ip}:${port}): ${err.message}`));
    });

    client.on('timeout', () => {
      client.destroy();
      reject(new Error(`Connection to network printer ${ip}:${port} timed out.`));
    });
  });
}
