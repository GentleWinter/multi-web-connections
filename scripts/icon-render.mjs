/**
 * Icon rendering, PNG encoding and a matching decoder.
 *
 * Shared by generate-icons.mjs (writes them) and check-icons.mjs (verifies the
 * committed files still match). The decoder exists because comparing PNG *bytes*
 * is not portable: identical pixels compress to slightly different byte streams
 * under different zlib builds, so CI on a different Node than the author's would
 * report drift that does not exist.
 */
import { deflateSync, inflateSync } from 'node:zlib'

export const SIZES = [16, 22, 24, 32, 48, 64, 128, 256, 512]

// --- PNG encoding ----------------------------------------------------------

const CRC_TABLE = (() => {
  const t = new Int32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c
  }
  return t
})()

function crc32(buf) {
  let c = ~0
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8)
  return ~c >>> 0
}

function chunk(type, data) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body))
  return Buffer.concat([len, body, crc])
}

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

export function encodePng(size, rgba) {
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(size, 0)
  ihdr.writeUInt32BE(size, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 6 // colour type: RGBA
  ihdr[10] = 0 // deflate
  ihdr[11] = 0 // adaptive filtering
  ihdr[12] = 0 // no interlace

  // Every scanline is prefixed with its filter type (0 = None), which is what
  // lets the decoder below stay simple.
  const stride = size * 4
  const raw = Buffer.alloc((stride + 1) * size)
  for (let y = 0; y < size; y++) {
    raw[y * (stride + 1)] = 0
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride)
  }

  return Buffer.concat([
    SIGNATURE,
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

function paeth(a, b, c) {
  const p = a + b - c
  const pa = Math.abs(p - a)
  const pb = Math.abs(p - b)
  const pc = Math.abs(p - c)
  if (pa <= pb && pa <= pc) return a
  return pb <= pc ? b : c
}

/**
 * Reverse PNG's per-scanline filtering. Our own encoder only ever writes filter
 * 0, but third-party icons use the adaptive filters, and this decoder is also
 * used to read those.
 */
function unfilter(raw, width, height) {
  const bpp = 4 // 8-bit RGBA
  const stride = width * bpp
  const out = Buffer.alloc(stride * height)

  for (let y = 0; y < height; y++) {
    const type = raw[y * (stride + 1)]
    const src = y * (stride + 1) + 1
    const dst = y * stride
    const up = dst - stride

    for (let i = 0; i < stride; i++) {
      const x = raw[src + i]
      const a = i >= bpp ? out[dst + i - bpp] : 0
      const b = y > 0 ? out[up + i] : 0
      const c = y > 0 && i >= bpp ? out[up + i - bpp] : 0

      let value
      switch (type) {
        case 0: value = x; break
        case 1: value = x + a; break
        case 2: value = x + b; break
        case 3: value = x + ((a + b) >> 1); break
        case 4: value = x + paeth(a, b, c); break
        default: throw new Error(`unknown PNG filter type ${type} on scanline ${y}`)
      }
      out[dst + i] = value & 0xff
    }
  }
  return out
}

/**
 * Decode an 8-bit RGBA PNG. Handles all five scanline filters, so it reads
 * third-party icons as well as our own output. Other colour types and bit
 * depths are refused rather than guessed at.
 */
export function decodePng(buffer) {
  if (!buffer.subarray(0, 8).equals(SIGNATURE)) throw new Error('not a PNG')

  let offset = 8
  let width = 0
  let height = 0
  const idat = []

  while (offset < buffer.length) {
    const length = buffer.readUInt32BE(offset)
    const type = buffer.subarray(offset + 4, offset + 8).toString('ascii')
    const data = buffer.subarray(offset + 8, offset + 8 + length)

    if (type === 'IHDR') {
      width = data.readUInt32BE(0)
      height = data.readUInt32BE(4)
      if (data[8] !== 8 || data[9] !== 6) {
        throw new Error(`unsupported PNG: depth=${data[8]} colourType=${data[9]}`)
      }
    } else if (type === 'IDAT') {
      idat.push(Buffer.from(data))
    } else if (type === 'IEND') {
      break
    }
    offset += 12 + length
  }

  const rgba = unfilter(inflateSync(Buffer.concat(idat)), width, height)
  return { width, height, rgba }
}

// --- shape sampling (coordinates are 0..1) ---------------------------------

const GREEN = [0x25, 0xd3, 0x66]
const WHITE = [0xff, 0xff, 0xff]

function insideRoundedSquare(x, y, radius) {
  const dx = Math.max(Math.abs(x - 0.5) - (0.5 - radius), 0)
  const dy = Math.max(Math.abs(y - 0.5) - (0.5 - radius), 0)
  return Math.hypot(dx, dy) <= radius
}

function insideTriangle(px, py, [ax, ay], [bx, by], [cx, cy]) {
  const sign = (x1, y1, x2, y2, x3, y3) => (x1 - x3) * (y2 - y3) - (x2 - x3) * (y1 - y3)
  const d1 = sign(px, py, ax, ay, bx, by)
  const d2 = sign(px, py, bx, by, cx, cy)
  const d3 = sign(px, py, cx, cy, ax, ay)
  const hasNeg = d1 < 0 || d2 < 0 || d3 < 0
  const hasPos = d1 > 0 || d2 > 0 || d3 > 0
  return !(hasNeg && hasPos)
}

/** A white chat bubble on a green rounded square — legible down to 16px. */
function sample(x, y) {
  if (!insideRoundedSquare(x, y, 0.22)) return [0, 0, 0, 0]
  const inBubble = Math.hypot(x - 0.5, y - 0.46) <= 0.27
  const inTail = insideTriangle(x, y, [0.34, 0.62], [0.28, 0.82], [0.52, 0.66])
  return inBubble || inTail ? [...WHITE, 1] : [...GREEN, 1]
}

export function render(size) {
  const SS = 4 // supersampling factor, for antialiased edges
  const out = Buffer.alloc(size * size * 4)

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let r = 0
      let g = 0
      let b = 0
      let a = 0
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const [sr, sg, sb, sa] = sample((x + (sx + 0.5) / SS) / size, (y + (sy + 0.5) / SS) / size)
          r += sr * sa
          g += sg * sa
          b += sb * sa
          a += sa
        }
      }
      const i = (y * size + x) * 4
      if (a > 0) {
        out[i] = Math.round(r / a) // un-premultiply
        out[i + 1] = Math.round(g / a)
        out[i + 2] = Math.round(b / a)
      }
      out[i + 3] = Math.round((a / (SS * SS)) * 255)
    }
  }
  return out
}

/**
 * Box-filter downscale. Alpha-weighted so transparent edges do not darken the
 * result, which is what a naive average does to an icon with a soft border.
 */
export function downscale(rgba, srcW, srcH, dst) {
  const out = Buffer.alloc(dst * dst * 4)
  for (let y = 0; y < dst; y++) {
    for (let x = 0; x < dst; x++) {
      const x0 = Math.floor((x * srcW) / dst)
      const x1 = Math.max(x0 + 1, Math.floor(((x + 1) * srcW) / dst))
      const y0 = Math.floor((y * srcH) / dst)
      const y1 = Math.max(y0 + 1, Math.floor(((y + 1) * srcH) / dst))

      let r = 0
      let g = 0
      let b = 0
      let alpha = 0
      let n = 0
      for (let sy = y0; sy < Math.min(y1, srcH); sy++) {
        for (let sx = x0; sx < Math.min(x1, srcW); sx++) {
          const i = (sy * srcW + sx) * 4
          const a = rgba[i + 3] / 255
          r += rgba[i] * a
          g += rgba[i + 1] * a
          b += rgba[i + 2] * a
          alpha += a
          n++
        }
      }
      const o = (y * dst + x) * 4
      if (alpha > 0) {
        out[o] = Math.round(r / alpha)
        out[o + 1] = Math.round(g / alpha)
        out[o + 2] = Math.round(b / alpha)
      }
      out[o + 3] = n > 0 ? Math.round((alpha / n) * 255) : 0
    }
  }
  return out
}
