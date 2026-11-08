/**
 * Normalises the `hosts` field of a full backup.
 *
 * History: the exporter wrote `store.exportJson()` straight into the payload —
 * that function returns a JSON *string* — while the importer required an array.
 * `Array.isArray(data.hosts)` was therefore always false and every backup this
 * app produced was rejected with "invalid backup"; restoring one never worked.
 *
 * Accept all three shapes so files written by any version can be read:
 *   - an array of hosts (what `importJson` ultimately needs),
 *   - a JSON string holding either an array or `{ hosts: [...] }` (old exports),
 *   - an object with a `hosts` array (new exports).
 */
export function extractBackupHosts(value: unknown): unknown[] | null {
  if (Array.isArray(value)) return value
  if (typeof value === 'string') {
    try {
      const parsed: unknown = JSON.parse(value)
      if (Array.isArray(parsed)) return parsed
      if (parsed && typeof parsed === 'object') {
        const inner = (parsed as { hosts?: unknown }).hosts
        if (Array.isArray(inner)) return inner
      }
      return null
    } catch {
      return null
    }
  }
  if (value && typeof value === 'object') {
    const inner = (value as { hosts?: unknown }).hosts
    if (Array.isArray(inner)) return inner
  }
  return null
}

/** The payload shape `store.exportJson()` produces, as an object. */
export function parseExportedJson(json: string): unknown {
  return JSON.parse(json)
}
