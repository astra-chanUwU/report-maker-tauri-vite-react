/**
 * Tiny pure-JS raster helpers (Bresenham lines + PNG encoder).
 *
 * Lives apart from `generateDocx.ts` so trend rendering (`trends.ts`)
 * doesn't drag the `docx` bundle into the main chunk — export-card
 * lazy-loads `generateDocx`, and this module keeps that split effective.
 */

export function setPixel(
  buf: Uint8Array,
  w: number,
  h: number,
  x: number,
  y: number,
  r: number,
  g: number,
  b: number
) {
  if (x < 0 || y < 0 || x >= w || y >= h) return;
  const i = (y * w + x) * 3;
  buf[i] = r;
  buf[i + 1] = g;
  buf[i + 2] = b;
}

export function line(
  buf: Uint8Array,
  w: number,
  h: number,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  rgb: [number, number, number]
) {
  const dx = Math.abs(x1 - x0);
  const dy = -Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1;
  const sy = y0 < y1 ? 1 : -1;
  let err = dx + dy;
  let x = x0;
  let y = y0;
  for (;;) {
    setPixel(buf, w, h, x, y, rgb[0], rgb[1], rgb[2]);
    if (x === x1 && y === y1) break;
    const e2 = 2 * err;
    if (e2 >= dy) {
      err += dy;
      x += sx;
    }
    if (e2 <= dx) {
      err += dx;
      y += sy;
    }
  }
}

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function adler32(bytes: Uint8Array): number {
  let a = 1;
  let b = 0;
  for (let i = 0; i < bytes.length; i++) {
    a = (a + bytes[i]) % 65521;
    b = (b + a) % 65521;
  }
  return ((b << 16) | a) >>> 0;
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  const crc = crc32(out.subarray(4, 8 + data.length));
  view.setUint32(8 + data.length, crc);
  return out;
}

/** Pure-JS PNG encoder (single IDAT, stored deflate — no zlib dep, WebView-safe). */
export function encodePng(rgb: Uint8Array, width: number, height: number): Uint8Array {
  const stride = width * 3;
  const raw = new Uint8Array((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0;
    raw.set(rgb.subarray(y * stride, (y + 1) * stride), y * (stride + 1) + 1);
  }
  // zlib wrapper with stored (uncompressed) blocks
  const blocks: number[] = [0x78, 0x01];
  let pos = 0;
  while (pos < raw.length) {
    const n = Math.min(65535, raw.length - pos);
    const final = pos + n >= raw.length ? 1 : 0;
    blocks.push(final); // BFINAL + BTYPE 00
    blocks.push(n & 0xff, (n >>> 8) & 0xff, ~n & 0xff, (~n >>> 8) & 0xff);
    for (let i = 0; i < n; i++) blocks.push(raw[pos + i]);
    pos += n;
  }
  const ad = adler32(raw);
  blocks.push((ad >>> 24) & 0xff, (ad >>> 16) & 0xff, (ad >>> 8) & 0xff, ad & 0xff);
  const zlib = new Uint8Array(blocks);

  const ihdr = new Uint8Array(13);
  const iv = new DataView(ihdr.buffer);
  iv.setUint32(0, width);
  iv.setUint32(4, height);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // truecolor RGB
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const sig = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
  const parts = [sig, chunk("IHDR", ihdr), chunk("IDAT", zlib), chunk("IEND", new Uint8Array(0))];
  const total = parts.reduce((a, p) => a + p.length, 0);
  const out = new Uint8Array(total);
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

/** 5×7 glyphs for peak frequency labels (no canvas dependency). */
const GLYPH: Record<string, number[]> = {
  "0": [0b01110, 0b10001, 0b10011, 0b10101, 0b11001, 0b10001, 0b01110],
  "1": [0b00100, 0b01100, 0b00100, 0b00100, 0b00100, 0b00100, 0b01110],
  "2": [0b01110, 0b10001, 0b00001, 0b00010, 0b00100, 0b01000, 0b11111],
  "3": [0b11110, 0b00001, 0b00001, 0b01110, 0b00001, 0b00001, 0b11110],
  "4": [0b00010, 0b00110, 0b01010, 0b10010, 0b11111, 0b00010, 0b00010],
  "5": [0b11111, 0b10000, 0b11110, 0b00001, 0b00001, 0b10001, 0b01110],
  "6": [0b00110, 0b01000, 0b10000, 0b11110, 0b10001, 0b10001, 0b01110],
  "7": [0b11111, 0b00001, 0b00010, 0b00100, 0b01000, 0b01000, 0b01000],
  "8": [0b01110, 0b10001, 0b10001, 0b01110, 0b10001, 0b10001, 0b01110],
  "9": [0b01110, 0b10001, 0b10001, 0b01111, 0b00001, 0b00010, 0b01100],
  ".": [0b00000, 0b00000, 0b00000, 0b00000, 0b00000, 0b01100, 0b01100],
  "-": [0b00000, 0b00000, 0b00000, 0b11111, 0b00000, 0b00000, 0b00000],
  " ": [0b00000, 0b00000, 0b00000, 0b00000, 0b00000, 0b00000, 0b00000],
};

/** Draw a short ASCII label (digits, dot, minus). Returns pixel width used. */
export function drawText(
  buf: Uint8Array,
  w: number,
  h: number,
  x: number,
  y: number,
  text: string,
  rgb: [number, number, number],
  scale = 1
): number {
  let cx = x;
  for (const ch of text) {
    const g = GLYPH[ch] ?? GLYPH[" "];
    for (let row = 0; row < 7; row++) {
      const bits = g[row] ?? 0;
      for (let col = 0; col < 5; col++) {
        if ((bits & (1 << (4 - col))) === 0) continue;
        for (let sy = 0; sy < scale; sy++)
          for (let sx = 0; sx < scale; sx++)
            setPixel(buf, w, h, cx + col * scale + sx, y + row * scale + sy, rgb[0], rgb[1], rgb[2]);
      }
    }
    cx += (5 + 1) * scale;
  }
  return cx - x;
}

/** Solid rectangle. */
export function fillRect(
  buf: Uint8Array,
  w: number,
  h: number,
  x: number,
  y: number,
  rw: number,
  rh: number,
  rgb: [number, number, number]
) {
  for (let yy = y; yy < y + rh; yy++)
    for (let xx = x; xx < x + rw; xx++) setPixel(buf, w, h, xx, yy, rgb[0], rgb[1], rgb[2]);
}

/** Brochure-style peak callout: leader line, red box, light digits. */
export function drawCallout(
  buf: Uint8Array,
  w: number,
  h: number,
  x: number,
  y: number,
  text: string,
  lift = 28
) {
  const scale = 2;
  const tw = Math.max(1, text.length) * (5 + 1) * scale;
  const th = 7 * scale;
  const boxW = tw + 8;
  const boxH = th + 6;
  let bx = Math.round(x - boxW / 2);
  let by = Math.round(y - lift - boxH);
  if (bx < 2) bx = 2;
  if (bx + boxW > w - 2) bx = w - 2 - boxW;
  if (by < 2) by = Math.min(h - boxH - 2, y + 8);
  const red: [number, number, number] = [220, 38, 38];
  line(buf, w, h, x, y, bx + boxW / 2, by + boxH, red);
  fillRect(buf, w, h, bx, by, boxW, boxH, red);
  drawText(buf, w, h, bx + 4, by + 3, text, [255, 255, 255], scale);
}
