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

    fun save() {
        // 用私钥登录时要验一次口令(解私钥要几百毫秒),放到 IO 线程,别卡住界面。
        scope.launch {
            val host = withContext(Dispatchers.IO) { draft.build() }
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
            password != (initial?.password ?: "") ||
            auth != (initial?.auth ?: AuthKind.PASSWORD) ||
            keyData != (initial?.keyData ?: "") ||
            keyPassphrase != (initial?.keyPassphrase ?: "")

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
        )
    }
}

/** 私钥文件不会超过这个大小(4096 位 RSA 带口令也才 3KB 多);更大的多半选错了文件。 */
private const val MaxKeyBytes = 64 * 1024

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
        return
    }
    FormGroup(footnote = keyMessage) {
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
}
