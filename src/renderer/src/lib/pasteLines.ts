/**
 * How many substantive lines would a paste send?
 * Normalizes CRLF/CR → LF, then strips a single run of trailing newlines
 * (common when copying one line from an editor). Empty → 0.
 */
export function pasteLineCount(text: string): number {
  const normalized = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
  const trimmed = normalized.replace(/\n+$/, '')
  if (!trimmed) return 0
  return trimmed.split('\n').length
}
