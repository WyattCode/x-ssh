/**
 * Bounding the persisted session history.
 *
 * This used to be `merged.slice(-300)`: a count cap. A real scrollback buffer
 * from a busy session is a few hundred KB of text full of ANSI escapes — on
 * this machine 142 saved entries came to 30 MB, median entry 327 KB. A 300-cap
 * therefore allowed ~100 MB, and `settings.json` is rewritten whole (backup +
 * temp + rename) on every single settings write. Past a few MB the rename step
 * starts losing its retry race on Windows, and the failure lands on whatever
 * unrelated action happened to be waiting on the settings queue — a host edit
 * showing "保存失败" for a 4.9 KB hosts.json it never touched.
 *
 * Caps now walk entries newest-first against a byte budget, so the file stays
 * small no matter how fat the individual buffers are.
 */

/** Total budget for the persisted history, in bytes of text. */
export const HISTORY_BUDGET_BYTES = 2 * 1024 * 1024

/** Per-entry ceiling: one huge session must not crowd out every other one. */
export const HISTORY_ENTRY_BYTES = 64 * 1024

/** Never keep more than this many entries, whatever their size. */
export const HISTORY_MAX_ENTRIES = 200

/** Marks where a stored buffer was shortened. */
export const TRUNCATION_MARK = '\n…(older output omitted)\n'

/**
 * Keeps the tail of one buffer, which is what a terminal shows anyway: the
 * newest output is at the end, so dropping the head loses the least.
 * A buffer already within budget is returned untouched (identity, not copy).
 */
export function trimEntry(text: string, maxBytes = HISTORY_ENTRY_BYTES): string {
  if (Buffer.byteLength(text, 'utf8') <= maxBytes) return text
  const markBytes = Buffer.byteLength(TRUNCATION_MARK, 'utf8')
  const budget = Math.max(0, maxBytes - markBytes)
  // Work on bytes, not UTF-16 units. The previous version advanced one
  // character at a time and re-measured the whole tail each time — O(n²):
  // a 256 KB Chinese buffer took ~44k iterations and over a second, which is
  // what froze the main process for tens of seconds while trimming history at
  // startup and on quit.
  const buf = Buffer.from(text, 'utf8')
  if (buf.length <= budget) return TRUNCATION_MARK + text
  let start = buf.length - budget
  // Step forward to a UTF-8 character boundary (continuation bytes match
  // 10xxxxxx). That also keeps surrogate pairs intact, since it never lands
  // inside a multi-byte sequence.
  while (start < buf.length && (buf[start] & 0xc0) === 0x80) start++
  return TRUNCATION_MARK + buf.subarray(start).toString('utf8')
}

/**
 * Newest-first fill against the total budget; the result keeps chronological
 * order so history search still reads oldest → newest.
 */
export function capHistory(
  entries: readonly { label: string; text: string }[],
  budgetBytes = HISTORY_BUDGET_BYTES,
  maxEntries = HISTORY_MAX_ENTRIES
): { label: string; text: string }[] {
  const kept: { label: string; text: string }[] = []
  let used = 0
  for (let i = entries.length - 1; i >= 0 && kept.length < maxEntries; i--) {
    const e = entries[i]
    if (!e) continue
    const text = trimEntry(e.text)
    const label = e.label ?? ''
    const cost = Buffer.byteLength(text, 'utf8') + Buffer.byteLength(label, 'utf8')
    // Always keep at least the newest entry: an empty history is worse than a
    // slightly over-budget one, and the per-entry cap already bounds it.
    if (kept.length > 0 && used + cost > budgetBytes) break
    kept.push({ label, text })
    used += cost
  }
  return kept.reverse()
}