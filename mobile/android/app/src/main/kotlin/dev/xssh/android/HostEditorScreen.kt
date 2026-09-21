package dev.xssh.android

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
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalLayoutDirection
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import java.util.UUID

/**
 * 新建 / 编辑主机。
 *
 * 排法和其余界面一致:标题是内容不是栏,操作在右边缘轨道,字段用分组行式列表。
 * 展开的内屏不把表单拉成一条 860dp 宽的长行,而是**按折痕分成两栏**:
 * 左边是连到哪台,右边是密码 —— 一眼能看完,也不用来回滚。
 *
 * 只有密码登录。私钥还没有导入的办法(只能填应用内部的文件路径),普通用户用不了,
 * 界面上干脆不出现;数据模型和连接层仍然支持私钥,老数据照常能连。
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

    var name by remember { mutableStateOf(initial?.name ?: "") }
    var address by remember { mutableStateOf(initial?.address ?: "") }
    var port by remember { mutableStateOf((initial?.port ?: 22).toString()) }
    var username by remember { mutableStateOf(initial?.username ?: "") }
    var password by remember { mutableStateOf(initial?.password ?: "") }
    var error by remember { mutableStateOf<String?>(null) }

    fun save() {
        val newAddress = address.trim()
        if (newAddress.isEmpty()) {
            error = "地址不能为空"
            return
        }
        error = null
        val newPort = (port.toIntOrNull() ?: 22).coerceIn(1, 65535)
        // 已信任的指纹绑在「地址:端口」上:改了目标就是另一台机器,旧指纹不能跟着走;
        // 没改就必须留下,否则编辑一下备注就把信任关系抹了。
        val sameEndpoint = initial != null && initial.address == newAddress && initial.port == newPort
        onSave(
            Host(
                id = initial?.id ?: UUID.randomUUID().toString(),
                name = name.trim(),
                address = newAddress,
                port = newPort,
                username = username.trim(),
                auth = AuthKind.PASSWORD,
                keyPath = "",
                keyFingerprint = if (sameEndpoint) initial.keyFingerprint else "",
                password = password,
            ),
        )
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
            )
            FormDivider()
            FormField(
                "端口",
                port,
                { port = it.filter(Char::isDigit).take(5) },
                placeholder = "22",
                mono = true,
                keyboard = KeyboardType.Number,
            )
            FormDivider()
            FormField("用户名", username, { username = it }, placeholder = "root", mono = true)
        }
    }

    val credentials: @Composable () -> Unit = {
        FormGroup {
            FormField(
                "密码",
                password,
                { password = it },
                placeholder = "输入密码",
                secret = true,
                keyboard = KeyboardType.Password,
                imeAction = ImeAction.Done,
            )
        }
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
    BoxWithConstraints(Modifier.fillMaxSize().background(p.groupedBg)) {
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
                // 给右侧轨道让位 —— 表单是右对齐取值,不能让按钮压在值上。
                // 直板机按钮在顶栏,表单铺满;标题从顶栏下面开始。
                .padding(end = if (topBar) 0.dp else RailWidth, top = if (topBar) TopBarHeight else 0.dp),
        ) {
            Column(
                Modifier.padding(start = startInset + Gutter + BoxPad, end = Gutter, top = Gutter),
            ) {
                Text(
                    if (initial == null) "新建主机" else "编辑主机",
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
                Row(Modifier.fillMaxWidth()) {
                    Column(
                        Modifier.width(left).padding(start = startInset + Gutter, end = Gutter * 2),
                        verticalArrangement = Arrangement.spacedBy(20.dp),
                    ) { target() }
                    Column(
                        Modifier.weight(1f).padding(start = Gutter * 2, end = Gutter),
                        verticalArrangement = Arrangement.spacedBy(20.dp),
                    ) {
                        credentials()
                        danger()
                    }
                }
            } else {
                Column(
                    Modifier
                        // 一行里标签在左、取值在右,行太宽的话视线要横跨半块屏幕 —— 所以限宽。
                        // 但**不能居中**:内屏竖屏内容区 536dp,比上限多出的 16dp 会被
                        // 左右各分 8dp,面板里的文字就落在 40dp,和标题的 32dp 错开一截。
                        // 限宽之后靠左,面板永远在 16dp、文字永远在 32dp。
                        .padding(start = startInset)
                        .widthIn(max = 560.dp + Gutter * 2)
                        .fillMaxWidth()
                        .padding(horizontal = Gutter),
                    verticalArrangement = Arrangement.spacedBy(20.dp),
                ) {
                    target()
                    credentials()
                    danger()
                }
            }
            Spacer(Modifier.height(40.dp))
        }

        if (topBar) {
            TopBar(
                Modifier.align(Alignment.TopCenter),
                start = { GlassButton(XIcons.Back, "返回") { onBack() } },
                end = { GlassButton(XIcons.Check, "保存") { save() } },
            )
        } else {
            // 和主机页的 ⌕ ＋ 落在同一对位置上:点 ＋ 进来,按钮原地换成 ‹ ✓,一像素不动。
            CompositionLocalProvider(LocalBackdrop provides backdrop) {
                EdgeRail(Modifier.align(Alignment.BottomEnd)) {
                    GlassButton(XIcons.Back, "返回") { onBack() }
                    // 和 ‹ 同一种样式:无色玻璃、正文色图标。
                    GlassButton(XIcons.Check, "保存") { save() }
                }
            }
        }
    }
}
