package dev.xssh.android

import androidx.activity.compose.BackHandler
import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.core.Spring
import androidx.compose.animation.core.animateDpAsState
import androidx.compose.animation.core.spring
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.Image
import androidx.compose.foundation.systemGestureExclusion
import kotlinx.coroutines.launch
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.input.pointer.PointerEventPass
import androidx.compose.ui.input.pointer.changedToUpIgnoreConsumed
import androidx.compose.ui.input.pointer.positionChange
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.graphics.Color
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.gestures.detectDragGestures
import androidx.compose.foundation.gestures.awaitFirstDown
import androidx.compose.foundation.gestures.awaitEachGesture
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.WindowInsetsSides
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.only
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.foundation.lazy.grid.rememberLazyGridState
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.clickable
import androidx.compose.ui.draw.clip
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.offset
import androidx.compose.ui.layout.layout
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.ui.platform.LocalSoftwareKeyboardController
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.mutableIntStateOf
import kotlin.math.roundToInt
import com.kyant.backdrop.backdrops.layerBackdrop
import com.kyant.backdrop.backdrops.rememberLayerBackdrop

/* ───────────────────────── 折叠屏内屏:抽屉布局 ─────────────────────────

   照 iPhone Duo 内屏的做法(见 mobile/ios/XSSH/XSSHApp.swift 的 regularLayout):
   - 左边是主机列表"抽屉"(固定 334dp,底色比终端亮一档);右边是会话,终端直接嵌在右栏里。
   - 点一台主机:抽屉立刻收起、会话顺着滑进来(半折时两边各占一半,不收)。
   - 会话的按钮在右下角一枚竖向玻璃竖条里;抽屉收起时竖条最上面多一颗「‹ 回主机列表」。
   - 左上角一颗圆形玻璃按钮开关抽屉(抽屉收起、又连着会话时让位给竖条里的 ‹)。
   - 没有会话时右栏是 logo + 「没有会话 / 选一台主机来连接」。
*/

/** 一个会话此刻的状态:会话区(右栏)报给外层,左边的主机列表据此显示「连接中 / 连接失败」,连上之后才收抽屉。 */
enum class DuoStatus { None, Connecting, Confirm, Failed, Live }

/** 终端嵌在抽屉布局右栏时,从外面带进来的东西(见 [TerminalScreen] 的 `duo` 参数)。 */
class DuoTerminalChrome(
    /** 抽屉现在是展开的(收起时竖条里才有「回主机列表」)。 */
    val drawerOpen: Boolean,
    /** 回到主机列表:展开抽屉,会话照跑。 */
    val onShowHosts: () -> Unit,
    /** 主机名那一行左边要多让出的宽度(左上角有圆形开关时)。 */
    val headerStart: Dp = 0.dp,
    /** 这台主机的会话状态变了:(主机 id, 状态)。离开时报 [DuoStatus.None]。 */
    val onStatus: (String, DuoStatus) -> Unit = { _, _ -> },
)

/** 抽屉宽度(iOS 的 SidebarHandle.width = 334.4)。 */
private val DrawerWidth = 334.dp

/** 抽屉的弹簧:侧栏滑动、会话让出的宽度同一条曲线(iOS 的 drawerSpring: 0.46s, bounce 0.12)。 */
private fun <T> drawerSpring() = spring<T>(dampingRatio = 0.8f, stiffness = Spring.StiffnessMediumLow)

@Composable
fun DuoApp(
    hosts: List<Host>,
    selectedId: String?,
    onSelect: (String) -> Unit,
    termHostId: String?,
    onOpenTerminal: (Host) -> Unit,
    onCloseTerminal: () -> Unit,
    onSave: (Host) -> Unit,
    onDelete: (Host) -> Unit,
    onTrustKey: (Host, String) -> Unit,
    onConnected: (String) -> Unit,
) {
    val p = LocalXssh.current
    val adaptive = LocalAdaptive.current
    val focusManager = LocalFocusManager.current
    val keyboard = LocalSoftwareKeyboardController.current
    val running by SessionRegistry.sessions.collectAsState()
    val termHost = termHostId?.let { id -> hosts.firstOrNull { it.id == id } }

    var drawerOpen by rememberSaveable { mutableStateOf(true) }
    var sheet by remember { mutableStateOf<SheetTarget?>(null) }
    var fontSheet by rememberSaveable { mutableStateOf(false) }
    var deleting by remember { mutableStateOf<Host?>(null) }
    var query by rememberSaveable { mutableStateOf("") }
    var searching by rememberSaveable { mutableStateOf(false) }
    var filesOpen by remember { mutableStateOf(false) }
    // 点一台已经失败的主机 = 重试:换这个数,会话区整个重建、重新拨号。
    var retryNonce by remember { mutableIntStateOf(0) }
    val grid = rememberLazyGridState()
    // 抽屉被手指拖着滑出去的位移(px,≤ 0):拖的时候直接跟手,松手时和抽屉的展开 / 收起走同一条弹簧(见 DuoHandle)。
    val slide = remember { androidx.compose.animation.core.Animatable(0f) }
    // 位移动画的协程挂在 DuoApp 上:收起的那一刻把手离开组合,挂在把手上的动画会被一起取消,位移就留在半路。
    val shellScope = androidx.compose.runtime.rememberCoroutineScope()
    // 把手:有「该让用户看到它」的事(碰会话区、抽屉开合)就显示,两秒没人动就淡出。
    var handleShown by remember { mutableStateOf(true) }
    var pokeToken by remember { androidx.compose.runtime.mutableIntStateOf(0) }
    fun poke() {
        handleShown = true
        pokeToken++
    }
    LaunchedEffect(pokeToken) {
        kotlinx.coroutines.delay(2000)
        handleShown = false
    }
    val shellBackdrop = rememberLayerBackdrop()

    val filtered = remember(hosts, query) {
        if (query.isBlank()) hosts else hosts.filter {
            it.label.contains(query, ignoreCase = true) ||
                it.address.contains(query, ignoreCase = true) ||
                it.username.contains(query, ignoreCase = true)
        }
    }

    // 半折(竖直折痕半开):列表和会话各占一半,抽屉不收。
    val halfFolded = adaptive.bookFold?.halfOpen == true
    // 半折:进入半折时抽屉自动展开(折痕把窗口一分为二,终端跨着折痕没法看),
    // 但左上角的侧栏开关、「‹」都照常在,用户想收起来也可以自己收。
    val shown = drawerOpen
    LaunchedEffect(halfFolded) { if (halfFolded) drawerOpen = true }

    LaunchedEffect(drawerOpen) { poke() }

    // 没有会话了(断开 / 关掉):抽屉滑出来让人重新选。
    LaunchedEffect(termHost?.id) {
        if (termHost == null) {
            drawerOpen = true
            filesOpen = false
        }
    }

    // 会话没了(断线 / 断开)就别再停在文件页:否则重连成功后界面会无故跳回文件页。
    val hostRunning = termHost?.let { running.containsKey(it.id) } ?: false
    LaunchedEffect(termHost?.id, hostRunning) {
        if (termHost != null && !hostRunning) filesOpen = false
    }

    // 收起抽屉的统一出口:顺手收掉搜索和软键盘(否则键盘还在、字会打进屏幕外的输入框)。
    fun collapseDrawer() {
        focusManager.clearFocus()
        keyboard?.hide()
        searching = false
        if (query.isNotEmpty()) query = ""
        drawerOpen = false
    }

    // 会话区报上来的状态(哪台主机、什么状态)。连接中 / 要确认 / 失败时,这些状态就落在右栏里、
    // 左边的主机列表一直在 —— 失败了可以直接点别的主机;真正连上之后才把抽屉收起来。
    var gate by remember { mutableStateOf<Pair<String, DuoStatus>?>(null) }
    var collapseWhenLive by remember { mutableStateOf(false) }
    LaunchedEffect(gate, termHost?.id, collapseWhenLive, halfFolded) {
        val g = gate
        // 连接过程中半折了:半折是并排设计,不能在连上的那一刻把列表收走。
        if (halfFolded) {
            collapseWhenLive = false
            return@LaunchedEffect
        }
        if (collapseWhenLive && g != null && g.first == termHost?.id && g.second == DuoStatus.Live) {
            collapseDrawer()
            collapseWhenLive = false
        }
    }
    val rowStatus = remember(gate) { gate?.let { mapOf(it.first to it.second) } ?: emptyMap() }

    fun connect(host: Host) {
        if (gate?.let { it.first == host.id && it.second == DuoStatus.Failed } == true) retryNonce++
        onSelect(host.id)
        onOpenTerminal(host)
        filesOpen = false
        if (query.isNotEmpty()) query = ""
        searching = false
        // 半折是并排设计,抽屉本来就不收;平摊时等连上了再收(见上)。
        collapseWhenLive = drawerOpen && !halfFolded
    }

    // 返回:抽屉收着就先展开;展开着、右栏开着终端就收掉终端视图(会话照跑)。
    BackHandler(enabled = termHost != null && !shown) { drawerOpen = true }
    BackHandler(enabled = termHost != null && shown) { onCloseTerminal() }
    // 抽屉里正在搜索:返回先退出搜索(放在最后注册 = 优先级最高)。
    BackHandler(enabled = searching) {
        searching = false
        if (query.isNotEmpty()) query = ""
    }

    BoxWithConstraints(Modifier.fillMaxSize().background(p.bg)) {
        // 半折:左半屏给列表,右半屏给会话,分界线压在折痕上(没量到可用折痕就取正中)。
        val fold = adaptive.bookFold?.takeIf { halfFolded && it.startDp > 200.dp && it.startDp < maxWidth - 200.dp }
        val drawerW = when {
            fold != null -> fold.startDp
            halfFolded -> maxWidth / 2
            else -> minOf(DrawerWidth, maxWidth * 0.6f)
        }
        // 折痕自身的厚度也要让出来:右栏从折痕的右沿开始。
        val creaseW = if (fold != null) fold.sizeDp else 0.dp
        // 动画值不在组合阶段读(拖动 / 弹簧每一帧都会触发重组),推迟到布局 / 绘制阶段读。
        val insetState = animateDpAsState(if (shown) drawerW + creaseW else 0.dp, drawerSpring(), label = "duoInset")
        val baseXState = animateDpAsState(if (shown) 0.dp else -drawerW, drawerSpring(), label = "duoDrawerX")
        val density = androidx.compose.ui.platform.LocalDensity.current
        val drawerWpx = with(density) { drawerW.toPx() }
        // 抽屉实际位置 = 展开 / 收起的基准位置 + 手指拖出去的位移(iOS 的 offset(x: (drawerOpen ? 0 : -w) + slide))。

        Box(Modifier.fillMaxSize().layerBackdrop(shellBackdrop)) {
            // ── 会话(在底层,左边让出抽屉的宽度)
            Box(
                Modifier
                    .fillMaxSize()
                    // 只听不管:碰到会话区域就让把手露出来(Initial 阶段旁听,不吃事件,终端手势照常)。
                    .pointerInput(Unit) {
                        awaitEachGesture {
                            awaitFirstDown(requireUnconsumed = false, pass = PointerEventPass.Initial)
                            poke()
                        }
                    }
                    // 让出抽屉的宽度(弹簧会过冲到负数,不能为负)。用 layout 读动画值,不触发重组。
                    .layout { measurable, constraints ->
                        val start = insetState.value.coerceAtLeast(0.dp).roundToPx()
                        val placeable = measurable.measure(constraints.offset(horizontal = -start))
                        layout(constraints.maxWidth, placeable.height) { placeable.placeRelative(start, 0) }
                    }
                    .windowInsetsPadding(
                        stableSafeDrawing().only(
                            if (shown) WindowInsetsSides.Vertical + WindowInsetsSides.End
                            else WindowInsetsSides.Vertical + WindowInsetsSides.Horizontal,
                        ),
                    ),
            ) {
                val pane = when {
                    termHost != null && filesOpen && running.containsKey(termHost.id) -> "files:" + termHost.id
                    termHost != null -> "term:" + termHost.id
                    else -> "empty"
                }
                AnimatedContent(
                    targetState = pane,
                    transitionSpec = { fadeIn(androidx.compose.animation.core.tween(160)) togetherWith fadeOut(androidx.compose.animation.core.tween(120)) },
                    label = "duoPane",
                ) { paneKey ->
                    when {
                        paneKey.startsWith("term:") -> {
                            val host = hosts.firstOrNull { "term:" + it.id == paneKey }
                            if (host != null) {
                                key(host.id, retryNonce) {
                                    TerminalScreen(
                                        host = host,
                                        onExit = onCloseTerminal,
                                        onTrustKey = { onTrustKey(host, it) },
                                        onTrustJumpKey = { jump, fingerprint -> onTrustKey(jump, fingerprint) },
                                        onConnected = onConnected,
                                        onSwitchHost = { connect(it) },
                                        onFiles = { filesOpen = true },
                                        onEditHost = { sheet = SheetTarget.Edit(host) },
                                        duo = remember(shown) {
                                            DuoTerminalChrome(
                                                drawerOpen = shown,
                                                onShowHosts = { drawerOpen = true },
                                                onStatus = { id, status ->
                                                    if (status == DuoStatus.None) {
                                                        if (gate?.first == id) gate = null
                                                    } else {
                                                        gate = id to status
                                                    }
                                                },
                                            )
                                        },
                                    )
                                }
                            }
                        }
                        paneKey.startsWith("files:") -> {
                            val host = hosts.firstOrNull { "files:" + it.id == paneKey }
                            val session = host?.let { running[it.id] }
                            if (host != null && session != null) {
                                key(host.id) {
                                    FilesPane(
                                        host = host,
                                        session = session,
                                        chrome = FilesChrome.Tablet(
                                            sidebarVisible = shown,
                                            onToggleSidebar = { drawerOpen = !drawerOpen },
                                            onShowTerminal = { filesOpen = false },
                                        ),
                                        focusRequest = 0,
                                    )
                                }
                            }
                        }
                        else -> DuoEmpty(hosts = hosts, onConnect = ::connect, onNew = { sheet = SheetTarget.New })
                    }
                }
            }

            // ── 抽屉(主机列表)
            Box(
                Modifier
                    .offset { IntOffset(baseXState.value.roundToPx() + slide.value.roundToInt(), 0) }
                    .width(drawerW)
                    .fillMaxHeight()
                    // 拖得越远,侧栏内容越淡(最多淡掉 40%)。
                    .graphicsLayer { alpha = 1f - minOf(1f, kotlin.math.abs(slide.value) / drawerWpx.coerceAtLeast(1f)) * 0.4f }
                    // 比右边纯黑的终端亮一档(iOS 的 appSidebar #171717);底色铺在安全区内边距之前。
                    .background(p.sidebar)
                    .windowInsetsPadding(stableSafeDrawing().only(WindowInsetsSides.Vertical + WindowInsetsSides.Start))
                    // 只有从空白处(最后一台主机下面)开始的向左滑才收起列表:滑主机行本身(删除 / 编辑)、
                    // 标题区、会话内容都不算(iOS 的 HorizontalSwipeSpy)。Initial 阶段旁听,不吃事件,列表的上下滑照常。
                    .pointerInput(halfFolded) {
                        if (halfFolded) return@pointerInput
                        awaitEachGesture {
                            val down = awaitFirstDown(requireUnconsumed = false, pass = PointerEventPass.Initial)
                            val info = grid.layoutInfo
                            val last = info.visibleItemsInfo.lastOrNull()
                            val blank = last != null &&
                                last.index == info.totalItemsCount - 1 &&
                                down.position.y > last.offset.y + last.size.height + 8.dp.toPx()
                            if (!blank) return@awaitEachGesture
                            var total = Offset.Zero
                            while (true) {
                                val event = awaitPointerEvent(PointerEventPass.Initial)
                                val change = event.changes.firstOrNull { it.id == down.id } ?: break
                                if (change.changedToUpIgnoreConsumed()) break
                                total += change.positionChange()
                                if (total.x < -48.dp.toPx() && kotlin.math.abs(total.x) > kotlin.math.abs(total.y) * 1.5f) {
                                    collapseDrawer()
                                    break
                                }
                            }
                        }
                    },
            ) {
                HostListPane(
                    grid = grid,
                    // iOS 内屏的行起点是 16pt + 侧栏宽的 4%(约 29pt),比外屏(约 22dp)靠里一点;
                    // 右边的圆点对应收到 29pt,两边对称。
                    modifier = Modifier.fillMaxSize().padding(start = 7.dp),
                    hosts = filtered,
                    total = hosts.size,
                    selectedId = termHost?.id,
                    onPrimary = ::connect,
                    onInfo = null,
                    onNew = { sheet = SheetTarget.New },
                    onSettings = { fontSheet = true },
                    onEdit = { sheet = SheetTarget.Edit(it) },
                    onDelete = { deleting = it },
                    query = query,
                    onQuery = { query = it },
                    searching = searching,
                    onSearching = { searching = it },
                    running = running.keys,
                    sessions = emptyList(),
                    // 连着的主机行显示「运行中 · 时长」:时长取自会话表(sessions 参数是给「孤儿会话区」用的,这里不传)。
                    startedAtOf = { id -> running[id]?.startedAt },
                    onOpenSession = ::connect,
                    columns = 1,
                    large = false,
                    creaseGap = 12.dp,
                    underRail = true,
                    topPad = 0.dp,
                    bottomClearance = 84.dp,
                    selectionFill = false,
                    hostStatus = rowStatus,
                )
            }
        }

        // ── 玻璃层(盖在两栏上面)
        CompositionLocalProvider(LocalBackdrop provides shellBackdrop) {
            // 抽屉底部的玻璃胶囊:搜索 + 新建(iOS 内屏:列表底部,和列表在一起)。
            Box(
                Modifier
                    .offset { IntOffset(baseXState.value.roundToPx() + slide.value.roundToInt(), 0) }
                    .width(drawerW)
                    .fillMaxHeight()
                    .windowInsetsPadding(stableSafeDrawing().only(WindowInsetsSides.Bottom + WindowInsetsSides.Start)),
                contentAlignment = Alignment.BottomCenter,
            ) {
                if (hosts.isNotEmpty()) {
                    CompositionLocalProvider(LocalGlassSize provides 46.dp, LocalGlassRow provides true) {
                        GlassCapsuleRow(Modifier.padding(bottom = 20.dp), height = 54.dp) {
                            GlassItem(XIcons.Search, stringResource(R.string.host_search_hosts)) {
                                searching = !searching
                                if (!searching) query = ""
                            }
                            GlassItem(XIcons.Plus, stringResource(R.string.host_new_host)) { sheet = SheetTarget.New }
                        }
                    }
                } else {
                    Box(Modifier.padding(bottom = 20.dp)) {
                        GlassButton(XIcons.Plus, stringResource(R.string.host_new_host)) { sheet = SheetTarget.New }
                    }
                }
            }

            // 分界线上的把手(抽屉展开、非半折时);收起后贴在左边缘的小把手。
            if (drawerOpen && !halfFolded) {
                DuoHandle(
                    visible = handleShown,
                    drawerWpx = drawerWpx,
                    slide = slide,
                    scope = shellScope,
                    modifier = Modifier.offset(x = drawerW + 7.dp - 10.dp),
                    onTouch = ::poke,
                    onCollapse = { collapseDrawer() },
                )
            } else if (!shown) {
                DuoEdgeHandle(visible = handleShown, onReveal = { drawerOpen = true })
            }

            // 左上角圆形侧栏开关:抽屉展开时贴在抽屉右上角,收起时回到屏幕左上;
            // 收起了又连着会话时让位(竖条里有「‹」)。
            val showToggle = drawerOpen || termHost == null
            val toggleXState = animateDpAsState(
                if (shown) drawerW - 16.dp - 48.dp else 16.dp,
                drawerSpring(),
                label = "duoToggleX",
            )
            if (showToggle) {
                Box(
                    Modifier
                        .windowInsetsPadding(stableSafeDrawing().only(WindowInsetsSides.Top + WindowInsetsSides.Start))
                        .offset { IntOffset(toggleXState.value.roundToPx() + slide.value.roundToInt(), 8.dp.roundToPx()) },
                ) {
                    CompositionLocalProvider(LocalGlassSize provides 48.dp) {
                        GlassButton(XIcons.Sidebar, stringResource(R.string.duo_toggle_hosts)) {
                            if (drawerOpen) collapseDrawer() else drawerOpen = true
                        }
                    }
                }
            }
        }
    }

    // 内屏的弹层浮在纯黑终端上:底比黑亮一档、里面的卡片再亮一档(iOS 的 appSheet / appSheetCard)。
    if (fontSheet) DuoSheetTheme { SettingsSheet(onDismiss = { fontSheet = false }) }
    sheet?.let { target ->
        DuoSheetTheme {
            HostSheet(
                initial = (target as? SheetTarget.Edit)?.host,
                onCancel = { sheet = null },
                onSave = { host ->
                    sheet = null
                    onSave(host)
                },
                onDelete = { host ->
                    sheet = null
                    deleting = host
                },
            )
        }
    }
    deleting?.let { host ->
        ConfirmDialog(
            title = stringResource(R.string.tab_delete_host_title, host.label),
            message = if (running.containsKey(host.id)) stringResource(R.string.tab_delete_host_session_note) else null,
            confirm = stringResource(R.string.tab_delete),
            danger = true,
            onConfirm = {
                deleting = null
                SessionRegistry.close(host.id)
                if (termHostId == host.id) onCloseTerminal()
                onDelete(host)
            },
            onDismiss = { deleting = null },
        )
    }
}

/**
 * 没有会话时的右栏:应用图标 + 一句话(iOS 的 EmptySessionView),再加一个入口:
 * 一台主机都没有就是「新建主机」,有主机就列最近连过的几台,抽屉收起时也能直接点。
 */
@Composable
private fun DuoEmpty(hosts: List<Host>, onConnect: (Host) -> Unit, onNew: () -> Unit) {
    val p = LocalXssh.current
    Column(
        Modifier.fillMaxSize().background(p.bg),
        verticalArrangement = Arrangement.Center,
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Image(painterResource(R.drawable.logo_mark), contentDescription = null, modifier = Modifier.size(72.dp))
        Text(
            stringResource(R.string.duo_no_session),
            color = p.text,
            fontSize = 20.sp,
            fontWeight = FontWeight.SemiBold,
            textAlign = TextAlign.Center,
            modifier = Modifier.padding(top = 18.dp),
        )
        Text(
            stringResource(R.string.duo_pick_host),
            color = p.textDim,
            fontSize = 15.sp,
            textAlign = TextAlign.Center,
            modifier = Modifier.padding(top = 6.dp),
        )
        if (hosts.isEmpty()) {
            CapsuleButton(
                stringResource(R.string.host_new_host),
                Modifier.padding(top = 24.dp).width(220.dp),
            ) { onNew() }
        } else {
            val recent = remember(hosts) { hosts.sortedByDescending { it.lastUsed }.take(3) }
            Column(Modifier.padding(top = 28.dp).width(260.dp)) {
                Text(
                    stringResource(R.string.duo_recent),
                    color = p.textFaint,
                    fontSize = 12.sp,
                    modifier = Modifier.padding(start = 12.dp, bottom = 4.dp),
                )
                recent.forEach { host ->
                    androidx.compose.foundation.layout.Row(
                        Modifier
                            .fillMaxWidth()
                            .clip(androidx.compose.foundation.shape.RoundedCornerShape(10.dp))
                            .clickable { onConnect(host) }
                            .padding(horizontal = 12.dp, vertical = 11.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Text("❯", color = p.text.copy(alpha = 0.4f), fontFamily = XsshFonts.monoUi, fontSize = 15.sp)
                        androidx.compose.foundation.layout.Spacer(Modifier.width(10.dp))
                        Text(
                            host.label,
                            color = p.text.copy(alpha = 0.9f),
                            fontFamily = XsshFonts.monoUi,
                            fontSize = 15.sp,
                            maxLines = 1,
                            overflow = androidx.compose.ui.text.style.TextOverflow.Ellipsis,
                        )
                    }
                }
            }
        }
    }
}
/** 弹层专用配色:底换成 [XsshPalette.sheet],表单卡片换成 [XsshPalette.sheetCard],其余不变。 */
@Composable
private fun DuoSheetTheme(content: @Composable () -> Unit) {
    val p = LocalXssh.current
    val sheetPalette = remember(p) { p.copy(bg = p.sheet, groupedBg = p.sheet, cardBg = p.sheetCard) }
    CompositionLocalProvider(LocalXssh provides sheetPalette, content = content)
}

/**
 * 侧栏和会话之间分界线上的把手(iOS 的 SidebarHandle):
 * 往左拖时侧栏内容跟手滑出去;松手过了三成(或甩得够快)就接着滑走并收起,没过就带点回弹滑回原位。
 * 触摸区域是 20dp 宽、160dp 高的透明条,胶囊只是它的视觉(2 秒没人碰就淡出,触摸区仍在)。
 *
 * 触摸条自己**不跟着位移走**(只有胶囊在画面上随 [slide] 平移):手指在一个不动的坐标系里,
 * 累计位移和速度才是真的 —— 触摸条要是跟着手指一起动,局部坐标几乎不变,速度永远接近 0。
 */
@Composable
private fun DuoHandle(
    visible: Boolean,
    drawerWpx: Float,
    slide: androidx.compose.animation.core.Animatable<Float, androidx.compose.animation.core.AnimationVector1D>,
    scope: kotlinx.coroutines.CoroutineScope,
    modifier: Modifier,
    onTouch: () -> Unit,
    onCollapse: () -> Unit,
) {
    val alpha by androidx.compose.animation.core.animateFloatAsState(
        if (visible) 1f else 0f,
        androidx.compose.animation.core.tween(if (visible) 150 else 700),
        label = "duoHandleAlpha",
    )
    // 拖着的时候连上了 / 半折了 / 按了返回,把手会离开组合:位移不能留在半路。
    DisposableEffect(Unit) {
        onDispose { scope.launch { slide.animateTo(0f, drawerSpring()) } }
    }
    Box(modifier.fillMaxHeight(), contentAlignment = Alignment.CenterStart) {
        Box(
            Modifier
                .width(20.dp)
                .height(160.dp)
                .pointerInput(drawerWpx) {
                    val tracker = androidx.compose.ui.input.pointer.util.VelocityTracker()
                    var finger = 0f
                    detectDragGestures(
                        onDragStart = {
                            tracker.resetTracking()
                            finger = slide.value
                            onTouch()
                            scope.launch { slide.stop() }
                        },
                        onDrag = { change, drag ->
                            change.consume()
                            finger = (finger + drag.x).coerceIn(-drawerWpx, 0f)
                            tracker.addPosition(change.uptimeMillis, Offset(finger, 0f))
                            onTouch()
                            val target = finger
                            scope.launch { slide.snapTo(target) }
                        },
                        onDragEnd = {
                            val v = tracker.calculateVelocity().x
                            val collapse = -finger > drawerWpx * 0.3f || v < -900f
                            if (collapse) onCollapse()
                            // 收起:基准位置往 -w 走、位移回 0,两条同一弹簧 —— 合起来从松手那一刻的位置连续地滑出去。
                            scope.launch { slide.animateTo(0f, drawerSpring()) }
                        },
                        onDragCancel = { scope.launch { slide.animateTo(0f, drawerSpring()) } },
                    )
                }
                .pointerInput(Unit) {
                    detectTapGestures { onTouch() }
                },
            contentAlignment = Alignment.Center,
        ) {
            Box(
                Modifier
                    .width(4.dp)
                    .height(40.dp)
                    .graphicsLayer {
                        this.alpha = alpha
                        translationX = slide.value
                    }
                    .background(Color.White.copy(alpha = 0.28f), CircleShape),
            )
        }
    }
}
/** 抽屉收起后贴在屏幕左边缘的小把手:点一下 / 往右拖就拉出列表。淡出后触摸区仍在。 */
@Composable
private fun DuoEdgeHandle(visible: Boolean, onReveal: () -> Unit) {
    val alpha by androidx.compose.animation.core.animateFloatAsState(
        if (visible) 1f else 0f,
        androidx.compose.animation.core.tween(if (visible) 150 else 700),
        label = "duoEdgeAlpha",
    )
    Box(
        Modifier
            .fillMaxHeight()
            .windowInsetsPadding(stableSafeDrawing().only(WindowInsetsSides.Start)),
        contentAlignment = Alignment.CenterStart,
    ) {
        Box(
            Modifier
                .width(24.dp)
                .height(140.dp)
                // 屏幕最左边缘本来是系统的"返回"手势区,不排除的话往右拖会被系统拿去退出应用。
                .systemGestureExclusion()
                .pointerInput(Unit) { detectTapGestures { onReveal() } }
                .pointerInput(Unit) {
                    var total = 0f
                    detectDragGestures(
                        onDragStart = { total = 0f },
                        onDrag = { change, drag ->
                            change.consume()
                            total += drag.x
                        },
                        onDragEnd = { if (total > 30.dp.toPx()) onReveal() },
                    )
                },
            contentAlignment = Alignment.CenterStart,
        ) {
            Box(
                Modifier
                    .padding(start = 4.dp)
                    .width(4.dp)
                    .height(40.dp)
                    .graphicsLayer { this.alpha = alpha }
                    .background(Color.White.copy(alpha = 0.28f), CircleShape),
            )
        }
    }
}