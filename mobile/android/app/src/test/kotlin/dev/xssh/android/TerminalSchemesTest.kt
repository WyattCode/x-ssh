package dev.xssh.android

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Test

/** 终端配色与桌面 `terminalThemes.ts` 同名同 id。 */
class TerminalSchemesTest {
    @Test
    fun `preset ids match desktop`() {
        assertEquals(TerminalSchemes.DESKTOP_IDS, TerminalSchemes.PRESETS.map { it.id })
        assertEquals(6, TerminalSchemes.PRESETS.size)
        assertEquals(6, TerminalSchemes.PRESETS.map { it.id }.toSet().size)
    }

    @Test
    fun `labels match desktop`() {
        val labels = TerminalSchemes.PRESETS.associate { it.id to it.label }
        assertEquals("Nord", labels["nord"])
        assertEquals("Dracula", labels["dracula"])
        assertEquals("Solarized Dark", labels["solarized"])
        assertEquals("One Dark", labels["one-dark"])
        assertEquals("Gruvbox Dark", labels["gruvbox"])
        assertEquals("Monokai", labels["monokai"])
    }

    @Test
    fun `nord hex matches desktop terminalThemes`() {
        val nord = TerminalSchemes.BY_ID.getValue("nord")
        assertEquals(0x2E3440L, nord.background)
        assertEquals(0xD8DEE9L, nord.foreground)
        assertEquals(0x88C0D0L, nord.cursor)
        assertEquals(16, nord.term16.size)
        assertEquals(0x3B4252L, nord.term16[0])
        assertEquals(0xBF616AL, nord.term16[1])
        assertEquals(0x616E88L, nord.term16[8])
        // brightRed.. 跟常态同色(与桌面补齐策略一致)
        assertEquals(nord.term16[1], nord.term16[9])
        assertEquals(nord.term16[7], nord.term16[15])
    }

    @Test
    fun `resolve named ignores appearance`() {
        val dark = TerminalSchemes.resolve("dracula", dark = true)
        val light = TerminalSchemes.resolve("dracula", dark = false)
        assertEquals("dracula", dark.id)
        assertEquals(dark.term16, light.term16)
        assertEquals(0x282A36L, TerminalSchemes.BY_ID.getValue("dracula").background)
    }

    @Test
    fun `empty unknown fall back to system`() {
        val dark = TerminalSchemes.resolve("", dark = true)
        assertEquals("", dark.id)
        assertEquals(TerminalSchemes.systemDark16, dark.term16)

        val light = TerminalSchemes.resolve(null, dark = false)
        assertEquals("", light.id)
        assertEquals(TerminalSchemes.systemLight16, light.term16)

        val nope = TerminalSchemes.resolve("nope", dark = true)
        assertEquals("", nope.id)
        assertEquals(TerminalSchemes.systemDark16, nope.term16)
    }

    @Test
    fun `withTerminalScheme overlays only term fields`() {
        val base = DarkPalette
        val themed = base.withTerminalScheme("monokai")
        assertEquals(base.bg, themed.bg)
        assertEquals(base.accent, themed.accent)
        assertEquals(TerminalSchemes.BY_ID.getValue("monokai").term16, themed.term16)
        assertNotEquals(base.term16, themed.term16)
    }
}
