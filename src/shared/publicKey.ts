/** Accept exactly one OpenSSH public-key line; comments are data, never shell code. */
export function validatePublicKey(value: string): string {
  const line = value.trim()
  if (/[\r\n\0]/.test(line) || !/^(?:ssh-(?:rsa|ed25519)|ecdsa-sha2-nistp(?:256|384|521)|sk-(?:ssh-ed25519|ecdsa-sha2-nistp256)@openssh\.com) [A-Za-z0-9+/]+={0,2}(?: [^\r\n\0]*)?$/.test(line)) throw new Error('invalid-key')
  return line
}

export function publishKeyCommand(value: string): string {
  const line = validatePublicKey(value).replace(/'/g, "'\\''")
  return `umask 077; mkdir -p ~/.ssh && chmod 700 ~/.ssh && printf '%s\\n' '${line}' >> ~/.ssh/authorized_keys && chmod 600 ~/.ssh/authorized_keys`
}
