package dev.xssh.android

import java.util.Locale
import org.junit.Assert.assertEquals
import org.junit.Test

/** 系统存的「按应用语言」对应哪一项(设置页据此打勾)。 */
class AppLanguageTest {
    private fun of(tag: String) = AppLanguages.fromLocale(Locale.forLanguageTag(tag))

    @Test
    fun `traditional chinese by script or region`() {
        assertEquals(AppLanguage.TraditionalChinese, of("zh-Hant"))
        assertEquals(AppLanguage.TraditionalChinese, of("zh-TW"))
        assertEquals(AppLanguage.TraditionalChinese, of("zh-HK"))
        assertEquals(AppLanguage.TraditionalChinese, of("zh-MO"))
    }

    @Test
    fun `other chinese is simplified`() {
        assertEquals(AppLanguage.SimplifiedChinese, of("zh-Hans"))
        assertEquals(AppLanguage.SimplifiedChinese, of("zh-CN"))
        assertEquals(AppLanguage.SimplifiedChinese, of("zh"))
    }

    @Test
    fun `english and anything else`() {
        assertEquals(AppLanguage.English, of("en"))
        assertEquals(AppLanguage.English, of("en-GB"))
        // 我们没提供的语言当作跟随系统(界面会落到英文兜底)。
        assertEquals(AppLanguage.System, of("ja"))
    }
}
