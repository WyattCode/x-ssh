#!/usr/bin/env node
// scripts/build-mac.mjs
//
// 为什么需要这层包装：electron-builder 的配置没有条件逻辑，build.mac.icon
// 只能写死一个值。而 Liquid Glass 图标（build/icon.icon）只有 Xcode 26+
// 且 actool 真正可用的机器才能编译，否则 electron-builder 直接抛：
//   ⨯ Failed to check actool version. Is Xcode 26 or higher installed?
// 所以在这里探测，然后用 -c.mac.icon= 覆盖，再交给 electron-builder。
//
// 用法：npm run dist:mac [-- electron-builder 的额外参数]
import { execFileSync, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { makeMacIcon } from './make-mac-icon.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

// 探测目标不是「Xcode 装没装」，而是「actool 能不能真的编译 .icon」。
// 因此判据只有一条：`xcrun actool --version` 必须干净退出。
// 注意 `xcrun --find actool` 只证明二进制存在，不证明插件运行时可用——
// 本机实测：--find 返回路径成功，而真跑 actool 退出码 134 +
// "A required plugin failed to load"。所以必须真执行。
function xcodeSupportsIconComposer({ log = () => {} } = {}) {
  if (process.platform !== 'darwin') return false

  // 1) 选中了完整的开发者工具路径（只有 CLT 时 actool 不存在）
  let devDir = ''
  try {
    devDir = execFileSync('xcode-select', ['-p'], { encoding: 'utf8' }).trim()
  } catch {
    log('[build-mac] 未选中 Xcode（xcode-select -p 失败），降级到 icns')
    return false
  }

  // 2) 主版本 >= 26：Icon Composer 的 .icon 格式是 Xcode 26 起支持的
  let version = ''
  try {
    version = execFileSync('xcodebuild', ['-version'], { encoding: 'utf8' })
  } catch {
    log('[build-mac] xcodebuild -version 失败，降级到 icns')
    return false
  }
  const major = Number(/Xcode\s+(\d+)/.exec(version)?.[1])
  if (!Number.isFinite(major) || major < 26) {
    log(`[build-mac] Xcode 主版本 ${major || '未知'} < 26，降级到 icns`)
    return false
  }

  // 3) 决定性判据：真跑一次 actool。首启动组件缺失时它会 SIGABRT（134），
  //    这里连退出码带 stderr 一起判，不只看 --find。
  try {
    const out = execFileSync('xcrun', ['actool', '--version'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe']
    })
    if (!/actool/i.test(String(out))) {
      log('[build-mac] actool --version 输出异常，降级到 icns')
      return false
    }
  } catch (err) {
    const detail = String(err.stderr || err.message).split('\n')[0]
    log(`[build-mac] actool 存在但无法运行（${devDir}）：${detail}`)
    log('[build-mac] 若要用 Liquid Glass 图标：sudo xcodebuild -runFirstLaunch')
    return false
  }

  return true
}

const iconDir = path.join(ROOT, 'build', 'icon.icon')
const useLiquidGlass = fs.existsSync(iconDir) && xcodeSupportsIconComposer()
const icon = useLiquidGlass ? iconDir : makeMacIcon()

console.log(
  `[build-mac] icon: ${path.relative(ROOT, icon)} ` +
    (useLiquidGlass ? '(Liquid Glass via actool)' : '(icns fallback)')
)

// 架构必须显式：不写 --arm64 时产物架构隐式跟宿主，runner 一换就静默变 x64，
// 而 README 承诺的文件名是 X-SSH-<version>-arm64.dmg。
// mac target 保持 dmg+zip 不变:zip 与 latest-mac.yml 是 electron-updater/Squirrel.Mac
// 的更新 feed 必需产物(更新检查要读清单)。当前是 ad-hoc 签名,Squirrel.Mac 要求更新包
// 与运行中 App 同一 Team ID,所以现阶段 mac 只做到“提示+发布页”;以后正式签名后才开
// mac 自动更新(见 src/main/updater.ts 与 README「更新」一节)。
const bin = path.join(ROOT, 'node_modules', '.bin', 'electron-builder')
const args = ['--mac', '--arm64', `-c.mac.icon=${icon}`, ...process.argv.slice(2)]
const r = spawnSync(bin, args, { stdio: 'inherit', cwd: ROOT })
if (r.error) {
  console.error(`[build-mac] 无法启动 electron-builder（${bin}）：${r.error.message}`)
  console.error('先运行 npm ci（确认 node_modules/.bin/electron-builder 存在）。')
  process.exit(1)
}
process.exit(r.status ?? 1)
