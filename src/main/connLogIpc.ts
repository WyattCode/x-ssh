import type { ConnLogEntry } from '../shared/types'
export async function rendererConnLogPush(entry: ConnLogEntry, push: (entry: ConnLogEntry) => Promise<void>): Promise<{ ok: boolean }> {
  void entry
  void push
  return { ok: false }
}
