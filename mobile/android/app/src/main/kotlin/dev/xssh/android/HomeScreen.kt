package dev.xssh.android

import com.kyant.backdrop.backdrops.rememberLayerBackdrop
import com.kyant.backdrop.backdrops.layerBackdrop
import androidx.compose.foundation.layout.union
import androidx.compose.foundation.layout.systemBars
import androidx.compose.foundation.layout.displayCutout
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.animation.core.tween
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.material3.Icon
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.lazy.grid.itemsIndexed
import androidx.compose.ui.layout.layout
import kotlinx.coroutines.launch
import kotlin.math.roundToInt
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.customActions
import androidx.compose.ui.semantics.CustomAccessibilityAction
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.input.pointer.util.VelocityTracker
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.graphics.TransformOrigin
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.draw.clip
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.foundation.lazy.grid.rememberLazyGridState
import androidx.compose.foundation.layout.IntrinsicSize
import androidx.compose.foundation.gestures.detectHorizontalDragGestures
import androidx.compose.foundation.gestures.animateScrollBy
import androidx.compose.foundation.clickable
import androidx.compose.animation.core.spring
import androidx.compose.animation.core.Animatable
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

    // 浮在内容上的玻璃按钮(右侧轨道)要模糊、折射的,就是这一页的内容。
    val backdrop = rememberLayerBackdrop()

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
            Row(Modifier.fillMaxSize().layerBackdrop(backdrop)) {
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
                    // 双栏时轨道在右栏上方,不压列表。
                    underRail = false,
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
                modifier = Modifier.fillMaxSize().layerBackdrop(backdrop).safeDrawingPadding(),
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
                // 单栏(外屏、内屏竖屏)一律单列、大号的行。
                // 原来按 264dp 自适应,竖屏排成两列,每张卡片只有 280dp 宽、57dp 高,
                // 在 860dp 高的屏幕上缩在左上角,七成空着。
                columns = 1,
                large = true,
                creaseGap = Gutter,
                underRail = true,
            )
        }

        // chrome 全在这条轨道里:界面四角不再散落按钮。轨道是 Liquid Glass,列表从它底下滚过去。
        val theme = LocalThemeControl.current
        CompositionLocalProvider(LocalBackdrop provides backdrop) {
            EdgeRail(Modifier.align(Alignment.BottomEnd)) {
                // 外观和搜索是"调整这一页怎么看"的两个操作,装进同一枚胶囊;
                // 胶囊从底部往上长,搜索在下(和编辑页的 ‹、终端页的键盘同一个位置),外观在上。
                // 外观点一下切到下一个模式(跟随系统 → 浅色 → 深色 → …),不弹窗。
                GlassGroup {
                    GlassItem(
                        when (theme.mode) {
                            ThemeMode.Light -> XIcons.Sun
                            ThemeMode.Dark -> XIcons.Moon
                            ThemeMode.System -> XIcons.Auto
                        },
                        "外观:${theme.mode.label}",
                    ) {
                        theme.onChange(
                            when (theme.mode) {
                                ThemeMode.System -> ThemeMode.Light
                                ThemeMode.Light -> ThemeMode.Dark
                                ThemeMode.Dark -> ThemeMode.System
                            },
                        )
                    }
                    // 一台主机都没有时不摆搜索 —— 没东西可搜。
                    if (hosts.isNotEmpty()) {
                        GlassItem(XIcons.Search, "搜索主机") {
                            searching = !searching
                            if (!searching) query = ""
                        }
                    }
                }
                // 这一页的主操作:染色玻璃(HIG:颜色只给最重要的那个操作)。
                GlassButton(XIcons.Plus, "新建主机", prominent = true) { onNew() }
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
    /** 单栏用大号的行:外屏和竖屏上一行就是一个手指目标,不该是一行小字。 */
    large: Boolean,
    /** 靠折痕(或屏幕右缘)那一侧的留白。 */
    creaseGap: Dp,
    /** 列表是否从右侧轨道底下穿过(单栏为真):左滑露出的按钮不能落在轨道底下。 */
    underRail: Boolean,
) {
    val p = LocalXssh.current
    val grid = rememberLazyGridState()
    val scope = rememberCoroutineScope()
    val density = LocalDensity.current
    // 同一时刻只开一张:开一张,别的自动合上。
    var openId by remember { mutableStateOf<String?>(null) }
    var autoScrolling by remember { mutableStateOf(false) }
    // 用户自己滚动列表就合上(自动避让轨道那一下不算)。
    LaunchedEffect(grid.isScrollInProgress) {
        if (grid.isScrollInProgress && !autoScrolling) openId = null
    }
    // 列表里的主机没了(刚删掉)就别再记着它。
    LaunchedEffect(hosts) {
        if (openId != null && hosts.none { it.id == openId }) openId = null
    }

    /**
     * 打开的那张卡片如果停在轨道所在的那一段(列表底部约 150dp),右端露出的「删除」
     * 就正好压在轨道按钮底下,点下去点的是 ＋ 或 ⌕。先把它往上滚出来。
     */
    fun revealAboveRail(id: String) {
        if (!underRail) return
        val info = grid.layoutInfo
        val item = info.visibleItemsInfo.firstOrNull { it.key == id } ?: return
        val band = with(density) { (RailClearance - Gutter + 8.dp).toPx() }
        val limit = info.viewportEndOffset - band
        val bottom = (item.offset.y + item.size.height).toFloat()
        if (bottom > limit) {
            scope.launch {
                autoScrolling = true
                try {
                    grid.animateScrollBy(bottom - limit)
                } finally {
                    autoScrolling = false
                }
            }
        }
    }

    Box(modifier) {
        Column(Modifier.fillMaxSize()) {
            // 标题是内容的一部分,不是一条"标题栏" —— 它跟着列表一起,不占固定高度的横条。
            PaneTitle(
                Modifier
                    .fillMaxWidth()
                    .padding(start = Gutter + BoxPad, end = creaseGap, top = Gutter, bottom = GapItem),
                "X-SSH",
                if (total == 0) "还没有主机" else "$total 台主机 · 左滑可编辑或删除",
            )

            // 搜索平时不占地方,点轨道上的放大镜才出来。
            if (searching) {
                val focus = remember { FocusRequester() }
                LaunchedEffect(Unit) { runCatching { focus.requestFocus() } }
                // iOS 的搜索框:浅填充的胶囊,左边放大镜、右边清除,没有描边。
                Row(
                    Modifier
                        .fillMaxWidth()
                        .padding(start = Gutter, end = creaseGap)
                        .height(TouchMin)
                        .clip(RoundedCornerShape(TouchMin / 2))
                        .background(p.bgElev2)
                        .padding(start = 14.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Icon(XIcons.Search, null, tint = p.textDim, modifier = Modifier.size(19.dp))
                    Spacer(Modifier.width(8.dp))
                    Box(Modifier.weight(1f), contentAlignment = Alignment.CenterStart) {
                        if (query.isEmpty()) {
                            Text("搜索名称 / 地址 / 用户", color = p.textFaint, fontSize = 16.sp)
                        }
                        BasicTextField(
                            value = query,
                            onValueChange = onQuery,
                            singleLine = true,
                            textStyle = TextStyle(color = p.text, fontSize = 16.sp),
                            cursorBrush = SolidColor(p.accent),
                            modifier = Modifier.fillMaxWidth().focusRequester(focus),
                        )
                    }
                    Box(
                        Modifier
                            .size(TouchMin)
                            .clickable {
                                onQuery("")
                                onSearching(false)
                            }
                            .semantics { contentDescription = "关闭搜索" },
                        contentAlignment = Alignment.Center,
                    ) {
                        Icon(XIcons.Close, null, tint = p.textDim, modifier = Modifier.size(17.dp))
                    }
                }
                Spacer(Modifier.height(GapItem))
            }

            if (hosts.isEmpty()) {
                // 只可能是"搜了但没匹配上" —— 一台主机都没有时走的是整屏的 FirstRun。
                NoMatches(Modifier.weight(1f).fillMaxWidth())
            } else {
                LazyVerticalGrid(
                    columns = if (columns > 0) GridCells.Fixed(columns) else GridCells.Adaptive(264.dp),
                    state = grid,
                    modifier = Modifier.weight(1f).fillMaxWidth(),
                    // 底部留出轨道的高度,最后一张卡片能滚到它上面去。
                    contentPadding = PaddingValues(start = Gutter, end = creaseGap, bottom = RailClearance),
                    horizontalArrangement = Arrangement.spacedBy(GapItem),
                    // 列表不是卡片墙:行紧挨着,靠细线分隔。
                    verticalArrangement = Arrangement.spacedBy(0.dp),
                ) {
                    itemsIndexed(hosts, key = { _, it -> it.id }) { index, host ->
                        // 细线画在两行之间;选中行(整块强调色)上下都不画,免得在色块边上多出一道。
                        val next = hosts.getOrNull(index + 1)
                        val divider = next != null && host.id != selectedId && next.id != selectedId
                        // 行和分隔线要**上下排**。网格的每一项默认是叠放(Box),不包一层 Column 的话,
                        // 分隔线会画到每一行的顶部:标题下面多一条,最后两行之间反而少一条。
                        // 删掉一行之后,下面的行滑上来补位 —— animateItem 要挂在每一项的最外层。
                        Column(Modifier.animateItem()) {
                            val open = host.id == openId
                            SwipeActions(
                                open = open,
                                onDragStart = { if (openId != host.id) openId = null },
                                onOpenChange = { nowOpen ->
                                    openId = if (nowOpen) host.id else null
                                    if (nowOpen) revealAboveRail(host.id)
                                },
                                onEdit = {
                                    openId = null
                                    onEdit(host)
                                },
                                onDelete = {
                                    openId = null
                                    onDelete(host)
                                },
                            ) {
                                HostCard(
                                    host = host,
                                    large = large,
                                    selected = host.id == selectedId,
                                    running = host.id in running,
                                    // 开着的时候点卡片是"合上",不是连接 —— 和 iOS 一致。
                                    onPrimary = { if (openId != null) openId = null else onPrimary(it) },
                                    // 长按也能打开,给不知道要左滑的人一条路(不再弹那个菜单)。
                                    onLongPress = {
                                        openId = host.id
                                        revealAboveRail(host.id)
                                    },
                                )
                            }
                            if (divider) {
                                // 从文字起点开始,和参考图一样左侧内缩。
                                Box(
                                    Modifier
                                        .fillMaxWidth()
                                        .padding(start = BoxPad)
                                        .height(0.5.dp)
                                        .background(p.border),
                                )
                            }
                        }
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
            "添加之后:点一行直接连接,左滑编辑或删除。",
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
    onLongPress: () -> Unit,
) {
    val p = LocalXssh.current
    // 选中行是强调色底:文字、标签一律换成白色系,标签用半透明白底。
    val title = if (selected) p.onAccent else p.text
    val detail = if (selected) p.onAccent.copy(alpha = 0.82f) else p.textDim

    XsshCard(
        modifier = Modifier.fillMaxWidth(),
        highlight = selected,
        onClick = { onPrimary(host) },
        onLongClick = onLongPress,
        paddingVertical = if (large) 15.dp else 12.dp,
    ) {
        // 一行纯内容:名称 + 标签,地址独占一行。行尾不放 ⋮ —— 编辑/删除走左滑。
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(
                host.label,
                color = title,
                fontSize = if (large) 17.sp else 16.sp,
                fontWeight = FontWeight.SemiBold,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
                modifier = Modifier.weight(1f, fill = false),
            )
            Spacer(Modifier.width(8.dp))
            if (running) {
                Chip("运行中", if (selected) p.onAccent else p.ok)
                Spacer(Modifier.width(6.dp))
            }
            Chip(
                if (host.auth == AuthKind.KEY) "私钥" else "密码",
                when {
                    selected -> p.onAccent
                    host.auth == AuthKind.KEY -> p.accent
                    else -> p.warn
                },
            )
            if (host.keyFingerprint.isBlank()) {
                Spacer(Modifier.width(6.dp))
                Chip("密钥待确认", if (selected) p.onAccent else p.warn)
            }
        }
        Spacer(Modifier.height(if (large) 4.dp else 3.dp))
        Text(
            host.subtitle,
            color = detail,
            fontFamily = FontFamily.Monospace,
            fontSize = if (large) 14.sp else 13.sp,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
        )
    }
}

/** 左滑露出的按钮:一个"编辑"、一个"删除",各 72dp,彼此之间、和卡片之间各留 8dp。 */
private val ActionTile = 72.dp
private val ActionGap = 8.dp
private val RevealWidth = ActionTile * 2 + ActionGap * 2

/**
 * 左滑露出「编辑」「删除」(iOS 邮件/微信会话列表那种)。
 *
 * - 滑过一半松手就停在打开位置,不到一半弹回;快速甩一下按速度判断;
 * - 删除要点两下:第一下变成「确认删除」并铺满两格,第二下才删 —— 主机记录里有
 *   已信任的指纹和加密存着的密码,误删了要全部重填;
 * - 同一时刻只开一张,滚动列表或点卡片本身都会合上。
 *
 * 为什么不沿用长按菜单:长按是看不见的操作,弹出来的系统菜单又和卡片没有视觉关系。
 * 这个手势在国内安卓上本来就是日常(微信、QQ、短信的会话列表),不算照搬 iOS。
 * 注意别从屏幕最右边缘起手 —— 那一条归系统的返回手势,卡片离边 16dp 正好让开。
 */
@Composable
private fun SwipeActions(
    open: Boolean,
    modifier: Modifier = Modifier,
    onDragStart: () -> Unit,
    onOpenChange: (Boolean) -> Unit,
    onEdit: () -> Unit,
    onDelete: () -> Unit,
    content: @Composable () -> Unit,
) {
    val p = LocalXssh.current
    val haptic = LocalHapticFeedback.current
    val density = LocalDensity.current
    val scope = rememberCoroutineScope()
    val reveal = with(density) { RevealWidth.toPx() }
    val offset = remember { Animatable(0f) }
    var confirming by remember { mutableStateOf(false) }
    val motion = spring<Float>(dampingRatio = 0.86f, stiffness = 520f)

    // 外部改了开合(别的卡片被打开、列表滚动)就跟着动。
    LaunchedEffect(open) {
        if (!open) confirming = false
        offset.animateTo(if (open) -reveal else 0f, motion)
    }

    fun settle(position: Float, velocity: Float) {
        val shouldOpen = when {
            velocity < -900f -> true
            velocity > 900f -> false
            else -> -position > reveal / 2
        }
        scope.launch { offset.animateTo(if (shouldOpen) -reveal else 0f, motion, initialVelocity = velocity) }
        if (shouldOpen != open) onOpenChange(shouldOpen)
    }

    val progress = (-offset.value / reveal).coerceIn(0f, 1f)
    Box(
        modifier
            .fillMaxWidth()
            .height(IntrinsicSize.Min)
            .semantics {
                // 读屏用户做不了滑动手势,给同样的两个操作。
                customActions = listOf(
                    CustomAccessibilityAction("编辑") { onEdit(); true },
                    CustomAccessibilityAction("删除") { onDelete(); true },
                )
            },
    ) {
        Row(
            Modifier
                .matchParentSize()
                .graphicsLayer {
                    alpha = progress
                    // 从右边稍微"长"出来,而不是一块死板的底色被揭开。
                    val s = 0.9f + 0.1f * progress
                    scaleX = s
                    scaleY = s
                    transformOrigin = TransformOrigin(1f, 0.5f)
                },
            horizontalArrangement = Arrangement.End,
        ) {
            Spacer(Modifier.width(ActionGap))
            if (confirming) {
                SwipeTile("确认删除", p.bg, p.danger, Modifier.width(ActionTile * 2 + ActionGap)) {
                    haptic.performHapticFeedback(HapticFeedbackType.LongPress)
                    onDelete()
                }
            } else {
                SwipeTile("编辑", p.accent, p.accentSoft, Modifier.width(ActionTile)) { onEdit() }
                Spacer(Modifier.width(ActionGap))
                SwipeTile("删除", p.danger, p.danger.copy(alpha = 0.16f), Modifier.width(ActionTile)) {
                    haptic.performHapticFeedback(HapticFeedbackType.TextHandleMove)
                    confirming = true
                }
            }
        }
        Box(
            Modifier
                // 卡片**从右边往回收窄**,不是整块平移。
                //
                // 平移是 iOS 通栏列表的做法 —— 那种行本来就贴着屏幕两边。我们的是带边框的
                // 圆角卡片,整块往左推 160dp,名字被推出屏幕、边框被切掉一截,看着像坏了
                // (外屏实测:「local-test」整个看不见,只剩 ":2222" 露在左边)。
                // 收窄的话,左缘和名字原地不动,右边让出的位置正好放按钮。
                .layout { measurable, constraints ->
                    val full = constraints.maxWidth
                    val width = (full + offset.value.roundToInt()).coerceIn(0, full)
                    val placeable = measurable.measure(constraints.copy(minWidth = width, maxWidth = width))
                    layout(full, placeable.height) { placeable.place(0, 0) }
                }
                .pointerInput(Unit) {
                    val tracker = VelocityTracker()
                    var crossed = false
                    // 拖动期间自己累计手指位置。不能每帧读 offset.value 再加:snapTo 是异步
                    // 生效的,读到的常是上一帧的旧值,快拖时卡片会跟不上手指。
                    var finger = 0f
                    var shown = 0f
                    detectHorizontalDragGestures(
                        onDragStart = {
                            tracker.resetTracking()
                            finger = offset.value
                            shown = offset.value
                            crossed = -finger > reveal / 2
                            onDragStart()
                        },
                        onDragEnd = { settle(shown, tracker.calculateVelocity().x) },
                        onDragCancel = { settle(shown, 0f) },
                    ) { change, dx ->
                        change.consume()
                        tracker.addPosition(change.uptimeMillis, change.position)
                        finger = (finger + dx).coerceAtMost(0f)
                        // 往左拉过头带阻尼(只跟 30%),最多多出 15%;往右不能超过原位。
                        val next = if (finger < -reveal) -reveal + (finger + reveal) * 0.3f else finger
                        shown = next.coerceIn(-reveal * 1.15f, 0f)
                        scope.launch { offset.snapTo(shown) }
                        // 越过"松手就会打开"的那条线时轻震一下,手指知道到位了。
                        val nowCrossed = -next > reveal / 2
                        if (nowCrossed != crossed) {
                            crossed = nowCrossed
                            haptic.performHapticFeedback(HapticFeedbackType.TextHandleMove)
                        }
                    }
                },
        ) { content() }
    }
}

/** 左滑露出的一格按钮。形状和卡片同一圆角(12dp),高度跟卡片一样。 */
@Composable
private fun SwipeTile(label: String, fg: Color, bg: Color, modifier: Modifier, onClick: () -> Unit) {
    Box(
        modifier
            .fillMaxHeight()
            .clip(RoundedCornerShape(RadiusBox))
            .background(bg)
            .clickable(onClick = onClick),
        contentAlignment = Alignment.Center,
    ) {
        Text(label, color = fg, fontSize = 14.sp, fontWeight = FontWeight.Medium)
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
        // 删除要点两下,和左滑一致:第一下变「确认删除」,换一台主机就复位。
        var confirming by remember(host.id) { mutableStateOf(false) }
        Row(horizontalArrangement = Arrangement.spacedBy(GapItem)) {
            XsshButton("编辑", kind = ButtonKind.Ghost, modifier = Modifier.weight(1f)) { onEdit(host) }
            XsshButton(
                if (confirming) "确认删除" else "删除",
                kind = ButtonKind.Danger,
                modifier = Modifier.weight(1f),
            ) {
                if (confirming) onDelete(host) else confirming = true
            }
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
            // 参考图的大标题:34sp、粗体,紧跟一行灰色小字。
            fontSize = 34.sp,
            fontWeight = FontWeight.Bold,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
        )
        Spacer(Modifier.height(2.dp))
        Text(
            subtitle,
            color = p.textDim,
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
        Text(label, color = p.textDim, fontSize = 13.sp)
        Spacer(Modifier.height(4.dp))
        Text(value, color = p.text, fontFamily = FontFamily.Monospace, fontSize = 13.sp)
    }
}
