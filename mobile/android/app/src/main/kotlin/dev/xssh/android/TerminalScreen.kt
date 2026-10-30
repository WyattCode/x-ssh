package dev.xssh.android

import androidx.compose.ui.graphics.nativeCanvas
import androidx.compose.ui.graphics.toArgb

import kotlinx.coroutines.Job
import androidx.compose.ui.input.pointer.util.VelocityTracker
import androidx.compose.animation.core.exponentialDecay
import androidx.compose.animation.core.animateDecay
import androidx.compose.animation.core.AnimationState
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
import androidx.compose.runtime.derivedStateOf
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
import androidx.compose.ui.res.stringResource
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

/** 等用户裁决的主机密钥:[fingerprint] 是服务端这次给出的指纹;[jump] = 说的是跳板机的密钥。 */
private data class PendingKey(val fingerprint: String, val changed: Boolean, val jump: Boolean = false)

/** 错误页上那句话是哪一类:决定给不给「填写口令」按钮(原来靠比对中文原文,换了语言就失效)。 */
private enum class FailureKind { Other, KeyPassphrase }

@Composable
fun TerminalScreen(
    host: Host,
    onExit: () -> Unit,
    onTrustKey: (String) -> Unit = {},
    /** 信任跳板机的密钥:指纹要存到跳板机那台主机上(第一个参数),不是这台。 */
    onTrustJumpKey: (Host, String) -> Unit = { _, _ -> },
    /** 放在平板右栏里时不为空:工具栏换成平板那套,不再画手机的轨道 / 底栏按钮。 */
    tablet: TabletTerminalChrome? = null,
    /** 手机 / 折叠屏:打开这条连接的文件页(平板走 [tablet] 里的开关)。 */
    onFiles: (() -> Unit)? = null,
    /** 手机 / 折叠屏:打开这台主机的编辑页(连接失败时「填写密码」这类就地修复用;平板走 [tablet])。 */
    onEditHost: (() -> Unit)? = null,
    /** 连上 / 接管到活会话的那一刻回调(主机 id):首页按"最近使用"排序就靠它。 */
    onConnected: (String) -> Unit = {},
) {
    val context = LocalContext.current
    // 跳板机从主机表里现查:信任了它的密钥、改了它的密码,这里拿到的就是新的那份,随之重连。
    val jumpHost = host.jumpHostId.takeIf { it.isNotEmpty() }
        ?.let { id -> LocalHosts.current.firstOrNull { it.id == id } }
    // 设了跳板机、那台却已经删了。**不能**退回直连:内网地址直连只会超时,让人以为是网络问题。
    val jumpGone = host.jumpHostId.isNotEmpty() && jumpHost == null
    // 已经连着就直接接管,不重连、也不再问一次主机密钥。
    var live by remember(host, jumpHost) { mutableStateOf(SessionRegistry[host.id]) }
    // 连上 / 接管的那一刻记一笔"最近使用"。失败不记;自动重连不换 `live` 这个对象,也不记 ——
    // "最近使用"回答的是"用户最近主动去干哪台",不是"哪台最近还活着"(那是会话区的事)。
    LaunchedEffect(live) { if (live != null) onConnected(host.id) }
    // 错误页那句话**存成「怎么说」而不是说好的字**:换界面语言时界面不重建(见 Manifest 的 configChanges),
    // 存成字的话平板上开着错误页去设置里换语言,别处都变了,就这句还是旧语言。显示时再按当前语言取。
    var error by remember(host, jumpHost) { mutableStateOf<((android.content.Context) -> String)?>(null) }
    var errorKind by remember(host, jumpHost) { mutableStateOf(FailureKind.Other) }
    var pendingKey by remember(host, jumpHost) { mutableStateOf<PendingKey?>(null) }
    var attempt by remember(host, jumpHost) { mutableStateOf(0) }
    // 这一屏里已经解锁过的凭据(本机, 跳板机)。确认完主机密钥重连时直接用,不再弹指纹:
    // 系统的解锁窗口只有 10 秒,读完指纹再点「信任」早过了 —— 原来第一次连一台加锁主机要按两三次。
    // 键里去掉了指纹(信任之后只有它变),其余任何一项变了(编辑浮层里改了密码)就作废重新解锁。
    // 离开这一屏就没了;连上之后也清掉(会话自己留着一份用于重连)。
    var unlocked by remember(host.copy(keyFingerprint = ""), jumpHost?.copy(keyFingerprint = "")) {
        mutableStateOf<Pair<Host, Host?>?>(null)
    }
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

    LaunchedEffect(host, jumpHost, attempt) {
        if (live != null) return@LaunchedEffect
        error = null
        errorKind = FailureKind.Other
        pendingKey = null
        if (jumpGone) {
            error = { it.getString(R.string.term_err_jump_gone) }
            return@LaunchedEffect
        }
        // 开了「用生物识别解锁」的主机,列表里读到的密码是空的(没解锁就读不出来)。
        // 先解锁再判断"有没有存" —— 顺序反了会把"还没解锁"报成"没有保存密码"。
        val cached = unlocked
        val ready = if (cached != null) host.withSecretsOf(cached.first) else unlockCredentials(context, host)
        if (ready == null) {
            error = { it.getString(R.string.term_err_unlock_failed) }
            return@LaunchedEffect
        }
        // 跳板机的凭据同样要解锁。两台都加了锁时一般只弹一次:第一次验过之后解锁窗口还开着。
        val readyJump = jumpHost?.let { jump ->
            cached?.second?.let { jump.withSecretsOf(it) } ?: unlockCredentials(context, jump) ?: run {
                error = { it.getString(R.string.term_err_unlock_jump_failed, jump.label) }
                return@LaunchedEffect
            }
        }
        if (readyJump != null && readyJump.auth == AuthKind.PASSWORD && readyJump.password.isEmpty()) {
            error = { it.getString(R.string.term_err_jump_no_password, readyJump.label) }
            return@LaunchedEffect
        }
        if (readyJump != null && readyJump.keyMissing) {
            error = { it.getString(R.string.term_err_jump_no_key, readyJump.label) }
            return@LaunchedEffect
        }
        // 密码认证却没有存密码(旧版本只放内存、或者新建时没填):拿空密码去连,
        // 服务端只会回一句笼统的认证失败,用户看不出是"没填"还是"填错"。
        // 也不要先弹权限框再失败 —— 在这里就说清楚。
        if (ready.auth == AuthKind.PASSWORD && ready.password.isEmpty()) {
            error = { it.getString(R.string.term_err_no_password) }
            return@LaunchedEffect
        }
        if (ready.keyMissing) {
            error = { it.getString(R.string.term_err_no_key) }
            return@LaunchedEffect
        }
        unlocked = ready to readyJump
        val notifyPermission = SessionService.NOTIFICATION_PERMISSION
        if (!askedNotify && notifyPermission != null &&
            context.checkSelfPermission(notifyPermission) != PackageManager.PERMISSION_GRANTED
        ) {
            askedNotify = true
            PermissionAsked.notifications = true
            askNotify.launch(notifyPermission)
            return@LaunchedEffect
        }
        // 手机直接连的是跳板机:局域网权限看它的地址(目标可能是跳板机后面的内网地址,和手机无关)。
        val direct = readyJump?.address ?: host.address
        if (!askedLocalNetwork && LocalNetwork.needsPermission(context, direct)) {
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
                // 第一次就连不上多半是一次性的(中转 / NAT 掐了握手),先自己再试两次,别让用户去点重试。
                // 重试的间隙里用户点了「全部断开」:不能再连(open 只管握手那几秒)。
                val generation = SessionRegistry.generation
                retryInitialConnect(
                    onRetry = { n, err ->
                        Log.w(TAG, "first connect attempt $n failed, retrying: [${err.javaClass.simpleName}] ${err.message}")
                    },
                ) {
                    if (SessionRegistry.generation != generation) throw SessionRegistry.Cancelled()
                    SessionRegistry.open(ready, readyJump, 80, 24)
                }
            }
                .onSuccess {
                    // **服务起不来不算连接失败。** 它和登记要在同一个不可取消的步骤里
                    // (上面那段注释),但异常必须分开接:Android 12 起,应用退到后台时
                    // `startForegroundService` 会抛 —— 连上之后按个 Home 就能撞上。
                    // 混在一个 runCatching 里的话,界面报「连接失败」,而会话其实是活的、
                    // 主机页还写着「运行中」,只是没人托着进程。
                    runCatching { SessionService.ensureRunning(context) }
                        .onFailure { err ->
                            Log.w(TAG, "foreground service not started: ${err.javaClass.simpleName} ${err.message}")
                        }
                }
        }
        result
            .onSuccess {
                live = it
                unlocked = null
            }
            .onFailure { failure ->
                // 主机密钥两种异常的 message 就是服务端指纹本身(见 FfiError 注释)。
                val fingerprint = failure.message.orEmpty().trim()
                when {
                    // 指纹为空就没得信任 —— 真让用户点下去只会存个空值、再弹一次同样的框。
                    fingerprint.isEmpty() &&
                        (failure is FfiException.HostKeyUnknown ||
                            failure is FfiException.HostKeyChanged ||
                            failure is FfiException.JumpHostKeyUnknown ||
                            failure is FfiException.JumpHostKeyChanged) ->
                        error = { it.getString(R.string.term_err_no_fingerprint, failure.javaClass.simpleName) }

                    failure is FfiException.HostKeyUnknown ->
                        pendingKey = PendingKey(fingerprint, changed = false)

                    failure is FfiException.HostKeyChanged ->
                        pendingKey = PendingKey(fingerprint, changed = true)

                    // 跳板机的密钥:确认页换成跳板机那台,信任后指纹存到它身上。
                    failure is FfiException.JumpHostKeyUnknown ->
                        pendingKey = PendingKey(fingerprint, changed = false, jump = true)

                    failure is FfiException.JumpHostKeyChanged ->
                        pendingKey = PendingKey(fingerprint, changed = true, jump = true)

                    failure is FfiException.KeyEncrypted && readyJump != null && isJumpFailure(failure.message) ->
                        error = { c ->
                            if (readyJump.keyPassphrase.isEmpty()) {
                                c.getString(R.string.term_err_jump_key_passphrase_needed, readyJump.label)
                            } else {
                                c.getString(R.string.term_err_jump_key_passphrase_wrong, readyJump.label)
                            }
                        }

                    // 看**解锁后**的口令:加锁主机的 host.keyPassphrase 永远是空的,填错了口令也会被说成"有口令"。
                    failure is FfiException.KeyEncrypted -> {
                        val passphraseMissing = ready.keyPassphrase.isEmpty()
                        error = { c ->
                            c.getString(
                                if (passphraseMissing) R.string.term_err_key_passphrase_needed
                                else R.string.term_err_key_passphrase_wrong,
                            )
                        }
                        errorKind = FailureKind.KeyPassphrase
                    }

                    // 握手期间点了「全部断开」(见 SessionRegistry.open)。
                    failure is SessionRegistry.Cancelled ->
                        error = { it.getString(R.string.term_err_cancelled) }

                    else -> {
                        val message = failure.message?.ifBlank { null } ?: failure.toString()
                        val jumpText = readyJump?.let { jumpFailure(message, it, host) }
                        error = { c -> jumpText?.format(c) ?: LocalNetwork.hintFor(c, direct, message) }
                    }
                }
            }
    }

    // 先绑成局部变量:onTrust 是稍后才执行的,直接在里面 pendingKey!! 等于赌它那时还不是 null。
    val pending = pendingKey
    // 读一下 LocalConfiguration:换了界面语言它会变,这一句随之按新语言重取。
    val failure = error?.let { phrase -> androidx.compose.ui.platform.LocalConfiguration.current; phrase(context) }
    val failureKind = errorKind
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
            // 跳板机的密钥:页面上说的是跳板机那台(它的名字、地址、上次记录的指纹)。
            val keyHost = if (pending.jump) jumpHost ?: host else host
            HostKeyGate(
                host = keyHost,
                fingerprint = pending.fingerprint,
                changed = pending.changed,
                tablet = tablet != null,
                jumpFor = if (pending.jump) host else null,
                // 信任后由上层把指纹写回主机并换一个新的 Host 实例,本屏随之重连。
                onTrust = {
                    if (pending.jump && jumpHost != null) {
                        onTrustJumpKey(jumpHost, pending.fingerprint)
                    } else {
                        onTrustKey(pending.fingerprint)
                    }
                },
                onExit = onExit,
            )
        }

        failure != null -> frame {
            // 判"到底存没存密码"要看磁盘上那条密文,不能看 host.password ——
            // 加了锁而这次没解开时它也是空的,那会把"没能解锁"错报成"没有保存密码",
            // 还会把「重试」按钮藏掉,用户就没有再解锁一次的机会了。
            // (私钥那边同理,已经收进 Host.keyMissing。)
            val storedPassword = host.password.isNotEmpty() || host.lockedPassword != null
            val noPassword = host.auth == AuthKind.PASSWORD && !storedPassword
            val keyProblem = failureKind == FailureKind.KeyPassphrase
            // 跳板机没存凭据:重试只会得到同一句话(去跳板机那台的编辑页补上)。
            val jumpNoCredentials = jumpHost != null && (
                (jumpHost.auth == AuthKind.PASSWORD && jumpHost.password.isEmpty() && jumpHost.lockedPassword == null) ||
                    jumpHost.keyMissing
                )
            val fixPickJump = stringResource(R.string.term_fix_pick_jump)
            val fixPassword = stringResource(R.string.term_fix_enter_password)
            val fixKey = stringResource(R.string.term_fix_import_key)
            val fixPassphrase = stringResource(R.string.term_fix_enter_passphrase)
            ConnectGate(
                host = host,
                failure = failure,
                waited = 0,
                tablet = tablet != null,
                // 没存密码 / 没导入私钥时,重试只会得到同一句话,不给这个按钮。
                retry = if (noPassword || host.keyMissing || jumpGone || jumpNoCredentials) null else ({ attempt++ }),
                onExit = onExit,
                // 能就地修的直接给按钮,打开编辑页(平板是浮层)—— 不用先退回去再找编辑入口。
                fix = (tablet?.onEdit ?: onEditHost)?.let { edit ->
                    when {
                        jumpGone -> fixPickJump to edit
                        noPassword -> fixPassword to edit
                        host.keyMissing -> fixKey to edit
                        keyProblem -> fixPassphrase to edit
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
        modePill = context.getString(if (imeMode) R.string.term_mode_ime else R.string.term_mode_english)
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
    val frameState = live.frame.collectAsState()
    // 画面每 16ms 换一帧,**但整屏不该跟着重组**。
    //
    // 原来这里写 `val frame by …collectAsState()`:一读就等于订阅,新的一帧到了,这个函数
    // 从头到尾重新跑一遍 —— 工具栏、轨道、快捷键面板、几十个 Modifier 全部重建,而它们
    // 一个字都没变。滚 Codex 的长历史时每帧都这样,CPU 全花在重组上。
    // 现在组合期只看下面这几个**很少变**的开关(derivedStateOf:值没变就不重组),
    // 真正每帧都在变的行内容和光标只在**画**的时候读(见 TerminalCanvas 的画布 lambda),
    // 变了就只重画,不重组、不重新布局。
    val dead by remember { derivedStateOf { !frameState.value.alive } }
    // 断线后正在自动重连的第几次;0 = 没在重连。
    val reconnecting by remember { derivedStateOf { frameState.value.reconnecting } }
    val scrolled by remember { derivedStateOf { frameState.value.scrollOffset > 0 } }
    val hasSelection by remember { derivedStateOf { frameState.value.selection != null } }
    val canFling by remember {
        derivedStateOf { !frameState.value.modes.altScreen && !frameState.value.modes.mouseReport }
    }
    var fontSize by remember { mutableStateOf(prefs.terminalFontSize) }
    var ctrl by remember { mutableStateOf(false) }
    // 快捷键面板默认收起,终端多出两行;点轨道上的 ⌘ 才出来。
    var showKeys by remember { mutableStateOf(false) }
    var alt by remember { mutableStateOf(false) }
    var grid by remember { mutableStateOf(0 to 0) }
    // 命令片段面板(轨道 / 底栏 / 平板工具栏上的 ⚡)。
    var snippetsOpen by remember { mutableStateOf(false) }

    // 捏合调完字号要记住;等手停下来再写盘,别把每一帧都落到 SharedPreferences。
    // 写盘失败(磁盘满、SharedPreferences 坏掉)时把字号滚回去并提示 —— 否则这一屏
    // 按新字号排好了,下次启动又变回旧的,用户只会觉得"调了没用"。
    LaunchedEffect(fontSize) {
        delay(400)
        if (prefs.setTerminalFontSize(fontSize)) return@LaunchedEffect
        val saved = prefs.terminalFontSize
        if (fontSize != saved) {
            fontSize = saved
            android.widget.Toast.makeText(context, R.string.font_size_persist_failed, android.widget.Toast.LENGTH_SHORT).show()
        }
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
    val selection: () -> TermSelection? = { frameState.value.selection?.toTermSelection() }
    val copySelection: () -> Unit = { live.copySelection { copyText(context, it) } }
    // 判据是"核心里有没有选区"(`live.hasSelection`),**不是**"这一帧的视口里看不看得见"。
    // 用后者的话,选区滚出视口之后 `frame.selection` 变成 null,这里就直接短路了 ——
    // 核心里那份一直留着:打字不清它,回滚上去高亮还在,`Ctrl+Shift+C` 还会把它复制走。
    val clearSelection: () -> Unit = { if (live.hasSelection) live.selectClear() }

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
        val text = KeyEncoder.encode(e, frameState.value.modes, ctrl, alt) ?: return@handler false
        ctrl = false
        alt = false
        clearSelection()
        swallowed += e.keyCode
        live.sendRaw(text.toByteArray())
        true
    }

    // 右键 / 工具栏「更多」里的终端操作(平板)。手机上右键仍是直接粘贴。
    fun terminalMenu(): List<MenuAction> = buildList {
        if (hasSelection) add(MenuAction(context.getString(R.string.term_menu_copy), shortcut = "Ctrl+Shift+C") { copySelection() })
        add(MenuAction(context.getString(R.string.term_menu_paste), shortcut = "Ctrl+Shift+V") { paste() })
        add(MenuAction(context.getString(R.string.term_menu_clear), shortcut = "Ctrl+L") { live.sendRaw(byteArrayOf(12)) })
        add(MenuAction(context.getString(R.string.term_menu_font_bigger), shortcut = "Ctrl+Shift+=") {
            fontSize = (fontSize + 1f).coerceIn(UiPrefs.FONT_MIN, UiPrefs.FONT_MAX)
        })
        add(MenuAction(context.getString(R.string.term_menu_font_smaller), shortcut = "Ctrl+Shift+-") {
            fontSize = (fontSize - 1f).coerceIn(UiPrefs.FONT_MIN, UiPrefs.FONT_MAX)
        })
        add(MenuAction(context.getString(R.string.term_menu_snippets)) { snippetsOpen = true })
        tablet?.let { add(MenuAction(context.getString(R.string.term_menu_edit_host), shortcut = "Ctrl+Shift+E") { it.onEdit() }) }
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
                canFling = canFling,
                frame = { frameState.value },
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
                        hasSelection -> copySelection()
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
                // 三条出口都在发完之后收掉粘滞键、清掉选区(和实体键盘那条路一致)。
                send = { bytes ->
                    // Ctrl 对已经是控制字节的键没有额外含义;Alt 是加 ESC 前缀(Alt+Tab 之类)。
                    val out = if (alt) byteArrayOf(27) + bytes else bytes
                    ctrl = false
                    alt = false
                    clearSelection()
                    live.sendRaw(out)
                },
                type = { text ->
                    val useCtrl = ctrl
                    val useAlt = alt
                    ctrl = false
                    alt = false
                    clearSelection()
                    live.sendText(text, useCtrl, useAlt)
                },
                cursor = { c ->
                    val out = KeyEncoder.cursor(c, frameState.value.modes, ctrl, alt)
                    ctrl = false
                    alt = false
                    clearSelection()
                    live.sendRaw(out.toByteArray())
                },
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
        // 直板机竖屏(17 Ultra 400dp 宽)底栏一行放不下 7 颗 56dp 的按钮:外观让位 —— 终端页最用不上它,
        // 别的页都有。放得下(横屏、宽一点的手机)照常显示。算法:7 颗 + 3 个间隔 + 两边边距 = 460dp。
        val barCrowded = LocalChrome.current == Chrome.BottomBar && LocalConfiguration.current.screenWidthDp < 460
        GlassReveal(!imeUp && !barCrowded) { GlassGroup { ThemeGlassItem() } }
        // 文件(SFTP):单独一颗,在输入那枚胶囊上面 —— 它是"换一页",不是输入。
        // 断开之后它会消失,所以长出来 / 收回去都带动效(见 GlassReveal)。
        GlassReveal(onFiles != null && !dead) { GlassButton(XIcons.Folder, stringResource(R.string.term_files)) { onFiles?.invoke() } }
        // 输入相关的操作装进同一枚胶囊:键盘常驻在下(和主机页的搜索同一个位置),
        // 快捷键面板的开关在它上面(开着时图标变蓝);回到底部只在翻历史时出现,加在最上面 ——
        // 胶囊往上长,键盘不动。
        GlassGroup {
            // 翻历史时才有:胶囊往上长出这一颗,不是凭空"砰"地出现。
            GlassReveal(scrolled) {
                GlassItem(XIcons.ArrowDown, stringResource(R.string.term_scroll_bottom)) {
                    live.scrollToBottom()
                }
            }
            // 命令片段也是"输入":点一下把存好的命令发出去。断开 / 重连中没东西可发,收起来。
            // 键盘弹着时也收起(同外观):外屏键盘占掉一半高度,轨道不能再多一颗;正在打字的人要的是键盘。
            GlassReveal(!dead && reconnecting == 0 && !imeUp) {
                GlassItem(XIcons.Bolt, stringResource(R.string.term_snippets)) { snippetsOpen = true }
            }
            GlassItem(
                XIcons.Command,
                stringResource(if (showKeys) R.string.term_hide_keys else R.string.term_show_keys),
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
                stringResource(if (imeOn) R.string.term_hide_keyboard else R.string.term_show_keyboard),
                tint = if (imeOn) p.accent else null,
            ) { toggleIme(imeOn) }
        }
        // 断开是危险操作,单独一颗、红色图标,放在最下面(和 ＋ / ✓ 同一个位置)。
        GlassButton(XIcons.Close, stringResource(R.string.term_disconnect_session), tint = p.danger) {
                SessionRegistry.close(host.id)
                onExit()
        }
    }

    // 折叠屏:⌨ ✕ 在右侧轨道;直板机:和主机名一起放在最底下一行(见 bottomBarRow),按键面板铺满整宽。
    val bottomBar = LocalChrome.current == Chrome.BottomBar
    val header: @Composable () -> Unit = {
        if (tablet != null) {
            // 平板:工具栏在终端上面 —— 侧边栏开关、主机名、输入相关的开关、「更多」和「断开」。
            TabletToolbar(
                sidebarVisible = tablet.sidebarVisible,
                onToggleSidebar = tablet.onToggleSidebar,
                title = host.label,
                subtitle = when {
                    dead -> stringResource(R.string.term_disconnected)
                    reconnecting > 0 -> reconnectingText(reconnecting)
                    else -> host.subtitle
                },
                dot = when {
                    dead -> p.danger
                    reconnecting > 0 -> p.warn
                    else -> p.ok
                },
            ) {
                GlassRevealRow(!dead) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        PaneSwitch(files = false) { if (it) tablet.onShowFiles() }
                        Spacer(Modifier.width(8.dp))
                    }
                }
                GlassRevealRow(scrolled) {
                    ToolbarIcon(XIcons.ArrowDown, stringResource(R.string.term_scroll_bottom)) { live.scrollToBottom() }
                }
                GlassRevealRow(!dead && reconnecting == 0) {
                    ToolbarIcon(XIcons.Bolt, stringResource(R.string.term_snippets)) { snippetsOpen = true }
                }
                ToolbarIcon(
                    XIcons.Command,
                    stringResource(if (showKeys) R.string.term_hide_key_bar else R.string.term_show_key_bar),
                    active = showKeys,
                ) { showKeys = !showKeys }
                @OptIn(ExperimentalLayoutApi::class)
                val imeVisible = WindowInsets.isImeVisible
                val imeOn = imeFocused && (imeVisible || hardKeyboard)
                ToolbarIcon(
                    XIcons.Keyboard,
                    when {
                        hardKeyboard && imeOn -> stringResource(R.string.term_ime_hint_ime)
                        hardKeyboard -> stringResource(R.string.term_ime_hint_direct)
                        imeOn -> stringResource(R.string.term_hide_keyboard)
                        else -> stringResource(R.string.term_show_keyboard)
                    },
                    active = imeOn,
                ) { toggleIme(imeOn) }
                var moreOpen by remember { mutableStateOf(false) }
                Box {
                    ToolbarIcon(XIcons.More, stringResource(R.string.term_more)) { moreOpen = true }
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
                    ToolbarTextButton(stringResource(R.string.term_close), p.textDim) { onExit() }
                    ToolbarTextButton(stringResource(R.string.term_reconnect), p.accent, bold = true) { onReconnect() }
                } else {
                    ToolbarTextButton(stringResource(R.string.term_disconnect), p.danger) {
                        SessionRegistry.close(host.id)
                        onExit()
                    }
                }
            }
        } else {
            // 折叠屏和直板机都一样:顶上只有一行细字(哪台机器 / 已断开),**没有按钮**。
            // 直板机原来这一行右边挤着四颗按钮,全屏程序的头几行被压着(用户实测的抱怨);
            // 按钮挪到底下以后,名字留在顶上 —— 标题在上、操作在下,安卓手机的通常排法,
            // 也和折叠屏同一个样子。试过把名字放到底下按钮左边,用户否掉了。
            HostLine(host = host, dead = dead, reconnecting = reconnecting)
        }
    }

    if (snippetsOpen) {
        SnippetSheet(
            host = host,
            tablet = tablet != null,
            onSend = { s ->
                snippetsOpen = false
                // 粘滞的 Ctrl / Alt 是给"下一个按键"的,片段不吃它们 —— 但也别让它们留到片段之后的那一下。
                ctrl = false
                alt = false
                clearSelection()
                live.sendRaw(snippetPayload(s.text, s.run).toByteArray())
                restoreFocus()
            },
            onDismiss = {
                snippetsOpen = false
                restoreFocus()
            },
        )
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
            // 直板机:最底下一行放按钮(靠右)。**占自己的一行,不浮在终端上** ——
            // 提示符就在终端最底下一行,浮着的玻璃会把正在敲的命令盖住。键盘弹起时这一行跟着升到键盘上方。
            // 左下角空着,不是按钮:在文件页连点 ‹ 退回来,多点的那一下落在这里,无害。
            // 按钮和别的页一样大(56dp)、离底一样远:用户要的是从文件页退回来按钮不跳。
            // 代价是终端少一行左右,用户选了统一。
            if (bottomBar) {
                BottomBar(insets = false, end = { actions() })
            }
        }
        if (!bottomBar && tablet == null) {
            CompositionLocalProvider(LocalBackdrop provides backdrop) {
                EdgeRail(Modifier.align(Alignment.BottomEnd), content = actions)
            }
        }
    }
}

/** 用 [other] 里已经解锁的三条凭据,其余(尤其是刚信任的指纹)取自己的。 */
private fun Host.withSecretsOf(other: Host): Host =
    copy(password = other.password, keyData = other.keyData, keyPassphrase = other.keyPassphrase)

/** 核心报的错是不是跳板机那一跳的(见 Rust `SshError::Jump` / `Tunnel` 的 Display)。 */
private fun isJumpFailure(message: String?): Boolean = message.orEmpty().startsWith("jump host")

/** 跳板机那一跳出的错:[jump] 是跳板机的名字,[reason] 是核心报的原因(英文原文)。 */
internal sealed class JumpFailure {
    abstract val jump: String
    abstract val reason: String

    /** 跳板机本身连上了,但从它那儿连不到目标 [target](`地址:端口`)。 */
    data class Tunnel(override val jump: String, val target: String, override val reason: String) : JumpFailure()

    /** 跳板机这一跳本身就失败了(连不上、认证失败……)。 */
    data class Hop(override val jump: String, override val reason: String) : JumpFailure()
}

/**
 * 跳板机那一跳的错误换成人话:说清是**哪一台**出的事,用户才知道去改哪台主机。
 * 不是跳板机的错就返回 null,由调用方照常处理。
 * 不碰 Context(有纯 JVM 单测),成文交给 [format]。
 */
internal fun jumpFailure(message: String, jump: Host, target: Host): JumpFailure? {
    val tunnel = "jump host could not open a tunnel: "
    val hop = "jump host: "
    return when {
        message.startsWith(tunnel) ->
            JumpFailure.Tunnel(jump.label, "${target.address}:${target.port}", message.removePrefix(tunnel))
        message.startsWith(hop) -> JumpFailure.Hop(jump.label, message.removePrefix(hop))
        else -> null
    }
}

private fun JumpFailure.format(context: android.content.Context): String = when (this) {
    is JumpFailure.Tunnel -> context.getString(R.string.term_jump_tunnel_failed, jump, target, reason)
    is JumpFailure.Hop -> context.getString(R.string.term_jump_hop_failed, jump, reason)
}

/** 「重连中」那行字:第一次只说在重连,之后带上次数,让人知道它一直在试、没卡死。 */
@Composable
private fun reconnectingText(attempt: Int): String =
    if (attempt <= 1) stringResource(R.string.term_reconnecting) else stringResource(R.string.term_reconnecting_n, attempt)

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
                .background(p.barBg)
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
private fun HostLine(host: Host, dead: Boolean, reconnecting: Int = 0) {
    val p = LocalXssh.current
    Row(
        Modifier.fillMaxWidth().padding(start = Gutter, end = Gutter, top = 10.dp, bottom = 8.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        // 圆点占住 16dp 那条线(与终端文字、第一个按键同缘),名字落在 32dp 文字线上。
        StatusDot(
            when {
                dead -> p.danger
                reconnecting > 0 -> p.warn
                else -> p.ok
            },
        )
        Spacer(Modifier.width(7.dp))
        // 地址要么整条放得下就显示,要么干脆不显示 —— 以前直板机这一行右边排了四颗按钮,
        // 原来地址被截成「user@12…」,半截地址比没有更难看,也看不出是哪台机器。
        // 「已断开」是状态,必须显示,放不下时顶掉的是名字(名字自己省略)。
        // 重连中和已断开一样是状态,必须显示(放不下时顶掉的是名字)。
        val detail = when {
            dead -> stringResource(R.string.term_disconnected)
            reconnecting > 0 -> reconnectingText(reconnecting)
            else -> host.subtitle
        }
        val status = dead || reconnecting > 0
        androidx.compose.ui.layout.Layout(
            content = {
                Text(host.label, color = p.text, fontSize = 14.sp, fontWeight = FontWeight.Medium, maxLines = 1, overflow = TextOverflow.Ellipsis)
                Text(
                    text = detail,
                    color = when {
                        dead -> p.danger
                        reconnecting > 0 -> p.warn
                        else -> p.textFaint
                    },
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
            val showDetail = status || labelFull + gap + detailPlaceable.width <= constraints.maxWidth
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
    type: (String) -> Unit,
    cursor: (Char) -> Unit,
) {
    val keys = KeyActions(ctrl, alt, onCtrl, onAlt, onFont, send, type, cursor)
    if (wrap) WideKeys(keys, keyWidth) else CompactKeys(keys, keyWidth)
}

/**
 * 所有按键的动作集中在一处,两种排布共用。
 *
 * 三条出口分开,是因为**粘滞的 Ctrl / Alt 对三种键的含义不一样**:
 * 普通字符要变成控制字符(Ctrl+c → 0x03),方向键要变成 `ESC[1;5A` 这种带参数的序列,
 * 而 Esc / Tab 这些本来就是控制字节的,Ctrl 对它们没有额外含义、Alt 则是加个 ESC 前缀。
 *
 * 原来只有一条 `send`,直接把字节丢给 `sendRaw` —— 粘滞键**既不生效也不清除**:
 * 点了 Ctrl 再点 ↑,Ctrl 还亮着;接着在软键盘上打个 `c`,发出去的就成了 `^C`,
 * 正在跑的命令当场被杀。三条出口现在都在发完之后把粘滞键收掉(和实体键盘一致:
 * 修饰键作用于下一颗键,按完就松)。
 */
private class KeyActions(
    val ctrl: Boolean,
    val alt: Boolean,
    val onCtrl: () -> Unit,
    val onAlt: () -> Unit,
    val onFont: (Float) -> Unit,
    /** 已经是控制字节的键(Esc、Tab、^C、⌫、回车)。 */
    val send: (ByteArray) -> Unit,
    /** 普通字符(`|`、`/`、`-`、`~`):按粘滞键变形,和软键盘打字走同一条路。 */
    val type: (String) -> Unit,
    /** 方向键:按 DECCKM 和粘滞键编码。 */
    val cursor: (Char) -> Unit,
) {
    fun bytes(vararg b: Int) = send(ByteArray(b.size) { b[it].toByte() })
    fun text(t: String) = type(t)
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
                { KeyCap("↑", cell, repeatable = true) { k.cursor('A') } },
                { KeyCap("⌫", cell, repeatable = true) { k.bytes(0x7F) } },
            )
            KeyCap(stringResource(R.string.term_key_enter), key, emphasis = true, icon = XIcons.Return) { k.bytes(13) }
        }
        Row(horizontalArrangement = Arrangement.spacedBy(KeyGap)) {
            KeyCap("Ctrl", key, active = k.ctrl, onPress = k.onCtrl)
            KeyCap("⋯", key, active = more) { more = !more }
            Flip(
                { KeyCap("←", cell, repeatable = true) { k.cursor('D') } },
                { KeyCap("^L", cell) { k.bytes(12) } },
            )
            Flip(
                { KeyCap("↓", cell, repeatable = true) { k.cursor('B') } },
                { KeyCap("|", cell) { k.text("|") } },
            )
            Flip(
                { KeyCap("→", cell, repeatable = true) { k.cursor('C') } },
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
            KeyCap("↑", key, repeatable = true) { k.cursor('A') }
            KeyCap(stringResource(R.string.term_key_enter), key, emphasis = true, icon = XIcons.Return) { k.bytes(13) }
        }
        Row(horizontalArrangement = Arrangement.spacedBy(KeyGap)) {
            KeyCap("Ctrl", key, active = k.ctrl, onPress = k.onCtrl)
            KeyCap("Alt", key, active = k.alt, onPress = k.onAlt)
            KeyCap("|", key) { k.text("|") }
            KeyCap("/", key) { k.text("/") }
            KeyCap("-", key) { k.text("-") }
            KeyCap("~", key) { k.text("~") }
            KeyCap("←", key, repeatable = true) { k.cursor('D') }
            KeyCap("↓", key, repeatable = true) { k.cursor('B') }
            KeyCap("→", key, repeatable = true) { k.cursor('C') }
        }
    }
}

/**
 * 语音输入(长按空格)的结果,输入法会在最前面补一个逗号 —— 真机日志里组字一开始就是
 * `哨兵 + "，" + 文字`,组字起点正好贴着哨兵。它看到光标前有个(零宽的)字符,就当成"接着上一句"。
 * 输入框里必须留着哨兵(清空会被当成退格),所以在提交时认出来丢掉。
 *
 * 只认:组字起点紧贴哨兵、第一个字符是逗号、后面还有内容。单独敲一个逗号(只有一个字符)不受影响。
 */
internal fun startsWithVoiceComma(text: String, compositionStart: Int?, sentinelLength: Int): Boolean =
    compositionStart == sentinelLength &&
        text.length > sentinelLength + 1 &&
        text[sentinelLength] in VOICE_COMMAS

/** 提交的文字以输入法补的逗号开头(且后面还有字)时,去掉它。 */
internal fun dropVoiceComma(committed: String, voiceComma: Boolean): String =
    if (voiceComma && committed.length > 1 && committed[0] in VOICE_COMMAS) committed.substring(1) else committed

private const val VOICE_COMMAS = "，,"

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
    /** 当前这段组字是不是输入法自己在最前面补了个逗号(语音输入),见 [startsWithVoiceComma]。 */
    var voiceComma by remember { mutableStateOf(false) }
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
                val committed = dropVoiceComma(
                    SENTINELS.fold(text) { acc, mark -> acc.removePrefix(mark) },
                    voiceComma,
                )
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
            voiceComma = startsWithVoiceComma(text, value.composition?.start, SENTINELS[sentinel].length)
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
    /**
     * 当前这一帧。**只在画的时候读**(画布的 lambda 里),不在组合期读:
     * 这样新的一帧到了只会触发重画,不会把这一屏重组一遍。
     */
    frame: () -> TerminalFrame,
    fontSize: Float,
    onGridSize: (cols: Int, rows: Int, cellWidthPx: Int, cellHeightPx: Int) -> Unit,
    onScroll: (lines: Int, col: Int, row: Int) -> Unit,
    /**
     * 松手后能不能接着惯性滑。翻本地回滚缓冲可以;**全屏程序(less / vim 这些)不行** ——
     * 那时滚动是发方向键或鼠标事件给远端,惯性会一口气发几十下,光标窜出去老远。
     */
    canFling: Boolean,
    onSecondaryClick: (Offset) -> Unit,
    /** 选区落在视口里的部分(只用来画,同样只在画的时候读);选区本身在核心里。 */
    selection: () -> TermSelection?,
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
    // 英文按用户选的终端字体,中文思源黑体,画线字符 Iosevka;格子一律按 Iosevka 量(见 TerminalFont)。
    val paints = rememberTermPaints(TerminalFontChoice.current, fontSize)
    val cell = paints.cellWidth to paints.cellHeight

    val scrollBy by rememberUpdatedState(onScroll)
    val secondary by rememberUpdatedState(onSecondaryClick)
    val selectStart by rememberUpdatedState(onSelectStart)
    val selectUpdate by rememberUpdatedState(onSelectUpdate)
    val selectClear by rememberUpdatedState(onSelectClear)
    val selectDone by rememberUpdatedState(onSelectionDone)
    val released by rememberUpdatedState(onMouseReleased)
    val haptic = LocalHapticFeedback.current
    // 手指离开之后的惯性翻历史(见下面的 dragModifier)。新的触摸一来就取消。
    val scope = rememberCoroutineScope()
    val fling = remember { mutableStateOf<Job?>(null) }
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
        // 上下界都要夹。只夹下界的话,手指拖出画布(滑到下面的按键面板上)时,
        // 算出来的行号超出 PTY 的范围,鼠标事件就把一个不存在的位置报给了服务器。
        fun cellAt(position: Offset) =
            (position.x / cell.first).toInt().coerceIn(0, (cols - 1).coerceAtLeast(0)) to
                (position.y / cell.second).toInt().coerceIn(0, (gridRows - 1).coerceAtLeast(0))
        fun gridAt(position: Offset): GridCell {
            val col = (position.x / cell.first).toInt().coerceIn(0, cols - 1)
            return GridCell(
                row = (position.y / cell.second).toInt().coerceIn(0, gridRows - 1),
                col = col,
                rightHalf = position.x - col * cell.first >= cell.first / 2f,
            )
        }
        fun sameCell(a: GridCell, b: GridCell) = a.row == b.row && a.col == b.col
        // `canFling` **必须进 key**:手势协程一旦起来就一直用起来时捕获的那个值。
        // 在 bash 里滑一次(canFling=true),再进 less / htop(canFling 变 false),
        // 协程没有重起,还当自己能惯性 —— 松手之后一口气往服务器发几十个方向键 / 鼠标事件,
        // less 猛跳、vim 里光标乱走。这一屏别的回调都走了 rememberUpdatedState,唯独漏了它。
        val dragModifier = Modifier.pointerInput(cell, cols, gridRows, canFling) {
            // 连击判定跨手势,记在手势外面:双击选词,三击选整行。
            var lastClickAt = 0L
            var lastClickCell: GridCell? = null
            var clicks = 0
            awaitEachGesture {
                val down = awaitFirstDown(requireUnconsumed = false)
                // 一按下就停住上一次的惯性:手指按住了,画面就该跟手指走。
                fling.value?.cancel()
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
                // 松手之后要接着滑一段(惯性):记下手指的速度。
                val tracker = VelocityTracker()
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
                    if (!change.pressed) {
                        // 松手:按离手时的速度接着滑,像列表一样惯性减速,不是"手一抬就定住"。
                        val velocity = tracker.calculateVelocity().y
                        if (canFling && kotlin.math.abs(velocity) > 80f) {
                            val at = cellAt(change.position)
                            fling.value = scope.launch {
                                var rest = carry
                                var last = 0f
                                AnimationState(0f, velocity).animateDecay(exponentialDecay(frictionMultiplier = 1.6f)) {
                                    rest += value - last
                                    last = value
                                    val lines = (rest / cell.second).toInt()
                                    if (lines != 0) {
                                        rest -= lines * cell.second
                                        scrollBy(lines, at.first, at.second)
                                    }
                                }
                            }
                        }
                        break
                    }
                    val step = change.positionChange()
                    tracker.addPosition(change.uptimeMillis, change.position)
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
            // 这两行是**整屏唯一**读当前帧的地方:读在画的时候,换帧就只重画这块画布。
            val now = frame()
            val cursor = now.cursor
            val rows = now.rows
            for (r in rows.indices) {
                if (r >= gridRows) break
                val y = r * ch
                val runs = rows[r].runs
                for (i in runs.indices) drawRun(runs[i], y, paints, p.termFg, p.termBg)
            }
            // 选区:半透明的强调色盖在字上,和系统文本选择一个样子。
            selection()?.let { sel ->
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
/**
 * 终端画字用的画笔。**每帧要画几千个格子,这里一个对象都不新建**:
 * 画笔就这几支(英文 / 英文粗 / 中文 / 符号),画的时候只改颜色和下划线之类的开关。
 *
 * 原来每个格子都走 `TextMeasurer.measure` 拿一份排版结果再画:一屏中文加制表符就是上千次测量 + 上千个
 * 临时对象,滚 Codex 那种长历史时每帧 23~29ms(120Hz 的预算是 8ms),手感就是"顿"。
 * 改成直接用 Paint 往画布上写,测量只在换字体 / 字号时做一次。
 *
 * 格子的大小和基线一律按 Iosevka(符号那支笔)量:换字体只换字形,行高、列宽、中文位置都不动。
 */
internal class TermPaints(
    val font: TerminalFont,
    /** 英文(用户选的终端字体)。 */
    private val latin: android.graphics.Typeface?,
    private val latinBold: android.graphics.Typeface?,
    /** 制表符、方块、箭头这些要和格子严丝合缝的字:Iosevka。 */
    private val symbol: android.graphics.Typeface?,
    private val symbolBold: android.graphics.Typeface?,
    /** 宽字符(中日韩,占两格):思源黑体。 */
    private val cjk: android.graphics.Typeface?,
    sizePx: Float,
) {
    private val paint = android.graphics.Paint(
        android.graphics.Paint.ANTI_ALIAS_FLAG or android.graphics.Paint.SUBPIXEL_TEXT_FLAG,
    ).apply { textSize = sizePx }

    /** 拼可打印 ASCII 的暂存(只在画面线程上用,不新建字符串)。 */
    private val chunk = StringBuilder(256)

    /** 拼连续汉字的暂存(同上)。 */
    private val wide = StringBuilder(128)

    val cellWidth: Float
    val cellHeight: Float
    /** 格子的基线离格子顶部多远:所有字(不管哪套字体)都对齐到这条线上。 */
    val baseline: Float

    init {
        paint.typeface = symbol
        // 格宽用 100 个 M 的总宽度来算:单个 M 的宽度带小数,一行 80 列累积下来就是十几像素的漂移。
        cellWidth = (paint.measureText("M".repeat(100)) / 100f).coerceAtLeast(1f)
        val metrics = paint.fontMetrics
        cellHeight = kotlin.math.ceil(metrics.descent - metrics.ascent).coerceAtLeast(1f)
        baseline = -metrics.ascent
    }

    /** 这套字体的英文步进和格子对得上吗(对不上就一个字一个字摆,不能整串画)。 */
    private val latinFits: Boolean = run {
        paint.typeface = latin
        kotlin.math.abs(paint.measureText("M".repeat(100)) / 100f - cellWidth) < 0.05f
    }

    /**
     * 中文字体一个字是不是正好两格。思源黑体是 1em = 正好两格,所以**一串汉字可以一次画完** ——
     * 不用像原来那样每个字量一次宽度再单独摆一次(一屏中文就是一千多次量 + 一千多次绘制,
     * 滚长历史时这是最后剩下的大头)。量不准的字体(极少见)才退回逐字摆。
     */
    private val cjkFits: Boolean = cjk != null && run {
        paint.typeface = cjk
        kotlin.math.abs(paint.measureText("中".repeat(50)) / 50f - cellWidth * 2f) < 0.05f
    }

    private fun ready(
        typeface: android.graphics.Typeface?,
        color: Int,
        bold: Boolean,
        italic: Boolean,
        underline: Boolean,
        strike: Boolean,
        fakeBold: Boolean,
    ): android.graphics.Paint {
        paint.typeface = typeface
        paint.color = color
        paint.isFakeBoldText = fakeBold && bold
        paint.textSkewX = if (italic) -0.25f else 0f
        paint.isUnderlineText = underline
        paint.isStrikeThruText = strike
        return paint
    }

    /**
     * 画一段样式相同的单元格。每个字落在自己的列上(`col × 格宽`):可打印 ASCII 连成一串一起画,
     * 其它字符(中文、制表符、emoji……)单独摆进它占的格子里居中,太宽就压进格子,绝不挤到下一格。
     */
    fun draw(
        canvas: android.graphics.Canvas,
        run: StyledRun,
        y: Float,
        fg: Int,
        bg: Int?,
        bold: Boolean,
        italic: Boolean,
        underline: Boolean,
        strike: Boolean,
    ) {
        val cells = run.cells
        val col0 = run.col.toInt()
        if (bg != null) {
            var count = 1
            for (i in cells.indices) if (cells[i] == CELL_SEPARATOR) count++
            paint.typeface = null
            paint.color = bg
            paint.isUnderlineText = false
            paint.isStrikeThruText = false
            canvas.drawRect(col0 * cellWidth, y, (col0 + count) * cellWidth, y + cellHeight, paint)
        }
        val textY = y + baseline
        val latinFace = if (bold) latinBold ?: latin else latin
        val symbolFace = if (bold) symbolBold ?: symbol else symbol
        val latinBoldFake = latinBold == null
        val symbolBoldFake = symbolBold == null

        var chunkCol = col0
        fun flush() {
            if (chunk.isEmpty()) return
            val p = ready(latinFace, fg, bold, italic, underline, strike, latinBoldFake)
            if (latinFits) {
                canvas.drawText(chunk, 0, chunk.length, chunkCol * cellWidth, textY, p)
            } else {
                // 步进和格子对不上的字体:一个字一个字摆,免得一行下来越飘越远。
                for (i in 0 until chunk.length) {
                    canvas.drawText(chunk, i, i + 1, (chunkCol + i) * cellWidth, textY, p)
                }
            }
            chunk.setLength(0)
        }
        var wideCol = col0
        fun flushWide() {
            if (wide.isEmpty()) return
            val p = ready(cjk, fg, bold, italic, underline, strike, fakeBold = true)
            canvas.drawText(wide, 0, wide.length, wideCol * cellWidth, textY, p)
            wide.setLength(0)
        }

        var pos = 0
        var col = col0
        val length = cells.length
        while (pos <= length) {
            var end = cells.indexOf(CELL_SEPARATOR, pos)
            if (end < 0) end = length
            val len = end - pos
            when {
                // 可打印 ASCII:攒起来一起画。
                len == 1 && cells[pos].code in 0x20..0x7E -> {
                    flushWide()
                    if (chunk.isEmpty()) chunkCol = col
                    chunk.append(cells[pos])
                    col++
                    pos = end + 1
                }
                len == 0 -> {
                    // 宽字符后面的占位格(正常会在下面被一起吃掉;落单时只是让出一格)。
                    flush()
                    flushWide()
                    col++
                    pos = end + 1
                }
                else -> {
                    flush()
                    // 后面紧跟一个空格子 = 这个字占两格。
                    var span = 1
                    var next = pos
                    if (end < length) {
                        var nextEnd = cells.indexOf(CELL_SEPARATOR, end + 1)
                        if (nextEnd < 0) nextEnd = length
                        if (nextEnd == end + 1) {
                            span = 2
                            next = nextEnd
                        }
                    }
                    val isWide = span == 2
                    // 连续的汉字(思源黑体里正好两格宽)攒成一串一次画完,见 [cjkFits]。
                    if (isWide && cjkFits && len == 1 && isHan(cells[pos])) {
                        if (wide.isEmpty()) wideCol = col
                        wide.append(cells[pos])
                        col += 2
                        pos = next + 1
                        if (next >= length) break
                        continue
                    }
                    flushWide()
                    val face = when {
                        isWide && cjk != null -> cjk
                        isWide -> latinFace
                        font.draws(cells, pos, end) -> latinFace
                        else -> symbolFace
                    }
                    val fake = if (face === cjk) true else if (face === symbolFace) symbolBoldFake else latinBoldFake
                    val p = ready(face, fg, bold, italic, underline, strike, fake)
                    val slot = span * cellWidth
                    val width = p.measureText(cells, pos, end)
                    val x = col * cellWidth
                    if (width <= slot) {
                        canvas.drawText(cells, pos, end, x + (slot - width) / 2f, textY, p)
                    } else {
                        // 比格子宽(emoji、个别字体的全角符号):压进格子,不许挤到下一格。
                        canvas.save()
                        canvas.scale(slot / width, 1f, x, y)
                        canvas.drawText(cells, pos, end, x, textY, p)
                        canvas.restore()
                    }
                    col += span
                    pos = (if (span == 2) next else end) + 1
                }
            }
            if (end >= length) break
        }
        flush()
        flushWide()
    }
}

/**
 * 这个字是不是「一定占满两格」的汉字类字符(中日韩、假名、谚文、全角标点)。
 * 只有这些才敢连成一串一次画:它们在思源黑体里一律 1em。emoji、箭头之类宽度不一定,仍旧一个个摆。
 */
private fun isHan(c: Char): Boolean = when (c.code) {
    in 0x2E80..0x303E, in 0x3041..0x33FF, in 0x3400..0x4DBF, in 0x4E00..0x9FFF,
    in 0xA000..0xA4CF, in 0xAC00..0xD7A3, in 0xF900..0xFAFF, in 0xFE30..0xFE4F,
    in 0xFF01..0xFF60, in 0xFFE0..0xFFE6,
    -> true
    else -> false
}

/** 单元格之间的分隔符(见 Rust 的 `Term::rows`)。 */
private const val CELL_SEPARATOR = '\u001F'

@Composable
internal fun rememberTermPaints(font: TerminalFont, fontSize: Float): TermPaints {
    val sizePx = with(LocalDensity.current) { fontSize.sp.toPx() }
    return remember(font, sizePx) {
        TermPaints(
            font = font,
            latin = XsshFonts.typeface(font.regular),
            latinBold = XsshFonts.typeface(font.bold),
            symbol = XsshFonts.typeface(R.font.xssh_mono_regular),
            symbolBold = XsshFonts.typeface(R.font.xssh_mono_bold),
            cjk = XsshFonts.cjkTypeface,
            sizePx = sizePx,
        )
    }
}

/** 画一行里样式相同的一段(颜色、反白、暗淡、粗斜体、下划线在这里算好,画笔那边只管写字)。 */
internal fun DrawScope.drawRun(
    run: StyledRun,
    y: Float,
    paints: TermPaints,
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
    paints.draw(
        canvas = drawContext.canvas.nativeCanvas,
        run = run,
        y = y,
        fg = fg.toArgb(),
        bg = bg?.toArgb(),
        bold = flags and STYLE_BOLD != 0,
        italic = flags and STYLE_ITALIC != 0,
        underline = flags and STYLE_UNDERLINE != 0,
        strike = flags and STYLE_STRIKE != 0,
    )
}
