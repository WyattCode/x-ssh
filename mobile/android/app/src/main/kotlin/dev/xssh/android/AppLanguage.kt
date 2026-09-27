package dev.xssh.android

import android.app.Activity
import android.app.LocaleManager
import android.content.Context
import android.content.res.Configuration
import android.os.Build
import android.os.LocaleList
import java.util.Locale

/**
 * 界面语言:跟随系统,或者固定成简体 / 繁体中文 / 英文。
 *
 * 资源放在 `values/`(英文,也是系统语言不是中英文时的兜底)、`values-zh/`(简体)、
 * `values-b+zh+Hant/`(繁体,台湾用语)。系统是 zh-TW / zh-HK 时 Android 按"可能的文字"推断成 Hant,
 * 自动落到繁体;其余中文落到简体。
 */
enum class AppLanguage(val tag: String?) {
    System(null),
    SimplifiedChinese("zh-Hans"),
    TraditionalChinese("zh-Hant"),
    English("en"),
}

/**
 * 切换 / 读取应用自己的语言。
 *
 * Android 13 起用系统的「按应用设置语言」(`LocaleManager`):系统替我们存、替我们重建界面,
 * 系统设置 → 应用 → 语言 里改的和这里改的是同一个值。更早的系统没有这套,存在界面偏好(`xssh_ui`)里,
 * 由 [MainActivity.attachBaseContext] 套到界面上,切换时自己重建一次。
 */
object AppLanguages {
    /**
     * 应用的 Context,给没有界面的地方取文案(会话层的「连接已恢复」)。MainActivity 启动时设。
     * Android 13 起它跟着应用语言;更早的系统是系统语言(那里应用内切换只作用于界面)。
     */
    @Volatile
    var appContext: Context? = null

    fun current(context: Context): AppLanguage =
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            val locales = context.getSystemService(LocaleManager::class.java)?.applicationLocales
            if (locales == null || locales.isEmpty) AppLanguage.System else fromLocale(locales[0])
        } else {
            stored(context)
        }

    /**
     * 切到 [language]。Android 13 起:系统换应用语言、把新配置送给 Activity;因为 Manifest 里声明了
     * `configChanges="locale|layoutDirection"`,**不重建**,Compose 原地重组换文字,界面不闪。
     * 更早的系统没有按应用语言,只能 recreate(会闪一下,这几台机器都用不到)。
     */
    fun apply(activity: Activity, language: AppLanguage) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            val manager = activity.getSystemService(LocaleManager::class.java) ?: return
            manager.applicationLocales = language.tag?.let { LocaleList.forLanguageTags(it) } ?: LocaleList.getEmptyLocaleList()
        } else {
            prefs(activity).edit().putString(KEY, language.name).apply()
            activity.recreate()
        }
    }

    /**
     * Android 12 及更早:把选的语言套到界面的 Context 上。13 起原样返回(系统已经处理了)。
     * 跟随系统时也原样返回。
     */
    fun wrap(base: Context): Context {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) return base
        val tag = stored(base).tag ?: return base
        val config = Configuration(base.resources.configuration)
        config.setLocales(LocaleList.forLanguageTags(tag))
        return base.createConfigurationContext(config)
    }

    /** 一个 Locale 属于哪种界面语言(读系统存的「按应用语言」时用)。 */
    internal fun fromLocale(locale: Locale): AppLanguage = when {
        locale.language != "zh" -> if (locale.language == "en") AppLanguage.English else AppLanguage.System
        locale.script == "Hant" || locale.country in TraditionalRegions -> AppLanguage.TraditionalChinese
        else -> AppLanguage.SimplifiedChinese
    }

    private val TraditionalRegions = setOf("TW", "HK", "MO")

    private const val KEY = "appLanguage"

    private fun prefs(context: Context) = context.getSharedPreferences("xssh_ui", Context.MODE_PRIVATE)

    private fun stored(context: Context): AppLanguage =
        AppLanguage.entries.firstOrNull { it.name == prefs(context).getString(KEY, null) } ?: AppLanguage.System
}
