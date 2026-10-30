package dev.xssh.android

import android.content.ClipData
import android.net.Uri
import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.layout.widthIn
import androidx.compose.ui.text.input.KeyboardType
import androidx.activity.compose.BackHandler
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.WindowInsetsSides
import androidx.compose.foundation.layout.asPaddingValues
import androidx.compose.foundation.layout.calculateStartPadding
import androidx.compose.foundation.layout.only
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.foundation.lazy.LazyListState
import androidx.compose.foundation.lazy.items
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.platform.LocalLayoutDirection
import com.kyant.backdrop.backdrops.layerBackdrop
import com.kyant.backdrop.backdrops.rememberLayerBackdrop
import android.os.SystemClock
import android.view.KeyEvent as AndroidKeyEvent
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.gestures.awaitFirstDown
import androidx.compose.foundation.draganddrop.dragAndDropTarget
import androidx.compose.foundation.draganddrop.dragAndDropSource
import androidx.compose.foundation.focusable
import androidx.compose.foundation.hoverable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsHoveredAsState
import androidx.compose.foundation.interaction.collectIsPressedAsState
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
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draganddrop.DragAndDropEvent
import androidx.compose.ui.draganddrop.DragAndDropTarget
import androidx.compose.ui.draganddrop.toAndroidDragEvent
import androidx.compose.ui.draganddrop.DragAndDropTransferData
import androidx.compose.ui.draw.clip
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusProperties
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.input.key.onInterceptKeyBeforeSoftKeyboard
import androidx.compose.ui.input.key.onKeyEvent
import androidx.compose.ui.input.pointer.PointerEventPass
import androidx.compose.ui.input.pointer.PointerEventType
import androidx.compose.ui.input.pointer.PointerIcon
import androidx.compose.ui.input.pointer.isCtrlPressed
import androidx.compose.ui.input.pointer.isSecondaryPressed
import androidx.compose.ui.input.pointer.isShiftPressed
import androidx.compose.ui.input.pointer.pointerHoverIcon
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.input.pointer.positionChange
import androidx.compose.ui.input.pointer.PointerType
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.TextRange
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.TextFieldValue
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.DpOffset
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.window.Dialog
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import uniffi.xssh_ffi.RemoteEntry
import androidx.compose.foundation.layout.offset

/** 面包屑:根目录 + 逐级路径。`/C:/Users/user`(Windows 的 OpenSSH)也按同样的规则拆。 */
private fun crumbs(path: String): List<Pair<String, String>> {
    val out = mutableListOf("/" to "/")
    var at = ""
    path.split('/').filter { it.isNotEmpty() }.forEach { part ->
        at = "$at/$part"
        out += part to at
    }
    return out
}

private val OtherYear = DateTimeFormatter.ofPattern("yyyy-MM-dd")

/** 今年的修改时间怎么写(「9月27日 14:05」/「Sep 27 14:05」):格式跟着界面语言,取自字符串资源。 */
@Composable
private fun rememberThisYear(): DateTimeFormatter {
    val pattern = stringResource(R.string.files_time_this_year)
    val locale = LocalConfiguration.current.locales[0]
    return remember(pattern, locale) { DateTimeFormatter.ofPattern(pattern, locale) }
}

private fun formatTime(epochSeconds: Long, thisYear: DateTimeFormatter): String {
    if (epochSeconds <= 0) return ""
    val zone = ZoneId.systemDefault()
    val time = Instant.ofEpochSecond(epochSeconds).atZone(zone)
    val now = java.time.ZonedDateTime.now(zone)
    return (if (time.year == now.year) thisYear else OtherYear).format(time)
}

/** 把 [FileText] 取成当前语言的文字。 */
@Composable
private fun FileText.text(): String {
    raw?.let { return it }
    val resolved = args.map { if (it is FileText) it.text() else it }.toTypedArray()
    val n = count
    return if (n != null) pluralStringResource(id, n, *resolved) else stringResource(id, *resolved)
}

/* ─────────────────────────────── 界面 ─────────────────────────────── */

/** 工具栏里的「终端 | 文件」分段开关。 */
@Composable
fun PaneSwitch(files: Boolean, onChange: (Boolean) -> Unit) {
    val p = LocalXssh.current
    Row(
        Modifier
            .height(34.dp)
            .clip(RoundedCornerShape(9.dp))
            .background(p.bgElev2)
            .padding(2.dp),
    ) {
        listOf(false to stringResource(R.string.files_terminal), true to stringResource(R.string.files_files)).forEach { (value, label) ->
            val on = value == files
            val interaction = remember { MutableInteractionSource() }
            val hovered by interaction.collectIsHoveredAsState()
            Row(
                Modifier
                    .fillMaxHeight()
                    .clip(RoundedCornerShape(7.dp))
                    .background(
                        when {
                            on -> p.switchThumb
                            hovered -> p.bgElev2
                            else -> Color.Transparent
                        },
                    )
                    .hoverable(interaction)
                    .pointerHoverIcon(PointerIcon.Hand)
                    .focusProperties { canFocus = false }
                    .clickable(interactionSource = interaction, indication = null, role = Role.Tab) {
                        if (!on) onChange(value)
                    }
                    .semantics { contentDescription = "$label  Ctrl+Shift+O" }
                    .padding(horizontal = 12.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Icon(
                    if (value) XIcons.Folder else XIcons.Terminal,
                    contentDescription = null,
                    tint = if (on) p.text else p.textDim,
                    modifier = Modifier.size(16.dp),
                )
                Spacer(Modifier.width(6.dp))
                Text(
                    label,
                    color = if (on) p.text else p.textDim,
                    fontSize = 13.5.sp,
                    fontWeight = if (on) FontWeight.SemiBold else FontWeight.Normal,
                )
            }
        }
    }
}

private sealed interface FilesDialog {
    data class Rename(val entry: RemoteEntry) : FilesDialog
    data object NewFolder : FilesDialog
    data object GoTo : FilesDialog
    data class Delete(val entries: List<RemoteEntry>) : FilesDialog
    data class Replace(
        val title: String,
        val dir: String,
        val items: List<UploadItem>,
        val dirs: List<String>,
    ) : FilesDialog
}

/**
 * 平板右栏的文件面板:一列表格(名称 / 大小 / 修改时间),目录在前。
 *
 * - 单击选中,双击(或回车)打开:目录进去,文件交给别的应用查看;右键(触摸长按)出菜单。
 * - 多选:Ctrl+点 加减、Shift+点 连选、Shift+↑↓、Ctrl+A;触摸用菜单里的「多选」,之后点一下就是勾选。
 *   选了多项时底部出一条操作栏(下载 / 下载到… / 删除)。
 * - 键盘:↑↓ 选、回车打开、Backspace 或 Alt+↑ 回上一级、F2 改名、Delete 删除、Ctrl+C 复制路径、Ctrl+D 下载、
 *   Ctrl+U 上传文件、Ctrl+Shift+U 上传文件夹、Ctrl+R 刷新、Ctrl+L 前往路径;直接敲字母跳到这个前缀开头的那一项。
 * - 从别的应用把文件拖进来就是上传到当前目录。
 */
/** 文件面板放在哪儿:平板右栏(工具栏 + 表格),或手机 / 折叠屏的整页(大标题 + 两行的列表 + 玻璃按钮)。 */
sealed interface FilesChrome {
    class Tablet(val sidebarVisible: Boolean, val onToggleSidebar: () -> Unit, val onShowTerminal: () -> Unit) : FilesChrome

    /** [onLeave]:退回终端(返回键 / ‹ 在起始目录时)。 */
    class Phone(val onLeave: () -> Unit) : FilesChrome
}

@Composable
fun FilesPane(
    host: Host,
    session: TerminalSession,
    chrome: FilesChrome,
    focusRequest: Int,
) {
    val p = LocalXssh.current
    val context = LocalContext.current
    val resolver = context.contentResolver
    val density = LocalDensity.current
    val files = session.files
    val scope = rememberCoroutineScope()

    var path by remember { mutableStateOf(files.cwd) }
    var entries by remember { mutableStateOf(files.cached) }
    var failure by remember { mutableStateOf<FileText?>(null) }
    var loading by remember { mutableStateOf(false) }
    // 选择:[marked] 是选中的集合,[cursor] 是键盘所在的那一项,[anchor] 是 Shift 连选的起点。
    var marked by remember { mutableStateOf(emptySet<String>()) }
    var cursor by remember { mutableStateOf<String?>(null) }
    var anchor by remember { mutableStateOf<String?>(null) }
    // 触摸多选:点一下就是勾选 / 取消勾选(键盘鼠标用 Ctrl / Shift,用不着它)。
    var selectMode by remember { mutableStateOf(false) }
    var dialog by remember { mutableStateOf<FilesDialog?>(null) }
    var dropHover by remember { mutableStateOf(false) }
    val loadJob = remember { arrayOfNulls<Job>(1) }
    val listState = rememberLazyListState()
    val paneFocus = remember { FocusRequester() }
    // 走过的目录(手机:返回键一级一级退回去,退空了才离开这一页)。
    val history = remember { mutableStateListOf<String>() }
    val transfer by files.transfer.collectAsState()
    val queued by files.queued.collectAsState()
    val cacheEpoch by files.cacheEpoch.collectAsState()
    val notice by files.notice.collectAsState()
    val changed by files.changed.collectAsState()

    fun only(target: String?) {
        cursor = target
        anchor = target
        marked = setOfNotNull(target)
    }

    fun load(target: String, select: String? = null, push: Boolean = true) {
        loadJob[0]?.cancel()
        loading = true
        loadJob[0] = scope.launch {
            val result = runCatching { files.list(target) }
            if (result.exceptionOrNull() is CancellationException) return@launch
            loading = false
            result
                .onSuccess { list ->
                    val sameDir = target == path
                    val from = path
                    if (!sameDir && push && from != null) history.add(from)
                    path = target
                    entries = list
                    failure = null
                    files.cwd = target
                    files.cached = list
                    val paths = list.mapTo(HashSet()) { it.path }
                    if (sameDir && select == null) {
                        // 刷新:还在的选中项留着。
                        marked = marked.filterTo(HashSet()) { it in paths }
                        if (cursor !in paths) cursor = null
                        if (anchor !in paths) anchor = cursor
                        if (marked.isEmpty()) selectMode = false
                    } else {
                        selectMode = false
                        only(select?.takeIf { it in paths })
                    }
                    val at = list.indexOfFirst { it.path == cursor }
                    if (!sameDir || select != null) listState.scrollToItem((at - 3).coerceAtLeast(0))
                }
                .onFailure { e ->
                    // 已经有一屏内容时(点进一个没权限的目录),留着原来的,只在底部说一句。
                    if (entries == null || path == null) failure = e.reason() else files.notify(e.reason(), error = true)
                }
        }
    }
    fun refresh() {
        path?.let { load(it) }
    }
    fun goUp() {
        val at = path ?: return
        if (at != "/") load(parentPath(at), select = at.trimEnd('/'))
    }
    /** 返回:回到上一个看过的目录(退回父目录时选中刚才那个子目录);没有了就离开。 */
    fun back() {
        val prev = history.removeLastOrNull()
        if (prev == null) {
            (chrome as? FilesChrome.Phone)?.onLeave?.invoke()
            return
        }
        load(prev, select = path?.takeIf { parentPath(it) == prev.trimEnd('/').ifEmpty { "/" } }, push = false)
    }

    LaunchedEffect(Unit) {
        val start = path
        if (start != null) {
            load(start)
            return@LaunchedEffect
        }
        runCatching { files.home() }
            .onSuccess { load(it) }
            .onFailure { e -> if (e !is CancellationException) failure = e.reason() }
    }
    // 上传完成:重新列一次(还停在这个目录时就能看到新文件)。
    var seenChange by remember { mutableIntStateOf(changed) }
    LaunchedEffect(changed) {
        if (changed != seenChange) {
            seenChange = changed
            refresh()
        }
    }
    // 焦点:进来就拿(插着键盘就能用方向键),关掉对话框后拿回来。
    LaunchedEffect(focusRequest, dialog == null) {
        // 0 = 这一栏正在退场(见 TabletApp),别去抢进场那一栏的焦点。
        if (dialog != null || focusRequest == 0) return@LaunchedEffect
        delay(40)
        runCatching { paneFocus.requestFocus() }
    }

    /** 选中的项(按列表顺序);没选东西时是键盘所在的那一项。 */
    fun selection(): List<RemoteEntry> {
        val list = entries.orEmpty()
        val picked = list.filter { it.path in marked }
        return picked.ifEmpty { listOfNotNull(list.firstOrNull { it.path == cursor }) }
    }
    /** 右键 / 长按某一项时作用于谁:它在多选里就是整个多选,否则就是它自己。 */
    fun targetsFor(entry: RemoteEntry): List<RemoteEntry> =
        if (entry.path in marked && marked.size > 1) selection() else listOf(entry)

    // 「下载到…」:系统文件夹选择器。回调拿不到"要下的是哪些",先记在这里。
    val pendingTargets = remember { arrayOfNulls<List<RemoteEntry>>(1) }
    val pickTree = rememberLauncherForActivityResult(ActivityResultContracts.OpenDocumentTree()) { tree ->
        val targets = pendingTargets[0]
        pendingTargets[0] = null
        if (tree != null && targets != null) files.downloadTo(targets, tree, context)
    }
    fun downloadTo(targets: List<RemoteEntry>) {
        if (targets.isEmpty()) return
        pendingTargets[0] = targets
        pickTree.launch(null)
    }
    fun download(targets: List<RemoteEntry>) {
        if (targets.isEmpty()) return
        // Android 9 及以下没有系统下载目录的 MediaStore 接口:改问放哪儿。
        if (!files.download(targets, context)) downloadTo(targets)
    }

    fun startUpload(uris: List<Uri>) {
        val dir = path ?: return
        if (uris.isEmpty()) return
        scope.launch {
            val items = withContext(Dispatchers.IO) { uris.map { describe(resolver, it) } }
            val names = entries.orEmpty().map { it.name }.toSet()
            val clashes = items.count { it.name in names }
            if (clashes == 0) {
                files.upload(dir, items, context)
            } else {
                val title = if (items.size == 1) {
                    context.getString(R.string.files_replace_one, items[0].name)
                } else {
                    context.resources.getQuantityString(R.plurals.files_replace_many, clashes, clashes)
                }
                dialog = FilesDialog.Replace(title, dir, items, emptyList())
            }
        }
    }
    val pickUpload = rememberLauncherForActivityResult(ActivityResultContracts.OpenMultipleDocuments()) { uris ->
        startUpload(uris)
    }
    val pickFolder = rememberLauncherForActivityResult(ActivityResultContracts.OpenDocumentTree()) { tree ->
        val dir = path ?: return@rememberLauncherForActivityResult
        tree ?: return@rememberLauncherForActivityResult
        scope.launch {
            val (dirs, items) = runCatching { withContext(Dispatchers.IO) { walkLocalTree(resolver, tree) } }
                .getOrElse { e ->
                    files.notify(FileText.of(R.string.files_cannot_read_folder, e.reason()), error = true)
                    return@launch
                }
            val top = dirs.first()
            if (entries.orEmpty().any { it.name == top }) {
                dialog = FilesDialog.Replace(context.getString(R.string.files_merge_folder, top), dir, items, dirs)
            } else {
                files.upload(dir, items, context, dirs)
            }
        }
    }
    fun pickFiles() {
        pickUpload.launch(arrayOf("*/*"))
    }
    fun pickFolderToUpload() {
        pickFolder.launch(null)
    }

    fun share(targets: List<RemoteEntry>) {
        if (targets.isEmpty()) return
        files.share(targets, context)
    }

    fun open(entry: RemoteEntry) {
        only(entry.path)
        when {
            entry.isDir -> load(entry.path)
            entry.isLink -> scope.launch {
                val dir = runCatching { files.isDir(entry.path) }.getOrDefault(false)
                if (dir) load(entry.path) else files.open(entry, context)
            }
            else -> files.open(entry, context)
        }
    }

    fun copyPaths(targets: List<RemoteEntry>) {
        if (targets.isNotEmpty()) copyText(context, targets.joinToString("\n") { it.path })
    }

    // 菜单项在菜单弹出时才建(不在组合里),文字用 context 取。
    fun menuFor(entry: RemoteEntry): List<MenuAction> = buildList {
        val targets = targetsFor(entry)
        val res = context.resources
        if (targets.size > 1) {
            add(MenuAction(res.getQuantityString(R.plurals.files_download_n, targets.size, targets.size), shortcut = "Ctrl+D") { download(targets) })
            add(MenuAction(res.getString(R.string.files_download_to)) { downloadTo(targets) })
            add(MenuAction(res.getString(R.string.files_share)) { share(targets) })
            add(MenuAction(res.getString(R.string.files_copy_path), shortcut = "Ctrl+C") { copyPaths(targets) })
            add(
                MenuAction(res.getQuantityString(R.plurals.files_delete_n_ellipsis, targets.size, targets.size), danger = true, shortcut = "Delete") {
                    dialog = FilesDialog.Delete(targets)
                },
            )
            return@buildList
        }
        add(MenuAction(res.getString(R.string.files_open), shortcut = res.getString(R.string.files_key_enter)) { open(entry) })
        add(MenuAction(res.getString(R.string.files_download), shortcut = "Ctrl+D") { download(targets) })
        add(MenuAction(res.getString(R.string.files_download_to)) { downloadTo(targets) })
        add(MenuAction(res.getString(R.string.files_share)) { share(targets) })
        add(MenuAction(res.getString(R.string.files_copy_path), shortcut = "Ctrl+C") { copyPaths(targets) })
        add(MenuAction(res.getString(R.string.files_rename_ellipsis), shortcut = "F2") { dialog = FilesDialog.Rename(entry) })
        add(MenuAction(res.getString(R.string.files_select_multiple)) {
            selectMode = true
            only(entry.path)
        })
        add(MenuAction(res.getString(R.string.files_delete_ellipsis), danger = true, shortcut = "Delete") { dialog = FilesDialog.Delete(targets) })
    }
    fun uploadMenu(): List<MenuAction> = listOf(
        MenuAction(context.getString(R.string.files_upload_files), shortcut = "Ctrl+U") { pickFiles() },
        MenuAction(context.getString(R.string.files_upload_folder), shortcut = "Ctrl+Shift+U") { pickFolderToUpload() },
    )
    fun backgroundMenu(): List<MenuAction> = buildList {
        addAll(uploadMenu())
        add(MenuAction(context.getString(R.string.files_new_folder_ellipsis)) { dialog = FilesDialog.NewFolder })
        add(MenuAction(context.getString(R.string.files_select_all), shortcut = "Ctrl+A") {
            marked = entries.orEmpty().mapTo(HashSet()) { it.path }
        })
        add(MenuAction(context.getString(R.string.files_refresh), shortcut = "Ctrl+R") { refresh() })
        add(MenuAction(context.getString(R.string.files_go_to_path_ellipsis), shortcut = "Ctrl+L") { dialog = FilesDialog.GoTo })
        path?.let { add(MenuAction(context.getString(R.string.files_copy_current_path)) { copyText(context, it) }) }
    }

    var typed by remember { mutableStateOf("") }
    var typedAt by remember { mutableLongStateOf(0L) }

    fun scrollIntoView(at: Int) {
        scope.launch {
            val visible = listState.layoutInfo.visibleItemsInfo
            val first = visible.firstOrNull()?.index ?: 0
            val last = visible.lastOrNull()?.index ?: 0
            // 完整露出来的才算看得见:最后一项常常只露半截。
            if (at < first || at >= last) {
                listState.animateScrollToItem((at - (visible.size - 2).coerceAtLeast(0) / 2).coerceAtLeast(0))
            }
        }
    }
    /** 从 [anchor] 连选到 [to](含两端)。 */
    fun range(to: String): Set<String> {
        val list = entries.orEmpty()
        val a = list.indexOfFirst { it.path == (anchor ?: to) }.coerceAtLeast(0)
        val b = list.indexOfFirst { it.path == to }.coerceAtLeast(0)
        return list.subList(minOf(a, b), maxOf(a, b) + 1).mapTo(HashSet()) { it.path }
    }
    /** 键盘移动到第 [index] 项;[extend] = 按着 Shift,从起点连选过去。 */
    fun moveTo(index: Int, extend: Boolean = false) {
        val list = entries ?: return
        if (list.isEmpty()) return
        val at = index.coerceIn(0, list.lastIndex)
        val target = list[at].path
        if (extend) {
            if (anchor == null) anchor = cursor ?: target
            cursor = target
            marked = range(target)
        } else {
            only(target)
        }
        scrollIntoView(at)
    }
    fun clickRow(entry: RemoteEntry, ctrl: Boolean, shift: Boolean) {
        when {
            shift -> {
                if (anchor == null) anchor = cursor ?: entry.path
                cursor = entry.path
                marked = range(entry.path)
            }
            ctrl || selectMode -> {
                marked = if (entry.path in marked) marked - entry.path else marked + entry.path
                cursor = entry.path
                anchor = entry.path
                if (selectMode && marked.isEmpty()) selectMode = false
            }
            else -> only(entry.path)
        }
        runCatching { paneFocus.requestFocus() }
    }
    fun clearSelection() {
        selectMode = false
        marked = emptySet()
    }

    val onKey: (androidx.compose.ui.input.key.KeyEvent) -> Boolean = handler@{ event ->
        val e = event.nativeKeyEvent
        if (e.action != AndroidKeyEvent.ACTION_DOWN || dialog != null) return@handler false
        val list = entries.orEmpty()
        val at = list.indexOfFirst { it.path == cursor }
        val current = list.getOrNull(at)
        val ctrl = e.isCtrlPressed && !e.isAltPressed && !e.isMetaPressed
        val plain = !e.isCtrlPressed && !e.isAltPressed && !e.isMetaPressed
        val shift = e.isShiftPressed
        if (ctrl) {
            when {
                e.keyCode == AndroidKeyEvent.KEYCODE_U && shift -> pickFolderToUpload()
                shift -> return@handler false
                e.keyCode == AndroidKeyEvent.KEYCODE_R -> refresh()
                e.keyCode == AndroidKeyEvent.KEYCODE_U -> pickFiles()
                e.keyCode == AndroidKeyEvent.KEYCODE_D -> download(selection())
                e.keyCode == AndroidKeyEvent.KEYCODE_A -> marked = list.mapTo(HashSet()) { it.path }
                e.keyCode == AndroidKeyEvent.KEYCODE_C -> {
                    val picked = selection()
                    if (picked.isEmpty()) copyText(context, path ?: return@handler false) else copyPaths(picked)
                }
                e.keyCode == AndroidKeyEvent.KEYCODE_L -> dialog = FilesDialog.GoTo
                else -> return@handler false
            }
            return@handler true
        }
        when (e.keyCode) {
            AndroidKeyEvent.KEYCODE_DPAD_UP -> when {
                e.isAltPressed -> goUp()
                else -> moveTo(if (at < 0) list.lastIndex else at - 1, extend = shift)
            }
            AndroidKeyEvent.KEYCODE_DPAD_DOWN -> when {
                e.isAltPressed -> current?.let(::open)
                else -> moveTo(at + 1, extend = shift)
            }
            AndroidKeyEvent.KEYCODE_MOVE_HOME -> moveTo(0, extend = shift)
            AndroidKeyEvent.KEYCODE_MOVE_END -> moveTo(list.lastIndex, extend = shift)
            AndroidKeyEvent.KEYCODE_PAGE_UP -> moveTo(at - 10, extend = shift)
            AndroidKeyEvent.KEYCODE_PAGE_DOWN -> moveTo(at + 10, extend = shift)
            AndroidKeyEvent.KEYCODE_ENTER, AndroidKeyEvent.KEYCODE_NUMPAD_ENTER -> open(current ?: return@handler false)
            AndroidKeyEvent.KEYCODE_DEL -> goUp()
            AndroidKeyEvent.KEYCODE_FORWARD_DEL -> dialog = FilesDialog.Delete(selection().ifEmpty { return@handler false })
            AndroidKeyEvent.KEYCODE_F2 -> dialog = FilesDialog.Rename(current ?: return@handler false)
            AndroidKeyEvent.KEYCODE_F5 -> refresh()
            AndroidKeyEvent.KEYCODE_ESCAPE -> {
                // 先退多选(留下光标那一项),再取消选中。
                if (selectMode || marked.size > 1) {
                    selectMode = false
                    marked = setOfNotNull(cursor)
                } else {
                    marked = emptySet()
                    cursor = null
                }
            }
            else -> {
                // 按首字母跳转:900ms 内连着敲的字拼成一个前缀。
                if (!plain || !e.isPrintingKey || e.keyCode == AndroidKeyEvent.KEYCODE_SPACE) return@handler false
                val ch = e.unicodeChar.takeIf { it > 0 }?.toChar() ?: return@handler false
                val now = SystemClock.uptimeMillis()
                typed = if (now - typedAt > 900) ch.toString() else typed + ch
                typedAt = now
                val index = list.indexOfFirst { it.name.startsWith(typed, ignoreCase = true) }
                if (index >= 0) moveTo(index)
            }
        }
        true
    }

    val dropTarget = remember {
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
                val drag = event.toAndroidDragEvent()
                val clip = drag.clipData ?: return false
                val uris = (0 until clip.itemCount).mapNotNull { clip.getItemAt(it).uri }
                if (uris.isEmpty()) return false
                // 跨应用拖进来的文件要先申请读取权限,否则打不开。
                (context as? android.app.Activity)?.requestDragAndDropPermissions(drag)
                startUpload(uris)
                return true
            }
        }
    }

    val retry: () -> Unit = {
        failure = null
        files.reset()
        val start = path
        if (start != null) load(start) else scope.launch {
            runCatching { files.home() }
                .onSuccess { load(it) }
                .onFailure { e -> failure = e.reason() }
        }
    }
    // 底部的条和列表的文字对齐:手机页的文字从 32dp 起,平板表格约 20dp 起。
    val barInset = if (chrome is FilesChrome.Phone) Gutter + BoxPad else 18.dp
    val bars: @Composable () -> Unit = {
        if (selectMode || marked.size > 1) {
            SelectionBar(
                inset = barInset,
                count = marked.size,
                onDownload = { download(selection()) },
                onDownloadTo = { downloadTo(selection()) },
                onShare = { share(selection()) },
                onDelete = { selection().takeIf { it.isNotEmpty() }?.let { dialog = FilesDialog.Delete(it) } },
                onDone = ::clearSelection,
            )
        }
        transfer?.let {
            TransferBar(
                it,
                queued = queued,
                inset = barInset,
                onCancel = files::cancelTransfer,
                onCancelAll = files::cancelAllTransfers,
            )
        }
        NoticeBar(notice, inset = barInset)
    }
    val dropModifier = Modifier
        .border(if (dropHover) 2.dp else 0.dp, if (dropHover) p.accent else Color.Transparent)
        .dragAndDropTarget(
            shouldStartDragAndDrop = { event ->
                event.toAndroidDragEvent().clipDescription?.let { it.mimeTypeCount > 0 } == true
            },
            target = dropTarget,
        )

    if (chrome is FilesChrome.Phone) {
        // 手机:返回键先一级一级退回走过的目录,退完了才回终端(由外层的页面流接管)。
        BackHandler(enabled = history.isNotEmpty() && dialog == null) { back() }
        // 多选中:返回先退出多选(后注册的优先)。
        BackHandler(enabled = (selectMode || marked.size > 1) && dialog == null) { clearSelection() }
        PhoneFiles(
            path = path,
            entries = entries,
            failure = failure,
            loading = loading,
            marked = marked,
            cursor = cursor,
            selectMode = selectMode,
            listState = listState,
            modifier = Modifier.focusRequester(paneFocus).focusable().onKeyEvent(onKey),
            dropModifier = dropModifier,
            onRetry = retry,
            onBack = ::back,
            onUp = ::goUp,
            onGoTo = { dialog = FilesDialog.GoTo },
            onRow = { entry -> if (selectMode) clickRow(entry, ctrl = false, shift = false) else open(entry) },
            onMenu = { entry -> if (entry.path !in marked) only(entry.path) },
            menuFor = ::menuFor,
            uploadMenu = ::uploadMenu,
            onNewFolder = { dialog = FilesDialog.NewFolder },
            actions = PhoneFileActions(
                open = ::open,
                select = { only(it.path) },
                download = { download(listOf(it)) },
                downloadTo = { downloadTo(listOf(it)) },
                share = { share(listOf(it)) },
                copyPath = { copyPaths(listOf(it)) },
                rename = { dialog = FilesDialog.Rename(it) },
                delete = { dialog = FilesDialog.Delete(listOf(it)) },
                cachedUri = { cacheEpoch; files.cachedUri(it.path) },
                prepareDrag = { entry ->
                    if (entry.isDir) files.notify(FileText.of(R.string.files_drag_cached_only))
                    else {
                        files.notify(FileText.of(R.string.files_drag_cached_only))
                        share(listOf(entry))
                    }
                },
            ),
            bars = bars,
        )
    } else {
    val tablet = chrome as FilesChrome.Tablet
    Column(
        Modifier
            .fillMaxSize()
            .focusRequester(paneFocus)
            .focusable()
            .onKeyEvent(onKey),
    ) {
        TabletToolbar(
            sidebarVisible = tablet.sidebarVisible,
            onToggleSidebar = tablet.onToggleSidebar,
            title = host.label,
            subtitle = host.subtitle,
            dot = p.ok,
        ) {
            PaneSwitch(files = true) { if (!it) tablet.onShowTerminal() }
            Spacer(Modifier.width(8.dp))
            var uploadOpen by remember { mutableStateOf(false) }
            Box {
                ToolbarIcon(XIcons.Upload, stringResource(R.string.files_upload)) { uploadOpen = true }
                ContextMenu(at = if (uploadOpen) DpOffset.Zero else null, onDismiss = { uploadOpen = false }, actions = ::uploadMenu)
            }
            ToolbarIcon(XIcons.FolderPlus, stringResource(R.string.files_new_folder)) { dialog = FilesDialog.NewFolder }
            ToolbarIcon(XIcons.Refresh, stringResource(R.string.files_refresh) + "  Ctrl+R") { refresh() }
        }
        PathBar(path = path, onGo = { load(it) }, onUp = ::goUp, onEdit = { dialog = FilesDialog.GoTo })
        BoxWithConstraints(Modifier.weight(1f).fillMaxWidth().then(dropModifier)) {
            // 窄(竖屏开着侧边栏)时收起修改时间这一列。
            val showTime = maxWidth >= 560.dp
            var backgroundMenuAt by remember { mutableStateOf<DpOffset?>(null) }
            var boxHeight by remember { mutableIntStateOf(0) }
            Column(
                Modifier
                    .fillMaxSize()
                    .onSizeChanged { boxHeight = it.height }
                    // 空白处右键:上传 / 新建文件夹 / 刷新。行自己的右键在 Initial 阶段就消费掉了,不会走到这里。
                    .pointerInput(Unit) {
                        awaitPointerEventScope {
                            while (true) {
                                val event = awaitPointerEvent(PointerEventPass.Main)
                                if (event.type == PointerEventType.Press && event.buttons.isSecondaryPressed &&
                                    event.changes.none { it.isConsumed }
                                ) {
                                    val at = event.changes.first().position
                                    event.changes.forEach { it.consume() }
                                    backgroundMenuAt = with(density) { DpOffset(at.x.toDp(), (at.y - boxHeight).toDp()) }
                                }
                            }
                        }
                    },
            ) {
                ColumnHeader(showTime)
                val list = entries
                when {
                    failure != null && list == null -> CenterNote(failure!!.text()) {
                        XsshButton(stringResource(R.string.files_retry)) { retry() }
                    }
                    list == null -> if (loading) CenterBusy() else CenterNote("…")
                    list.isEmpty() -> CenterNote(stringResource(R.string.files_empty_folder))
                    else -> LazyColumn(Modifier.fillMaxSize().bounce(), state = listState) {
                        itemsIndexed(list, key = { _, it -> it.path }) { index, entry ->
                            FileRow(
                                entry = entry,
                                striped = index % 2 == 1,
                                selected = entry.path in marked,
                                checkMode = selectMode,
                                showTime = showTime,
                                onClick = { ctrl, shift -> clickRow(entry, ctrl, shift) },
                                onOpen = { open(entry) },
                                // 右键点到没选中的那项:选中它(和 Finder 一样);点到已选的,菜单作用于整个多选。
                                onMenu = { if (entry.path !in marked) only(entry.path) },
                                menu = { menuFor(entry) },
                            )
                        }
                        item(key = "tail") { Spacer(Modifier.height(24.dp)) }
                    }
                }
            }
            ContextMenu(at = backgroundMenuAt, onDismiss = { backgroundMenuAt = null }, actions = ::backgroundMenu)
        }
        bars()
    }
    }
    when (val d = dialog) {
        null -> {}
        FilesDialog.GoTo -> NameDialog(
            title = stringResource(R.string.files_go_to_path),
            initial = path.orEmpty(),
            confirm = stringResource(R.string.files_go),
            isPath = true,
            onConfirm = { target ->
                dialog = null
                // 相对路径按当前目录算;`~` 回家目录。
                when {
                    target == "~" -> scope.launch { runCatching { files.home() }.onSuccess { load(it) } }
                    target.startsWith("/") -> load(target.trimEnd('/').ifEmpty { "/" })
                    else -> load(joinPath(path ?: "/", target).trimEnd('/'))
                }
            },
            onDismiss = { dialog = null },
        )
        is FilesDialog.Rename -> NameDialog(
            title = stringResource(R.string.files_rename),
            initial = d.entry.name,
            confirm = stringResource(R.string.files_rename),
            onConfirm = { name ->
                dialog = null
                val dir = path ?: return@NameDialog
                if (name == d.entry.name) return@NameDialog
                val to = joinPath(dir, name)
                scope.launch {
                    runCatching { files.rename(d.entry.path, to) }
                        .onSuccess { load(dir, select = to) }
                        .onFailure { e -> files.notify(FileText.of(R.string.files_rename_failed, e.reason()), error = true) }
                }
            },
            onDismiss = { dialog = null },
        )
        FilesDialog.NewFolder -> NameDialog(
            title = stringResource(R.string.files_new_folder),
            initial = "",
            confirm = stringResource(R.string.files_create),
            onConfirm = { name ->
                dialog = null
                val dir = path ?: return@NameDialog
                val at = joinPath(dir, name)
                scope.launch {
                    runCatching { files.mkdir(at) }
                        .onSuccess { load(dir, select = at) }
                        .onFailure { e -> files.notify(FileText.of(R.string.files_create_failed, e.reason()), error = true) }
                }
            },
            onDismiss = { dialog = null },
        )
        is FilesDialog.Delete -> ConfirmDialog(
            title = d.entries.singleOrNull()?.let { stringResource(R.string.files_delete_one_title, it.name) }
                ?: pluralStringResource(R.plurals.files_delete_n_title, d.entries.size, d.entries.size),
            message = if (d.entries.any { it.isDir && !it.isLink }) stringResource(R.string.files_delete_folder_note) else null,
            confirm = stringResource(R.string.files_delete),
            danger = true,
            onConfirm = {
                dialog = null
                val list = entries.orEmpty()
                val gone = d.entries.mapTo(HashSet()) { it.path }
                // 删完光标挪到被删的最后一项的下一项(没有就往上找),接着按 Delete 能继续删。
                val last = list.indexOfLast { it.path in gone }
                val next = (list.drop(last + 1) + list.take(last).reversed()).firstOrNull { it.path !in gone }?.path
                scope.launch {
                    runCatching { files.remove(d.entries) }
                        .onSuccess { path?.let { load(it, select = next) } }
                        .onFailure { e ->
                            files.notify(FileText.of(R.string.files_delete_failed, e.reason()), error = true)
                            refresh()
                        }
                }
            },
            onDismiss = { dialog = null },
        )
        is FilesDialog.Replace -> ConfirmDialog(
            title = d.title,
            message = null,
            confirm = stringResource(R.string.files_replace),
            danger = true,
            onConfirm = {
                dialog = null
                files.upload(d.dir, d.items, context, d.dirs)
            },
            onDismiss = { dialog = null },
        )
    }
}

/** 文件页在手机 / 折叠屏上的操作(详情栏的按钮、行的点按)。 */
private class PhoneFileActions(
    val open: (RemoteEntry) -> Unit,
    val select: (RemoteEntry) -> Unit,
    val download: (RemoteEntry) -> Unit,
    val downloadTo: (RemoteEntry) -> Unit,
    val share: (RemoteEntry) -> Unit,
    val copyPath: (RemoteEntry) -> Unit,
    val rename: (RemoteEntry) -> Unit,
    val delete: (RemoteEntry) -> Unit,
    /** 已缓存的本地 URI(打开 / 分享后),供详情栏鼠标拖出。 */
    val cachedUri: (RemoteEntry) -> android.net.Uri? = { null },
    /** 还没缓存时点拖:走分享下载。 */
    val prepareDrag: (RemoteEntry) -> Unit = {},
)

/**
 * 手机 / 折叠屏的文件页:和主机页、编辑页同一套版式 —— 大标题(当前文件夹)+ 路径(点一下手动输入),
 * 列表每项两行(名字 / 大小·时间);折叠屏按钮在右侧轨道(上传 / 新建文件夹 + ‹),直板机在底栏(左 ‹、右操作)。
 *
 * 宽屏(折叠屏内屏横着、≥ 840dp)和主机页一样**关于折痕分两栏**:左栏是列表,右栏是选中文件的详情和操作
 * (打开 / 下载 / 下载到… / 重命名 / 删除)—— 行不再横跨折痕。单栏时点文件直接打开,长按出菜单。
 * 选了多项、传输中、有提示时,底部的条垫在导航条上面,轨道跟着升上去。
 */
@Composable
private fun PhoneFiles(
    path: String?,
    entries: List<RemoteEntry>?,
    failure: FileText?,
    loading: Boolean,
    marked: Set<String>,
    cursor: String?,
    selectMode: Boolean,
    listState: LazyListState,
    modifier: Modifier,
    dropModifier: Modifier,
    onRetry: () -> Unit,
    onBack: () -> Unit,
    onUp: () -> Unit,
    onGoTo: () -> Unit,
    onRow: (RemoteEntry) -> Unit,
    onMenu: (RemoteEntry) -> Unit,
    menuFor: (RemoteEntry) -> List<MenuAction>,
    uploadMenu: () -> List<MenuAction>,
    onNewFolder: () -> Unit,
    actions: PhoneFileActions,
    bars: @Composable () -> Unit,
) {
    val p = LocalXssh.current
    val density = LocalDensity.current
    val adaptive = LocalAdaptive.current
    val bottomBar = LocalChrome.current == Chrome.BottomBar
    val backdrop = rememberLayerBackdrop()
    val insets = stableSafeDrawing()
    val startInset = insets.asPaddingValues().calculateStartPadding(LocalLayoutDirection.current)
    var barsHeight by remember { mutableIntStateOf(0) }
    val barsDp = with(density) { barsHeight.toDp() }
    val navDp = insets.asPaddingValues().calculateBottomPadding()
    val thisYear = rememberThisYear()

    val railActions: @Composable () -> Unit = {
        // 上传是这一页的主操作,放在胶囊最下面(轨道最下面那个位置,和编辑页的 ✓ 同一个落点)。
        GlassGroup {
            GlassItem(XIcons.FolderPlus, stringResource(R.string.files_new_folder)) { onNewFolder() }
            var uploadOpen by remember { mutableStateOf(false) }
            Box {
                GlassItem(XIcons.Upload, stringResource(R.string.files_upload)) { uploadOpen = true }
                ContextMenu(at = if (uploadOpen) DpOffset.Zero else null, onDismiss = { uploadOpen = false }, actions = uploadMenu)
            }
        }
    }

    BoxWithConstraints(modifier.fillMaxSize().background(p.bg)) {
        // 和主机页同一个判据(量整窗,不看 Configuration)。
        val pageWidth = maxWidth
        val twoPane = pageWidth >= 840.dp || (adaptive.bookFold != null && pageWidth >= 600.dp)
        val listWidth = if (twoPane) adaptive.listPaneWidth(pageWidth).coerceAtMost(pageWidth - 280.dp) else pageWidth
        val rowStart = startInset + Gutter + BoxPad
        val clearance = (if (bottomBar) BarClearance else RailClearance) + barsDp + navDp
        // 双栏:右栏让开了轨道,左栏就收到同样宽,别一边长一边短(同主机页、编辑页,见 creaseGapFor)。
        // 放在外面算:直板机横屏的底栏只铺在左栏底下,右端要和左栏的行对齐。
        val creaseWidth = maxOf(1.dp, adaptive.bookFold?.sizeDp ?: 0.dp)
        val listEnd = creaseGapFor(
            listWidth,
            startInset + Gutter,
            (pageWidth - listWidth - creaseWidth) - Gutter * 2 - railSide(),
        )

        val list: @Composable (Modifier, androidx.compose.ui.unit.Dp) -> Unit = { listModifier, endPad ->
            LazyColumn(
                listModifier.then(dropModifier).bounce(),
                state = listState,
                contentPadding = PaddingValues(
                    // 最后一项要能滚到轨道 / 底栏 / 底部的条上面。折叠屏双栏时轨道在右栏,左栏只让底部的条;
                    // 直板机横屏的底栏就铺在这一栏底下,照样要让。
                    bottom = if (twoPane && !bottomBar) 24.dp + barsDp + navDp else clearance,
                ),
            ) {
                item(key = "title") {
                    val name = path?.trimEnd('/')?.substringAfterLast('/')?.ifEmpty { "/" } ?: ""
                    Column(Modifier.padding(start = rowStart, end = endPad, top = Gutter, bottom = 10.dp)) {
                        Text(
                            name,
                            Modifier.offset(x = -TitleOptical),
                            color = p.text,
                            fontSize = 34.sp,
                            fontWeight = FontWeight.Bold,
                            maxLines = 1,
                            overflow = TextOverflow.Ellipsis,
                        )
                        // 路径:点一下手动输入。热区撑到 48dp 高、整行宽(Material / HIG 的最小触控尺寸),
                        // 字本身只有 12.5sp —— 原来 32dp 高、只有字那么宽,真机上常常点到下面的列表。
                        Box(
                            Modifier
                                .fillMaxWidth()
                                .heightIn(min = 48.dp)
                                .clickable(interactionSource = remember { MutableInteractionSource() }, indication = null) { onGoTo() },
                            contentAlignment = Alignment.CenterStart,
                        ) {
                            Text(
                                path.orEmpty(),
                                color = p.textDim,
                                fontSize = 12.5.sp,
                                fontFamily = XsshFonts.monoUi,
                                maxLines = 1,
                                overflow = TextOverflow.MiddleEllipsis,
                            )
                        }
                    }
                }
                val items = entries
                when {
                    failure != null && items == null -> item(key = "failure") {
                        Column(Modifier.fillMaxWidth().padding(start = rowStart, end = endPad, top = 24.dp)) {
                            Text(failure.text(), color = p.textDim, fontSize = 14.sp)
                            Spacer(Modifier.height(16.dp))
                            XsshButton(stringResource(R.string.files_retry)) { onRetry() }
                        }
                    }
                    items == null -> item(key = "loading") {
                        if (loading) {
                            Row(Modifier.fillMaxWidth().padding(start = rowStart, top = 20.dp), horizontalArrangement = Arrangement.Start) {
                                CircularProgressIndicator(Modifier.size(20.dp), strokeWidth = 2.dp)
                            }
                        } else {
                            Text("…", color = p.textDim, modifier = Modifier.padding(start = rowStart, top = 24.dp))
                        }
                    }
                    else -> {
                        if (path != null && path != "/") {
                            item(key = "up") {
                                PhoneFileRow(
                                    icon = XIcons.ArrowUp,
                                    name = parentPath(path).trimEnd('/').substringAfterLast('/').ifEmpty { "/" },
                                    meta = null,
                                    dim = true,
                                    chevron = false,
                                    start = rowStart,
                                    end = endPad,
                                    checkMode = false,
                                    selected = false,
                                    link = false,
                                    onClick = onUp,
                                    menu = null,
                                )
                            }
                        }
                        if (items.isEmpty()) {
                            item(key = "empty") {
                                Text(stringResource(R.string.files_empty_folder), color = p.textDim, fontSize = 14.sp, modifier = Modifier.padding(start = rowStart, top = 24.dp))
                            }
                        }
                        items(items, key = { it.path }) { entry ->
                            PhoneFileRow(
                                icon = if (entry.isDir) XIcons.Folder else XIcons.File,
                                name = entry.name,
                                meta = entryMeta(entry, thisYear),
                                dim = false,
                                chevron = entry.isDir,
                                start = rowStart,
                                end = endPad,
                                checkMode = selectMode,
                                // 双栏:右栏正在显示的那一项要看得出来(和主机页一样)。
                                selected = entry.path in marked && (selectMode || twoPane),
                                link = entry.isLink,
                                accentIcon = entry.isDir,
                                onClick = {
                                    // 双栏里点文件 = 选中,在右栏看详情再决定打开还是下载;目录照样点进去。
                                    if (twoPane && !selectMode && !entry.isDir) actions.select(entry) else onRow(entry)
                                },
                                onMenu = { onMenu(entry) },
                                menu = { menuFor(entry) },
                            )
                        }
                    }
                }
            }
        }

        if (twoPane) {
            val shown = entries?.firstOrNull { it.path == cursor }
            Row(
                Modifier
                    .fillMaxSize()
                    .layerBackdrop(backdrop)
                    .background(p.bg)
                    .windowInsetsPadding(insets.only(WindowInsetsSides.Top)),
            ) {
                list(Modifier.width(listWidth).fillMaxHeight(), listEnd)
                Spacer(Modifier.width(creaseWidth))
                AnimatedContent(
                    targetState = shown,
                    contentKey = { it?.path },
                    transitionSpec = { fadeIn(Motion.reveal()) togetherWith fadeOut(Motion.reveal()) },
                    modifier = Modifier.weight(1f).fillMaxHeight().windowInsetsPadding(insets.only(WindowInsetsSides.End)),
                    label = "fileDetail",
                ) { entry ->
                    // 折叠屏的轨道浮在右栏右下角:按钮组整列让开轨道,别让「下载到…」「删除」压在玻璃底下。
                    FileDetailPane(entry, bottomInset = barsDp + navDp, endPad = railSide(), actions = actions)
                }
            }
        } else {
            list(
                Modifier
                    .fillMaxSize()
                    .layerBackdrop(backdrop)
                    .background(p.bg)
                    .windowInsetsPadding(insets.only(WindowInsetsSides.Top + WindowInsetsSides.End)),
                // 单栏:右边让开轨道,文件大小这类右对齐的取值不被玻璃压住(见 railSide)。
                railSide(),
            )
        }

        if (bottomBar) {
            CompositionLocalProvider(LocalBackdrop provides backdrop) {
                // 直板机:底栏,左 ‹ 右操作。底部有条(多选 / 传输)时整条往上让,叠在条上面。
                // 横屏双栏只铺在左栏(列表)底下:右栏是文件详情,自己有「下载到… / 删除」(同主机页)。
                BottomBar(
                    if (twoPane) {
                        Modifier.align(Alignment.BottomStart).width(listWidth).padding(end = listEnd - Gutter, bottom = barsDp)
                    } else {
                        Modifier.align(Alignment.BottomCenter).padding(bottom = barsDp)
                    },
                    sides = if (twoPane) {
                        WindowInsetsSides.Start + WindowInsetsSides.Bottom
                    } else {
                        WindowInsetsSides.Horizontal + WindowInsetsSides.Bottom
                    },
                    start = { GlassButton(XIcons.Back, stringResource(R.string.files_back)) { onBack() } },
                    end = {
                        GlassGroup { ThemeGlassItem() }
                        railActions()
                    },
                )
            }
        } else {
            CompositionLocalProvider(LocalBackdrop provides backdrop) {
                // 和终端页的轨道同一个位置;底部有条时整条往上让。
                //
                // ‹ 在上、胶囊在下(同编辑页 ‹ ✓)。**‹ 绝不能在最下面**:终端页最下面是红色的 ✕(断开),
                // 一路点 ‹ 往回退,退出文件页的那一下之后,下一下就落在 ✕ 上 —— 实测把会话断掉了。
                // 现在连点 ‹ 落到终端页的是 ⌘(开关快捷键栏),无害。
                EdgeRail(Modifier.align(Alignment.BottomEnd).padding(bottom = barsDp)) {
                    // 外观在最上面(每一页都有,位置一样)。
                    GlassGroup { ThemeGlassItem() }
                    GlassButton(XIcons.Back, stringResource(R.string.files_back)) { onBack() }
                    railActions()
                }
            }
        }

        // 底部的条(多选 / 传输 / 提示)。垫在导航条上面;没有条时不占地方、不画底色。
        Column(
            Modifier
                .align(Alignment.BottomCenter)
                .fillMaxWidth()
                .background(if (barsHeight > 0) p.cardBg else Color.Transparent)
                .windowInsetsPadding(insets.only(WindowInsetsSides.Bottom + WindowInsetsSides.Horizontal)),
        ) {
            Column(Modifier.fillMaxWidth().onSizeChanged { barsHeight = it.height }) { bars() }
        }
    }
}

/** 列表第二行的小字:目录只写时间,文件写「大小 · 时间」。 */
private fun entryMeta(entry: RemoteEntry, thisYear: DateTimeFormatter): String {
    val time = formatTime(entry.modified.toLong(), thisYear)
    return if (entry.isDir) time else listOf(formatSize(entry.size.toLong()), time).filter { it.isNotEmpty() }.joinToString(" · ")
}

/** `0o755` → `rwxr-xr-x`。 */
private fun permissionString(mode: UInt): String {
    val bits = mode.toInt()
    return buildString {
        for (shift in intArrayOf(6, 3, 0)) {
            val part = (bits shr shift) and 7
            append(if (part and 4 != 0) 'r' else '-')
            append(if (part and 2 != 0) 'w' else '-')
            append(if (part and 1 != 0) 'x' else '-')
        }
    }
}

/**
 * 双栏的右栏:选中那一项的详情和操作。版式照主机页的详情栏 —— 只有一条左缘(折痕后 32dp),
 * 标题、详情、按钮都从这里起;按钮组限宽。
 */
@Composable
private fun FileDetailPane(
    entry: RemoteEntry?,
    /** 按钮组底下要让开的系统栏高度(导航条 / 手势条)。 */
    bottomInset: androidx.compose.ui.unit.Dp,
    endPad: androidx.compose.ui.unit.Dp,
    actions: PhoneFileActions,
) {
    val p = LocalXssh.current
    if (entry == null) {
        Column(
            Modifier.fillMaxSize().padding(Gutter + BoxPad),
            verticalArrangement = Arrangement.Center,
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            Text(stringResource(R.string.files_pick_on_left), color = p.textDim, fontSize = 15.sp)
        }
        return
    }
    // 信息在上面(放不下就自己滚),按钮组贴着栏底 —— 和主机详情页同一条规矩:
    // 要看的在上、要按的在下。这里按钮有六颗、占得高,所以是**各占各的地方**,
    // 不像主机详情那样浮在正文上面(那会遮掉小半页)。
    Column(Modifier.fillMaxSize()) {
        Column(
            Modifier
                .weight(1f)
                .bounce()
                .verticalScroll(rememberScrollState())
                .padding(start = Gutter * 2, end = endPad, top = Gutter),
        ) {
            val dragUri = if (!entry.isDir) actions.cachedUri(entry) else null
            Text(
                entry.name,
                Modifier
                    .offset(x = -TitleOptical)
                    .remoteDragOut(dragUri, entry.name) { actions.prepareDrag(entry) },
                color = p.text,
                fontSize = 28.sp,
                fontWeight = FontWeight.Bold,
                // 文件名常常很长(打包名、日志名):给两行,再长才省略(中间省略只对单行生效)。
                maxLines = 2,
                overflow = TextOverflow.Ellipsis,
            )
            Spacer(Modifier.height(4.dp))
            Text(
                if (entry.isDir) stringResource(R.string.files_folder) else formatSize(entry.size.toLong()),
                color = p.textDim,
                fontSize = 13.sp,
            )
            Spacer(Modifier.height(24.dp))
            Column(verticalArrangement = Arrangement.spacedBy(16.dp)) {
                formatTime(entry.modified.toLong(), rememberThisYear()).takeIf { it.isNotEmpty() }?.let {
                    FileDetailRow(stringResource(R.string.files_modified), it, mono = false)
                }
                if (entry.permissions > 0u) {
                    FileDetailRow(
                        stringResource(R.string.files_permissions),
                        "${permissionString(entry.permissions)}  ${entry.permissions.toString(8)}",
                        mono = true,
                    )
                }
                FileDetailRow(stringResource(R.string.files_path), entry.path, mono = true)
            }
        }
        Column(
            Modifier
                .widthIn(max = 560.dp)
                .padding(start = Gutter * 2, end = endPad, top = 24.dp, bottom = bottomInset + Gutter),
            verticalArrangement = Arrangement.spacedBy(GapItem),
        ) {
            XsshButton(stringResource(R.string.files_open), modifier = Modifier.fillMaxWidth()) { actions.open(entry) }
            Row(horizontalArrangement = Arrangement.spacedBy(GapItem)) {
                XsshButton(stringResource(R.string.files_download), kind = ButtonKind.Ghost, modifier = Modifier.weight(1f)) { actions.download(entry) }
                XsshButton(stringResource(R.string.files_download_to), kind = ButtonKind.Ghost, modifier = Modifier.weight(1f)) {
                    actions.downloadTo(entry)
                }
            }
            XsshButton(stringResource(R.string.files_share), kind = ButtonKind.Ghost, modifier = Modifier.fillMaxWidth()) {
                actions.share(entry)
            }
            Row(horizontalArrangement = Arrangement.spacedBy(GapItem)) {
                XsshButton(stringResource(R.string.files_rename), kind = ButtonKind.Ghost, modifier = Modifier.weight(1f)) { actions.rename(entry) }
                XsshButton(stringResource(R.string.files_delete), kind = ButtonKind.Danger, modifier = Modifier.weight(1f)) { actions.delete(entry) }
            }
            XsshButton(stringResource(R.string.files_copy_path), kind = ButtonKind.Ghost, modifier = Modifier.fillMaxWidth()) {
                actions.copyPath(entry)
            }
        }
    }
}

@Composable
private fun FileDetailRow(label: String, value: String, mono: Boolean) {
    val p = LocalXssh.current
    Column {
        Text(label, color = p.textDim, fontSize = 13.sp)
        Spacer(Modifier.height(4.dp))
        Text(value, color = p.text, fontFamily = if (mono) XsshFonts.monoUi else FontFamily.Default, fontSize = 13.sp)
    }
}

/** 手机列表的一行:图标、名字 + 下面一行小字、目录带 ›;长按出菜单;行间细线从名字那里开始。 */
@OptIn(ExperimentalFoundationApi::class)
@Composable
private fun PhoneFileRow(
    icon: ImageVector,
    name: String,
    meta: String?,
    dim: Boolean,
    chevron: Boolean,
    start: androidx.compose.ui.unit.Dp,
    end: androidx.compose.ui.unit.Dp = Gutter,
    checkMode: Boolean,
    selected: Boolean,
    link: Boolean,
    accentIcon: Boolean = false,
    onClick: () -> Unit,
    onMenu: () -> Unit = {},
    menu: (() -> List<MenuAction>)?,
) {
    val p = LocalXssh.current
    var menuAt by remember { mutableStateOf<DpOffset?>(null) }
    Box(Modifier.fillMaxWidth()) {
        Row(
            Modifier
                .fillMaxWidth()
                .background(if (selected) p.rowSel else Color.Transparent)
                .combinedClickable(
                    onLongClick = menu?.let {
                        {
                            onMenu()
                            menuAt = DpOffset(start + 40.dp, 0.dp)
                        }
                    },
                    onClick = onClick,
                )
                .heightIn(min = 60.dp)
                .padding(start = start, end = end),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            if (checkMode) {
                CheckCircle(selected)
                Spacer(Modifier.width(12.dp))
            }
            Icon(
                icon,
                contentDescription = null,
                tint = when {
                    dim -> p.textDim
                    accentIcon -> p.accent
                    else -> p.textDim
                },
                modifier = Modifier.size(26.dp),
            )
            Spacer(Modifier.width(14.dp))
            Column(Modifier.weight(1f).padding(vertical = 10.dp)) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text(
                        name,
                        color = if (dim) p.textDim else p.text,
                        fontSize = 16.sp,
                        maxLines = 1,
                        overflow = TextOverflow.MiddleEllipsis,
                        modifier = Modifier.weight(1f, fill = false),
                    )
                    if (link) {
                        Spacer(Modifier.width(6.dp))
                        Icon(XIcons.Link, contentDescription = stringResource(R.string.files_link), tint = p.textFaint, modifier = Modifier.size(14.dp))
                    }
                }
                if (!meta.isNullOrEmpty()) {
                    Spacer(Modifier.height(2.dp))
                    Text(meta, color = p.textDim, fontSize = 12.5.sp, maxLines = 1)
                }
            }
            if (chevron && !checkMode) {
                Icon(XIcons.Chevron, contentDescription = null, tint = p.textFaint, modifier = Modifier.size(16.dp))
            }
        }
        Box(
            Modifier
                .align(Alignment.BottomStart)
                // 右边也要收 —— 原来只给了左边距就 fillMaxWidth,分隔线一路画到栏边:
                // 单栏时钻进右边轨道的玻璃底下,双栏时越过行内容一直顶到折痕。
                .padding(start = start + 40.dp, end = end)
                .fillMaxWidth()
                .height(0.5.dp)
                .background(p.border),
        )
        if (menu != null) ContextMenu(at = menuAt, onDismiss = { menuAt = null }, actions = menu)
    }
}
/** 多选时底部的操作栏(iPad「文件」的选择模式)。 */
@Composable
private fun SelectionBar(
    inset: androidx.compose.ui.unit.Dp,
    count: Int,
    onDownload: () -> Unit,
    onDownloadTo: () -> Unit,
    onShare: () -> Unit,
    onDelete: () -> Unit,
    onDone: () -> Unit,
) {
    val p = LocalXssh.current
    Column(Modifier.fillMaxWidth().background(p.cardBg)) {
        Box(Modifier.fillMaxWidth().height(0.5.dp).background(p.border))
        Row(
            Modifier.fillMaxWidth().height(52.dp).padding(start = inset, end = 10.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(4.dp),
        ) {
            Text(
                pluralStringResource(R.plurals.files_selected_n, count, count),
                color = p.text,
                fontSize = 14.sp,
                fontWeight = FontWeight.Medium,
                modifier = Modifier.weight(1f),
            )
            if (count > 0) {
                ToolbarTextButton(stringResource(R.string.files_download), p.accent) { onDownload() }
                ToolbarTextButton(stringResource(R.string.files_download_to), p.accent) { onDownloadTo() }
                ToolbarTextButton(stringResource(R.string.files_share), p.accent) { onShare() }
                ToolbarTextButton(stringResource(R.string.files_delete), p.danger) { onDelete() }
            }
            ToolbarTextButton(stringResource(R.string.files_done), p.text, bold = true) { onDone() }
        }
    }
}

/** 当前路径:上一级按钮 + 可点的面包屑(横向放不下时可以滑,默认停在最末一级)。 */
@Composable
private fun PathBar(path: String?, onGo: (String) -> Unit, onUp: () -> Unit, onEdit: () -> Unit) {
    val p = LocalXssh.current
    val scroll = rememberScrollState()
    // 路径变了、或者宽度变了(转屏、收起侧边栏)都回到最末一级:那是"我在哪儿"。
    LaunchedEffect(path, scroll.maxValue) { scroll.scrollTo(scroll.maxValue) }
    Column(Modifier.fillMaxWidth()) {
        Row(
            Modifier.fillMaxWidth().height(44.dp).padding(horizontal = 10.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            ToolbarIcon(XIcons.ArrowUp, stringResource(R.string.files_up) + "  Backspace", tint = if (path == null || path == "/") p.textFaint else null) { onUp() }
            Spacer(Modifier.width(6.dp))
            // 面包屑后面的空白处点一下 = 手动输入路径(Finder 的「前往文件夹」、资源管理器的地址栏)。
            Row(
                Modifier
                    .weight(1f)
                    .fillMaxHeight()
                    .pointerHoverIcon(PointerIcon.Text)
                    .focusProperties { canFocus = false }
                    .clickable(interactionSource = remember { MutableInteractionSource() }, indication = null) { onEdit() }
                    .horizontalScroll(scroll),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                val parts = path?.let(::crumbs).orEmpty()
                parts.forEachIndexed { index, (label, target) ->
                    val last = index == parts.lastIndex
                    if (index > 1) {
                        Icon(XIcons.Chevron, contentDescription = null, tint = p.textFaint, modifier = Modifier.size(14.dp))
                    }
                    Crumb(label, last) { onGo(target) }
                }
            }
        }
        Box(Modifier.fillMaxWidth().height(0.5.dp).background(p.border))
    }
}

@Composable
private fun Crumb(label: String, current: Boolean, onClick: () -> Unit) {
    val p = LocalXssh.current
    val interaction = remember { MutableInteractionSource() }
    val hovered by interaction.collectIsHoveredAsState()
    Text(
        label,
        color = if (current) p.text else p.textDim,
        fontSize = 14.sp,
        fontWeight = if (current) FontWeight.SemiBold else FontWeight.Normal,
        maxLines = 1,
        modifier = Modifier
            .clip(RoundedCornerShape(7.dp))
            .background(if (hovered) p.bgElev2 else Color.Transparent)
            .hoverable(interaction)
            .pointerHoverIcon(PointerIcon.Hand)
            .focusProperties { canFocus = false }
            .clickable(interactionSource = interaction, indication = null, role = Role.Button) { onClick() }
            .padding(horizontal = 7.dp, vertical = 5.dp),
    )
}

private val SizeColumn = 92.dp
private val TimeColumn = 136.dp

@Composable
private fun ColumnHeader(showTime: Boolean) {
    val p = LocalXssh.current
    Column {
        Row(
            Modifier.fillMaxWidth().height(30.dp).padding(start = 52.dp, end = 24.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text(stringResource(R.string.files_name), color = p.textFaint, fontSize = 12.sp, modifier = Modifier.weight(1f))
            Text(
                stringResource(R.string.files_size),
                color = p.textFaint,
                fontSize = 12.sp,
                textAlign = TextAlign.End,
                modifier = Modifier.width(SizeColumn),
            )
            if (showTime) {
                Text(stringResource(R.string.files_modified), color = p.textFaint, fontSize = 12.sp, textAlign = TextAlign.End, modifier = Modifier.width(TimeColumn))
            }
        }
        Box(Modifier.fillMaxWidth().height(0.5.dp).background(p.border))
    }
}

@OptIn(ExperimentalFoundationApi::class)
@Composable
private fun FileRow(
    entry: RemoteEntry,
    striped: Boolean,
    selected: Boolean,
    /** 触摸多选中:行首出勾选圈。 */
    checkMode: Boolean,
    showTime: Boolean,
    /** 单击;带着按下那一刻的 Ctrl / Shift(多选)。 */
    onClick: (ctrl: Boolean, shift: Boolean) -> Unit,
    onOpen: () -> Unit,
    /** 菜单要弹出来的那一刻(右键 / 长按):在这里改选中,别在菜单内容里改(那是组合过程中写状态)。 */
    onMenu: () -> Unit,
    menu: () -> List<MenuAction>,
) {
    val p = LocalXssh.current
    val density = LocalDensity.current
    val interaction = remember { MutableInteractionSource() }
    val hovered by interaction.collectIsHoveredAsState()
    val pressed by interaction.collectIsPressedAsState()
    var menuAt by remember { mutableStateOf<DpOffset?>(null) }
    var lastClick by remember { mutableLongStateOf(0L) }
    var height by remember { mutableIntStateOf(0) }
    // combinedClickable 的回调拿不到键盘修饰键,按下时自己记下来。
    var pressCtrl by remember { mutableStateOf(false) }
    var pressShift by remember { mutableStateOf(false) }
    val background = when {
        selected -> p.rowSel
        pressed -> p.bgElev2.copy(alpha = p.bgElev2.alpha * 1.6f)
        hovered -> p.bgElev2
        // 斑马纹很淡:宽表格里眼睛顺着一行看到右边的大小 / 时间不串行(macOS Finder 列表视图的做法)。
        striped -> p.bgElev2.copy(alpha = p.bgElev2.alpha * 0.35f)
        else -> Color.Transparent
    }
    val icon: ImageVector = if (entry.isDir) XIcons.Folder else XIcons.File
    Box(Modifier.fillMaxWidth().padding(horizontal = 8.dp).onSizeChanged { height = it.height }) {
        Row(
            Modifier
                .fillMaxWidth()
                .height(40.dp)
                .clip(RoundedCornerShape(8.dp))
                .background(background)
                .pointerInput(Unit) {
                    awaitPointerEventScope {
                        while (true) {
                            val event = awaitPointerEvent(PointerEventPass.Initial)
                            if (event.type == PointerEventType.Press) {
                                pressCtrl = event.keyboardModifiers.isCtrlPressed
                                pressShift = event.keyboardModifiers.isShiftPressed
                            }
                            if (event.type == PointerEventType.Press && event.buttons.isSecondaryPressed) {
                                val at = event.changes.first().position
                                event.changes.forEach { it.consume() }
                                onMenu()
                                menuAt = with(density) { DpOffset(at.x.toDp(), (at.y - height).toDp()) }
                            }
                        }
                    }
                }
                .hoverable(interaction)
                .focusProperties { canFocus = false }
                .combinedClickable(
                    interactionSource = interaction,
                    indication = null,
                    onLongClick = {
                        onMenu()
                        menuAt = DpOffset(40.dp, 0.dp)
                    },
                ) {
                    // 双击自己判(同侧边栏):单击不用等 300ms 才选中。
                    // 按着 Ctrl / Shift 是在多选,连点两下也不算打开;勾选模式下同理。
                    val now = SystemClock.uptimeMillis()
                    val modified = pressCtrl || pressShift || checkMode
                    if (!modified && now - lastClick < 350) {
                        lastClick = 0L
                        onOpen()
                    } else {
                        lastClick = if (modified) 0L else now
                        onClick(pressCtrl, pressShift)
                    }
                }
                .padding(start = 12.dp, end = 16.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            if (checkMode) {
                CheckCircle(selected)
                Spacer(Modifier.width(10.dp))
            }
            Icon(
                icon,
                contentDescription = null,
                tint = if (entry.isDir) p.accent else p.textDim,
                modifier = Modifier.size(20.dp),
            )
            Spacer(Modifier.width(12.dp))
            Row(Modifier.weight(1f), verticalAlignment = Alignment.CenterVertically) {
                Text(
                    entry.name,
                    color = p.text,
                    fontSize = 14.5.sp,
                    maxLines = 1,
                    overflow = TextOverflow.MiddleEllipsis,
                    modifier = Modifier.weight(1f, fill = false),
                )
                if (entry.isLink) {
                    Spacer(Modifier.width(6.dp))
                    Icon(XIcons.Link, contentDescription = stringResource(R.string.files_link), tint = p.textFaint, modifier = Modifier.size(14.dp))
                }
            }
            Text(
                if (entry.isDir) "—" else formatSize(entry.size.toLong()),
                color = p.textDim,
                fontSize = 13.sp,
                textAlign = TextAlign.End,
                maxLines = 1,
                modifier = Modifier.width(SizeColumn),
            )
            if (showTime) {
                Text(
                    formatTime(entry.modified.toLong(), rememberThisYear()),
                    color = p.textDim,
                    fontSize = 13.sp,
                    textAlign = TextAlign.End,
                    maxLines = 1,
                    modifier = Modifier.width(TimeColumn),
                )
            }
        }
        ContextMenu(at = menuAt, onDismiss = { menuAt = null }, actions = menu)
    }
}

/** 勾选圈:选中时是实心的强调色圆 + 白勾。 */
@Composable
private fun CheckCircle(checked: Boolean) {
    val p = LocalXssh.current
    Box(
        Modifier
            .size(20.dp)
            .clip(RoundedCornerShape(10.dp))
            .background(if (checked) p.accent else Color.Transparent)
            .border(1.5.dp, if (checked) p.accent else p.textFaint, RoundedCornerShape(10.dp)),
        contentAlignment = Alignment.Center,
    ) {
        if (checked) Icon(XIcons.Check, contentDescription = null, tint = Color.White, modifier = Modifier.size(14.dp))
    }
}

@Composable
/** 首次加载中的居中转圈:列表区此前是一片空白,看着像面板坏了。 */
private fun CenterBusy() {
    Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
        CircularProgressIndicator(Modifier.size(24.dp), strokeWidth = 2.dp)
    }
}

@Composable
private fun CenterNote(text: String, action: (@Composable () -> Unit)? = null) {
    val p = LocalXssh.current
    Column(
        Modifier.fillMaxSize().padding(32.dp),
        verticalArrangement = Arrangement.Center,
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        if (text.isNotEmpty()) Text(text, color = p.textDim, fontSize = 14.sp, textAlign = TextAlign.Center)
        if (action != null) {
            Spacer(Modifier.height(16.dp))
            action()
        }
    }
}

/** 底部的传输条:文件名、进度、已传 / 总共;排队批数;「取消」当前 / 「全部取消」。 */
@Composable
private fun TransferBar(
    t: Transfer,
    queued: Int,
    inset: androidx.compose.ui.unit.Dp,
    onCancel: () -> Unit,
    onCancelAll: () -> Unit,
) {
    val p = LocalXssh.current
    val fraction = if (t.total > 0) (t.done.toFloat() / t.total).coerceIn(0f, 1f) else 0f
    Column(Modifier.fillMaxWidth().background(p.cardBg)) {
        Box(Modifier.fillMaxWidth().height(0.5.dp).background(p.border))
        Row(
            Modifier.fillMaxWidth().height(56.dp).padding(start = inset, end = 10.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Icon(
                if (t.upload) XIcons.Upload else XIcons.ArrowDown,
                contentDescription = null,
                tint = p.accent,
                modifier = Modifier.size(20.dp),
            )
            Spacer(Modifier.width(12.dp))
            Column(Modifier.weight(1f)) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text(
                        t.name,
                        color = p.text,
                        fontSize = 13.5.sp,
                        maxLines = 1,
                        overflow = TextOverflow.MiddleEllipsis,
                        modifier = Modifier.weight(1f),
                    )
                    if (queued > 0) {
                        Text(stringResource(R.string.files_queue_n, queued), color = p.textFaint, fontSize = 12.sp)
                        Spacer(Modifier.width(10.dp))
                    }
                    if (t.count > 1) {
                        Text("${t.index + 1}/${t.count}", color = p.textFaint, fontSize = 12.sp)
                        Spacer(Modifier.width(12.dp))
                    }
                    Text(
                        when {
                            // 还在清点要传哪些(递归列目录):先不给数字。
                            t.count == 0 -> "…"
                            t.total > 0 -> "${formatSize(t.done)} / ${formatSize(t.total)}"
                            else -> formatSize(t.done)
                        },
                        color = p.textDim,
                        fontSize = 12.sp,
                        fontFamily = XsshFonts.monoUi,
                    )
                }
                Spacer(Modifier.height(6.dp))
                Box(Modifier.fillMaxWidth().height(4.dp).clip(RoundedCornerShape(2.dp)).background(p.bgElev2)) {
                    Box(Modifier.fillMaxHeight().fillMaxWidth(fraction).background(p.accent))
                }
            }
            Spacer(Modifier.width(8.dp))
            if (queued > 0) {
                ToolbarTextButton(stringResource(R.string.files_cancel_all), p.danger) { onCancelAll() }
            }
            ToolbarTextButton(stringResource(R.string.files_cancel), p.danger) { onCancel() }
        }
    }
}

/** 一句提示,4 秒后自己消失。 */
@Composable
private fun NoticeBar(notice: Notice?, inset: androidx.compose.ui.unit.Dp) {
    val p = LocalXssh.current
    var shown by remember { mutableStateOf<Notice?>(null) }
    LaunchedEffect(notice) {
        if (notice == null) return@LaunchedEffect
        // 带按钮的(「打开」)多留一会儿,给人伸手的时间。
        val stay = if (notice.action != null) 8000L else 4000L
        // 面板重新进来时不要把很久以前的提示再亮一遍。
        if (SystemClock.uptimeMillis() - notice.id > stay) return@LaunchedEffect
        shown = notice
        delay(stay)
        if (shown == notice) shown = null
    }
    val n = shown ?: return
    Column(Modifier.fillMaxWidth().background(p.cardBg)) {
        Box(Modifier.fillMaxWidth().height(0.5.dp).background(p.border))
        Row(
            Modifier.fillMaxWidth().heightIn(min = 40.dp).padding(start = inset, end = 10.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text(
                n.text.text(),
                color = if (n.error) p.danger else p.textDim,
                fontSize = 13.sp,
                maxLines = 2,
                overflow = TextOverflow.Ellipsis,
                modifier = Modifier.weight(1f).padding(vertical = 10.dp),
            )
            n.action?.let { (label, run) ->
                ToolbarTextButton(label.text(), p.accent, bold = true) {
                    shown = null
                    run()
                }
            }
        }
    }
}

/**
 * 输入一个名字(重命名 / 新建文件夹)。回车确认、Esc 取消 —— 但输入法正在组词时这两个键归输入法。
 * 重命名时先选中扩展名前面的部分(和 Finder 一样),直接打字就是改主名。
 */
@Composable
private fun NameDialog(
    title: String,
    initial: String,
    confirm: String,
    /** 输入的是路径(前往):允许 `/`,光标放在末尾。 */
    isPath: Boolean = false,
    onConfirm: (String) -> Unit,
    onDismiss: () -> Unit,
) {
    val p = LocalXssh.current
    val stem = initial.lastIndexOf('.').takeIf { it > 0 } ?: initial.length
    var field by remember {
        mutableStateOf(
            if (isPath) TextFieldValue(initial, TextRange(initial.length)) else TextFieldValue(initial, TextRange(0, stem)),
        )
    }
    val ime = remember { ImeBuffer() }
    val focus = remember { FocusRequester() }
    val name = field.text.trim()
    val valid = name.isNotEmpty() && (isPath || ('/' !in name && name != "." && name != ".."))
    // Enter + 按钮连点会在 dialog=null 重组前触发两次 onConfirm(双改名/双建目录)。
    var done by remember { mutableStateOf(false) }
    fun submit() {
        if (!valid || done) return
        done = true
    // 回车和按钮都会调 submit():对话框还没关掉时连按两下会建两个文件夹 / 改两次名。
    var submitted by remember { mutableStateOf(false) }
    fun submit() {
        if (!valid || submitted) return
        submitted = true
        onConfirm(name)
    }
    Dialog(onDismissRequest = onDismiss) {
        Column(
            Modifier
                .width(380.dp)
                .clip(RoundedCornerShape(18.dp))
                .background(if (p.dark) p.bgElev else p.bg)
                .border(0.5.dp, p.glassBorder, RoundedCornerShape(18.dp))
                .onInterceptKeyBeforeSoftKeyboard { event ->
                    val e = event.nativeKeyEvent
                    val asciiKey = isPath && e.isPrintingKey && !e.isCtrlPressed && !e.isAltPressed && !e.isMetaPressed &&
                        e.getUnicodeChar(e.metaState) in 0x20..0x7E
                    // 松开事件也吞掉,别让输入法收到半个按键。
                    if (e.action != AndroidKeyEvent.ACTION_DOWN) return@onInterceptKeyBeforeSoftKeyboard asciiKey
                    val composing = field.composition != null || ime.holding
                    when {
                        !composing && (e.keyCode == AndroidKeyEvent.KEYCODE_ENTER || e.keyCode == AndroidKeyEvent.KEYCODE_NUMPAD_ENTER) -> {
                            submit()
                            true
                        }
                        !composing && e.keyCode == AndroidKeyEvent.KEYCODE_ESCAPE -> {
                            onDismiss()
                            true
                        }
                        // 路径只会是英文:插着实体键盘时字符直接写进来,不让小米输入法把它组成拼音(见 FormField.asciiOnly)。
                        asciiKey -> {
                            val sel = field.selection
                            val text = field.text.replaceRange(sel.min, sel.max, e.getUnicodeChar(e.metaState).toChar().toString())
                            field = TextFieldValue(text, TextRange(sel.min + 1))
                            true
                        }
                        else -> {
                            ime.observe(e)
                            false
                        }
                    }
                }
                .padding(20.dp),
        ) {
            Text(title, color = p.text, fontSize = 17.sp, fontWeight = FontWeight.SemiBold)
            Spacer(Modifier.height(14.dp))
            BasicTextField(
                value = field,
                onValueChange = {
                    if (it.text != field.text) ime.onTextChanged()
                    field = it
                },
                singleLine = true,
                textStyle = TextStyle(
                    color = p.text,
                    fontSize = 16.sp,
                    fontFamily = if (isPath) XsshFonts.monoUi else FontFamily.Default,
                ),
                cursorBrush = SolidColor(p.accent),
                // 路径:要英文键盘、不要联想纠错(软键盘默认是中文拼音)。
                keyboardOptions = if (isPath) {
                    KeyboardOptions(keyboardType = KeyboardType.Uri, autoCorrectEnabled = false, imeAction = ImeAction.Done)
                } else {
                    KeyboardOptions(imeAction = ImeAction.Done)
                },
                keyboardActions = KeyboardActions(onDone = { submit() }),
                modifier = Modifier
                    .fillMaxWidth()
                    .focusRequester(focus)
                    .pointerHoverIcon(PointerIcon.Text),
                decorationBox = { inner ->
                    Box(
                        Modifier
                            .fillMaxWidth()
                            .clip(RoundedCornerShape(10.dp))
                            .background(p.bgElev2)
                            .padding(horizontal = 12.dp, vertical = 11.dp),
                    ) { inner() }
                },
            )
            Spacer(Modifier.height(20.dp))
            Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                XsshButton(stringResource(R.string.files_cancel), Modifier.weight(1f), kind = ButtonKind.Ghost) { onDismiss() }
                XsshButton(confirm, Modifier.weight(1f)) { submit() }
            }
        }
        LaunchedEffect(Unit) { runCatching { focus.requestFocus() } }
    }
}

/**
 * 双栏详情文件名上的拖出(Pad / Fold 接鼠标)。
 * 已有本地 URI → [dragAndDropSource] 拖给别的应用;尚未缓存 → 鼠标拖一下触发 [onNeedCache](分享下载)。
 * **只认鼠标 / 触控笔**,手指滑动仍交给详情滚动;列表长按菜单不受影响。
 */
@OptIn(ExperimentalFoundationApi::class)
private fun Modifier.remoteDragOut(uri: android.net.Uri?, label: String, onNeedCache: () -> Unit): Modifier {
    if (uri != null) {
        return this.dragAndDropSource {
            awaitPointerEventScope {
                while (true) {
                    val down = awaitFirstDown(requireUnconsumed = false)
                    if (down.type != PointerType.Mouse && down.type != PointerType.Stylus) continue
                    val slop = viewConfiguration.touchSlop
                    var dx = 0f
                    var dy = 0f
                    while (true) {
                        val event = awaitPointerEvent()
                        val change = event.changes.firstOrNull { it.id == down.id } ?: break
                        if (!change.pressed) break
                        dx += change.positionChange().x
                        dy += change.positionChange().y
                        if ((dx * dx + dy * dy) > slop * slop) {
                            change.consume()
                            startTransfer(DragAndDropTransferData(clipData = ClipData.newUri(null, label, uri)))
                            while (true) {
                                val ev = awaitPointerEvent()
                                val c = ev.changes.firstOrNull { it.id == down.id } ?: break
                                c.consume()
                                if (!c.pressed) break
                            }
                            break
                        }
                    }
                }
            }
        }
    }
    return this.pointerInput(label) {
        awaitPointerEventScope {
            while (true) {
                val down = awaitFirstDown(requireUnconsumed = false)
                if (down.type != PointerType.Mouse && down.type != PointerType.Stylus) continue
                val slop = viewConfiguration.touchSlop
                var dx = 0f
                var dy = 0f
                while (true) {
                    val event = awaitPointerEvent()
                    val change = event.changes.firstOrNull { it.id == down.id } ?: break
                    if (!change.pressed) break
                    dx += change.positionChange().x
                    dy += change.positionChange().y
                    if ((dx * dx + dy * dy) > slop * slop) {
                        change.consume()
                        onNeedCache()
                        while (true) {
                            val ev = awaitPointerEvent()
                            val c = ev.changes.firstOrNull { it.id == down.id } ?: break
                            c.consume()
                            if (!c.pressed) break
                        }
                        break
                    }
                }
            }
        }
    }
}

