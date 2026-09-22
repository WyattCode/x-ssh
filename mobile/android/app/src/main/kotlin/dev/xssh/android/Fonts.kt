package dev.xssh.android

import android.util.Log
import androidx.compose.ui.text.font.Font
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.font.Typeface
import androidx.compose.runtime.getValue
import androidx.compose.runtime.setValue
import java.io.File
import java.io.RandomAccessFile

/**
 * 等宽字体:中英文是**同一套**设计。
 *
 * 原来英文用系统的 `monospace`(DroidSansMono,老式、偏粗、0.6em 宽),中文落到系统界面字体(小米是 MiSans)上 ——
 * 两个设计师、两种笔画粗细和比例;中文一个字 1em,塞进两格 1.2em 的格子里还左右空着。连上服务器一看,
 * 英文又黑又挤、中文又细又散,不像一个字体。
 *
 * 现在照「更纱黑体」(Sarasa Gothic,中文终端字体的事实标准)的配法:
 * - 英文 = Iosevka Term(只截了终端用得到的字:拉丁、希腊、西里尔、标点、箭头、数学、制表符、方块、几何、勾叉、
 *   盲文转圈、Powerline),**正好 0.5em 宽**;
 * - 中文 = 系统自带的 Noto Sans CJK 简体(就是思源黑体,更纱黑体的中文部分),**1em = 正好两格**,不留缝。
 * 两者本来就是按"一起用"来调的:同样的笔画粗细、中文的字面和英文的大写对齐在同一条基线上。
 */
object XsshFonts {
    /** 界面里的等宽字(地址、路径、指纹)和终端里的英文。 */
    val mono: FontFamily = FontFamily(
        Font(R.font.xssh_mono_regular, FontWeight.Normal),
        Font(R.font.xssh_mono_bold, FontWeight.Bold),
    )

    private val cjkFile = File("/system/fonts/NotoSansCJK-Regular.ttc")

    /** 系统思源黑体 TTC 里简体那一个的序号;没有这个文件时为 null。 */
    private val cjkIndex: Int? by lazy {
        runCatching {
            if (!cjkFile.canRead()) return@runCatching null
            // AOSP 的 fonts.xml 里简体是第 2 个;不同厂商可能调过顺序,先按字体自己的名字找,找不到再用 2。
            simplifiedIndex(cjkFile) ?: 2
        }.getOrNull()
    }

    /**
     * 终端里的中日韩宽字符:系统的 Noto Sans CJK 简体。找不到(极少数精简过字体的系统)时为 null,
     * 交给系统默认回退 —— 那样还是能显示,只是回到原来"两套字"的观感。
     */
    val cjk: FontFamily? by lazy {
        runCatching {
            val index = cjkIndex ?: return@runCatching null
            val typeface = android.graphics.Typeface.Builder(cjkFile).setTtcIndex(index).build()
            FontFamily(Typeface(typeface))
        }.onFailure { Log.w(TAG, "CJK font unavailable: ${it.message}") }.getOrNull()
    }

    /**
     * 界面里的等宽字(地址、路径、指纹):英文 Iosevka,**遇到中文接着用思源黑体**,和终端同一套。
     *
     * [mono] 本身不带中文,路径里的「项目文档」会落到系统界面字体(MiSans)上 —— 同一行里英文是 Iosevka、
     * 中文是 MiSans,粗细和比例都对不上。Android 10 起可以给字体指定自己的回退链(CustomFallbackBuilder):
     * Iosevka → 思源黑体简体 → 系统。更老的系统没有这个接口,仍用 [mono]。
     */
    val monoUi: FontFamily by lazy {
        if (android.os.Build.VERSION.SDK_INT < android.os.Build.VERSION_CODES.Q) return@lazy mono
        runCatching { withCjkFallback() }
            .onFailure { Log.w(TAG, "mono UI fallback unavailable: ${it.message}") }
            .getOrNull() ?: mono
    }

    @androidx.annotation.RequiresApi(android.os.Build.VERSION_CODES.Q)
    private fun withCjkFallback(): FontFamily? {
        val context = appContext ?: return null
        val index = cjkIndex ?: return null
        val latin = android.graphics.fonts.Font.Builder(context.resources, R.font.xssh_mono_regular).build()
        val cjkFont = android.graphics.fonts.Font.Builder(cjkFile).setTtcIndex(index).build()
        val typeface = android.graphics.Typeface.CustomFallbackBuilder(android.graphics.fonts.FontFamily.Builder(latin).build())
            .addCustomFallback(android.graphics.fonts.FontFamily.Builder(cjkFont).build())
            .setSystemFallback("sans-serif")
            .build()
        // 界面里的等宽字几乎不用粗体;真要粗体时由系统合成(和终端里的中文粗体同一个做法)。
        return FontFamily(Typeface(typeface))
    }

    /** 读打包的字体要用应用的 Resources;在 MainActivity.onCreate 里、界面组合之前设好。 */
    private var appContext: android.content.Context? = null

    fun init(context: android.content.Context) {
        appContext = context.applicationContext
        TerminalFontChoice.load(context)
    }

    /** 打包字体的 android Typeface(查某个字有没有字形用)。 */
    internal fun typeface(res: Int): android.graphics.Typeface? =
        appContext?.let { runCatching { androidx.core.content.res.ResourcesCompat.getFont(it, res) }.getOrNull() }

    /** 在 TTC 里找族名以 " SC" 结尾的那个字体(Noto Sans CJK SC)。读 'name' 表,不整个加载字体。 */
    private fun simplifiedIndex(file: File): Int? = RandomAccessFile(file, "r").use { f ->
        fun u16(at: Long): Int {
            f.seek(at)
            return f.readUnsignedShort()
        }
        fun u32(at: Long): Long {
            f.seek(at)
            return f.readInt().toLong() and 0xFFFFFFFFL
        }
        f.seek(0)
        val tag = ByteArray(4).also { f.readFully(it) }
        if (String(tag, Charsets.US_ASCII) != "ttcf") return@use null
        val count = u32(8).toInt()
        for (i in 0 until count.coerceAtMost(16)) {
            val font = u32(12L + 4 * i)
            val tables = u16(font + 4)
            var nameTable = -1L
            for (t in 0 until tables) {
                val record = font + 12 + 16L * t
                f.seek(record)
                val tableTag = ByteArray(4).also { f.readFully(it) }
                if (String(tableTag, Charsets.US_ASCII) == "name") {
                    nameTable = u32(record + 8)
                    break
                }
            }
            if (nameTable < 0) continue
            val records = u16(nameTable + 2)
            val strings = nameTable + u16(nameTable + 4)
            for (r in 0 until records) {
                val at = nameTable + 6 + 12L * r
                val platform = u16(at)
                val nameId = u16(at + 6)
                if (platform != 3 || nameId != 1) continue
                val length = u16(at + 8)
                val offset = u16(at + 10)
                val bytes = ByteArray(length)
                f.seek(strings + offset)
                f.readFully(bytes)
                val family = String(bytes, Charsets.UTF_16BE)
                if (family.endsWith(" SC")) return@use i
            }
        }
        null
    }
}

/**
 * 终端字体(只换英文;中文一律是系统思源黑体,画线字符一律是 Iosevka)。
 *
 * 能进这张表的只有一种字体:**英文每个字正好 0.5em 宽**。这样中文(1em)正好两格,不留缝、不挤扁 ——
 * JetBrains Mono、Fira Code、Cascadia 这些原版是 0.6em,中文塞进两格左右各空一截,所以用 Iosevka 仿它们字形的
 * 变体(SS14 / SS05 …)代替,宽度严格半格。
 *
 * 格子的大小和基线**不随字体变**,一律按 Iosevka 量(见 TerminalCanvas):换字体只换字形,行高、列宽、中文位置
 * 都不动;制表符、方块、箭头、盲文这些要和格子严丝合缝的字也一律用 Iosevka 画 —— 否则换个行高不同的字体,
 * 表格竖线就一段一段断开。
 *
 * [full]:字表和 Iosevka 一样全(Iosevka 的变体),所有窄字都用它;否则只有它真有字形、且截字时确认是半格宽的
 * 那些字(拉丁、希腊、西里尔、标点)用它,其余交给 Iosevka。
 */
enum class TerminalFont(val id: String, val label: String, val regular: Int, val bold: Int, val full: Boolean) {
    Iosevka("iosevka", "Iosevka", R.font.xssh_mono_regular, R.font.xssh_mono_bold, true),
    JetBrains("jetbrains", "JetBrains Mono 风格", R.font.xssh_term_jetbrains_regular, R.font.xssh_term_jetbrains_bold, true),
    Fira("fira", "Fira Mono 风格", R.font.xssh_term_fira_regular, R.font.xssh_term_fira_bold, true),
    Menlo("menlo", "Menlo 风格", R.font.xssh_term_menlo_regular, R.font.xssh_term_menlo_bold, true),
    Plex("plex", "IBM Plex Mono 风格", R.font.xssh_term_plex_regular, R.font.xssh_term_plex_bold, true),
    Ubuntu("ubuntu", "Ubuntu Mono", R.font.xssh_term_ubuntu_regular, R.font.xssh_term_ubuntu_bold, false),
    Inconsolata("inconsolata", "Inconsolata", R.font.xssh_term_inconsolata_regular, R.font.xssh_term_inconsolata_bold, false),
    Noto("noto", "思源等宽", R.font.xssh_term_noto_regular, R.font.xssh_term_noto_bold, false),
    ;

    val family: FontFamily by lazy {
        if (this == Iosevka) XsshFonts.mono else FontFamily(Font(regular, FontWeight.Normal), Font(bold, FontWeight.Bold))
    }

    private val glyphs = HashMap<Int, Boolean>()
    private val paint by lazy { XsshFonts.typeface(regular)?.let { android.graphics.Paint().apply { typeface = it } } }

    /** 这个字(按第一个码位)用不用这套字体画。只在画面线程上调。 */
    fun draws(text: String): Boolean {
        if (full) return true
        val cp = text.codePointAt(0)
        if (cp in 0x20..0x7E) return true
        return glyphs.getOrPut(cp) { paint?.hasGlyph(String(Character.toChars(cp))) == true }
    }

    companion object {
        fun of(id: String?): TerminalFont = entries.firstOrNull { it.id == id } ?: Iosevka
    }
}

/** 当前的终端字体:所有终端画面读这里,选字体页写这里(同时记进偏好)。 */
object TerminalFontChoice {
    var current by androidx.compose.runtime.mutableStateOf(TerminalFont.Iosevka)
        private set
    private var prefs: UiPrefs? = null

    fun load(context: android.content.Context) {
        val p = UiPrefs(context)
        prefs = p
        current = TerminalFont.of(p.terminalFont)
    }

    fun choose(font: TerminalFont) {
        current = font
        prefs?.terminalFont = font.id
    }
}
