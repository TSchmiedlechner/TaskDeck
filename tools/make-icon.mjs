// Generates build/icon.ico (256px app icon) and resources/tray.png (32px tray icon)
// without any image tooling: draws the TaskDeck glyph pixel-by-pixel, encodes PNG
// with node:zlib, and wraps the 256px PNG in a single-image ICO container.
import { deflateSync } from 'node:zlib'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

// --- drawing ---------------------------------------------------------------

const BG = [0x14, 0x16, 0x1a, 255]
const TEAL = [0x6c, 0xc5, 0xb9, 255]
const GRAY = [0x7d, 0x8e, 0xa0, 255]
const DIM = [0x4d, 0x54, 0x5e, 255]

function inRoundedRect(x, y, x0, y0, x1, y1, r) {
  if (x < x0 || x > x1 || y < y0 || y > y1) return false
  const cx = Math.max(x0 + r, Math.min(x, x1 - r))
  const cy = Math.max(y0 + r, Math.min(y, y1 - r))
  return (x - cx) ** 2 + (y - cy) ** 2 <= r * r || (x >= x0 + r && x <= x1 - r) || (y >= y0 + r && y <= y1 - r)
    ? (x - cx) ** 2 + (y - cy) ** 2 <= r * r
    : false
}

function inCapsule(x, y, x0, x1, cy, h) {
  const r = h / 2
  const cx = Math.max(x0 + r, Math.min(x, x1 - r))
  return (x - cx) ** 2 + (y - cy) ** 2 <= r * r
}

/** Renders the glyph at `size` px into an RGBA buffer (all coordinates scale from a 256 design grid). */
function render(size) {
  const s = size / 256
  const px = Buffer.alloc(size * size * 4)
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = x / s
      const dy = y / s
      let color = null
      if (inRoundedRect(dx, dy, 8, 8, 248, 248, 56)) color = BG
      if (color) {
        // teal status dot + three list bars
        if ((dx - 74) ** 2 + (dy - 75) ** 2 <= 15 ** 2) color = TEAL
        else if (inCapsule(dx, dy, 108, 192, 75, 16)) color = TEAL
        else if (inCapsule(dx, dy, 64, 192, 127, 16)) color = GRAY
        else if (inCapsule(dx, dy, 64, 160, 179, 16)) color = DIM
      }
      if (color) px.set(color, (y * size + x) * 4)
    }
  }
  return px
}

/** Box-downsample an RGBA buffer by an integer factor for cheap antialiasing. */
function downsample(px, size, factor) {
  const out = Buffer.alloc((size / factor) ** 2 * 4)
  const outSize = size / factor
  for (let y = 0; y < outSize; y++) {
    for (let x = 0; x < outSize; x++) {
      const acc = [0, 0, 0, 0]
      for (let sy = 0; sy < factor; sy++) {
        for (let sx = 0; sx < factor; sx++) {
          const idx = ((y * factor + sy) * size + x * factor + sx) * 4
          for (let c = 0; c < 4; c++) acc[c] += px[idx + c]
        }
      }
      const idx = (y * outSize + x) * 4
      for (let c = 0; c < 4; c++) out[idx + c] = Math.round(acc[c] / factor ** 2)
    }
  }
  return out
}

// --- png encoding ----------------------------------------------------------

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  return c >>> 0
})

function crc32(buf) {
  let c = 0xffffffff
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function chunk(type, data) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body))
  return Buffer.concat([len, body, crc])
}

function encodePng(px, size) {
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(size, 0)
  ihdr.writeUInt32BE(size, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 6 // RGBA
  const raw = Buffer.alloc(size * (size * 4 + 1))
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0 // filter: none
    px.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4)
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0))
  ])
}

/** Wraps one PNG in an ICO container (valid since Vista). */
function wrapIco(png, size) {
  const header = Buffer.alloc(6)
  header.writeUInt16LE(1, 2) // type: icon
  header.writeUInt16LE(1, 4) // count
  const entry = Buffer.alloc(16)
  entry[0] = size >= 256 ? 0 : size
  entry[1] = size >= 256 ? 0 : size
  entry.writeUInt16LE(1, 4) // planes
  entry.writeUInt16LE(32, 6) // bpp
  entry.writeUInt32LE(png.length, 8)
  entry.writeUInt32LE(22, 12) // offset
  return Buffer.concat([header, entry, png])
}

// --- output ----------------------------------------------------------------

const icon256 = downsample(render(512), 512, 2)
const tray32 = downsample(render(128), 128, 4)

mkdirSync(join(root, 'build'), { recursive: true })
mkdirSync(join(root, 'resources'), { recursive: true })
writeFileSync(join(root, 'build', 'icon.ico'), wrapIco(encodePng(icon256, 256), 256))
writeFileSync(join(root, 'resources', 'tray.png'), encodePng(tray32, 32))
console.log('wrote build/icon.ico and resources/tray.png')
