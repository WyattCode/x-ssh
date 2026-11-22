/**
 * Splits a tooltip such as "新建连接 (Ctrl+K)" or "Hosts（⌘B）" into its label and its
 * shortcut, so the shortcut can be drawn as a key chip instead of running on in the sentence.
 * Anything else (a path, an address, a sentence with a parenthesis) is left whole.
 */
export function splitTip(text: string): { label: string; key: string } {
  const m = /^(.*?)\s*[（(]\s*([^()（）]+?)\s*[)）]$/.exec(text)
  if (!m || !m[1]) return { label: text, key: '' }
  const key = m[2]
  // A shortcut names a modifier or joins keys with "+": "(Ctrl+K)", "(⌘B)", "(Shift+Click)".
  const isCombo = /(ctrl|control|cmd|command|shift|alt|option|⌘|⌥|⇧|⌃)/i.test(key) && key.length <= 24
  return isCombo ? { label: m[1], key } : { label: text, key: '' }
}
