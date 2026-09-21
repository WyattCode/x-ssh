package dev.xssh.android

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.WindowInsetsSides
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.only
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawing
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

/**
 * 主机页。三种形态:
 * - 窄屏(外屏 425dp):单列卡片,点卡片直接连,主操作在拇指够得到的右下角;
 * - 中屏(内屏竖 608dp):同一套卡片自动排成两列,不塞详情栏;
 * - 宽屏(内屏横 860dp / 平板):左列表 + 右详情,**分界线压在折痕上**,内容不跨折痕。
 */
@Composable
fun HomeScreen(
    hosts: List<Host>,
    selectedId: String?,
    onSelect: (Host) -> Unit,
    onConnect: (Host) -> Unit,
    onNew: () -> Unit,
    onEdit: (Host) -> Unit,
    onDelete: (Host) -> Unit,
) {
    val adaptive = LocalAdaptive.current
    val p = LocalXssh.current
    // 哪些主机后台还连着 —— 卡片上要看得出来,不然用户不知道有会话在跑。
    val running by SessionRegistry.sessions.collectAsState()
    var query by remember { mutableStateOf("") }
    val filtered = remember(hosts, query) {
        if (query.isBlank()) {
            hosts
        } else {
            hosts.filter {
                it.label.contains(query, ignoreCase = true) ||
                    it.address.contains(query, ignoreCase = true) ||
                    it.username.contains(query, ignoreCase = true)
            }
        }
    }

    // 注意:折痕位置是**窗口**坐标,所以这一层不能先加安全区内边距 —— 否则挖孔在侧边时
    // (内屏横屏挖孔占 51dp)分界线会整体右移,正好压不在折痕上。内边距放进各栏自己加。
    var searching by remember { mutableStateOf(false) }

    // 右栏要显示哪台:**在组合期间就算出来**,不能等副作用。
    //
    // 原来是用 LaunchedEffect 去"自动选中第一台",而副作用要等第一次组合之后才跑 ——
    // 于是冷启动时右栏先渲染一帧「选择左边的主机」的空状态,下一帧才换成真内容,
    // 看上去就是打开应用闪跳一下(录屏第 296 帧拍到的就是这个)。
    val shownHost = hosts.firstOrNull { it.id == selectedId } ?: hosts.firstOrNull()

    BoxWithConstraints(Modifier.fillMaxSize().background(p.bg)) {
        // 用**实测到的窗口宽度**判断分栏,不用 Configuration 的 screenWidthDp ——
        // 分屏时部分机型的 screenWidthDp 仍报整块屏幕的宽度,那样会在只有半屏宽的窗口里
        // 摆出双栏:左栏按折痕位置占满整个窗口,右栏被挤到窗口之外,看起来就是内容跑到右边。
        val twoPane = maxWidth >= 840.dp || (adaptive.bookFold != null && maxWidth >= 600.dp)

        // 只有双栏才自动选中:右栏必须有东西可看。
        // 单栏(外屏)里"选中"没有任何去处 —— 点卡片是直接连接 —— 自动选中只会让
        // 第一张卡片一进来就带着高亮边框,看着像用户点过,实际没点过。
        LaunchedEffect(twoPane, shownHost?.id) {
            if (twoPane && selectedId != shownHost?.id) shownHost?.let(onSelect)
        }

        if (twoPane && hosts.isNotEmpty()) {
            // 再兜一层:左栏无论如何不能吃掉整个窗口。
            val listWidth = adaptive.listPaneWidth(maxWidth).coerceAtMost(maxWidth - 280.dp)
            Row(Modifier.fillMaxSize()) {
                HostListPane(
                    modifier = Modifier
                        .width(listWidth)
                        .fillMaxHeight()
                        .windowInsetsPadding(
                            WindowInsets.safeDrawing.only(
                                WindowInsetsSides.Vertical + WindowInsetsSides.Start,
                            ),
                        ),
                    hosts = filtered,
                    total = hosts.size,
                    selectedId = shownHost?.id,
                    onPrimary = onSelect,
                    onNew = onNew,
                    onEdit = onEdit,
                    onDelete = onDelete,
                    query = query,
                    onQuery = { query = it },
                    searching = searching,
                    onSearching = { searching = it },
                    running = running.keys,
                    columns = 1,
                    large = false,
                    // 折痕这一侧留 32dp,右栏同样从折痕后 32dp 起 —— 两栏关于折痕镜像。
                    // 原来左边卡片一路铺到折痕前 16dp,右栏又被轨道吃掉 72dp,
                    // 看上去左边长、右边短。
                    creaseGap = Gutter * 2,
                )
                // 两栏之间不画线:折痕本身就是分界,再补一条反而多余。
                Spacer(Modifier.width(maxOf(1.dp, adaptive.bookFold?.sizeDp ?: 0.dp)))
                HostDetailPane(
                    modifier = Modifier
                        .weight(1f)
                        .fillMaxHeight()
                        // 详情栏靠右,给边缘轨道让出位置。
                        .padding(end = RailWidth)
                        .windowInsetsPadding(
                            WindowInsets.safeDrawing.only(
                                WindowInsetsSides.Vertical + WindowInsetsSides.End,
                            ),
                        ),
                    host = shownHost,
                    onConnect = onConnect,
                    onEdit = onEdit,
                    onDelete = onDelete,
                    onNew = onNew,
                )
            }
        } else if (hosts.isEmpty()) {
            FirstRun(Modifier.fillMaxSize().safeDrawingPadding())
        } else {
            HostListPane(
                // 内容通到边缘,从右边缘玻璃层底下穿过去(规范:scroll views extend
                // beneath floating glass)。底部多留一段,最后一张卡片能滚出轨道之外。
                modifier = Modifier.fillMaxSize().safeDrawingPadding(),
                hosts = filtered,
                total = hosts.size,
                // 单栏没有"当前选中"这个概念,别画高亮。
                selectedId = null,
                onPrimary = onConnect,
                onNew = onNew,
                onEdit = onEdit,
                onDelete = onDelete,
                query = query,
                onQuery = { query = it },
                searching = searching,
                onSearching = { searching = it },
                running = running.keys,
                // 单栏(外屏、内屏竖屏)一律单列大卡片。
                // 原来按 264dp 自适应,竖屏排成两列,每张卡片只有 280dp 宽、57dp 高,
                // 在 860dp 高的屏幕上缩在左上角,七成空着。
                columns = 1,
                large = true,
                creaseGap = Gutter,
            )
        }

        // chrome 全在这条轨道里:界面四角不再散落按钮。
        EdgeRail(Modifier.align(Alignment.BottomEnd)) {
            // 一台主机都没有时不摆搜索 —— 没东西可搜,按钮只是噪音。
            if (hosts.isNotEmpty()) {
                RailGroup {
                    RailButton("⌕", "搜索主机") {
                        searching = !searching
                        if (!searching) query = ""
                    }
                }
            }
            RailGroup {
                RailButton("＋", "新建主机", tint = p.accent) { onNew() }
            }
        }
    }
}

@Composable
private fun HostListPane(
    modifier: Modifier,
    hosts: List<Host>,
    total: Int,
    selectedId: String?,
    onPrimary: (Host) -> Unit,
    onNew: () -> Unit,
    onEdit: (Host) -> Unit,
    onDelete: (Host) -> Unit,
    query: String,
    onQuery: (String) -> Unit,
    searching: Boolean,
    onSearching: (Boolean) -> Unit,
    running: Set<String>,
    columns: Int,
    /** 单栏用大卡片:外屏和竖屏上一张卡片就是一个手指目标,不该是一行小字。 */
    large: Boolean,
    /** 靠折痕(或屏幕右缘)那一侧的留白。 */
    creaseGap: Dp,
) {
    val p = LocalXssh.current
    Box(modifier) {
        Column(Modifier.fillMaxSize()) {
            // 标题是内容的一部分,不是一条"标题栏" —— 它跟着列表一起,不占固定高度的横条。
            PaneTitle(
                Modifier
                    .fillMaxWidth()
                    .padding(start = Gutter + BoxPad, end = creaseGap, top = Gutter, bottom = GapItem),
                "X-SSH",
                if (total == 0) "还没有主机" else "$total 台主机 · 长按卡片可编辑",
            )

            // 搜索平时不占地方,点轨道上的放大镜才出来。
            if (searching) {
                val focus = remember { FocusRequester() }
                LaunchedEffect(Unit) { runCatching { focus.requestFocus() } }
                OutlinedTextField(
                    value = query,
                    onValueChange = onQuery,
                    placeholder = { Text("搜索名称 / 地址 / 用户", color = p.textFaint) },
                    singleLine = true,
                    colors = xsshFieldColors(),
                    shape = RoundedCornerShape(28.dp),
                    trailingIcon = {
                        XsshIconButton("✕") {
                            onQuery("")
                            onSearching(false)
                        }
                    },
                    modifier = Modifier
                        .fillMaxWidth()
                        .heightIn(min = 56.dp)
                        .padding(start = Gutter, end = creaseGap)
                        .focusRequester(focus),
                )
                Spacer(Modifier.height(GapItem))
            }

            if (hosts.isEmpty()) {
                // 只可能是"搜了但没匹配上" —— 一台主机都没有时走的是整屏的 FirstRun。
                NoMatches(Modifier.weight(1f).fillMaxWidth())
            } else {
                LazyVerticalGrid(
                    columns = if (columns > 0) GridCells.Fixed(columns) else GridCells.Adaptive(264.dp),
                    modifier = Modifier.weight(1f).fillMaxWidth(),
                    // 底部留出轨道的高度,最后一张卡片能滚到它上面去。
                    contentPadding = PaddingValues(start = Gutter, end = creaseGap, bottom = RailClearance),
                    horizontalArrangement = Arrangement.spacedBy(GapItem),
                    verticalArrangement = Arrangement.spacedBy(GapItem),
                ) {
                    items(hosts, key = { it.id }) { host ->
                        HostCard(
                            host = host,
                            large = large,
                            selected = host.id == selectedId,
                            running = host.id in running,
                            onPrimary = onPrimary,
                            onEdit = onEdit,
                            onDelete = onDelete,
                        )
                    }
                }
            }
        }
    }
}

/**
 * 一台主机都没有时的整屏起步面板。
 *
 * 不做成"左边空列表 + 右边空详情"的双栏 —— 那是两块空白拼在一起。
 * 也不放按钮:新建就在右边缘轨道上,这里再来一个就是重复。
 */
@Composable
private fun FirstRun(modifier: Modifier) {
    val p = LocalXssh.current
    Column(
        modifier.padding(horizontal = Gutter + BoxPad),
        verticalArrangement = Arrangement.Center,
    ) {
        Text("X-SSH", color = p.text, fontSize = 34.sp, fontWeight = FontWeight.SemiBold)
        Spacer(Modifier.height(10.dp))
        Text(
            "还没有主机。点右下角的 ＋ 添加一台。",
            color = p.textDim,
            fontSize = 15.sp,
        )
        Spacer(Modifier.height(6.dp))
        Text(
            "添加之后:点卡片直接连接,长按卡片编辑或删除。",
            color = p.textFaint,
            fontSize = 13.sp,
        )
    }
}

@Composable
private fun NoMatches(modifier: Modifier) {
    val p = LocalXssh.current
    Column(
        modifier.padding(32.dp),
        verticalArrangement = Arrangement.Center,
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Text("没有匹配的主机", color = p.textDim, fontSize = 16.sp)
        Spacer(Modifier.height(6.dp))
        Text("换个关键词试试", color = p.textFaint, fontSize = 13.sp)
    }
}

@Composable
private fun HostCard(
    host: Host,
    large: Boolean,
    selected: Boolean,
    running: Boolean,
    onPrimary: (Host) -> Unit,
    onEdit: (Host) -> Unit,
    onDelete: (Host) -> Unit,
) {
    val p = LocalXssh.current
    var menu by remember { mutableStateOf(false) }

    XsshCard(
        modifier = Modifier.fillMaxWidth(),
        highlight = selected,
        onClick = { onPrimary(host) },
        onLongClick = { menu = true },
        // 大卡片约 84dp 高(原来 57dp):单栏里它是主要的手指目标。
        paddingVertical = if (large) 18.dp else 13.dp,
    ) {
        // 一行纯内容:名称 + 标签,地址独占一行。
        //
        // 行尾**不放** ⋮ —— 参考设计里的邮件行、日历行都是纯内容,没有逐行的溢出按钮,
        // 这正是内容能从右边缘玻璃层底下穿过去的前提。编辑/删除走长按(宽屏还有详情栏)。
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(
                host.label,
                color = p.text,
                fontSize = if (large) 17.sp else 15.5.sp,
                fontWeight = FontWeight.Medium,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
                modifier = Modifier.weight(1f, fill = false),
            )
            Spacer(Modifier.width(8.dp))
            if (running) Chip("运行中", p.ok)
            if (running) Spacer(Modifier.width(6.dp))
            Chip(
                if (host.auth == AuthKind.KEY) "私钥" else "密码",
                if (host.auth == AuthKind.KEY) p.accent else p.warn,
            )
            if (host.keyFingerprint.isBlank()) {
                Spacer(Modifier.width(6.dp))
                Chip("密钥待确认", p.warn)
            }
        }
        Spacer(Modifier.height(if (large) 5.dp else 3.dp))
        Text(
            host.subtitle,
            color = p.textDim,
            fontFamily = FontFamily.Monospace,
            fontSize = if (large) 13.5.sp else 12.5.sp,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
        )
        HostMenu(
            open = menu,
            onDismiss = { menu = false },
            onEdit = { onEdit(host) },
            onDelete = { onDelete(host) },
        )
    }
}

@Composable
private fun HostMenu(open: Boolean, onDismiss: () -> Unit, onEdit: () -> Unit, onDelete: () -> Unit) {
    val p = LocalXssh.current
    DropdownMenu(expanded = open, onDismissRequest = onDismiss) {
        DropdownMenuItem(
            text = { Text("编辑", fontSize = 15.sp) },
            modifier = Modifier.heightIn(min = TouchMin),
            onClick = { onDismiss(); onEdit() },
        )
        DropdownMenuItem(
            text = { Text("删除", color = p.danger, fontSize = 15.sp) },
            modifier = Modifier.heightIn(min = TouchMin),
            onClick = { onDismiss(); onDelete() },
        )
    }
}

@Composable
private fun HostDetailPane(
    modifier: Modifier,
    host: Host?,
    onConnect: (Host) -> Unit,
    onEdit: (Host) -> Unit,
    onDelete: (Host) -> Unit,
    onNew: () -> Unit,
) {
    val p = LocalXssh.current
    if (host == null) {
        Column(
            modifier.padding(Gutter + BoxPad),
            verticalArrangement = Arrangement.Center,
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            // 空态只说话,不放按钮 —— 新建已经在右边缘轨道上,这里再来一个就是重复,
            // 而且一个方按钮浮在空白里正是之前那种割裂感的来源。
            Text("选择左边的主机", color = p.textDim, fontSize = 15.sp)
            Spacer(Modifier.height(6.dp))
            Text("这里会显示它的详情和操作", color = p.textFaint, fontSize = 13.sp)
        }
        return
    }

    // 整栏**只有一条左缘**:折痕后 32dp。标题、标签、详情、按钮全部从这里起。
    //
    // 原来文字缩进到 32dp、按钮却在 16dp,于是「连接」「编辑」「删除」左右各比上面的
    // 「认证」「已信任的主机密钥」多出 16dp —— 这一栏没有任何面板,按钮就是唯一的"盒子",
    // 让它按盒子的 16dp 线走,只会显得比文字宽出一截。
    Column(
        modifier
            .verticalScroll(rememberScrollState())
            .padding(start = Gutter * 2, end = Gutter, top = Gutter, bottom = Gutter),
    ) {
        PaneTitle(
            Modifier.fillMaxWidth(),
            host.label,
            host.subtitle,
            monoSubtitle = true,
        )
        Spacer(Modifier.height(GapItem))
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Chip(
                if (host.auth == AuthKind.KEY) "私钥认证" else "密码认证",
                if (host.auth == AuthKind.KEY) p.accent else p.warn,
            )
            Chip(
                if (host.keyFingerprint.isBlank()) "主机密钥未确认" else "主机密钥已信任",
                if (host.keyFingerprint.isBlank()) p.warn else p.ok,
            )
        }

        Spacer(Modifier.height(24.dp))
        DetailRow(
            "认证",
            when {
                host.auth == AuthKind.KEY -> host.keyPath.ifBlank { "(未指定私钥)" }
                host.password.isEmpty() -> "密码(未保存,连接前请先编辑填入)"
                else -> "密码(已加密保存在本机)"
            },
        )
        if (host.keyFingerprint.isNotBlank()) {
            Spacer(Modifier.height(GapItem))
            val (algorithm, rows) = fingerprintRows(host.keyFingerprint)
            DetailRow(
                if (algorithm.isBlank()) "已信任的主机密钥" else "已信任的主机密钥 · $algorithm",
                rows.joinToString("\n"),
            )
        }

        Spacer(Modifier.height(24.dp))
        // 和编辑/删除同高(48dp):三颗按钮是一组,不该有一颗特别胖。
        XsshButton("连接", modifier = Modifier.fillMaxWidth()) { onConnect(host) }
        Spacer(Modifier.height(GapItem))
        Row(horizontalArrangement = Arrangement.spacedBy(GapItem)) {
            XsshButton("编辑", kind = ButtonKind.Ghost, modifier = Modifier.weight(1f)) { onEdit(host) }
            XsshButton("删除", kind = ButtonKind.Danger, modifier = Modifier.weight(1f)) { onDelete(host) }
        }
    }
}

/** 栏标题(大标题 + 一行说明)。两栏共用同一套字号,基线才能横跨折痕对齐。 */
@Composable
private fun PaneTitle(
    modifier: Modifier,
    title: String,
    subtitle: String,
    monoSubtitle: Boolean = false,
) {
    val p = LocalXssh.current
    Column(modifier) {
        Text(
            title,
            color = p.text,
            fontSize = 28.sp,
            fontWeight = FontWeight.SemiBold,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
        )
        Spacer(Modifier.height(2.dp))
        Text(
            subtitle,
            color = if (monoSubtitle) p.textDim else p.textFaint,
            fontFamily = if (monoSubtitle) FontFamily.Monospace else FontFamily.Default,
            fontSize = 12.5.sp,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
        )
    }
}

@Composable
private fun DetailRow(label: String, value: String) {
    val p = LocalXssh.current
    Column {
        Text(label, color = p.textFaint, fontSize = 12.sp)
        Spacer(Modifier.height(4.dp))
        Text(value, color = p.text, fontFamily = FontFamily.Monospace, fontSize = 13.sp)
    }
}
