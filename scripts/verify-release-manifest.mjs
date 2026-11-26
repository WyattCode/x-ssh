#!/usr/bin/env node
/**
 * verify-release-manifest.mjs — assert release/latest.yml matches the artifacts on disk.
 *
 * Why this exists (v0.8.1 post-mortem): electron-builder's NSIS manifest and the
 * published asset names were produced by two different space-normalizations of a
 * space-containing default artifact name ("X-SSH Setup 0.8.1.exe"): latest.yml got
 * `url/path: X-SSH-Setup-0.8.1.exe` (space→hyphen, computeSafeArtifactNameIfNeeded)
 * while the GitHub release asset ended up `X-SSH.Setup.0.8.1.exe` (space→dot).
 * The file the manifest pointed at did not exist → every Windows auto-update 404'd.
 * 0.8.2 pins `build.nsis.artifactName` to a space-free name so the two can never
 * diverge again; this script is the CI tripwire that fails loudly (before upload
 * and before publishing) if a manifest and its artifacts ever disagree again.
 *
 * Checks, for every entry electron-builder's updater will follow:
 *   - each `files[].url` (or `files[].path`), or — for legacy manifests without a
 *     `files:` list — the top-level `path:` — a file of that name exists in the
 *     release directory;
 *   - the manifest's `sha512` equals the locally streamed SHA-512 (base64) of that file;
 *   - the manifest's `size` equals the file's byte size.
 *
 * Any problem prints "manifest value vs actual value" and the process exits 1.
 * Usage: node scripts/verify-release-manifest.mjs [releaseDir]   (default: release)
 */
import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { readFile, stat } from 'node:fs/promises'
import { join, resolve, sep } from 'node:path'
import process from 'node:process'

const releaseDir = resolve(process.argv[2] ?? 'release')
const manifestPath = join(releaseDir, 'latest.yml')

function fail(msg) {
  console.error(`FAIL: ${msg}`)
  process.exit(1)
}

function unquote(v) {
  const t = v.trim()
  if ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'"))) {
    return t.slice(1, -1)
  }
  return t
}

/**
 * Minimal line parser for electron-builder's latest.yml shape. We deliberately do
 * not add a YAML dependency for a file whose shape we control:
 *
 *   version: 0.8.2
 *   files:
 *     - url: X-SSH-Setup-0.8.2.exe
 *       sha512: <base64>
 *       size: 123456
 *     - url: X-SSH-Setup-0.8.2.exe.blockmap
 *       sha512: <base64>
 *       size: 789
 *   path: X-SSH-Setup-0.8.2.exe          # present in new format, sole entry in legacy
 *   sha512: <base64>
 *   releaseDate: '2026-11-26T...'
 *   releaseNotes: |                      # block scalar — body must NOT be parsed
 *     ### Fixed
 *     ...
 *
 * Returns the file entries to verify: the `files:` list when present, else one
 * entry from the legacy top-level `path:`/`sha512:`/`size:`. The top-level
 * `path:`/`sha512:` (kept in new manifests for backward compat) is also verified
 * when it names a file no files[] entry covered.
 */
function parseManifest(text) {
  const lines = text.split(/\r?\n/)
  const entries = []
  const top = {}
  let current = null
  let inFiles = false
  let blockScalar = false

  for (const rawLine of lines) {
    const line = rawLine.replace(/\s+$/, '')
    if (line.trim() === '') continue
    const indent = line.match(/^ */)[0].length

    // Body of a block scalar (releaseNotes etc.): skip until dedent to column 0.
    if (blockScalar) {
      if (indent > 0) continue
      blockScalar = false
    }

    if (indent === 0) {
      inFiles = false
      current = null
      const m = line.match(/^([A-Za-z][\w-]*):\s*(.*)$/)
      if (!m) continue
      const [, key, value] = m
      if (key === 'files' && value === '') {
        inFiles = true
        continue
      }
      if (value === '' || /^[-|>][+-]?\d*$/.test(value)) {
        // Key with no inline value: either an unsupported nested map or a block
        // scalar. Skip its indented body defensively (only releaseNotes uses
        // this today; `files` was handled above).
        blockScalar = true
        continue
      }
      if (key === 'path' || key === 'sha512' || key === 'size' || key === 'version') {
        top[key] = unquote(value)
      }
      continue
    }

    if (!inFiles) continue
    const item = line.match(/^\s*-\s+(url|path)\s*:\s*(.*)$/)
    if (item) {
      current = { name: unquote(item[2]) }
      entries.push(current)
      continue
    }
    const field = line.match(/^\s+(sha512|size)\s*:\s*(.*)$/)
    if (field && current) current[field[1]] = unquote(field[2])
  }

  if (entries.length === 0 && top.path) {
    // Legacy single-artifact manifest: everything at top level.
    entries.push({ name: top.path, sha512: top.sha512, size: top.size })
  } else if (top.path && !entries.some((e) => e.name === top.path)) {
    // New format: top-level path duplicates files[0] — only check it separately
    // if nothing else covered that name.
    entries.push({ name: top.path, sha512: top.sha512, size: top.size })
  }
  return entries
}

function sha512Base64(path) {
  return new Promise((res, rej) => {
    const h = createHash('sha512')
    const s = createReadStream(path)
    s.on('error', rej)
    s.on('data', (d) => h.update(d))
    s.on('end', () => res(h.digest('base64')))
  })
}

let manifestText
try {
  manifestText = await readFile(manifestPath, 'utf8')
} catch (e) {
  // A missing manifest must read as a clear FAIL in CI logs, not a raw ENOENT stack.
  fail(`${manifestPath} is not readable (${e?.code ?? e}) — the installer build step must produce it before this check runs`)
}
const entries = parseManifest(manifestText)
if (entries.length === 0) {
  fail(`${manifestPath}: no files[].url / files[].path entries and no legacy top-level path: — nothing an updater could download`)
}

let problems = 0
for (const entry of entries) {
  const filePath = join(releaseDir, entry.name)
  if (!filePath.startsWith(releaseDir + sep)) {
    console.error(`FAIL: manifest entry "${entry.name}" resolves outside ${releaseDir}`)
    problems++
    continue
  }
  let actual
  try {
    actual = await stat(filePath)
  } catch {
    console.error(`FAIL: ${entry.name}: listed in latest.yml but does not exist in ${releaseDir}`)
    problems++
    continue
  }
  const actualSha = await sha512Base64(filePath)

  if (!entry.sha512) {
    console.error(`FAIL: ${entry.name}: manifest entry has no sha512 field (actual ${actualSha})`)
    problems++
  } else if (entry.sha512 !== actualSha) {
    console.error(`FAIL: ${entry.name}: sha512 mismatch\n  manifest: ${entry.sha512}\n  actual  : ${actualSha}`)
    problems++
  }

  if (entry.size === undefined) {
    console.error(`FAIL: ${entry.name}: manifest entry has no size field (actual ${actual.size})`)
    problems++
  } else if (!Number.isFinite(Number(entry.size)) || Number(entry.size) !== actual.size) {
    console.error(`FAIL: ${entry.name}: size mismatch\n  manifest: ${entry.size}\n  actual  : ${actual.size}`)
    problems++
  }

  if (entry.sha512 === actualSha && Number(entry.size) === actual.size) {
    console.log(`OK: ${entry.name} (${actual.size} bytes, sha512 verified)`)
  }
}

if (problems > 0) {
  fail(`${problems} problem(s) in ${manifestPath} vs ${releaseDir} — do NOT publish this manifest`)
}
console.log(`latest.yml verified: ${entries.length} entr${entries.length === 1 ? 'y' : 'ies'} against ${releaseDir}`)
