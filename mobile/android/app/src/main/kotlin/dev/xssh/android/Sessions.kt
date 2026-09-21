package dev.xssh.android

import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.NonCancellable
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import android.util.Log
import uniffi.xssh_ffi.CursorState
import uniffi.xssh_ffi.ScreenRow

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

/**
 * 运行时权限这一趟进程里问过没有。
 *
 * 不能用 `remember` 记 —— 那是跟着某一屏活的,离开终端再进来就又问一遍。
 * 给了最好,不给也照常连(前台服务照跑,只是没有常驻通知)。
 */
object PermissionAsked {
    @Volatile
    var notifications: Boolean = false

    @Volatile
    var localNetwork: Boolean = false
}

/** 终端某一刻的画面。 */
data class TerminalFrame(
    /** 逐行样式段:保留列位置与颜色(见 Rust 的 `Term::rows`)。 */
    val rows: List<ScreenRow> = emptyList(),
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
                val snapshot = if (p.changed && watched) live.snapshot() else null
                p to snapshot
            }
            pumped.second?.let { (rows, cursor, offset) ->
                _frame.value = TerminalFrame(rows, cursor, alive = true, scrollOffset = offset)
            }
            if (!pumped.first.alive) {
                Log.i(TAG, "peer closed ($label)")
                _frame.value = _frame.value.copy(alive = false)
                withContext(NonCancellable + Dispatchers.IO) { live.close() }
                // 对端断了就自己从名单上摘掉。
                //
                // 原来这件事是终端界面用 `LaunchedEffect(dead)` 做的 —— 那就要求
                // 用户**正好开着那一屏**。切出去之后服务器挂了,回到主机页还写着
                // 「运行中」,状态栏的常驻通知也一直挂着,而连接早就没了。
                // 这一屏自己 remember 着 session 引用,摘牌不影响它继续显示最后的输出。
                SessionRegistry.forget(this@TerminalSession)
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

    /**
     * 名单的改动一律在这把锁里做。
     *
     * `_sessions.value = _sessions.value + x` 是读-改-写,不是原子的;而 [open] 中间
     * 还夹着一次要好几秒的真实连接。两次并发的 open(连点两下卡片、信任密钥后重连
     * 撞上原来那次)会各连一条,后一条把前一条挤出名单 —— 被挤掉的那条谁也关不掉,
     * 它的轮询循环就在进程级作用域里一直跑。
     */
    private val lock = Any()

    private val _sessions = MutableStateFlow<Map<String, TerminalSession>>(emptyMap())
    val sessions: StateFlow<Map<String, TerminalSession>> = _sessions

    operator fun get(hostId: String): TerminalSession? = _sessions.value[hostId]

    /** 连接并登记(阻塞,在 IO 线程调用)。已经有会话就直接复用。 */
    fun open(host: Host, cols: Int, rows: Int): TerminalSession {
        synchronized(lock) { _sessions.value[host.id] }?.let { return it }
        // 真正的连接不能放在锁里 —— 它要好几秒,会把 close / 通知栏的全部断开一起堵死。
        val live = connectHost(host, cols, rows)
        synchronized(lock) {
            _sessions.value[host.id]?.let { existing ->
                // 这段时间里别人先连上了:把自己这条多余的连接关掉,别让它漏在外面。
                live.closeAsync()
                return existing
            }
            val session = TerminalSession(host.id, host.label, host.subtitle, live, scope)
            _sessions.value = _sessions.value + (host.id to session)
            return session
        }
    }

    fun close(hostId: String) {
        val session = synchronized(lock) {
            _sessions.value[hostId]?.also { _sessions.value = _sessions.value - hostId }
        } ?: return
        session.shutdown()
    }

    fun closeAll() {
        val all = synchronized(lock) {
            _sessions.value.also { _sessions.value = emptyMap() }
        }
        all.values.forEach { it.shutdown() }
    }

    /**
     * 对端断开后把它从名单上摘掉。由会话自己的轮询循环调用 —— 连接它已经关过了,
     * 这里只改名单,不再 shutdown(那会在协程里取消它自己)。
     *
     * 比对的是**实例**而不是 id:万一同一台主机已经有了新会话,别把新的摘掉。
     */
    internal fun forget(session: TerminalSession) {
        synchronized(lock) {
            if (_sessions.value[session.hostId] === session) {
                _sessions.value = _sessions.value - session.hostId
            }
        }
    }
}
