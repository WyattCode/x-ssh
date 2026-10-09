package dev.xssh.android

import androidx.compose.ui.input.key.onPreviewKeyEvent
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.foundation.focusable
import android.view.KeyEvent as AndroidKeyEvent
import androidx.compose.foundation.Canvas
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
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.runtime.getValue
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.rememberTextMeasurer
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import uniffi.xssh_ffi.StyledRun

/* ─────────────────────────────── 设置:语言 + 终端字体 ───────────────────────────────

   原来这一页只有终端字体(入口是 Aa)。加了界面语言以后改叫「设置」:上面语言,下面字体。
   手机 / 折叠屏整页推进来,平板居中浮层,两边内容同一份([SettingsContent])。


   一张卡片一款字体:名字 + 一段**用终端自己的画法画出来的**样例(同一套格子、同样的中英混排、
   同样的制表符),所以卡片里看到的就是连上之后看到的。点一下就换,立刻生效。

   能进这张表的字体见 [TerminalFont]:英文都正好半格宽,中文严格两格。
*/

/** 样例内容:提示符、中英混排的表格、容易看混的字形。 */
private val SampleRows: List<List<Pair<String, Long>>> = listOf(
    listOf("user@dgx" to 2L, ":" to -1L, "~/项目" to 4L, "$ ls -l" to -1L),
    listOf("├─ README.md   2.4K  已同步" to -1L),
    listOf("└─ 配置 nginx.conf  " to -1L, "0O 1lI {}" to 3L),
)

/** 一段样例(和终端同一套画法:同样的格子、同样的字体分工)。 */
@Composable
private fun FontSample(font: TerminalFont, modifier: Modifier = Modifier) {
    val p = LocalXssh.current
    val measurer = rememberTextMeasurer(cacheSize = 256)
    val text = rememberTermPaints(font, 13f)
    val rows = remember(p) {
        SampleRows.map { line ->
            var col = 0
            line.map { (chunk, color) ->
                val cells = StringBuilder()
                var width = 0
                chunk.forEach { ch ->
                    if (cells.isNotEmpty()) cells.append('\u001F')
                    cells.append(ch)
                    width++
                    // 占两格的字后面跟一个空占位格(和核心送上来的画面同一个约定)。
                    if (ch.code > 0x2E80) {
                        cells.append('\u001F')
                        width++
                    }
                }
                val run = StyledRun(
                    col.toUInt(),
                    cells.toString(),
                    if (color < 0) 0u else (0xFF000000L or p.term16[color.toInt()]).toUInt(),
                    0u,
                    0u,
                )
                col += width
                run
            }
        }
    }
    val cols = rows.maxOf { line -> line.sumOf { it.cells.count { c -> c == '\u001F' } + 1 } }
    val density = LocalDensity.current
    val width = with(density) { (text.cellWidth * cols).toDp() }
    val height = with(density) { (text.cellHeight * rows.size).toDp() }
    Box(
        modifier
            .clip(RoundedCornerShape(10.dp))
            .background(p.termBg)
            .padding(horizontal = 10.dp, vertical = 8.dp),
    ) {
        Canvas(Modifier.width(width).height(height)) {
            rows.forEachIndexed { index, line ->
                line.forEach { run ->
                    drawRun(run, index * text.cellHeight, text, p.termFg, p.termBg)
                }
            }
        }
    }
}

/** 字体列表。[onPicked] 给平板浮层用(选完关掉)。 */
@Composable
fun FontList(modifier: Modifier = Modifier, onPicked: (() -> Unit)? = null) {
    val p = LocalXssh.current
    val current = TerminalFontChoice.current
    Column(modifier, verticalArrangement = Arrangement.spacedBy(10.dp)) {
        TerminalFont.entries.forEach { font ->
            val selected = font == current
            XsshCard(
                modifier = Modifier.fillMaxWidth(),
                highlight = selected,
                onClick = {
                    TerminalFontChoice.choose(font)
                    onPicked?.invoke()
                },
            ) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text(
                        font.displayName(),
                        color = p.text,
                        fontSize = 16.sp,
                        fontWeight = FontWeight.SemiBold,
                        modifier = Modifier.weight(1f),
                    )
                    if (selected) {
                        Icon(XIcons.Check, contentDescription = stringResource(R.string.set_selected), tint = p.accent, modifier = Modifier.size(20.dp))
                    }
                }
                Spacer(Modifier.height(10.dp))
                FontSample(font, Modifier.fillMaxWidth())
            }
        }
    }
}

/**
 * 设置的内容:语言一组(跟随系统 / 简体中文 / 繁體中文 / English,当前的打勾),下面是终端字体。
 * 语言的名字各用各自的文字写 —— 看不懂当前语言的人也要能找到自己那一行。
 */
@Composable
fun SettingsContent(onFontPicked: (() -> Unit)? = null) {
    val p = LocalXssh.current
    val context = LocalContext.current
    // 切换语言**不重建界面**(见 AndroidManifest 的 configChanges):系统把新配置送进来,Compose 原地换文字。
    // 打勾的那一项点下去就先改,不等系统的配置回调 —— 否则勾会慢半拍才跳过去。
    // 键上 locales:在系统设置里改了应用语言再回来,这里也跟着对上。
    val locales = androidx.compose.ui.platform.LocalConfiguration.current.locales
    var current by remember(locales) { androidx.compose.runtime.mutableStateOf(AppLanguages.current(context)) }
    val options = listOf(
        AppLanguage.System to stringResource(R.string.set_lang_system),
        // 语言名不翻译:每种语言用它自己的文字。
        AppLanguage.SimplifiedChinese to "简体中文",
        AppLanguage.TraditionalChinese to "繁體中文",
        AppLanguage.English to "English",
    )
    FormGroup(title = stringResource(R.string.set_language)) {
        options.forEachIndexed { index, (language, label) ->
            if (index > 0) FormDivider()
            Row(
                Modifier
                    .fillMaxWidth()
                    .heightIn(min = 52.dp)
                    .clickable {
                        if (language != current) {
                            current = language
                            hostActivity(context)?.let { AppLanguages.apply(it, language) }
                        }
                    }
                    .padding(horizontal = BoxPad),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text(label, color = p.text, fontSize = 16.sp, modifier = Modifier.weight(1f))
                if (language == current) {
                    Icon(XIcons.Check, contentDescription = stringResource(R.string.set_selected), tint = p.accent, modifier = Modifier.size(20.dp))
                }
            }
        }
    }
    Spacer(Modifier.height(24.dp))
    Text(
        stringResource(R.string.set_terminal_font),
        color = p.textDim,
        fontSize = 13.sp,
        modifier = Modifier.padding(start = TitlePad, bottom = 7.dp),
    )
    FontList(onPicked = onFontPicked)
}

/** 手机 / 折叠屏:整页推进来(外壳和主机详情页同一个)。 */
@Composable
fun SettingsScreen(onBack: () -> Unit) {
    val p = LocalXssh.current
    ReadingPage(onBack) {
        Column(Modifier.widthIn(max = PageMaxWidth)) {
            // 大标题和主机页、编辑页同号字(34sp),三页推来推去看着是同一套。
            Text(
                stringResource(R.string.set_title),
                color = p.text,
                fontSize = 34.sp,
                fontWeight = FontWeight.Bold,
                modifier = Modifier.padding(start = TitlePad - TitleOptical, bottom = 18.dp),
            )
            SettingsContent()
        }
    }
}

/**
 * 平板:居中浮层(和新建 / 编辑主机同一种版式:标题居中、右上角「完成」、点外面关、Esc 关)。
 * 选一款字体就换,不用按「完成」—— 那颗只是关浮层。
 */
@Composable
fun SettingsSheet(onDismiss: () -> Unit) {
    val p = LocalXssh.current
    val focus = remember { FocusRequester() }
    LaunchedEffect(Unit) { runCatching { focus.requestFocus() } }
    Dialog(
        onDismissRequest = onDismiss,
        properties = DialogProperties(usePlatformDefaultWidth = false, decorFitsSystemWindows = false),
    ) {
        BoxWithConstraints(
            Modifier
                .fillMaxSize()
                .clickable(interactionSource = remember { MutableInteractionSource() }, indication = null) { onDismiss() }
                .windowInsetsPadding(stableSafeDrawing()),
            contentAlignment = Alignment.Center,
        ) {
            Column(
                Modifier
                    .width(minOf(460.dp, maxWidth - 48.dp))
                    .heightIn(max = maxHeight * 0.8f)
                    .clip(RoundedCornerShape(20.dp))
                    .background(p.bg)
                    .border(0.5.dp, p.glassBorder, RoundedCornerShape(20.dp))
                    .clip(RoundedCornerShape(20.dp))
                    .clickable(interactionSource = remember { MutableInteractionSource() }, indication = null) {}
                    // 插着键盘时 Esc 关浮层(和编辑浮层一致);这里没有输入框,不用管输入法组词。
                    .focusRequester(focus)
                    .focusable()
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
                // 标题栏和编辑浮层同一条:56dp 高、标题居中、下面一条细线。
                Box(Modifier.fillMaxWidth().height(56.dp).padding(horizontal = 8.dp)) {
                    Text(
                        stringResource(R.string.set_title),
                        color = p.text,
                        fontSize = 17.sp,
                        fontWeight = FontWeight.SemiBold,
                        modifier = Modifier.align(Alignment.Center),
                    )
                    ToolbarTextButton(stringResource(R.string.set_done), p.accent, Modifier.align(Alignment.CenterEnd), bold = true) { onDismiss() }
                }
                Box(Modifier.fillMaxWidth().height(0.5.dp).background(p.border))
                Column(Modifier.verticalScroll(rememberScrollState()).padding(20.dp)) {
                    SettingsContent(onFontPicked = onDismiss)
                }
            }
        }
    }
}
