// Render build/icon.svg into PNGs + a multi-size Windows .ico.
import { readFile, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import sharp from 'sharp'
import pngToIco from 'png-to-ico'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const svg = await readFile(join(root, 'build', 'icon.svg'))

const png = (size) => sharp(svg, { density: 384 }).resize(size, size).png().toBuffer()

// Standalone PNGs (window icon / Linux / mac source)
for (const size of [512, 256]) {
  await writeFile(join(root, 'build', `icon-${size}.png`), await png(size))
}
await writeFile(join(root, 'build', 'icon.png'), await png(512))

// Windows .ico with the sizes Explorer/taskbar actually use
const icoSizes = [256, 128, 64, 48, 32, 16]
const buffers = await Promise.all(icoSizes.map(png))
await writeFile(join(root, 'build', 'icon.ico'), await pngToIco(buffers))

console.log('Generated build/icon.ico, icon.png, icon-512.png, icon-256.png')
