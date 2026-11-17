/**
 * Optional workstation-only direct thermal printing (QZ Tray + ESC/POS).
 * Nothing is installed or enabled for existing restaurants automatically.
 * QZ Tray runs on the cashier's computer; print data never goes to our server.
 *
 * PILOT: unsigned QZ connections show security prompts. Do not claim unattended
 * silent printing or physical cut confirmation until code signing and hardware
 * certification have been completed.
 */
import { buildStandaloneReceiptDocument, resolvePrinterPaperSize } from './printer.js';

const CONFIG_PREFIX = 'gastroflow_native_escpos_v1:';
const QZ_JS = 'https://cdn.jsdelivr.net/npm/qz-tray@2.3.0/qz-tray.min.js';
let loadingQz = null;

function tenantKey(tenantId) {
  if (!tenantId || typeof tenantId !== 'string') return null;
  return CONFIG_PREFIX + tenantId;
}

export function getNativePrinterConfig(tenantId) {
  const key = tenantKey(tenantId);
  if (!key || typeof window === 'undefined') return { enabled: false, printerName: '', cut: true };
  try {
    const value = JSON.parse(window.localStorage?.getItem(key) || '{}');
    return {
      enabled: value.enabled === true && typeof value.printerName === 'string' && value.printerName.length > 0,
      printerName: typeof value.printerName === 'string' ? value.printerName : '',
      cut: value.cut !== false
    };
  } catch (_) {
    return { enabled: false, printerName: '', cut: true };
  }
}

export function saveNativePrinterConfig(tenantId, config) {
  const key = tenantKey(tenantId);
  if (!key || typeof window === 'undefined') throw new Error('A restaurant must be selected to configure a printer.');
  const printerName = String(config.printerName || '').trim();
  if (config.enabled && !printerName) throw new Error('Choose a confirmed Windows printer first.');
  const next = { enabled: Boolean(config.enabled), printerName, cut: config.cut !== false };
  window.localStorage?.setItem(key, JSON.stringify(next));
  return next;
}

export function isNativePrintingEnabled(tenantId) {
  return getNativePrinterConfig(tenantId).enabled;
}

export function loadQzTray() {
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    return Promise.reject(new Error('Direct printing requires a Windows browser.'));
  }
  if (window.qz?.websocket && window.qz?.print) return Promise.resolve(window.qz);
  if (loadingQz) return loadingQz;
  // This script is fetched only after a workstation opts in. Future commercial
  // release should self-host a reviewed and integrity-pinned version.
  loadingQz = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = QZ_JS;
    script.async = true;
    script.crossOrigin = 'anonymous';
    script.referrerPolicy = 'no-referrer';
    const timer = setTimeout(() => reject(new Error('QZ Tray browser library did not load. Check the network.')), 12000);
    script.onload = () => {
      clearTimeout(timer);
      if (window.qz?.websocket && window.qz?.print) resolve(window.qz);
      else reject(new Error('QZ Tray browser library is unavailable.'));
    };
    script.onerror = () => {
      clearTimeout(timer);
      reject(new Error('Could not load the QZ Tray printing library.'));
    };
    document.head.appendChild(script);
  }).catch(error => {
    loadingQz = null;
    throw error;
  });
  return loadingQz;
}

export async function connectNativePrinter() {
  const qz = await loadQzTray();
  if (!qz.websocket.isActive()) {
    await qz.websocket.connect({ retries: 1, delay: 1 });
  }
  if (!qz.websocket.isActive()) throw new Error('QZ Tray is not connected. Start QZ Tray on this Windows computer.');
  return qz;
}

export async function listNativePrinters() {
  const qz = await connectNativePrinter();
  const printers = await qz.printers.find();
  return Array.isArray(printers) ? printers : printers ? [printers] : [];
}

/**
 * Sends only the rendered receipt to the local Windows spooler, followed by a
 * two-line feed and an optional ESC/POS full-cut command. No fixed paper length.
 * 'Sent to spooler' does NOT mean the printer has physically completed/cut.
 */
export async function nativePrintReceiptMarkup(markup, { printerName, paperSetting = '80mm', cut = true } = {}) {
  if (!printerName || typeof printerName !== 'string') throw new Error('Select a Windows receipt printer in Settings.');
  if (typeof markup !== 'string' || !markup.trim()) throw new Error('Receipt content is missing.');
  const paper = resolvePrinterPaperSize(paperSetting);
  if (paper === 'a4') throw new Error('ESC/POS printing is for 58 mm or 80 mm thermal receipts, not A4 reports.');
  const qz = await connectNativePrinter();
  const matches = await qz.printers.find();
  if (!Array.isArray(matches) || !matches.includes(printerName)) {
    throw new Error('The selected printer is not available. Reconnect it from GastroFlow Settings.');
  }
  const html = buildStandaloneReceiptDocument(markup, paper);
  const widthInches = paper === '58mm' ? 2.047 : 2.992; // content width (52/76 mm)
  const data = [
    { type: 'raw', format: 'html', flavor: 'plain', data: html,
      options: { language: 'ESCPOS', pageWidth: widthInches } },
    // Only two extra feed lines before cutting, not a 210 mm page tail.
    cut ? '\x1b\x64\x02\x1d\x56\x00' : '\n\n'
  ];
  await qz.print(qz.configs.create(printerName), data);
  return true;
}

export async function nativePrintReceiptElement(tenantId, paperSetting = '80mm', selector = '#receipt-print-root .receipt-print-area') {
  const config = getNativePrinterConfig(tenantId);
  if (!config.enabled) throw new Error('Enable direct printing for this computer in GastroFlow Settings first.');
  if (typeof document === 'undefined') throw new Error('The receipt must be displayed in the browser.');
  const el = document.querySelector(selector);
  if (!el?.outerHTML || !el.textContent?.trim()) throw new Error('Receipt has not finished rendering.');
  const markup = el.classList?.contains('receipt-print-area')
    ? el.outerHTML
    : '<div class="receipt-print-area">' + el.outerHTML + '</div>';
  return nativePrintReceiptMarkup(markup, {
    printerName: config.printerName, paperSetting, cut: config.cut
  });
}

export async function nativePrintTestSlip(printerName, paperSetting = '80mm', cut = true) {
  const markup = '<div class="receipt-print-area"><div class="receipt-center"><h3>GastroFlow</h3><strong>NATIVE PRINT TEST</strong></div><div class="receipt-divider"></div><p>One small test slip</p><p>Paper: ' + (paperSetting === '58mm' ? '58' : '80') + ' mm</p><p>ESC/POS cut test</p></div>';
  return nativePrintReceiptMarkup(markup, { printerName, paperSetting, cut });
}
