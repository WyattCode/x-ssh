package dev.xssh.android

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
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.systemBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
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

/**
 * \u9690\u85cf\u8f93\u5165\u6846\u91cc\u7684\u54e8\u5175\u5b57\u7b26\u3002\u6bcf\u6b21\u63d0\u4ea4\u540e\u8981\u628a\u8f93\u5165\u6846\u91cd\u7f6e\u56de\u54e8\u5175,\u4f46\u91cd\u7f6e\u662f\u5f02\u6b65\u751f\u6548\u7684:
 * \u8f93\u5165\u6cd5\u5728\u540c\u4e00\u5e27\u91cc\u8fde\u7740\u63d0\u4ea4\u65f6,\u540e\u4e00\u4e2a\u4e8b\u4ef6\u5e26\u7684\u4ecd\u662f\u91cd\u7f6e\u524d\u7684\u5185\u5bb9,\u53ea\u6309\u56fa\u5b9a\u54e8\u5175\u88c1\u524d\u7f00
 * \u4f1a\u628a\u4e0a\u4e00\u4e2a\u5b57\u7b26\u518d\u53d1\u4e00\u904d(\u5b9e\u6d4b "echo" \u53d8 "echoo")\u3002\u4e24\u4e2a\u96f6\u5bbd\u5b57\u7b26\u8f6e\u6362\u4f7f\u7528 \u2014\u2014
 * \u4e8b\u4ef6\u91cc\u5e26\u7684\u662f\u54ea\u4e2a\u54e8\u5175,\u5c31\u77e5\u9053\u91cd\u7f6e\u751f\u6548\u4e86\u6ca1\u6709\u3002
 */
private val SENTINELS = arrayOf("\u200b", "\u200c")

@Composable
fun TerminalScreen(host: Host, onExit: () -> Unit) {
    val context = LocalContext.current
    var live by remember(host) { mutableStateOf<LiveTerminal?>(null) }
    var error by remember(host) { mutableStateOf<String?>(null) }
    var attempt by remember(host) { mutableStateOf(0) }
    // 局域网权限只问一次:拒绝了也照常尝试连接,失败提示里会说明原因。
    var askedLocalNetwork by remember(host) { mutableStateOf(false) }
    val askLocalNetwork = rememberLauncherForActivityResult(
        ActivityResultContracts.RequestPermission(),
    ) { attempt++ }

    LaunchedEffect(host, attempt) {
        error = null
        live = null
        if (!askedLocalNetwork && LocalNetwork.needsPermission(context, host.address)) {
            askedLocalNetwork = true
            askLocalNetwork.launch(LocalNetwork.PERMISSION)
            return@LaunchedEffect
        }
        val result = withContext(Dispatchers.IO) { runCatching { connectHost(host) } }
        result
            .onSuccess { live = it }
            .onFailure {
                error = LocalNetwork.hintFor(context, host.address, it.message ?: it.toString())
            }
    }

    when {
        error != null -> ConnectResult(error!!, retry = { attempt++ }, onExit = onExit)
        live == null -> ConnectResult("连接 ${host.subtitle} …", retry = null, onExit = onExit)
        else -> TerminalView(live!!, host, onExit)
    }
}

@Composable
private fun ConnectResult(message: String, retry: (() -> Unit)?, onExit: () -> Unit) {
    val p = LocalXssh.current
    Column(
        Modifier.fillMaxSize().background(p.bg).systemBarsPadding().padding(24.dp),
        verticalArrangement = Arrangement.Center,
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Text(message, color = if (retry == null) p.textDim else p.danger, fontSize = 14.sp)
        Spacer(Modifier.height(18.dp))
        Row {
            if (retry != null) {
                XsshButton("重试") { retry() }
                Spacer(Modifier.width(10.dp))
            }
            XsshButton("返回", kind = ButtonKind.Ghost) { onExit() }
        }
    }
}

@Composable
private fun TerminalView(live: LiveTerminal, host: Host, onExit: () -> Unit) {
    val p = LocalXssh.current
    val scope = rememberCoroutineScope()
    val keyboard = LocalSoftwareKeyboardController.current
    val focusRequester = remember { FocusRequester() }
    // 会话一建立就让隐藏输入框拿到焦点(不主动弹软键盘):外接键盘和自动化注入
    // 才能直接输入,否则要先点一下终端。
    LaunchedEffect(Unit) { runCatching { focusRequester.requestFocus() } }

    var lines by remember { mutableStateOf(emptyList<String>()) }
    var cursor by remember { mutableStateOf(CursorState(0u, 0u, false)) }
    var dead by remember { mutableStateOf(false) }
    var fontSize by remember { mutableStateOf(14f) }
    var ctrl by remember { mutableStateOf(false) }
    var alt by remember { mutableStateOf(false) }
    var grid by remember { mutableStateOf(0 to 0) }

    LaunchedEffect(Unit) {
        while (true) {
            val alive = withContext(Dispatchers.IO) { live.pump() }
            val snapshot = withContext(Dispatchers.IO) { live.term.lines() to live.term.cursor() }
            if (snapshot.first != lines) lines = snapshot.first
            if (snapshot.second != cursor) cursor = snapshot.second
            if (!alive) {
                dead = true
                withContext(Dispatchers.IO) { live.close() }
                break
            }
            delay(16)
        }
    }

    val transformState = rememberTransformableState { zoomChange, _, _ ->
        fontSize = (fontSize * zoomChange).coerceIn(9f, 28f)
    }

    Column(Modifier.fillMaxSize().background(p.termBg).systemBarsPadding().imePadding()) {
        Row(
            Modifier.fillMaxWidth().background(p.bgElev).padding(horizontal = 8.dp, vertical = 2.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            StatusDot(if (dead) p.danger else p.ok)
            Spacer(Modifier.width(8.dp))
            Column(Modifier.weight(1f)) {
                Text(host.label, color = p.text, fontSize = 13.sp, fontWeight = FontWeight.Medium)
                Text(
                    text = if (dead) "已断开" else host.subtitle,
                    color = if (dead) p.danger else p.textFaint,
                    fontFamily = FontFamily.Monospace,
                    fontSize = 11.sp,
                )
            }
            KeyCap("⌨") {
                focusRequester.requestFocus()
                keyboard?.show()
            }
            KeyCap("断开") {
                scope.launch(Dispatchers.IO) { live.close() }
                onExit()
            }
        }

        BoxWithConstraints(
            Modifier
                .weight(1f)
                .fillMaxWidth()
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
                modifier = Modifier.fillMaxSize(),
            )
        }

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
                    scope.launch(Dispatchers.IO) { live.sendRaw(byteArrayOf(0x7F)) }
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
                        val useCtrl = ctrl
                        val useAlt = alt
                        ctrl = false
                        alt = false
                        scope.launch(Dispatchers.IO) { live.sendText(pending, useCtrl, useAlt) }
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

        KeyCapRow(Modifier.fillMaxWidth().background(p.bgElev)) {
            KeyCap("Esc") { scope.launch(Dispatchers.IO) { live.sendRaw(byteArrayOf(27)) } }
            KeyCap("Tab") { scope.launch(Dispatchers.IO) { live.sendRaw(byteArrayOf(9)) } }
            KeyCap("Ctrl", active = ctrl) { ctrl = !ctrl }
            KeyCap("Alt", active = alt) { alt = !alt }
            KeyCap("←") { scope.launch(Dispatchers.IO) { live.sendRaw("\u001b[D".toByteArray()) } }
            KeyCap("↑") { scope.launch(Dispatchers.IO) { live.sendRaw("\u001b[A".toByteArray()) } }
            KeyCap("↓") { scope.launch(Dispatchers.IO) { live.sendRaw("\u001b[B".toByteArray()) } }
            KeyCap("→") { scope.launch(Dispatchers.IO) { live.sendRaw("\u001b[C".toByteArray()) } }
            KeyCap("^C") { scope.launch(Dispatchers.IO) { live.sendRaw(byteArrayOf(3)) } }
            KeyCap("^D") { scope.launch(Dispatchers.IO) { live.sendRaw(byteArrayOf(4)) } }
            KeyCap("|") { scope.launch(Dispatchers.IO) { live.sendRaw("|".toByteArray()) } }
            KeyCap("~") { scope.launch(Dispatchers.IO) { live.sendRaw("~".toByteArray()) } }
            KeyCap("/") { scope.launch(Dispatchers.IO) { live.sendRaw("/".toByteArray()) } }
            KeyCap("-") { scope.launch(Dispatchers.IO) { live.sendRaw("-".toByteArray()) } }
        }
    }
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
