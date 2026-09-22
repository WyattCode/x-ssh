package dev.xssh.android

import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.input.key.isMetaPressed

import androidx.compose.foundation.focusable
import androidx.compose.ui.focus.focusProperties
import androidx.compose.foundation.draganddrop.dragAndDropTarget
import androidx.compose.ui.draganddrop.DragAndDropEvent
import androidx.compose.ui.draganddrop.DragAndDropTarget
import androidx.compose.ui.draganddrop.mimeTypes
import androidx.compose.ui.draganddrop.toAndroidDragEvent
import androidx.compose.ui.input.pointer.PointerType
import androidx.compose.ui.input.pointer.isTertiaryPressed
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.ui.unit.DpOffset
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.ui.input.key.isAltPressed
import androidx.compose.ui.input.key.isCtrlPressed
import androidx.compose.ui.input.key.onInterceptKeyBeforeSoftKeyboard
import androidx.compose.ui.input.key.onPreviewKeyEvent
import androidx.compose.ui.input.pointer.PointerEventType
import androidx.compose.ui.input.pointer.PointerIcon
import androidx.compose.ui.input.pointer.isSecondaryPressed
import androidx.compose.ui.input.pointer.pointerHoverIcon
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.foundation.layout.wrapContentHeight
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.ui.draw.clipToBounds
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.isImeVisible
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.foundation.layout.offset
import androidx.compose.ui.unit.Dp
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.ui.platform.LocalLayoutDirection
import androidx.compose.runtime.SideEffect
import androidx.compose.foundation.layout.displayCutout
import androidx.compose.foundation.layout.systemBars
import androidx.compose.foundation.layout.ime
import androidx.compose.foundation.layout.RowScope
import androidx.compose.animation.core.tween
import androidx.compose.animation.Crossfade
import com.kyant.backdrop.backdrops.rememberLayerBackdrop
import com.kyant.backdrop.backdrops.layerBackdrop
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.foundation.border
import kotlin.math.roundToInt
import android.util.Log
import uniffi.xssh_ffi.StyledRun
import uniffi.xssh_ffi.ScreenRow
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.TextMeasurer
import androidx.compose.ui.graphics.drawscope.scale
import androidx.compose.ui.graphics.drawscope.DrawScope
import android.content.pm.PackageManager
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.awaitEachGesture
import androidx.compose.foundation.gestures.awaitFirstDown
import androidx.compose.foundation.gestures.rememberTransformableState
import androidx.compose.foundation.gestures.transformable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.WindowInsetsSides
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.only
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawing
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.input.pointer.positionChange
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalSoftwareKeyboardController
import androidx.compose.ui.text.TextRange
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.drawText
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.TextFieldValue
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.text.rememberTextMeasurer
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import uniffi.xssh_ffi.CursorState
import uniffi.xssh_ffi.FfiException
import uniffi.xssh_ffi.SelectKind

/**
 * 隐藏输入框里的哨兵字符。每次提交后要把输入框重置回哨兵,但重置是异步生效的:
 * 输入法在同一帧里连着提交时,后一个事件带的仍是重置前的内容,只按固定哨兵裁前缀
 * 会把上一个字符再发一遍(实测 "echo" 变 "echoo")。两个零宽字符轮换使用 ——
 * 事件里带的是哪个哨兵,就知道重置生效了没有。
 */
private val SENTINELS = arrayOf("\u200b", "\u200c")

/** 等用户裁决的主机密钥:[fingerprint] 是服务端这次给出的指纹。 */
private data class PendingKey(val fingerprint: String, val changed: Boolean)

@Composable
fun TerminalScreen(
    host: Host,
    onExit: () -> Unit,
    onTrustKey: (String) -> Unit = {},
    /** 放在平板右栏里时不为空:工具栏换成平板那套,不再画手机的轨道 / 顶栏按钮。 */
    tablet: TabletTerminalChrome? = null,
    /** 手机 / 折叠屏:打开这条连接的文件页(平板走 [tablet] 里的开关)。 */
    onFiles: (() -> Unit)? = null,
    /** 手机 / 折叠屏:打开这台主机的编辑页(连接失败时「填写密码」这类就地修复用;平板走 [tablet])。 */
    onEditHost: (() -> Unit)? = null,
) {
    val context = LocalContext.current
    // 已经连着就直接接管,不重连、也不再问一次主机密钥。
    var live by remember(host) { mutableStateOf(SessionRegistry[host.id]) }
    var error by remember(host) { mutableStateOf<String?>(null) }
    var pendingKey by remember(host) { mutableStateOf<PendingKey?>(null) }
    var attempt by remember(host) { mutableStateOf(0) }
    // 局域网权限只问一次:拒绝了也照常尝试连接,失败提示里会说明原因。
    var askedLocalNetwork by remember { mutableStateOf(PermissionAsked.localNetwork) }
    val askLocalNetwork = rememberLauncherForActivityResult(
        ActivityResultContracts.RequestPermission(),
    ) { attempt++ }
    // Android 13 起没有通知权限,前台服务照跑但常驻通知不显示 —— 那就成了
    // 「后台挂着 SSH 连接却没有任何可见提示」,该问一次。
    //
    // "问过了"必须记在**进程级**:原来用 `remember(host)`,一离开终端屏就清零,
    // 于是每连一次就被拦一次。只问一次,之后不给就算了(前台服务照样跑)。
    var askedNotify by remember { mutableStateOf(PermissionAsked.notifications) }
    val askNotify = rememberLauncherForActivityResult(
        ActivityResultContracts.RequestPermission(),
    ) { attempt++ }

    LaunchedEffect(host, attempt) {
        if (live != null) return@LaunchedEffect
        error = null
        pendingKey = null
        // 密码认证却没有存密码(旧版本只放内存、或者新建时没填):拿空密码去连,
        // 服务端只会回一句笼统的认证失败,用户看不出是"没填"还是"填错"。
        // 也不要先弹权限框再失败 —— 在这里就说清楚。
        if (host.auth == AuthKind.PASSWORD && host.password.isEmpty()) {
            error = "这台主机还没有保存密码。"
            return@LaunchedEffect
        }
        if (host.keyMissing) {
            error = "这台主机还没有导入私钥。"
            return@LaunchedEffect
        }
        val notifyPermission = SessionService.NOTIFICATION_PERMISSION
        if (!askedNotify && notifyPermission != null &&
            context.checkSelfPermission(notifyPermission) != PackageManager.PERMISSION_GRANTED
        ) {
            askedNotify = true
            PermissionAsked.notifications = true
            askNotify.launch(notifyPermission)
            return@LaunchedEffect
        }
        if (!askedLocalNetwork && LocalNetwork.needsPermission(context, host.address)) {
            askedLocalNetwork = true
            PermissionAsked.localNetwork = true
            askLocalNetwork.launch(LocalNetwork.PERMISSION)
            return@LaunchedEffect
        }
        // 连上之后会话就登记在 SessionRegistry 里了 —— 哪怕这个协程随后被取消
        // (用户退出了这一屏),它也不会丢:主机页会显示「运行中」,可以再点回来或断开。
        // 前台服务必须和登记**在同一个不可取消的步骤里**起来。
        // 放在 onSuccess 里的话,用户在连上的那一瞬间按了返回,协程被取消,
        // onSuccess 就不跑了 —— 会话已经登记在册,却没有任何东西托着进程,
        // 系统一冻结连接就悄悄没了,而主机页还写着「运行中」。
        val result = withContext(Dispatchers.IO) {
            runCatching {
                SessionRegistry.open(host, 80, 24).also { SessionService.ensureRunning(context) }
            }
        }
        result
            .onSuccess { live = it }
            .onFailure { failure ->
                // 主机密钥两种异常的 message 就是服务端指纹本身(见 FfiError 注释)。
                val fingerprint = failure.message.orEmpty().trim()
                when {
                    // 指纹为空就没得信任 —— 真让用户点下去只会存个空值、再弹一次同样的框。
                    fingerprint.isEmpty() &&
                        (failure is FfiException.HostKeyUnknown ||
                            failure is FfiException.HostKeyChanged) ->
                        error = "服务端密钥校验未通过,但没拿到指纹(${failure.javaClass.simpleName})。"

                    failure is FfiException.HostKeyUnknown ->
                        pendingKey = PendingKey(fingerprint, changed = false)

                    failure is FfiException.HostKeyChanged ->
                        pendingKey = PendingKey(fingerprint, changed = true)

                    failure is FfiException.KeyEncrypted ->
                        error = if (host.keyPassphrase.isEmpty()) "这把私钥有口令。" else "私钥口令不对。"

                    else -> error = LocalNetwork.hintFor(
                        context,
                        host.address,
                        failure.message?.ifBlank { null } ?: failure.toString(),
                    )
                }
            }
    }

    // 先绑成局部变量:onTrust 是稍后才执行的,直接在里面 pendingKey!! 等于赌它那时还不是 null。
    val pending = pendingKey
    val failure = error
    val session = live
    // 平板右栏:确认页 / 错误页 / 连接中上面也要有工具栏(侧边栏开关、主机名),不能是一整块没有出口的页面。
    val frame: @Composable (@Composable () -> Unit) -> Unit = { content ->
        if (tablet == null) {
            content()
        } else {
            Column(Modifier.fillMaxSize()) {
                TabletToolbar(tablet.sidebarVisible, tablet.onToggleSidebar, host.label, host.subtitle)
                Box(Modifier.weight(1f).fillMaxWidth()) { content() }
            }
        }
    }
    when {
        pending != null -> frame {
            HostKeyGate(
                host = host,
                fingerprint = pending.fingerprint,
                changed = pending.changed,
                tablet = tablet != null,
                // 信任后由上层把指纹写回主机并换一个新的 Host 实例,本屏随之重连。
                onTrust = { onTrustKey(pending.fingerprint) },
                onExit = onExit,
            )
        }

        failure != null -> frame {
            val noPassword = host.auth == AuthKind.PASSWORD && host.password.isEmpty()
            val keyProblem = host.keyMissing || failure.startsWith("这把私钥有口令") || failure.startsWith("私钥口令不对")
            ConnectGate(
                host = host,
                failure = failure,
                waited = 0,
                tablet = tablet != null,
                // 没存密码 / 没导入私钥时,重试只会得到同一句话,不给这个按钮。
                retry = if (noPassword || host.keyMissing) null else ({ attempt++ }),
                onExit = onExit,
                // 平板:能就地修的直接给按钮,打开编辑浮层 —— 不用先退回去再找编辑入口。
                // 能就地修的直接给按钮,打开编辑页(平板是浮层)—— 不用先退回去再找编辑入口。
                fix = (tablet?.onEdit ?: onEditHost)?.let { edit ->
                    when {
                        noPassword -> "填写密码" to edit
                        host.keyMissing -> "导入私钥" to edit
                        keyProblem -> "填写口令" to edit
                        else -> null
                    }
                },
            )
        }
        session == null -> frame {
            // 显示已经等了多久:不再是一个看不出进展的"…"。
            // Rust 那边每一步都有上限(连接+认证 15s、开 shell 10s),到点一定会变成错误页。
            var waited by remember(host, attempt) { mutableStateOf(0) }
            LaunchedEffect(host, attempt) {
                while (true) {
                    delay(1000)
                    waited++
                }
            }
            ConnectGate(
                host = host,
                failure = null,
                waited = waited,
                tablet = tablet != null,
                retry = null,
                fix = null,
                onExit = onExit,
            )
        }
        else -> TerminalView(
            session,
            host,
            onExit,
            tablet,
            onFiles,
            // 对端断了:丢掉这条死会话、按原主机重连(会话表里它已经自己摘掉了)。
            onReconnect = {
                live = null
                attempt++
            },
        )
    }
}

@Composable
private fun TerminalView(
    live: TerminalSession,
    host: Host,
    onExit: () -> Unit,
    tablet: TabletTerminalChrome?,
    onFiles: (() -> Unit)?,
    onReconnect: () -> Unit,
) {
    val p = LocalXssh.current
    val density = LocalDensity.current
    val adaptive = LocalAdaptive.current
    val context = LocalContext.current
    val prefs = remember(context) { UiPrefs(context) }
    val scope = rememberCoroutineScope()
    val keyboard = LocalSoftwareKeyboardController.current
    val focusRequester = remember { FocusRequester() }
    val focusManager = LocalFocusManager.current
    // 实体键盘(平板键盘套、蓝牙键盘)插着时,焦点放在一个**不是输入框**的节点上(keySink):
    // 按键不经过输入法,由 onPreviewKeyEvent 按 xterm 编码直接发出去(见 KeyEncoder)。
    // 要打中文时点 ⌨ 切回输入框,输入法照常工作。
    val hardKeyboard = LocalConfiguration.current.hasHardKeyboard()
    val keySink = remember { FocusRequester() }
    var sinkFocused by remember { mutableStateOf(false) }
    var imeFocused by remember { mutableStateOf(false) }
    // 插着实体键盘时用户选的是哪种输入:false = 英文直通(按键直接编码发出去),true = 输入法(能打中文)。
    //
    // 原来只能点工具栏的 ⌨ 切到输入法 —— 直通时焦点不在输入框上,输入法根本没挂上,键盘上的
    // 中英切换(Shift / Ctrl+Space)它收不到,用户"按什么都切不出中文"。现在键盘上就能切(见 onKey),
    // 而且记住选择:关个菜单、点一下终端,焦点回来时还是原来那种输入,不会悄悄退回英文。
    var imeMode by remember { mutableStateOf(false) }
    // 切换时在终端右上角亮一下「中」「英」,一秒多就收。
    var modePill by remember { mutableStateOf<String?>(null) }
    var modePillTick by remember { mutableIntStateOf(0) }
    LaunchedEffect(modePillTick) {
        if (modePillTick == 0) return@LaunchedEffect
        delay(1200)
        modePill = null
    }
    // 单独按一下 Shift(按下到松开之间没按别的键)= 切到中文。记按下的时刻。
    var shiftTapAt by remember { mutableLongStateOf(0L) }
    // 按下时接管了的键,松开事件也要吞掉,别让系统拿半个按键去做别的(比如 Esc 被当成返回)。
    val swallowed = remember { mutableSetOf<Int>() }
    /** 插着实体键盘时,焦点该回到哪:按用户选的输入方式。已经在那儿就不动。 */
    fun focusInput() {
        if (!hardKeyboard) return
        runCatching {
            if (imeMode) {
                if (!imeFocused) focusRequester.requestFocus()
            } else if (!sinkFocused) {
                keySink.requestFocus()
            }
        }
    }
    /** 中文(输入法)↔ 英文(直通)。只在插着实体键盘时有意义;没键盘时本来就是输入法。 */
    fun switchInput() {
        if (!hardKeyboard) return
        imeMode = !imeMode
        focusInput()
        // 「输入法」而不是「中」:输入法自己可能正处在英文状态(Shift 切过),说"中"不一定对。
        modePill = if (imeMode) "输入法" else "英文"
        modePillTick++
    }
    // 插着实体键盘就直接能打字:焦点不在输入框上(直通)时不会弹软键盘。
    LaunchedEffect(hardKeyboard) {
        if (hardKeyboard) focusInput()
    }
    // 平板:外面(关浮层、退出搜索、点侧边栏的会话)要求把焦点还给终端。
    LaunchedEffect(tablet?.focusRequest) {
        if (tablet != null && tablet.focusRequest > 0) focusInput()
    }
    // 进来**不抢焦点**,也就不弹键盘。
    //
    // 原来一连上就 requestFocus(),焦点落到输入框上系统立刻弹键盘(实测连接后 100ms)。
    // 外屏只有 623dp 高,一进来就被键盘吃掉一半,还没看清输出就要先收键盘。
    // 要打字时点终端或 ⌨(再点一下 ⌨ 收起)。

    val backdrop = rememberLayerBackdrop()

    // 终端配色跟着界面的深浅色走:16 色交给 Rust 解析,前景/背景用来回答程序的颜色查询
    // (Codex 会据此选深色还是浅色主题)。
    LaunchedEffect(p.dark) {
        withContext(Dispatchers.IO) { live.applyTheme(p) }
    }

    // 画面由会话推过来 —— 轮询循环长在会话里,这一屏只是观众,走了它照跑。
    val frame by live.frame.collectAsState()
    val rows = frame.rows
    val cursor = frame.cursor
    val dead = !frame.alive
    var fontSize by remember { mutableStateOf(prefs.terminalFontSize) }
    var ctrl by remember { mutableStateOf(false) }
    // 快捷键面板默认收起,终端多出两行;点轨道上的 ⌘ 才出来。
    var showKeys by remember { mutableStateOf(false) }
    var alt by remember { mutableStateOf(false) }
    var grid by remember { mutableStateOf(0 to 0) }

    // 捏合调完字号要记住;等手停下来再写盘,别把每一帧都落到 SharedPreferences。
    LaunchedEffect(fontSize) {
        delay(400)
        prefs.terminalFontSize = fontSize
    }

    val transformState = rememberTransformableState { _: Offset, zoomChange: Float, _: Offset, _: Float ->
        fontSize = (fontSize * zoomChange).coerceIn(UiPrefs.FONT_MIN, UiPrefs.FONT_MAX)
    }

    val paste: () -> Unit = {
        val clip = context.getSystemService(android.content.ClipboardManager::class.java)?.primaryClip
        val text = clip?.takeIf { it.itemCount > 0 }?.getItemAt(0)?.coerceToText(context)?.toString().orEmpty()
        if (text.isNotEmpty()) live.paste(text)
    }

    // 选中的文字(鼠标拖选 / 双击选词 / 三击选行 / 手指长按)。选区在核心里,跟着内容滚动,
    // 能一直选进回滚历史;这里只拿它落在视口里的那一段来画。一敲键盘、点一下终端就清掉。
    val selection = frame.selection?.toTermSelection()
    val copySelection: () -> Unit = { live.copySelection { copyText(context, it) } }
    val clearSelection: () -> Unit = { if (frame.selection != null) live.selectClear() }

    // 实体键盘。输入框模式下普通字符交给输入法(中文要组词),其余键(回车、方向、Esc、
    // Ctrl 组合……)一律在这里编码 —— 输入法不组词时会把它们放行,正好落到这里。
    val onKey: (androidx.compose.ui.input.key.KeyEvent) -> Boolean = handler@{ event ->
        val e = event.nativeKeyEvent
        if (!sinkFocused && !imeFocused) return@handler false
        // 输入法 ↔ 英文直通:**Ctrl+Shift+Space**,两种模式下都认(输入法模式下 Ctrl 组合在输入法之前就被拿到)。
        // 实测 Win+Space 和键盘的「中/英」键被系统自己拿去切输入法了,应用收不到;有的系统会放行,所以也认。
        // **不用 Ctrl+Space**:终端里它是 NUL,Emacs 拿它设标记,抢了就用不了。
        val space = e.keyCode == android.view.KeyEvent.KEYCODE_SPACE
        val toggle = e.keyCode == android.view.KeyEvent.KEYCODE_LANGUAGE_SWITCH ||
            (space && e.isMetaPressed) ||
            (space && e.isCtrlPressed && e.isShiftPressed && !e.isAltPressed)
        if (hardKeyboard && toggle) {
            if (e.action == android.view.KeyEvent.ACTION_DOWN && e.repeatCount == 0) switchInput()
            return@handler true
        }
        // 直通时单独按一下 Shift = 切到中文(和输入法里"按 Shift 切中英"同一个手势)。切过去之后 Shift 就归输入法自己管。
        if (hardKeyboard && !imeFocused) {
            val shift = e.keyCode == android.view.KeyEvent.KEYCODE_SHIFT_LEFT || e.keyCode == android.view.KeyEvent.KEYCODE_SHIFT_RIGHT
            when {
                shift && e.action == android.view.KeyEvent.ACTION_DOWN && e.repeatCount == 0 -> shiftTapAt = e.eventTime
                shift && e.action == android.view.KeyEvent.ACTION_UP -> {
                    val clean = shiftTapAt > 0 && e.eventTime - shiftTapAt < 500
                    shiftTapAt = 0
                    if (clean) {
                        switchInput()
                        return@handler true
                    }
                }
                e.action == android.view.KeyEvent.ACTION_DOWN -> shiftTapAt = 0
            }
        }
        // 平板的应用快捷键(Ctrl+Shift+N / W / S…、Ctrl+Tab)放行给外层,不能编码成控制字符发给远端。
        if (tablet != null && isShellShortcut(e)) return@handler false
        if (e.action != android.view.KeyEvent.ACTION_DOWN) return@handler swallowed.remove(e.keyCode)
        // 终端自己的快捷键(和桌面终端的习惯一致):Ctrl+Shift+V 粘贴,Ctrl+Shift+= / - 调字号。
        if (e.isCtrlPressed && e.isShiftPressed) {
            val handled = when (e.keyCode) {
                android.view.KeyEvent.KEYCODE_V -> { paste(); true }
                // 没选东西也要吞掉:否则 Ctrl+Shift+C 会被编码成 ^C 发出去,把正在跑的命令打断。
                android.view.KeyEvent.KEYCODE_C -> { copySelection(); true }
                android.view.KeyEvent.KEYCODE_EQUALS, android.view.KeyEvent.KEYCODE_PLUS,
                android.view.KeyEvent.KEYCODE_NUMPAD_ADD -> {
                    fontSize = (fontSize + 1f).coerceIn(UiPrefs.FONT_MIN, UiPrefs.FONT_MAX); true
                }
                android.view.KeyEvent.KEYCODE_MINUS, android.view.KeyEvent.KEYCODE_NUMPAD_SUBTRACT -> {
                    fontSize = (fontSize - 1f).coerceIn(UiPrefs.FONT_MIN, UiPrefs.FONT_MAX); true
                }
                else -> false
            }
            if (handled) {
                swallowed += e.keyCode
                return@handler true
            }
        }
        if (imeFocused && e.isPrintingKey && !e.isCtrlPressed && !e.isAltPressed && !ctrl && !alt) {
            return@handler false
        }
        val text = KeyEncoder.encode(e, frame.modes, ctrl, alt) ?: return@handler false
        ctrl = false
        alt = false
        clearSelection()
        swallowed += e.keyCode
        live.sendRaw(text.toByteArray())
        true
    }

    // 右键 / 工具栏「更多」里的终端操作(平板)。手机上右键仍是直接粘贴。
    fun terminalMenu(): List<MenuAction> = buildList {
        if (frame.selection != null) add(MenuAction("复制", shortcut = "Ctrl+Shift+C") { copySelection() })
        add(MenuAction("粘贴", shortcut = "Ctrl+Shift+V") { paste() })
        add(MenuAction("清屏", shortcut = "Ctrl+L") { live.sendRaw(byteArrayOf(12)) })
        add(MenuAction("放大字号", shortcut = "Ctrl+Shift+=") {
            fontSize = (fontSize + 1f).coerceIn(UiPrefs.FONT_MIN, UiPrefs.FONT_MAX)
        })
        add(MenuAction("缩小字号", shortcut = "Ctrl+Shift+-") {
            fontSize = (fontSize - 1f).coerceIn(UiPrefs.FONT_MIN, UiPrefs.FONT_MAX)
        })
        tablet?.let { add(MenuAction("编辑主机…", shortcut = "Ctrl+Shift+E") { it.onEdit() }) }
    }
    var canvasMenuAt by remember { mutableStateOf<DpOffset?>(null) }
    var canvasHeight by remember { mutableIntStateOf(0) }

    var dropHover by remember { mutableStateOf(false) }
    val dropTarget = remember(live) {
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
                val clip = event.toAndroidDragEvent().clipData ?: return false
                val text = (0 until clip.itemCount)
                    .joinToString("\n") { clip.getItemAt(it).coerceToText(context).toString() }
                if (text.isEmpty()) return false
                live.paste(text)
                return true
            }
        }
    }

    // ⌨ 开关:没弹出就弹出,弹着就收起。插着实体键盘时是"直通 ↔ 输入法"两种模式之间切换。
    val toggleIme: (Boolean) -> Unit = { imeOn ->
        Log.i(TAG, "keyboard: toggle, on=$imeOn hard=$hardKeyboard")
        when {
            // 插着实体键盘:这颗按钮就是中文 ↔ 英文(和 Ctrl+Space 一样)。
            hardKeyboard -> switchInput()
            imeOn -> {
                keyboard?.hide()
                focusManager.clearFocus()
            }
            else -> {
                focusRequester.requestFocus()
                keyboard?.show()
            }
        }
    }

    // 菜单(右键、长按、「更多」)关掉后焦点回到终端,不然实体键盘接着敲什么都没反应。
    val restoreFocus: () -> Unit = { focusInput() }

    val keyModifier = Modifier
        // 用输入法打中文时(点过 ⌨),输入法排在页面前面拿按键,Ctrl+C 会被它当成复制吃掉。
        // Ctrl / Alt 组合键赶在它前面接管 —— 组词从来不用这两个键;其余键仍先给输入法。
        .onInterceptKeyBeforeSoftKeyboard {
            val languageKey = it.nativeKeyEvent.keyCode == android.view.KeyEvent.KEYCODE_LANGUAGE_SWITCH ||
                (it.isMetaPressed && it.nativeKeyEvent.keyCode == android.view.KeyEvent.KEYCODE_SPACE)
            if (imeFocused && (it.isCtrlPressed || it.isAltPressed || languageKey)) onKey(it) else false
        }
        .onPreviewKeyEvent(onKey)

    val canvas: @Composable (Modifier) -> Unit = { modifier ->
        Box(
            modifier
                .onSizeChanged { canvasHeight = it.height }
                // 从别的应用(分屏另一边、小窗)拖一段文字进来 = 粘贴(小米:支持跨应用拖放)。
                // 拖着经过时终端描一圈强调色,告诉用户"可以放在这里"。
                .dragAndDropTarget(
                    shouldStartDragAndDrop = { event -> event.mimeTypes().any { it.startsWith("text/") } },
                    target = dropTarget,
                )
                .then(if (dropHover) Modifier.border(2.dp, p.accent, RoundedCornerShape(RadiusBox)) else Modifier)
                .transformable(transformState)
                // 画布自己不拿焦点:用鼠标点它时 clickable 会把焦点抢过来(键盘操作模式下点击 = 聚焦),
                // 实体键盘的按键节点就丢了焦点 —— 实测鼠标点过终端之后,敲什么都没反应。
                .focusProperties { canFocus = false }
                .clickable(
                    interactionSource = remember { MutableInteractionSource() },
                    indication = null,
                ) {
                    clearSelection()
                    Log.i(TAG, "keyboard: canvas tap, hard=$hardKeyboard ime=$imeFocused")
                    when {
                        // 插着实体键盘:点终端 = 要在这里打字,焦点回到用户选的那种输入上,不弹软键盘。
                        hardKeyboard -> focusInput()
                        else -> {
                            focusRequester.requestFocus()
                            keyboard?.show()
                        }
                    }
                },
        ) {
            TerminalCanvas(
                rows = rows,
                cursor = cursor,
                fontSize = fontSize,
                onGridSize = { cols, rows, cellW, cellH ->
                    if (cols != grid.first || rows != grid.second) {
                        grid = cols to rows
                        live.resizeGrid(cols, rows, cellW, cellH)
                    }
                },
                // 拖动、滚轮、触控板双指滑动都走这里:普通 shell 翻本地历史,
                // 全屏程序(less、vim、htop)收到方向键或滚轮事件。
                // 翻历史不清选区:选区在核心里跟着内容走,可以边翻边选、翻回来还在。
                onScroll = { deltaLines, col, row ->
                    live.wheel(deltaLines, col, row)
                },
                // 鼠标右键:平板出上下文菜单(小米 / HIG:右键呼出菜单);
                // 手机沿用 PuTTY 的习惯:有选区就复制,没有就粘贴。
                onSecondaryClick = { at ->
                    when {
                        // 菜单挂在这个 Box 上;画布在里面左右各缩了 Gutter。
                        tablet != null ->
                            canvasMenuAt = with(density) { DpOffset(at.x.toDp() + Gutter, (at.y - canvasHeight).toDp()) }
                        frame.selection != null -> copySelection()
                        else -> paste()
                    }
                },
                selection = selection,
                onSelectStart = { at, kind -> live.selectStart(at.row, at.col, at.rightHalf, kind) },
                onMouseReleased = { focusInput() },
                onSelectUpdate = { at -> live.selectUpdate(at.row, at.col, at.rightHalf) },
                onSelectClear = clearSelection,
                // 手指选完松手:在松手的地方出「复制 / 粘贴」(手机、平板都一样)。
                onSelectionDone = { at ->
                    canvasMenuAt = with(density) { DpOffset(at.x.toDp() + Gutter, (at.y - canvasHeight).toDp()) }
                },
                // 留一点边距:内屏圆角半径 52dp,贴边的字会被切掉一角。
                modifier = Modifier.fillMaxSize().padding(horizontal = Gutter),
            )
            CompositionLocalProvider(LocalRestoreFocus provides restoreFocus) {
                ContextMenu(at = canvasMenuAt, onDismiss = { canvasMenuAt = null }, actions = ::terminalMenu)
            }
            // 中英切换的提示:右上角一颗小胶囊,和系统输入法切换时的提示同一个意思。
            AnimatedVisibility(
                visible = modePill != null,
                enter = fadeIn(tween(120)),
                exit = fadeOut(tween(220)),
                modifier = Modifier.align(Alignment.TopEnd).padding(top = 10.dp, end = Gutter + 4.dp),
            ) {
                Text(
                    modePill ?: "",
                    color = p.text,
                    fontSize = 15.sp,
                    fontWeight = FontWeight.SemiBold,
                    textAlign = TextAlign.Center,
                    modifier = Modifier
                        .clip(RoundedCornerShape(10.dp))
                        .background(if (p.dark) p.bgElev else Color.White)
                        .border(0.5.dp, p.borderStrong, RoundedCornerShape(10.dp))
                        .padding(horizontal = 12.dp, vertical = 6.dp),
                )
            }
        }
    }
    val hiddenInput: @Composable () -> Unit = {
        // 实体键盘的落点:能拿焦点、但不是输入框,系统不会把按键先交给输入法。
        Box(
            Modifier
                .size(1.dp)
                .focusRequester(keySink)
                .onFocusChanged { sinkFocused = it.isFocused }
                .focusable(),
        )
        HiddenImeField(
            focusRequester = focusRequester,
            onFocus = { imeFocused = it },
            takeModifiers = {
                val used = ctrl to alt
                ctrl = false
                alt = false
                used
            },
            onText = { text, useCtrl, useAlt ->
                clearSelection()
                live.sendText(text, useCtrl, useAlt)
            },
            onBackspace = { live.sendRaw(byteArrayOf(0x7F)) },
        )
    }
    val keys: @Composable () -> Unit = {
        FloatingKeys(columns = if (adaptive.roomyKeys) 9 else 5) { keyWidth ->
            TerminalKeys(
                keyWidth = keyWidth,
                // 宽屏折成两行全部露出;窄屏保持一行横滚,不跟终端抢竖向空间。
                wrap = adaptive.roomyKeys,
                ctrl = ctrl,
                alt = alt,
                onCtrl = { ctrl = !ctrl },
                onAlt = { alt = !alt },
                onFont = { step ->
                    fontSize = (fontSize + step).coerceIn(UiPrefs.FONT_MIN, UiPrefs.FONT_MAX)
                },
                send = { bytes -> live.sendRaw(bytes) },
            )
        }
    }

    // 和主机页、编辑页同一条右侧竖轨道、同一个位置(见 EdgeRail),悬浮在终端上面。
    val actions: @Composable () -> Unit = {
        // 外观:每一页都有,在最上面 —— 看着满屏输出想换个深浅色,不用先退回主机页。
        // 键盘弹起来时先收走:外屏只有 623dp 高,键盘占掉一半,轨道再多一颗就顶到状态栏上去了。
        // 正在打字的人也不会同时想换深浅色;收起键盘它自己长回来。
        @OptIn(ExperimentalLayoutApi::class)
        val imeUp = WindowInsets.isImeVisible
        GlassReveal(!imeUp) { GlassGroup { ThemeGlassItem() } }
        // 文件(SFTP):单独一颗,在输入那枚胶囊上面 —— 它是"换一页",不是输入。
        // 断开之后它会消失,所以长出来 / 收回去都带动效(见 GlassReveal)。
        GlassReveal(onFiles != null && !dead) { GlassButton(XIcons.Folder, "文件") { onFiles?.invoke() } }
        // 输入相关的操作装进同一枚胶囊:键盘常驻在下(和主机页的搜索同一个位置),
        // 快捷键面板的开关在它上面(开着时图标变蓝);回到底部只在翻历史时出现,加在最上面 ——
        // 胶囊往上长,键盘不动。
        GlassGroup {
            // 翻历史时才有:胶囊往上长出这一颗,不是凭空"砰"地出现。
            GlassReveal(frame.scrollOffset > 0) {
                GlassItem(XIcons.ArrowDown, "回到底部") {
                    live.scrollToBottom()
                }
            }
            GlassItem(
                XIcons.Command,
                if (showKeys) "收起快捷键" else "显示快捷键",
                tint = if (showKeys) p.accent else null,
            ) { showKeys = !showKeys }
            // 键盘按钮是开关:没弹出就弹出,弹着就收起(和 ⌘ 一样,开着时图标变蓝)。
            // 在这里读键盘状态:只有这颗按钮随它重组,不牵动整屏终端。
            @OptIn(ExperimentalLayoutApi::class)
            val imeVisible = WindowInsets.isImeVisible
            // 插着实体键盘时输入法多半只露一条候选栏(不算"键盘弹出"),
            // 那时"焦点在输入框上"本身就是开着的状态。
            val imeOn = imeFocused && (imeVisible || hardKeyboard)
            GlassItem(
                XIcons.Keyboard,
                if (imeOn) "收起键盘" else "调出键盘",
                tint = if (imeOn) p.accent else null,
            ) { toggleIme(imeOn) }
        }
        // 断开是危险操作,单独一颗、红色图标,放在最下面(和 ＋ / ✓ 同一个位置)。
        GlassButton(XIcons.Close, "断开连接", tint = p.danger) {
                SessionRegistry.close(host.id)
                onExit()
        }
    }

    // 折叠屏:⌨ ✕ 在右侧轨道;直板机:放进顶部的主机名这一行右边,按键面板铺满整宽(见 Chrome)。
    val topBar = LocalChrome.current == Chrome.TopBar
    val header: @Composable () -> Unit = {
        if (tablet != null) {
            // 平板:工具栏在终端上面 —— 侧边栏开关、主机名、输入相关的开关、「更多」和「断开」。
            TabletToolbar(
                sidebarVisible = tablet.sidebarVisible,
                onToggleSidebar = tablet.onToggleSidebar,
                title = host.label,
                subtitle = if (dead) "已断开" else host.subtitle,
                dot = if (dead) p.danger else p.ok,
            ) {
                GlassRevealRow(!dead) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        PaneSwitch(files = false) { if (it) tablet.onShowFiles() }
                        Spacer(Modifier.width(8.dp))
                    }
                }
                GlassRevealRow(frame.scrollOffset > 0) {
                    ToolbarIcon(XIcons.ArrowDown, "回到底部") { live.scrollToBottom() }
                }
                ToolbarIcon(
                    XIcons.Command,
                    if (showKeys) "收起快捷键栏" else "显示快捷键栏",
                    active = showKeys,
                ) { showKeys = !showKeys }
                @OptIn(ExperimentalLayoutApi::class)
                val imeVisible = WindowInsets.isImeVisible
                val imeOn = imeFocused && (imeVisible || hardKeyboard)
                ToolbarIcon(
                    XIcons.Keyboard,
                    when {
                        hardKeyboard && imeOn -> "输入法  Ctrl+Shift+Space 切回英文"
                        hardKeyboard -> "英文直通  Shift 切到输入法"
                        imeOn -> "收起键盘"
                        else -> "调出键盘"
                    },
                    active = imeOn,
                ) { toggleIme(imeOn) }
                var moreOpen by remember { mutableStateOf(false) }
                Box {
                    ToolbarIcon(XIcons.More, "更多") { moreOpen = true }
                    CompositionLocalProvider(LocalRestoreFocus provides restoreFocus) {
                        ContextMenu(
                            at = if (moreOpen) DpOffset.Zero else null,
                            onDismiss = { moreOpen = false },
                            actions = ::terminalMenu,
                        )
                    }
                }
                Spacer(Modifier.width(4.dp))
                if (dead) {
                    // 对端断了(服务器重启、网络掉了):最常见的下一步是重连,放在最显眼的位置。
                    ToolbarTextButton("关闭", p.textDim) { onExit() }
                    ToolbarTextButton("重新连接", p.accent, bold = true) { onReconnect() }
                } else {
                    ToolbarTextButton("断开", p.danger) {
                        SessionRegistry.close(host.id)
                        onExit()
                    }
                }
            }
        } else if (topBar) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Box(Modifier.weight(1f)) { HostLine(host = host, dead = dead) }
                CompositionLocalProvider(LocalGlassSize provides 40.dp, LocalGlassRow provides true) {
                    Row(
                        Modifier.padding(end = Gutter),
                        horizontalArrangement = Arrangement.spacedBy(10.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) { actions() }
                }
            }
        } else {
            HostLine(host = host, dead = dead)
        }
    }

    val tabletop = adaptive.tabletop
    if (tabletop != null) {
        // 桌面模式:机器半开着立在桌上。上半屏只放要看的(终端),下半屏只放要碰的
        // (按键与输入法),手不会伸到上半屏去挡住输出。
        Box(Modifier.fillMaxSize().background(p.bg).then(keyModifier)) {
        Column(Modifier.fillMaxSize()) {
            Column(
                Modifier
                    .height(tabletop.startDp)
                    .fillMaxWidth()
                    .background(p.termBg)
                    .windowInsetsPadding(
                        stableSafeDrawing().only(
                            WindowInsetsSides.Top + WindowInsetsSides.Horizontal,
                        ),
                    ),
            ) {
                header()
                canvas(Modifier.weight(1f).fillMaxWidth())
            }
            Box(Modifier.height(maxOf(tabletop.sizeDp, 1.dp)).fillMaxWidth().background(p.border))
            Column(
                Modifier
                    .weight(1f)
                    .fillMaxWidth()
                    .background(p.bg)
                    .windowInsetsPadding(
                        stableSafeDrawing().only(
                            WindowInsetsSides.Bottom + WindowInsetsSides.Horizontal,
                        ),
                    )
                    .imePadding(),
            ) {
                hiddenInput()
                // 桌面模式也听 ⌘ 的:收起时下半屏只留给输入法。
                AnimatedVisibility(showKeys, enter = Motion.keyboardIn, exit = Motion.keyboardOut) { keys() }
            }
        }
        CompositionLocalProvider(LocalBackdrop provides backdrop) {
            EdgeRail(Modifier.align(Alignment.BottomEnd), content = actions)
        }
        }
        return
    }

    // 终端铺满整宽,右侧轨道悬浮在上面(玻璃按钮,底下的字透出来)—— 用户要的是最宽的终端。
    // 只有快捷键面板给轨道让位(它和轨道同一条底边、并排),见 FloatingKeys。
    Box(Modifier.fillMaxSize().background(p.termBg).then(keyModifier)) {
        Column(
            Modifier
                .fillMaxSize()
                // 玻璃按钮背后的内容(先垫终端底色,录下来的画面才不是透明的)。
                .layerBackdrop(backdrop)
                .background(p.termBg)
                .windowInsetsPadding(stableSafeDrawing())
                .imePadding(),
        ) {
            header()
            // 平板的工具栏下面有一道分隔线,第一行字贴着它太挤。
            if (tablet != null) Spacer(Modifier.height(8.dp))
            canvas(Modifier.weight(1f).fillMaxWidth())
            hiddenInput()
            AnimatedVisibility(showKeys, enter = Motion.keyboardIn, exit = Motion.keyboardOut) { keys() }
        }
        if (!topBar && tablet == null) {
            CompositionLocalProvider(LocalBackdrop provides backdrop) {
                EdgeRail(Modifier.align(Alignment.BottomEnd), content = actions)
            }
        }
    }
}

/** 鼠标滚轮一格翻几行。 */
private const val WheelLines = 3f

/** 手指按住多久进入选择(和系统长按选字差不多)。 */
private const val LongPressMillis = 450L

/** 按键的宽度上限:和 48dp 的高度配成接近实体键帽的比例(约 1.2 : 1)。 */
private val KeyMaxWidth = 58.dp
private val KeyGap = 6.dp

/**
 * 浮起的按键面板:按内容大小、在可用宽度里**居中**,不把按键拉满整行。
 *
 * 原来每颗键 weight(1f) 平分整行:内屏一颗键被拉到 77dp 宽、只有 48dp 高,扁长变形。
 * 现在每颗键最宽 [KeyMaxWidth],放得下就按这个宽度排、面板收紧居中;
 * 屏幕窄(外屏)放不下时才等比缩窄。面板离底 16dp,和 ✕ 按钮底边齐平。
 */
@Composable
private fun FloatingKeys(columns: Int, content: @Composable (keyWidth: Dp) -> Unit) {
    val p = LocalXssh.current
    val rail = LocalChrome.current == Chrome.Rail
    BoxWithConstraints(
        Modifier
            .fillMaxWidth()
            // 面板和轨道同一条底边、并排放,所以右边让出轨道的宽度;终端本身不让。
            .padding(start = Gutter, end = Gutter + if (rail) RailWidth else 0.dp, bottom = Gutter),
        contentAlignment = Alignment.Center,
    ) {
        val keyWidth = ((maxWidth - KeyGap * 2 - KeyGap * (columns - 1)) / columns).coerceAtMost(KeyMaxWidth)
        // 这一栏右边让出了轨道的宽度,只在栏里居中的话,面板看上去偏左。
        // 两边空得够时往右挪半条轨道,落在整块屏幕的正中;空间不够(外屏)就留在栏里。
        val panel = keyWidth * columns + KeyGap * (columns + 1)
        val shift = if (rail) minOf(RailWidth / 2, (maxWidth - panel) / 2).coerceAtLeast(0.dp) else 0.dp
        Box(
            Modifier
                .offset(x = shift)
                // 圆角和里面的按键同一个量级(按键 12dp,面板 16dp)。
                .clip(RoundedCornerShape(RadiusBox + 4.dp))
                // 照系统键盘:浅色是浅灰底上的白键,深色是深灰底上的灰键。
                .background(if (p.dark) Color(0xFF1C1C1E) else Color(0xFFD5D7DD))
                .border(0.8.dp, p.glassBorder, RoundedCornerShape(RadiusBox + 4.dp)),
        ) {
            content(keyWidth)
        }
    }
}

/**
 * 会话信息:一行内容,不是一条栏。
 *
 * 参考折叠屏的做法 —— 界面上不留固定高度的横条,信息跟着内容走,操作全在右边缘轨道里。
 * 原来这里是一条 56dp 的 bgElev 横条,还塞着键盘和断开两个按钮,把终端从顶上压掉一块。
 */
@Composable
private fun HostLine(host: Host, dead: Boolean) {
    val p = LocalXssh.current
    Row(
        Modifier.fillMaxWidth().padding(start = Gutter, end = Gutter, top = 10.dp, bottom = 8.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        // 圆点占住 16dp 那条线(与终端文字、第一个按键同缘),名字落在 32dp 文字线上。
        StatusDot(if (dead) p.danger else p.ok)
        Spacer(Modifier.width(7.dp))
        // 地址要么整条放得下就显示,要么干脆不显示 —— 直板机顶栏右边排了四颗按钮,
        // 原来地址被截成「user@12…」,半截地址比没有更难看,也看不出是哪台机器。
        // 「已断开」是状态,必须显示,放不下时顶掉的是名字(名字自己省略)。
        val detail = if (dead) "已断开" else host.subtitle
        androidx.compose.ui.layout.Layout(
            content = {
                Text(host.label, color = p.text, fontSize = 14.sp, fontWeight = FontWeight.Medium, maxLines = 1, overflow = TextOverflow.Ellipsis)
                Text(
                    text = detail,
                    color = if (dead) p.danger else p.textFaint,
                    fontFamily = XsshFonts.monoUi,
                    fontSize = 11.sp,
                    maxLines = 1,
                    softWrap = false,
                )
            },
        ) { measurables, constraints ->
            val gap = 10.dp.roundToPx()
            val loose = constraints.copy(minWidth = 0)
            val detailPlaceable = measurables[1].measure(androidx.compose.ui.unit.Constraints())
            val labelFull = measurables[0].maxIntrinsicWidth(constraints.maxHeight)
            val showDetail = dead || labelFull + gap + detailPlaceable.width <= constraints.maxWidth
            val labelMax = if (showDetail) (constraints.maxWidth - gap - detailPlaceable.width).coerceAtLeast(0) else constraints.maxWidth
            val labelPlaceable = measurables[0].measure(loose.copy(maxWidth = labelMax))
            val height = maxOf(labelPlaceable.height, if (showDetail) detailPlaceable.height else 0)
            layout(constraints.maxWidth, height) {
                labelPlaceable.place(0, (height - labelPlaceable.height) / 2)
                if (showDetail) {
                    detailPlaceable.place(labelPlaceable.width + gap, (height - detailPlaceable.height) / 2)
                }
            }
        }
    }
}

/** 终端按键条。方向键与退格可连发,按住就一直走 —— 改一条长命令时这是刚需。 */
@Composable
private fun TerminalKeys(
    keyWidth: Dp,
    wrap: Boolean,
    ctrl: Boolean,
    alt: Boolean,
    onCtrl: () -> Unit,
    onAlt: () -> Unit,
    onFont: (Float) -> Unit,
    send: (ByteArray) -> Unit,
) {
    val keys = KeyActions(ctrl, alt, onCtrl, onAlt, send)
    if (wrap) WideKeys(keys, keyWidth) else CompactKeys(keys, keyWidth)
}

/** 所有按键的动作集中在一处,两种排布共用。 */
private class KeyActions(
    val ctrl: Boolean,
    val alt: Boolean,
    val onCtrl: () -> Unit,
    val onAlt: () -> Unit,
    val send: (ByteArray) -> Unit,
) {
    fun bytes(vararg b: Int) = send(ByteArray(b.size) { b[it].toByte() })
    fun text(t: String) = send(t.toByteArray())
}

/*
 * 按键怎么排 —— 照实体键盘的逻辑,不自己发明:
 *
 * - **左边是功能键**:Esc 在左上,Ctrl 在左下(和键盘一样);Tab 挨着 Esc。
 * - **右边是方向键**,摆成倒 T:↑ 在 ↓ 的正上方,← ↓ → 一排。
 * - **回车永远是最右边那颗**(在方向键的右上方,和实体键盘里 Enter 与方向键的相对位置一致)。
 *   原来宽屏里 ⏎ 排在第 6 颗,落在一排中间,不符合手指对键盘的预期。
 * - ^C 紧挨在左侧功能键后面,中断命令最常用,拇指一抬就到。
 * - 「⋯」像笔记本的 Fn 键,贴着 Ctrl 放。
 * - 不常用的(^D ^Z ^L ⌫ | /)外屏收进第二页;宽屏两行放得下,直接全部露出。
 * - 字号用双指捏合调,不再占两个按键位。
 */

/**
 * 外屏(窄屏):两行、每行五颗,固定不滚。
 *
 *     Esc  Tab  ^C   ↑   ⏎
 *     Ctrl  ⋯   ←    ↓   →
 *
 * 翻到第二页时 Ctrl、⋯、⏎ 三颗**不动**,手指记住的位置不会因为翻页失效:
 *
 *     Alt  ^D   ^Z   ⌫   ⏎
 *     Ctrl  ⋯   ^L   |   /
 */
@Composable
private fun CompactKeys(k: KeyActions, keyWidth: Dp) {
    var more by remember { mutableStateOf(false) }
    val key = Modifier.width(keyWidth)
    Column(
        Modifier.padding(KeyGap),
        verticalArrangement = Arrangement.spacedBy(KeyGap),
    ) {
        // 翻页的那几格淡入淡出换过去,不是一帧跳变;不动的三颗(Ctrl ⋯ ⏎)原地不闪。
        @Composable
        fun RowScope.Flip(first: @Composable () -> Unit, second: @Composable () -> Unit) {
            Crossfade(more, key, animationSpec = tween(140), label = "keyFlip") {
                if (it) second() else first()
            }
        }
        val cell = Modifier.fillMaxWidth()
        Row(horizontalArrangement = Arrangement.spacedBy(KeyGap)) {
            Flip({ KeyCap("Esc", cell) { k.bytes(27) } }, { KeyCap("Alt", cell, active = k.alt, onPress = k.onAlt) })
            Flip({ KeyCap("Tab", cell) { k.bytes(9) } }, { KeyCap("^D", cell) { k.bytes(4) } })
            Flip({ KeyCap("^C", cell) { k.bytes(3) } }, { KeyCap("^Z", cell) { k.bytes(26) } })
            Flip(
                { KeyCap("↑", cell, repeatable = true) { k.text("\u001b[A") } },
                { KeyCap("⌫", cell, repeatable = true) { k.bytes(0x7F) } },
            )
            KeyCap("回车", key, emphasis = true, icon = XIcons.Return) { k.bytes(13) }
        }
        Row(horizontalArrangement = Arrangement.spacedBy(KeyGap)) {
            KeyCap("Ctrl", key, active = k.ctrl, onPress = k.onCtrl)
            KeyCap("⋯", key, active = more) { more = !more }
            Flip(
                { KeyCap("←", cell, repeatable = true) { k.text("\u001b[D") } },
                { KeyCap("^L", cell) { k.bytes(12) } },
            )
            Flip(
                { KeyCap("↓", cell, repeatable = true) { k.text("\u001b[B") } },
                { KeyCap("|", cell) { k.text("|") } },
            )
            Flip(
                { KeyCap("→", cell, repeatable = true) { k.text("\u001b[C") } },
                { KeyCap("/", cell) { k.text("/") } },
            )
        }
    }
}

/**
 * 内屏(宽屏):两行九颗,全部露出,不翻页。和外屏同一套逻辑,只是把第二页并进来:
 *
 *     Esc  Tab  ^C  ^D  ^Z  ^L   ⌫   ↑   ⏎
 *     Ctrl Alt   |   /   -   ~   ←   ↓   →
 */
@Composable
private fun WideKeys(k: KeyActions, keyWidth: Dp) {
    val key = Modifier.width(keyWidth)
    Column(
        Modifier.padding(KeyGap),
        verticalArrangement = Arrangement.spacedBy(KeyGap),
    ) {
        Row(horizontalArrangement = Arrangement.spacedBy(KeyGap)) {
            KeyCap("Esc", key) { k.bytes(27) }
            KeyCap("Tab", key) { k.bytes(9) }
            KeyCap("^C", key) { k.bytes(3) }
            KeyCap("^D", key) { k.bytes(4) }
            KeyCap("^Z", key) { k.bytes(26) }
            KeyCap("^L", key) { k.bytes(12) }
            KeyCap("⌫", key, repeatable = true) { k.bytes(0x7F) }
            KeyCap("↑", key, repeatable = true) { k.text("\u001b[A") }
            KeyCap("回车", key, emphasis = true, icon = XIcons.Return) { k.bytes(13) }
        }
        Row(horizontalArrangement = Arrangement.spacedBy(KeyGap)) {
            KeyCap("Ctrl", key, active = k.ctrl, onPress = k.onCtrl)
            KeyCap("Alt", key, active = k.alt, onPress = k.onAlt)
            KeyCap("|", key) { k.text("|") }
            KeyCap("/", key) { k.text("/") }
            KeyCap("-", key) { k.text("-") }
            KeyCap("~", key) { k.text("~") }
            KeyCap("←", key, repeatable = true) { k.text("\u001b[D") }
            KeyCap("↓", key, repeatable = true) { k.text("\u001b[B") }
            KeyCap("→", key, repeatable = true) { k.text("\u001b[C") }
        }
    }
}

/**
 * 输入法用的隐藏输入框。哨兵逻辑是修输入法竞态的成果,别动:重置输入框是异步
 * 生效的,输入法同帧连发时后一个事件带的仍是旧内容。
 */
@Composable
private fun HiddenImeField(
    focusRequester: FocusRequester,
    onFocus: (Boolean) -> Unit,
    takeModifiers: () -> Pair<Boolean, Boolean>,
    onText: (String, Boolean, Boolean) -> Unit,
    onBackspace: () -> Unit,
) {
    var sentinel by remember { mutableStateOf(0) }
    /** 本轮(输入框还没重置成功)已经发出去的文字,用来剔除陈旧事件里的重复部分。 */
    var sentInBurst by remember { mutableStateOf("") }
    var field by remember {
        mutableStateOf(TextFieldValue(SENTINELS[0], TextRange(SENTINELS[0].length)))
    }
    fun resetField(flip: Boolean) {
        if (flip) sentinel = (sentinel + 1) % SENTINELS.size
        val mark = SENTINELS[sentinel]
        field = TextFieldValue(mark, TextRange(mark.length))
    }
    BasicTextField(
        value = field,
        onValueChange = { value ->
            val text = value.text
            if (text.isEmpty()) {
                onBackspace()
                sentInBurst = ""
                resetField(flip = true)
                return@BasicTextField
            }
            if (value.composition == null) {
                // 带当前哨兵 = 重置已生效,后面全是新输入;带上一个哨兵 = 陈旧事件,
                // 只发本轮还没发过的尾巴。
                val fresh = text.startsWith(SENTINELS[sentinel])
                val committed = SENTINELS.fold(text) { acc, mark -> acc.removePrefix(mark) }
                val pending = when {
                    fresh -> committed
                    committed.startsWith(sentInBurst) -> committed.removePrefix(sentInBurst)
                    else -> committed
                }
                if (pending.isNotEmpty()) {
                    val (useCtrl, useAlt) = takeModifiers()
                    onText(pending, useCtrl, useAlt)
                }
                sentInBurst = committed
                resetField(flip = fresh)
                return@BasicTextField
            }
            field = value
        },
        modifier = Modifier
            .size(1.dp)
            .alpha(0f)
            .focusRequester(focusRequester)
            .onFocusChanged { onFocus(it.isFocused) },
        textStyle = TextStyle(color = Color.Transparent, fontSize = 1.sp),
        cursorBrush = SolidColor(Color.Transparent),
    )
}

@Composable
private fun TerminalCanvas(
    rows: List<ScreenRow>,
    cursor: CursorState,
    fontSize: Float,
    onGridSize: (cols: Int, rows: Int, cellWidthPx: Int, cellHeightPx: Int) -> Unit,
    onScroll: (lines: Int, col: Int, row: Int) -> Unit,
    onSecondaryClick: (Offset) -> Unit,
    /** 选区落在视口里的部分(只用来画);选区本身在核心里。 */
    selection: TermSelection?,
    /** 开始选择:按格(鼠标拖)、按词(双击 / 长按)、按行(三击)。 */
    onSelectStart: (GridCell, SelectKind) -> Unit,
    onSelectUpdate: (GridCell) -> Unit,
    onSelectClear: () -> Unit,
    /** 手指长按选完、松手的位置(在这里弹「复制 / 粘贴」菜单)。 */
    onSelectionDone: (Offset) -> Unit,
    /** 鼠标左键松开(把焦点还给按键节点)。 */
    onMouseReleased: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val p = LocalXssh.current
    // 缓存要够大:一屏中文每个字都要单独量一次宽度,默认 8 条会反复失效。
    val measurer = rememberTextMeasurer(cacheSize = 512)
    // 英文按用户选的终端字体,中文思源黑体,画线字符 Iosevka;格子一律按 Iosevka 量(见 TerminalFont)。
    val text = rememberTermText(TerminalFontChoice.current, fontSize, p.termFg, measurer)
    val cell = text.cellWidth to text.cellHeight

    val scrollBy by rememberUpdatedState(onScroll)
    val secondary by rememberUpdatedState(onSecondaryClick)
    val selectStart by rememberUpdatedState(onSelectStart)
    val selectUpdate by rememberUpdatedState(onSelectUpdate)
    val selectClear by rememberUpdatedState(onSelectClear)
    val selectDone by rememberUpdatedState(onSelectionDone)
    val released by rememberUpdatedState(onMouseReleased)
    val haptic = LocalHapticFeedback.current
    BoxWithConstraints(modifier.clipToBounds()) {
        // 画布的高度**等停下来再跟**。键盘 / 快捷键面板升起的 300ms 里可用高度每帧都在变,
        // 原来画布跟着每帧变高变矮,每一帧都要把整屏几千个字重画一遍,动画一路掉帧(实测
        // 90% 的帧 16~21ms,120Hz 的预算是 8ms)。现在画布保持原尺寸、多出来的部分被裁掉,
        // 自己一层单独缓存,动画期间一笔不重画;尺寸停稳 120ms 后才换成新高度、画一次。
        val liveHeight = constraints.maxHeight
        var height by remember { mutableIntStateOf(liveHeight) }
        LaunchedEffect(liveHeight) {
            if (liveHeight != height) {
                delay(120)
                height = liveHeight
            }
        }
        val cols = (constraints.maxWidth / cell.first).toInt().coerceAtLeast(1)
        val gridRows = (height / cell.second).toInt().coerceAtLeast(1)
        // 行列也等停下来再改:原来每变一行就让核心重排一次、给服务端发一次窗口大小
        // (远端全屏程序跟着整屏重画)。LaunchedEffect 换了键就会取消上一次,天然就是防抖。
        LaunchedEffect(cols, gridRows) {
            delay(120)
            onGridSize(cols, gridRows, cell.first.roundToInt(), cell.second.roundToInt())
        }

        // 手势放在画布上(而不是外层):它先于外层的捏合缩放拿到事件并吃掉,
        // 否则单指拖动会被 transformable 当成平移吞掉,翻不动历史。
        // 按行取整,余量留到下一次,慢慢拖才不会卡顿。
        fun cellAt(position: Offset) =
            (position.x / cell.first).toInt().coerceAtLeast(0) to (position.y / cell.second).toInt().coerceAtLeast(0)
        fun gridAt(position: Offset): GridCell {
            val col = (position.x / cell.first).toInt().coerceIn(0, cols - 1)
            return GridCell(
                row = (position.y / cell.second).toInt().coerceIn(0, gridRows - 1),
                col = col,
                rightHalf = position.x - col * cell.first >= cell.first / 2f,
            )
        }
        fun sameCell(a: GridCell, b: GridCell) = a.row == b.row && a.col == b.col
        val dragModifier = Modifier.pointerInput(cell, cols, gridRows) {
            // 连击判定跨手势,记在手势外面:双击选词,三击选整行。
            var lastClickAt = 0L
            var lastClickCell: GridCell? = null
            var clicks = 0
            awaitEachGesture {
                val down = awaitFirstDown(requireUnconsumed = false)
                if (down.type == PointerType.Mouse) {
                    // 鼠标 / 触控板按住拖 = 选择(滚动交给滚轮),和桌面终端一样。右键在 mouseModifier 里处理。
                    // 只排除右键 / 中键:触控板轻点、部分注入的鼠标事件不带按键状态,那也是"左键"。
                    val buttons = currentEvent.buttons
                    if (buttons.isSecondaryPressed || buttons.isTertiaryPressed) return@awaitEachGesture
                    val start = gridAt(down.position)
                    val last = lastClickCell
                    clicks = if (down.uptimeMillis - lastClickAt < 350 && last != null && sameCell(start, last)) clicks + 1 else 1
                    lastClickAt = down.uptimeMillis
                    lastClickCell = start
                    val kind = when (clicks) {
                        1 -> SelectKind.CELL
                        2 -> SelectKind.WORD
                        else -> SelectKind.LINE
                    }
                    if (kind != SelectKind.CELL) {
                        down.consume()
                        selectStart(start, kind)
                    }
                    var moved = false
                    while (true) {
                        val event = awaitPointerEvent()
                        val change = event.changes.firstOrNull() ?: break
                        if (!change.pressed) break
                        val at = gridAt(change.position)
                        if (!moved && !sameCell(at, start)) {
                            moved = true
                            // 按格选:真的拖动了才开始(单击不留空选区)。
                            if (kind == SelectKind.CELL) selectStart(start, kind)
                        }
                        if (moved) {
                            change.consume()
                            selectUpdate(at)
                        }
                    }
                    // 单击没拖:清掉选区(点击本身照常聚焦终端)。
                    if (!moved && kind == SelectKind.CELL) selectClear()
                    // 鼠标按下时 Compose 会清掉焦点;松手后要回来,否则拖选 / 双击之后实体键盘没了去处。
                    released()
                    return@awaitEachGesture
                }
                // 手指:拖动翻历史;按住不动 0.45 秒进入选择,接着拖动扩大选区,松手出「复制」菜单。
                val pressedAt = System.currentTimeMillis()
                var travelled = 0f
                var anchor: GridCell? = null
                var carry = 0f
                while (true) {
                    val waiting = anchor == null && travelled < viewConfiguration.touchSlop
                    val event = if (waiting) {
                        val left = (LongPressMillis - (System.currentTimeMillis() - pressedAt)).coerceAtLeast(1L)
                        withTimeoutOrNull(left) { awaitPointerEvent() }
                    } else {
                        awaitPointerEvent()
                    }
                    // 按住不动够久就进入选择。两种到达方式:一段时间没有任何事件(超时),
                    // 或者事件一直在来但手指没挪开 —— 手指按着时系统仍在持续上报位置(抖动 / 零位移),
                    // 只靠超时的话永远等不到(实测长按毫无反应)。
                    val heldLong = System.currentTimeMillis() - pressedAt >= LongPressMillis
                    if (anchor == null && travelled < viewConfiguration.touchSlop && (event == null || heldLong)) {
                        val at = gridAt(down.position)
                        anchor = at
                        haptic.performHapticFeedback(HapticFeedbackType.LongPress)
                        // 长按先选中一个词;接着拖动时核心按词往两边扩(词本身始终在选区里)。
                        selectStart(at, SelectKind.WORD)
                        if (event == null) continue
                    }
                    if (event == null) continue
                    // 两根手指 = 用户在捏合缩放,让给外层的 transformable,这里不抢。
                    if (event.changes.size > 1) break
                    val change = event.changes.firstOrNull() ?: break
                    val from = anchor
                    if (from != null) {
                        change.consume()
                        if (!change.pressed) {
                            selectDone(change.position)
                            break
                        }
                        val at = gridAt(change.position)
                        if (!sameCell(at, from)) selectUpdate(at)
                        continue
                    }
                    if (!change.pressed) break
                    val step = change.positionChange()
                    travelled += kotlin.math.abs(step.x) + kotlin.math.abs(step.y)
                    carry += step.y
                    val moved = (carry / cell.second).toInt()
                    if (moved != 0) {
                        carry -= moved * cell.second
                        // 只在真的翻了一行时才吃掉事件:轻点不受影响,照样聚焦弹键盘。
                        change.consume()
                        // 内容往下拖 = 看更早的内容。
                        val (col, row) = cellAt(change.position)
                        scrollBy(moved, col, row)
                    }
                }
            }
        }
        // 鼠标 / 触控板:滚轮一格翻 3 行(桌面终端的惯例),触控板的小数增量攒够一行再翻;
        // 右键粘贴。
        val mouseModifier = Modifier.pointerInput(cell) {
            awaitPointerEventScope {
                var carry = 0f
                while (true) {
                    val event = awaitPointerEvent()
                    val change = event.changes.firstOrNull() ?: continue
                    when {
                        event.type == PointerEventType.Scroll -> {
                            // scrollDelta.y 正数是往下滚(看更新的内容),和我们的"正数看更早"相反。
                            carry += -change.scrollDelta.y * WheelLines
                            val lines = carry.toInt()
                            if (lines != 0) {
                                carry -= lines
                                val (col, row) = cellAt(change.position)
                                scrollBy(lines, col, row)
                            }
                            change.consume()
                        }
                        event.type == PointerEventType.Press && event.buttons.isSecondaryPressed -> {
                            event.changes.forEach { it.consume() }
                            secondary(change.position)
                        }
                    }
                }
            }
        }

        val heightDp = with(LocalDensity.current) { height.toDp() }
        Canvas(
            Modifier
                .fillMaxWidth()
                .wrapContentHeight(align = Alignment.Top, unbounded = true)
                .height(heightDp)
                .graphicsLayer()
                .pointerHoverIcon(PointerIcon.Text)
                .then(mouseModifier)
                .then(dragModifier),
        ) {
            val cw = cell.first
            val ch = cell.second
            rows.forEachIndexed { r, row ->
                if (r >= gridRows) return@forEachIndexed
                val y = r * ch
                row.runs.forEach { run -> drawRun(run, y, cw, ch, text, measurer, p.termFg, p.termBg) }
            }
            // 选区:半透明的强调色盖在字上,和系统文本选择一个样子。
            selection?.let { sel ->
                for (r in sel.start.row..minOf(sel.end.row, gridRows - 1)) {
                    val range = sel.colsOn(r, cols) ?: continue
                    drawRect(
                        color = p.accent.copy(alpha = 0.32f),
                        topLeft = Offset(range.first * cw, r * ch),
                        size = Size((range.last - range.first + 1) * cw, ch),
                    )
                }
            }
            if (cursor.visible && cursor.row.toInt() < gridRows) {
                val thickness = 2.dp.toPx()
                drawRect(
                    color = p.termCursor,
                    topLeft = Offset(
                        cursor.col.toFloat() * cw,
                        (cursor.row.toInt() + 1) * ch - thickness,
                    ),
                    size = Size(cw, thickness),
                )
            }
        }
    }
}

private const val STYLE_BOLD = 1
private const val STYLE_DIM = 2
private const val STYLE_ITALIC = 4
private const val STYLE_UNDERLINE = 8
private const val STYLE_INVERSE = 16
private const val STYLE_STRIKE = 32

/** 终端画字的一套字体和格子尺寸。终端画面和选字体页的示例共用,两处画出来一模一样。 */
internal class TermText(
    /** 英文(用户选的终端字体)。 */
    val style: TextStyle,
    /** 宽字符(中日韩,占两格):思源黑体。 */
    val wide: TextStyle,
    /** 制表符、方块、箭头等要和格子严丝合缝的字:Iosevka。 */
    val symbol: TextStyle,
    val cellWidth: Float,
    val cellHeight: Float,
    /** 格子的基线离格子顶部多远:所有字(不管哪套字体)都对齐到这条线上。 */
    val baseline: Float,
    val font: TerminalFont,
)

@Composable
internal fun rememberTermText(font: TerminalFont, fontSize: Float, fg: Color, measurer: TextMeasurer): TermText =
    remember(font, fontSize, fg, measurer) {
        val symbol = TextStyle(color = fg, fontFamily = XsshFonts.mono, fontSize = fontSize.sp)
        val style = if (font == TerminalFont.Iosevka) symbol else symbol.copy(fontFamily = font.family)
        val wide = XsshFonts.cjk?.let { symbol.copy(fontFamily = it) } ?: symbol
        // 格子一律按 Iosevka 量,换字体时行高、列宽、基线都不动(候选字体都是正好半格宽)。
        // 格宽用 100 个 M 的总宽度来算:单个 M 的像素宽度是取整过的,
        // 差零点几像素,一行 80 列累积下来就是十几像素的漂移。
        val row = measurer.measure("M".repeat(100), symbol).size
        val one = measurer.measure("M", symbol)
        TermText(
            style = style,
            wide = wide,
            symbol = symbol,
            cellWidth = (row.width / 100f).coerceAtLeast(1f),
            cellHeight = one.size.height.toFloat().coerceAtLeast(1f),
            baseline = one.firstBaseline,
            font = font,
        )
    }

/**
 * 画一段样式相同的单元格。**每个字落在自己的列上**(`col × 格宽`):
 * - 可打印 ASCII 连成一串一起画(等宽字体里它们的步进正好是一格,省调用);
 * - 其它字符(中文、制表符、emoji……)单独画,居中放进它占的格子里
 *   (后面跟着空占位格就是占两格),太宽就按比例缩进格子里,绝不挤到下一格。
 *
 * 原来整行当一个字符串画:中文字形不正好是两格宽,后面的内容一路往右漂,
 * Codex 这类按列排版的界面整个错位,尾巴被裁掉。
 */
internal fun DrawScope.drawRun(
    run: StyledRun,
    y: Float,
    cw: Float,
    ch: Float,
    text: TermText,
    measurer: TextMeasurer,
    defaultFg: Color,
    defaultBg: Color,
) {
    val flags = run.flags.toInt()
    var fg = if (run.fg == 0u) defaultFg else Color(run.fg.toInt())
    var bg: Color? = if (run.bg == 0u) null else Color(run.bg.toInt())
    if (flags and STYLE_INVERSE != 0) {
        val swapped = bg ?: defaultBg
        bg = fg
        fg = swapped
    }
    if (flags and STYLE_DIM != 0) fg = fg.copy(alpha = fg.alpha * 0.6f)
    val cells = run.cells.split('\u001F')
    val col0 = run.col.toInt()
    if (bg != null) {
        drawRect(bg, topLeft = Offset(col0 * cw, y), size = Size(cells.size * cw, ch))
    }
    val decoration = when {
        flags and STYLE_UNDERLINE != 0 && flags and STYLE_STRIKE != 0 ->
            TextDecoration.combine(listOf(TextDecoration.Underline, TextDecoration.LineThrough))
        flags and STYLE_UNDERLINE != 0 -> TextDecoration.Underline
        flags and STYLE_STRIKE != 0 -> TextDecoration.LineThrough
        else -> null
    }
    val baseline = text.baseline
    val style = text.style.copy(
        color = fg,
        fontWeight = if (flags and STYLE_BOLD != 0) FontWeight.Bold else null,
        fontStyle = if (flags and STYLE_ITALIC != 0) FontStyle.Italic else null,
        textDecoration = decoration,
    )
    val wideStyle = text.wide.copy(
        color = fg,
        fontWeight = style.fontWeight,
        fontStyle = style.fontStyle,
        textDecoration = decoration,
    )
    val symbolStyle = if (text.font == TerminalFont.Iosevka) {
        style
    } else {
        text.symbol.copy(color = fg, fontWeight = style.fontWeight, fontStyle = style.fontStyle, textDecoration = decoration)
    }

    // 颜色和下划线必须在**画的时候**给,不能只写在 style 里:TextMeasurer 的缓存只按影响排版的属性
    // (字、字体、字号、粗细)比对,颜色不算。同一串字换了颜色再量,拿回来的是缓存里旧颜色的排版结果 ——
    // 切换深浅色后,终端里原有的英文仍是上一个主题的颜色(浅色底上一片近白的字),中文却换了。
    val ascii = StringBuilder()
    var asciiStart = 0
    fun flush() {
        if (ascii.isEmpty()) return
        val layout = measurer.measure(ascii.toString(), style)
        // 按格子的基线摆:换了字体,各家字体的行高不同,贴着格子顶画就会有的偏上、有的偏下。
        val top = y + baseline - layout.firstBaseline
        drawText(layout, color = fg, topLeft = Offset((col0 + asciiStart) * cw, top), textDecoration = decoration)
        ascii.setLength(0)
    }
    cells.forEachIndexed { i, glyph ->
        if (glyph.length == 1 && glyph[0].code in 0x20..0x7E) {
            if (ascii.isEmpty()) asciiStart = i
            ascii.append(glyph)
            return@forEachIndexed
        }
        flush()
        if (glyph.isEmpty()) return@forEachIndexed // 宽字符后面的占位格
        val span = if (i + 1 < cells.size && cells[i + 1].isEmpty()) 2 else 1
        val slot = span * cw
        // 占两格的(中日韩)用思源黑体;其它窄字:这套字体有(且是半格宽)就用它,否则 Iosevka(制表符、方块、箭头…)。
        val layout = measurer.measure(
            glyph,
            when {
                span == 2 -> wideStyle
                text.font.draws(glyph) -> style
                else -> symbolStyle
            },
        )
        val width = layout.size.width.toFloat()
        val x = (col0 + i) * cw
        // 对齐基线:思源黑体的行高比英文字体高,按各自的行顶摆放的话中文会整体往下掉一截。
        val top = y + baseline - layout.firstBaseline
        if (width <= slot) {
            drawText(layout, color = fg, topLeft = Offset(x + (slot - width) / 2f, top), textDecoration = decoration)
        } else {
            scale(scaleX = slot / width, scaleY = 1f, pivot = Offset(x, y)) {
                drawText(layout, color = fg, topLeft = Offset(x, top), textDecoration = decoration)
            }
        }
    }
    flush()
}
