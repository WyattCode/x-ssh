package dev.xssh.android

import android.util.Log
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch
import uniffi.xssh_ffi.AuthMethod
import uniffi.xssh_ffi.HostConfig
import uniffi.xssh_ffi.ScreenRow
import uniffi.xssh_ffi.ServerEvent
import uniffi.xssh_ffi.Session
import uniffi.xssh_ffi.Shell
import uniffi.xssh_ffi.Term
import uniffi.xssh_ffi.TerminalEvent

/**
 * 专门用来关会话的作用域,活得比任何界面都久。
 *
 * 不能用 `rememberCoroutineScope()` 关会话:界面离开组合时那个作用域**自己先被取消**,
 * 关闭动作可能还没被调度就没了,远端 shell 就一直挂着。
 */
private val sessionCleanup = CoroutineScope(SupervisorJob() + Dispatchers.IO)

/** logcat 标签。连接卡住时用 `adb logcat -s xssh` 看停在哪一步。 */
const val TAG = "xssh"

/** 一帧的结果:连接是否还在、屏幕内容有没有变过。 */
data class Pumped(val alive: Boolean, val changed: Boolean)

/** 一条活动会话:SSH 连接 + 通道 + 终端状态机。所有方法都必须在 IO 线程调用。 */
class LiveTerminal(
    val session: Session,
    val shell: Shell,
    val term: Term,
    val cols: Int,
    val rows: Int,
) {
    /**
     * 屏幕内容自上次取走之后有没有变过。首帧必须为真(要取一次初始画面),
     * 改了行列数也算变 —— 那时没有新数据,但折行结果不一样了。
     */
    @Volatile
    private var dirty = true

    /**
     * 关过了。之后所有方法都是空操作 —— Rust 对象已经释放,再调会抛
     * `IllegalStateException`,而这些调用多半在没装异常处理的协程里,抛出去就是整个应用崩掉。
     */
    @Volatile
    private var closed = false

    /**
     * 收服务端消息 → 喂终端 → 回写终端应答。
     *
     * 返回值里的 [Pumped.changed] 是给调用方省钱用的:取整屏文字要跨 FFI 搬几十个
     * 字符串,是这个每帧循环里最贵的一步,没有新数据时完全不必做。
     */
    fun pump(): Pumped {
        if (closed) return Pumped(alive = false, changed = false)
        return try {
            pumpOnce()
        } catch (e: IllegalStateException) {
            // 和 close() 撞上了:对象刚被释放。按"连接已断"处理。
            Pumped(alive = false, changed = false)
        }
    }

    /** 当前画面(样式段 + 光标 + 回滚偏移)。关闭后返回 null。 */
    fun snapshot(): Triple<List<ScreenRow>, uniffi.xssh_ffi.CursorState, Int>? {
        if (closed) return null
        return runCatching {
            Triple(term.rows(), term.cursor(), term.scrollOffset().toInt())
        }.getOrNull()
    }

    private fun pumpOnce(): Pumped {
        var alive = true
        var changed = false
        for (event in shell.poll()) {
            when (event) {
                is ServerEvent.Data -> {
                    term.feed(event.data)
                    changed = true
                }
                is ServerEvent.Eof -> Unit
                is ServerEvent.Close -> alive = false
                is ServerEvent.Disconnected -> alive = false
                is ServerEvent.ExitStatus -> Unit
            }
        }
        // 同步刷新(CSI ? 2026)超时要宿主自己触发,否则攒着的那一帧永远放不出来 ——
        // Codex 进去整屏空白就是这个(见 Rust Terminal::tick)。每一帧都调。
        if (term.tick()) changed = true
        for (event in term.takeEvents()) {
            if (event is TerminalEvent.Write) {
                shell.write(event.data)
            }
        }
        if (dirty) {
            changed = true
            dirty = false
        }
        return Pumped(alive, changed)
    }

    fun sendRaw(bytes: ByteArray) {
        if (closed) return
        // 一敲键盘就回到底部:翻着历史时收到自己的回显却看不见,是最让人困惑的状态。
        runCatching { term.scrollToBottom() }
        // 写失败(连接已断、超时)不抛:断没断由轮询那边报。
        runCatching { shell.write(bytes) }.onFailure { Log.w(TAG, "write failed: ${it.message}") }
        // 刚发出去就等着回显:标记一下,让轮询立刻从省电的低频回到 16ms。
        // 不然停顿之后敲的第一个字,回显会慢将近 100ms —— 终端里这个最容易被感觉到。
        dirty = true
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

    /** 往回翻 [lines] 行(正数看更早的内容)。 */
    fun scroll(lines: Int) {
        if (closed) return
        runCatching { term.scroll(lines) }
        dirty = true
    }

    /** 回到底部。 */
    fun scrollToBottom() {
        if (closed) return
        runCatching { term.scrollToBottom() }
        dirty = true
    }

    /** 强制下一帧取一次完整画面(界面刚回来看,或者行列变了)。 */
    fun markDirty() {
        dirty = true
    }

    fun resizeGrid(cols: Int, rows: Int, cellWidthPx: Int, cellHeightPx: Int) {
        if (closed) return
        runCatching { shell.resize(cols.toUInt(), rows.toUInt()) }
        runCatching { term.resize(cols.toUInt(), rows.toUInt()) }
        // 回答"窗口多大(像素)"这类查询时要用。
        runCatching { term.setCellPixels(cellWidthPx.toUInt(), cellHeightPx.toUInt()) }
        // 行列变了,即使没有新数据,整屏的折行结果也不一样了。
        dirty = true
    }

    /**
     * 断开并**释放 Rust 对象**。可以重复调用。
     *
     * 每条连接在 Rust 里各有一个 tokio 运行时(2 个工作线程)。原来这里只 disconnect、
     * 从不 destroy,对象要等 GC 哪天想起来才回收 —— 实测连了 4 次、全部断开之后,
     * 进程里还挂着 8 个 xssh-net 线程。
     */
    fun close() {
        synchronized(this) {
            if (closed) return
            closed = true
        }
        runCatching { session.disconnect() }
        runCatching { shell.destroy() }
        runCatching { session.destroy() }
        runCatching { term.destroy() }
        Log.i(TAG, "session closed and released")
    }

    /**
     * 异步断开。界面**每一条**退出路径都走这里(含系统返回键),可以重复调用 ——
     * 只有这样远端 shell 才会立刻收掉,而不是等 TCP 超时或进程被杀。
     */
    fun closeAsync() {
        sessionCleanup.launch { runCatching { close() } }
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
    val started = System.currentTimeMillis()
    fun elapsed() = System.currentTimeMillis() - started
    Log.i(TAG, "connect ${host.address}:${host.port} auth=${host.auth}")
    val session = try {
        Session.connect(config)
    } catch (e: Throwable) {
        Log.w(TAG, "connect failed after ${elapsed()}ms: ${e.javaClass.simpleName} ${e.message}")
        throw e
    }
    Log.i(TAG, "authenticated in ${elapsed()}ms")
    // 连接已经建立了,再开 shell 才失败(服务端不给 pty、通道数满了)的话,
    // 这条连接就没人认领了 —— 调用方只看到异常,拿不到 session,关不掉。
    val shell = try {
        session.openShell(cols.toUInt(), rows.toUInt(), "xterm-256color")
    } catch (e: Throwable) {
        Log.w(TAG, "open shell failed after ${elapsed()}ms: ${e.message}")
        runCatching { session.disconnect() }
        runCatching { session.destroy() }
        throw e
    }
    Log.i(TAG, "shell open in ${elapsed()}ms")
    return LiveTerminal(session, shell, Term(cols.toUInt(), rows.toUInt()), cols, rows)
}