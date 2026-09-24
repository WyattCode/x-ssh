package dev.xssh.android

import androidx.compose.ui.focus.focusProperties
import androidx.compose.runtime.DisposableEffect
import androidx.compose.material3.Icon
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.layout.size
import androidx.compose.animation.AnimatedVisibility
import kotlinx.coroutines.delay
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.isImeVisible
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.runtime.compositionLocalOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.geometry.Rect
import androidx.compose.ui.unit.IntSize
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.foundation.relocation.bringIntoViewRequester
import androidx.compose.foundation.relocation.BringIntoViewRequester
import androidx.compose.ui.draw.shadow
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.input.key.onInterceptKeyBeforeSoftKeyboard
import androidx.compose.runtime.SideEffect
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.TextRange
import androidx.compose.ui.text.input.TextFieldValue
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.input.VisualTransformation
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

/* ─────────────────────────── 移动端表单 ───────────────────────────

   不用桌面那套"每个字段一个描边框"的排法。手机上更顺的是**分组行式列表**:
   一组字段装在一块圆角面板里,每行左边是标签、右边是值,行与行之间一条内缩的细线。
   手指点一行就在那一行里改,视线不用在框和标签之间来回跳。
*/

/** 一组表单行。[title] 是组标题(写在面板外面),[footnote] 是组下面的小字说明。 */
@Composable
fun FormGroup(
    title: String? = null,
    footnote: String? = null,
    modifier: Modifier = Modifier,
    content: @Composable ColumnScope.() -> Unit,
) {
    val p = LocalXssh.current
    Column(modifier.fillMaxWidth()) {
        if (title != null) {
            Text(
                title,
                color = p.textDim,
                fontSize = 13.sp,
                // 标题线(见 Components 里的版心说明)。
                modifier = Modifier.padding(start = TitlePad, bottom = 7.dp),
            )
        }
        Column(
            Modifier
                .fillMaxWidth()
                .clip(RoundedCornerShape(RadiusBox))
                // 和主机卡片同一个底色:整个应用的"卡片"只有这一种灰。
                .background(p.cardBg),
            content = content,
        )
        if (footnote != null) {
            Text(
                footnote,
                color = p.textDim,
                fontSize = 13.sp,
                modifier = Modifier.padding(start = TitlePad, end = BoxPad, top = 7.dp),
            )
        }
    }
}

/** 组内行与行之间的分隔线:左边内缩,让它读起来像"同一组里的下一行"。 */
@Composable
fun FormDivider() {
    Box(
        Modifier
            .fillMaxWidth()
            .padding(start = BoxPad)
            // 细线:0.5dp。1dp 的线在分组块里太重,像把一块切成了几块。
            .height(0.5.dp)
            .background(LocalXssh.current.border),
    )
}

/**
 * 可编辑的一行:左标签、右取值。
 *
 * 值用 [BasicTextField] 自己画,不用 Material 的描边输入框 —— 那个框在手机上
 * 既占地方又把一行拆成两层。这里点哪一行就在哪一行里改。
 */
@Composable
fun FormField(
    label: String,
    value: String,
    onValue: (String) -> Unit,
    placeholder: String = "",
    mono: Boolean = false,
    secret: Boolean = false,
    keyboard: KeyboardType = KeyboardType.Text,
    imeAction: ImeAction = ImeAction.Next,
    /** 平板浮层打开时直接聚焦第一格(插着键盘就能开始打字)。 */
    focusRequester: FocusRequester? = null,
    /** 最后一格按回车 / 完成时要做的事(平板浮层:保存)。 */
    onDone: (() -> Unit)? = null,
    /**
     * 输入法是否正在组词(拼音还没上屏)。平板浮层据此决定 Esc 归谁:
     * 组词中 Esc 是取消拼音,交给输入法;没在组词时 Esc 就是关浮层,要赶在输入法前面拿。
     */
    onComposing: ((Boolean) -> Unit)? = null,
    /**
     * 只会是英文的一格(地址、端口、用户名)。插着实体键盘时,字符键赶在输入法前面直接写进来 ——
     * 小米输入法接实体键盘时不看输入框声明的键盘类型,照样把 `root` 组成拼音候选。
     */
    asciiOnly: Boolean = false,
) {
    val p = LocalXssh.current
    // 密码这一行右边的「眼睛」:按一下看一眼,再按一下盖回去。
    //
    // 默认**盖着**:密码框的常态是不给人看,肩后有人时才不至于一打开页面就暴露。
    // 只在真有内容时才出现 —— 空框上放一个点了没反应的按钮没有意义
    // (加锁主机的密码格是空的、只显示「已保存」,那里也不该有眼睛)。
    // 离开这一页就恢复成盖着:`remember` 跟着输入框一起没了,不会把"看得见"留到下一次。
    var revealed by remember { mutableStateOf(false) }
    // 内容被清空(全选删掉)时眼睛会消失,但"显示中"要是留着,
    // 接着输的新密码就直接以明文出现 —— 用户并没有按过任何东西。
    // 用副作用改,不在组合期间写状态(那会多跑一轮组合)。
    LaunchedEffect(value.isEmpty()) { if (value.isEmpty()) revealed = false }
    // 明文露着的时候给窗口挂上 FLAG_SECURE:多任务缩略图、截屏、录屏一律拿不到。
    //
    // 原来只在 `ON_STOP` 里把 `revealed` 收回去,**挡不住缩略图** —— 系统那张快照是在
    // pause/stop 那一刻拍的,之后的重组来不及。收回去这件事还是要做(回到前台该是盖着的),
    // 但真正管用的是这道标志:它一挂上,系统就不会拍这一屏。
    if (secret) {
        val activity = hostActivity(LocalContext.current)
        val owner = androidx.lifecycle.compose.LocalLifecycleOwner.current
        DisposableEffect(revealed, activity) {
            if (revealed) {
                activity?.window?.addFlags(android.view.WindowManager.LayoutParams.FLAG_SECURE)
            }
            onDispose {
                // 只有自己挂上的才摘 —— 同一页可能有两格(密码 + 私钥口令)同时露着。
                if (revealed) {
                    activity?.window?.clearFlags(android.view.WindowManager.LayoutParams.FLAG_SECURE)
                }
            }
        }
        DisposableEffect(owner) {
            val watch = androidx.lifecycle.LifecycleEventObserver { _, event ->
                if (event == androidx.lifecycle.Lifecycle.Event.ON_STOP) revealed = false
            }
            owner.lifecycle.addObserver(watch)
            onDispose { owner.lifecycle.removeObserver(watch) }
        }
    }
    // 聚焦时把这一行连同下面一截 [LocalFieldClearance] 一起滚进视野:
    // 右下角悬浮的按钮随键盘升起,不这样的话,正在输入的取值正好被按钮盖住。
    val clearance = LocalFieldClearance.current
    val requester = remember { BringIntoViewRequester() }
    var focused by remember { mutableStateOf(false) }
    var rowSize by remember { mutableStateOf(IntSize.Zero) }
    val density = LocalDensity.current

    @OptIn(ExperimentalLayoutApi::class)
    val imeUp = WindowInsets.isImeVisible
    LaunchedEffect(focused, imeUp) {
        if (!focused || !imeUp || clearance == 0.dp) return@LaunchedEffect
        // 等键盘升完、可滚动区域缩好,再算要滚多少。
        delay(320)
        val extra = with(density) { clearance.toPx() }
        requester.bringIntoView(Rect(0f, 0f, rowSize.width.toFloat(), rowSize.height + extra))
    }
    Row(
        Modifier
            .fillMaxWidth()
            .bringIntoViewRequester(requester)
            .onSizeChanged { rowSize = it }
            .onFocusChanged { focused = it.hasFocus }
            .heightIn(min = 52.dp)
            .padding(horizontal = BoxPad),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        // 标签用主文字色、取值右对齐 —— iOS 设置页的写法。
        Text(label, color = p.text, fontSize = 16.sp)
        Spacer(Modifier.width(GapItem))
        Box(Modifier.weight(1f), contentAlignment = Alignment.CenterEnd) {
            if (value.isEmpty() && placeholder.isNotEmpty()) {
                Text(
                    placeholder,
                    color = p.textFaint,
                    fontSize = 16.sp,
                    fontFamily = if (mono) XsshFonts.monoUi else FontFamily.Default,
                    textAlign = TextAlign.End,
                )
            }
            // 用 TextFieldValue 才看得到组词区间(composition)。
            var field by remember { mutableStateOf(TextFieldValue(value, TextRange(value.length))) }
            // 外部改写了值(端口只留数字)时以外部为准 —— `syncedField` 只在两边不一致时动手。
            //
            // 这里**试过两版"聪明"的判据,都错了**,记下来别再来一遍:
            //   1. "和我上次交出去的文字不一样才采纳":那个量在每个写入点都跟 `field.text`
            //      一起更新,条件恒等于 `value != field.text` —— 和不加判据完全一样,空操作。
            //   2. "外部这一帧的值和上一帧不一样才采纳":**过滤器拒绝一个字**时,外部的值
            //      正好没变(端口 "8080" 里敲 a,过滤完还是 "8080"),于是判成"外部没改写",
            //      那个字母就永远留在屏幕上,而存下去的是 "8080" —— 界面和数据对不上。
            // 「外部还没追上」和「外部把这个字拒了」在外部看来是同一个值,判据分不开。
            // 而 `onValue` 里 `draft.xxx = it` 是同步的快照写入,下一次组合读到的就是新值,
            // "慢一拍"本来就不会发生 —— 所以不需要判据,老老实实每次对齐。
            val shown = syncedField(field, value)
            SideEffect { if (field != shown) field = shown }
            BasicTextField(
                value = shown,
                onValueChange = {
                    field = it
                    onComposing?.invoke(it.composition != null)
                    if (it.text != value) onValue(it.text)
                },
                singleLine = true,
                textStyle = TextStyle(
                    color = p.text,
                    fontSize = 16.sp,
                    fontFamily = if (mono) XsshFonts.monoUi else FontFamily.Default,
                    textAlign = TextAlign.End,
                ),
                visualTransformation =
                    if (secret && !revealed) PasswordVisualTransformation() else VisualTransformation.None,
                keyboardOptions = KeyboardOptions(keyboardType = keyboard, imeAction = imeAction),
                keyboardActions = if (onDone != null) KeyboardActions(onDone = { onDone() }) else KeyboardActions.Default,
                cursorBrush = SolidColor(p.accent),
                modifier = Modifier
                    .fillMaxWidth()
                    .then(if (focusRequester != null) Modifier.focusRequester(focusRequester) else Modifier)
                    .then(
                        if (!asciiOnly) {
                            Modifier
                        } else {
                            Modifier.onInterceptKeyBeforeSoftKeyboard { event ->
                                val e = event.nativeKeyEvent
                                if (!e.isPrintingKey || e.isCtrlPressed || e.isAltPressed || e.isMetaPressed) {
                                    return@onInterceptKeyBeforeSoftKeyboard false
                                }
                                val code = e.getUnicodeChar(e.metaState)
                                if (code !in 0x20..0x7E) return@onInterceptKeyBeforeSoftKeyboard false
                                // 松开事件也吞掉,别让输入法收到半个按键。
                                if (e.action != android.view.KeyEvent.ACTION_DOWN) return@onInterceptKeyBeforeSoftKeyboard true
                                // 用 field(每次插字后立刻更新)而不是 shown(上一次组合时的快照):
                                // 按键连着来、界面还没重组时,用快照会拿旧内容覆盖,字就丢了(实测 example 丢了 e)。
                                val current = field
                                val sel = current.selection
                                val text = current.text.replaceRange(sel.min, sel.max, code.toChar().toString())
                                field = TextFieldValue(text, TextRange(sel.min + 1))
                                onComposing?.invoke(false)
                                onValue(text)
                                true
                            }
                        },
                    ),
            )
        }
        if (secret) {
            // 出现 / 消失跟着走一套动效(和轨道上那些按钮同一个规矩:不"砰"地冒出来)。
            AnimatedVisibility(visible = value.isNotEmpty(), enter = Motion.chipInRow, exit = Motion.chipOutRow) {
                Row {
                    Spacer(Modifier.width(GapItem))
                    Box(
                        Modifier
                            // 图标 19dp,但手指要按的那块得够大(40×44,行高 52 装得下)。
                            .size(40.dp, 44.dp)
                            .clip(CircleShape)
                            // **不能抢焦点**:`clickable` 默认是可聚焦的,点一下眼睛,
                            // 输入框就失焦、键盘跟着收起来 —— 密码还没输完呢。
                            .focusProperties { canFocus = false }
                            .clickable(role = Role.Button) { revealed = !revealed },
                        contentAlignment = Alignment.Center,
                    ) {
                        Icon(
                            if (revealed) XIcons.EyeOff else XIcons.Eye,
                            // 读屏念这一句就够,别再给 clickable 配 onClickLabel(会念两遍)。
                            contentDescription = if (revealed) "隐藏密码" else "显示密码",
                            tint = p.textDim,
                            modifier = Modifier.size(19.dp),
                        )
                    }
                }
            }
        }
    }
}

/**
 * 分段选择(几选一):浅灰轨道里一块白色(深色下是灰色)滑块标出当前项 —— iOS 的 segmented control。
 * 一眼看出是"几选一",而不是两颗都能按的按钮。
 */
@Composable
fun Segmented(options: List<String>, selected: Int, onSelect: (Int) -> Unit) {
    val p = LocalXssh.current
    Row(
        Modifier
            .clip(RoundedCornerShape(9.dp))
            .background(p.bgElev2)
            .padding(2.dp),
    ) {
        options.forEachIndexed { index, label ->
            val on = index == selected
            Box(
                Modifier
                    .clip(RoundedCornerShape(7.dp))
                    .background(if (on) (if (p.dark) Color(0xFF636366) else Color.White) else Color.Transparent)
                    .clickable(role = Role.Tab) { onSelect(index) }
                    .padding(horizontal = 16.dp, vertical = 7.dp),
                contentAlignment = Alignment.Center,
            ) {
                Text(
                    label,
                    color = p.text,
                    fontSize = 14.sp,
                    fontWeight = if (on) FontWeight.SemiBold else FontWeight.Normal,
                )
            }
        }
    }
}

/** 只读/可点的一行(删除之类)。[danger] 为真时整行用危险色。 */
@Composable
fun FormAction(label: String, danger: Boolean = false, onClick: () -> Unit) {
    val p = LocalXssh.current
    Box(
        Modifier
            .fillMaxWidth()
            .heightIn(min = 56.dp)
            .clickable { onClick() }
            .padding(horizontal = BoxPad),
        contentAlignment = Alignment.CenterStart,
    ) {
        Text(label, color = if (danger) p.danger else p.accent, fontSize = 16.sp)
    }
}

/**
 * 输入框自己的 TextFieldValue 和外部的取值对齐。
 *
 * 外部可能改写了文字(端口只留数字、限 5 位):只换文字不动光标的话,光标还停在过滤前的位置,
 * 后面输入的字就插错了地方(实测端口里敲 "8a0b8" 变成 "80228")。
 *
 * 光标要停在"**它前面那些字里、活下来的那几个**"之后 —— 逐字对一遍就知道活了几个。
 * 原来是按"总共少了几个字"整体往回挪,只在"被滤掉的正好在光标前面"时才对:
 * 端口已经 5 位时在开头敲一个字,`take(5)` 砍掉的是**末尾**,光标却被往回挪了一格,
 * 于是下一个字插到了刚敲的那个前面 —— 敲 9 再敲 8,得到的是 "89…"(实测字序颠倒)。
 */
fun syncedField(field: TextFieldValue, value: String): TextFieldValue {
    if (field.text == value) return field
    var before = 0
    var kept = 0
    while (before < field.selection.end && kept < value.length) {
        if (field.text[before] == value[kept]) kept++
        before++
    }
    return TextFieldValue(value, TextRange(kept))
}

/** 表单行聚焦时,除了自己还要额外露出的高度(给悬浮在右下角的按钮让位)。 */
val LocalFieldClearance = compositionLocalOf { 0.dp }
