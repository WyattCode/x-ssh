/**
 * Maps raw ssh2 / Node network / SFTP error strings (English) to friendly
 * Simplified-Chinese messages. Unknown errors pass through unchanged.
 */
export function friendlyError(msg: string | undefined): string {
  const raw = msg ?? ''
  const m = raw.toLowerCase()
  const has = (s: string): boolean => m.includes(s)

  // ---- authentication ----
  if (has('all configured authentication methods failed') || has('authentication methods failed'))
    return '认证失败:用户名、密码或密钥不正确'
  if (has('keyboard-interactive')) return '认证失败:服务器要求交互式验证'
  if (has('passphrase') || has('cannot parse privatekey') || has('integrity check') || has('unsupported key'))
    return '私钥无法解析,或密钥的密码短语不正确'

  // ---- connection / network ----
  if (has('timed out while waiting for handshake') || has('handshake'))
    return '握手超时:服务器无响应,请检查地址、端口或网络'
  if (has('etimedout') || has('timed out')) return '连接超时:请检查地址、端口或网络'
  if (has('econnrefused')) return '连接被拒绝:目标端口未开放,或 SSH 服务未运行'
  if (has('enotfound') || has('getaddrinfo')) return '无法解析主机名,请检查地址是否正确'
  if (has('ehostunreach')) return '无法访问主机:网络不可达'
  if (has('enetunreach')) return '网络不可达'
  if (has('econnreset')) return '连接被服务器重置'
  if (has('econnaborted')) return '连接已中断'
  if (has('eacces') || has('eaccess')) return '连接被拒绝:权限不足'
  if (has('epipe')) return '连接已断开'

  // ---- SFTP file operations ----
  if (has('no such file')) return '文件或目录不存在'
  if (has('permission denied')) return '权限不足'
  if (has('not a directory')) return '目标不是目录'
  if (has('is a directory')) return '目标是一个目录'
  if (has('already exists')) return '目标已存在'
  if (has('no space left')) return '服务器磁盘空间不足'
  if (has('quota')) return '超出磁盘配额'
  if (m === 'failure' || has('sftp error') || has('sftp failure')) return '操作失败'

  return raw
}
