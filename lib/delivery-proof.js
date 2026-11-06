import crypto from 'node:crypto';

// Bounded raster data only. Never accept SVG, HTML, remote URLs or file paths.
export function validateProofImage(value, kind) {
  if (value == null || value === '') return null;
  const maxBytes = kind === 'signature' ? 128 * 1024 : 512 * 1024;
  if (typeof value !== 'string' || value.length > Math.ceil(maxBytes / 3) * 4 + 32) {
    throw new Error(`${kind} is too large.`);
  }
  const match = /^data:image\/(png|jpeg);base64,([A-Za-z0-9+/]+={0,2})$/.exec(value);
  if (!match) throw new Error(`${kind} must be a PNG or JPEG image.`);
  const bytes = Buffer.from(match[2], 'base64');
  if (bytes.length > maxBytes || bytes.toString('base64') !== match[2]) throw new Error(`Invalid ${kind} encoding.`);
  let width = 0, height = 0;
  if (match[1] === 'png') {
    if (bytes.length < 45 || !bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10])) || bytes.readUInt32BE(8) !== 13 || bytes.toString('ascii', 12, 16) !== 'IHDR' || bytes.toString('ascii', bytes.length - 8, bytes.length - 4) !== 'IEND') throw new Error(`Invalid ${kind} image.`);
    width = bytes.readUInt32BE(16); height = bytes.readUInt32BE(20);
  } else {
    if (bytes.length < 4 || bytes.readUInt16BE(0) !== 0xffd8 || bytes.readUInt16BE(bytes.length - 2) !== 0xffd9) throw new Error(`Invalid ${kind} image.`);
    let offset = 2;
    while (offset + 4 < bytes.length) {
      if (bytes[offset++] !== 0xff) break;
      while (bytes[offset] === 0xff) offset++;
      const marker = bytes[offset++];
      if (marker === 0xda || marker === 0xd9) break;
      const length = bytes.readUInt16BE(offset);
      if (length < 2 || offset + length > bytes.length) break;
      if ([0xc0,0xc1,0xc2].includes(marker) && length >= 8) {
        height = bytes.readUInt16BE(offset + 3); width = bytes.readUInt16BE(offset + 5); break;
      }
      offset += length;
    }
  }
  if (width < 1 || height < 1 || width > 2048 || height > 2048) throw new Error(`${kind} dimensions must be between 1 and 2048 pixels.`);
  return { data: value, sha256: crypto.createHash('sha256').update(bytes).digest('hex') };
}

export function validateDeliveryProof(body) {
  const signature = validateProofImage(body.signature, 'signature');
  const photo = validateProofImage(body.deliveryPhoto, 'photo');
  if (!signature && !photo) throw new Error('Add a customer signature or delivery photo before confirming delivery.');
  return { signature, photo };
}
