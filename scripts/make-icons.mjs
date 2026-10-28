// Draws the app icons (a white "W" on the brand teal) as PNGs, with no image library:
// supersampled shapes, then a minimal PNG encoder. Run: node scripts/make-icons.mjs
import { writeFileSync, mkdirSync } from 'node:fs';
import { deflateSync } from 'node:zlib';

const OUT = new URL('../apps/web/public/', import.meta.url);
const BRAND = [14, 134, 115];
const WHITE = [255, 255, 255];
// The "W" as a polyline in a unit square, and its stroke width.
const W = [
  [0.24, 0.32],
  [0.37, 0.7],
  [0.5, 0.42],
  [0.63, 0.7],
  [0.76, 0.32],
];
const STROKE = 0.085;

function distToSegment(px, py, [ax, ay], [bx, by]) {
  const dx = bx - ax;
  const dy = by - ay;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

/** Inside a rounded square of corner radius r (unit coordinates), or everywhere for full bleed. */
function inBackground(x, y, r) {
  if (r === 0) return true;
  const cx = Math.min(Math.max(x, r), 1 - r);
  const cy = Math.min(Math.max(y, r), 1 - r);
  return Math.hypot(x - cx, y - cy) <= r;
}

/** `scale` shrinks the glyph toward the centre (maskable icons keep a safe zone). */
function draw(size, { radius, scale }) {
  const px = Buffer.alloc(size * size * 4);
  const N = 4; // 4×4 samples per pixel
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let bg = 0;
      let fg = 0;
      for (let sy = 0; sy < N; sy++) {
        for (let sx = 0; sx < N; sx++) {
          const u = (x + (sx + 0.5) / N) / size;
          const v = (y + (sy + 0.5) / N) / size;
          if (!inBackground(u, v, radius)) continue;
          bg++;
          const gu = 0.5 + (u - 0.5) / scale;
          const gv = 0.5 + (v - 0.5) / scale;
          let d = Infinity;
          for (let i = 0; i < W.length - 1; i++) d = Math.min(d, distToSegment(gu, gv, W[i], W[i + 1]));
          if (d <= STROKE / 2) fg++;
        }
      }
      const total = N * N;
      const o = (y * size + x) * 4;
      const a = bg / total;
      const f = bg ? fg / bg : 0;
      for (let c = 0; c < 3; c++) px[o + c] = Math.round(BRAND[c] * (1 - f) + WHITE[c] * f);
      px[o + 3] = Math.round(a * 255);
    }
  }
  return png(size, size, px);
}

function crc32(buf) {
  let c = ~0;
  for (const b of buf) {
    c ^= b;
    for (let k = 0; k < 8; k++) c = c & 1 ? (c >>> 1) ^ 0xedb88320 : c >>> 1;
  }
  return ~c >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}

function png(w, h, rgba) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(w, 0);
  header.writeUInt32BE(h, 4);
  header[8] = 8; // bit depth
  header[9] = 6; // RGBA
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 4 + 1)] = 0; // no filter
    rgba.copy(raw, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4);
  }
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}

mkdirSync(OUT, { recursive: true });
const files = {
  'icon-192.png': draw(192, { radius: 0.2, scale: 1 }),
  'icon-512.png': draw(512, { radius: 0.2, scale: 1 }),
  // Full bleed with the glyph inside the 80% safe zone, for launchers that mask icons.
  'icon-maskable-512.png': draw(512, { radius: 0, scale: 0.78 }),
  // iOS rounds the corners itself.
  'apple-touch-icon.png': draw(180, { radius: 0, scale: 0.9 }),
};
for (const [name, data] of Object.entries(files)) {
  writeFileSync(new URL(name, OUT), data);
  console.log(`wrote apps/web/public/${name} (${data.length} bytes)`);
}
