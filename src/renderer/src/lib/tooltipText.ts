/**
 * Splits a tooltip such as "新建连接 (Ctrl+K)" or "Hosts（⌘B）" into its label and its
 * shortcut, so the shortcut can be drawn as a key chip instead of running on in the sentence.
 * Anything else (a path, an address, a sentence with a parenthesis) is left whole.
 */
const MODIFIER = '(?:ctrl|control|cmd|command|shift|alt|option|meta|win)'
// "Ctrl+K", "Ctrl + Shift + P", "Shift+Click": a modifier, then more keys joined by "+".
const SPELLED = new RegExp(`^${MODIFIER}(?:\\s*\\+\\s*(?:${MODIFIER}|[^\\s+]{1,10}))+$`, 'i')
// "⌘B", "⌘⇧P": modifier glyphs, then at most one key.
const GLYPHS = /^[⌘⌥⇧⌃]+\s?[^\s]{0,10}$/

export function splitTip(text: string): { label: string; key: string } {
  const m = /^(.*?)\s*[（(]\s*([^()（）]+?)\s*[)）]$/.exec(text)
  if (!m || !m[1]) return { label: text, key: '' }
  const key = m[2]
  // A shortcut is built from modifiers: a bare word that merely contains one ("Alt server",
  // "Shift register") is a note, not a key.
  const isCombo = key.length <= 24 && (SPELLED.test(key) || GLYPHS.test(key))
  return isCombo ? { label: m[1], key } : { label: text, key: '' }
}
