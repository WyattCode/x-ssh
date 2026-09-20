package dev.xssh.android

import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import uniffi.xssh_ffi.CursorState

/**
 * 应用是不是真的在前台。
 *
 * 不能只看 `frame` 有没有收集者:Activity 只是 stopped 时组合并没有销毁,
 * `collectAsState` 还在收,于是"有人看"永远为真,后台照样按 16ms 取整屏文字。
 */
object AppVisibility {
    @Volatile
    var foreground: Boolean = false
}

/** 终端某一刻的画面。 */
data class TerminalFrame(
    val lines: List<String> = emptyList(),
    val cursor: CursorState = CursorState(0u, 0u, false),
    val alive: Boolean = true,
    /** 视口离底部多少行;>0 表示正在翻历史,界面要给一个「回到底部」。 */
    val scrollOffset: Int = 0,
)

/**
 * 一条**活着的**会话。
 *
 * 关键点:轮询循环长在这里,不在界面里。界面只是观众,来了就看、走了就走,会话照跑。
 * 之前循环长在 Composable 里,于是离开那一屏会话就停了 —— 而服务端的数据是往一个
 * **无界队列**里堆的(`mpsc::unbounded_channel`),没人收就一直涨。
 */
class TerminalSession(
    val hostId: String,
    val label: String,
    val subtitle: String,
    private val live: LiveTerminal,
    scope: CoroutineScope,
) {
    private val _frame = MutableStateFlow(TerminalFrame())
    val frame: StateFlow<TerminalFrame> = _frame

    private val job: Job = scope.launch {
        var idle = 0
        var wasWatched = false
        while (isActive) {
            // 没人看的时候只管把数据收下来喂给终端,不去把整屏文字搬过 FFI ——
            // 那是最贵的一步,后台跑着纯属白烧电。有人来看了,补取一次完整画面。
            val watched = AppVisibility.foreground && _frame.subscriptionCount.value > 0
            if (watched && !wasWatched) live.markDirty()
            wasWatched = watched

            val pumped = withContext(Dispatchers.IO) {
                val p = live.pump()
                val snapshot = if (p.changed && watched) {
                    Triple(live.term.lines(), live.term.cursor(), live.scrollOffset())
                } else {
                    null
                }
                p to snapshot
            }
            pumped.second?.let { (lines, cursor, offset) ->
                _frame.value = TerminalFrame(lines, cursor, alive = true, scrollOffset = offset)
            }
            if (!pumped.first.alive) {
                _frame.value = _frame.value.copy(alive = false)
                withContext(Dispatchers.IO) { live.close() }
                break
            }
            idle = if (pumped.first.changed) 0 else idle + 1
            // 有人看且有输出:16ms 跟手。安静下来:96ms。没人看(切走了):250ms ——
            // 只要还能把数据收下来不让它堆着就够了,没人等这一帧。
            delay(
                when {
                    !watched -> 250
                    idle > 30 -> 96
                    else -> 16
                },
            )
        }
    }

    fun sendRaw(bytes: ByteArray) = live.sendRaw(bytes)

    fun sendText(text: String, ctrl: Boolean, alt: Boolean) = live.sendText(text, ctrl, alt)

    fun resizeGrid(cols: Int, rows: Int) = live.resizeGrid(cols, rows)

    fun scroll(lines: Int) = live.scroll(lines)

    fun scrollToBottom() = live.scrollToBottom()

    internal fun shutdown() {
        job.cancel()
        live.closeAsync()
    }
}

/**
 * 所有活着的会话。进程级单例 —— 界面来来去去,它不动。
 *
 * 只有两种情况会关掉会话:用户点「断开」(或通知栏的全部断开),以及对端自己断了。
 * 离开终端界面**不再**关会话,那正是「切出去接个电话回来还在」的前提。
 */
object SessionRegistry {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)

    private val _sessions = MutableStateFlow<Map<String, TerminalSession>>(emptyMap())
    val sessions: StateFlow<Map<String, TerminalSession>> = _sessions

    operator fun get(hostId: String): TerminalSession? = _sessions.value[hostId]

    /** 连接并登记(阻塞,在 IO 线程调用)。已经有会话就直接复用。 */
    fun open(host: Host, cols: Int, rows: Int): TerminalSession {
        _sessions.value[host.id]?.let { return it }
        val live = connectHost(host, cols, rows)
        val session = TerminalSession(host.id, host.label, host.subtitle, live, scope)
        _sessions.value = _sessions.value + (host.id to session)
        return session
    }

    fun close(hostId: String) {
        val session = _sessions.value[hostId] ?: return
        _sessions.value = _sessions.value - hostId
        session.shutdown()
    }

    fun closeAll() {
        val all = _sessions.value
        _sessions.value = emptyMap()
        all.values.forEach { it.shutdown() }
    }

    /** 对端断开后把它从名单里摘掉,免得主机页一直显示「运行中」。 */
    fun reap(hostId: String) {
        val session = _sessions.value[hostId] ?: return
        if (!session.frame.value.alive) {
            _sessions.value = _sessions.value - hostId
            session.shutdown()
        }
    }
}
