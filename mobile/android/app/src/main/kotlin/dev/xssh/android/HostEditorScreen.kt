package dev.xssh.android

import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.isImeVisible
import com.kyant.backdrop.backdrops.rememberLayerBackdrop
import com.kyant.backdrop.backdrops.layerBackdrop
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.WindowInsetsSides
import androidx.compose.foundation.layout.asPaddingValues
import androidx.compose.foundation.layout.calculateStartPadding
import androidx.compose.foundation.layout.only
import androidx.compose.foundation.layout.safeDrawing
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.foundation.focusable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.input.key.isCtrlPressed
import androidx.compose.ui.input.key.onInterceptKeyBeforeSoftKeyboard
import androidx.compose.ui.input.key.onPreviewKeyEvent
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalLayoutDirection
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.heightIn
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import java.util.UUID
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import androidx.compose.foundation.layout.offset

/**
 * 新建 / 编辑主机。
 *
 * 排法和其余界面一致:标题是内容不是栏,操作在右边缘轨道,字段用分组行式列表。
 * 展开的内屏不把表单拉成一条 860dp 宽的长行,而是**按折痕分成两栏**:
 * 左边是连到哪台,右边是密码 —— 一眼能看完,也不用来回滚。
 *
 * 登录方式:密码,或者导入的私钥(系统文件选择器选文件,平板上也能直接把文件拖进浮层)。
 * 私钥内容经 Android 密钥库加密存在应用里,连接时只在内存里解密。
 * 页面上不写操作说明、存储说明、"后续版本"之类的话 —— 用户都知道怎么用。
 */
@Composable
fun HostEditorScreen(
    initial: Host?,
    onBack: () -> Unit,
    onSave: (Host) -> Unit,
    onDelete: ((Host) -> Unit)? = null,
) {
    val p = LocalXssh.current
    val adaptive = LocalAdaptive.current

    val draft = remember { HostDraft(initial) }
    var name by draft::name
    var address by draft::address
    var port by draft::port
    var username by draft::username
    val error = draft.error
    val scope = rememberCoroutineScope()
    var keyMessage by remember { mutableStateOf<String?>(null) }
    val importKey = rememberKeyImporter(draft) { keyMessage = it }

    // 加了锁的主机在列表里读到的凭据是空的(没解锁读不出来)。进这一页就先解锁补上,
    // 否则密码格亮着空白 —— 用户以为没存过,顺手填一个就把它覆盖了。
    val context = LocalContext.current
    LaunchedEffect(initial?.id) {
        val source = initial ?: return@LaunchedEffect
        if (source.lockedPassword == null && source.lockedKeyData == null &&
            source.lockedKeyPassphrase == null
        ) {
            return@LaunchedEffect
        }
        val unlocked = unlockCredentials(context, source) ?: run {
            // 没解开(用户取消了、或者验证失败)。密码格这时是空的,而用户可能
            // 顺手填一个就保存 —— 那会把一条他还没看见的密码覆盖掉。先说清楚。
            draft.error = "没能解锁已保存的凭据,现在看不到原来的密码。"
            return@LaunchedEffect
        }
        draft.fillUnlocked(unlocked)
    }

    fun save() {
        // 用私钥登录时要验一次口令(解私钥要几百毫秒)、加锁开关要用密钥库并可能弹一次
        // 解锁,都放到 IO 之外由 buildHostForSave 自己安排;这里只管收结果。
        val activity = hostActivity(context)
        if (activity == null) {
            draft.error = "保存失败:找不到当前页面。"
            return
        }
        scope.launch {
            val host = buildHostForSave(activity, draft)
            host?.let(onSave)
        }
    }

    val target: @Composable () -> Unit = {
        FormGroup {
            FormField("名称", name, { name = it }, placeholder = "生产 Web")
            FormDivider()
            FormField(
                "地址",
                address,
                { address = it },
                placeholder = "192.168.1.10",
                mono = true,
                keyboard = KeyboardType.Uri,
                            asciiOnly = true,
            )
            FormDivider()
            FormField(
                "端口",
                port,
                { port = it.filter(Char::isDigit).take(5) },
                placeholder = "22",
                mono = true,
                keyboard = KeyboardType.Number,
                            asciiOnly = true,
            )
            FormDivider()
            // 用户名只会是英文:用 URI 类键盘,中文输入法会切到英文,不会把 root 组成拼音。
            FormField("用户名", username, { username = it }, placeholder = "root", mono = true, keyboard = KeyboardType.Uri, asciiOnly = true)
        }
    }

    val credentials: @Composable () -> Unit = {
        CredentialFields(
            draft = draft,
            keyMessage = keyMessage,
            onImport = importKey,
            onDone = { save() },
            onMessage = { keyMessage = it },
        )
    }

    val danger: @Composable () -> Unit = {
        if (initial != null && onDelete != null) {
            // 点两下才删,和主机页左滑、详情栏一致。
            var confirming by remember { mutableStateOf(false) }
            FormGroup {
                FormAction(if (confirming) "确认删除这台主机" else "删除这台主机", danger = true) {
                    if (confirming) onDelete(initial) else confirming = true
                }
            }
        }
    }

    // 整个页面量一次,和主机页同一条式子、同样量整个窗口。
    // 分组表单:浅色是浅灰底 + 白色分组块,深色是纯黑底 + 深灰分组块(iOS 设置页那种)。
    val backdrop = rememberLayerBackdrop()
    // 折叠屏:‹ ✓ 在右侧轨道;直板机:顶栏左边 ‹、右边 ✓(见 Chrome)。
    val topBar = LocalChrome.current == Chrome.TopBar
    // 实体键盘:Ctrl+S 保存、Esc 返回(不保存)。
    val hardKeyboard = LocalConfiguration.current.hasHardKeyboard()
    val pageFocus = remember { FocusRequester() }
    LaunchedEffect(hardKeyboard) {
        if (hardKeyboard) runCatching { pageFocus.requestFocus() }
    }
    val onKey: (androidx.compose.ui.input.key.KeyEvent) -> Boolean = handler@{ event ->
        val e = event.nativeKeyEvent
        if (e.action != android.view.KeyEvent.ACTION_DOWN) return@handler false
        when {
            e.isCtrlPressed && e.keyCode == android.view.KeyEvent.KEYCODE_S -> save()
            e.keyCode == android.view.KeyEvent.KEYCODE_ESCAPE -> onBack()
            else -> return@handler false
        }
        true
    }
    BoxWithConstraints(
        Modifier
            .fillMaxSize()
            .background(p.groupedBg)
            // Ctrl 组合键要赶在输入法前面拿:中文输入法开着时它会先吃掉按键(实测 Ctrl+S 到不了页面)。
            // 只拦 Ctrl —— 组词从来不用 Ctrl;Esc 留给输入法取消组词,它不要才轮到页面返回。
            .onInterceptKeyBeforeSoftKeyboard { if (it.isCtrlPressed) onKey(it) else false }
            .onPreviewKeyEvent(onKey)
            .focusRequester(pageFocus)
            .focusable(),
    ) {
        val window = maxWidth
        val twoPane = window >= 840.dp || (adaptive.bookFold != null && window >= 600.dp)
        // 左侧安全区(横屏时挖孔可能在左边,约 51dp)单独拿出来,不放进整页的 padding。
        val startInset = stableSafeDrawing().asPaddingValues()
            .calculateStartPadding(LocalLayoutDirection.current)

        Column(
            Modifier
                .fillMaxSize()
                // 玻璃按钮背后的内容;先垫一层底色,录下来的画面才不是透明的。
                .layerBackdrop(backdrop)
                .background(p.groupedBg)
                // safeDrawing 含输入法 inset:键盘一弹,可滚动区域缩到键盘上方,
                // 聚焦的那一行会被自动滚进视野。(轨道也随键盘升上来,见 EdgeRail。)
                //
                // **左侧不在这里加**:折痕位置是窗口坐标,整页先右移 51dp 的话,
                // 左栏宽度仍按折痕算,分界就落到折痕右边 51dp —— 表单面板跨在折痕上。
                // 主机页早就是这么处理的(内边距放进各栏自己加),这里补上。
                .windowInsetsPadding(
                    stableSafeDrawing().only(WindowInsetsSides.Vertical + WindowInsetsSides.End),
                )
                .bounce()
                .verticalScroll(rememberScrollState())
                // 直板机按钮在顶栏,标题从顶栏下面开始。
                .padding(top = if (topBar) TopBarHeight else 0.dp),
        ) {
          // 表单铺满到右边缘,‹ ✓ 悬浮在右下角。键盘弹起时按钮跟着升到键盘上方,正好压在
          // "正在输入的那一行"右边(取值是右对齐的)—— 输入框聚焦时多滚一截按钮的高度,落到按钮上面。
          CompositionLocalProvider(LocalFieldClearance provides if (topBar) 0.dp else RailClearance) {
            Column(
                // 标题线(见 Components 的版心说明):盒子线 + TitlePad。
                Modifier.padding(start = startInset + Gutter + TitlePad, end = railSide(), top = Gutter),
            ) {
                Text(
                    if (initial == null) "新建主机" else "编辑主机",
                    Modifier.offset(x = -TitleOptical),
                    color = p.text,
                    fontSize = 34.sp,
                    fontWeight = FontWeight.Bold,
                )
                // 标题下面只在出错时说话(比如地址没填),平时不放操作说明。
                error?.let {
                    Spacer(Modifier.height(2.dp))
                    Text(it, color = p.danger, fontSize = 12.5.sp)
                }
            }
            Spacer(Modifier.height(GapItem + 4.dp))

            if (twoPane) {
                // 与主机页一样关于折痕镜像:左栏止于折痕前 32dp,右栏从折痕后 32dp 起。
                // 分界用和主机页**完全相同**的式子(量整窗):原来这里传的是减掉轨道后的宽度,
                // 没有折痕的平板上按 38% 兜底时两页切在不同位置,从主机页点进来两栏会跳一下。
                val left = adaptive.listPaneWidth(window).coerceAtMost(window - 280.dp)
                // 和主机页同一条规矩:右栏让开了轨道,左栏就收到同样宽,别一边长一边短(见 creaseGapFor)。
                val rightContent = ((window - left) - Gutter * 2 - railSide())
                    .coerceAtMost(PageMaxWidth + Gutter * 3)
                val leftEnd = creaseGapFor(left, startInset + Gutter, rightContent)
                Row(Modifier.fillMaxWidth()) {
                    Column(
                        Modifier.width(left).padding(start = startInset + Gutter, end = leftEnd),
                        verticalArrangement = Arrangement.spacedBy(20.dp),
                    ) { target() }
                    // 右栏也限宽:平板横屏右栏有 900dp,"标签在左、取值在右"的一行会横跨整块屏幕。
                    Column(Modifier.weight(1f)) {
                        Column(
                            Modifier
                                .widthIn(max = PageMaxWidth + Gutter * 3)
                                .padding(start = Gutter * 2, end = railSide()),
                            verticalArrangement = Arrangement.spacedBy(20.dp),
                        ) {
                            credentials()
                            danger()
                        }
                    }
                }
            } else {
                Column(
                    Modifier
                        // 一行里标签在左、取值在右,行太宽的话视线要横跨半块屏幕 —— 所以限宽。
                        // 但**不能居中**:多出来的宽度左右一分,盒子就不在盒子线上了。
                        // 限宽之后靠左,盒子永远在 16dp、盒内文字永远在 32dp(版心)。
                        .padding(start = startInset)
                        .widthIn(max = PageMaxWidth + Gutter * 2)
                        .fillMaxWidth()
                        .padding(start = Gutter, end = railSide()),
                    verticalArrangement = Arrangement.spacedBy(20.dp),
                ) {
                    target()
                    credentials()
                    danger()
                }
            }
            // 最后一组要能滚到右下角悬浮的按钮上面。
            Spacer(Modifier.height(if (topBar) 40.dp else RailClearance))
          }
        }

        if (topBar) {
            TopBar(
                Modifier.align(Alignment.TopCenter),
                start = { GlassButton(XIcons.Back, "返回") { onBack() } },
                end = {
                    GlassGroup { ThemeGlassItem() }
                    GlassButton(XIcons.Check, "保存") { save() }
                },
            )
        } else {
            // 和主机页的 ⌕ ＋ 落在同一对位置上:点 ＋ 进来,按钮原地换成 ‹ ✓,一像素不动。
            CompositionLocalProvider(LocalBackdrop provides backdrop) {
                EdgeRail(Modifier.align(Alignment.BottomEnd)) {
                    // 外观在最上面(每一页都有,位置一样);‹ ✓ 的落点一像素不动。
                    GlassGroup { ThemeGlassItem() }
                    GlassButton(XIcons.Back, "返回") { onBack() }
                    // 和 ‹ 同一种样式:无色玻璃、正文色图标。
                    GlassButton(XIcons.Check, "保存") { save() }
                }
            }
        }
    }
}

/**
 * 新建 / 编辑主机的草稿:手机的整页编辑和平板的浮层共用同一套字段、校验和保存规则。
 */
class HostDraft(private val initial: Host?) {
    var name by mutableStateOf(initial?.name ?: "")
    var address by mutableStateOf(initial?.address ?: "")
    var port by mutableStateOf((initial?.port ?: 22).toString())
    var username by mutableStateOf(initial?.username ?: "")
    var password by mutableStateOf(initial?.password ?: "")
    var auth by mutableStateOf(initial?.auth ?: AuthKind.PASSWORD)
    var keyData by mutableStateOf(initial?.keyData ?: "")
    var keyName by mutableStateOf(initial?.keyName ?: "")
    var keyPublicFingerprint by mutableStateOf(initial?.keyPublicFingerprint ?: "")
    var keyPassphrase by mutableStateOf(initial?.keyPassphrase ?: "")
    /** 这把私钥带口令(口令那一格要露出来)。 */
    var keyLocked by mutableStateOf((initial?.keyPassphrase ?: "").isNotEmpty())
    var error by mutableStateOf<String?>(null)

    var lockSecrets by mutableStateOf(initial?.lockSecrets ?: false)

    /** 进来时这台主机是不是已经加了锁 —— 和 [lockSecrets] 一比就知道要不要重新加密。 */
    val originalLocked: Boolean = initial?.lockSecrets ?: false

    /** 老数据 / 调试用的私钥文件路径(界面上不出现,保存时原样留下)。 */
    private val keyPath = initial?.keyPath.orEmpty()

    val isNew: Boolean get() = initial == null

    /** 有私钥可用(导入过的,或者老数据里的私钥文件)。 */
    val hasKey: Boolean get() = keyData.isNotEmpty() || keyPath.isNotEmpty()

    /** 改过没有 —— 平板浮层点外面关闭时,改过的内容不能悄悄丢掉。 */
    val dirty: Boolean
        get() = name != (initial?.name ?: "") ||
            address != (initial?.address ?: "") ||
            port != (initial?.port ?: 22).toString() ||
            username != (initial?.username ?: "") ||
            // 凭据比的是**解锁前**那份快照,不是 initial 上的明文。
            // 加锁主机一进编辑页就会把明文灌进 draft,拿 initial(明文为空)去比,
            // 什么都没做也会判成"改过" —— 关浮层时白弹一次"放弃未保存的修改?"。
            password != passwordAtOpen ||
            auth != (initial?.auth ?: AuthKind.PASSWORD) ||
            keyData != keyDataAtOpen ||
            keyPassphrase != passphraseAtOpen

    /**
     * 打开这一页时三条凭据的值。加锁主机解锁后 draft 里会有明文,
     * 把它记在这里,`dirty` 与"用户到底动过没有"才一致。
     */
    var passwordAtOpen = initial?.password ?: ""
        private set
    var keyDataAtOpen = initial?.keyData ?: ""
        private set
    var passphraseAtOpen = initial?.keyPassphrase ?: ""
        private set

    /** 解锁之后填明文:同时把"原始值"对齐过去,这样刚解锁不算改过。 */
    fun fillUnlocked(unlocked: Host) {
        password = unlocked.password
        keyData = unlocked.keyData
        keyPassphrase = unlocked.keyPassphrase
        passwordAtOpen = unlocked.password
        keyDataAtOpen = unlocked.keyData
        passphraseAtOpen = unlocked.keyPassphrase
        keyLocked = unlocked.keyPassphrase.isNotEmpty()
    }

    /**
     * 导入一把私钥。返回要给用户看的一句话:null = 成功;带口令时返回提示并露出口令格
     * (私钥先收下,保存时再验口令)。在 IO 线程调用 —— 带口令的私钥解一次要几百毫秒。
     */
    fun importKey(text: String, fileName: String): String? {
        val pem = text.trim()
        return try {
            val info = uniffi.xssh_ffi.inspectKey(pem, keyPassphrase.ifEmpty { null })
            keyData = pem
            keyName = fileName
            keyPublicFingerprint = info.fingerprint
            keyLocked = keyPassphrase.isNotEmpty()
            auth = AuthKind.KEY
            error = null
            null
        } catch (e: uniffi.xssh_ffi.FfiException.KeyEncrypted) {
            keyData = pem
            keyName = fileName
            keyPublicFingerprint = ""
            keyLocked = true
            auth = AuthKind.KEY
            "这把私钥有口令"
        } catch (e: Exception) {
            "不是可用的私钥文件"
        }
    }

    /**
     * 在本机生成一把 ed25519 密钥并用上它。返回公钥一行(贴进服务器的 authorized_keys);失败返回 null。
     * 不加口令:私钥本身经密钥库加密存在应用里,口令只会让每次连接多一步。在 IO 线程调用。
     */
    fun generateKey(): String? = runCatching {
        val comment = "x-ssh@" + android.os.Build.MODEL.replace(' ', '-')
        val key = uniffi.xssh_ffi.generateKey(comment, null)
        keyData = key.pem
        keyName = "本机生成 · ed25519"
        keyPublicFingerprint = key.info.fingerprint
        keyPassphrase = ""
        keyLocked = false
        auth = AuthKind.KEY
        error = null
        key.info.publicKey
    }.getOrNull()

    /** 公钥一行(贴进服务器的 authorized_keys 用);解不开时为 null。 */
    fun publicKey(): String? = runCatching {
        uniffi.xssh_ffi.inspectKey(keyData, keyPassphrase.ifEmpty { null }).publicKey
    }.getOrNull()

    /**
     * 校验并生成要保存的主机;不合法时写 [error] 并返回 null。
     * 用私钥登录时会验一次口令(解私钥要时间,在 IO 线程调用)。
     */
    fun build(): Host? {
        val newAddress = address.trim()
        if (newAddress.isEmpty()) {
            error = "地址不能为空"
            return null
        }
        if (auth == AuthKind.KEY) {
            if (!hasKey) {
                error = "还没有导入私钥"
                return null
            }
            // 带口令的私钥:保存前就验口令,填错当场说,而不是等到连接时才失败。
            if (keyData.isNotEmpty()) {
                try {
                    keyPublicFingerprint = uniffi.xssh_ffi.inspectKey(keyData, keyPassphrase.ifEmpty { null }).fingerprint
                } catch (e: uniffi.xssh_ffi.FfiException.KeyEncrypted) {
                    keyLocked = true
                    error = if (keyPassphrase.isEmpty()) "这把私钥有口令" else "私钥口令不对"
                    return null
                } catch (e: Exception) {
                    error = "私钥无法使用"
                    return null
                }
            }
        }
        error = null
        val newPort = (port.toIntOrNull() ?: 22).coerceIn(1, 65535)
        // 已信任的指纹绑在「地址:端口」上:改了目标就是另一台机器,旧指纹不能跟着走;
        // 没改就必须留下,否则编辑一下备注就把信任关系抹了。
        val sameEndpoint = initial != null && initial.address == newAddress && initial.port == newPort
        val key = auth == AuthKind.KEY
        return Host(
            id = initial?.id ?: UUID.randomUUID().toString(),
            name = name.trim(),
            address = newAddress,
            port = newPort,
            username = username.trim(),
            auth = auth,
            // 换成密码登录就不留私钥(反之亦然):没用的秘密不存。
            keyPath = if (key && keyData.isEmpty()) keyPath else "",
            keyFingerprint = if (sameEndpoint) initial.keyFingerprint else "",
            password = if (key) "" else password,
            keyData = if (key) keyData else "",
            keyPassphrase = if (key && keyLocked) keyPassphrase else "",
            keyName = if (key) keyName else "",
            keyPublicFingerprint = if (key) keyPublicFingerprint else "",
            lockSecrets = lockSecrets,
            // 没解锁就保存时,明文是空的 —— 把磁盘上那几条原样带过去,别覆盖成空。
            // (用户只是改个名字,不该顺手把密码弄丢。)
            lockedPassword = initial?.lockedPassword,
            lockedKeyData = initial?.lockedKeyData,
            lockedKeyPassphrase = initial?.lockedKeyPassphrase,
        )
    }
}

/** 私钥文件不会超过这个大小(4096 位 RSA 带口令也才 3KB 多);更大的多半选错了文件。 */
private const val MaxKeyBytes = 64 * 1024

/**
 * 校验草稿,再按「用生物识别解锁」开关的状态把凭据加密,交给调用方保存。在 IO 线程调用。
 *
 * 开关一变就得**重新加密一遍**才生效,而这一步要用密钥库,所以不能塞进纯校验的
 * [HostDraft.build]。任何一步失败都返回 null(草稿的 `error` 会写明原因),
 * 不会写出一条"一半加锁一半没锁"的记录 —— 那种记录下次连接时谁都读不出来。
 *
 * 打开开关时**要弹一次解锁**:要求认证的密钥拿来做加密同样需要先验过,
 * 否则 `init` 直接抛 `UserNotAuthenticatedException`。用户取消就当作失败。
 */
suspend fun buildHostForSave(activity: android.app.Activity, draft: HostDraft): Host? {
    // 加锁开关没能生效时,把它拨回原状:开关留在"开"而磁盘上是"没锁",
    // 用户以为锁上了 —— 界面必须说同一件事。
    fun fail(message: String) {
        draft.error = message
        draft.lockSecrets = draft.originalLocked
    }

    val host = withContext(Dispatchers.IO) { draft.build() } ?: return null
    val wantsLock = draft.lockSecrets
    val wasLocked = draft.originalLocked
    // 跟这道锁完全无关的一次保存(本来没锁、也没要开):什么都不用做。
    if (!wantsLock && !wasLocked) return host

    // **保存前一定要现验一次。**
    //
    // 那把要求认证的密钥只有几秒有效期(见 Secrets.AUTH_WINDOW_SECONDS),进编辑页时
    // 解的那一次早过期了 —— 不补验的话:
    //   - 关锁:`disableLock` 读不出旧密文,必然返回 null,永远是"没能关掉这道锁"。
    //   - 改加锁主机的密码:`HostStore.writeSecret` 里 `writeLocked` 抛异常被吞掉,
    //     退回写旧密文 —— 界面说保存成功,密码其实没变。
    // 只有"要动那把密钥"时才验:开锁而手里没有任何明文要封的话,建密钥本身不需要认证。
    val hasPlain = host.password.isNotEmpty() || host.keyData.isNotEmpty() ||
        host.keyPassphrase.isNotEmpty()
    val needsKey = if (wantsLock) hasPlain else true
    if (needsKey && !unlockForWrite(activity)) {
        fail(if (wantsLock) "没能打开这道锁,请重试。" else "没能关掉这道锁,请重试。")
        return null
    }
    // 开关状态没变(一直锁着,只是改了点别的):密文由 HostStore.save 按 `lockSecrets`
    // 重新封 —— 窗口刚验开,这一步这次会真的写进去。
    if (wantsLock == wasLocked) return host

    // 两条路都产出"三条密文",只是用的密钥不同;一律装回 Host 的 `locked*` 字段,
    // 明文字段不落盘(见 HostStore.save)。
    val sealed = if (wantsLock) {
        withContext(Dispatchers.IO) {
            Secrets.enableLock(listOf(host.password, host.keyData, host.keyPassphrase))
        }
    } else {
        withContext(Dispatchers.IO) {
            Secrets.disableLock(
                listOf(host.lockedPassword, host.lockedKeyData, host.lockedKeyPassphrase)
                    .map { it.orEmpty() },
            )
        }
    }
    if (sealed == null) {
        fail(if (wantsLock) "没能打开这道锁,请重试。" else "没能关掉这道锁,请重试。")
        return null
    }

    return host.copy(
        lockSecrets = wantsLock,
        password = "",
        keyData = "",
        keyPassphrase = "",
        // 这次没封出内容的条目,沿用原来那条密文 —— 不能一律写 null:
        // 那是"这条凭据没了"的意思,而这里可能只是这次用不到它。
        lockedPassword = sealed[0].ifEmpty { host.lockedPassword },
        lockedKeyData = sealed[1].ifEmpty { host.lockedKeyData },
        lockedKeyPassphrase = sealed[2].ifEmpty { host.lockedKeyPassphrase },
    )
}

/** 从系统文件选择器 / 拖放进来的文件里读私钥交给 [draft]。在 IO 线程调用。 */
fun importKeyFrom(context: android.content.Context, uri: android.net.Uri, draft: HostDraft): String? {
    val name = runCatching {
        context.contentResolver.query(uri, arrayOf(android.provider.OpenableColumns.DISPLAY_NAME), null, null, null)
            ?.use { if (it.moveToFirst()) it.getString(0) else null }
    }.getOrNull() ?: uri.lastPathSegment.orEmpty().substringAfterLast('/')
    val bytes = runCatching {
        context.contentResolver.openInputStream(uri)?.use { input ->
            val out = java.io.ByteArrayOutputStream()
            val buffer = ByteArray(8192)
            while (out.size() <= MaxKeyBytes) {
                val n = input.read(buffer)
                if (n < 0) break
                out.write(buffer, 0, n)
            }
            out.toByteArray()
        }
    }.getOrNull() ?: return "读不了这个文件"
    if (bytes.size > MaxKeyBytes) return "不是可用的私钥文件"
    return draft.importKey(String(bytes, Charsets.UTF_8), name)
}

/**
 * 打开系统文件选择器导入私钥。返回"点一下就选文件"的动作;结果(一句话或 null)交给 [onResult]。
 */
@Composable
fun rememberKeyImporter(draft: HostDraft, onResult: (String?) -> Unit): () -> Unit {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val launcher = rememberLauncherForActivityResult(ActivityResultContracts.OpenDocument()) { uri ->
        if (uri != null) {
            scope.launch {
                val message = withContext(Dispatchers.IO) { importKeyFrom(context, uri, draft) }
                onResult(message)
            }
        }
    }
    // 私钥文件大多没有扩展名、也没有对应的类型,只能不限类型。
    return { launcher.launch(arrayOf("*/*")) }
}

/**
 * 「怎么登录」这一块:登录方式切换 + 密码,或者私钥(导入 / 更换、指纹、口令、复制公钥)。
 * 手机的整页编辑和平板的浮层共用。
 */
@Composable
fun CredentialFields(
    draft: HostDraft,
    /** 导入私钥后的提示(带口令 / 文件不对);null 不显示。 */
    keyMessage: String?,
    onImport: () -> Unit,
    onDone: () -> Unit,
    /** 生成密钥 / 复制公钥之后的一句状态(「公钥已复制」)。 */
    onMessage: (String?) -> Unit,
    passwordFocus: FocusRequester? = null,
    passphraseFocus: FocusRequester? = null,
    onComposing: ((Boolean) -> Unit)? = null,
) {
    val p = LocalXssh.current
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    // 这台设备有没有可用的门禁。没有(平板没设锁屏密码之类)就不显示这一项 ——
    // 显示了也打不开,只是个点了没反应的开关。
    val lockAvailable = remember { Secrets.lockAvailable(context) }
    FormGroup {
        Row(
            Modifier.fillMaxWidth().heightIn(min = 52.dp).padding(horizontal = BoxPad),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text("登录方式", color = p.text, fontSize = 16.sp, modifier = Modifier.weight(1f))
            Segmented(
                options = listOf("密码", "私钥"),
                selected = if (draft.auth == AuthKind.KEY) 1 else 0,
                onSelect = { draft.auth = if (it == 1) AuthKind.KEY else AuthKind.PASSWORD },
            )
        }
    }
    if (draft.auth == AuthKind.PASSWORD) {
        FormGroup {
            FormField(
                "密码",
                draft.password,
                { draft.password = it },
                placeholder = "输入密码",
                secret = true,
                keyboard = KeyboardType.Password,
                imeAction = ImeAction.Done,
                onDone = onDone,
                focusRequester = passwordFocus,
                onComposing = onComposing,
            )
        }
    } else FormGroup(footnote = keyMessage) {
        Row(
            Modifier.fillMaxWidth().heightIn(min = 52.dp).padding(horizontal = BoxPad),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text("私钥", color = p.text, fontSize = 16.sp)
            Spacer(Modifier.width(GapItem))
            Text(
                when {
                    draft.keyName.isNotEmpty() -> draft.keyName
                    draft.hasKey -> "私钥文件"
                    else -> "未导入"
                },
                color = if (draft.hasKey) p.textDim else p.warn,
                fontSize = 16.sp,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
                textAlign = TextAlign.End,
                modifier = Modifier.weight(1f),
            )
        }
        if (draft.keyPublicFingerprint.isNotEmpty()) {
            FormDivider()
            Row(
                Modifier.fillMaxWidth().heightIn(min = 52.dp).padding(horizontal = BoxPad),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text("指纹", color = p.text, fontSize = 16.sp)
                Spacer(Modifier.width(GapItem))
                Text(
                    draft.keyPublicFingerprint.removePrefix("SHA256:"),
                    color = p.textDim,
                    fontSize = 13.sp,
                    fontFamily = XsshFonts.monoUi,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                    textAlign = TextAlign.End,
                    modifier = Modifier.weight(1f),
                )
            }
        }
        if (draft.keyLocked) {
            FormDivider()
            FormField(
                "口令",
                draft.keyPassphrase,
                { draft.keyPassphrase = it },
                placeholder = "私钥口令",
                secret = true,
                keyboard = KeyboardType.Password,
                imeAction = ImeAction.Done,
                onDone = onDone,
                focusRequester = passphraseFocus,
                onComposing = onComposing,
            )
        }
        FormDivider()
        FormAction(if (draft.keyData.isEmpty()) "导入私钥…" else "更换私钥…") { onImport() }
        if (draft.keyData.isEmpty()) {
            // 手里没有私钥文件的人(平板上很常见):在这里生成一把,公钥直接进剪贴板,贴到服务器上就能用。
            FormDivider()
            FormAction("生成新密钥") {
                scope.launch {
                    val line = withContext(Dispatchers.IO) { draft.generateKey() }
                    if (line != null) {
                        copyText(context, line)
                        onMessage("公钥已复制")
                    } else {
                        onMessage("生成失败")
                    }
                }
            }
        } else {
            FormDivider()
            FormAction("复制公钥") {
                scope.launch {
                    val line = withContext(Dispatchers.IO) { draft.publicKey() }
                    if (line != null) {
                        copyText(context, line)
                        onMessage("公钥已复制")
                    }
                }
            }
        }
    }
    // 这道锁管的是"已保存的密码 / 私钥 / 口令",和上面选密码还是私钥无关,所以单独一组。
    if (lockAvailable) {
        FormGroup(
            footnote = if (draft.lockSecrets) {
                "连接这台主机前要先验证一次(生物识别或锁屏密码)。"
            } else {
                null
            },
        ) {
            Row(
                Modifier.fillMaxWidth().heightIn(min = 52.dp).padding(horizontal = BoxPad),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text("用生物识别解锁", color = p.text, fontSize = 16.sp, modifier = Modifier.weight(1f))
                XsshSwitch(draft.lockSecrets) { draft.lockSecrets = it }
            }
        }
    }
}
