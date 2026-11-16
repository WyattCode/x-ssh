/** Decode OSC 52 clipboard payload (base64 after the first ';').
 *  Returns UTF-8 text, or null for query/empty/invalid/too-large. */
export function decodeOsc52Payload(payload: string, maxLen = 2_000_000): string | null {
  if (!payload || payload === '?') return null
  // Some remotes (tmux wrapping, multi-line OSC) put newlines/spaces inside the
  // base64. atob() rejects those, which used to make the copy fail silently.
  const b64 = payload.replace(/\s+/g, '')
  if (!b64 || b64 === '?' || b64.length > maxLen) return null
  try {
    const bin = atob(b64)
    const bytes = Uint8Array.from(bin, (ch) => ch.charCodeAt(0))
    return new TextDecoder().decode(bytes)
  } catch {
    return null
  }
}

/** Per-terminal consent and rate gate; disabled unless explicitly enabled. */
export function createOsc52Gate(): (payload: string, enabled: boolean, now?: number) => string | null {
  let last = -Infinity
  return (payload, enabled, now = Date.now()) => {
    if (!enabled || payload.length > 65536 || now - last < 1000) return null
    const text = decodeOsc52Payload(payload, 65536)
    if (text !== null) last = now
    return text
  }
}
