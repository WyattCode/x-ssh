package dev.xssh.android

import android.content.pm.PackageManager
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.rememberTransformableState
import androidx.compose.foundation.gestures.transformable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
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
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalSoftwareKeyboardController
import androidx.compose.ui.text.TextRange
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.drawText
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.TextFieldValue
import androidx.compose.ui.text.rememberTextMeasurer
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import uniffi.xssh_ffi.CursorState
import uniffi.xssh_ffi.FfiException

/**
 * 隐藏输入框里的哨兵字符。每次提交后要把输入框重置回哨兵,但重置是异步生效的:
 * 输入法在同一帧里连着提交时,后一个事件带的仍是重置前的内容,只按固定哨兵裁前缀
 * 会把上一个字符再发一遍(实测 "echo" 变 "echoo")。两个零宽字符轮换使用 ——
 * 事件里带的是哪个哨兵,就知道重置生效了没有。
 */
private val SENTINELS = arrayOf("\u200b", "\u200c")

/** 一帧取回的画面;[lines] 为 null 表示这一帧屏幕没变,不用动 UI。 */
private class Frame(val alive: Boolean, val lines: List<String>?, val cursor: CursorState?)

/** 等用户裁决的主机密钥:[fingerprint] 是服务端这次给出的指纹。 */
private data class PendingKey(val fingerprint: String, val changed: Boolean)

@Composable
fun TerminalScreen(host: Host, onExit: () -> Unit, onTrustKey: (String) -> Unit = {}) {
    val context = LocalContext.current
    // 已经连着就直接接管,不重连、也不再问一次主机密钥。
    var live by remember(host) { mutableStateOf(SessionRegistry[host.id]) }
    var error by remember(host) { mutableStateOf<String?>(null) }
    var pendingKey by remember(host) { mutableStateOf<PendingKey?>(null) }
    var attempt by remember(host) { mutableStateOf(0) }
    // 局域网权限只问一次:拒绝了也照常尝试连接,失败提示里会说明原因。
    var askedLocalNetwork by remember(host) { mutableStateOf(false) }
    val askLocalNetwork = rememberLauncherForActivityResult(
        ActivityResultContracts.RequestPermission(),
    ) { attempt++ }
    // Android 13 起没有通知权限,前台服务照跑但常驻通知不显示 —— 那就成了
    // 「后台挂着 SSH 连接却没有任何可见提示」,该问一次。
    var askedNotify by remember(host) { mutableStateOf(false) }
    val askNotify = rememberLauncherForActivityResult(
        ActivityResultContracts.RequestPermission(),
    ) { attempt++ }

    LaunchedEffect(host, attempt) {
        if (live != null) return@LaunchedEffect
        error = null
        pendingKey = null
        val notifyPermission = SessionService.NOTIFICATION_PERMISSION
        if (!askedNotify && notifyPermission != null &&
            context.checkSelfPermission(notifyPermission) != PackageManager.PERMISSION_GRANTED
        ) {
            askedNotify = true
            askNotify.launch(notifyPermission)
            return@LaunchedEffect
        }
        if (!askedLocalNetwork && LocalNetwork.needsPermission(context, host.address)) {
            askedLocalNetwork = true
            askLocalNetwork.launch(LocalNetwork.PERMISSION)
            return@LaunchedEffect
        }
        // 连上之后会话就登记在 SessionRegistry 里了 —— 哪怕这个协程随后被取消
        // (用户退出了这一屏),它也不会丢:主机页会显示「运行中」,可以再点回来或断开。
        val result = withContext(Dispatchers.IO) { runCatching { SessionRegistry.open(host, 80, 24) } }
        result
            .onSuccess {
                live = it
                SessionService.ensureRunning(context)
            }
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
    when {
        pending != null -> HostKeyPrompt(
            host = host,
            pending = pending,
            // 信任后由上层把指纹写回主机并换一个新的 Host 实例,本屏随之重连。
            onTrust = { onTrustKey(pending.fingerprint) },
            onExit = onExit,
        )

        failure != null -> ConnectResult(failure, retry = { attempt++ }, onExit = onExit)
        session == null -> ConnectResult("连接 ${host.subtitle} …", retry = null, onExit = onExit)
        else -> TerminalView(session, host, onExit)
    }
}

/**
 * 首次连接要用户确认主机密钥;密钥变了则是明确的告警 —— 可能是服务端重装,
 * 也可能是有人在中间。两种情况都必须由人点一下,程序不替用户决定。
 */
@Composable
private fun HostKeyPrompt(host: Host, pending: PendingKey, onTrust: () -> Unit, onExit: () -> Unit) {
    val p = LocalXssh.current
    Column(
        Modifier
            .fillMaxSize()
            .background(p.bg)
            .safeDrawingPadding()
            .padding(Gutter + BoxPad),
        verticalArrangement = Arrangement.Center,
    ) {
        Text(
            if (pending.changed) "主机密钥已改变" else "首次连接这台主机",
            color = if (pending.changed) p.danger else p.text,
            fontSize = 17.sp,
            fontWeight = FontWeight.SemiBold,
        )
        Spacer(Modifier.height(10.dp))
        Text(
            if (pending.changed) {
                "${host.subtitle} 这次出示的密钥与已信任的不一致。若不是你自己重装了服务端," +
                    "连接可能被人劫持 —— 先弄清原因再继续。"
            } else {
                "确认 ${host.subtitle} 的指纹与服务端一致后再信任。" +
                    "服务端上可用 ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub 查看。"
            },
            color = p.textDim,
            fontSize = 13.sp,
        )
        Spacer(Modifier.height(16.dp))
        if (pending.changed) {
            Fingerprint("已信任", host.keyFingerprint, p.textDim)
            Spacer(Modifier.height(8.dp))
        }
        Fingerprint("本次收到", pending.fingerprint, if (pending.changed) p.danger else p.text)
        Spacer(Modifier.height(20.dp))
        Row {
            XsshButton(
                if (pending.changed) "仍然信任新密钥" else "信任并连接",
                kind = if (pending.changed) ButtonKind.Danger else ButtonKind.Primary,
            ) { onTrust() }
            Spacer(Modifier.width(GapItem))
            XsshButton("返回", kind = ButtonKind.Ghost) { onExit() }
        }
    }
}

@Composable
private fun Fingerprint(label: String, value: String, color: Color) {
    val p = LocalXssh.current
    // "SHA256:<43 个 base64 字符>" 在 425dp 的外屏上会从中间断成两行,
    // 而人要做的正是逐字符比对 —— 断行处最容易看错。
    // 把算法名提到标签里,剩下的摘要就能完整占一行。
    val algorithm = value.substringBefore(':', "")
    val digest = value.substringAfter(':', value)
    Column {
        Text(
            if (algorithm.isBlank()) label else "$label · $algorithm",
            color = p.textFaint,
            fontSize = 11.sp,
        )
        Spacer(Modifier.height(3.dp))
        Text(
            digest.ifBlank { "(无)" },
            color = color,
            fontSize = 13.sp,
            fontFamily = FontFamily.Monospace,
        )
    }
}

@Composable
private fun ConnectResult(message: String, retry: (() -> Unit)?, onExit: () -> Unit) {
    val p = LocalXssh.current
    Column(
        Modifier
            .fillMaxSize()
            .background(p.bg)
            .safeDrawingPadding()
            .padding(Gutter + BoxPad),
        verticalArrangement = Arrangement.Center,
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Text(message, color = if (retry == null) p.textDim else p.danger, fontSize = 14.sp)
        Spacer(Modifier.height(18.dp))
        Row {
            if (retry != null) {
                XsshButton("重试") { retry() }
                Spacer(Modifier.width(GapItem))
            }
            XsshButton("返回", kind = ButtonKind.Ghost) { onExit() }
        }
    }
}

@Composable
private fun TerminalView(live: TerminalSession, host: Host, onExit: () -> Unit) {
    val p = LocalXssh.current
    val adaptive = LocalAdaptive.current
    val context = LocalContext.current
    val prefs = remember(context) { UiPrefs(context) }
    val scope = rememberCoroutineScope()
    val keyboard = LocalSoftwareKeyboardController.current
    val focusRequester = remember { FocusRequester() }
    // 会话一建立就让隐藏输入框拿到焦点(不主动弹软键盘):外接键盘和自动化注入
    // 才能直接输入,否则要先点一下终端。
    LaunchedEffect(Unit) { runCatching { focusRequester.requestFocus() } }

    // 画面由会话推过来 —— 轮询循环长在会话里,这一屏只是观众,走了它照跑。
    val frame by live.frame.collectAsState()
    val lines = frame.lines
    val cursor = frame.cursor
    val dead = !frame.alive
    var fontSize by remember { mutableStateOf(prefs.terminalFontSize) }
    var ctrl by remember { mutableStateOf(false) }
    var alt by remember { mutableStateOf(false) }
    var grid by remember { mutableStateOf(0 to 0) }

    // 捏合调完字号要记住;等手停下来再写盘,别把每一帧都落到 SharedPreferences。
    LaunchedEffect(fontSize) {
        delay(400)
        prefs.terminalFontSize = fontSize
    }

    // 对端断开后把它从名单里摘掉,主机页就不会一直显示「运行中」。
    LaunchedEffect(dead) {
        if (dead) SessionRegistry.reap(host.id)
    }

    val transformState = rememberTransformableState { zoomChange, _, _ ->
        fontSize = (fontSize * zoomChange).coerceIn(UiPrefs.FONT_MIN, UiPrefs.FONT_MAX)
    }

    val header: @Composable () -> Unit = {
        TerminalHeader(
            host = host,
            dead = dead,
            onKeyboard = {
                focusRequester.requestFocus()
                keyboard?.show()
            },
            // 「断开」是唯一会真的关掉会话的地方(另一个是通知栏的全部断开)。
            onExit = {
                SessionRegistry.close(host.id)
                onExit()
            },
        )
    }
    val canvas: @Composable (Modifier) -> Unit = { modifier ->
        Box(
            modifier
                .transformable(transformState)
                .clickable(
                    interactionSource = remember { MutableInteractionSource() },
                    indication = null,
                ) {
                    focusRequester.requestFocus()
                    keyboard?.show()
                },
        ) {
            TerminalCanvas(
                lines = lines,
                cursor = cursor,
                fontSize = fontSize,
                onGridSize = { cols, rows ->
                    if (cols != grid.first || rows != grid.second) {
                        grid = cols to rows
                        scope.launch(Dispatchers.IO) { live.resizeGrid(cols, rows) }
                    }
                },
                // 留一点边距:内屏圆角半径 52dp,贴边的字会被切掉一角。
                modifier = Modifier.fillMaxSize().padding(horizontal = Gutter),
            )
        }
    }
    val hiddenInput: @Composable () -> Unit = {
        HiddenImeField(
            focusRequester = focusRequester,
            takeModifiers = {
                val used = ctrl to alt
                ctrl = false
                alt = false
                used
            },
            onText = { text, useCtrl, useAlt ->
                scope.launch(Dispatchers.IO) { live.sendText(text, useCtrl, useAlt) }
            },
            onBackspace = { scope.launch(Dispatchers.IO) { live.sendRaw(byteArrayOf(0x7F)) } },
        )
    }
    val keys: @Composable () -> Unit = {
        TerminalKeys(
            // 宽屏折成两行全部露出;窄屏保持一行横滚,不跟终端抢竖向空间。
            wrap = adaptive.roomyKeys,
            ctrl = ctrl,
            alt = alt,
            onCtrl = { ctrl = !ctrl },
            onAlt = { alt = !alt },
            onFont = { step ->
                fontSize = (fontSize + step).coerceIn(UiPrefs.FONT_MIN, UiPrefs.FONT_MAX)
            },
            send = { bytes -> scope.launch(Dispatchers.IO) { live.sendRaw(bytes) } },
        )
    }

    val tabletop = adaptive.tabletop
    if (tabletop != null) {
        // 桌面模式:机器半开着立在桌上。上半屏只放要看的(终端),下半屏只放要碰的
        // (按键与输入法),手不会伸到上半屏去挡住输出。
        Column(Modifier.fillMaxSize().background(p.bg)) {
            Column(
                Modifier
                    .height(tabletop.startDp)
                    .fillMaxWidth()
                    .background(p.termBg)
                    .windowInsetsPadding(
                        WindowInsets.safeDrawing.only(
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
                    .background(p.bgElev)
                    .windowInsetsPadding(
                        WindowInsets.safeDrawing.only(
                            WindowInsetsSides.Bottom + WindowInsetsSides.Horizontal,
                        ),
                    )
                    .imePadding(),
            ) {
                hiddenInput()
                keys()
            }
        }
        return
    }

    Column(Modifier.fillMaxSize().background(p.termBg).safeDrawingPadding().imePadding()) {
        header()
        canvas(Modifier.weight(1f).fillMaxWidth())
        hiddenInput()
        Box(Modifier.fillMaxWidth().background(p.bgElev)) { keys() }
    }
}

@Composable
private fun TerminalHeader(host: Host, dead: Boolean, onKeyboard: () -> Unit, onExit: () -> Unit) {
    val p = LocalXssh.current
    Row(
        Modifier
            .fillMaxWidth()
            .background(p.bgElev)
            .heightIn(min = 56.dp)
            .padding(horizontal = Gutter),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        // 圆点占住 16dp 那条线(与终端文字、第一个按键同缘),标题正好落在 32dp 文字线上。
        StatusDot(if (dead) p.danger else p.ok)
        Spacer(Modifier.width(7.dp))
        Column(Modifier.weight(1f)) {
            Text(host.label, color = p.text, fontSize = 14.sp, fontWeight = FontWeight.Medium)
            Text(
                text = if (dead) "已断开" else host.subtitle,
                color = if (dead) p.danger else p.textFaint,
                fontFamily = FontFamily.Monospace,
                fontSize = 11.sp,
            )
        }
        XsshIconButton("⌨") { onKeyboard() }
        Spacer(Modifier.width(8.dp))
        XsshButton("断开", kind = ButtonKind.Danger) { onExit() }
    }
}

/** 终端按键条。方向键与退格可连发,按住就一直走 —— 改一条长命令时这是刚需。 */
@Composable
private fun TerminalKeys(
    wrap: Boolean,
    ctrl: Boolean,
    alt: Boolean,
    onCtrl: () -> Unit,
    onAlt: () -> Unit,
    onFont: (Float) -> Unit,
    send: (ByteArray) -> Unit,
) {
    // 顺序按使用频率排,不按键盘习惯排:外屏(425dp)一行只露得出 7 个键,
    // 露出来的必须是上下翻历史、左右改命令、Tab 补全和 ^C —— 之前 ^C 排在第 10 位,
    // 想中断一条命令还得先横向滚一段。宽屏会折行全部露出,顺序不影响。
    KeyCapRow(wrap = wrap) {
        KeyCap("↑", repeatable = true) { send("\u001b[A".toByteArray()) }
        KeyCap("↓", repeatable = true) { send("\u001b[B".toByteArray()) }
        KeyCap("←", repeatable = true) { send("\u001b[D".toByteArray()) }
        KeyCap("→", repeatable = true) { send("\u001b[C".toByteArray()) }
        KeyCap("Tab") { send(byteArrayOf(9)) }
        KeyCap("^C") { send(byteArrayOf(3)) }
        KeyCap("Esc") { send(byteArrayOf(27)) }
        KeyCap("Ctrl", active = ctrl, onPress = onCtrl)
        KeyCap("Alt", active = alt, onPress = onAlt)
        KeyCap("⌫", repeatable = true) { send(byteArrayOf(0x7F)) }
        KeyCap("^D") { send(byteArrayOf(4)) }
        KeyCap("^Z") { send(byteArrayOf(26)) }
        KeyCap("^L") { send(byteArrayOf(12)) }
        KeyCap("|") { send("|".toByteArray()) }
        KeyCap("~") { send("~".toByteArray()) }
        KeyCap("/") { send("/".toByteArray()) }
        KeyCap("-") { send("-".toByteArray()) }
        KeyCap("A−") { onFont(-1f) }
        KeyCap("A+") { onFont(1f) }
    }
}

/**
 * 输入法用的隐藏输入框。哨兵逻辑是修输入法竞态的成果,别动:重置输入框是异步
 * 生效的,输入法同帧连发时后一个事件带的仍是旧内容。
 */
@Composable
private fun HiddenImeField(
    focusRequester: FocusRequester,
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
        modifier = Modifier.size(1.dp).alpha(0f).focusRequester(focusRequester),
        textStyle = TextStyle(color = Color.Transparent, fontSize = 1.sp),
        cursorBrush = SolidColor(Color.Transparent),
    )
}

@Composable
private fun TerminalCanvas(
    lines: List<String>,
    cursor: CursorState,
    fontSize: Float,
    onGridSize: (Int, Int) -> Unit,
    modifier: Modifier = Modifier,
) {
    val p = LocalXssh.current
    val measurer = rememberTextMeasurer()
    val style = remember(fontSize, p.termFg) {
        TextStyle(color = p.termFg, fontFamily = FontFamily.Monospace, fontSize = fontSize.sp)
    }
    val cell = remember(style, measurer) {
        val size = measurer.measure("M", style).size
        size.width.toFloat().coerceAtLeast(1f) to size.height.toFloat().coerceAtLeast(1f)
    }

    BoxWithConstraints(modifier) {
        val cols = (constraints.maxWidth / cell.first).toInt().coerceAtLeast(1)
        val rows = (constraints.maxHeight / cell.second).toInt().coerceAtLeast(1)
        LaunchedEffect(cols, rows) { onGridSize(cols, rows) }

        Canvas(Modifier.fillMaxSize()) {
            lines.forEachIndexed { index, line ->
                if (index < rows && line.isNotEmpty()) {
                    drawText(
                        textMeasurer = measurer,
                        text = line,
                        topLeft = Offset(0f, index * cell.second),
                        style = style,
                    )
                }
            }
            if (cursor.visible && cursor.row.toInt() < rows) {
                val thickness = 2.dp.toPx()
                drawRect(
                    color = p.termCursor,
                    topLeft = Offset(
                        cursor.col.toFloat() * cell.first,
                        (cursor.row.toInt() + 1) * cell.second - thickness,
                    ),
                    size = Size(cell.first, thickness),
                )
            }
        }
    }
}
