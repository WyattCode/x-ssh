#!/usr/bin/env node
// scripts/make-mac-icon.mjs
//
// 从 build/icon.png（>=1024x1024 正方形）生成 build/icon.icns。
// 只用 Node 标准库 + macOS 自带 sips / iconutil，无第三方依赖。
//
// 中间产物 icon.iconset 写在系统临时目录，不进仓库（构建被中断也不会污染 build/）。
// 产物 build/icon.icns 是**入库文件**：package.json 的 build.mac.icon 指向它，
// 若仓库里没有，新 clone 在 mac 上跑 npm run dist 会因图标缺失而失败。
//
// 单独跑：npm run icon:mac
// 被 build-mac.mjs import：export { makeMacIcon }
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const SRC = path.join(ROOT, 'build', 'icon.png')
const OUT = path.join(ROOT, 'build', 'icon.icns')

// iconutil 要求的文件名 → 目标像素边长
const ENTRIES = [
  ['icon_16x16.png', 16],
  ['icon_16x16@2x.png', 32],
  ['icon_32x32.png', 32],
  ['icon_32x32@2x.png', 64],
  ['icon_128x128.png', 128],
  ['icon_128x128@2x.png', 256],
  ['icon_256x256.png', 256],
  ['icon_256x256@2x.png', 512],
  ['icon_512x512.png', 512],
  ['icon_512x512@2x.png', 1024]
]

function pixelSize(file) {
  const out = execFileSync('sips', ['-g', 'pixelWidth', '-g', 'pixelHeight', file], {
    encoding: 'utf8'
  })
  return {
    w: Number(/pixelWidth:\s*(\d+)/.exec(out)?.[1]),
    h: Number(/pixelHeight:\s*(\d+)/.exec(out)?.[1])
  }
}

export function makeMacIcon({ log = console.log } = {}) {
  if (process.platform !== 'darwin') {
    throw new Error('make-mac-icon.mjs 只能在 macOS 上运行（依赖 sips / iconutil）')
  }
  if (!fs.existsSync(SRC)) {
    throw new Error(`缺少源图：${path.relative(ROOT, SRC)}`)
  }

  const { w, h } = pixelSize(SRC)
  // sips 输出格式变化或报错时是 NaN；NaN !== NaN 会伪装成「不是正方形」，
  // 所以先单独拦一层，别让报错信息骗人。
  if (!Number.isFinite(w) || !Number.isFinite(h)) {
    throw new Error(`无法解析 ${path.relative(ROOT, SRC)} 的像素尺寸（sips 输出不符合预期）`)
  }
  if (w !== h || w < 1024) {
    throw new Error(
      `${path.relative(ROOT, SRC)} 必须是至少 1024x1024 的正方形，当前 ${w}x${h}`
    )
  }

  // iconutil 要求目录名以 `.iconset` 结尾，所以 mkdtemp 只用来开一个唯一的父目录，
  // 真正的 iconset 是它下面的 icon.iconset。
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'xssh-icon-'))
  const iconset = path.join(tmpRoot, 'icon.iconset')
  fs.mkdirSync(iconset)
  try {
    for (const [name, px] of ENTRIES) {
      const dst = path.join(iconset, name)
      if (px === w) {
        // 源图就是 1024：原样复制给 @2x，避免无意义的重采样
        fs.copyFileSync(SRC, dst)
      } else {
        execFileSync('sips', ['-z', String(px), String(px), SRC, '--out', dst], {
          stdio: 'ignore'
        })
      }
    }

    fs.rmSync(OUT, { force: true })
    execFileSync('iconutil', ['-c', 'icns', iconset, '-o', OUT])
  } finally {
    fs.rmSync(tmpRoot, { recursive: true, force: true })
  }

  const bytes = fs.statSync(OUT).size
  if (bytes === 0) throw new Error('iconutil 生成了 0 字节的 icns')
  log(`[make-mac-icon] ${path.relative(ROOT, OUT)} ${bytes} bytes`)
  return OUT
}

// CLI 入口（被 import 时不执行）
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  makeMacIcon()
}
