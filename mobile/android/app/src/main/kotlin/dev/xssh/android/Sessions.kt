package dev.xssh.android

import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.NonCancellable
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeoutOrNull
import android.util.Log
import uniffi.xssh_ffi.CursorState
import uniffi.xssh_ffi.InputModes
import uniffi.xssh_ffi.ScreenRow

/**
 * 应用是不是真的在前台。
 *
 * 不能只看 `frame` 有没有收集者:Activity 只是 stopped 时组合并没有销毁,
 * `collectAsState` 还在收,于是"有人看"永远为真,后台照样按 16ms 取整屏文字。
 */
object AppVisibility {
    // 计数而不是布尔:Activity 重建(旋转、折叠切换的某些路径)时,新实例的 onStart
    // 先到、旧实例的 onStop 后到。用布尔的话最后一步把它写成 false,应用明明在前台,
    // 会话却以为没人看、不再往界面送画面 —— 终端整屏空白,只剩顶上的主机名。
    private val started = java.util.concurrent.atomic.AtomicInteger(0)

    val foreground: Boolean get() = started.get() > 0

    fun onStart() {
        started.incrementAndGet()
    }

    fun onStop() {
        started.updateAndGet { (it - 1).coerceAtLeast(0) }
    }
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
    /** 远端程序开着的输入模式:实体键盘按它编码方向键(应用光标模式等)。 */
    val modes: InputModes = DefaultInputModes,
    /** 选区在视口里的部分;null = 没选,或选区整个在视口外。 */
    val selection: uniffi.xssh_ffi.ViewSelection? = null,
    /**
     * 断线后正在自动重连的第几次(从 1 起);0 = 没在重连。
     * 重连期间 [alive] 仍为真:会话还在,只是底下那条连接在换 —— 界面说「重连中」,不说「已断开」。
     */
    val reconnecting: Int = 0,
)

/**
 * 一条**活着的**会话。
 *
 * 关键点:轮询循环长在这里,不在界面里。界面只是观众,来了就看、走了就走,会话照跑。
 * 之前循环长在 Composable 里,于是离开那一屏会话就停了 —— 而服务端的数据是往一个
 * **无界队列**里堆的(`mpsc::unbounded_channel`),没人收就一直涨。
 */
class TerminalSession(
    host: Host,
    jump: Host?,
    private val live: LiveTerminal,
    scope: CoroutineScope,
) {
    val hostId: String = host.id
    val label: String = host.label
    val subtitle: String = host.subtitle

    /**
     * 建会话那一刻的主机。首页会话区直接用它 —— 不查主机表:
     * 主机被删了(或 dev 跳转根本没存过)会话还活着,那一行照样该显示、照样能接管。
     */
    val host: Host = host

    /**
     * 断线自动重连要用的**已解锁**凭据。
     *
     * 加了生物识别锁的主机,连接那一刻验过一次指纹;之后的自动重连是**同一次连接的延续**,
     * 不再弹框 —— 否则切到后台时根本没人能按,而这正是最需要自动重连的时候。
     * 会话结束(用户断开、对端正常退出、重连放弃)就清掉,不在内存里多留。
     *
     * 经跳板机连的,跳板机的凭据一起留着([jumpCredentials]):重连要把两跳都重走一遍。
     */
    @Volatile
    private var credentials: Host? = host

    @Volatile
    private var jumpCredentials: Host? = jump

    /** 底下那条 SSH 连接(端口转发、SFTP 都挂在它上面)。 */
    val session get() = live.session

    /** 同一条连接上的文件(SFTP),第一次打开文件面板时才开通道。 */
    val files = RemoteFiles(live.session, scope)

    /** 会话当前的网格尺寸(首页右栏预览按列宽缩放用)。 */
    val cols: Int get() = live.cols
    val rows: Int get() = live.rows

    private val _frame = MutableStateFlow(TerminalFrame())
    val frame: StateFlow<TerminalFrame> = _frame

    /**
     * 链路状态:0 = 连着,>0 = 正在自动重连(第几次)。
     *
     * 首页会话区要显示这个,但**不能去订阅 [frame]** —— 那会把 `_frame.subscriptionCount`
     * 加一,会话的轮询循环就以为"有人在盯着画面",后台也按 16ms 搬整屏文字(见上面 watched)。
     * 这个流只在状态**变化**时发射;首页订阅它便宜且不误事。
     */
    private val _linkState = MutableStateFlow(0)
    val linkState: StateFlow<Int> = _linkState

    /**
     * 最后一次屏幕有变化的时刻(毫秒)。首页会话行的"几分钟前"用它。
     * volatile:轮询线程写,主线程读,不需要锁,也不会读到撕裂的 long。
     */
    @Volatile
    var lastOutputAt: Long = System.currentTimeMillis()
        private set

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
                if (p.changed && watched) publishFrame()
                p
            }
            // 传输断了(网络换了、服务器没了):先自己连回去。连回来就接着转,屏幕原样留着。
            if (!pumped.alive && pumped.dropped && reconnect()) continue
            if (!pumped.alive) {
                Log.i(TAG, "peer closed ($label)")
                credentials = null
                jumpCredentials = null
                _frame.value = _frame.value.copy(alive = false)
                withContext(NonCancellable + Dispatchers.IO) {
                    files.close()
                    live.close()
                }
                // 对端断了就自己从名单上摘掉。
                //
                // 原来这件事是终端界面用 `LaunchedEffect(dead)` 做的 —— 那就要求
                // 用户**正好开着那一屏**。切出去之后服务器挂了,回到主机页还写着
                // 「运行中」,状态栏的常驻通知也一直挂着,而连接早就没了。
                // 这一屏自己 remember 着 session 引用,摘牌不影响它继续显示最后的输出。
                SessionRegistry.forget(this@TerminalSession)
                // 队列和写协程也要收掉。只 `forget` 就 `break` 的话,`writer` 还挂在
                // `for (op in outbox)` 上等下一条命令,进程级的作用域又一直活着 ——
                // 于是每断一次线就永久漏一个协程,连带整个 TerminalSession
                // (含一整屏的 `ScreenRow`)都回收不掉。而 `shutdown()` 这时已经走不到了:
                // `SessionRegistry.close` 发现自己不在名单上就提前返回。
                outbox.close()
                writer.cancel()
                break
            }
            idle = if (pumped.changed) 0 else idle + 1
            if (pumped.changed) lastOutputAt = System.currentTimeMillis()
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

    /**
     * 往远端写的动作排成**一队**,由同一个协程按顺序执行。
     *
     * 原来界面每按一个键就 `launch(Dispatchers.IO)` 一次,几个协程在线程池里并发跑,
     * 谁先写出去没有保证 —— 实体键盘连着敲 `127.0.0.1`,远端收到的是 `172.0.0.1`。
     * 这些方法可以在主线程直接调,不阻塞。
     */
    private val outbox = Channel<() -> Unit>(Channel.UNLIMITED)
    private val writer: Job = scope.launch(Dispatchers.IO) {
        for (op in outbox) runCatching { op() }.onFailure { Log.w(TAG, "write op failed: ${it.message}") }
    }

    private fun enqueue(op: () -> Unit) {
        outbox.trySend(op)
    }

    /**
     * 断线后自动重连。连上返回 true(屏幕和回滚历史都还在,下面多一行「连接已恢复」);
     * 放弃返回 false,由调用方按"对端断了"收尾。
     *
     * 间隔按 [ReconnectPolicy.delayMillis] 走,网络一恢复就提前试([SessionRegistry.awaitRetry]):
     * Wi-Fi 换到 5G 那一下不必干等倒计时。主机密钥变了、凭据错了这类"再试也没用"的直接放弃 ——
     * 尤其是主机密钥,自动重连绝不能替用户接受一把新的。
     *
     * 这段时间里用户点「断开」:[shutdown] 取消轮询协程,这里的等待和连接随之中断。
     */
    private suspend fun reconnect(): Boolean {
        val host = credentials ?: return false
        val jump = jumpCredentials
        Log.i(TAG, "link dropped ($label), reconnecting")
        // 上一次失败的原因。第一次是 null(按基础间隔);之后交给 delayMillis,
        // 被 PerSourcePenalties 挡住时下一次等待至少 30 秒,别在惩罚窗口里越试越久。
        var lastError: Throwable? = null
        for (attempt in 1..ReconnectPolicy.MAX_ATTEMPTS) {
            _frame.value = _frame.value.copy(reconnecting = attempt)
            _linkState.value = attempt
            SessionRegistry.awaitRetry(ReconnectPolicy.delayMillis(attempt, lastError))
            val result = withContext(Dispatchers.IO) {
                runCatching { openTransport(host, jump, live.cols, live.rows) }
            }
            val transport = result.getOrNull()
            if (transport != null && !job.isActive) {
                // Shutdown (user disconnect / disconnect-all) cancelled this
                // job while the handshake was in flight: the withContext above
                // throws CancellationException after the block completes, and
                // without closing it here the fresh transport — its SSH
                // connection and tokio runtime — would just leak.
                withContext(NonCancellable) { runCatching { transport.first.close() } }
                return false
            }
            if (transport != null) {
                // 分隔行按当前界面语言写;会话层没有 Activity,用应用的 Context(Android 13 起跟着应用语言走)。
                val marker = reconnectedMarker(
                    AppLanguages.appContext?.getString(R.string.term_reconnected_marker) ?: "Reconnected",
                )
                withContext(Dispatchers.IO) { live.reattach(transport.first, transport.second, marker) }
                files.rebind(live.session)
                _frame.value = _frame.value.copy(reconnecting = 0)
                _linkState.value = 0
                Log.i(TAG, "reconnected ($label) on attempt $attempt")
                return true
            }
            val error = result.exceptionOrNull() ?: continue
            lastError = error
            Log.w(TAG, "reconnect $attempt failed ($label): [${error.javaClass.simpleName}] ${error.message}")
            if (ReconnectPolicy.isPermanent(error)) break
        }
        _frame.value = _frame.value.copy(reconnecting = 0)
        _linkState.value = 0
        return false
    }

    fun sendRaw(bytes: ByteArray) = enqueue { live.sendRaw(bytes) }

    fun sendText(text: String, ctrl: Boolean, alt: Boolean) = enqueue { live.sendText(text, ctrl, alt) }

    fun resizeGrid(cols: Int, rows: Int, cellWidthPx: Int, cellHeightPx: Int) =
        enqueue { live.resizeGrid(cols, rows, cellWidthPx, cellHeightPx) }

    /**
     * 取一帧画面并发布出去。
     *
     * **取和发必须是一步**(所以上了锁):推帧的有两条线 —— 轮询循环和滚动(下面的 wheel / scroll)。
     * 不上锁的话,轮询可能先取好快照、还没写出去就被一次滚动插进来,写完之后轮询再把**旧的**那张盖上,
     * 画面就往回跳一帧(下一次轮询才纠正)。快速滑的时候这一下就是肉眼可见的抖。
     */
    private val frameLock = Any()

    private fun publishFrame() = synchronized(frameLock) {
        val s = live.snapshot() ?: return@synchronized
        _frame.value = _frame.value.copy(
            rows = s.rows,
            cursor = s.cursor,
            scrollOffset = s.scrollOffset,
            modes = s.modes,
            selection = s.selection,
        )
    }

    /**
     * 翻历史:滚完**马上**出一帧,不等轮询循环下一次醒来。
     *
     * 轮询是 16ms 一次(约 62 帧/秒),而手指在 120Hz 的屏上每 8ms 拖一次 —— 画面追不上手,
     * 而且每一步还要多等最多 16ms 才看得见,拖长历史时就是一顿一顿的。
     * 现在一步一帧:手指走多快,画面就出多少帧。滚动本身走的是同一条写入队列,顺序不会乱。
     */
    fun scroll(lines: Int) = enqueue { live.scroll(lines); publishFrame() }

    fun wheel(lines: Int, col: Int, row: Int) = enqueue { live.wheel(lines, col, row); publishFrame() }

    fun paste(text: String) = enqueue { live.paste(text) }

    // 选择:和写入排在同一条队列里,顺序才不会乱(先选再复制,复制拿到的一定是选好的)。
    // 和滚动一样当场出一帧 —— 拖选时高亮要跟着手指,不该等轮询那 16ms。
    fun selectStart(row: Int, col: Int, rightHalf: Boolean, kind: uniffi.xssh_ffi.SelectKind) =
        enqueue { live.selectStart(row, col, rightHalf, kind); publishFrame() }

    fun selectUpdate(row: Int, col: Int, rightHalf: Boolean) =
        enqueue { live.selectUpdate(row, col, rightHalf); publishFrame() }

    fun selectClear() = enqueue { live.selectClear(); publishFrame() }

    /**
     * 核心里有没有选区(见 [LiveTerminal.hasSelection])。
     *
     * 注意**不要**拿帧里的 `selection` 当这个用 —— 那个是"在当前视口里的范围",
     * 选区滚出视口就是 null,而核心里那份还在。
     */
    val hasSelection: Boolean get() = live.hasSelection

    /** 取选中的文字交给 [onText](在主线程回调),然后清掉选区。 */
    fun copySelection(onText: (String) -> Unit) = enqueue {
        val text = live.selectionText()
        live.selectClear()
        publishFrame()
        if (!text.isNullOrEmpty()) mainThread.post { onText(text) }
    }

    private val mainThread = android.os.Handler(android.os.Looper.getMainLooper())

    fun applyTheme(p: XsshPalette) = live.applyTheme(p)

    fun scrollToBottom() = enqueue { live.scrollToBottom(); publishFrame() }

    internal fun shutdown() {
        credentials = null
        jumpCredentials = null
        job.cancel()
        outbox.close()
        writer.cancel()
        files.closeAsync()
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

    /**
     * 「全部断开」的次数。
     *
     * [open] 的握手要好几秒、而且**故意放在锁外面**(否则会把断开一起堵死),所以
     * 「全部断开」看不见正在建立的那一条:它几秒后握完手、登记进名单、通知栏又亮起来 ——
     * 用户刚说了全部断开,却冒出一个活着的会话。
     * 记一个代数,握手前后各读一次:中间有人喊过停,这条新连接就地关掉。
     */
    private var closedGeneration = 0

    /** 当前「全部断开」的代数。首次连接重试的间隙里用它判断用户是不是喊过停。 */
    val generation: Int get() = synchronized(lock) { closedGeneration }

    private val _sessions = MutableStateFlow<Map<String, TerminalSession>>(emptyMap())
    val sessions: StateFlow<Map<String, TerminalSession>> = _sessions

    operator fun get(hostId: String): TerminalSession? = _sessions.value[hostId]

    /**
     * 连接并登记(阻塞,在 IO 线程调用)。已经有会话就直接复用。
     *
     * 握手期间用户点了「全部断开」的话,抛 [Cancelled] —— 界面按普通的连接失败处理。
     * [jump] 是已解锁的跳板机(null = 直连)。
     */
    fun open(host: Host, jump: Host?, cols: Int, rows: Int): TerminalSession {
        val generation = synchronized(lock) {
            _sessions.value[host.id]?.let { return it }
            closedGeneration
        }
        // 真正的连接不能放在锁里 —— 它要好几秒,会把 close / 通知栏的全部断开一起堵死。
        val live = connectHost(host, jump, cols, rows)
        synchronized(lock) {
            if (closedGeneration != generation) {
                // 这几秒里用户喊了「全部断开」。刚握完手的这条也算在内,不能让它活下来。
                live.closeAsync()
                throw Cancelled()
            }
            _sessions.value[host.id]?.let { existing ->
                // 这段时间里别人先连上了:把自己这条多余的连接关掉,别让它漏在外面。
                live.closeAsync()
                return existing
            }
            val session = TerminalSession(host, jump, live, scope)
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
            closedGeneration++
            _sessions.value.also { _sessions.value = emptyMap() }
        }
        all.values.forEach { it.shutdown() }
    }

    /** 握手期间被「全部断开」打断。 */
    class Cancelled : Exception("cancelled by disconnect all")

    /** 网络恢复的信号(见 [SessionService] 里的网络回调)。只留最新一次,没人等就丢掉。 */
    private val networkBack = MutableSharedFlow<Unit>(extraBufferCapacity = 1)

    /** 系统报告有可用的网络了:正在等下一次重连的会话立刻去试。 */
    fun onNetworkAvailable() {
        networkBack.tryEmit(Unit)
    }

    /** 等 [millis] 毫秒再重连;这期间网络恢复就提前返回。 */
    suspend fun awaitRetry(millis: Long) {
        withTimeoutOrNull(millis) { networkBack.first() }
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
