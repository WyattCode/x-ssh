package dev.xssh.android

import android.util.Log
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch
import uniffi.xssh_ffi.AuthMethod
import uniffi.xssh_ffi.HostConfig
import uniffi.xssh_ffi.JumpHost
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

/**
 * 一帧的结果:连接是否还在、屏幕内容有没有变过。
 *
 * [dropped] 只在 `alive = false` 时有意义:为真是**传输断了**(网络、服务器没了,该自动重连),
 * 为假是**正常结束**(`exit`、tmux 里 detach,或者我们自己关的),不该连回去。见 [linkOutcome]。
 */
data class Pumped(val alive: Boolean, val changed: Boolean, val dropped: Boolean = false)

/** 从核心取回的一帧画面。 */
data class Snapshot(
    val rows: List<ScreenRow>,
    val cursor: uniffi.xssh_ffi.CursorState,
    val scrollOffset: Int,
    val modes: uniffi.xssh_ffi.InputModes,
    /** 选区在视口里的范围(核心记在网格坐标上,新输出滚上来时跟着内容走)。 */
    val selection: uniffi.xssh_ffi.ViewSelection?,
)

/** 一条活动会话:SSH 连接 + 通道 + 终端状态机。所有方法都必须在 IO 线程调用。 */
class LiveTerminal(
    session: Session,
    shell: Shell,
    val term: Term,
    cols: Int,
    rows: Int,
) {
    /**
     * 底下那条连接。断线重连时整条换掉([reattach]),而 [term] —— 屏幕、回滚历史、选区 —— 留着:
     * 用户连回来看到的还是断线前的输出,不是一块空屏。
     */
    @Volatile
    var session: Session = session
        private set

    @Volatile
    private var shell: Shell = shell

    /** 现在的行列数(跟着 [resizeGrid] 走)。重连时新通道按它开,不然全屏程序会按 80×24 画。 */
    @Volatile
    var cols: Int = cols
        private set

    @Volatile
    var rows: Int = rows
        private set

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

    /** 调试录制(默认关,见 [DebugRecorder])。 */
    private val recording: Recording? = DebugRecorder.open()?.also { it.resize(cols, rows) }

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
            // 和 close() 撞上了:对象刚被释放。按"连接已断"处理 —— 是我们自己关的,不算掉线。
            Pumped(alive = false, changed = false)
        }
    }

    /**
     * 断线重连:换上新的连接和通道,屏幕([term])原样留着。
     *
     * 旧的那两个对象已经死了,这里释放掉(每条连接在 Rust 里各有一个 tokio 运行时,
     * 不释放就漏两个线程)。新通道按**现在**的行列数调一次,再往屏幕上写一行分隔。
     */
    fun reattach(newSession: Session, newShell: Shell, marker: String) {
        val oldSession: Session
        val oldShell: Shell
        synchronized(this) {
            if (closed) {
                // 重连的这几秒里用户点了断开:新连接没人要了,关掉。
                runCatching { newSession.disconnect() }
                runCatching { newShell.destroy() }
                runCatching { newSession.destroy() }
                return
            }
            oldSession = session
            oldShell = shell
            session = newSession
            shell = newShell
        }
        runCatching { oldShell.destroy() }
        runCatching { oldSession.disconnect() }
        runCatching { oldSession.destroy() }
        runCatching { newShell.resize(cols.toUInt(), rows.toUInt()) }
        runCatching { term.scrollToBottom() }
        runCatching { term.feed(marker.toByteArray()) }
        dirty = true
    }

    /** 当前画面(样式段 + 光标 + 回滚偏移 + 输入模式)。关闭后返回 null。 */
    fun snapshot(): Snapshot? {
        if (closed) return null
        return runCatching {
            Snapshot(term.rows(), term.cursor(), term.scrollOffset().toInt(), term.inputModes(), term.viewSelection())
        }.getOrNull()
    }

    /**
     * 滚轮 / 双指滑动 [lines] 行(正数 = 往上看更早的内容),[col]/[row] 是指针所在的格子。
     * 全屏程序要的是按键或鼠标事件,普通 shell 才翻本地的回滚缓冲(见 [KeyEncoder.wheel])。
     */
    fun wheel(lines: Int, col: Int, row: Int) {
        if (closed) return
        val modes = runCatching { term.inputModes() }.getOrNull() ?: return
        val bytes = KeyEncoder.wheel(lines, col, row, modes)
        if (bytes == null) scroll(lines) else sendRaw(bytes.toByteArray())
    }

    /** 开始选择(视口坐标)。 */
    /**
     * 核心里**有没有**选区。
     *
     * 和帧里的 `selection` 不是一回事:那个是"选区在当前视口里的范围",选区整个滚出视口
     * 之后它是 null,而核心里那份还在。界面原来拿它当"有没有选区"用,于是选区滚出去之后
     * 就再也清不掉了 —— 打字不清、`Ctrl+Shift+C` 还能把看不见的那段复制走。
     */
    var hasSelection = false
        private set

    fun selectStart(row: Int, col: Int, rightHalf: Boolean, kind: uniffi.xssh_ffi.SelectKind) {
        if (closed) return
        runCatching { term.selectStart(row.toUInt(), col.toUInt(), rightHalf, kind) }
        hasSelection = true
        dirty = true
    }

    fun selectUpdate(row: Int, col: Int, rightHalf: Boolean) {
        if (closed) return
        runCatching { term.selectUpdate(row.toUInt(), col.toUInt(), rightHalf) }
        hasSelection = true
        dirty = true
    }

    fun selectClear() {
        if (closed) return
        runCatching { term.selectClear() }
        hasSelection = false
        dirty = true
    }

    /** 选中的文字;没选时为 null。 */
    fun selectionText(): String? = if (closed) null else runCatching { term.selectionText() }.getOrNull()

    /** 粘贴一段文字(开了括号粘贴的程序会收到包好的整段)。 */
    fun paste(text: String) {
        if (closed || text.isEmpty()) return
        val modes = runCatching { term.inputModes() }.getOrNull() ?: DefaultInputModes
        sendRaw(KeyEncoder.paste(text, modes).toByteArray())
    }

    private fun pumpOnce(): Pumped {
        var changed = false
        val events = shell.poll()
        for (event in events) {
            if (event is ServerEvent.Data) {
                recording?.data(event.data)
                term.feed(event.data)
                changed = true
            }
        }
        val outcome = linkOutcome(events)
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
        return Pumped(
            alive = outcome == LinkOutcome.Alive,
            changed = changed,
            dropped = outcome == LinkOutcome.Dropped,
        )
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

    /** 终端配色:16 色 + 前景/背景/光标。换了之后整屏重新解析颜色。 */
    fun applyTheme(p: XsshPalette) {
        if (closed) return
        fun rgb(c: androidx.compose.ui.graphics.Color) = (c.value shr 32).toInt().toUInt() and 0xFFFFFFu
        runCatching {
            term.setPalette(p.term16.map { it.toUInt() })
            term.setTheme(rgb(p.termFg), rgb(p.termBg), rgb(p.termCursor))
        }
        dirty = true
    }

    /** 强制下一帧取一次完整画面(界面刚回来看,或者行列变了)。 */
    fun markDirty() {
        dirty = true
    }

    fun resizeGrid(cols: Int, rows: Int, cellWidthPx: Int, cellHeightPx: Int) {
        if (closed) return
        this.cols = cols
        this.rows = rows
        runCatching { shell.resize(cols.toUInt(), rows.toUInt()) }
        runCatching { term.resize(cols.toUInt(), rows.toUInt()) }
        recording?.resize(cols, rows)
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
        recording?.close()
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

/** 建立连接并打开 shell(在 IO 线程调用)。[jump] 是已解锁的跳板机,null = 直连。 */
fun connectHost(host: Host, jump: Host?, cols: Int = 80, rows: Int = 24): LiveTerminal {
    val (session, shell) = openTransport(host, jump, cols, rows)
    return LiveTerminal(session, shell, Term(cols.toUInt(), rows.toUInt()), cols, rows)
}

/** 一台主机的登录方式,交给核心。凭据必须已经解锁([unlockCredentials])。 */
private fun authOf(host: Host): AuthMethod = when (host.auth) {
    AuthKind.PASSWORD -> AuthMethod.Password(host.password)
    // 导入的私钥:解密后的文本只在内存里交给核心;老数据 / 调试用的私钥文件路径照旧。
    AuthKind.KEY -> if (host.keyData.isNotEmpty()) {
        AuthMethod.KeyData(host.keyData, host.keyPassphrase.ifEmpty { null })
    } else {
        AuthMethod.KeyFile(host.keyPath, host.keyPassphrase.ifEmpty { null })
    }
}

/**
 * 连上并认证,打开交互通道(在 IO 线程调用)。首次连接和断线重连都走这里。
 *
 * 主机开了「连接后进入 tmux」时,通道里直接跑 [TMUX_COMMAND](带 PTY 的 exec),
 * 而不是先开 shell 再把命令敲进去 —— 后者要等提示符出来,中间还会被 `.bashrc` 的输出搅乱。
 * exec 本身失败(服务器不给 exec、Windows 的 OpenSSH 没有 sh)就退回普通 shell。
 */
fun openTransport(host: Host, jump: Host?, cols: Int, rows: Int): Pair<Session, Shell> {
    val config = HostConfig(
        host.address,
        host.port.toUShort(),
        host.username,
        authOf(host),
        // 多把已信任指纹用换行拼进 known_key;核心 verify_host_key 认其中任意一把。
        knownKey = host.trustedHostKeys().joinToString("\n").ifBlank { null },
        // 跳板机的密钥单独验、单独存(见 FfiException.JumpHostKey*)。
        jump = jump?.let {
            JumpHost(it.address, it.port.toUShort(), it.username, authOf(it), it.trustedHostKeys().joinToString("\n").ifBlank { null })
        },
    )
    val started = System.currentTimeMillis()
    fun elapsed() = System.currentTimeMillis() - started
    val via = jump?.let { " via ${it.address}:${it.port}" }.orEmpty()
    Log.i(TAG, "connect ${host.address}:${host.port}$via auth=${host.auth}")
    val session = try {
        Session.connect(config)
    } catch (e: Throwable) {
        // 类名和消息之间要有分隔:uniffi 的异常类叫 `Message`,直接拼起来就是
        // 「Message authentication failed」—— 读着像 MAC 校验失败,实际是普通的认证失败。
        // (真按这个读下去会一路查到密钥交换和加密套件上,白花一个多小时。)
        Log.w(TAG, "connect failed after ${elapsed()}ms: [${e.javaClass.simpleName}] ${e.message}")
        throw e
    }
    Log.i(TAG, "authenticated in ${elapsed()}ms")
    // 连接已经建立了,再开 shell 才失败(服务端不给 pty、通道数满了)的话,
    // 这条连接就没人认领了 —— 调用方只看到异常,拿不到 session,关不掉。
    val shell = try {
        val tmux = if (host.tmux) {
            runCatching { session.openExec(cols.toUInt(), rows.toUInt(), "xterm-256color", TMUX_COMMAND) }
                .onFailure { Log.w(TAG, "tmux exec refused, falling back to a shell: ${it.message}") }
                .getOrNull()
        } else {
            null
        }
        tmux ?: session.openShell(cols.toUInt(), rows.toUInt(), "xterm-256color")
    } catch (e: Throwable) {
        Log.w(TAG, "open shell failed after ${elapsed()}ms: ${e.message}")
        runCatching { session.disconnect() }
        runCatching { session.destroy() }
        throw e
    }
    Log.i(TAG, "shell open in ${elapsed()}ms (tmux=${host.tmux})")
    // 保存的端口转发:逐条开,单条失败不伤 shell(界面自己看 forwards() / toast)。
    if (host.portForwards.isNotEmpty()) {
        val failed = applySavedForwards(session, host)
        if (failed > 0) {
            Log.w(TAG, "port forward: $failed/${host.portForwards.size} failed")
        } else {
            Log.i(TAG, "port forward: opened ${host.portForwards.size}")
        }
    }
    return session to shell
}