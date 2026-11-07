package dev.xssh.android

import kotlinx.coroutines.flow.first
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.runtime.produceState
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.TextUnit
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.runtime.snapshotFlow
import androidx.activity.compose.BackHandler
import androidx.compose.animation.togetherWith
import androidx.compose.animation.fadeOut
import androidx.compose.animation.fadeIn
import androidx.compose.animation.AnimatedContent
import androidx.compose.foundation.lazy.grid.GridItemSpan
import androidx.compose.animation.AnimatedVisibility
import com.kyant.backdrop.backdrops.rememberLayerBackdrop
import com.kyant.backdrop.backdrops.layerBackdrop
import androidx.compose.foundation.layout.union
import androidx.compose.foundation.layout.systemBars
import androidx.compose.foundation.layout.displayCutout
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.animation.core.tween
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.material3.Icon
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.lazy.grid.itemsIndexed
import androidx.compose.ui.layout.layout
import kotlinx.coroutines.launch
import kotlinx.coroutines.delay
import kotlin.math.roundToInt
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.customActions
import androidx.compose.ui.semantics.CustomAccessibilityAction
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.input.pointer.util.VelocityTracker
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.runtime.derivedStateOf
import com.kyant.backdrop.effects.blur
import com.kyant.backdrop.effects.vibrancy
import com.kyant.backdrop.drawBackdrop
import androidx.compose.foundation.gestures.awaitFirstDown
import androidx.compose.foundation.gestures.awaitEachGesture
import androidx.compose.ui.layout.boundsInRoot
import androidx.compose.ui.layout.positionInRoot
import androidx.compose.ui.layout.onGloballyPositioned
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.graphics.TransformOrigin
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.draw.clip
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.foundation.lazy.grid.LazyGridState
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
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.layout.safeDrawing
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.Canvas
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
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
import androidx.compose.foundation.focusable
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.input.key.Key
import androidx.compose.ui.input.key.isCtrlPressed
import androidx.compose.ui.input.key.key
import androidx.compose.ui.input.key.onInterceptKeyBeforeSoftKeyboard
import androidx.compose.ui.input.key.onPreviewKeyEvent
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.ui.graphics.Brush

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
    /** 用户自己选了一台(双栏里点卡片、方向键)。 */
    onSelect: (Host) -> Unit,
    /** 双栏右边不能空着,自动选中第一台 —— 不算用户选的(合上时不会因此停在详情页)。 */
    onAutoSelect: (Host) -> Unit,
    onConnect: (Host) -> Unit,
    /** 单栏卡片上的 ⓘ:推进这台主机的详情页。 */
    onInfo: (Host) -> Unit,
    /** 选终端字体。 */
    onFonts: () -> Unit,
    onNew: () -> Unit,
    onEdit: (Host) -> Unit,
    onDelete: (Host) -> Unit,
    /** 置顶 / 取消置顶(双栏右栏详情里的开关)。 */
    onPin: (Host) -> Unit,
) {
    val adaptive = LocalAdaptive.current
    val p = LocalXssh.current
    // 哪些主机后台还连着 —— 卡片上要看得出来,不然用户不知道有会话在跑。
    val running by SessionRegistry.sessions.collectAsState()
    // 会话区:活着的会话排在主机区上面(和平板侧栏同一套两段模型),按最后输出新→旧。
    // 不查主机表:会话自己带着建连那一刻的 Host,主机被删了(dev 跳转根本没存过也一样)行还在。
    val sessions = remember(running) {
        running.values.sortedByDescending { it.lastOutputAt }
    }
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
    // 列表滚到哪由这一页记着,不跟着某一栏:展开 / 合上时单栏和双栏是两棵不同的树,
    // 各记各的话,一展开列表就跳回顶上。
    val grid = rememberLazyGridState()
    // 搜索开着时,返回先收起搜索,而不是直接退出应用。
    BackHandler(enabled = searching) {
        query = ""
        searching = false
    }

    // 右栏要显示哪台:**在组合期间就算出来**,不能等副作用。
    //
    // 原来是用 LaunchedEffect 去"自动选中第一台",而副作用要等第一次组合之后才跑 ——
    // 于是冷启动时右栏先渲染一帧「选择左边的主机」的空状态,下一帧才换成真内容,
    // 看上去就是打开应用闪跳一下(录屏第 296 帧拍到的就是这个)。
    // **右栏显示哪一台,要和左边列表(过滤之后的)一致。**
    // 原来是从未过滤的 `hosts` 里取:搜索之后左边只剩 "prod-web"、右栏却还显示着
    // 上一次选中的 "backup-nas",这时候按回车连的是 `filtered` 里的第一条 ——
    // **连上的机器和屏幕上写着的不是同一台**。
    val shownHost = filtered.firstOrNull { it.id == selectedId } ?: filtered.firstOrNull()

    // 浮在内容上的玻璃按钮(右侧轨道)要模糊、折射的,就是这一页的内容。
    val backdrop = rememberLayerBackdrop()

    // 折叠屏:按钮在右侧轨道;直板机:按钮全在底栏(见 Chrome)。两种都不在顶上占地方。
    val bottomBar = LocalChrome.current == Chrome.BottomBar
    // 主机页的玻璃轨道现在只有一枚胶囊(搜索 + 新建,2 × 56dp),离底 16 再留 16 的缝 —— 约 160dp。
    // 原来按"外观、字体、搜索 + ＋"四颗算成 270dp:左滑露出按钮的那行只要在屏幕下半截,
    // 「别被轨道压住」的自动上滚就会触发,整张列表莫名往上跳(越靠下的行跳得越高)。
    val clearance = if (bottomBar) BarClearance else HomeRailSize * 2 + Gutter * 3
    val statusTop = with(LocalDensity.current) { stableSafeDrawing().getTop(this).toDp() }
    // 列表的橡皮筋位移(往上拉为负),顶栏据此判断内容是不是正钻到它底下。
    val bounceOffset = remember { androidx.compose.runtime.mutableFloatStateOf(0f) }

    // 实体键盘(平板键盘套):Ctrl+N 新建、Ctrl+F 搜索、↑↓ 换主机、回车连接、Esc 收起搜索。
    // 键盘事件只发给有焦点的节点,所以这一页自己拿一个焦点(不是输入框,不会弹软键盘)。
    val hardKeyboard = LocalConfiguration.current.hasHardKeyboard()
    val homeFocus = remember { FocusRequester() }
    // 分栏与否在下面量窗口宽度时才知道,按键处理要读最新值。
    val paneMode = remember { booleanArrayOf(false) }
    LaunchedEffect(hardKeyboard, searching) {
        if (hardKeyboard && !searching) runCatching { homeFocus.requestFocus() }
    }
    val onKey: (androidx.compose.ui.input.key.KeyEvent) -> Boolean = handler@{ event ->
        val e = event.nativeKeyEvent
        if (e.action != android.view.KeyEvent.ACTION_DOWN) return@handler false
        val ctrl = e.isCtrlPressed && !e.isAltPressed
        val code = e.keyCode
        when {
            ctrl && code == android.view.KeyEvent.KEYCODE_N -> onNew()
            ctrl && code == android.view.KeyEvent.KEYCODE_F && hosts.isNotEmpty() -> searching = true
            code == android.view.KeyEvent.KEYCODE_ESCAPE && searching -> {
                query = ""
                searching = false
            }
            paneMode[0] && (code == android.view.KeyEvent.KEYCODE_DPAD_UP ||
                code == android.view.KeyEvent.KEYCODE_DPAD_DOWN) -> {
                if (filtered.isEmpty()) return@handler false
                val at = filtered.indexOfFirst { it.id == selectedId }
                val step = if (code == android.view.KeyEvent.KEYCODE_DPAD_UP) -1 else 1
                val next = if (at < 0) 0 else (at + step).coerceIn(0, filtered.lastIndex)
                onSelect(filtered[next])
            }
            code == android.view.KeyEvent.KEYCODE_ENTER || code == android.view.KeyEvent.KEYCODE_NUMPAD_ENTER -> {
                // 双栏连右边正显示的那台;单栏只有搜索时才有"那一台"(第一条结果)。
                val target = if (paneMode[0]) {
                    filtered.firstOrNull { it.id == selectedId } ?: filtered.firstOrNull()
                } else {
                    filtered.firstOrNull()?.takeIf { searching }
                }
                target?.let(onConnect) ?: return@handler false
            }
            else -> return@handler false
        }
        true
    }

    BoxWithConstraints(
        Modifier
            .fillMaxSize()
            .background(p.bg)
            // 搜索框开着时中文输入法会先吃按键;Ctrl 组合键赶在它前面拿(组词不用 Ctrl)。
            // Esc 只在搜索框是空的时候抢:组词中的拼音也会进 query,空着就一定没在组词。
            .onInterceptKeyBeforeSoftKeyboard {
                val esc = it.key == Key.Escape && searching && query.isEmpty()
                if (it.isCtrlPressed || esc) onKey(it) else false
            }
            .onPreviewKeyEvent(onKey)
            .focusRequester(homeFocus)
            .focusable(),
    ) {
        // 用**实测到的窗口宽度**判断分栏,不用 Configuration 的 screenWidthDp ——
        // 分屏时部分机型的 screenWidthDp 仍报整块屏幕的宽度,那样会在只有半屏宽的窗口里
        // 摆出双栏:左栏按折痕位置占满整个窗口,右栏被挤到窗口之外,看起来就是内容跑到右边。
        val twoPane = adaptive.splits(maxWidth)
        paneMode[0] = twoPane

        // 只有双栏才自动选中:右栏必须有东西可看。
        // 单栏(外屏)里"选中"没有任何去处 —— 点卡片是直接连接 —— 自动选中只会让
        // 第一张卡片一进来就带着高亮边框,看着像用户点过,实际没点过。
        LaunchedEffect(twoPane, shownHost?.id) {
            if (twoPane && selectedId != shownHost?.id) shownHost?.let(onAutoSelect)
        }

        // 再兜一层:左栏无论如何不能吃掉整个窗口。
        // 这几个量放在分支外面:直板机横屏的底栏只铺在左栏底下,右端要和左栏卡片的右缘对齐,也要用。
        val listWidth = adaptive.listPaneWidth(maxWidth).coerceAtMost(maxWidth - 280.dp)
        val creaseWidth = maxOf(1.dp, adaptive.bookFold?.sizeDp ?: 0.dp)
        // 两栏内容一样宽(式子见 creaseGapFor)。右栏正文自己还限宽 PageMaxWidth
        // (见 HostInfoBody),超过就不再变长,左栏也跟着停。
        val detailContent = ((maxWidth - listWidth - creaseWidth) - Gutter * 2 - railSide())
            .coerceAtMost(PageMaxWidth)
        val creaseGap = creaseGapFor(listWidth, Gutter, detailContent)
        // 真分成了两栏(一台主机都没有时是整屏的 FirstRun,不分栏)。
        val split = twoPane && hosts.isNotEmpty()
        if (split) {
            Row(Modifier.fillMaxSize().layerBackdrop(backdrop)) {
                HostListPane(
                    grid = grid,
                    modifier = Modifier
                        .width(listWidth)
                        .fillMaxHeight()
                        // 左栏比右边纯黑的详情亮一档(iOS 版的侧栏做法);底色要铺在安全区内边距之前,
                        // 状态栏和导航条后面也是这一档。
                        .background(p.sidebar)
                        .windowInsetsPadding(
                            stableSafeDrawing().only(
                                WindowInsetsSides.Vertical + WindowInsetsSides.Start,
                            ),
                        ),
                    hosts = filtered,
                    total = hosts.size,
                    selectedId = shownHost?.id,
                    onPrimary = onSelect,
                    // 双栏:详情就在右边,卡片上不再放 ⓘ。
                    onInfo = null,
                    onNew = onNew,
                    onSettings = onFonts,
                    onEdit = onEdit,
                    onDelete = onDelete,
                    query = query,
                    onQuery = { query = it },
                    searching = searching,
                    onSearching = { searching = it },
                    running = running.keys,
                    sessions = sessions,
                    onOpenSession = onConnect,
                    columns = 1,
                    large = false,
                    // 见上面 creaseGap 的算法:收到和右栏一样宽。
                    creaseGap = creaseGap,
                    // 折叠屏双栏:轨道在右栏上方,不压列表。直板机横屏:底栏压在这一栏底下。
                    underRail = bottomBar,
                    topPad = 0.dp,
                    // 轨道既然不在这一栏上面,就**别按轨道的高度留白**。原来这里也传了
                    // `clearance`(270dp):内屏横屏可视高度才 600dp 上下,等于左栏下面
                    // 空掉快一半,而且把"选中项滚进视野"的算式也带偏 —— 每按一下 ↓ 都在滚。
                    // 直板机横屏:底栏就铺在这一栏底下(右栏是详情,自己钉着「连接」),这里要让开它。
                    bottomClearance = if (bottomBar) BarClearance else Gutter,
                )
                // 两栏之间不画线:折痕本身就是分界,再补一条反而多余。
                Spacer(Modifier.width(creaseWidth))
                // 换一台主机时详情淡入淡出,不是生硬地一帧换掉。
                AnimatedContent(
                    targetState = shownHost,
                    contentKey = { it?.id },
                    transitionSpec = { fadeIn(Motion.reveal()) togetherWith fadeOut(Motion.reveal()) },
                    modifier = Modifier
                        .weight(1f)
                        .fillMaxHeight()
                        .windowInsetsPadding(
                            stableSafeDrawing().only(
                                WindowInsetsSides.Vertical + WindowInsetsSides.End,
                            ),
                        ),
                    // 直板机横屏时右上角浮着外观 / 搜索,这里不为它往下让:两栏标题要在同一条基线上;
                    // 标题左对齐,只有特别长的主机名才会伸到按钮底下(会被省略号截断)。
                    label = "detail",
                ) { host ->
                    HostDetailPane(
                        modifier = Modifier.fillMaxSize(),
                        host = host,
                        running = host != null && host.id in running,
                        session = host?.let { running[it.id] },
                        onConnect = onConnect,
                        onEdit = onEdit,
                        onDelete = onDelete,
                        onPin = onPin,
                    )
                }
            }
        } else if (hosts.isEmpty()) {
            FirstRun(Modifier.fillMaxSize().windowInsetsPadding(stableSafeDrawing()), onNew = onNew)
        } else {
            HostListPane(
                grid = grid,
                // 内容通到边缘,从右边缘玻璃层底下穿过去(规范:scroll views extend
                // beneath floating glass)。底部多留一段,最后一张卡片能滚出轨道之外。
                // 顶部不再让出状态栏:列表通到屏幕顶,从顶栏的毛玻璃底下滚过去(iOS 导航栏同款);
                // 开头的空位由 topPad 补(=状态栏高度),静止时位置和以前一样。
                modifier = Modifier.fillMaxSize().layerBackdrop(backdrop)
                    .windowInsetsPadding(stableSafeDrawing().only(WindowInsetsSides.Horizontal + WindowInsetsSides.Bottom)),
                hosts = filtered,
                total = hosts.size,
                // 单栏没有"当前选中"这个概念,别画高亮。
                selectedId = null,
                onPrimary = onConnect,
                onInfo = onInfo,
                onNew = onNew,
                onSettings = onFonts,
                onEdit = onEdit,
                onDelete = onDelete,
                query = query,
                onQuery = { query = it },
                searching = searching,
                onSearching = { searching = it },
                running = running.keys,
                sessions = sessions,
                onOpenSession = onConnect,
                // 单栏(外屏、内屏竖屏)一律单列、大号的行。
                // 原来按 264dp 自适应,竖屏排成两列,每张卡片只有 280dp 宽、57dp 高,
                // 在 860dp 高的屏幕上缩在左上角,七成空着。
                columns = 1,
                large = true,
                // 单栏:右边让开玻璃胶囊。胶囊宽 58dp + 离边 16dp = 74dp,再留 8dp 的缝;行内右缩进 BoxPad 已占 16dp,
                // 所以这里是 66dp(原来是整条轨道 88dp,色点离右边比 iPhone Duo 远了一截)。
                // 玻璃胶囊浮在列表上面(列表在它下面滚),和 iPhone Duo 一样,色点贴着右边;左右对称各 6dp。
                // 现在:色点不能压到右侧玻璃菜单下面,离菜单左缘留 10px(≈3.6dp):
                // 菜单左缘离屏幕右边 Gutter + 56dp;色点右缘离列表右边 = creaseGap + BoxPad。
                creaseGap = if (LocalChrome.current == Chrome.Rail) Gutter + HomeRailSize + 6.6.dp - BoxPad else railSide(),   // 3.6 → 6.6dp:圆点再往左一丢丢(离菜单约 18px)
                underRail = true,
                topPad = statusTop,
                bottomClearance = clearance,
                fixedLogo = true,
                bounceOut = bounceOffset,
            )
            // 顶栏:字标固定在上面;列表一滚,背后出现模糊的深色毛玻璃 + 底边一条细线(iOS 导航栏的滚动边缘效果)。
            HomeTopBar(
                Modifier.align(Alignment.TopStart),
                grid = grid,
                bounceOffset = bounceOffset,
                backdrop = backdrop,
                statusTop = statusTop,
                onSettings = onFonts,
            )
        }

        // 外观、字体、搜索都是"怎么看"的操作,装进同一枚胶囊。
        // 外观点一下切到下一个模式(跟随系统 → 浅色 → 深色 → …),不弹窗;字体要挑,推一页出来。
        // 和 iPhone Duo 的主机页一样,玻璃胶囊里只有两颗:搜索、新建。
        // 外观 / 设置 / 快照原来也挤在这里,现在收到列表末尾的三行(见 FooterRows),界面四周只剩两颗按钮。
        val searchItem: @Composable () -> Unit = {
            GlassItem(XIcons.Search, stringResource(R.string.host_search_hosts)) {
                searching = !searching
                if (!searching) query = ""
            }
        }
        val newLabel = stringResource(R.string.host_new_host)
        // 主操作:无色玻璃、正文色图标。
        val newHost: @Composable () -> Unit = { GlassButton(XIcons.Plus, newLabel) { onNew() } }

        if (bottomBar) {
            // 直板机:底栏。左边外观 / 字体 / 搜索,右边 ＋ —— 安卓底部操作栏的排法(动作在左、主按钮在右)。
            // 横屏双栏时只铺在左栏(列表)底下:右栏是详情,自己钉着「连接 / 编辑 / 删除」,别叠在一起。
            CompositionLocalProvider(LocalBackdrop provides backdrop) {
                BottomBar(
                    if (split) {
                        // ＋ 的右缘落在卡片的右缘上(卡片止于折痕前 creaseGap,底栏自己带了一条 Gutter)。
                        Modifier.align(Alignment.BottomStart).width(listWidth).padding(end = creaseGap - Gutter)
                    } else {
                        Modifier.align(Alignment.BottomCenter)
                    },
                    sides = if (split) {
                        WindowInsetsSides.Start + WindowInsetsSides.Bottom
                    } else {
                        WindowInsetsSides.Horizontal + WindowInsetsSides.Bottom
                    },
                    // 一台主机都没有时不摆搜索 —— 没东西可搜。
                    start = { if (hosts.isNotEmpty()) GlassGroup { searchItem() } },
                    end = { newHost() },
                )
            }
        } else {
            // 折叠屏:chrome 全在右侧这条轨道里,界面四角不散落按钮;列表从玻璃底下滚过去。
            // 胶囊从底部往上长,搜索在下(和编辑页的 ‹、终端页的键盘同一个位置),外观在上。
            CompositionLocalProvider(LocalBackdrop provides backdrop) {
                // 主机页的这枚竖胶囊比别的页小 20%(56 → 45dp),腾出高度给列表。
                CompositionLocalProvider(LocalGlassSize provides HomeRailSize) {
                    EdgeRail(Modifier.align(Alignment.BottomEnd)) {
                        if (hosts.isNotEmpty()) {
                            // 一枚竖胶囊:搜索在上、新建在下(iPhone Duo 外屏同款)。
                            GlassGroup {
                                searchItem()
                                GlassItem(XIcons.Plus, newLabel) { onNew() }
                            }
                        } else {
                            newHost()
                        }
                    }
                }
            }
        }

    }
}

@Composable
internal fun HostListPane(
    grid: LazyGridState,
    modifier: Modifier,
    hosts: List<Host>,
    total: Int,
    selectedId: String?,
    onPrimary: (Host) -> Unit,
    /** 卡片右端的 ⓘ(单栏才有):看这台主机的详情。 */
    onInfo: ((Host) -> Unit)?,
    onNew: () -> Unit,
    /** 点左上角的字标进设置(设计方案 A:外观 / 字体 / 配色 / 快照都在设置里)。 */
    onSettings: () -> Unit,
    onEdit: (Host) -> Unit,
    onDelete: (Host) -> Unit,
    query: String,
    onQuery: (String) -> Unit,
    searching: Boolean,
    onSearching: (Boolean) -> Unit,
    running: Set<String>,
    /** 活着的会话(会话区),已按最后输出排序。 */
    sessions: List<TerminalSession>,
    /** 会话行的点击:接管那条会话(双栏里这不是"选中",是直接进终端)。 */
    onOpenSession: (Host) -> Unit,
    columns: Int,
    /** 单栏用大号的行:外屏和竖屏上一行就是一个手指目标,不该是一行小字。 */
    large: Boolean,
    /** 靠折痕(或屏幕右缘)那一侧的留白。 */
    creaseGap: Dp,
    /** 列表底部是否压着按钮(轨道或底栏):左滑露出的按钮不能落在它们底下。 */
    underRail: Boolean,
    /** 单栏:字标不在列表里,钉在顶栏上(见 HomeTopBar,和 iOS 导航栏一样);这里只留出它的位置。 */
    fixedLogo: Boolean = false,
    /** 橡皮筋回弹的当前位移(px)输出给顶栏用。 */
    bounceOut: androidx.compose.runtime.MutableFloatState? = null,
    /** 标题上面额外留的高度(现在各形态顶上都没有按钮,都是 0)。 */
    topPad: Dp,
    /** 列表底部给按钮留的高度:折叠屏是整条轨道,直板机是底栏。 */
    bottomClearance: Dp,
    /** 选中的那一行要不要垫一块灰底(内屏抽屉里不要:运行中的那行靠绿色箭头、光标和「✓ 运行中」就够认了)。 */
    selectionFill: Boolean = true,
) {
    val p = LocalXssh.current
    val scope = rememberCoroutineScope()
    val density = LocalDensity.current
    // 活着的会话在主机行上就地显示(绿色 `❯` + 光标 + 「✓ 运行中 · 时长」,设计方案 A / iPhone Duo),
    // 不再另起一个「会话」区重复列一遍。只有**主机已经被删掉**的会话(会话自己带着建连那一刻的 Host)
    // 在列表里没有对应的行,才单独列在上面,免得变成点不到的孤儿。
    val knownHosts = LocalHosts.current
    val orphans = remember(sessions, knownHosts) { sessions.filter { s -> knownHosts.none { it.id == s.hostId } } }
    // 会话区只在没搜索时出现:搜索找的是"我要连哪台",活会话是"我正在干什么",两回事别搅在一起。
    val showSessions = orphans.isNotEmpty() && query.isBlank()
    // 卡片前面排了几项非主机条目(标题 + 会话区标题 + 会话行 + 主机区标题),
    // "把它滚进视野"的算式要用(原来固定 +1,加了会话区就会算错行)。
    val hostsPrelude = 1 + if (showSessions) orphans.size + 2 else 0
    // 同一时刻只开一张:开一张,别的自动合上。
    var openId by remember { mutableStateOf<String?>(null) }
    var autoScrolling by remember { mutableStateOf(false) }
    // 用户自己滚动列表就合上(自动避让轨道那一下不算)。
    LaunchedEffect(grid.isScrollInProgress) {
        if (grid.isScrollInProgress && !autoScrolling) openId = null
    }
    // 打开搜索时列表可能正滚在中间,搜索框在最上面看不见 —— 先滚回顶上。
    LaunchedEffect(searching) {
        if (searching) grid.animateScrollToItem(0)
    }
    // 右栏换成了列表里看不见的那一台(外屏看着详情时展开、方向键走到底):把它滚进来。
    // 只挪到刚好露出来为止,不把它顶到最上面(那样标题会被推出去)。
    LaunchedEffect(selectedId) {
        val id = selectedId ?: return@LaunchedEffect
        val index = hosts.indexOfFirst { it.id == id }.takeIf { it >= 0 } ?: return@LaunchedEffect
        // 第 0 项是标题,卡片从 1 开始;会话区插在中间,偏移量见 hostsPrelude。
        val item = index + hostsPrelude
        // 刚换成这一栏时列表还没排过版,等它排出第一屏再量。
        val info = snapshotFlow { grid.layoutInfo }.first { it.visibleItemsInfo.isNotEmpty() }
        val shown = info.visibleItemsInfo.firstOrNull { it.index == item }
        val bottom = info.viewportEndOffset - with(density) { bottomClearance.roundToPx() }
        when {
            shown == null -> grid.animateScrollToItem(item)
            shown.offset.y < 0 -> grid.animateScrollBy(shown.offset.y.toFloat())
            shown.offset.y + shown.size.height > bottom ->
                grid.animateScrollBy((shown.offset.y + shown.size.height - bottom).toFloat())
        }
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
        val band = with(density) { (bottomClearance - Gutter + 8.dp).toPx() }
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

    // 打开着左滑按钮时,点按钮所在那一行以外的任何地方(别的行、标题、空白)都把它合上。
    // 在 Initial 阶段只"看"不"吃":这一下照常传给被点的东西(点别的行 = 合上 + 不连接,见 onPrimary)。
    var listOrigin by remember { mutableStateOf(Offset.Zero) }
    val rowBounds = remember { mutableMapOf<String, androidx.compose.ui.geometry.Rect>() }
    Box(
        modifier
            .onGloballyPositioned { listOrigin = it.positionInRoot() }
            .pointerInput(Unit) {
                awaitEachGesture {
                    val down = awaitFirstDown(requireUnconsumed = false, pass = androidx.compose.ui.input.pointer.PointerEventPass.Initial)
                    // 落在任何一行里(自己那行、别的行)都不在这里处理:自己那行和别的行的点击会走 onPrimary
                    // —— 它看到还开着就只合上、不连接。只有落在行以外(标题、logo、空白)才在按下时合上。
                    // (试过等抬起再合上:adb / 快速轻点时抬起事件会漏掉,合不上。)
                    val at = down.position + listOrigin
                    if (openId != null && rowBounds.values.none { it.contains(at) }) openId = null
                }
            },
    ) {
        LazyVerticalGrid(
            columns = if (columns > 0) GridCells.Fixed(columns) else GridCells.Adaptive(264.dp),
            state = grid,
            modifier = Modifier.fillMaxSize().bounce(bounceOut),
            // 底部留出轨道的高度,最后一张卡片能滚到它上面去。
            // 左边只留 6dp:行首的 `❯` 加上行内缩进 BoxPad 正好落在离屏幕边 22dp 的地方,
            // 和 iPhone Duo 一样(原来是 Gutter 16 + 16 = 32,整张列表比参考往里缩了一截)。
            contentPadding = PaddingValues(start = 6.dp, end = creaseGap, top = topPad, bottom = bottomClearance),
            horizontalArrangement = Arrangement.spacedBy(GapItem),
            // 行是"裸行",行与行之间靠一条虚线(行自己带在下面),不再用缝隔开。
            verticalArrangement = Arrangement.spacedBy(0.dp),
        ) {
            // 标题和搜索框也是列表的一项(iOS 的大标题就是这样):整页一起滚、一起回弹,
            // 在标题上往下拖也有反应,而不是只有卡片那一截能动。
            item(key = "header", span = { GridItemSpan(maxLineSpan) }) {
                Column {
                    // 字标在上、`$ hosts` + 数量在下 —— iPhone Duo 主机页的标题区:
                    // 字标靠左上,和标题、每行的 `❯` 在同一条竖线上。
                    // (列表的 contentPadding 已经让开了 Gutter,所以这里只补盒内缩进 BoxPad:
                    // 原来补的是 RowInset = Gutter + BoxPad,标题比行首的 `❯` 右出了一个 Gutter。)
                    val settingsLabel = stringResource(R.string.set_title)
                    Column(
                        Modifier
                            .fillMaxWidth()
                            .padding(start = BoxPad - TitleOptical, top = Gutter, bottom = 10.dp),
                    ) {
                        // 点字标进设置:主页的玻璃胶囊里只留搜索和新建(和 iPhone Duo 一样)。
                        // 字标素材换成了不变形的版本(宽高比 3.9,原来被压成 4.46),
                        // 高度 19 → 22dp,让宽度还是约 85dp(和 iPhone Duo 的 84pt 一样)。
                        if (fixedLogo) {
                            Spacer(Modifier.height(25.dp + 26.dp))   // 字标(25dp)+ 它和标题的间距(26dp),字标本身在顶栏里
                        } else {
                            BrandLockup(
                                25.dp,
                                Modifier
                                    .clip(RoundedCornerShape(6.dp))
                                    .clickable(onClick = onSettings)
                                    .semantics { contentDescription = settingsLabel },
                            )
                            Spacer(Modifier.height(26.dp))
                        }
                        HostsTitle(total)
                    }
                    // 搜索平时不占地方,点轨道上的放大镜才展开出来。
                    AnimatedVisibility(searching, enter = Motion.revealIn, exit = Motion.revealOut) {
                        SearchField(
                            Modifier.padding(top = GapItem),
                            query = query,
                            onQuery = onQuery,
                            onClose = {
                                onQuery("")
                                onSearching(false)
                            },
                        )
                    }
                }
            }
            if (hosts.isEmpty()) {
                // 只可能是"搜了但没匹配上" —— 一台主机都没有时走的是整屏的 FirstRun。
                item(key = "none", span = { GridItemSpan(maxLineSpan) }) {
                    NoMatches(query, Modifier.fillMaxWidth().padding(top = 48.dp).animateItem())
                }
            }
            // 会话区:活着的会话在最上面,点一行 = 接管(和平板侧栏同一个模型)。
            if (showSessions) {
                item(key = "sec-sessions", span = { GridItemSpan(maxLineSpan) }) {
                    SectionHeader(stringResource(R.string.tab_sessions))
                }
                itemsIndexed(orphans, key = { _, it -> "s:" + it.hostId }) { index, session ->
                    Column(Modifier.animateItem()) {
                        SessionRow(
                            session = session,
                            large = large,
                            onOpen = { onOpenSession(session.host) },
                        )
                        if (index != orphans.lastIndex) DashedDivider(Modifier.padding(horizontal = BoxPad))
                    }
                }
                item(key = "sec-hosts", span = { GridItemSpan(maxLineSpan) }) {
                    SectionHeader(stringResource(R.string.tab_hosts))
                }
            }
            itemsIndexed(hosts, key = { _, it -> it.id }) { index, host ->
                // 删掉一张之后,下面的卡片滑上来补位 —— animateItem 要挂在每一项的最外层。
                Column(
                    Modifier
                        .animateItem()
                        .onGloballyPositioned { rowBounds[host.id] = it.boundsInRoot() },
                ) {
                    val open = host.id == openId
                    SwipeActions(
                        open = open,
                        // 它被别的哪些主机当作跳板机:确认删除时要说清楚。
                        jumpUsedBy = LocalHosts.current.count { it.jumpHostId == host.id },
                        onDragStart = { if (openId != host.id) openId = null },
                        onOpenChange = { nowOpen ->
                            openId = if (nowOpen) host.id else null
                            if (nowOpen) revealAboveRail(host.id)
                        },
                        onEdit = {
                            openId = null
                            onEdit(host)
                        },
                        // 详情(单栏才有):原来是行尾的 ⓘ,iPhone Duo 的行里没有这种按钮,改成左滑露出的第三格。
                        onInfo = onInfo?.let { info ->
                            {
                                openId = null
                                info(host)
                            }
                        },
                        onDelete = {
                            openId = null
                            onDelete(host)
                        },
                    ) {
                        HostCard(
                            host = host,
                            large = large,
                            selected = selectionFill && host.id == selectedId,
                            running = host.id in running,
                            startedAt = sessions.firstOrNull { it.hostId == host.id }?.startedAt,
                            // 开着的时候点卡片是"合上",不是连接 —— 和 iOS 一致。
                            onPrimary = { if (openId != null) openId = null else onPrimary(it) },
                            onInfo = null,
                            // 长按也能打开,给不知道要左滑的人一条路(不再弹那个菜单)。
                            onLongPress = {
                                openId = host.id
                                revealAboveRail(host.id)
                            },
                        )
                    }
                    // 虚线在滑动层外面:左滑时只有行本身收窄,线不动。
                    if (index != hosts.lastIndex) DashedDivider(Modifier.padding(horizontal = BoxPad))
                }
            }
        }
    }
}

/** 列表行、标题、搜索框的文字起点:盒子线(Gutter)+ 盒内缩进(BoxPad)= 32dp。 */
private val RowInset = Gutter + BoxPad

/**
 * 行名字的字号:和 iPhone Duo 一样是 19(原来单栏 17、双栏 16,整张列表比参考小一圈)。
 * `❯` 的宽度按它算(iOS 版是 14/19)。
 */
@Suppress("UNUSED_PARAMETER")
private fun rowFontSize(large: Boolean) = 16.sp   // 19 → 17:等宽字换成 0.6em 的 Droid Sans Mono 后每个字宽了约 25%,字号收一点才和 iOS 的版面比例一致

/**
 * 名字里的空格收窄 30%(iOS 版 `Text.narrowingSpaces`):等宽字的空格太宽,「AI TOP ATOM 0」
 * 读起来是一个个孤立的字;收窄之后才像一个名字。等宽字的字宽约 0.6em,所以每个空格后面收回
 * 字号 × 0.6 × 0.3 × 1.4(1.4 是 iOS 那边量出来的"眼睛看到的空隙"系数)。
 */
private fun narrowSpaces(text: String, font: TextUnit): AnnotatedString = buildAnnotatedString {
    // 空格缩到 58% 宽(iOS:字宽 0.6em 的空格收回 0.6×0.3×1.4=0.252em)。
    // 用字号 span 而不是负字距:带负字距 span 的文字在 maxLines=1 + 省略号下被提前截断(名字只显示 10 个字符就 …)。
    val small = (font.value * 0.58f).sp
    for (ch in text) {
        if (ch == ' ') withStyle(SpanStyle(fontSize = small)) { append(ch) } else append(ch)
    }
}

/** `❯` 占的宽度和它到名字的间距;状态行的缩进用同一组数,才和名字的起点对齐。 */
@Composable
private fun promptWidth(font: TextUnit): Dp = with(LocalDensity.current) { (font.value * 14f / 19f).sp.toDp() }

private val PromptGap = 9.dp

/** `❯`:装饰符号,读屏跳过。[color] 默认是 40% 的正文色,连着的那台传绿色。 */
@Composable
private fun Prompt(font: TextUnit, color: Color? = null, modifier: Modifier = Modifier) {
    val p = LocalXssh.current
    Text(
        "❯",
        color = color ?: p.text.copy(alpha = 0.4f),
        fontFamily = XsshFonts.monoUi,
        fontSize = font,
        maxLines = 1,
        // 往上抬一点:iOS 版抬 0.07 倍字号;0.16 倍太高了,取 0.08 ≈ 1.3dp。
        modifier = modifier.offset(y = -(font.value * 0.08f).dp).width(promptWidth(font)).clearAndSetSemantics { },
    )
}

/** 标题 `$ hosts` + 数量(iOS 版:等宽半粗 26,字距收一点,数量是旁边的灰色小字)。 */
@Composable
private fun HostsTitle(total: Int) {
    val p = LocalXssh.current
    val description = if (total == 0) {
        stringResource(R.string.host_none_yet)
    } else {
        pluralStringResource(R.plurals.host_count, total, total)
    }
    Row(Modifier.semantics(mergeDescendants = true) { contentDescription = description }) {
        Text(
            "\$ hosts",
            color = p.text,
            fontFamily = XsshFonts.monoTitle,
            // 26 → 23sp(用户要求再小一点点)。
            fontSize = 24.sp,
            fontWeight = FontWeight.SemiBold,
            letterSpacing = (-0.4).sp,
            maxLines = 1,
            modifier = Modifier.alignByBaseline(),
        )
        if (total > 0) {
            Spacer(Modifier.width(8.dp))
            Text(
                total.toString(),
                color = p.text.copy(alpha = 0.45f),
                fontSize = 13.sp,
                modifier = Modifier.alignByBaseline(),
            )
        }
    }
}

/**
 * 连着的那台名字后面的光标:一个绿色的块,闪几下(约 5 秒)就常亮 —— 不无限循环,省电。
 * 系统关了动画(动画时长缩放 = 0,即"减弱动态效果")就不闪,常亮。读屏跳过。
 */
@Composable
private fun BlinkingCursor(modifier: Modifier = Modifier, height: Dp = 14.dp) {
    val p = LocalXssh.current
    val context = LocalContext.current
    val still = remember {
        android.provider.Settings.Global.getFloat(
            context.contentResolver,
            android.provider.Settings.Global.ANIMATOR_DURATION_SCALE,
            1f,
        ) == 0f
    }
    var bright by remember { mutableStateOf(true) }
    LaunchedEffect(Unit) {
        if (still) return@LaunchedEffect
        repeat(8) {
            delay(600)
            bright = !bright
        }
        bright = true
    }
    val alpha by animateFloatAsState(if (bright) 1f else 0.15f, tween(500), label = "cursor")
    Box(
        modifier
            .size(6.dp, height)
            .graphicsLayer { this.alpha = alpha }
            .clip(RoundedCornerShape(1.dp))
            .background(p.ok)
            .clearAndSetSemantics { },
    )
}

/**
 * 搜索框也是一行命令:`❯ grep ▍输入`,没有圆角底,下面一条虚线;`❯` 和列表行的 `❯` 在同一条竖线上。
 */
@Composable
private fun SearchField(modifier: Modifier, query: String, onQuery: (String) -> Unit, onClose: () -> Unit) {
    val p = LocalXssh.current
    val focus = remember { FocusRequester() }
    LaunchedEffect(Unit) { runCatching { focus.requestFocus() } }
    val closeLabel = stringResource(R.string.host_close_search)
    val font = 17.sp
    val mono = TextStyle(color = p.text, fontSize = font, fontFamily = XsshFonts.monoUi)
    Column(modifier.fillMaxWidth()) {
        Row(
            Modifier
                .fillMaxWidth()
                .height(TouchMin)
                .padding(start = BoxPad),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Prompt(font, color = p.ok)
            Spacer(Modifier.width(PromptGap))
            Text("grep", color = p.text.copy(alpha = 0.4f), style = mono, maxLines = 1)
            Spacer(Modifier.width(10.dp))
            Box(Modifier.weight(1f), contentAlignment = Alignment.CenterStart) {
                if (query.isEmpty()) {
                    Text(
                        stringResource(R.string.host_search_placeholder),
                        color = p.textFaint,
                        style = mono,
                        maxLines = 1,
                    )
                }
                BasicTextField(
                    value = query,
                    onValueChange = onQuery,
                    singleLine = true,
                    textStyle = mono,
                    cursorBrush = SolidColor(p.ok),
                    modifier = Modifier.fillMaxWidth().focusRequester(focus),
                )
            }
            // 右边的 ✕ 去掉了(用户要求):收起搜索靠右下角玻璃胶囊里的搜索钮再点一下。
            Spacer(Modifier.width(BoxPad))
        }
        DashedDivider(Modifier.padding(horizontal = BoxPad))
    }
}

/**
 * 一台主机都没有时的整屏起步面板。
 *
 * 不做成"左边空列表 + 右边空详情"的双栏 —— 那是两块空白拼在一起。
 * 也不放按钮:新建就在右边缘轨道上,这里再来一个就是重复。
 */
@Composable
private fun FirstRun(modifier: Modifier, onNew: () -> Unit) {
    val p = LocalXssh.current
    val font = 22.sp
    // 内容不满一屏也包在滚动容器里:往下拖有回弹,不会像卡死一样纹丝不动。
    BoxWithConstraints(modifier) {
    Column(
        Modifier
            .bounce()
            .verticalScroll(rememberScrollState())
            .heightIn(min = maxHeight)
            .padding(horizontal = Gutter + BoxPad),
        verticalArrangement = Arrangement.Center,
    ) {
        BrandLockup(BrandTitleHeight)
        Spacer(Modifier.height(24.dp))
        // 一行提示符 `❯ new ▍`,点一下就新建(iOS 版的空态,和列表同一套终端风格)。
        // 新建本来就在边缘轨道上,这里是同一个动作的另一个入口,不算重复的按钮 —— 它长得就是一行字。
        Column(
            Modifier
                .clip(RoundedCornerShape(RadiusBox))
                .clickable(onClick = onNew)
                .padding(vertical = 8.dp),
        ) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Prompt(font, color = p.ok)
                Spacer(Modifier.width(PromptGap))
                Text("new", color = p.text, fontFamily = XsshFonts.monoUi, fontSize = font, maxLines = 1)
                Spacer(Modifier.width(8.dp))
                BlinkingCursor(height = 20.dp)
            }
            Spacer(Modifier.height(10.dp))
            Text(stringResource(R.string.host_none_yet), color = p.textDim, fontSize = 15.sp)
        }
    }
    }
}

@Composable
private fun NoMatches(query: String, modifier: Modifier) {
    val p = LocalXssh.current
    val font = 17.sp
    Column(
        modifier.padding(32.dp),
        verticalArrangement = Arrangement.Center,
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        // `❯ grep "关键字"` + 一句话,和列表同一套终端风格。
        Row(verticalAlignment = Alignment.CenterVertically) {
            Prompt(font, color = p.ok)
            Spacer(Modifier.width(PromptGap))
            Text("grep", color = p.text.copy(alpha = 0.4f), fontFamily = XsshFonts.monoUi, fontSize = font, maxLines = 1)
            Spacer(Modifier.width(8.dp))
            Text(
                "\"$query\"",
                color = p.text,
                fontFamily = XsshFonts.monoUi,
                fontSize = font,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
                modifier = Modifier.weight(1f, fill = false),
            )
        }
        Spacer(Modifier.height(10.dp))
        Text(stringResource(R.string.host_no_matches), color = p.textDim, fontSize = 14.sp)
    }
}



/**
 * 双栏右栏的会话实时预览:只读的一小块终端画面。
 *
 * 这里订阅 [TerminalSession.frame] 是安全的 —— 轮询循环的"有人看"还要前台门控
 * (见 Sessions.kt 的 watched),切到后台自动回到省电节奏;换选主机 / 离开这一屏,
 * 这个组合消失,订阅也就断了。
 *
 * 字号按会话列宽缩到刚好放得下(下限 7.5sp):80 列的会话在右栏里也能看个轮廓,
 * 缩到下限还放不下就横向裁,预览是"扫一眼在干什么",不是第二个终端。
 */
@Composable
private fun SessionPreview(session: TerminalSession, modifier: Modifier = Modifier) {
    val p = LocalXssh.current
    val frame by session.frame.collectAsState()
    val font = TerminalFontChoice.current
    val density = LocalDensity.current
    var boxW by remember { mutableIntStateOf(0) }
    val cols = session.cols.coerceAtLeast(1)
    val probe = rememberTermPaints(font, 13f)
    val fitSp = remember(boxW, cols, probe) {
        if (boxW <= 0) 13f
        else (13f * boxW / (cols * probe.cellWidth)).coerceIn(7.5f, 13f)
    }
    val paints = rememberTermPaints(font, fitSp)
    // 行数跟着**帧**走(响应式):会话行数变化时盒子高度跟着变,不用等别的重组;
    // 还没发过帧时退回会话当前的行数。cols 只在终端界面会变,进预览必经重组,读一次足够。
    val rowsCount = maxOf(frame.rows.size, session.rows).coerceAtLeast(1)
    val height = with(density) { (rowsCount * paints.cellHeight).toDp() }
        .coerceAtMost(220.dp)
    Box(
        modifier
            .fillMaxWidth()
            .height(height)
            .clip(RoundedCornerShape(RadiusBox))
            .background(p.termBg)
            .onSizeChanged { boxW = it.width },
    ) {
        Canvas(Modifier.fillMaxSize()) {
            val cw = paints.cellWidth
            val ch = paints.cellHeight
            val rows = frame.rows
            for (r in rows.indices) {
                val y = r * ch
                if (y > size.height) break
                val runs = rows[r].runs
                for (i in runs.indices) drawRun(runs[i], y, paints, p.termFg, p.termBg)
            }
            val cur = frame.cursor
            if (cur.visible) {
                val t = 2.dp.toPx()
                val cy = (cur.row.toInt() + 1) * ch - t
                if (cy >= 0f && cy < size.height) {
                    drawRect(color = p.termCursor, topLeft = Offset(cur.col.toFloat() * cw, cy), size = Size(cw, t))
                }
            }
        }
    }
}

/** 分组标题(会话 / 主机):和平板侧栏同一套字号,左缘落在标题线上。 */
@Composable
private fun SectionHeader(text: String) {
    val p = LocalXssh.current
    // 绿色的 `# ` 前缀:和 iOS 版表单的小节标题同一个记号。
    Row(Modifier.padding(start = BoxPad - TitleOptical, top = 14.dp, bottom = 4.dp)) {
        Text(
            "# ",
            color = p.ok,
            fontFamily = XsshFonts.monoUi,
            fontSize = 13.sp,
            modifier = Modifier.clearAndSetSemantics { },
        )
        Text(text, color = p.textDim, fontFamily = XsshFonts.monoUi, fontSize = 13.sp, fontWeight = FontWeight.Medium)
    }
}

/**
 * 会话行:状态点(绿=连着,橙=正在自动重连)+ 主机名 + 地址 + 最后一次输出的相对时间。
 * 点一行 = 接管那条会话(不重连、不再问密钥)。
 */
@Composable
private fun SessionRow(session: TerminalSession, large: Boolean, onOpen: () -> Unit) {
    val p = LocalXssh.current
    // 订阅的是 linkState(只在重连状态变化时发射),不是 frame —— 见 TerminalSession.linkState 的注释。
    val link by session.linkState.collectAsState()
    val host = session.host
    // 相对时间要"走":闲着的会话不产生任何重组,不在这里自己走针的话,
    // 十分钟后那一行还停在「刚刚」。一分钟重算一次文案,一行字的重排,可忽略。
    var tick by remember { mutableIntStateOf(0) }
    LaunchedEffect(Unit) {
        while (true) {
            delay(60_000)
            tick++
        }
    }
    val time = remember(tick) {
        android.text.format.DateUtils.getRelativeTimeSpanString(session.lastOutputAt).toString()
    }
    XsshCard(
        modifier = Modifier.fillMaxWidth(),
        onClick = onOpen,
        paddingVertical = if (large) 12.dp else 10.dp,
        bare = true,
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            StatusDot(if (link > 0) p.warn else p.ok)
            Spacer(Modifier.width(12.dp))
            Column(Modifier.weight(1f)) {
                Text(
                    host.label,
                    color = p.text,
                    fontFamily = XsshFonts.monoUi,
                    fontSize = if (large) 17.sp else 16.sp,
                    fontWeight = FontWeight.SemiBold,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
                Spacer(Modifier.height(3.dp))
                Text(
                    host.subtitle,
                    color = p.textDim,
                    fontFamily = XsshFonts.monoUi,
                    fontSize = if (large) 14.sp else 13.sp,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
            }
            Spacer(Modifier.width(10.dp))
            Text(
                time,
                color = p.textFaint,
                fontSize = 12.sp,
                maxLines = 1,
            )
        }
    }
}

/** 主机行的连接阶段:没连 / 连着 / 刚断开(停一下再收)。 */
private enum class RowPhase { Idle, Running, Closing }

/** 断开后"停一下"的时长(iOS:0.44s)。 */
private const val RowClosingHoldMs = 440L

/** 收起 / 展开的时长和曲线(iOS `collapseCurve`:起步轻、中间快、落地软)。 */
private const val RowCurveMs = 220
private val RowCurve = androidx.compose.animation.core.CubicBezierEasing(0.3f, 0.05f, 0.1f, 1f)

@Composable
private fun HostCard(
    host: Host,
    large: Boolean,
    selected: Boolean,
    running: Boolean,
    /** 连着的这条会话是几点建立的(毫秒);状态行据此显示已连接时长。 */
    startedAt: Long?,
    onPrimary: (Host) -> Unit,
    onInfo: ((Host) -> Unit)?,
    onLongPress: () -> Unit,
) {
    val p = LocalXssh.current
    val font = rowFontSize(large)
    // 连上 / 断开的编排(照 iOS 的"放手"):
    //   断开那一刻  → 0.32s 里箭头由绿变灰、光标淡出、状态行换成灰色的「✕ 已断开」;
    //   停 0.44s    → 让人看清"断开了";
    //   然后整行收掉 → 0.22s 的专用曲线(起步轻、中间快、落地软),下面的行同步滑上来。
    // 连上时状态行用同一条曲线展开。
    var phase by remember { mutableStateOf(if (running) RowPhase.Running else RowPhase.Idle) }
    LaunchedEffect(running) {
        if (running) {
            phase = RowPhase.Running
        } else if (phase == RowPhase.Running) {
            phase = RowPhase.Closing
            delay(RowClosingHoldMs)
            phase = RowPhase.Idle
        }
    }
    val live = phase == RowPhase.Running
    val arrow by androidx.compose.animation.animateColorAsState(
        if (live) p.ok else p.text.copy(alpha = 0.4f),
        androidx.compose.animation.core.tween(320, easing = androidx.compose.animation.core.FastOutSlowInEasing),
        label = "hostArrow",
    )
    var lastStartedAt by remember { mutableStateOf<Long?>(null) }
    if (startedAt != null) lastStartedAt = startedAt
    XsshCard(
        modifier = Modifier.fillMaxWidth(),
        highlight = selected,
        bare = true,
        onClick = { onPrimary(host) },
        onLongClick = onLongPress,
        // 行内上下留白 14(原来 21):行高缩 20% 左右 —— 空闲行约 70→56dp,连着的那行(多一行状态)约 94→75dp。
        // 14 → 16.5:名字字号收到 17sp 后一行约 50dp,再加 10% ≈ 55dp。
        paddingVertical = 18.5.dp,
    ) {
        // iOS 版的主机行:`❯ 名字`(等宽,一行,太长截断),行尾一个这台的颜色点;不显示 IP / 端口。
        // 连着的那台:`❯` 变绿、名字后面一个闪几下的光标,下面多一行绿色的「✓ 运行中」。
        // 编辑/删除走左滑。
        Row(verticalAlignment = Alignment.CenterVertically) {
            Prompt(font, color = arrow)
            Spacer(Modifier.width(PromptGap))
            // 名字 + 光标占掉中间所有空位(名字自己 fill = false:短名字不撑满,光标紧跟在名字后面;
            // 长名字被截断,但行尾的标签和色点永远留得下)。
            Row(Modifier.weight(1f).padding(end = 8.dp), verticalAlignment = Alignment.CenterVertically) {
                Text(
                    narrowSpaces(host.label, font),
                    color = p.text.copy(alpha = 0.93f),
                    fontFamily = XsshFonts.monoUi,
                    fontSize = font,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                    modifier = Modifier.weight(1f, fill = false),
                )
                androidx.compose.animation.AnimatedVisibility(
                    visible = live,
                    enter = androidx.compose.animation.fadeIn(androidx.compose.animation.core.tween(200)),
                    exit = androidx.compose.animation.fadeOut(androidx.compose.animation.core.tween(240)),
                ) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Spacer(Modifier.width(8.dp))
                        BlinkingCursor()
                    }
                }
            }
            // 只标需要注意的状态;"密码登录""已信任"这类常态不贴标签。
            if (host.keyFingerprint.isBlank()) {
                Chip(stringResource(R.string.host_key_pending), p.warn)
                Spacer(Modifier.width(8.dp))
            }
            StatusDot(hostPip(host))
            if (onInfo != null) {
                val infoLabel = stringResource(R.string.host_info)
                // ⓘ(iOS 无线局域网列表的做法):点卡片 = 连接,点 ⓘ = 看这台主机的信息。
                // 热区 44dp 伸进卡片的右内边距,图标本身和卡片右缘留出正常的内边距。
                Box(
                    Modifier
                        .padding(start = 4.dp)
                        .offset(x = 10.dp)
                        .size(TouchMin)
                        .clip(CircleShape)
                        .clickable { onInfo(host) }
                        .semantics { contentDescription = infoLabel },
                    contentAlignment = Alignment.Center,
                ) {
                    Icon(XIcons.Info, null, tint = p.textDim, modifier = Modifier.size(22.dp))
                }
            }
        }
        // 连着的那台多一行绿色状态「✓ 运行中 · 12:03」,缩进到名字的起点(iOS 版的「已连接 · 时长」)。
        // 状态行一直占着高度直到"停一下"结束;收起 = 高度和透明度沿同一条曲线一起落到 0,内容贴着顶边。
        androidx.compose.animation.AnimatedVisibility(
            visible = phase != RowPhase.Idle,
            enter = androidx.compose.animation.expandVertically(
                androidx.compose.animation.core.tween(RowCurveMs, easing = RowCurve),
                expandFrom = Alignment.Top,
            ) + androidx.compose.animation.fadeIn(androidx.compose.animation.core.tween(RowCurveMs, easing = RowCurve)),
            exit = androidx.compose.animation.shrinkVertically(
                androidx.compose.animation.core.tween(RowCurveMs, easing = RowCurve),
                shrinkTowards = Alignment.Top,
            ) + androidx.compose.animation.fadeOut(androidx.compose.animation.core.tween(RowCurveMs, easing = RowCurve)),
        ) {
            // 「✓ 运行中 · 时长」和「✕ 已断开」交叉淡化:旧的先淡出,新的晚一点淡入,两行字不会叠在一起。
            AnimatedContent(
                targetState = live,
                transitionSpec = {
                    androidx.compose.animation.fadeIn(tween(200, delayMillis = 100)) togetherWith
                        androidx.compose.animation.fadeOut(tween(150))
                },
                label = "hostStatus",
            ) { isLive ->
                val start = promptWidth(font) + PromptGap
                if (isLive) {
                    val label = stringResource(R.string.host_running)
                    val elapsed = lastStartedAt?.let { runningClock(it) }
                    Text(
                        "✓ " + label + (elapsed?.let { " · $it" } ?: ""),
                        color = p.ok.copy(alpha = 0.95f),
                        fontFamily = XsshFonts.monoUi,
                        fontSize = 12.sp,
                        maxLines = 1,
                        modifier = Modifier.padding(top = 3.dp, start = start),
                    )
                } else {
                    Text(
                        "✕ " + stringResource(R.string.host_disconnected),
                        color = p.text.copy(alpha = 0.5f),
                        fontFamily = XsshFonts.monoUi,
                        fontSize = 12.sp,
                        maxLines = 1,
                        modifier = Modifier.padding(top = 3.dp, start = start),
                    )
                }
            }
        }
    }
}

/**
 * 已连接时长 `m:ss`(满一小时是 `h:mm:ss`),每秒走一格。
 * 只有连着的主机行才会调用,所以一屏最多几个计时器;读到的是「现在」,不记状态。
 */
@Composable
internal fun runningClock(startedAt: Long): String {
    val now by produceState(System.currentTimeMillis(), startedAt) {
        while (true) {
            delay(1000)
            value = System.currentTimeMillis()
        }
    }
    return formatElapsed(now - startedAt)
}

/** 毫秒 → `m:ss` / `h:mm:ss`(负数当 0)。单独成函数,方便单测。 */
internal fun formatElapsed(millis: Long): String {
    val total = (millis.coerceAtLeast(0) / 1000)
    val h = total / 3600
    val m = (total % 3600) / 60
    val s = total % 60
    return if (h > 0) "%d:%02d:%02d".format(h, m, s) else "%d:%02d".format(m, s)
}

/** 左滑露出的按钮:一个"编辑"、一个"删除",只有图标(iOS 版的做法),各 60dp,彼此之间、和卡片之间各留 8dp。 */
private val ActionTile = 54.dp   // 每格占的宽度(圆本身是 SwipeTileSize)
private val SwipeTileSize = 46.dp  // 左滑按钮的直径:正圆,比原来 60dp 的方块小一圈
private val ActionGap = 4.dp
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
    /** 有几台主机把它当跳板机(0 = 没有):只影响「确认删除」的文案,不拦删除。 */
    jumpUsedBy: Int = 0,
    modifier: Modifier = Modifier,
    onDragStart: () -> Unit,
    onOpenChange: (Boolean) -> Unit,
    onEdit: () -> Unit,
    /** 详情(单栏才有):有就多露出一格 ⓘ。 */
    onInfo: (() -> Unit)? = null,
    onDelete: () -> Unit,
    content: @Composable () -> Unit,
) {
    val p = LocalXssh.current
    val haptic = LocalHapticFeedback.current
    val density = LocalDensity.current
    val scope = rememberCoroutineScope()
    // 露出的宽度:每格 ActionTile + 一条 ActionGap(两格是 136dp,三格是 204dp)。
    val tiles = if (onInfo != null) 3 else 2
    val reveal = with(density) { (ActionTile * tiles + ActionGap * tiles).toPx() }
    val offset = remember { Animatable(0f) }
    var confirming by remember { mutableStateOf(false) }
    // 确认删除只生效一次:连点两下 / 列表还没刷新时再点一下,不能删两次。
    var deleted by remember { mutableStateOf(false) }
    fun deleteOnce() {
        if (deleted) return
        deleted = true
        onDelete()
    }
    val motion = Motion.snappy<Float>()

    // 外部改了开合(别的卡片被打开、列表滚动)就跟着动。
    LaunchedEffect(open) {
        if (!open) {
            confirming = false
            deleted = false
        }
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
    val infoLabel = stringResource(R.string.host_info)
    val editLabel = stringResource(R.string.host_edit)
    val deleteLabel = stringResource(R.string.host_delete)
    // 确认那一下要说清楚"删了它,还有几台主机连不上"(它被当作跳板机时)。
    val confirmLabel = if (jumpUsedBy > 0) {
        stringResource(R.string.host_confirm_delete_jump, jumpUsedBy)
    } else {
        stringResource(R.string.host_confirm_delete)
    }
    // 不要给这个 Box 设 height(IntrinsicSize.Min):固有高度只认内容的"完整高度",
    // 看不到状态行正在播的收起动画,容器会一直撑着、动画播完才猛地塌 —— 下面的虚线就是这样"啪"一下上去的。
    // 按钮层是 matchParentSize,本来就跟着卡片的实际高度走,用不着它。
    Box(
        modifier
            .fillMaxWidth()
            .semantics {
                // 读屏用户做不了滑动手势,给同样的两个操作。
                // 删除要和视觉上的两步确认一致:第一下只是亮出「确认删除」,
                // 第二下才真的删 —— 主机记录里有已信任的指纹和加密存着的密码。
                customActions = listOf(
                    CustomAccessibilityAction(editLabel) { onEdit(); true },
                    CustomAccessibilityAction(deleteLabel) {
                        if (!confirming) {
                            confirming = true
                            true
                        } else {
                            onDelete()
                            true
                        }
                    },
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
                SwipeTile(confirmLabel, p.bg, p.danger, Modifier.width(ActionTile * 2 + ActionGap)) {
                    haptic.performHapticFeedback(HapticFeedbackType.LongPress)
                    deleteOnce()
                }
            } else {
                if (onInfo != null) {
                    SwipeTile(infoLabel, p.text, p.bgElev2, Modifier.width(ActionTile), icon = XIcons.Info) { onInfo() }
                    Spacer(Modifier.width(ActionGap))
                }
                SwipeTile(editLabel, p.accent, p.accentSoft, Modifier.width(ActionTile), icon = XIcons.Pencil) { onEdit() }
                Spacer(Modifier.width(ActionGap))
                SwipeTile(deleteLabel, p.danger, p.danger.copy(alpha = 0.16f), Modifier.width(ActionTile), icon = XIcons.Trash) {
                    haptic.performHapticFeedback(HapticFeedbackType.TextHandleMove)
                    confirming = true
                }
            }
        }
        Box(
            Modifier
                // 卡片**从右边往回收窄**,不是整块平移。
                //
                // 平移是 iOS 通栏列表的做法 —— 那种行本来就贴着屏幕两边。我们的是实底的
                // 圆角卡片,整块往左推 160dp,名字被推出屏幕、边框被切掉一截,看着像坏了
                // (外屏实测:「local-test」整个看不见,只剩 ":2222" 露在左边)。
                // 收窄的话,左缘和名字原地不动,右边让出的位置正好放按钮。
                .layout { measurable, constraints ->
                    val full = constraints.maxWidth
                    // 按钮露出来时,卡片比"让出的宽度"多留 6dp:色点往右挪一点点,离第一颗圆钮不那么远。
                    // (卡片右边是 BoxPad 的空白,多出来的 6dp 只是压在这块空白上,看不见。)
                    val nudge = (6.dp.toPx() * (-offset.value / reveal).coerceIn(0f, 1f)).roundToInt()
                    val width = (full + offset.value.roundToInt() + nudge).coerceIn(0, full)
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
private fun SwipeTile(
    label: String,
    fg: Color,
    bg: Color,
    modifier: Modifier,
    /** 有图标就只画图标(读屏仍念 [label]);没有就写字(「确认删除」要把话说清楚)。 */
    icon: androidx.compose.ui.graphics.vector.ImageVector? = null,
    onClick: () -> Unit,
) {
    // 全圆角:图标格是 46dp 的正圆,「确认删除」是同高的胶囊;在整行高度里垂直居中(原来是和卡片同高的圆角方块)。
    Box(modifier.fillMaxHeight(), contentAlignment = Alignment.Center) {
        Box(
            (if (icon != null) Modifier.size(SwipeTileSize) else Modifier.fillMaxWidth().height(SwipeTileSize))
                .clip(CircleShape)
                .background(bg)
                .clickable(onClick = onClick)
                .semantics { contentDescription = label },
            contentAlignment = Alignment.Center,
        ) {
            if (icon != null) {
                Icon(icon, contentDescription = null, tint = fg, modifier = Modifier.size(20.dp))
            } else {
                Text(label, color = fg, fontSize = 14.sp, fontWeight = FontWeight.Medium, textAlign = androidx.compose.ui.text.style.TextAlign.Center)
            }
        }
    }
}

@Composable
private fun HostDetailPane(
    modifier: Modifier,
    host: Host?,
    running: Boolean,
    /** 这台主机活着的会话(双栏右栏实时预览);没有就 null。 */
    session: TerminalSession?,
    onConnect: (Host) -> Unit,
    onEdit: (Host) -> Unit,
    onDelete: (Host) -> Unit,
    onPin: (Host) -> Unit,
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
            Text(stringResource(R.string.host_select_on_left), color = p.textDim, fontSize = 15.sp)
        }
        return
    }

    // 和左栏关于折痕镜像:左栏卡片止于折痕前 32dp,这一栏的盒子(按钮、分组块)从折痕后 32dp 起;
    // 文字再缩进一个盒子内边距,和左栏"卡片边 / 卡片里的字"是同一对线。
    // 标题用和左栏「X-SSH」同一套字号、同一个顶距,两栏的大标题在一条基线上。
    // 「连接 / 编辑 / 删除」钉在栏底,不跟着信息滚(见 HostInfoBody 的 actionsPinned):
    // 展开的折叠屏有 600dp 高,手握在下半截,按钮放顶上要抬手去够。信息在上面看,按钮在下面按。
    // 内容照常从按钮底下穿过去(和轨道一样的做法),滚到底时最后一行正好停在按钮上沿。
    var actionsHeight by remember { mutableStateOf(0.dp) }
    val density = LocalDensity.current
    Box(modifier) {
        Column(
            Modifier
                .fillMaxSize()
                .bounce()
                .verticalScroll(rememberScrollState())
                // 版心:折痕这侧留 32dp(和左栏镜像),右边让开轨道 —— 取值是右对齐的,不能被玻璃压住。
                .padding(
                    start = Gutter * 2,
                    end = railSide(),
                    top = Gutter,
                    // 底部只让开按钮条(按钮条自己贴着栏底);轨道在右边,横向已经让开了。
                    bottom = actionsHeight + Gutter,
                ),
        ) {
            HostInfoBody(
                host = host,
                running = running,
                onConnect = onConnect,
                onEdit = onEdit,
                onDelete = onDelete,
                actionsPinned = true,
                onPin = onPin,
                header = {
                    Column {
                        PaneTitle(
                            Modifier.fillMaxWidth().padding(start = TitlePad),
                            host.label,
                            host.subtitle,
                            monoSubtitle = true,
                        )
                        if (session != null) {
                            Spacer(Modifier.height(12.dp))
                            SessionPreview(session, Modifier.padding(start = TitlePad))
                        }
                    }
                },
            )
        }
        // 和单栏详情页共用同一条操作条(见 PinnedActions),两处不会各写一套慢慢走偏。
        // 左边多缩一个盒子线:这一栏的盒子都从折痕后 32dp 起。
        PinnedActions(onHeight = { actionsHeight = it }, start = Gutter * 2) {
            HostActions(host, running, onConnect, onEdit, onDelete)
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
    /** 主机列表那一栏:大标题位放字标(见 Brand.kt),其余栏是文字。 */
    brand: Boolean = false,
) {
    val p = LocalXssh.current
    Column(modifier) {
        if (brand) {
            BrandTitleLine(BrandTitleHeight, titleSize = 34.sp)
        } else Text(
            title,
            modifier = Modifier.offset(x = -TitleOptical),
            color = p.text,
            // 和左栏的 `$ hosts` 同一套:等宽半粗 26sp、字距收一点,紧跟一行灰色小字。
            fontSize = 26.sp,
            fontFamily = XsshFonts.monoTitle,
            fontWeight = FontWeight.SemiBold,
            letterSpacing = (-0.4).sp,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
        )
        Spacer(Modifier.height(2.dp))
        Text(
            subtitle,
            color = p.textDim,
            fontFamily = if (monoSubtitle) XsshFonts.monoUi else FontFamily.Default,
            fontSize = 12.5.sp,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
        )
    }
}

/** 主机页右侧竖胶囊里每颗按钮的直径(别的页是 56dp,这里小 20%)。 */
private val HomeRailSize = 45.dp

/** 单栏主机页顶栏里字标那一块的高度(状态栏之下):字标 25dp 在里面垂直居中,位置和原来在列表里时一致。 */
private val HomeBarBody = 57.dp

/**
 * 顶栏(iOS 导航栏的复刻):字标固定在左上;列表往上滚、内容钻到顶栏下面时,
 * 栏的背景才淡入 —— 背后列表内容的模糊(毛玻璃)+ 一层深色 + 底边 1px 细线。静止时完全透明,什么都看不见。
 */
@Composable
private fun HomeTopBar(
    modifier: Modifier,
    grid: LazyGridState,
    bounceOffset: androidx.compose.runtime.MutableFloatState,
    backdrop: com.kyant.backdrop.Backdrop,
    statusTop: Dp,
    onSettings: () -> Unit,
) {
    val p = LocalXssh.current
    val density = LocalDensity.current
    val ramp = with(density) { 24.dp.toPx() }
    // 0 = 静止在顶上;往上滚 24dp 内渐变到 1;滚过标题(第一项已滚出)就是 1。
    val progress by remember(grid) {
        derivedStateOf {
            if (grid.firstVisibleItemIndex > 0) 1f
            else maxOf(
                grid.firstVisibleItemScrollOffset / ramp,
                // 滚不动的列表被橡皮筋往上拉出去,内容同样钻到了顶栏底下,栏也要出来。
                -bounceOffset.floatValue / ramp,
            ).coerceIn(0f, 1f)
        }
    }
    val settingsLabel = stringResource(R.string.set_title)
    Box(modifier.fillMaxWidth().height(statusTop + HomeBarBody)) {
        Box(
            Modifier
                .matchParentSize()
                .graphicsLayer { alpha = progress }
                .drawBackdrop(
                    backdrop = backdrop,
                    shape = { androidx.compose.ui.graphics.RectangleShape },
                    // 只模糊,不加 vibrancy(它会把背后的字提得更亮更饱和,虚影反而抢眼)。
                    effects = { blur(40.dp.toPx()) },
                    // 不要库默认的高光 / 投影:它们会在栏的四周画出一圈亮边,iOS 的栏只有底边一条细线。
                    highlight = null,
                    shadow = null,
                    // 玻璃板本身要比纯黑底亮一档(iOS 里这一条是一块淡灰的玻璃,logo 浮在它上面):
                    // 不叠黑,叠一层淡淡的白(和玻璃按钮的"亮度层"同一个思路),黑底上就是 #111 左右的灰。
                    onDrawSurface = {
                        drawRect(Color.Black.copy(alpha = 0.45f))   // 先压暗背后的虚影
                        drawRect(Color.White.copy(alpha = 0.075f))  // 再叠一层淡白:玻璃板比纯黑底亮一档
                    },
                ),
        )
        Box(
            Modifier
                .align(Alignment.BottomStart)
                .fillMaxWidth()
                .height(0.8.dp)
                .graphicsLayer { alpha = progress }
                .background(Color.White.copy(alpha = 0.16f)),
        )
        Box(
            Modifier
                .padding(top = statusTop, start = 6.dp + BoxPad - TitleOptical)
                .height(HomeBarBody),
            contentAlignment = Alignment.CenterStart,
        ) {
            BrandLockup(
                25.dp,
                Modifier
                    .clip(RoundedCornerShape(6.dp))
                    .clickable(onClick = onSettings)
                    .semantics { contentDescription = settingsLabel },
            )
        }
    }
}