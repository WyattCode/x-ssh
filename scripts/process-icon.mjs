// Turn build/source-icon.png (icon on a black background) into a transparent,
// cropped icon set. Works for dark icons too: instead of colour-keying, it
// finds the icon's bounding box by luminance, then clips to an iOS squircle so
// the black corners/margins become transparent.
import { writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import sharp from 'sharp'
import pngToIco from 'png-to-ico'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const src = join(root, 'build', 'source-icon.png')

// 1) bounding box of everything brighter than near-black.
const { data, info } = await sharp(src).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
const { width, height } = info
let minX = width, minY = height, maxX = 0, maxY = 0
for (let y = 0; y < height; y++) {
  for (let x = 0; x < width; x++) {
    const i = (y * width + x) * 4
    const m = Math.max(data[i], data[i + 1], data[i + 2])
    if (m > 14) {
      if (x < minX) minX = x
      if (x > maxX) maxX = x
      if (y < minY) minY = y
      if (y > maxY) maxY = y
    }
  }
}
const w = maxX - minX + 1
const h = maxY - minY + 1
const extracted = await sharp(src).extract({ left: minX, top: minY, width: w, height: h }).png().toBuffer()

// 2) clip to an iOS-style squircle (rounded corners → transparent outside).
const rx = Math.round(Math.min(w, h) * 0.2237)
const mask = Buffer.from(
  `<svg width="${w}" height="${h}"><rect width="${w}" height="${h}" rx="${rx}" ry="${rx}" fill="#fff"/></svg>`
)
const rounded = await sharp(extracted)
  .composite([{ input: mask, blend: 'dest-in' }])
  .png()
  .toBuffer()

// 3) emit sizes.
const png = (size) =>
  sharp(rounded)
    .resize(size, size, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toBuffer()

for (const s of [512, 256]) await writeFile(join(root, 'build', `icon-${s}.png`), await png(s))
await writeFile(join(root, 'build', 'icon.png'), await png(512))
const buffers = await Promise.all([256, 128, 64, 48, 32, 16].map(png))
await writeFile(join(root, 'build', 'icon.ico'), await pngToIco(buffers))
console.log(`bbox ${w}x${h} @${minX},${minY}, rx=${rx} — generated transparent icon.ico + PNGs`)
