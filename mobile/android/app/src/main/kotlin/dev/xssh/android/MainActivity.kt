package dev.xssh.android

import kotlin.coroutines.cancellation.CancellationException
import kotlinx.coroutines.launch
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveableStateHolder
import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.core.SeekableTransitionState
import androidx.compose.animation.core.rememberTransition
import android.graphics.drawable.ColorDrawable
import android.graphics.Color
import android.content.res.Configuration
import android.os.Bundle
import android.content.Context
import androidx.activity.ComponentActivity
import androidx.activity.compose.PredictiveBackHandler
import androidx.activity.compose.setContent
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.compositionLocalOf
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalWindowInfo
import androidx.compose.ui.unit.dp
import android.view.KeyEvent
import android.view.KeyboardShortcutGroup
import android.view.KeyboardShortcutInfo
import android.view.Menu

class MainActivity : ComponentActivity() {
    /**
     * 系统的键盘快捷键面板(按住 Meta 或 Meta+/)里列出本应用的快捷键 ——
     * 快捷键要"找得到",不能只写在代码里(HIG:键盘快捷键的可发现性)。
     */
    override fun onProvideKeyboardShortcuts(data: MutableList<KeyboardShortcutGroup>, menu: Menu?, deviceId: Int) {
        super.onProvideKeyboardShortcuts(data, menu, deviceId)
        val ctrlShift = KeyEvent.META_CTRL_ON or KeyEvent.META_SHIFT_ON
        data += KeyboardShortcutGroup(
            "X-SSH",
            listOf(
                KeyboardShortcutInfo(getString(R.string.main_sc_new_host), KeyEvent.KEYCODE_N, ctrlShift),
                KeyboardShortcutInfo(getString(R.string.main_sc_search), KeyEvent.KEYCODE_F, ctrlShift),
                KeyboardShortcutInfo(getString(R.string.main_sc_edit_host), KeyEvent.KEYCODE_E, ctrlShift),
                KeyboardShortcutInfo(getString(R.string.main_sc_sidebar), KeyEvent.KEYCODE_S, ctrlShift),
                KeyboardShortcutInfo(getString(R.string.main_sc_next_session), KeyEvent.KEYCODE_TAB, KeyEvent.META_CTRL_ON),
                KeyboardShortcutInfo(getString(R.string.main_sc_prev_session), KeyEvent.KEYCODE_TAB, ctrlShift),
                KeyboardShortcutInfo(getString(R.string.main_sc_close_session), KeyEvent.KEYCODE_W, ctrlShift),
                KeyboardShortcutInfo(getString(R.string.main_sc_toggle_files), KeyEvent.KEYCODE_O, ctrlShift),
                KeyboardShortcutInfo(getString(R.string.main_sc_paste), KeyEvent.KEYCODE_V, ctrlShift),
                KeyboardShortcutInfo(getString(R.string.main_sc_ime), KeyEvent.KEYCODE_SPACE, ctrlShift),
                KeyboardShortcutInfo(getString(R.string.main_sc_zoom_in), KeyEvent.KEYCODE_EQUALS, ctrlShift),
                KeyboardShortcutInfo(getString(R.string.main_sc_zoom_out), KeyEvent.KEYCODE_MINUS, ctrlShift),
            ),
        )
    }

    /** Android 12 及更早:应用内选的界面语言要自己套上(13 起系统按应用语言处理,见 [AppLanguages])。 */
    override fun attachBaseContext(newBase: Context) {
        super.attachBaseContext(AppLanguages.wrap(newBase))
    }

    override fun onStart() {
        super.onStart()
        AppVisibility.onStart()
    }

    override fun onStop() {
        AppVisibility.onStop()
        super.onStop()
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        XsshFonts.init(this)
        AppLanguages.appContext = applicationContext
        // 调试录制只在可调试的包里可用(还要有 files/record 标记文件才真的录)。
        if (applicationInfo.flags and android.content.pm.ApplicationInfo.FLAG_DEBUGGABLE != 0) {
            DebugRecorder.dir = filesDir
        }
        // 开发用:adb start 带 --es devAutoConnect <地址> [--es devUser u] [--es devPassword p]
        // 可直接进入终端联调/自动化;正式版本不带这些 extra 时行为不变。
        val dev = intent?.getStringExtra("devAutoConnect")?.takeIf { it.isNotBlank() }?.let { address ->
            // 端口用 --ei devPort 或 --es devPort;私钥用 --es devKeyPath 指向 App 私有目录里的文件。
            val port = intent.getIntExtra("devPort", 0).takeIf { it > 0 }
                ?: intent.getStringExtra("devPort")?.toIntOrNull()
                ?: 22
            DevTarget(
                address = address,
                user = intent.getStringExtra("devUser"),
                password = intent.getStringExtra("devPassword"),
                port = port,
                keyPath = intent.getStringExtra("devKeyPath"),
            )
        }
        val prefs = UiPrefs(this)
        // 让系统也知道 app 选的是哪种外观。点开 app 的第一帧是**系统画的启动窗口**,
        // 那时这里的代码还没跑,系统只看夜间模式配置来挑 values / values-night 的底色 ——
        // 不告诉它,app 里选了深色而手机是浅色时,启动还是会先闪一下白。
        applyNightMode(this, prefs.themeMode)
        // 冷启动底色要和选中的外观一致:选了深色而系统是浅色时,
        // 资源里的 windowBackground 是白的,不在这里改就会先闪一下白。
        val systemDark = (resources.configuration.uiMode and Configuration.UI_MODE_NIGHT_MASK) ==
            Configuration.UI_MODE_NIGHT_YES
        val startDark = when (prefs.themeMode) {
            ThemeMode.Light -> false
            ThemeMode.Dark -> true
            ThemeMode.System -> systemDark
        }
        window.setBackgroundDrawable(ColorDrawable(if (startDark) Color.BLACK else Color.WHITE))

        setContent {
            var mode by remember { mutableStateOf(prefs.themeMode) }
            XsshTheme(mode) {
                // 每一帧的窗口形态(尺寸档 + 铰链)只算一次,所有界面从这里取。
                CompositionLocalProvider(
                    LocalAdaptive provides rememberAdaptive(),
                    LocalChrome provides remember { detectChrome(this) },
                    LocalThemeControl provides ThemeControl(mode) {
                        mode = it
                        prefs.themeMode = it
                        applyNightMode(this, it)
                    },
                ) {
                    App(dev)
                }
            }
        }
    }
}

/**
 * 按 app 设置夜间模式(Android 12+,系统会记住)。之后系统画这个 app 的启动窗口时,
 * 就按这里的选择去挑浅色 / 深色的底色。跟随系统就交还给系统(AUTO)。
 */
private fun applyNightMode(context: android.content.Context, mode: ThemeMode) {
    if (android.os.Build.VERSION.SDK_INT < android.os.Build.VERSION_CODES.S) return
    val manager = context.getSystemService(android.app.UiModeManager::class.java) ?: return
    val target = when (mode) {
        ThemeMode.Light -> android.app.UiModeManager.MODE_NIGHT_NO
        ThemeMode.Dark -> android.app.UiModeManager.MODE_NIGHT_YES
        ThemeMode.System -> android.app.UiModeManager.MODE_NIGHT_AUTO
    }
    runCatching { manager.setApplicationNightMode(target) }
}

/** 开发联调用目标(仅来自 adb intent extra,不落盘)。 */
data class DevTarget(
    val address: String,
    val user: String?,
    val password: String?,
    val port: Int = 22,
    val keyPath: String? = null,
)

sealed interface Screen {
    data object Home : Screen

    /** 单栏的主机详情页(卡片上的 ⓘ)。只记 id:编辑保存后回来显示的是新内容。 */
    data class HostInfo(val hostId: String) : Screen

    /** 选终端字体。 */
    data object Fonts : Screen

    /** [back]:从哪一页进来的,返回回到那里(详情页进来的回详情页)。 */
    data class Editor(val host: Host?, val back: Screen = Home) : Screen
    data class Terminal(val host: Host, val back: Screen = Home) : Screen

    /** 某条连接的文件页(从终端推进来,返回回到终端)。 */
    data class Files(val terminal: Terminal) : Screen {
        val host: Host get() = terminal.host
    }
}

/** 返回回到哪一页。 */
private fun Screen.parent(): Screen = when (this) {
    Screen.Home -> Screen.Home
    is Screen.HostInfo -> Screen.Home
    Screen.Fonts -> Screen.Home
    is Screen.Editor -> back
    is Screen.Terminal -> back
    is Screen.Files -> terminal
}

/** 页面的层级:往深处走是"推入",往浅处走是"退出"(决定页面从哪边滑)。 */
private fun Screen.depth(): Int = when (this) {
    Screen.Home -> 0
    is Screen.HostInfo, Screen.Fonts -> 1
    else -> parent().depth() + 1
}

/**
 * 全部已保存的主机。跳板机按 id 引用另一台主机(见 [Host.jumpHostId]),
 * 编辑页选它、详情页显示它、终端连接时解锁它,都要从这里现查 —— 不必把列表一层层往下传。
 */
val LocalHosts = compositionLocalOf<List<Host>> { emptyList() }

/**
 * 应用壳:主机 → 终端 / 编辑器。布局形态由 [LocalAdaptive] 决定,各界面自己适配。
 */
@Composable
fun App(devTarget: DevTarget? = null) {
    val context = LocalContext.current
    val store = remember { HostStore(context) }
    var hosts by remember { mutableStateOf(orderHosts(store.load())) }

    // 正开着的是哪条会话 —— 这一项要活过 Activity 重建。
    //
    // `configChanges` 挡掉了折叠、旋转、改字号这些,但挡不掉全部(系统语言、
    // 分屏进出的某些路径都会重建)。重建之后 SSH 会话在 SessionRegistry 里还活着,
    // 丢的只是"我刚才在哪一屏" —— 表现就是正敲着命令突然被踢回主机列表。
    var termHostId by rememberSaveable { mutableStateOf<String?>(null) }
    // 折叠屏双终端的右侧会话 id。合上外屏**不清** —— 会话仍在 SessionRegistry,展开后原样配对。
    var termCompanionId by rememberSaveable { mutableStateOf<String?>(null) }
    // 双终端当前收键盘的那一侧。
    var paneFocusSide by rememberSaveable { mutableStateOf(PaneSide.Left.name) }
    val paneFocus = runCatching { PaneSide.valueOf(paneFocusSide) }.getOrDefault(PaneSide.Left)
    fun setPaneFocus(side: PaneSide) { paneFocusSide = side.name }
    // 正开着设置页。在设置里换了语言,系统会重建整个界面 —— 不记着的话,一换语言就被踢回主机页。
    var onSettings by rememberSaveable { mutableStateOf(false) }
    var screen by remember {
        // 在**第一次组合时**就算出来,不要等副作用 —— 否则会先渲染一帧主机页再跳走。
        val restored = termHostId
            ?.takeIf { SessionRegistry[it] != null }
            ?.let { id -> hosts.firstOrNull { it.id == id } }
        mutableStateOf<Screen>(
            when {
                restored != null -> Screen.Terminal(restored)
                onSettings -> Screen.Fonts
                else -> Screen.Home
            },
        )
    }
    LaunchedEffect(screen) { onSettings = screen == Screen.Fonts }
    var selectedId by rememberSaveable { mutableStateOf<String?>(null) }

    LaunchedEffect(Unit) {
        val target = devTarget ?: return@LaunchedEffect
        val existing = hosts.firstOrNull {
            (it.address == target.address || it.label == target.address) && it.port == target.port
        }
        val host = existing ?: Host(
            name = target.address,
            address = target.address,
            port = target.port,
            username = target.user.orEmpty(),
            auth = if (target.password != null) AuthKind.PASSWORD else AuthKind.KEY,
            keyPath = target.keyPath ?: context.filesDir.resolve("xssh_dev_key").absolutePath,
            password = target.password.orEmpty(),
        )
        selectedId = host.id
        termHostId = host.id
        screen = Screen.Terminal(host)
    }

    fun persist(list: List<Host>) {
        // 存和显示都走同一个顺序(置顶 → 最近使用 → 添加顺序);
        // 存排序后的列表,插入顺序作为并列时的兜底也一并固化下来。
        val sorted = orderHosts(list)
        // 数据安全护栏:内存里一台主机都没有、磁盘上却还有主机时,唯一可能的来路是
        // Activity 重建后 load 失败(密钥没就绪 → getOrDefault(空) —— 见 HostStore.load)。
        // 此时绝不能把空表落盘:2026-10-10 真机上发生过一次,一次普通的"确认删除"
        // 就把用户全部主机抹掉了(靠会话开头的备份才恢复)。正常删掉最后一台主机
        // 不走这里 —— 那时内存里还有 1 台,不会命中这个条件。
        if (sorted.isEmpty() && hosts.isEmpty() && store.diskCount() > 0) {
            android.util.Log.e("XsshData", "refusing to persist an empty host list over existing data")
            return
        }
        hosts = sorted
        store.save(sorted)
    }

    // 平板:窗口够宽(≥ 600dp)就是平板那一整套交互;小窗、窄分屏缩到手机宽度时退回手机的页面,
    // 按钮按直板机的底栏摆。两套共用上面这些状态,窗口来回缩放时正在看的东西不丢。
    val chrome = LocalChrome.current
    CompositionLocalProvider(LocalHosts provides hosts) {
    BoxWithConstraints(Modifier.fillMaxSize()) {
        if (chrome == Chrome.Tablet && maxWidth >= 600.dp) {
            TabletApp(
                hosts = hosts,
                selectedId = selectedId,
                onSelect = { selectedId = it },
                termHostId = termHostId?.takeIf { id -> hosts.any { it.id == id } },
                onOpenTerminal = { termHostId = it.id },
                onCloseTerminal = { termHostId = null },
                onSave = { host ->
                    val list = hosts.toMutableList()
                    val index = list.indexOfFirst { it.id == host.id }
                    if (index >= 0) list[index] = host else list.add(host)
                    persist(list)
                    selectedId = host.id
                },
                onDelete = { host ->
                    persist(hosts.filterNot { it.id == host.id })
                    if (selectedId == host.id) selectedId = null
                    if (termHostId == host.id) termHostId = null
                },
                onTrustKey = { host, fingerprint ->
                    // 换一个 Host 实例 → 终端的 remember(host) 失效 → 带着新指纹重连。
                    persist(hosts.map { if (it.id == host.id) it.copy(keyFingerprint = fingerprint) else it })
                },
                onPin = { pinned -> persist(hosts.map { if (it.id == pinned.id) pinned else it }) },
                onConnected = { id ->
                    persist(hosts.map { if (it.id == id) it.copy(lastUsed = System.currentTimeMillis()) else it })
                },
            )
        } else {
            CompositionLocalProvider(
                LocalChrome provides if (chrome == Chrome.Tablet) Chrome.BottomBar else chrome,
            ) {
                // 从平板布局缩进来:右栏开着终端就接着显示它,否则回主机页。
                LaunchedEffect(Unit) {
                    // dev 跳转刚把 screen 推到终端,会话此刻还没登记 —— 这道"没有活会话就退回
                    // 首页"的守卫会把 dev 跳转本身踢掉(真机外屏宽度才踩到,平板分支没有这道守卫)。
                    if (devTarget != null) return@LaunchedEffect
                    // **会话还活着才接着显示**。只看 `termHostId` 的话,进程被系统杀掉之后
                    // 重新打开(saved state 还在、SessionRegistry 已经空了),会一闪主机页
                    // 然后自己钻进终端、重新拨号 —— 加锁的主机还会平白弹一次指纹框。
                    // 上面 `screen` 的初始化早就加了这道判断,这里漏了(见 `remember { … }`)。
                    val open = termHostId
                        ?.takeIf { SessionRegistry[it] != null }
                        ?.let { id -> hosts.firstOrNull { it.id == id } }
                    screen = when {
                        open != null -> Screen.Terminal(open)
                        screen is Screen.Terminal -> Screen.Home
                        else -> screen
                    }
                }
                PhoneFlow(
                    wide = LocalAdaptive.current.splits(maxWidth),
                    screen = screen,
                    onScreen = { screen = it },
                    hosts = hosts,
                    selectedId = selectedId,
                    onSelect = { selectedId = it },
                    onTerminalHost = { id ->
                        termHostId = id
                        // 显式切到单会话(首页点连接 / 返回清掉)时副窗格一起清。
                        if (id == null) termCompanionId = null
                    },
                    termCompanionId = termCompanionId,
                    onTerminalCompanion = { termCompanionId = it },
                    paneFocus = paneFocus,
                    onPaneFocus = { setPaneFocus(it) },
                    persist = ::persist,
                )
            }
        }
    }
    }
}

/** 手机 / 折叠屏(以及缩成手机宽度的平板小窗)的页面流:主机页 → 终端 / 编辑页,整页推入。 */
@Composable
private fun PhoneFlow(
    /** 主机页现在是不是左右两栏(折叠屏内屏横屏、直板机横屏)。 */
    wide: Boolean,
    screen: Screen,
    onScreen: (Screen) -> Unit,
    hosts: List<Host>,
    selectedId: String?,
    onSelect: (String?) -> Unit,
    onTerminalHost: (String?) -> Unit,
    /** 双终端右侧会话;null = 单窗格。 */
    termCompanionId: String?,
    onTerminalCompanion: (String?) -> Unit,
    paneFocus: PaneSide,
    onPaneFocus: (PaneSide) -> Unit,
    persist: (List<Host>) -> Unit,
) {
    // 返回手势的协程里要读"现在"是哪一屏,不是开始拖动那一刻的参数值。
    val currentScreen by rememberUpdatedState(screen)

    // 页面切换:iOS 的导航推入 —— 进编辑页 / 终端从右边推进来,返回主机页时滑出去。
    // 用可拖动的过渡:返回手势拉到一半,页面就停在一半,跟着手指走;松手才决定回不回去。
    val seek = remember { SeekableTransitionState(screen) }
    val scope = rememberCoroutineScope()
    // 拖动返回期间页面位移要和手指成正比:弹簧曲线按时间取进度,拉到 40% 画面就已经走完九成。
    val dragging = remember { mutableStateOf(false) }
    val windowInfo = LocalWindowInfo.current
    // 窗口换形态(展开 / 合上)引起的换页不滑:页面是"变成"另一种摆法,不是往前往后走。
    val snapNext = remember { booleanArrayOf(false) }
    LaunchedEffect(screen) {
        if (seek.currentState != screen || seek.targetState != screen) {
            if (snapNext[0]) seek.snapTo(screen) else seek.animateTo(screen)
        }
        snapNext[0] = false
    }

    // ── 展开 / 合上 ────────────────────────────────────────────────
    // 用户是不是"正在看某台主机的详情":单栏里推进了详情页,或者双栏里亲手点了一台。
    // 自动选中的第一台不算 —— 否则一合上,外屏就总停在详情页,而外屏首先是"点一下就连"的遥控器。
    var viewingDetail by rememberSaveable { mutableStateOf(false) }
    val latestHosts by rememberUpdatedState(hosts)
    val latestSelected by rememberUpdatedState(selectedId)
    LaunchedEffect(wide) {
        val now = currentScreen
        when {
            // 外屏看着详情 → 展开:变成双栏、右边就是这台。
            wide && now is Screen.HostInfo -> {
                onSelect(now.hostId)
                snapNext[0] = true
                onScreen(Screen.Home)
            }
            // 内屏右栏看着一台 → 合上:外屏接着显示这台的详情页,返回回到列表。
            !wide && now == Screen.Home && viewingDetail -> {
                val id = latestSelected?.takeIf { id -> latestHosts.any { it.id == id } }
                if (id != null) {
                    snapNext[0] = true
                    onScreen(Screen.HostInfo(id))
                } else {
                    viewingDetail = false
                }
            }
        }
    }
    /** 双栏时详情页不单独存在:回到它 = 回到主机页(右边选中它)。只算落点,不改状态。 */
    fun resolve(target: Screen): Screen = if (wide && target is Screen.HostInfo) Screen.Home else target

    /** 真的回到 [target] 时才改状态 —— 返回手势拉到一半又放回去,什么都不能变。 */
    fun arrive(target: Screen) {
        if (wide && target is Screen.HostInfo) onSelect(target.hostId)
        if (target == Screen.Home && !wide) viewingDetail = false
    }

    fun land(target: Screen): Screen = resolve(target).also { arrive(target) }
    PredictiveBackHandler(enabled = screen != Screen.Home) { gesture ->
        dragging.value = true
        // 双终端:第一次返回先收成单窗格(两个会话都还活着),第二次才离开终端。
        val dualNow = currentScreen is Screen.Terminal && wide &&
            termCompanionId != null &&
            termCompanionId != (currentScreen as Screen.Terminal).host.id
        if (dualNow) {
            try {
                var startX = Float.NaN
                gesture.collect { event ->
                    if (startX.isNaN()) startX = event.touchX
                    val width = windowInfo.containerSize.width.coerceAtLeast(1)
                    // 不换页,只跟手一点反馈:进度到了就收副窗格。
                    seek.seekTo(((event.touchX - startX) / width).coerceIn(0f, 1f), currentScreen)
                }
                onTerminalCompanion(null)
                onPaneFocus(PaneSide.Left)
                seek.snapTo(currentScreen)
                dragging.value = false
            } catch (e: CancellationException) {
                scope.launch {
                    seek.animateTo(seek.currentState, Motion.page())
                    dragging.value = false
                }
                throw e
            }
            return@PredictiveBackHandler
        }
        val parent = currentScreen.parent()
        val target = resolve(parent)
        try {
            // 用手指的实际位置算进度,不用系统给的 progress:那个值带缓动,
            // 在这台机器上拉到屏幕三分之一就到 0.95,页面早早滑完,不再跟手。
            var startX = Float.NaN
            gesture.collect { event ->
                if (startX.isNaN()) startX = event.touchX
                val width = windowInfo.containerSize.width.coerceAtLeast(1)
                seek.seekTo(((event.touchX - startX) / width).coerceIn(0f, 1f), target)
            }
            // 松手:从手指停下的位置接着滑完。
            seek.animateTo(target, Motion.page())
            // 返回只是离开这一屏,会话照跑(主机页会显示「运行中」)。
            if (target !is Screen.Terminal && target !is Screen.Files) onTerminalHost(null)
            arrive(parent)
            onScreen(target)
            // 页面已经停在目标上了,之后的推入 / 退出恢复成弹簧曲线。
            dragging.value = false
        } catch (e: CancellationException) {
            // 手势取消(拉了一半又放回去):弹回原页。
            scope.launch {
                seek.animateTo(seek.currentState, Motion.page())
                dragging.value = false
            }
            throw e
        } finally {
            if (currentScreen == target) dragging.value = false
        }
    }

    val page: @Composable (Screen) -> Unit = { current ->
       when (current) {
        is Screen.Home -> HomeScreen(
            hosts = hosts,
            selectedId = selectedId,
            onSelect = {
                onSelect(it.id)
                viewingDetail = true
            },
            onAutoSelect = { onSelect(it.id) },
            onConnect = {
                // 从双栏连出去:回来再合上时回列表,不停在详情页。
                viewingDetail = false
                onTerminalCompanion(null)
                onPaneFocus(PaneSide.Left)
                onTerminalHost(it.id)
                onScreen(Screen.Terminal(it))
            },
            onInfo = {
                onSelect(it.id)
                viewingDetail = true
                onScreen(Screen.HostInfo(it.id))
            },
            onFonts = { onScreen(Screen.Fonts) },
            onNew = { onScreen(Screen.Editor(null)) },
            onEdit = { onScreen(Screen.Editor(it)) },
            onDelete = { host ->
                persist(hosts.filterNot { it.id == host.id })
                if (selectedId == host.id) onSelect(null)
            },
            onPin = { pinned -> persist(hosts.map { if (it.id == pinned.id) pinned else it }) },
        )

        is Screen.HostInfo -> {
            val host = hosts.firstOrNull { it.id == current.hostId }
            // 主机没了(删掉了):这一页没东西可看。
            LaunchedEffect(host == null) { if (host == null) onScreen(land(Screen.Home)) }
            if (host != null) {
                HostInfoScreen(
                    host = host,
                    onBack = { onScreen(land(Screen.Home)) },
                    onConnect = {
                        onTerminalCompanion(null)
                        onPaneFocus(PaneSide.Left)
                        onTerminalHost(it.id)
                        onScreen(Screen.Terminal(it, back = current))
                    },
                    onEdit = { onScreen(Screen.Editor(it, back = current)) },
                    onDelete = { gone ->
                        persist(hosts.filterNot { it.id == gone.id })
                        if (selectedId == gone.id) onSelect(null)
                        onScreen(land(Screen.Home))
                    },
                    onPin = { pinned -> persist(hosts.map { if (it.id == pinned.id) pinned else it }) },
                )
            }
        }

        Screen.Fonts -> SettingsScreen(onBack = { onScreen(Screen.Home) })

        is Screen.Editor -> HostEditorScreen(
            initial = current.host,
            onBack = { onScreen(land(current.back)) },
            onSave = { host ->
                val list = hosts.toMutableList()
                val index = list.indexOfFirst { it.id == host.id }
                if (index >= 0) list[index] = host else list.add(host)
                persist(list)
                onSelect(host.id)
                onScreen(land(current.back))
            },
            onDelete = { host ->
                persist(hosts.filterNot { it.id == host.id })
                if (selectedId == host.id) onSelect(null)
                onScreen(land(Screen.Home))
            },
        )

        is Screen.Terminal -> {
            val panes = resolveDualPanes(wide, current.host.id, termCompanionId, paneFocus)
            var pickingBeside by remember(current.host.id) { mutableStateOf(false) }
            fun hostOf(id: String?): Host? = id?.let { hid ->
                hosts.firstOrNull { it.id == hid }
                    ?: SessionRegistry[hid]?.host
                    ?: current.host.takeIf { it.id == hid }
            }
            fun trustKey(host: Host, fingerprint: String) {
                val trusted = host.copy(keyFingerprint = fingerprint)
                if (hosts.any { it.id == trusted.id }) {
                    persist(hosts.map { if (it.id == trusted.id) it.copy(keyFingerprint = fingerprint) else it })
                }
                // 主窗格指纹变了要换 Screen 里的 Host 实例以触发重连。
                if (current.host.id == trusted.id) onScreen(current.copy(host = trusted))
            }
            fun connected(id: String) {
                persist(hosts.map { if (it.id == id) it.copy(lastUsed = System.currentTimeMillis()) else it })
            }
            if (pickingBeside) {
                PickBesideSessionDialog(
                    excludeId = current.host.id,
                    hosts = hosts,
                    onPick = { picked ->
                        val next = openBeside(current.host.id, termCompanionId, picked.id)
                        onTerminalHost(next.first)
                        onTerminalCompanion(next.second)
                        onPaneFocus(next.third)
                        pickingBeside = false
                    },
                    onDismiss = { pickingBeside = false },
                )
            }
            if (panes.dual) {
                val left = hostOf(panes.leftId)
                val right = hostOf(panes.rightId)
                if (left != null && right != null) {
                    DualTerminalPanes(
                        left = left,
                        right = right,
                        focus = panes.focus,
                        onFocus = onPaneFocus,
                        onExitPane = { side ->
                            // 关掉这一侧的会话,另一侧留下。
                            val closing = if (side == PaneSide.Left) left.id else right.id
                            SessionRegistry.close(closing)
                            val next = closeFocusedPane(current.host.id, termCompanionId, side)
                            onTerminalHost(next.first)
                            onTerminalCompanion(next.second)
                            onPaneFocus(next.third)
                            if (next.first == null) onScreen(land(current.back))
                            else {
                                val keep = hostOf(next.first) ?: return@onExitPane
                                onScreen(Screen.Terminal(keep, back = current.back))
                            }
                        },
                        onSwap = {
                            val (a, b) = swapPanes(current.host.id, termCompanionId)
                            onTerminalHost(a)
                            onTerminalCompanion(b)
                            onPaneFocus(if (paneFocus == PaneSide.Left) PaneSide.Right else PaneSide.Left)
                            hostOf(a)?.let { onScreen(Screen.Terminal(it, back = current.back)) }
                        },
                        onOpenBeside = { pickingBeside = true },
                        onTrustKey = ::trustKey,
                        onTrustJumpKey = { jump, fingerprint ->
                            persist(hosts.map { if (it.id == jump.id) it.copy(keyFingerprint = fingerprint) else it })
                        },
                        onFiles = { h ->
                            onScreen(Screen.Files(Screen.Terminal(h, back = current.back)))
                        },
                        onEditHost = { h ->
                            onTerminalHost(null)
                            onScreen(Screen.Editor(h, back = current.back))
                        },
                        onConnected = ::connected,
                    )
                }
            } else {
                val shown = hostOf(panes.leftId) ?: current.host
                TerminalScreen(
                    host = shown,
                    onExit = {
                        onTerminalHost(null)
                        onScreen(land(current.back))
                    },
                    onTrustKey = { fingerprint -> trustKey(shown, fingerprint) },
                    onTrustJumpKey = { jump, fingerprint ->
                        persist(hosts.map { if (it.id == jump.id) it.copy(keyFingerprint = fingerprint) else it })
                    },
                    onFiles = { onScreen(Screen.Files(Screen.Terminal(shown, back = current.back))) },
                    onConnected = ::connected,
                    onEditHost = {
                        onTerminalHost(null)
                        onScreen(Screen.Editor(shown, back = current.back))
                    },
                    onOpenBeside = { pickingBeside = true },
                )
            }
        }

        is Screen.Files -> {
            val session = SessionRegistry.sessions.collectAsState().value[current.host.id]
            // 连接断了(对端关了 / 被断开):没有文件可看,退回终端页(那里有「重新连接」)。
            LaunchedEffect(session == null) { if (session == null) onScreen(current.terminal) }
            if (session != null) {
                FilesPane(
                    host = current.host,
                    session = session,
                    chrome = FilesChrome.Phone(onLeave = { onScreen(current.terminal) }),
                    focusRequest = 1,
                )
            }
        }
       }
    }

    // 同一台主机的终端换了实例(信任新指纹后重连)不算换页,不做动画。
    // 主机页的 rememberSaveable(列表滚到哪)存在 holder 里,推进去再回来还在;
    // 编辑页和终端每次都是新开的,不用存。
    val pages = rememberSaveableStateHolder()
    rememberTransition(seek, label = "page").AnimatedContent(
        contentKey = {
            when (it) {
                Screen.Home -> "home"
                is Screen.HostInfo -> "info:" + it.hostId
                Screen.Fonts -> "fonts"
                is Screen.Editor -> "editor"
                is Screen.Terminal -> "term:" + it.host.id + ":" + (termCompanionId ?: "")
                is Screen.Files -> "files:" + it.host.id
            }
        },
        transitionSpec = { with(Motion) { push(forward = targetState.depth() > initialState.depth(), linear = dragging.value) } },
    ) { current ->
        if (current == Screen.Home) pages.SaveableStateProvider("home") { page(current) } else page(current)
    }
}
