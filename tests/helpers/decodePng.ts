// tests/helpers/decodePng.ts — minimal PNG decoder for the Terrarium fixtures (M6 step 5) with node:zlib.
// Accepts only what Terrarium serves: 8-bit RGB (colour type 2), no interlace. Concatenates every IDAT,
// inflates, reverses the row filters 0–4 (None, Sub, Up, Average, Paeth) at 3 bytes per pixel and expands
// to RGBA with alpha 255. Matches the browser's createImageBitmap path exactly (M6 step 5).
import { inflateSync } from "node:zlib";

const SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10] as const;
const BYTES_PER_PIXEL = 3;

export interface DecodedPng {
  width: number;
  height: number;
  rgba: Uint8ClampedArray;
}

function chunkType(bytes: Uint8Array, at: number): string {
  return String.fromCharCode(
    bytes[at] ?? 0,
    bytes[at + 1] ?? 0,
    bytes[at + 2] ?? 0,
    bytes[at + 3] ?? 0,
  );
}

function paeth(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  return pb <= pc ? b : c;
}

export function decodePng(bytes: Uint8Array): DecodedPng {
  SIGNATURE.forEach((byte, i) => {
    if (bytes[i] !== byte) throw new Error("decodePng: not a PNG signature");
  });
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let width = 0;
  let height = 0;
  let sawHeader = false;
  const idat: Uint8Array[] = [];
  for (let pos = 8; pos + 12 <= bytes.length; ) {
    const length = view.getUint32(pos);
    const type = chunkType(bytes, pos + 4);
    const data = bytes.subarray(pos + 8, pos + 8 + length);
    if (type === "IHDR") {
      const header = new DataView(data.buffer, data.byteOffset, data.byteLength);
      width = header.getUint32(0);
      height = header.getUint32(4);
      const bitDepth = data[8];
      const colourType = data[9];
      const interlace = data[12];
      if (bitDepth !== 8 || colourType !== 2 || interlace !== 0) {
        throw new Error(
          `decodePng: need bit depth 8, colour type 2, interlace 0; got ${bitDepth}, ${colourType}, ${interlace}`,
        );
      }
      sawHeader = true;
    } else if (type === "IDAT") {
      idat.push(data);
    } else if (type === "IEND") {
      break;
    }
    pos += 12 + length;
  }
  if (!sawHeader) throw new Error("decodePng: no IHDR chunk");
  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * BYTES_PER_PIXEL;
  if (raw.length !== height * (stride + 1)) {
    throw new Error(`decodePng: ${raw.length} inflated bytes, expected ${height * (stride + 1)}`);
  }
  const rgba = new Uint8ClampedArray(width * height * 4);
  let prev = new Uint8Array(stride); // the row above the first row is all zeros
  let cur = new Uint8Array(stride);
  for (let y = 0; y < height; y++) {
    const rowStart = y * (stride + 1);
    const filter = raw[rowStart] ?? 0;
    for (let i = 0; i < stride; i++) {
      const x = raw[rowStart + 1 + i] ?? 0;
      const a = i >= BYTES_PER_PIXEL ? (cur[i - BYTES_PER_PIXEL] ?? 0) : 0;
      const b = prev[i] ?? 0;
      const c = i >= BYTES_PER_PIXEL ? (prev[i - BYTES_PER_PIXEL] ?? 0) : 0;
      let value: number;
      switch (filter) {
        case 0:
          value = x;
          break;
        case 1:
          value = x + a;
          break;
        case 2:
          value = x + b;
          break;
        case 3:
          value = x + Math.floor((a + b) / 2);
          break;
        case 4:
          value = x + paeth(a, b, c);
          break;
        default:
          throw new Error(`decodePng: unknown filter ${filter} on row ${y}`);
      }
      cur[i] = value & 255;
    }
    for (let px = 0; px < width; px++) {
      const o = (y * width + px) * 4;
      rgba[o] = cur[px * 3] ?? 0;
      rgba[o + 1] = cur[px * 3 + 1] ?? 0;
      rgba[o + 2] = cur[px * 3 + 2] ?? 0;
      rgba[o + 3] = 255;
    }
    [prev, cur] = [cur, prev];
  }
  return { width, height, rgba };
}
