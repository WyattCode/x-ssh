package dev.xssh.android

import android.os.SystemClock
import android.view.KeyEvent as AndroidKeyEvent
import androidx.activity.compose.BackHandler
import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.core.tween
import androidx.compose.animation.expandHorizontally
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.shrinkHorizontally
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.focusable
import androidx.compose.foundation.hoverable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsHoveredAsState
import androidx.compose.foundation.interaction.collectIsPressedAsState
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.WindowInsetsSides
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.only
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.input.key.Key
import androidx.compose.ui.input.key.KeyEvent
import androidx.compose.ui.input.key.isCtrlPressed
import androidx.compose.ui.input.key.key
import androidx.compose.ui.input.key.onInterceptKeyBeforeSoftKeyboard
import androidx.compose.ui.input.key.onPreviewKeyEvent
import androidx.compose.ui.input.pointer.PointerEventPass
import androidx.compose.ui.input.pointer.PointerEventType
import androidx.compose.ui.input.pointer.PointerIcon
import androidx.compose.ui.input.pointer.isSecondaryPressed
import androidx.compose.ui.input.pointer.pointerHoverIcon
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.TextFieldValue
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.DpOffset
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import androidx.compose.ui.window.Popup
import androidx.compose.ui.window.PopupProperties
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.platform.LocalWindowInfo
import androidx.compose.foundation.draganddrop.dragAndDropTarget
import androidx.compose.ui.draganddrop.DragAndDropEvent
import androidx.compose.ui.draganddrop.DragAndDropTarget
import androidx.compose.ui.draganddrop.mimeTypes
import androidx.compose.ui.draganddrop.toAndroidDragEvent
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

/* ─────────────────────────────── 平板 ───────────────────────────────

   平板不是"拉宽的手机"。按小米《大屏应用 UX 设计指南》和 Apple HIG(iPadOS)重新组织:

   - **分栏,不整页跳转**:左边侧边栏常驻(会话 + 主机),右边是工作区 —— 主机详情或终端。
     连上主机后终端在右栏打开,侧边栏还在,多个会话在侧边栏里切换。窗格宽度落在小米建议的 280–600dp。
   - **新建 / 编辑是居中浮层**(iPad 的 form sheet、小米的"模态面板代替整页"):约 540dp 宽,背后压暗,
     「取消」在左、「保存」在右。改过内容再点外面,先问一句,不悄悄丢。
   - **工具栏在内容顶上**,按钮是图标 + 悬停提示,不再是浮在角落的玻璃胶囊。
   - **指针**:行和按钮有悬停高亮;右键(触摸是长按)出上下文菜单;双击主机直接连接。
   - **键盘**:插着键盘时焦点始终有落点。终端里 Ctrl+字母留给远端(bash / vim 要用),
     应用快捷键统一走 Ctrl+Shift;不在终端里时 Ctrl 也可以。Meta+/ 的系统快捷键面板里列得出来。

   窗口被缩到 600dp 以下(小窗、窄分屏)时不走这里,退回手机那套页面。
*/

/** 内容区顶上工具栏的高度。侧边栏标题行同高,两边横线对齐。 */
private val ToolbarHeight = 52.dp

/** 编辑浮层的宽度(iPad form sheet 的尺度)。 */
private val SheetWidth = 540.dp

/** 终端放在平板右栏时,要从外面带进来的东西。 */
class TabletTerminalChrome(
    val sidebarVisible: Boolean,
    val onToggleSidebar: () -> Unit,
    val onEdit: () -> Unit,
    /** 变了就把焦点拿回终端(关掉浮层、退出搜索、从侧边栏切回来之后)。 */
    val focusRequest: Int = 0,
    /** 切到这条连接的文件面板(SFTP)。 */
    val onShowFiles: () -> Unit = {},
)

/**
 * 应用级快捷键(Ctrl+Shift+N / F / S / W / E / 1…9、Ctrl+Tab)。
 * 终端的按键处理遇到这些要放行,不能编码成控制字符发给远端。
 */
fun isShellShortcut(e: AndroidKeyEvent): Boolean {
    if (!e.isCtrlPressed || e.isAltPressed || e.isMetaPressed) return false
    if (e.keyCode == AndroidKeyEvent.KEYCODE_TAB) return true
    if (!e.isShiftPressed) return false
    return e.keyCode in ShellKeys || e.keyCode in AndroidKeyEvent.KEYCODE_1..AndroidKeyEvent.KEYCODE_9
}

private val ShellKeys = setOf(
    AndroidKeyEvent.KEYCODE_N,
    AndroidKeyEvent.KEYCODE_F,
    AndroidKeyEvent.KEYCODE_S,
    AndroidKeyEvent.KEYCODE_W,
    AndroidKeyEvent.KEYCODE_E,
    AndroidKeyEvent.KEYCODE_O,
)

/**
 * 输入法手里有没有攒着还没上屏的字。
 *
 * 标准做法是看输入框的 composition,但小米输入法接实体键盘组拼音时**不报 composition**
 * (实测一路都是 null),拼音全攒在它自己的候选条里。只能推断:敲了字符键、输入框的文字却没变,
 * 就是被输入法攒着了。这时回车 / 方向键 / Esc 是输入法的(上屏、选候选、取消),不能被页面抢走。
 */
class ImeBuffer {
    private var pending by mutableIntStateOf(0)

    val holding: Boolean get() = pending > 0

    /** 输入框的文字变了:攒着的字已经上屏(或被清掉)。 */
    fun onTextChanged() {
        pending = 0
    }

    /** 页面没拦、要交给输入法的键,先在这里记一笔。 */
    fun observe(e: AndroidKeyEvent) {
        if (e.action != AndroidKeyEvent.ACTION_DOWN) return
        when {
            e.isPrintingKey && !e.isCtrlPressed && !e.isAltPressed && e.keyCode != AndroidKeyEvent.KEYCODE_SPACE -> pending++
            e.keyCode == AndroidKeyEvent.KEYCODE_DEL && pending > 0 -> pending--
            // 回车上屏、Esc 取消:这一轮组词结束。
            e.keyCode == AndroidKeyEvent.KEYCODE_ENTER ||
                e.keyCode == AndroidKeyEvent.KEYCODE_NUMPAD_ENTER ||
                e.keyCode == AndroidKeyEvent.KEYCODE_ESCAPE -> pending = 0
        }
    }
}

/** 搜索框里当作列表导航的键(没在组词时)。 */
private val SearchNavKeys = setOf(Key.Escape, Key.DirectionUp, Key.DirectionDown, Key.Enter, Key.NumPadEnter)

private sealed interface SheetTarget {
    data object New : SheetTarget
    data class Edit(val host: Host) : SheetTarget
}

/** 上下文菜单的一项。[shortcut] 只是显示在右边的提示文字。 */
class MenuAction(
    val label: String,
    val danger: Boolean = false,
    val shortcut: String? = null,
    val onClick: () -> Unit,
)

/**
 * 平板的整个应用壳。
 *
 * 状态都在上层(App):主机列表、选中哪台、右栏开着谁的终端。这样窗口在平板布局和手机布局之间
 * 来回缩放时(小窗拖大拖小),正在看的东西不丢。
 */
@Composable
fun TabletApp(
    hosts: List<Host>,
    selectedId: String?,
    onSelect: (String) -> Unit,
    termHostId: String?,
    onOpenTerminal: (Host) -> Unit,
    onCloseTerminal: () -> Unit,
    onSave: (Host) -> Unit,
    onDelete: (Host) -> Unit,
    onTrustKey: (Host, String) -> Unit,
) {
    val p = LocalXssh.current
    val context = LocalContext.current
    val prefs = remember(context) { UiPrefs(context) }
    var sidebarVisible by remember { mutableStateOf(prefs.sidebarVisible) }
    fun toggleSidebar() {
        sidebarVisible = !sidebarVisible
        prefs.sidebarVisible = sidebarVisible
    }

    var sheet by remember { mutableStateOf<SheetTarget?>(null) }
    // 设置浮层(语言 + 终端字体)。在里面换语言会重建整个界面,用 rememberSaveable 才不会一换就关掉。
    var fontSheet by rememberSaveable { mutableStateOf(false) }
    var deleting by remember { mutableStateOf<Host?>(null) }
    var query by rememberSaveable { mutableStateOf("") }
    val searchFocus = remember { FocusRequester() }
    var searchFocused by remember { mutableStateOf(false) }
    var searchComposing by remember { mutableStateOf(false) }
    val searchIme = remember { ImeBuffer() }
    var searchRequest by remember { mutableIntStateOf(0) }
    val rootFocus = remember { FocusRequester() }
    // 每加一次,右栏的终端就把焦点拿回自己的按键节点(见 TabletTerminalChrome.focusRequest)。
    var terminalFocus by remember { mutableIntStateOf(0) }
    // 哪些会话的右栏正在看文件(SFTP)而不是终端。按主机记:切到别的会话再回来,还停在文件上。
    var filesFor by remember { mutableStateOf(emptySet<String>()) }
    fun toggleFiles(id: String) {
        filesFor = if (id in filesFor) filesFor - id else filesFor + id
        terminalFocus++
    }
    var treeFocused by remember { mutableStateOf(false) }
    val refocusScope = rememberCoroutineScope()
    val windowInfo = LocalWindowInfo.current

    val running by SessionRegistry.sessions.collectAsState()
    val filtered = remember(hosts, query) {
        if (query.isBlank()) hosts else hosts.filter {
            it.label.contains(query, ignoreCase = true) ||
                it.address.contains(query, ignoreCase = true) ||
                it.username.contains(query, ignoreCase = true)
        }
    }
    val sessions = hosts.filter { running.containsKey(it.id) }
    val termHost = termHostId?.let { id -> hosts.firstOrNull { it.id == id } }
    val shown = hosts.firstOrNull { it.id == selectedId } ?: hosts.firstOrNull()

    // 焦点必须有个落点,实体键盘的方向键、回车、快捷键才有地方去。终端开着时由终端自己拿焦点。
    LaunchedEffect(termHost?.id, sheet, deleting) {
        if (sheet != null || deleting != null || searchFocused) return@LaunchedEffect
        // 浮层关掉之后焦点要回来:开着终端就回终端,否则回列表。
        if (termHost == null) runCatching { rootFocus.requestFocus() } else terminalFocus++
    }
    // 搜索时选中项跟着结果走:当前选中的不在结果里,就选第一条(回车连的就是它,右栏看到的也是它)。
    LaunchedEffect(filtered) {
        if (query.isNotBlank() && filtered.none { it.id == selectedId }) {
            filtered.firstOrNull()?.let { onSelect(it.id) }
        }
    }
    // Ctrl+F:侧边栏收着就先展开,等它进了组合再把焦点给搜索框。
    LaunchedEffect(searchRequest) {
        if (searchRequest == 0) return@LaunchedEffect
        delay(60)
        runCatching { searchFocus.requestFocus() }
    }

    // 返回:先清搜索,再从终端回到详情(会话照跑,侧边栏里还在)。
    BackHandler(enabled = termHost == null && query.isNotEmpty()) { query = "" }
    BackHandler(enabled = termHost != null) { onCloseTerminal() }

    fun connect(host: Host) {
        onSelect(host.id)
        onOpenTerminal(host)
        // 从搜索框回车连上时,搜索词清掉、焦点交给终端(同一个会话再点一次也要把焦点拿回去)。
        if (query.isNotEmpty()) query = ""
        terminalFocus++
    }
    fun disconnect(host: Host) {
        SessionRegistry.close(host.id)
        if (termHostId == host.id) onCloseTerminal()
    }
    fun cycleSessions(step: Int) {
        if (sessions.isEmpty()) return
        val at = sessions.indexOfFirst { it.id == termHostId }
        val next = when {
            at < 0 && step > 0 -> 0
            at < 0 -> sessions.lastIndex
            else -> (at + step).mod(sessions.size)
        }
        connect(sessions[next])
    }
    fun moveSelection(step: Int) {
        if (filtered.isEmpty()) return
        val at = filtered.indexOfFirst { it.id == shown?.id }
        val next = if (at < 0) 0 else (at + step).coerceIn(0, filtered.lastIndex)
        onSelect(filtered[next].id)
    }
    fun menuFor(host: Host): List<MenuAction> = buildList {
        val live = running.containsKey(host.id)
        add(
            MenuAction(
                context.getString(if (live) R.string.tab_open_session else R.string.tab_connect),
                shortcut = context.getString(R.string.tab_key_enter),
            ) { connect(host) },
        )
        add(MenuAction(context.getString(R.string.tab_menu_edit), shortcut = "Ctrl+E") { sheet = SheetTarget.Edit(host) })
        add(MenuAction(context.getString(R.string.tab_copy_address)) { copyText(context, host.subtitle) })
        if (live) add(MenuAction(context.getString(R.string.tab_disconnect), danger = true) { disconnect(host) })
        add(MenuAction(context.getString(R.string.tab_menu_delete), danger = true, shortcut = "Delete") { deleting = host })
    }

    val onKey: (KeyEvent) -> Boolean = handler@{ event ->
        val e = event.nativeKeyEvent
        if (e.action != AndroidKeyEvent.ACTION_DOWN) return@handler false
        // 浮层自己处理按键(Esc 取消、Ctrl+S 保存)。
        if (sheet != null || deleting != null) return@handler false
        // 焦点在搜索框里时是"在列表里找主机":↑↓ 换选中、回车连接、Esc 退出搜索 —— 哪怕右栏开着终端。
        val inTerminal = termHost != null && !searchFocused
        val ctrl = e.isCtrlPressed && !e.isAltPressed && !e.isMetaPressed
        val shift = e.isShiftPressed
        // 终端里 Ctrl+字母是远端的(bash 的 Ctrl+N 是下一条历史、Ctrl+F 是光标右移),只认 Ctrl+Shift。
        val command = ctrl && (shift || !inTerminal)
        val code = e.keyCode
        when {
            ctrl && code == AndroidKeyEvent.KEYCODE_TAB -> cycleSessions(if (shift) -1 else 1)
            command && code == AndroidKeyEvent.KEYCODE_N -> sheet = SheetTarget.New
            command && code == AndroidKeyEvent.KEYCODE_F -> {
                if (!sidebarVisible) toggleSidebar()
                searchRequest++
            }
            command && code == AndroidKeyEvent.KEYCODE_E -> {
                val target = termHost ?: shown ?: return@handler false
                sheet = SheetTarget.Edit(target)
            }
            ctrl && shift && code == AndroidKeyEvent.KEYCODE_S -> toggleSidebar()
            ctrl && shift && code == AndroidKeyEvent.KEYCODE_O -> {
                val id = termHost?.id?.takeIf { running.containsKey(it) } ?: return@handler false
                toggleFiles(id)
            }
            ctrl && shift && code == AndroidKeyEvent.KEYCODE_W -> {
                disconnect(termHost ?: return@handler false)
            }
            ctrl && shift && code in AndroidKeyEvent.KEYCODE_1..AndroidKeyEvent.KEYCODE_9 -> {
                connect(sessions.getOrNull(code - AndroidKeyEvent.KEYCODE_1) ?: return@handler false)
            }
            // 以下是列表里的导航键;终端开着时一律交给终端。
            inTerminal -> return@handler false
            code == AndroidKeyEvent.KEYCODE_ESCAPE && (searchFocused || query.isNotEmpty()) -> {
                query = ""
                // 退出搜索后焦点回到刚才在用的地方:开着终端就回终端,接着能打字。
                if (termHost != null) terminalFocus++ else runCatching { rootFocus.requestFocus() }
            }
            code == AndroidKeyEvent.KEYCODE_DPAD_UP -> moveSelection(-1)
            code == AndroidKeyEvent.KEYCODE_DPAD_DOWN -> moveSelection(1)
            code == AndroidKeyEvent.KEYCODE_ENTER || code == AndroidKeyEvent.KEYCODE_NUMPAD_ENTER -> {
                connect(filtered.firstOrNull { it.id == shown?.id } ?: filtered.firstOrNull() ?: return@handler false)
            }
            code == AndroidKeyEvent.KEYCODE_FORWARD_DEL && !searchFocused -> {
                deleting = shown ?: return@handler false
            }
            else -> return@handler false
        }
        true
    }

    CompositionLocalProvider(
        LocalRestoreFocus provides {
            if (termHost != null) terminalFocus++ else runCatching { rootFocus.requestFocus() }
        },
    ) {
    BoxWithConstraints(
        Modifier
            .fillMaxSize()
            .background(p.bg)
            // Ctrl 组合键赶在输入法前面拿(搜索框里开着中文输入法时,它会先把按键吃掉)。
            // Esc 只在没组词时抢(组词时 Esc 是取消拼音,归输入法)。
            .onInterceptKeyBeforeSoftKeyboard {
                if (it.isCtrlPressed) return@onInterceptKeyBeforeSoftKeyboard onKey(it)
                if (!searchFocused) return@onInterceptKeyBeforeSoftKeyboard false
                // 搜索框里没在组词时,↑↓ / 回车 / Esc 是列表导航,要赶在输入法前面拿 ——
                // 实测小米输入法开着时连方向键和回车都先被它拿走,选不了、连不上。
                // 组词中(拼音还攒在输入法里)这些键归输入法:回车上屏、方向键选候选、Esc 取消。
                val composing = searchComposing || searchIme.holding
                if (it.key in SearchNavKeys && !composing && onKey(it)) return@onInterceptKeyBeforeSoftKeyboard true
                searchIme.observe(it.nativeKeyEvent)
                false
            }
            .onPreviewKeyEvent(onKey)
            // 焦点兜底:鼠标每按一下,Compose 都会把当前焦点清掉(实测终端的按键节点在按下时丢焦点,
            // 双击选词、拖选、点侧边栏之后实体键盘就没了去处)。整棵界面没了焦点、而窗口本身还拿着焦点
            // (不是浮层 / 菜单开着)时,把焦点还回去:开着终端回终端,否则回列表。
            .onFocusChanged { state ->
                treeFocused = state.hasFocus
                if (!state.hasFocus) {
                    refocusScope.launch {
                        delay(60)
                        if (!treeFocused && windowInfo.isWindowFocused && sheet == null && deleting == null) {
                            if (termHost != null) terminalFocus++ else runCatching { rootFocus.requestFocus() }
                        }
                    }
                }
            }
            .focusRequester(rootFocus)
            .focusable(),
    ) {
        // 窗格宽度按小米的建议落在 280–600dp:横屏 1363dp 给 340,竖屏 909dp 给 280 出头。
        val sidebarWidth = (maxWidth * 0.26f).coerceIn(280.dp, 340.dp)
        Row(Modifier.fillMaxSize()) {
            AnimatedVisibility(
                visible = sidebarVisible,
                enter = expandHorizontally(tween(260)) + fadeIn(tween(200)),
                exit = shrinkHorizontally(tween(220)) + fadeOut(tween(160)),
            ) {
                Row {
                    Sidebar(
                        modifier = Modifier.width(sidebarWidth).fillMaxHeight(),
                        hosts = filtered,
                        total = hosts.size,
                        sessions = if (query.isBlank()) sessions else emptyList(),
                        running = running.keys,
                        query = query,
                        onQuery = { query = it },
                        searchFocus = searchFocus,
                        onSearchFocused = { searchFocused = it },
                        onSearchComposing = {
                            searchComposing = it
                            searchIme.onTextChanged()
                        },
                        // 主机区高亮"右栏正在显示的那台":详情、或者还没连上的连接页 / 错误页;
                        // 已经是会话的,高亮落在会话区那一行。
                        detailId = when {
                            termHost == null -> shown?.id
                            running.containsKey(termHost.id) -> null
                            else -> termHost.id
                        },
                        terminalId = termHost?.id,
                        onClickHost = { host ->
                            // 单击:连着的主机直接回到它的终端;没连的看详情。
                            if (running.containsKey(host.id)) connect(host) else {
                                onSelect(host.id)
                                if (termHost != null) onCloseTerminal()
                            }
                        },
                        onOpenHost = ::connect,
                        onCloseSession = ::disconnect,
                        onNew = { sheet = SheetTarget.New },
                        onFonts = { fontSheet = true },
                        menuFor = ::menuFor,
                    )
                    Box(Modifier.width(0.5.dp).fillMaxHeight().background(p.border))
                }
            }
            Box(
                Modifier
                    .weight(1f)
                    .fillMaxHeight()
                    .background(p.bg)
                    .windowInsetsPadding(
                        stableSafeDrawing().only(
                            if (sidebarVisible) {
                                WindowInsetsSides.Vertical + WindowInsetsSides.End
                            } else {
                                WindowInsetsSides.Vertical + WindowInsetsSides.Horizontal
                            },
                        ),
                    ),
            ) {
                val pane: String = when {
                    termHost != null && termHost.id in filesFor && running.containsKey(termHost.id) -> "files:" + termHost.id
                    termHost != null -> "term:" + termHost.id
                    hosts.isEmpty() -> "welcome"
                    else -> "detail:" + shown?.id
                }
                AnimatedContent(
                    targetState = pane,
                    transitionSpec = { fadeIn(tween(160)) togetherWith fadeOut(tween(120)) },
                    label = "tabletPane",
                ) { paneKey ->
                    // 淡入淡出的那一小段里,退场的那一栏也还在组合里。焦点请求只给进场的那一栏 ——
                    // 否则退场的文件面板会在 40ms 后把焦点抢回去,切回终端后敲键盘没反应。
                    val focusRequest = if (paneKey == pane) terminalFocus else 0
                    when {
                        paneKey.startsWith("term:") -> {
                            val host = hosts.firstOrNull { "term:" + it.id == paneKey }
                            if (host != null) {
                                key(host.id) {
                                    TerminalScreen(
                                        host = host,
                                        onExit = onCloseTerminal,
                                        onTrustKey = { onTrustKey(host, it) },
                                        onTrustJumpKey = { jump, fingerprint -> onTrustKey(jump, fingerprint) },
                                        tablet = TabletTerminalChrome(
                                            sidebarVisible = sidebarVisible,
                                            onToggleSidebar = ::toggleSidebar,
                                            onEdit = { sheet = SheetTarget.Edit(host) },
                                            focusRequest = focusRequest,
                                            onShowFiles = { toggleFiles(host.id) },
                                        ),
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
                                            sidebarVisible = sidebarVisible,
                                            onToggleSidebar = ::toggleSidebar,
                                            onShowTerminal = { toggleFiles(host.id) },
                                        ),
                                        focusRequest = focusRequest,
                                    )
                                }
                            }
                        }
                        paneKey == "welcome" -> TabletWelcome(
                            sidebarVisible = sidebarVisible,
                            onToggleSidebar = ::toggleSidebar,
                            onNew = { sheet = SheetTarget.New },
                        )
                        else -> {
                            val host = hosts.firstOrNull { "detail:" + it.id == paneKey }
                            if (host != null) {
                                TabletHostDetail(
                                    host = host,
                                    running = running.containsKey(host.id),
                                    sidebarVisible = sidebarVisible,
                                    onToggleSidebar = ::toggleSidebar,
                                    onConnect = { connect(host) },
                                    onDisconnect = { disconnect(host) },
                                    onEdit = { sheet = SheetTarget.Edit(host) },
                                    onDelete = { deleting = host },
                                )
                            }
                        }
                    }
                }
            }
        }
    }

    }

    if (fontSheet) SettingsSheet(onDismiss = { fontSheet = false })
    sheet?.let { target ->
        val initial = (target as? SheetTarget.Edit)?.host
        HostSheet(
            initial = initial,
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
    deleting?.let { host ->
        ConfirmDialog(
            title = stringResource(R.string.tab_delete_host_title, host.label),
            message = if (running.containsKey(host.id)) stringResource(R.string.tab_delete_host_session_note) else null,
            confirm = stringResource(R.string.tab_delete),
            danger = true,
            onConfirm = {
                deleting = null
                disconnect(host)
                onDelete(host)
            },
            onDismiss = { deleting = null },
        )
    }
}

fun copyText(context: android.content.Context, text: String) {
    val clipboard = context.getSystemService(android.content.ClipboardManager::class.java) ?: return
    clipboard.setPrimaryClip(android.content.ClipData.newPlainText("X-SSH", text))
}

/* ─────────────────────────────── 侧边栏 ─────────────────────────────── */

@Composable
private fun Sidebar(
    modifier: Modifier,
    hosts: List<Host>,
    total: Int,
    sessions: List<Host>,
    running: Set<String>,
    query: String,
    onQuery: (String) -> Unit,
    searchFocus: FocusRequester,
    onSearchFocused: (Boolean) -> Unit,
    onSearchComposing: (Boolean) -> Unit,
    detailId: String?,
    terminalId: String?,
    onClickHost: (Host) -> Unit,
    onOpenHost: (Host) -> Unit,
    onCloseSession: (Host) -> Unit,
    onNew: () -> Unit,
    onFonts: () -> Unit,
    menuFor: (Host) -> List<MenuAction>,
) {
    val p = LocalXssh.current
    val theme = LocalThemeControl.current
    Column(
        modifier
            .background(p.cardBg)
            .windowInsetsPadding(stableSafeDrawing().only(WindowInsetsSides.Vertical + WindowInsetsSides.Start)),
    ) {
        Row(
            Modifier.fillMaxWidth().height(ToolbarHeight).padding(start = 20.dp, end = 10.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Box(Modifier.weight(1f), contentAlignment = Alignment.CenterStart) { BrandLockup(BrandToolbarHeight) }
            ToolbarIcon(theme.mode.icon, stringResource(R.string.tab_appearance, theme.mode.label)) { theme.onChange(theme.mode.next()) }
            ToolbarIcon(XIcons.Settings, stringResource(R.string.set_title)) { onFonts() }
            ToolbarIcon(XIcons.Plus, stringResource(R.string.tab_new_host) + "  Ctrl+N") { onNew() }
        }
        if (total > 0) {
            SidebarSearch(
                query = query,
                onQuery = onQuery,
                focusRequester = searchFocus,
                onFocused = onSearchFocused,
                onComposing = onSearchComposing,
                modifier = Modifier.padding(start = 12.dp, end = 12.dp, bottom = 8.dp),
            )
        }
        LazyColumn(Modifier.weight(1f).fillMaxWidth().bounce()) {
            if (sessions.isNotEmpty()) {
                item(key = "h:sessions") { SectionHeader(stringResource(R.string.tab_sessions)) }
                items(sessions, key = { "s:" + it.id }) { host ->
                    SidebarRow(
                        host = host,
                        selected = host.id == terminalId,
                        running = true,
                        showChips = false,
                        onClick = { onOpenHost(host) },
                        onDoubleClick = null,
                        menu = { menuFor(host) },
                        onClose = { onCloseSession(host) },
                    )
                }
            }
            if (total > 0) {
                item(key = "h:hosts") { SectionHeader(stringResource(if (query.isBlank()) R.string.tab_hosts else R.string.tab_search_results)) }
            }
            items(hosts, key = { "h:" + it.id }) { host ->
                SidebarRow(
                    host = host,
                    selected = host.id == detailId,
                    running = host.id in running,
                    showChips = true,
                    onClick = { onClickHost(host) },
                    onDoubleClick = { onOpenHost(host) },
                    menu = { menuFor(host) },
                )
            }
            if (total > 0 && hosts.isEmpty()) {
                item(key = "empty") {
                    Text(
                        stringResource(R.string.tab_no_matching_hosts),
                        color = p.textDim,
                        fontSize = 14.sp,
                        modifier = Modifier.padding(horizontal = 20.dp, vertical = 12.dp),
                    )
                }
            }
            item(key = "tail") { Spacer(Modifier.height(24.dp)) }
        }
    }
}

@Composable
private fun SectionHeader(text: String) {
    Text(
        text,
        color = LocalXssh.current.textDim,
        fontSize = 13.sp,
        fontWeight = FontWeight.Medium,
        modifier = Modifier.padding(start = 20.dp, top = 14.dp, bottom = 6.dp),
    )
}

@Composable
private fun SidebarSearch(
    query: String,
    onQuery: (String) -> Unit,
    focusRequester: FocusRequester,
    onFocused: (Boolean) -> Unit,
    onComposing: (Boolean) -> Unit,
    modifier: Modifier,
) {
    val p = LocalXssh.current
    Row(
        modifier
            .fillMaxWidth()
            .height(38.dp)
            .clip(RoundedCornerShape(10.dp))
            .background(p.bgElev2)
            .padding(horizontal = 10.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Icon(XIcons.Search, contentDescription = null, tint = p.textDim, modifier = Modifier.size(18.dp))
        Spacer(Modifier.width(8.dp))
        Box(Modifier.weight(1f), contentAlignment = Alignment.CenterStart) {
            if (query.isEmpty()) Text(stringResource(R.string.tab_search) + "  Ctrl+F", color = p.textFaint, fontSize = 15.sp)
            var field by remember { mutableStateOf(TextFieldValue(query)) }
            val shown = syncedField(field, query)
            BasicTextField(
                value = shown,
                onValueChange = {
                    field = it
                    onComposing(it.composition != null)
                    if (it.text != query) onQuery(it.text)
                },
                singleLine = true,
                textStyle = TextStyle(color = p.text, fontSize = 15.sp),
                cursorBrush = SolidColor(p.accent),
                keyboardOptions = KeyboardOptions(imeAction = ImeAction.Search),
                modifier = Modifier
                    .fillMaxWidth()
                    .focusRequester(focusRequester)
                    .onFocusChanged { onFocused(it.isFocused) }
                    .pointerHoverIcon(PointerIcon.Text),
            )
        }
        if (query.isNotEmpty()) {
            val clearLabel = stringResource(R.string.tab_clear_search)
            Box(
                Modifier
                    .size(24.dp)
                    .clip(RoundedCornerShape(12.dp))
                    .clickable { onQuery("") }
                    .pointerHoverIcon(PointerIcon.Hand)
                    .semantics { contentDescription = clearLabel },
                contentAlignment = Alignment.Center,
            ) {
                Icon(XIcons.Close, contentDescription = null, tint = p.textDim, modifier = Modifier.size(14.dp))
            }
        }
    }
}

/**
 * 侧边栏的一行。单击选中 / 打开;双击连接;右键(触摸长按)出菜单;指针悬停时底色变浅灰。
 */
@OptIn(ExperimentalFoundationApi::class)
@Composable
private fun SidebarRow(
    host: Host,
    selected: Boolean,
    running: Boolean,
    showChips: Boolean,
    onClick: () -> Unit,
    onDoubleClick: (() -> Unit)?,
    menu: () -> List<MenuAction>,
    /** 会话行:指针悬停时行尾出一个 ✕,点了断开(浏览器标签页的做法;触摸用长按菜单里的「断开」)。 */
    onClose: (() -> Unit)? = null,
) {
    val p = LocalXssh.current
    val density = LocalDensity.current
    val interaction = remember { MutableInteractionSource() }
    val hovered by interaction.collectIsHoveredAsState()
    val pressed by interaction.collectIsPressedAsState()
    var menuAt by remember { mutableStateOf<DpOffset?>(null) }
    var lastClick by remember { mutableLongStateOf(0L) }
    var height by remember { mutableIntStateOf(0) }

    val background = when {
        selected -> p.rowSel
        pressed -> p.bgElev2.copy(alpha = p.bgElev2.alpha * 1.6f)
        hovered -> p.bgElev2
        else -> Color.Transparent
    }
    Box(Modifier.fillMaxWidth().padding(horizontal = 8.dp, vertical = 1.dp).onSizeChanged { height = it.height }) {
        Row(
            Modifier
                .fillMaxWidth()
                .clip(RoundedCornerShape(10.dp))
                .background(background)
                // 右键:在指针位置弹菜单。Initial 阶段先拿到,不让它再被当成一次点击。
                .pointerInput(Unit) {
                    awaitPointerEventScope {
                        while (true) {
                            val event = awaitPointerEvent(PointerEventPass.Initial)
                            if (event.type == PointerEventType.Press && event.buttons.isSecondaryPressed) {
                                val at = event.changes.first().position
                                event.changes.forEach { it.consume() }
                                menuAt = with(density) { DpOffset(at.x.toDp(), (at.y - height).toDp()) }
                            }
                        }
                    }
                }
                .hoverable(interaction)
                .combinedClickable(
                    interactionSource = interaction,
                    indication = null,
                    onLongClick = { menuAt = DpOffset(24.dp, 0.dp) },
                ) {
                    // 双击自己判:combinedClickable 的 onDoubleClick 会让每次单击都等 300ms 才生效,选中会发钝。
                    val now = SystemClock.uptimeMillis()
                    if (onDoubleClick != null && now - lastClick < 350) {
                        lastClick = 0L
                        onDoubleClick()
                    } else {
                        lastClick = now
                        onClick()
                    }
                }
                .padding(horizontal = 10.dp, vertical = 9.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Box(
                Modifier
                    .size(34.dp)
                    .clip(RoundedCornerShape(9.dp))
                    .background(if (running) p.ok.copy(alpha = 0.16f) else p.bgElev2),
                contentAlignment = Alignment.Center,
            ) {
                Icon(
                    XIcons.Terminal,
                    contentDescription = null,
                    tint = if (running) p.ok else p.textDim,
                    modifier = Modifier.size(19.dp),
                )
            }
            Spacer(Modifier.width(12.dp))
            Column(Modifier.weight(1f)) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text(
                        host.label,
                        color = p.text,
                        fontSize = 15.sp,
                        fontWeight = FontWeight.Medium,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                        modifier = Modifier.weight(1f, fill = false),
                    )
                    if (showChips && host.keyFingerprint.isBlank()) {
                        Spacer(Modifier.width(6.dp))
                        Chip(stringResource(R.string.tab_chip_unverified), p.warn)
                    }
                }
                Spacer(Modifier.height(3.dp))
                Text(
                    host.subtitle,
                    color = p.textDim,
                    fontSize = 12.sp,
                    fontFamily = XsshFonts.monoUi,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
            }
            if (onClose != null && hovered) {
                val closeInteraction = remember { MutableInteractionSource() }
                val closeHovered by closeInteraction.collectIsHoveredAsState()
                val closeLabel = stringResource(R.string.tab_disconnect_host, host.label)
                Box(
                    Modifier
                        .size(28.dp)
                        .clip(RoundedCornerShape(8.dp))
                        .background(if (closeHovered) p.bgElev2 else Color.Transparent)
                        .hoverable(closeInteraction)
                        .pointerHoverIcon(PointerIcon.Hand)
                        .clickable(interactionSource = closeInteraction, indication = null, role = Role.Button) { onClose() }
                        .semantics { contentDescription = closeLabel },
                    contentAlignment = Alignment.Center,
                ) {
                    Icon(XIcons.Close, contentDescription = null, tint = p.textDim, modifier = Modifier.size(15.dp))
                }
            }
        }
        ContextMenu(at = menuAt, onDismiss = { menuAt = null }, actions = menu)
    }
}

/**
 * 菜单关掉之后焦点该回哪儿。菜单是个拿焦点的弹层,关掉后焦点不会自己回来 ——
 * 实测关掉右键菜单后,实体键盘敲什么都没反应(焦点丢了)。由外层提供:终端里回终端,列表里回列表。
 */
val LocalRestoreFocus = androidx.compose.runtime.staticCompositionLocalOf<() -> Unit> { {} }

/** 上下文菜单(右键 / 长按)。挂在触发它的那个 Box 里,[at] 是相对这个 Box 的位置。 */
@Composable
fun ContextMenu(at: DpOffset?, onDismiss: () -> Unit, actions: () -> List<MenuAction>) {
    val p = LocalXssh.current
    val restore = LocalRestoreFocus.current
    // 快捷键提示只在插着实体键盘时有意义;纯触摸时那一列「Ctrl+D」只是噪音。
    val hardKeyboard = LocalConfiguration.current.hasHardKeyboard()
    // 从开着变成关上的那一刻,把焦点还回去(等弹层窗口真正撤掉再要,不然要了也白要)。
    var wasOpen by remember { mutableStateOf(false) }
    LaunchedEffect(at != null) {
        if (at != null) {
            wasOpen = true
        } else if (wasOpen) {
            wasOpen = false
            delay(80)
            restore()
        }
    }
    DropdownMenu(
        expanded = at != null,
        onDismissRequest = onDismiss,
        offset = at ?: DpOffset.Zero,
        shape = RoundedCornerShape(12.dp),
        containerColor = if (p.dark) p.bgElev else Color.White,
        // 右边还要放快捷键提示,默认的最窄宽度会把两段字挤在一起。
        modifier = Modifier.widthIn(min = 220.dp),
    ) {
        if (at != null) {
            actions().forEach { action ->
                DropdownMenuItem(
                    text = {
                        Text(action.label, color = if (action.danger) p.danger else p.text, fontSize = 15.sp)
                    },
                    trailingIcon = action.shortcut?.takeIf { hardKeyboard }?.let { hint ->
                        { Text(hint, color = p.textFaint, fontSize = 12.sp) }
                    },
                    onClick = {
                        onDismiss()
                        action.onClick()
                    },
                    modifier = Modifier.pointerHoverIcon(PointerIcon.Hand),
                )
            }
        }
    }
}

/* ─────────────────────────────── 工具栏 ─────────────────────────────── */

/**
 * 内容区顶上的工具栏:左边是侧边栏开关和标题,右边是这一栏的操作。
 * 横线和侧边栏标题行的底边在同一条线上。
 */
@Composable
fun TabletToolbar(
    sidebarVisible: Boolean,
    onToggleSidebar: () -> Unit,
    title: String = "",
    subtitle: String? = null,
    dot: Color? = null,
    actions: @Composable RowScope.() -> Unit = {},
) {
    val p = LocalXssh.current
    Column(Modifier.fillMaxWidth().background(p.bg)) {
        Row(
            Modifier.fillMaxWidth().height(ToolbarHeight).padding(horizontal = 10.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(4.dp),
        ) {
            ToolbarIcon(
                XIcons.Sidebar,
                stringResource(if (sidebarVisible) R.string.tab_hide_sidebar else R.string.tab_show_sidebar) + "  Ctrl+Shift+S",
            ) { onToggleSidebar() }
            // 外观按钮平时在侧边栏标题行;侧边栏收起来时挪到这里 —— 任何时候都能换深浅色。
            val theme = LocalThemeControl.current
            GlassRevealRow(!sidebarVisible) {
                ToolbarIcon(theme.mode.icon, stringResource(R.string.tab_appearance, theme.mode.label)) { theme.onChange(theme.mode.next()) }
            }
            Spacer(Modifier.width(6.dp))
            if (dot != null) {
                StatusDot(dot)
                Spacer(Modifier.width(4.dp))
            }
            Column(Modifier.weight(1f)) {
                if (title.isNotBlank()) {
                    Text(
                        title,
                        color = p.text,
                        fontSize = 16.sp,
                        fontWeight = FontWeight.SemiBold,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                    )
                }
                if (!subtitle.isNullOrBlank()) {
                    Text(
                        subtitle,
                        color = p.textDim,
                        fontSize = 11.5.sp,
                        fontFamily = XsshFonts.monoUi,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                    )
                }
            }
            actions()
        }
        Box(Modifier.fillMaxWidth().height(0.5.dp).background(p.border))
    }
}

/**
 * 工具栏上的图标按钮:40dp 方形热区(连续排列时热区相接,HIG 要求指针不在按钮之间跳回默认形状),
 * 悬停变浅灰、按下更深;悬停半秒出文字提示(图标按钮在指针下必须能说清自己是什么)。
 * [active] 为开关打开的状态(图标变蓝)。
 */
@Composable
fun ToolbarIcon(
    icon: ImageVector,
    label: String,
    tint: Color? = null,
    active: Boolean = false,
    onClick: () -> Unit,
) {
    val p = LocalXssh.current
    val interaction = remember { MutableInteractionSource() }
    val hovered by interaction.collectIsHoveredAsState()
    val pressed by interaction.collectIsPressedAsState()
    Box {
        Box(
            Modifier
                .size(40.dp)
                .clip(RoundedCornerShape(10.dp))
                .background(
                    when {
                        pressed -> p.bgElev2.copy(alpha = p.bgElev2.alpha * 1.8f)
                        active -> p.accentSoft
                        hovered -> p.bgElev2
                        else -> Color.Transparent
                    },
                )
                .hoverable(interaction)
                .pointerHoverIcon(PointerIcon.Hand)
                .clickable(interactionSource = interaction, indication = null, role = Role.Button) { onClick() }
                .semantics { contentDescription = label },
            contentAlignment = Alignment.Center,
        ) {
            Icon(
                icon,
                contentDescription = null,
                tint = tint ?: if (active) p.accent else p.text,
                modifier = Modifier.size(22.dp),
            )
        }
        HoverTip(visible = hovered, label = label)
    }
}

/** 工具栏里的文字按钮(「断开」「取消」「保存」)。 */
@Composable
fun ToolbarTextButton(
    label: String,
    color: Color,
    modifier: Modifier = Modifier,
    bold: Boolean = false,
    onClick: () -> Unit,
) {
    val p = LocalXssh.current
    val interaction = remember { MutableInteractionSource() }
    val hovered by interaction.collectIsHoveredAsState()
    val pressed by interaction.collectIsPressedAsState()
    Box(
        modifier
            .heightIn(min = 40.dp)
            .clip(RoundedCornerShape(10.dp))
            .background(
                when {
                    pressed -> p.bgElev2.copy(alpha = p.bgElev2.alpha * 1.8f)
                    hovered -> p.bgElev2
                    else -> Color.Transparent
                },
            )
            .hoverable(interaction)
            .pointerHoverIcon(PointerIcon.Hand)
            .clickable(interactionSource = interaction, indication = null, role = Role.Button) { onClick() }
            .padding(horizontal = 12.dp),
        contentAlignment = Alignment.Center,
    ) {
        Text(label, color = color, fontSize = 16.sp, fontWeight = if (bold) FontWeight.SemiBold else FontWeight.Normal)
    }
}

/** 指针停在按钮上半秒后,在它下面出一行说明。 */
@Composable
private fun HoverTip(visible: Boolean, label: String) {
    val p = LocalXssh.current
    val density = LocalDensity.current
    var show by remember { mutableStateOf(false) }
    LaunchedEffect(visible) {
        show = false
        if (visible) {
            delay(500)
            show = true
        }
    }
    if (!show) return
    Popup(
        alignment = Alignment.TopCenter,
        offset = with(density) { IntOffset(0, 46.dp.roundToPx()) },
        properties = PopupProperties(focusable = false, clippingEnabled = false),
    ) {
        Text(
            label,
            color = p.text,
            fontSize = 12.sp,
            modifier = Modifier
                .clip(RoundedCornerShape(7.dp))
                .background(if (p.dark) p.bgElev else Color.White)
                .border(0.5.dp, p.borderStrong, RoundedCornerShape(7.dp))
                .padding(horizontal = 8.dp, vertical = 5.dp),
        )
    }
}

/* ─────────────────────────────── 右栏:详情 / 欢迎 ─────────────────────────────── */

@Composable
private fun TabletHostDetail(
    host: Host,
    running: Boolean,
    sidebarVisible: Boolean,
    onToggleSidebar: () -> Unit,
    onConnect: () -> Unit,
    onDisconnect: () -> Unit,
    onEdit: () -> Unit,
    onDelete: () -> Unit,
) {
    val p = LocalXssh.current
    Column(Modifier.fillMaxSize()) {
        TabletToolbar(sidebarVisible, onToggleSidebar) {
            ToolbarIcon(XIcons.Pencil, stringResource(R.string.tab_edit_host) + "  Ctrl+E") { onEdit() }
            ToolbarIcon(XIcons.Trash, stringResource(R.string.tab_delete_host) + "  Delete", tint = p.danger) { onDelete() }
        }
        Column(
            Modifier
                .fillMaxSize()
                .bounce()
                .verticalScroll(rememberScrollState())
                .padding(horizontal = 40.dp, vertical = 28.dp),
        ) {
            // 正文限宽:平板横屏右栏有 1000dp,"标签在左、取值在右"的一行不能横跨过去(小米:有顺序的列表缩进控宽)。
            Column(Modifier.widthIn(max = 600.dp)) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Box(
                        Modifier
                            .size(64.dp)
                            .clip(RoundedCornerShape(16.dp))
                            .background(if (running) p.ok.copy(alpha = 0.16f) else p.cardBg),
                        contentAlignment = Alignment.Center,
                    ) {
                        Icon(
                            XIcons.Terminal,
                            contentDescription = null,
                            tint = if (running) p.ok else p.text,
                            modifier = Modifier.size(34.dp),
                        )
                    }
                    Spacer(Modifier.width(18.dp))
                    Column(Modifier.weight(1f)) {
                        Text(
                            host.label,
                            color = p.text,
                            fontSize = 30.sp,
                            fontWeight = FontWeight.Bold,
                            maxLines = 1,
                            overflow = TextOverflow.Ellipsis,
                        )
                        Spacer(Modifier.height(4.dp))
                        Text(host.subtitle, color = p.textDim, fontSize = 14.sp, fontFamily = XsshFonts.monoUi)
                    }
                }
                Spacer(Modifier.height(24.dp))
                // 按钮按内容宽,不拉满(小米:按钮加最大宽度限制,避免横向过度拉伸)。
                Row(horizontalArrangement = Arrangement.spacedBy(GapItem)) {
                    XsshButton(
                        stringResource(if (running) R.string.tab_open_session else R.string.tab_connect),
                        Modifier.widthIn(min = 150.dp),
                    ) { onConnect() }
                    if (running) {
                        XsshButton(stringResource(R.string.tab_disconnect),Modifier.widthIn(min = 110.dp), kind = ButtonKind.Danger) { onDisconnect() }
                    }
                }
                Spacer(Modifier.height(32.dp))
                HostInfoGroups(host)
            }
        }
    }
}

@Composable
private fun TabletWelcome(sidebarVisible: Boolean, onToggleSidebar: () -> Unit, onNew: () -> Unit) {
    val p = LocalXssh.current
    Column(Modifier.fillMaxSize()) {
        TabletToolbar(sidebarVisible, onToggleSidebar)
        Box(Modifier.weight(1f).fillMaxWidth(), contentAlignment = Alignment.Center) {
            Column(horizontalAlignment = Alignment.CenterHorizontally) {
                Box(
                    Modifier.size(72.dp).clip(RoundedCornerShape(18.dp)).background(p.cardBg),
                    contentAlignment = Alignment.Center,
                ) {
                    Icon(XIcons.Terminal, contentDescription = null, tint = p.textDim, modifier = Modifier.size(38.dp))
                }
                Spacer(Modifier.height(18.dp))
                Text(stringResource(R.string.tab_no_hosts_yet), color = p.text, fontSize = 20.sp, fontWeight = FontWeight.SemiBold)
                Spacer(Modifier.height(20.dp))
                XsshButton(stringResource(R.string.tab_new_host),Modifier.widthIn(min = 160.dp)) { onNew() }
            }
        }
    }
}

/* ─────────────────────────────── 浮层 ─────────────────────────────── */

/**
 * 新建 / 编辑主机:居中浮层(iPad 的 form sheet)。
 *
 * 「取消」在左、「保存」在右(HIG:Cancel 在前缘、Done 在后缘);Esc 取消、Ctrl+S 保存、
 * 最后一格按回车也是保存。新建时焦点直接落在「名称」上,插着键盘就能开始打字。
 * 改过内容再点外面 / 按 Esc,先确认是否放弃,不悄悄丢掉。
 */
@Composable
private fun HostSheet(
    initial: Host?,
    onCancel: () -> Unit,
    onSave: (Host) -> Unit,
    onDelete: (Host) -> Unit,
) {
    val p = LocalXssh.current
    val draft = remember(initial?.id) { HostDraft(initial) }
    var confirmDiscard by remember { mutableStateOf(false) }
    val first = remember { FocusRequester() }
    val passwordFocus = remember { FocusRequester() }
    // 缺密码的主机(多半是从"这台主机还没有保存密码"点进来的):焦点直接落在密码那一格。
    // 加锁的主机在这里长得一样(明文为空),但它其实**有**密码 —— 别把焦点抢过去,
    // 否则用户一打开浮层就看见密码格被选中,像是要重填。
    val wantsPassword = initial != null && initial.auth == AuthKind.PASSWORD &&
        initial.password.isEmpty() && initial.lockedPassword == null
    // 输入法正在组词(拼音还没上屏)时,Esc 是取消拼音;否则 Esc 就是关浮层。
    // 两路判断:输入框报的 composition(标准输入法),以及 ImeBuffer 的推断(小米输入法不报)。
    var composing by remember { mutableStateOf(false) }
    val ime = remember { ImeBuffer() }
    val scope = rememberCoroutineScope()
    val context = LocalContext.current
    val passphraseFocus = remember { FocusRequester() }
    var keyMessage by remember { mutableStateOf<String?>(null) }
    val importKey = rememberKeyImporter(draft) { keyMessage = it }
    // 导入的私钥带口令:焦点直接落到口令那一格。
    LaunchedEffect(keyMessage, draft.keyLocked) {
        if (draft.keyLocked && draft.keyPassphrase.isEmpty()) {
            delay(80)
            runCatching { passphraseFocus.requestFocus() }
        }
    }

    // 拖放导入私钥:从文件管理器(分屏 / 小窗)把私钥文件拖进浮层,或者拖一段私钥文本进来。
    var dropHover by remember { mutableStateOf(false) }
    val dropTarget = remember(draft) {
        object : DragAndDropTarget {
            override fun onEntered(event: DragAndDropEvent) {
                dropHover = true
            }

            override fun onExited(event: DragAndDropEvent) {
                dropHover = false
            }

            override fun onEnded(event: DragAndDropEvent) {
                dropHover = false
            }

            override fun onDrop(event: DragAndDropEvent): Boolean {
                dropHover = false
                val drag = event.toAndroidDragEvent()
                val item = drag.clipData?.takeIf { it.itemCount > 0 }?.getItemAt(0) ?: return false
                val uri = item.uri
                // 跨应用拖进来的文件要先申请读取权限,否则 openInputStream 直接被拒。
                if (uri != null) (context as? android.app.Activity)?.requestDragAndDropPermissions(drag)
                scope.launch {
                    keyMessage = withContext(Dispatchers.IO) {
                        if (uri != null) {
                            importKeyFrom(context, uri, draft)
                        } else {
                            draft.importKey(item.coerceToText(context).toString(), context.getString(R.string.tab_dropped_key_name))?.resolve(context)
                        }
                    }
                }
                return true
            }
        }
    }

    fun save() {
        val activity = hostActivity(context)
        if (activity == null) {
            draft.error = UiText(R.string.tab_save_failed_no_page)
            return
        }
        scope.launch {
            val host = buildHostForSave(activity, draft)
            host?.let(onSave)
        }
    }
    fun cancel() {
        if (draft.dirty) confirmDiscard = true else onCancel()
    }
    val onKey: (KeyEvent) -> Boolean = handler@{ event ->
        val e = event.nativeKeyEvent
        if (e.action != AndroidKeyEvent.ACTION_DOWN) return@handler false
        when {
            e.isCtrlPressed && e.keyCode == AndroidKeyEvent.KEYCODE_S -> save()
            e.isCtrlPressed && e.keyCode == AndroidKeyEvent.KEYCODE_ENTER -> save()
            e.keyCode == AndroidKeyEvent.KEYCODE_ESCAPE -> cancel()
            else -> return@handler false
        }
        true
    }

    Dialog(
        onDismissRequest = { cancel() },
        properties = DialogProperties(
            usePlatformDefaultWidth = false,
            decorFitsSystemWindows = false,
            dismissOnClickOutside = false,
        ),
    ) {
        // 整窗一层:点浮层外面 = 取消;软键盘弹起时浮层整体上移,不被盖住。
        BoxWithConstraints(
            Modifier
                .fillMaxSize()
                .clickable(interactionSource = remember { MutableInteractionSource() }, indication = null) { cancel() }
                .windowInsetsPadding(stableSafeDrawing())
                .imePadding(),
            contentAlignment = Alignment.Center,
        ) {
            // 小米:大屏弹窗高度不超过屏幕的 70%(内容多时浮层里滚动)。
            val maxHeight = maxHeight * 0.8f
            Column(
                Modifier
                    .width(minOf(SheetWidth, maxWidth - 48.dp))
                    .heightIn(max = maxHeight)
                    .clip(RoundedCornerShape(20.dp))
                    .background(p.bg)
                    .border(
                        if (dropHover) 2.dp else 0.5.dp,
                        if (dropHover) p.accent else p.glassBorder,
                        RoundedCornerShape(20.dp),
                    )
                    .dragAndDropTarget(
                        shouldStartDragAndDrop = { event ->
                            event.mimeTypes().any { it.startsWith("text/") || it == "application/octet-stream" } ||
                                event.toAndroidDragEvent().clipDescription?.let { it.mimeTypeCount > 0 } == true
                        },
                        target = dropTarget,
                    )
                    // 吃掉浮层内部的点击,不然会穿到后面那层变成"取消"。
                    .clickable(interactionSource = remember { MutableInteractionSource() }, indication = null) {}
                    // Ctrl 组合键和"没在组词时的 Esc"赶在输入法前面拿:实测中文输入法开着时,
                    // 第一下 Esc 被它拿去让输入框失焦,浮层纹丝不动。
                    .onInterceptKeyBeforeSoftKeyboard {
                        if (it.isCtrlPressed) return@onInterceptKeyBeforeSoftKeyboard onKey(it)
                        if (it.key == Key.Escape && !composing && !ime.holding) {
                            return@onInterceptKeyBeforeSoftKeyboard onKey(it)
                        }
                        ime.observe(it.nativeKeyEvent)
                        false
                    }
                    .onPreviewKeyEvent(onKey),
            ) {
                Box(Modifier.fillMaxWidth().height(56.dp).padding(horizontal = 8.dp)) {
                    ToolbarTextButton(stringResource(R.string.tab_cancel), p.accent, Modifier.align(Alignment.CenterStart)) { cancel() }
                    Text(
                        stringResource(if (draft.isNew) R.string.tab_new_host else R.string.tab_edit_host),
                        color = p.text,
                        fontSize = 17.sp,
                        fontWeight = FontWeight.SemiBold,
                        modifier = Modifier.align(Alignment.Center),
                    )
                    ToolbarTextButton(stringResource(R.string.tab_save),p.accent, Modifier.align(Alignment.CenterEnd), bold = true) { save() }
                }
                Box(Modifier.fillMaxWidth().height(0.5.dp).background(p.border))
                Column(
                    Modifier
                        .verticalScroll(rememberScrollState())
                        .padding(20.dp),
                    verticalArrangement = Arrangement.spacedBy(20.dp),
                ) {
                    draft.error?.let {
                        Text(it.text(), color = p.danger, fontSize = 14.sp, modifier = Modifier.padding(start = BoxPad))
                    }
                    FormGroup {
                        FormField(
                            stringResource(R.string.tab_field_name),
                            draft.name,
                            { draft.name = it },
                            placeholder = stringResource(R.string.tab_field_name_placeholder),
                            onComposing = { composing = it; ime.onTextChanged() },
                            focusRequester = first,
                        )
                        FormDivider()
                        FormField(
                            stringResource(R.string.tab_field_address),
                            draft.address,
                            { draft.address = it },
                            placeholder = "192.168.1.10",
                            onComposing = { composing = it; ime.onTextChanged() },
                            mono = true,
                            keyboard = KeyboardType.Uri,
                            asciiOnly = true,
                        )
                        FormDivider()
                        FormField(
                            stringResource(R.string.tab_field_port),
                            draft.port,
                            { draft.port = it.filter(Char::isDigit).take(5) },
                            placeholder = "22",
                            onComposing = { composing = it; ime.onTextChanged() },
                            mono = true,
                            keyboard = KeyboardType.Number,
                            asciiOnly = true,
                        )
                        FormDivider()
                        FormField(
                            stringResource(R.string.tab_field_username),
                            draft.username,
                            { draft.username = it },
                            placeholder = "root",
                            onComposing = { composing = it; ime.onTextChanged() },
                            mono = true,
                            keyboard = KeyboardType.Uri,
                            asciiOnly = true,
                        )
                    }
                    JumpField(draft)
                    CredentialFields(
                        draft = draft,
                        keyMessage = keyMessage,
                        onImport = importKey,
                        onDone = { save() },
                        onMessage = { keyMessage = it },
                        passwordFocus = passwordFocus,
                        passphraseFocus = passphraseFocus,
                        onComposing = { composing = it; ime.onTextChanged() },
                    )
                    if (initial != null) {
                        FormGroup {
                            FormAction(stringResource(R.string.tab_delete_this_host),danger = true) { onDelete(initial) }
                        }
                    }
                }
            }
        }
        LaunchedEffect(Unit) {
            if (draft.isNew || wantsPassword) {
                delay(120)
                runCatching { (if (wantsPassword) passwordFocus else first).requestFocus() }
            }
        }
    }

    if (confirmDiscard) {
        ConfirmDialog(
            title = stringResource(R.string.tab_discard_changes_title),
            message = null,
            confirm = stringResource(R.string.tab_discard),
            danger = true,
            onConfirm = {
                confirmDiscard = false
                onCancel()
            },
            onDismiss = { confirmDiscard = false },
        )
    }
}

/**
 * 确认框:居中、限宽。回车 = 确认,Esc = 取消(焦点一出来就在框上,插着键盘不用摸屏幕)。
 */
@Composable
fun ConfirmDialog(
    title: String,
    message: String?,
    confirm: String,
    danger: Boolean,
    onConfirm: () -> Unit,
    onDismiss: () -> Unit,
) {
    val p = LocalXssh.current
    val focus = remember { FocusRequester() }
    Dialog(onDismissRequest = onDismiss) {
        Column(
            Modifier
                .width(340.dp)
                .clip(RoundedCornerShape(18.dp))
                .background(if (p.dark) p.bgElev else p.bg)
                .border(0.5.dp, p.glassBorder, RoundedCornerShape(18.dp))
                .onPreviewKeyEvent { event ->
                    val e = event.nativeKeyEvent
                    if (e.action != AndroidKeyEvent.ACTION_DOWN) return@onPreviewKeyEvent false
                    when (e.keyCode) {
                        AndroidKeyEvent.KEYCODE_ENTER, AndroidKeyEvent.KEYCODE_NUMPAD_ENTER -> onConfirm()
                        AndroidKeyEvent.KEYCODE_ESCAPE -> onDismiss()
                        else -> return@onPreviewKeyEvent false
                    }
                    true
                }
                .focusRequester(focus)
                .focusable()
                .padding(20.dp),
        ) {
            Text(title, color = p.text, fontSize = 17.sp, fontWeight = FontWeight.SemiBold)
            if (message != null) {
                Spacer(Modifier.height(8.dp))
                Text(message, color = p.textDim, fontSize = 14.sp)
            }
            Spacer(Modifier.height(20.dp))
            Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                XsshButton(stringResource(R.string.tab_cancel), Modifier.weight(1f), kind = ButtonKind.Ghost) { onDismiss() }
                XsshButton(
                    confirm,
                    Modifier.weight(1f),
                    kind = if (danger) ButtonKind.Danger else ButtonKind.Primary,
                ) { onConfirm() }
            }
        }
        LaunchedEffect(Unit) { runCatching { focus.requestFocus() } }
    }
}
