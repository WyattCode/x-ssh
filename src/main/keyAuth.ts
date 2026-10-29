import type { ConnectParams } from '../shared/types'

/**
 * True when a connect attempt will use an SSH private key — either for the
 * primary hop or for a jump host. Kept free of Electron imports so it can be
 * unit-tested under plain Node.
 */
export function connectNeedsPrivateKey(params: ConnectParams): boolean {
  return params.auth === 'key' || params.jump?.auth === 'key'
}
