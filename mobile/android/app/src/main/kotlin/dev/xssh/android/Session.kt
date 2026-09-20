package dev.xssh.android

import uniffi.xssh_ffi.AuthMethod
import uniffi.xssh_ffi.HostConfig
import uniffi.xssh_ffi.ServerEvent
import uniffi.xssh_ffi.Session
import uniffi.xssh_ffi.Shell
import uniffi.xssh_ffi.Term
import uniffi.xssh_ffi.TerminalEvent

/** 一条活动会话:SSH 连接 + 通道 + 终端状态机。所有方法都必须在 IO 线程调用。 */
class LiveTerminal(
    val session: Session,
    val shell: Shell,
    val term: Term,
    val cols: Int,
    val rows: Int,
) {
    /** 收服务端消息 → 喂终端 → 回写终端应答;返回连接是否仍存活。 */
    fun pump(): Boolean {
        var alive = true
        for (event in shell.poll()) {
            when (event) {
                is ServerEvent.Data -> term.feed(event.data)
                is ServerEvent.Eof -> Unit
                is ServerEvent.Close -> alive = false
                is ServerEvent.Disconnected -> alive = false
                is ServerEvent.ExitStatus -> Unit
            }
        }
        for (event in term.takeEvents()) {
            if (event is TerminalEvent.Write) {
                shell.write(event.data)
            }
        }
        return alive
    }

    fun sendRaw(bytes: ByteArray) {
        shell.write(bytes)
    }

    /** 发送 IME 提交的文本;`ctrl`/`alt` 为粘滞修饰键(按一次生效一次)。 */
    fun sendText(text: String, ctrl: Boolean, alt: Boolean) {
        var out = text
        if (ctrl && out.length == 1) {
            val code = out[0].code
            out = when {
                code >= 'a'.code && code <= 'z'.code -> (code - 'a'.code + 1).toChar().toString()
                code >= 'A'.code && code <= 'Z'.code -> (code - 'A'.code + 1).toChar().toString()
                out == "[" -> "\u001b"
                out == "@" -> "\u0000"
                else -> out
            }
        }
        if (alt) out = "\u001b$out"
        sendRaw(out.replace("\n", "\r").toByteArray())
    }

    fun resizeGrid(cols: Int, rows: Int) {
        runCatching { shell.resize(cols.toUInt(), rows.toUInt()) }
        term.resize(cols.toUInt(), rows.toUInt())
    }

    fun close() {
        runCatching { session.disconnect() }
    }
}

/** 建立连接并打开 shell(在 IO 线程调用)。 */
fun connectHost(host: Host, cols: Int = 80, rows: Int = 24): LiveTerminal {
    val auth = when (host.auth) {
        AuthKind.PASSWORD -> AuthMethod.Password(host.password)
        AuthKind.KEY -> AuthMethod.KeyFile(host.keyPath, null)
    }
    val config = HostConfig(
        host.address,
        host.port.toUShort(),
        host.username,
        auth,
        knownKey = host.keyFingerprint.ifBlank { null },
    )
    val session = Session.connect(config)
    val shell = session.openShell(cols.toUInt(), rows.toUInt(), "xterm-256color")
    return LiveTerminal(session, shell, Term(cols.toUInt(), rows.toUInt()), cols, rows)
}