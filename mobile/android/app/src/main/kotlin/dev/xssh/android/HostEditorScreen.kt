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
import androidx.annotation.StringRes
import androidx.compose.ui.res.stringResource

/**
 * 一句要给用户看的话,存成资源 id + 参数:[HostDraft] 这类没有 Context 的代码也能写,
 * 显示的地方再用 [text](组合里)或 [resolve](有 Context 时)换成当前语言的文字。
 */
data class UiText(@StringRes val id: Int, val args: List<Any> = emptyList())

@Composable
fun UiText.text(): String = stringResource(id, *args.toTypedArray())

fun UiText.resolve(context: android.content.Context): String = context.getString(id, *args.toTypedArray())

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

    val context = LocalContext.current

    fun save() {
        // 用私钥登录时要验一次口令(解私钥要几百毫秒)、加锁开关要用密钥库并可能弹一次
        // 解锁,都放到 IO 之外由 buildHostForSave 自己安排;这里只管收结果。
        val activity = hostActivity(context)
        if (activity == null) {
            draft.error = UiText(R.string.edit_err_no_page)
            return
        }
        scope.launch {
            val host = buildHostForSave(activity, draft)
            host?.let(onSave)
        }
    }

    val target: @Composable () -> Unit = {
        FormGroup {
            FormField(stringResource(R.string.edit_name), name, { name = it }, placeholder = stringResource(R.string.edit_name_placeholder))
            FormDivider()
            FormField(
                stringResource(R.string.edit_address),
                address,
                { address = it },
                placeholder = "192.168.1.10",
                mono = true,
                keyboard = KeyboardType.Uri,
                            asciiOnly = true,
            )
            FormDivider()
            FormField(
                stringResource(R.string.edit_port),
                port,
                { port = it.filter(Char::isDigit).take(5) },
                placeholder = "22",
                mono = true,
                keyboard = KeyboardType.Number,
                            asciiOnly = true,
            )
            FormDivider()
            // 用户名只会是英文:用 URI 类键盘,中文输入法会切到英文,不会把 root 组成拼音。
            FormField(stringResource(R.string.edit_username), username, { username = it }, placeholder = "root", mono = true, keyboard = KeyboardType.Uri, asciiOnly = true)
        }
        // 经哪台过去,和"连到哪台"是一件事,紧跟在地址下面。
        JumpField(draft)
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
                FormAction(
                    stringResource(if (confirming) R.string.edit_delete_confirm else R.string.edit_delete),
                    danger = true,
                ) {
                    if (confirming) onDelete(initial) else confirming = true
                }
            }
        }
    }

    // 整个页面量一次,和主机页同一条式子、同样量整个窗口。
    // 分组表单:浅色是浅灰底 + 白色分组块,深色是纯黑底 + 深灰分组块(iOS 设置页那种)。
    val backdrop = rememberLayerBackdrop()
    // 折叠屏:‹ ✓ 在右侧轨道;直板机:底栏左边 ‹、右边 ✓(见 Chrome)。
    val bottomBar = LocalChrome.current == Chrome.BottomBar
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
                .verticalScroll(rememberScrollState()),
        ) {
          // 表单铺满到右边缘,‹ ✓ 悬浮在底部(轨道或底栏)。键盘弹起时按钮跟着升到键盘上方,正好压在
          // "正在输入的那一行"上 —— 输入框聚焦时多滚一截按钮的高度,落到按钮上面。
          CompositionLocalProvider(LocalFieldClearance provides if (bottomBar) BarClearance else RailClearance) {
            Column(
                // 标题线(见 Components 的版心说明):盒子线 + TitlePad。
                Modifier.padding(start = startInset + Gutter + TitlePad, end = railSide(), top = Gutter),
            ) {
                Text(
                    stringResource(if (initial == null) R.string.edit_title_new else R.string.edit_title_edit),
                    Modifier.offset(x = -TitleOptical),
                    color = p.text,
                    fontSize = 34.sp,
                    fontWeight = FontWeight.Bold,
                )
                // 标题下面只在出错时说话(比如地址没填),平时不放操作说明。
                error?.let {
                    Spacer(Modifier.height(2.dp))
                    Text(it.text(), color = p.danger, fontSize = 12.5.sp)
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
            // 最后一组要能滚到底部悬浮的按钮上面。
            Spacer(Modifier.height(if (bottomBar) BarClearance else RailClearance))
          }
        }

        if (bottomBar) {
            CompositionLocalProvider(LocalBackdrop provides backdrop) {
                BottomBar(
                    Modifier.align(Alignment.BottomCenter),
                    start = { GlassButton(XIcons.Back, stringResource(R.string.edit_back)) { onBack() } },
                    end = {
                        GlassGroup { ThemeGlassItem() }
                        GlassButton(XIcons.Check, stringResource(R.string.edit_save)) { save() }
                    },
                )
            }
        } else {
            // 和主机页的 ⌕ ＋ 落在同一对位置上:点 ＋ 进来,按钮原地换成 ‹ ✓,一像素不动。
            CompositionLocalProvider(LocalBackdrop provides backdrop) {
                EdgeRail(Modifier.align(Alignment.BottomEnd)) {
                    // 外观在最上面(每一页都有,位置一样);‹ ✓ 的落点一像素不动。
                    GlassGroup { ThemeGlassItem() }
                    GlassButton(XIcons.Back, stringResource(R.string.edit_back)) { onBack() }
                    // 和 ‹ 同一种样式:无色玻璃、正文色图标。
                    GlassButton(XIcons.Check, stringResource(R.string.edit_save)) { save() }
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
    // 加锁主机的口令明文是空的,但磁盘上那条密文在 —— 不算上它的话口令行根本不显示,
    // 保存时 `keyPassphrase` 又被写成空,密文跟着被抹掉,下次连接报"这把私钥有口令"
    // 却没有地方能填。
    var keyLocked by mutableStateOf(
        (initial?.keyPassphrase ?: "").isNotEmpty() || initial?.lockedKeyPassphrase != null,
    )
    var error by mutableStateOf<UiText?>(null)

    var lockSecrets by mutableStateOf(initial?.lockSecrets ?: false)
    var tmux by mutableStateOf(initial?.tmux ?: false)
    /** 跳板机(另一台主机的 id,空 = 直连)。 */
    var jumpHostId by mutableStateOf(initial?.jumpHostId ?: "")

    /** 正在编辑的这台的 id;新建时为 null(选跳板机时要把自己排除掉)。 */
    val id: String? get() = initial?.id

    /** 进来时这台主机是不是已经加了锁 —— 和 [lockSecrets] 一比就知道要不要重新加密。 */
    val originalLocked: Boolean = initial?.lockSecrets ?: false

    /** 老数据 / 调试用的私钥文件路径(界面上不出现,保存时原样留下)。 */
    private val keyPath = initial?.keyPath.orEmpty()

    val isNew: Boolean get() = initial == null

    /**
     * 加锁主机:私钥 / 口令的密文在磁盘上,只是这一页没解开(解开要验指纹)。
     * 判"有没有私钥""带不带口令"必须算上它们。
     */
    private val lockedKeyKept: Boolean = initial?.lockedKeyData != null
    private val lockedPassphraseKept: Boolean = initial?.lockedKeyPassphrase != null

    /**
     * 有私钥可用(导入过的、老数据里的私钥文件,或者锁在磁盘上的那条密文)。
     *
     * 漏掉最后一种的话,一台"私钥登录 + 开了锁"的主机**永远存不下去**:
     * `keyData` 是空的(故意不解开)、`keyPath` 也是空的(导入的私钥没有路径),
     * 于是每次保存都被「还没有导入私钥」挡住 —— 连改个端口都不行。
     * 而界面同时还亮着「生成新密钥」,点下去倒是能存了,代价是把原来那把私钥覆盖掉。
     */
    val hasKey: Boolean get() = keyData.isNotEmpty() || keyPath.isNotEmpty() || lockedKeyKept

    /** 改过没有 —— 平板浮层点外面关闭时,改过的内容不能悄悄丢掉。 */
    val dirty: Boolean
        get() = name != (initial?.name ?: "") ||
            address != (initial?.address ?: "") ||
            port != (initial?.port ?: 22).toString() ||
            username != (initial?.username ?: "") ||
            password != (initial?.password ?: "") ||
            auth != (initial?.auth ?: AuthKind.PASSWORD) ||
            keyData != (initial?.keyData ?: "") ||
            keyPassphrase != (initial?.keyPassphrase ?: "") ||
            // 只拨了这个开关也是改过:漏掉它的话,平板浮层点外面就把这次改动静默丢了,
            // 连「放弃未保存的修改?」都不问。tmux 那个开关同理。
            lockSecrets != originalLocked ||
            tmux != (initial?.tmux ?: false) ||
            jumpHostId != (initial?.jumpHostId ?: "")

    /**
     * 这台主机磁盘上有一条加锁的密码密文。
     *
     * 编辑页**不会**把它解出来填进密码格 —— 解密要验指纹,而改个端口、换个名字
     * 不该要指纹(用户的原话:"修改一个 SSH 没有意义")。密码格因此是空的,
     * 靠这个标记把占位字从「输入密码」换成「已保存」,免得看着像没存过。
     * 空着保存不会动那条密文(见 HostStore.writeSecret);打了字才会覆盖。
     */
    val lockedPasswordKept: Boolean = initial?.lockedPassword != null

    /**
     * 导入一把私钥。返回要给用户看的一句话:null = 成功;带口令时返回提示并露出口令格
     * (私钥先收下,保存时再验口令)。在 IO 线程调用 —— 带口令的私钥解一次要几百毫秒。
     */
    fun importKey(text: String, fileName: String): UiText? {
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
            UiText(R.string.edit_key_has_passphrase)
        } catch (e: Exception) {
            UiText(R.string.edit_key_invalid_file)
        }
    }

    /**
     * 在本机生成一把 ed25519 密钥并用上它。返回公钥一行(贴进服务器的 authorized_keys);失败返回 null。
     * 不加口令:私钥本身经密钥库加密存在应用里,口令只会让每次连接多一步。在 IO 线程调用。
     * [label] 是存下来的私钥名(「本机生成 · ed25519」),调用方按当前语言给。
     */
    fun generateKey(label: String): String? = runCatching {
        val comment = "x-ssh@" + android.os.Build.MODEL.replace(' ', '-')
        val key = uniffi.xssh_ffi.generateKey(comment, null)
        keyData = key.pem
        keyName = label
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
            error = UiText(R.string.edit_err_address_empty)
            return null
        }
        if (auth == AuthKind.KEY) {
            if (!hasKey) {
                error = UiText(R.string.edit_err_no_key)
                return null
            }
            // 带口令的私钥:保存前就验口令,填错当场说,而不是等到连接时才失败。
            if (keyData.isNotEmpty()) {
                try {
                    keyPublicFingerprint = uniffi.xssh_ffi.inspectKey(keyData, keyPassphrase.ifEmpty { null }).fingerprint
                } catch (e: uniffi.xssh_ffi.FfiException.KeyEncrypted) {
                    keyLocked = true
                    error = UiText(
                        if (keyPassphrase.isEmpty()) R.string.edit_key_has_passphrase else R.string.edit_err_wrong_passphrase,
                    )
                    return null
                } catch (e: Exception) {
                    error = UiText(R.string.edit_err_key_unusable)
                    return null
                }
            }
        }
        error = null
        val newPort = (port.toIntOrNull() ?: 22).coerceIn(1, 65535)
        // 已信任的指纹绑在「地址:端口」上:改了目标就是另一台机器,旧指纹不能跟着走;
        // 没改就必须留下,否则编辑一下备注就把信任关系抹了。
        // 跳板机也算在「目标」里:`127.0.0.1:22` 经不同的跳板机是不同的机器。
        val sameEndpoint = initial != null && initial.address == newAddress && initial.port == newPort &&
            initial.jumpHostId == jumpHostId
        val key = auth == AuthKind.KEY
        val kept = carriedSecrets(key = key, keyLocked = keyLocked)
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
            tmux = tmux,
            jumpHostId = jumpHostId,
            // 没解锁就保存时,明文是空的 —— 把磁盘上那几条原样带过去,别覆盖成空。
            // (用户只是改个名字,不该顺手把密码弄丢。取舍规则见 carriedSecrets,抽出去是为了能测。)
            lockedPassword = kept.lockedPassword,
            lockedKeyData = kept.lockedKeyData,
            lockedKeyPassphrase = kept.lockedKeyPassphrase,
        )
    }

    /**
     * 这次保存要带走的旧密文。抽成函数是为了能单测 —— 它决定"换登录方式时哪条秘密该丢",
     * 判错的代价是用户的密码永久消失,而这种错在真机上要连一次才看得出来。
     *
     * 换成私钥登录就不留密码(反之亦然),与上面几条明文同步:没加锁的主机切过去密码就没了,
     * 加锁的却原样留着、切回来又复活 —— 同一个操作两种结果。
     *
     * 没换登录方式时一律原样带过去:加锁主机的明文是空的(没解锁),密文就是唯一那份凭据。
     */
    internal fun carriedSecrets(key: Boolean, keyLocked: Boolean): CarriedSecrets = CarriedSecrets(
        lockedPassword = if (key) null else initial?.lockedPassword,
        lockedKeyData = if (key) initial?.lockedKeyData else null,
        lockedKeyPassphrase = if (key && keyLocked) initial?.lockedKeyPassphrase else null,
    )
}

/** [HostDraft.carriedSecrets] 的结果:三条要原样写回磁盘的加锁密文。 */
data class CarriedSecrets(
    val lockedPassword: String?,
    val lockedKeyData: String?,
    val lockedKeyPassphrase: String?,
)

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
    fun fail(message: UiText) {
        draft.error = message
        draft.lockSecrets = draft.originalLocked
    }

    val host = withContext(Dispatchers.IO) { draft.build() } ?: return null

    // 这里**不能**因为「这台设备现在没有可用的门禁」就把三条密文清掉。
    // 之前那版是这么写的,理由是"密文反正已经废了,清掉让用户重填" —— 但
    // `canAuthenticate` 返回非 SUCCESS 的原因里有 `HW_UNAVAILABLE` 这种**临时**状态
    // (传感器正忙、刚重启),那时候密钥其实好好的。结果是:用户只改了个主机名,
    // 保存一下,三条凭据被静默删光。宁可让那台主机暂时连不上,也不能替用户扔东西。
    val wantsLock = draft.lockSecrets
    val wasLocked = draft.originalLocked
    // 跟这道锁完全无关的一次保存(本来没锁、也没要开):什么都不用做。
    if (!wantsLock && !wasLocked) return host

    // **保存不弹指纹框。**
    //
    // 上锁走公钥加密,密钥库不要求认证(见 Secrets 里 LOCKED_ALIAS 的说明)。
    // 用户在自己已解锁的设备上、自己的 App 里亲手打的密码,再验一次证明不了任何事 ——
    // 值得验的只有"把密码读出来去连服务器"那一刻。
    //
    // 只有**关锁**例外:它要把旧密文读出来再换成普通密钥存,读要用私钥,那一步绕不过认证。
    // 手里一条密文都没有(开了锁但从没存过密码)就别白弹一次框。
    val hasSealed = listOf(host.lockedPassword, host.lockedKeyData, host.lockedKeyPassphrase)
        .any { it != null && Secrets.isLocked(it) }
    if (!wantsLock && hasSealed && !unlockForWrite(activity)) {
        fail(UiText(R.string.edit_err_lock_off_failed))
        return null
    }
    // 开关状态没变(一直锁着,只是改了点别的):密文由 HostStore.save 按 `lockSecrets`
    // 重新封 —— 窗口刚验开,这一步这次会真的写进去。
    if (wantsLock == wasLocked) return host

    // 两条路都产出"三条密文",只是用的密钥不同;一律装回 Host 的 `locked*` 字段,
    // 明文字段不落盘(见 HostStore.save)。
    val sealed = if (wantsLock) {
        withContext(Dispatchers.IO) {
            // 要封的是**明文**。用户没动那一格时手里没有明文,而 `locked*` 带着的可能是
            // 一条**普通密钥**的密文(同一次会话里刚关过锁,又打开)—— 普通密钥不要认证,
            // 现在就能解开。不这么做的话,那条普通密文会被原样留下、旁边却写着
            // `lockSecrets: true`:界面显示"锁着",磁盘上却是谁都能读的,锁成了摆设。
            val plain = listOf(
                host.password.ifEmpty { Secrets.open(host.lockedPassword.orEmpty()) },
                host.keyData.ifEmpty { Secrets.open(host.lockedKeyData.orEmpty()) },
                host.keyPassphrase.ifEmpty { Secrets.open(host.lockedKeyPassphrase.orEmpty()) },
            )
            Secrets.enableLock(plain)
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
        fail(UiText(if (wantsLock) R.string.edit_err_lock_on_failed else R.string.edit_err_lock_off_failed))
        return null
    }

    // **这次打进去的明文优先。**
    //
    // 开锁那条路上明文已经被 `enableLock` 封好了,清掉是对的。
    // 关锁那条路上 `disableLock` 交回来的是**旧密文**解出来再重封的结果 ——
    // 原来这里一律 `password = ""`,于是"改密码 + 同时关锁"一起做时,
    // 新密码被旧的顶掉了,而界面还说保存成功(改私钥同理)。
    val keepPlain = !wantsLock
    return host.copy(
        lockSecrets = wantsLock,
        password = if (keepPlain) host.password else "",
        keyData = if (keepPlain) host.keyData else "",
        keyPassphrase = if (keepPlain) host.keyPassphrase else "",
        // 这次没封出内容的条目,沿用原来那条密文 —— 不能一律写 null:
        // 那是"这条凭据没了"的意思,而这里可能只是这次用不到它。
        // 手里有明文时则让明文去写(见 HostStore.writeSecret),这里给 null。
        // 有明文时让明文去写(见 HostStore.writeSecret),但**旧密文仍然留着兜底** ——
        // 写不进去(密钥库出错)时 `writeSecret` 会退回它。一律给 null 的话,
        // "关锁 + 改密码"撞上一次密钥库故障,新旧两份就一起没了。
        //
        // 但兜底的那条**必须是新状态认得的密文**:开锁之后拿一条普通密钥的密文写回
        // `lockSecrets = true` 的记录,`writeSecret` 见明文为空就原样写下去,下次
        // `open()` 读不出来 —— 界面写着"锁着",实际那条密码谁也解不开。宁可这次不带,
        // 也不能留下一条自相矛盾的记录;真丢了明文的那条路见 carriedLocked。
        lockedPassword = carriedLocked(sealed[0], host.lockedPassword, wantsLock),
        lockedKeyData = carriedLocked(sealed[1], host.lockedKeyData, wantsLock),
        lockedKeyPassphrase = carriedLocked(sealed[2], host.lockedKeyPassphrase, wantsLock),
    )
}

/**
 * 这一条要写回磁盘的密文:这次封出来的 `[sealed]` 优先,空串时沿用旧的那条 `[previous]`。
 *
 * **[locking] 为真(这台主机要加锁)时,旧的普通密钥密文不能沿用** —— 它会和
 * `lockSecrets = true` 一起落盘,而 `Secrets.open()` 只认普通密钥、`readLocked()` 只认
 * `L:` 前缀,两边都读不出它。真到那一步,密码是永久没了的,比"这次不带"严重得多。
 */
internal fun carriedLocked(sealed: String, previous: String?, locking: Boolean): String? = when {
    sealed.isNotEmpty() -> sealed
    previous == null -> null
    locking && !Secrets.isLocked(previous) -> null
    else -> previous
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
    }.getOrNull() ?: return context.getString(R.string.edit_err_read_file)
    if (bytes.size > MaxKeyBytes) return context.getString(R.string.edit_key_invalid_file)
    return draft.importKey(String(bytes, Charsets.UTF_8), name)?.resolve(context)
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
    // 下面几句在协程里才用到,那里调不了 stringResource,先在组合里取好。
    val generatedKeyName = stringResource(R.string.edit_key_generated_name)
    val publicKeyCopied = stringResource(R.string.edit_public_key_copied)
    val generateFailed = stringResource(R.string.edit_generate_failed)
    val passwordLabel = stringResource(R.string.edit_password)
    val privateKeyLabel = stringResource(R.string.edit_private_key)
    FormGroup {
        Row(
            Modifier.fillMaxWidth().heightIn(min = 52.dp).padding(horizontal = BoxPad),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text(stringResource(R.string.edit_login_method), color = p.text, fontSize = 16.sp, modifier = Modifier.weight(1f))
            Segmented(
                options = listOf(passwordLabel, privateKeyLabel),
                selected = if (draft.auth == AuthKind.KEY) 1 else 0,
                onSelect = { draft.auth = if (it == 1) AuthKind.KEY else AuthKind.PASSWORD },
            )
        }
    }
    if (draft.auth == AuthKind.PASSWORD) {
        FormGroup {
            FormField(
                passwordLabel,
                draft.password,
                { draft.password = it },
                // 加锁的主机不解出来显示(解密要验指纹),但要让用户知道密码还在。
                placeholder = stringResource(
                    if (draft.lockedPasswordKept) R.string.edit_password_saved else R.string.edit_password_placeholder,
                ),
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
            Text(privateKeyLabel, color = p.text, fontSize = 16.sp)
            Spacer(Modifier.width(GapItem))
            Text(
                when {
                    draft.keyName.isNotEmpty() -> draft.keyName
                    draft.hasKey -> stringResource(R.string.edit_key_file)
                    else -> stringResource(R.string.edit_key_none)
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
            // 分组显示,别挤成一行截断(见 FingerprintRow)。
            FingerprintRow(stringResource(R.string.edit_fingerprint), draft.keyPublicFingerprint)
        }
        if (draft.keyLocked) {
            FormDivider()
            FormField(
                stringResource(R.string.edit_passphrase),
                draft.keyPassphrase,
                { draft.keyPassphrase = it },
                placeholder = stringResource(R.string.edit_passphrase_placeholder),
                secret = true,
                keyboard = KeyboardType.Password,
                imeAction = ImeAction.Done,
                onDone = onDone,
                focusRequester = passphraseFocus,
                onComposing = onComposing,
            )
        }
        FormDivider()
        FormAction(
            stringResource(if (draft.keyData.isEmpty()) R.string.edit_import_key else R.string.edit_replace_key),
        ) { onImport() }
        if (draft.keyData.isEmpty()) {
            // 手里没有私钥文件的人(平板上很常见):在这里生成一把,公钥直接进剪贴板,贴到服务器上就能用。
            FormDivider()
            FormAction(stringResource(R.string.edit_generate_key)) {
                scope.launch {
                    val line = withContext(Dispatchers.IO) { draft.generateKey(generatedKeyName) }
                    if (line != null) {
                        copyText(context, line)
                        onMessage(publicKeyCopied)
                    } else {
                        onMessage(generateFailed)
                    }
                }
            }
        } else {
            FormDivider()
            FormAction(stringResource(R.string.edit_copy_public_key)) {
                scope.launch {
                    val line = withContext(Dispatchers.IO) { draft.publicKey() }
                    if (line != null) {
                        copyText(context, line)
                        onMessage(publicKeyCopied)
                    }
                }
            }
        }
    }
    // 这道锁管的是"已保存的密码 / 私钥 / 口令",和上面选密码还是私钥无关,所以单独一组。
    if (lockAvailable) {
        // 不写脚注:开关本身「用生物识别解锁」已经说清楚了,再补一句是重复。
        // 要查这台主机锁没锁,详情页有「解锁」那一行。
        FormGroup {
            Row(
                Modifier.fillMaxWidth().heightIn(min = 52.dp).padding(horizontal = BoxPad),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text(stringResource(R.string.edit_biometric_unlock), color = p.text, fontSize = 16.sp, modifier = Modifier.weight(1f))
                XsshSwitch(draft.lockSecrets) { draft.lockSecrets = it }
            }
        }
    }
    // 连上之后做什么,和凭据无关,单独一组。放在这个函数里是因为手机整页和平板浮层都用它。
    FormGroup {
        Row(
            Modifier.fillMaxWidth().heightIn(min = 52.dp).padding(horizontal = BoxPad),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text(stringResource(R.string.edit_tmux), color = p.text, fontSize = 16.sp, modifier = Modifier.weight(1f))
            XsshSwitch(draft.tmux) { draft.tmux = it }
        }
    }
}
