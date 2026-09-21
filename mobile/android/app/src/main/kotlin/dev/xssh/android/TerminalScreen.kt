package dev.xssh.android

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
fun TerminalScreen(host: Host, onExit: () -> Unit, onTrustKey: (String) -> Unit = {}) {
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
            error = "这台主机还没有保存密码。\n回到主机页,左滑这台主机 → 编辑,填入密码并保存。"
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

        failure != null -> ConnectResult(
            failure,
            // 没存密码时重试只会得到同一句话,不给这个按钮。
            retry = if (host.auth == AuthKind.PASSWORD && host.password.isEmpty()) null else ({ attempt++ }),
            onExit = onExit,
        )
        session == null -> {
            // 显示已经等了多久:不再是一个看不出进展的"…"。
            // Rust 那边每一步都有上限(连接+认证 15s、开 shell 10s),到点一定会变成错误页。
            var waited by remember(host, attempt) { mutableStateOf(0) }
            LaunchedEffect(host, attempt) {
                while (true) {
                    delay(1000)
                    waited++
                }
            }
            ConnectResult(
                if (waited < 3) "连接 ${host.subtitle} …" else "连接 ${host.subtitle} … 已等待 ${waited} 秒",
                retry = null,
                onExit = onExit,
            )
        }
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
            .windowInsetsPadding(stableSafeDrawing())
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
    // "SHA256:<43 个 base64 字符>" 在 425dp 的外屏上放不进一行,而人要做的正是
    // 逐字符比对 —— 让它自由折行的话,断点随字号浮动,还会从字符中间切开。
    //
    // 所以:算法名提到标签里,摘要**固定切成 11 字符一组**,两组一行。
    // 断点是写死的,外屏、内屏、放大字体下看到的分组完全一样,比对时手指按着数得准。
    val (algorithm, rows) = fingerprintRows(value)
    Column {
        Text(
            if (algorithm.isBlank()) label else "$label · $algorithm",
            color = p.textFaint,
            fontSize = 11.sp,
        )
        Spacer(Modifier.height(3.dp))
        if (rows.isEmpty()) {
            Text("(无)", color = color, fontSize = 13.sp, fontFamily = FontFamily.Monospace)
        }
        rows.forEach { row ->
            Text(row, color = color, fontSize = 13.sp, fontFamily = FontFamily.Monospace, softWrap = false)
        }
    }
}

@Composable
private fun ConnectResult(message: String, retry: (() -> Unit)?, onExit: () -> Unit) {
    val p = LocalXssh.current
    Column(
        Modifier
            .fillMaxSize()
            .background(p.bg)
            .windowInsetsPadding(stableSafeDrawing())
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
    // 进来**不抢焦点**,也就不弹键盘。
    //
    // 原来一连上就 requestFocus(),焦点落到输入框上系统立刻弹键盘(实测连接后 100ms)。
    // 外屏只有 623dp 高,一进来就被键盘吃掉一半,轨道上的 ⌨ ✕ 也被盖住 ——
    // 盖住的 ✕ 正好和输入法的回车键在同一个位置,想断开却会按成回车。
    // 要打字时点终端或 ⌨,那两处会显式拿焦点并弹键盘。

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

    val canvas: @Composable (Modifier) -> Unit = { modifier ->
        Box(
            modifier
                .transformable(transformState)
                .clickable(
                    interactionSource = remember { MutableInteractionSource() },
                    indication = null,
                ) {
                    Log.i(TAG, "keyboard: canvas tap")
                    focusRequester.requestFocus()
                    keyboard?.show()
                },
        ) {
            TerminalCanvas(
                rows = rows,
                cursor = cursor,
                fontSize = fontSize,
                onGridSize = { cols, rows, cellW, cellH ->
                    if (cols != grid.first || rows != grid.second) {
                        grid = cols to rows
                        scope.launch(Dispatchers.IO) { live.resizeGrid(cols, rows, cellW, cellH) }
                    }
                },
                onScroll = { deltaLines ->
                    scope.launch(Dispatchers.IO) { live.scroll(deltaLines) }
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
        FloatingKeys {
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
    }

    // 和主机页、编辑页同一条右侧竖轨道、同一个位置(见 EdgeRail)。
    // 终端内容是左对齐的等宽字符网格,右侧让出轨道宽度不会压住任何取值。
    val actions: @Composable () -> Unit = {
        // 输入相关的操作装进同一枚胶囊:键盘常驻在下(和主机页的搜索同一个位置),
        // 快捷键面板的开关在它上面(开着时图标变蓝);回到底部只在翻历史时出现,加在最上面 ——
        // 胶囊往上长,键盘不动。
        GlassGroup {
            if (frame.scrollOffset > 0) {
                GlassItem(XIcons.ArrowDown, "回到底部") {
                    scope.launch(Dispatchers.IO) { live.scrollToBottom() }
                }
            }
            GlassItem(
                XIcons.Command,
                if (showKeys) "收起快捷键" else "显示快捷键",
                tint = if (showKeys) p.accent else null,
            ) { showKeys = !showKeys }
            GlassItem(XIcons.Keyboard, "调出键盘") {
                Log.i(TAG, "keyboard: rail button")
                focusRequester.requestFocus()
                keyboard?.show()
            }
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
        if (topBar) {
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
        Box(Modifier.fillMaxSize().background(p.bg)) {
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
                keys()
            }
        }
        CompositionLocalProvider(LocalBackdrop provides backdrop) {
            EdgeRail(Modifier.align(Alignment.BottomEnd), content = actions)
        }
        }
        return
    }

    Box(Modifier.fillMaxSize().background(p.termBg)) {
        Column(
            Modifier
                .fillMaxSize()
                // 玻璃按钮背后的内容(先垫终端底色,录下来的画面才不是透明的)。
                .layerBackdrop(backdrop)
                .background(p.termBg)
                .windowInsetsPadding(stableSafeDrawing())
                .imePadding()
                // 内容让出右边缘轨道的位置,终端文字不会被按钮压住(直板机没有轨道)。
                .padding(end = if (topBar) 0.dp else RailWidth),
        ) {
            header()
            canvas(Modifier.weight(1f).fillMaxWidth())
            hiddenInput()
            AnimatedVisibility(showKeys, enter = Motion.revealIn, exit = Motion.revealOut) { keys() }
        }
        if (!topBar) {
            CompositionLocalProvider(LocalBackdrop provides backdrop) {
                EdgeRail(Modifier.align(Alignment.BottomEnd), content = actions)
            }
        }
    }
}

/** 浮起的按键条:不再是贴底的整条横栏,而是一块带圆角、留出边距的面板。 */
@Composable
private fun FloatingKeys(content: @Composable () -> Unit) {
    val p = LocalXssh.current
    Box(
        Modifier
            .fillMaxWidth()
            // 三边都是 16dp:左缘和全应用所有面板、卡片同一条线;离底和右侧轨道一样高,
            // 面板底边和 ✕ 按钮底边齐平;右边和轨道之间也留 16dp,跟编辑页的表单一致。
            // 原来是 10dp,左边比别处的面板多出去 6dp,底边比 ✕ 低 6dp。
            .padding(start = Gutter, end = Gutter, bottom = Gutter)
            // 圆角和里面的按键同一个量级(按键 12dp,面板 16dp)。
            // 原来 32dp 按"跟屏幕圆角同心"来算,面板不高,看上去就是一条胶囊,
            // 和里面方正的按键不是一家人 —— 用户明确要求改成跟按键差不多。
            .clip(RoundedCornerShape(RadiusBox + 4.dp))
            // 照系统键盘:浅色是浅灰底上的白键,深色是深灰底上的灰键。
            // 用和终端底色一样的白/黑做面板,白键就融进去了,看不出键的边界。
            .background(if (p.dark) Color(0xFF1C1C1E) else Color(0xFFD5D7DD))
            .border(0.8.dp, p.glassBorder, RoundedCornerShape(RadiusBox + 4.dp)),
    ) {
        content()
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
        Text(host.label, color = p.text, fontSize = 14.sp, fontWeight = FontWeight.Medium)
        Spacer(Modifier.width(10.dp))
        Text(
            text = if (dead) "已断开" else host.subtitle,
            color = if (dead) p.danger else p.textFaint,
            fontFamily = FontFamily.Monospace,
            fontSize = 11.sp,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
        )
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
    val keys = KeyActions(ctrl, alt, onCtrl, onAlt, send)
    if (wrap) WideKeys(keys) else CompactKeys(keys)
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
private fun CompactKeys(k: KeyActions) {
    var more by remember { mutableStateOf(false) }
    Column(
        Modifier.fillMaxWidth().padding(6.dp),
        verticalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        // 翻页的那几格淡入淡出换过去,不是一帧跳变;不动的三颗(Ctrl ⋯ ⏎)原地不闪。
        @Composable
        fun RowScope.Flip(first: @Composable () -> Unit, second: @Composable () -> Unit) {
            Crossfade(more, Modifier.weight(1f), animationSpec = tween(140), label = "keyFlip") {
                if (it) second() else first()
            }
        }
        val cell = Modifier.fillMaxWidth()
        Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            Flip({ KeyCap("Esc", cell) { k.bytes(27) } }, { KeyCap("Alt", cell, active = k.alt, onPress = k.onAlt) })
            Flip({ KeyCap("Tab", cell) { k.bytes(9) } }, { KeyCap("^D", cell) { k.bytes(4) } })
            Flip({ KeyCap("^C", cell) { k.bytes(3) } }, { KeyCap("^Z", cell) { k.bytes(26) } })
            Flip(
                { KeyCap("↑", cell, repeatable = true) { k.text("\u001b[A") } },
                { KeyCap("⌫", cell, repeatable = true) { k.bytes(0x7F) } },
            )
            KeyCap("回车", Modifier.weight(1f), emphasis = true, icon = XIcons.Return) { k.bytes(13) }
        }
        Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            KeyCap("Ctrl", Modifier.weight(1f), active = k.ctrl, onPress = k.onCtrl)
            KeyCap("⋯", Modifier.weight(1f), active = more) { more = !more }
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
private fun WideKeys(k: KeyActions) {
    Column(
        Modifier.fillMaxWidth().padding(6.dp),
        verticalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            val key = Modifier.weight(1f)
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
        Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            val key = Modifier.weight(1f)
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
    rows: List<ScreenRow>,
    cursor: CursorState,
    fontSize: Float,
    onGridSize: (cols: Int, rows: Int, cellWidthPx: Int, cellHeightPx: Int) -> Unit,
    onScroll: (Int) -> Unit,
    modifier: Modifier = Modifier,
) {
    val p = LocalXssh.current
    // 缓存要够大:一屏中文每个字都要单独量一次宽度,默认 8 条会反复失效。
    val measurer = rememberTextMeasurer(cacheSize = 512)
    val style = remember(fontSize, p.termFg) {
        TextStyle(color = p.termFg, fontFamily = FontFamily.Monospace, fontSize = fontSize.sp)
    }
    val cell = remember(style, measurer) {
        // 格宽用 100 个 M 的总宽度来算:单个 M 的像素宽度是取整过的,
        // 差零点几像素,一行 80 列累积下来就是十几像素的漂移。
        val wide = measurer.measure("M".repeat(100), style).size
        val one = measurer.measure("M", style).size
        (wide.width / 100f).coerceAtLeast(1f) to one.height.toFloat().coerceAtLeast(1f)
    }

    val scrollBy by rememberUpdatedState(onScroll)
    BoxWithConstraints(modifier) {
        val cols = (constraints.maxWidth / cell.first).toInt().coerceAtLeast(1)
        val gridRows = (constraints.maxHeight / cell.second).toInt().coerceAtLeast(1)
        LaunchedEffect(cols, gridRows) {
            onGridSize(cols, gridRows, cell.first.roundToInt(), cell.second.roundToInt())
        }

        // 手势放在画布上(而不是外层):它先于外层的捏合缩放拿到事件并吃掉,
        // 否则单指拖动会被 transformable 当成平移吞掉,翻不动历史。
        // 按行取整,余量留到下一次,慢慢拖才不会卡顿。
        val dragModifier = Modifier.pointerInput(cell) {
            awaitEachGesture {
                awaitFirstDown(requireUnconsumed = false)
                var carry = 0f
                while (true) {
                    val event = awaitPointerEvent()
                    // 两根手指 = 用户在捏合缩放,让给外层的 transformable,这里不抢。
                    if (event.changes.size > 1) break
                    val change = event.changes.firstOrNull() ?: break
                    if (!change.pressed) break
                    carry += change.positionChange().y
                    val moved = (carry / cell.second).toInt()
                    if (moved != 0) {
                        carry -= moved * cell.second
                        // 只在真的翻了一行时才吃掉事件:轻点不受影响,照样聚焦弹键盘。
                        change.consume()
                        // 内容往下拖 = 看更早的内容。
                        scrollBy(moved)
                    }
                }
            }
        }

        Canvas(Modifier.fillMaxSize().then(dragModifier)) {
            val cw = cell.first
            val ch = cell.second
            rows.forEachIndexed { r, row ->
                if (r >= gridRows) return@forEachIndexed
                val y = r * ch
                row.runs.forEach { run -> drawRun(run, y, cw, ch, style, measurer, p.termFg, p.termBg) }
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

/**
 * 画一段样式相同的单元格。**每个字落在自己的列上**(`col × 格宽`):
 * - 可打印 ASCII 连成一串一起画(等宽字体里它们的步进正好是一格,省调用);
 * - 其它字符(中文、制表符、emoji……)单独画,居中放进它占的格子里
 *   (后面跟着空占位格就是占两格),太宽就按比例缩进格子里,绝不挤到下一格。
 *
 * 原来整行当一个字符串画:中文字形不正好是两格宽,后面的内容一路往右漂,
 * Codex 这类按列排版的界面整个错位,尾巴被裁掉。
 */
private fun DrawScope.drawRun(
    run: StyledRun,
    y: Float,
    cw: Float,
    ch: Float,
    base: TextStyle,
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
    val style = base.copy(
        color = fg,
        fontWeight = if (flags and STYLE_BOLD != 0) FontWeight.Bold else null,
        fontStyle = if (flags and STYLE_ITALIC != 0) FontStyle.Italic else null,
        textDecoration = decoration,
    )

    val ascii = StringBuilder()
    var asciiStart = 0
    fun flush() {
        if (ascii.isEmpty()) return
        drawText(measurer, ascii.toString(), topLeft = Offset((col0 + asciiStart) * cw, y), style = style)
        ascii.setLength(0)
    }
    cells.forEachIndexed { i, text ->
        if (text.length == 1 && text[0].code in 0x20..0x7E) {
            if (ascii.isEmpty()) asciiStart = i
            ascii.append(text)
            return@forEachIndexed
        }
        flush()
        if (text.isEmpty()) return@forEachIndexed // 宽字符后面的占位格
        val span = if (i + 1 < cells.size && cells[i + 1].isEmpty()) 2 else 1
        val slot = span * cw
        val layout = measurer.measure(text, style)
        val width = layout.size.width.toFloat()
        val x = (col0 + i) * cw
        if (width <= slot) {
            drawText(layout, topLeft = Offset(x + (slot - width) / 2f, y))
        } else {
            scale(scaleX = slot / width, scaleY = 1f, pivot = Offset(x, y)) {
                drawText(layout, topLeft = Offset(x, y))
            }
        }
    }
    flush()
}
