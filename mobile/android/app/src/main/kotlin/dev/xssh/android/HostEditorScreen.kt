package dev.xssh.android

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawingPadding
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
 * 左边填"连到哪台",右边填"怎么登录" —— 一眼能看完,也不用来回滚。
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
    val defaultKeyPath = LocalContext.current.filesDir.resolve("xssh_dev_key").absolutePath

    var name by remember { mutableStateOf(initial?.name ?: "") }
    var address by remember { mutableStateOf(initial?.address ?: "") }
    var port by remember { mutableStateOf((initial?.port ?: 22).toString()) }
    var username by remember { mutableStateOf(initial?.username ?: "") }
    var auth by remember { mutableStateOf(initial?.auth ?: AuthKind.KEY) }
    var keyPath by remember {
        mutableStateOf(initial?.keyPath?.takeIf { it.isNotBlank() } ?: defaultKeyPath)
    }
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
                auth = auth,
                keyPath = keyPath.trim(),
                keyFingerprint = if (sameEndpoint) initial.keyFingerprint else "",
                password = password,
            ),
        )
    }

    val target: @Composable () -> Unit = {
        FormGroup(title = "连到哪台") {
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
        FormGroup(
            title = "怎么登录",
            footnote = if (auth == AuthKind.KEY) {
                "密钥库(导入 / 生成 / 生物识别解锁)在后续版本提供。"
            } else {
                "密码只留在内存里,不写入手机。每次重开应用要重新输入。"
            },
        ) {
            Segmented(
                options = listOf("私钥", "密码"),
                selectedIndex = if (auth == AuthKind.KEY) 0 else 1,
                onSelect = { auth = if (it == 0) AuthKind.KEY else AuthKind.PASSWORD },
            )
            FormDivider()
            if (auth == AuthKind.KEY) {
                FormField(
                    "私钥文件",
                    keyPath,
                    { keyPath = it },
                    placeholder = "私钥文件路径",
                    mono = true,
                    imeAction = ImeAction.Done,
                    stacked = true,
                )
            } else {
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
    }

    val danger: @Composable () -> Unit = {
        if (initial != null && onDelete != null) {
            FormGroup { FormAction("删除这台主机", danger = true) { onDelete(initial) } }
        }
    }

    Box(Modifier.fillMaxSize().background(p.bg)) {
        BoxWithConstraints(
            Modifier
                .fillMaxSize()
                .safeDrawingPadding()
                .imePadding()
                .padding(end = RailWidth),
        ) {
            // 与主机页同一条判据:够宽就分两栏,分界压在折痕上。
            // 先把 maxWidth 存成局部量 —— 进了 Column/Row 的 lambda 之后
            // BoxWithConstraintsScope 就被遮住了,取不到。
            val available = maxWidth
            val twoPane = available >= 840.dp || (adaptive.bookFold != null && available >= 600.dp)
            val scroll = rememberScrollState()

            Column(Modifier.fillMaxSize().verticalScroll(scroll)) {
                Column(Modifier.padding(start = Gutter + BoxPad, end = Gutter, top = Gutter)) {
                    Text(
                        if (initial == null) "新建主机" else "编辑主机",
                        color = p.text,
                        fontSize = 28.sp,
                        fontWeight = FontWeight.SemiBold,
                    )
                    Spacer(Modifier.height(2.dp))
                    Text(
                        error ?: "填完点右边的 ✓ 保存",
                        color = if (error != null) p.danger else p.textFaint,
                        fontSize = 12.5.sp,
                    )
                }
                Spacer(Modifier.height(GapItem + 4.dp))

                if (twoPane) {
                    val left = adaptive.listPaneWidth(available).coerceAtMost(available - 280.dp)
                    Row(Modifier.fillMaxWidth()) {
                        Column(
                            Modifier.width(left).fillMaxHeight().padding(start = Gutter, end = Gutter),
                            verticalArrangement = Arrangement.spacedBy(20.dp),
                        ) { target() }
                        Column(
                            Modifier.weight(1f).padding(start = Gutter, end = Gutter),
                            verticalArrangement = Arrangement.spacedBy(20.dp),
                        ) {
                            credentials()
                            danger()
                        }
                    }
                } else {
                    Column(
                        Modifier
                            .fillMaxWidth()
                            .widthIn(max = 640.dp)
                            .align(Alignment.CenterHorizontally)
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
        }

        EdgeRail(
            Modifier.align(Alignment.BottomEnd).safeDrawingPadding().imePadding().padding(bottom = 12.dp),
        ) {
            RailGroup { RailButton("‹", "返回") { onBack() } }
            RailGroup { RailButton("✓", "保存", tint = p.accent) { save() } }
        }
    }
}
