package dev.xssh.android

import android.content.Context
import android.view.KeyEvent as AndroidKeyEvent
import android.widget.Toast
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.input.key.onPreviewKeyEvent
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import java.util.UUID
import org.json.JSONArray
import org.json.JSONObject

/* ─────────────────────────────── 命令片段 ───────────────────────────────

   手机上最费劲的是打字 —— 尤其是带路径、带符号的长命令。常用的存成片段,点一下就发出去。

   - 直接执行(发完补一个回车),或者只填进去不回车(改一下参数再自己按回车);
   - 危险的(重启、删除)可以设成点了先确认一次,防手滑;
   - 默认所有主机都能用,也可以只挂在某一台上(只在连着它时出现)。

   字段和桌面版的 `Snippet` 对得上(title / text / confirm / hostId),只是「执行」单独是个开关 ——
   桌面版靠命令末尾有没有换行来表达。以后两边互通时按这个换算。
*/

/** 一条命令片段。 */
data class Snippet(
    val id: String = UUID.randomUUID().toString(),
    /** 列表上显示的名字(「看 GPU」);空的话直接显示命令。 */
    val title: String = "",
    /** 要发出去的命令,可以多行(每行各执行一次)。 */
    val text: String = "",
    /** 发完补一个回车(= 直接执行)。关掉就只填进去,改完自己按回车。 */
    val run: Boolean = true,
    /** 点了先确认一次(重启、删除这类)。 */
    val confirm: Boolean = false,
    /** 只在连着这台主机时出现;null = 所有主机都能用。 */
    val hostId: String? = null,
) {
    val label: String get() = title.ifBlank { text.lineSequence().firstOrNull().orEmpty() }
}

/**
 * 片段发到终端的字节(按文本)。
 *
 * - 换行统一成回车:终端里"按回车"发的就是 `\r`,`\n` 在不少程序里不算提交(实测 Windows 的 cmd 就不认)。
 * - 末尾的空行去掉,是否提交只由 [run] 决定 —— 否则"只填进去"的片段因为末尾带了个换行而被直接执行了。
 */
internal fun snippetPayload(text: String, run: Boolean): String {
    val body = text.replace("\r\n", "\n").replace('\r', '\n').trimEnd('\n').replace('\n', '\r')
    return if (run) body + "\r" else body
}

/** 这台主机上能用的片段:全局的 + 挂在它身上的,按保存的顺序。 */
internal fun snippetsFor(all: List<Snippet>, hostId: String): List<Snippet> =
    all.filter { it.hostId == null || it.hostId == hostId }

/** 片段存盘:SharedPreferences + JSON(不是秘密,不加密)。 */
class SnippetStore(context: Context) {
    private val prefs = context.getSharedPreferences("xssh_snippets", Context.MODE_PRIVATE)

    /** 上次 load 是否解析失败。只在内存里。 */
    var loadFailed: Boolean = false
        private set

    /**
     * 磁盘上是否还有值得保护的片段数据:能解析出记录,或原文非空却解析不了。
     * 解析失败时不能再用「空表」去覆盖 KEY_LIST。
     */
    fun hasProtectedDiskData(): Boolean {
        val raw = prefs.getString(KEY_LIST, null) ?: return false
        if (raw.isBlank()) return false
        return runCatching { JSONArray(raw).length() > 0 }.getOrDefault(true)
    }

    private fun keepCorruptCopy(raw: String) {
        if (prefs.getString(KEY_CORRUPT, null) == null) {
            prefs.edit().putString(KEY_CORRUPT, raw).apply()
        }
    }

    fun load(): List<Snippet> {
        loadFailed = false
        val raw = prefs.getString(KEY_LIST, null) ?: return emptyList()
        return runCatching {
            val array = JSONArray(raw)
            (0 until array.length()).map { index ->
                val item = array.getJSONObject(index)
                Snippet(
                    id = item.optString("id").ifEmpty { UUID.randomUUID().toString() },
                    title = item.optString("title"),
                    text = item.optString("text"),
                    run = item.optBoolean("run", true),
                    confirm = item.optBoolean("confirm", false),
                    hostId = item.optString("hostId").ifEmpty { null },
                )
            }
        }.getOrElse {
            loadFailed = true
            keepCorruptCopy(raw)
            emptyList()
        }
    }

    /**
     * 存盘。用 commit 而不是 apply,好让调用方知道写没写进去。
     * 空表且磁盘上仍有受保护数据时拒绝覆盖(坏 JSON 被当成「没有片段」后再保存会抹掉唯一副本)。
     */
    fun save(list: List<Snippet>): Boolean {
        if (list.isEmpty() && hasProtectedDiskData()) {
            android.util.Log.e("XsshData", "refusing to persist an empty snippet list over existing data")
            return false
        }
        val array = JSONArray()
        list.forEach { s ->
            array.put(
                JSONObject()
                    .put("id", s.id)
                    .put("title", s.title)
                    .put("text", s.text)
                    .put("run", s.run)
                    .put("confirm", s.confirm)
                    .put("hostId", s.hostId ?: ""),
            )
        }
        return prefs.edit().putString(KEY_LIST, array.toString()).commit()
    }

    private companion object {
        const val KEY_LIST = "list"
        const val KEY_CORRUPT = "list.corrupt"
    }
}

/**
 * 片段面板。手机 / 折叠屏:贴着底边弹出(单手够得着,外屏上拇指就在那儿);平板:居中。
 *
 * 点一行 = 发出去并关掉面板;✎ 改这一条;右上角 ＋ 新建。点外面 / Esc 关。
 */
@Composable
fun SnippetSheet(
    host: Host,
    tablet: Boolean,
    onSend: (Snippet) -> Unit,
    onDismiss: () -> Unit,
) {
    val p = LocalXssh.current
    val context = LocalContext.current
    val store = remember(context) { SnippetStore(context) }
    var all by remember { mutableStateOf(store.load()) }
    LaunchedEffect(Unit) {
        if (store.loadFailed) {
            Toast.makeText(context, R.string.snip_load_failed, Toast.LENGTH_LONG).show()
        }
    }
    var editing by remember { mutableStateOf<Snippet?>(null) }
    var confirming by remember { mutableStateOf<Snippet?>(null) }
    val shown = snippetsFor(all, host.id)

    fun send(s: Snippet) {
        if (s.confirm) confirming = s else onSend(s)
    }

    SheetFrame(
        title = stringResource(R.string.snip_title),
        tablet = tablet,
        onDismiss = onDismiss,
        trailing = {
            Box(
                Modifier
                    .size(44.dp)
                    .clip(RoundedCornerShape(22.dp))
                    .clickable { editing = Snippet(hostId = null) },
                contentAlignment = Alignment.Center,
            ) {
                Icon(XIcons.Plus, contentDescription = stringResource(R.string.snip_new), tint = p.accent, modifier = Modifier.size(22.dp))
            }
        },
    ) {
        if (shown.isEmpty()) {
            Text(
                stringResource(R.string.snip_empty),
                color = p.textDim,
                fontSize = 14.sp,
                modifier = Modifier.padding(horizontal = 20.dp, vertical = 16.dp),
            )
        }
        shown.forEach { s ->
            Row(
                Modifier
                    .fillMaxWidth()
                    .heightIn(min = 60.dp)
                    .clickable { send(s) }
                    .padding(start = 20.dp, end = 8.dp, top = 8.dp, bottom = 8.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Column(Modifier.weight(1f)) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Text(
                            s.label,
                            color = p.text,
                            fontSize = 16.sp,
                            maxLines = 1,
                            overflow = TextOverflow.Ellipsis,
                            modifier = Modifier.weight(1f, fill = false),
                        )
                        // 不直接执行的、要确认的,在名字后面标一下 —— 点之前就知道会发生什么。
                        if (!s.run) SnippetTag(stringResource(R.string.snip_tag_no_enter), p.textDim)
                        if (s.confirm) SnippetTag(stringResource(R.string.snip_tag_confirm), p.warn)
                        if (s.hostId != null) SnippetTag(stringResource(R.string.snip_tag_this_host), p.textDim)
                    }
                    if (s.title.isNotBlank()) {
                        Text(
                            s.text.replace('\n', ' '),
                            color = p.textDim,
                            fontSize = 13.sp,
                            fontFamily = XsshFonts.monoUi,
                            maxLines = 1,
                            overflow = TextOverflow.Ellipsis,
                        )
                    }
                }
                Box(
                    Modifier
                        .size(44.dp)
                        .clip(RoundedCornerShape(22.dp))
                        .clickable { editing = s },
                    contentAlignment = Alignment.Center,
                ) {
                    Icon(XIcons.Pencil, contentDescription = stringResource(R.string.snip_edit), tint = p.textDim, modifier = Modifier.size(18.dp))
                }
            }
        }
    }

    editing?.let { draft ->
        SnippetEditor(
            initial = draft,
            isNew = all.none { it.id == draft.id },
            hostLabel = host.label,
            hostId = host.id,
            tablet = tablet,
            onSave = { saved ->
                val index = all.indexOfFirst { it.id == saved.id }
                val next = if (index >= 0) all.toMutableList().also { it[index] = saved } else all + saved
                if (store.save(next)) {
                    all = next
                    editing = null
                } else {
                    Toast.makeText(context, R.string.snip_save_failed, Toast.LENGTH_SHORT).show()
                }
            },
            onDelete = { gone ->
                val next = all.filterNot { it.id == gone.id }
                if (store.save(next)) {
                    all = next
                    editing = null
                } else {
                    Toast.makeText(context, R.string.snip_delete_failed, Toast.LENGTH_SHORT).show()
                }
            },
            onDismiss = { editing = null },
        )
    }
    confirming?.let { s ->
        ConfirmDialog(
            title = stringResource(R.string.snip_run_title, s.label),
            message = s.text,
            confirm = if (s.run) stringResource(R.string.snip_run) else stringResource(R.string.snip_fill),
            danger = true,
            onConfirm = {
                confirming = null
                onSend(s)
            },
            onDismiss = { confirming = null },
        )
    }
}

@Composable
private fun SnippetTag(text: String, color: androidx.compose.ui.graphics.Color) {
    Spacer(Modifier.width(6.dp))
    Text(
        text,
        color = color,
        fontSize = 11.sp,
        maxLines = 1,
        modifier = Modifier
            .clip(RoundedCornerShape(5.dp))
            .border(0.5.dp, color.copy(alpha = 0.5f), RoundedCornerShape(5.dp))
            .padding(horizontal = 5.dp, vertical = 1.dp),
    )
}

/** 新建 / 修改一条片段。 */
@Composable
private fun SnippetEditor(
    initial: Snippet,
    isNew: Boolean,
    hostLabel: String,
    hostId: String,
    tablet: Boolean,
    onSave: (Snippet) -> Unit,
    onDelete: (Snippet) -> Unit,
    onDismiss: () -> Unit,
) {
    val p = LocalXssh.current
    var title by remember { mutableStateOf(initial.title) }
    var text by remember { mutableStateOf(initial.text) }
    var run by remember { mutableStateOf(initial.run) }
    var confirm by remember { mutableStateOf(initial.confirm) }
    var onlyHere by remember { mutableStateOf(initial.hostId != null) }
    var confirmingDelete by remember { mutableStateOf(false) }
    val commandFocus = remember { FocusRequester() }
    val valid = text.isNotBlank()

    fun save() {
        if (!valid) return
        onSave(
            initial.copy(
                title = title.trim(),
                text = text.trimEnd(),
                run = run,
                confirm = confirm,
                // 挂在哪台上:原来就挂在别的主机上的,不因为在这台上改了一下就挪过来。
                hostId = if (onlyHere) initial.hostId ?: hostId else null,
            ),
        )
    }

    SheetFrame(
        title = if (isNew) stringResource(R.string.snip_new) else stringResource(R.string.snip_edit_title),
        tablet = tablet,
        onDismiss = onDismiss,
        leading = { ToolbarTextButton(stringResource(R.string.snip_cancel), p.accent) { onDismiss() } },
        trailing = { ToolbarTextButton(stringResource(R.string.snip_save), if (valid) p.accent else p.textFaint, bold = true) { save() } },
    ) {
        Column(Modifier.padding(horizontal = 16.dp, vertical = 8.dp), verticalArrangement = Arrangement.spacedBy(14.dp)) {
            SnippetInput(
                value = text,
                onChange = { text = it },
                label = stringResource(R.string.snip_command),
                placeholder = "nvidia-smi",
                mono = true,
                singleLine = false,
                modifier = Modifier.focusRequester(commandFocus),
            )
            SnippetInput(
                value = title,
                onChange = { title = it },
                label = stringResource(R.string.snip_name_label),
                placeholder = stringResource(R.string.snip_name_placeholder),
                mono = false,
                singleLine = true,
            )
            FormGroup {
                SnippetSwitch(stringResource(R.string.snip_switch_enter), run) { run = it }
                FormDivider()
                SnippetSwitch(stringResource(R.string.snip_switch_confirm), confirm) { confirm = it }
                FormDivider()
                SnippetSwitch(stringResource(R.string.snip_switch_only_host, hostLabel), onlyHere) { onlyHere = it }
            }
            if (!isNew) {
                FormGroup {
                    FormAction(if (confirmingDelete) stringResource(R.string.snip_delete_confirm) else stringResource(R.string.snip_delete), danger = true) {
                        if (confirmingDelete) onDelete(initial) else confirmingDelete = true
                    }
                }
            }
        }
    }
    // 新建时直接落在命令那一格(弹键盘):打开就是为了写命令。
    LaunchedEffect(Unit) {
        if (isNew) {
            kotlinx.coroutines.delay(150)
            runCatching { commandFocus.requestFocus() }
        }
    }
}

@Composable
private fun SnippetSwitch(label: String, checked: Boolean, onChange: (Boolean) -> Unit) {
    val p = LocalXssh.current
    Row(
        Modifier.fillMaxWidth().heightIn(min = 52.dp).padding(horizontal = BoxPad),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(label, color = p.text, fontSize = 16.sp, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f))
        Spacer(Modifier.width(GapItem))
        XsshSwitch(checked, onChange)
    }
}

/** 片段编辑里的输入框:标签在上、框在下(命令会很长,放不进"标签在左"的一行)。 */
@Composable
private fun SnippetInput(
    value: String,
    onChange: (String) -> Unit,
    label: String,
    placeholder: String,
    mono: Boolean,
    singleLine: Boolean,
    modifier: Modifier = Modifier,
) {
    val p = LocalXssh.current
    Column {
        Text(label, color = p.textDim, fontSize = 13.sp, modifier = Modifier.padding(start = TitlePad - BoxPad + 4.dp, bottom = 6.dp))
        BasicTextField(
            value = value,
            onValueChange = onChange,
            singleLine = singleLine,
            minLines = if (singleLine) 1 else 3,
            maxLines = if (singleLine) 1 else 8,
            textStyle = TextStyle(
                color = p.text,
                fontSize = 16.sp,
                fontFamily = if (mono) XsshFonts.monoUi else androidx.compose.ui.text.font.FontFamily.Default,
            ),
            cursorBrush = SolidColor(p.accent),
            // 命令只会是英文:要英文键盘、不要联想纠错(不然 ls 会被改成 Is)。
            keyboardOptions = if (mono) {
                KeyboardOptions(keyboardType = KeyboardType.Uri, autoCorrectEnabled = false, imeAction = ImeAction.Default)
            } else {
                KeyboardOptions(imeAction = ImeAction.Done)
            },
            modifier = modifier.fillMaxWidth(),
            decorationBox = { inner ->
                Box(
                    Modifier
                        .fillMaxWidth()
                        .clip(RoundedCornerShape(RadiusBox))
                        .background(p.cardBg)
                        .padding(horizontal = BoxPad, vertical = 13.dp),
                ) {
                    if (value.isEmpty()) {
                        Text(
                            placeholder,
                            color = p.textFaint,
                            fontSize = 16.sp,
                            fontFamily = if (mono) XsshFonts.monoUi else androidx.compose.ui.text.font.FontFamily.Default,
                        )
                    }
                    inner()
                }
            },
        )
    }
}

/**
 * 面板外壳:标题栏(左 [leading]、中标题、右 [trailing]) + 可滚动内容。
 * 手机贴底(圆角只在上面),平板居中限宽。点外面 / Esc 关。
 */
@Composable
private fun SheetFrame(
    title: String,
    tablet: Boolean,
    onDismiss: () -> Unit,
    leading: (@Composable () -> Unit)? = null,
    trailing: (@Composable () -> Unit)? = null,
    content: @Composable () -> Unit,
) {
    val p = LocalXssh.current
    Dialog(
        onDismissRequest = onDismiss,
        properties = DialogProperties(usePlatformDefaultWidth = false, decorFitsSystemWindows = false),
    ) {
        BoxWithConstraints(
            Modifier
                .fillMaxSize()
                .clickable(interactionSource = remember { MutableInteractionSource() }, indication = null) { onDismiss() }
                .windowInsetsPadding(stableSafeDrawing())
                .imePadding(),
            contentAlignment = if (tablet) Alignment.Center else Alignment.BottomCenter,
        ) {
            val width: Dp = if (tablet) minOf(480.dp, maxWidth - 48.dp) else minOf(560.dp, maxWidth - Gutter * 2)
            Column(
                Modifier
                    .padding(bottom = if (tablet) 0.dp else Gutter)
                    .width(width)
                    .heightIn(max = maxHeight * if (tablet) 0.8f else 0.85f)
                    .clip(RoundedCornerShape(22.dp))
                    .background(if (p.dark) p.bgElev else p.bg)
                    .border(0.5.dp, p.glassBorder, RoundedCornerShape(22.dp))
                    // 吃掉面板内部的点击,不然会穿到后面那层变成"关闭"。
                    .clickable(interactionSource = remember { MutableInteractionSource() }, indication = null) {}
                    .onPreviewKeyEvent { event ->
                        val e = event.nativeKeyEvent
                        if (e.action == AndroidKeyEvent.ACTION_DOWN && e.keyCode == AndroidKeyEvent.KEYCODE_ESCAPE) {
                            onDismiss()
                            true
                        } else {
                            false
                        }
                    },
            ) {
                Box(Modifier.fillMaxWidth().height(56.dp).padding(horizontal = 8.dp)) {
                    Box(Modifier.align(Alignment.CenterStart)) { leading?.invoke() }
                    Text(
                        title,
                        color = p.text,
                        fontSize = 17.sp,
                        fontWeight = FontWeight.SemiBold,
                        modifier = Modifier.align(Alignment.Center),
                    )
                    Box(Modifier.align(Alignment.CenterEnd)) { trailing?.invoke() }
                }
                Box(Modifier.fillMaxWidth().height(0.5.dp).background(p.border))
                Column(Modifier.verticalScroll(rememberScrollState()).padding(vertical = 6.dp)) { content() }
            }
        }
    }
}
