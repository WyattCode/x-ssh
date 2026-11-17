export async function rendererConnLogPush<T>(entry: T, push: (entry: T) => Promise<void>): Promise<{ ok: boolean }> {
  void entry
  void push
  return { ok: false }
}
