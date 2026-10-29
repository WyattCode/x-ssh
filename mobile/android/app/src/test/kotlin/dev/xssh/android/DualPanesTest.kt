package dev.xssh.android

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class DualPanesTest {

    @Test
    fun `wide with companion yields dual panes`() {
        val d = resolveDualPanes(true, "a", "b", PaneSide.Left)
        assertTrue(d.dual)
        assertEquals("a", d.leftId)
        assertEquals("b", d.rightId)
        assertEquals("a", d.focusedId)
    }

    @Test
    fun `narrow keeps companion out of layout but shows focused side`() {
        val left = resolveDualPanes(false, "a", "b", PaneSide.Left)
        assertFalse(left.dual)
        assertEquals("a", left.leftId)
        assertNull(left.rightId)

        val right = resolveDualPanes(false, "a", "b", PaneSide.Right)
        assertFalse(right.dual)
        assertEquals("b", right.leftId)
        assertNull(right.rightId)
    }

    @Test
    fun `same primary and companion collapses to single`() {
        val d = resolveDualPanes(true, "a", "a", PaneSide.Right)
        assertFalse(d.dual)
        assertEquals("a", d.leftId)
        assertNull(d.rightId)
    }

    @Test
    fun `no primary is empty`() {
        val d = resolveDualPanes(true, null, "b", PaneSide.Left)
        assertNull(d.leftId)
        assertNull(d.rightId)
        assertFalse(d.dual)
    }

    @Test
    fun `swap exchanges ids`() {
        assertEquals("b" to "a", swapPanes("a", "b"))
        assertEquals("a" to null, swapPanes("a", null))
        assertEquals("a" to "a", swapPanes("a", "a"))
    }

    @Test
    fun `close left promotes companion`() {
        assertEquals(Triple("b", null, PaneSide.Left), closeFocusedPane("a", "b", PaneSide.Left))
    }

    @Test
    fun `close right clears companion only`() {
        assertEquals(Triple("a", null, PaneSide.Left), closeFocusedPane("a", "b", PaneSide.Right))
    }

    @Test
    fun `close single clears all`() {
        assertEquals(Triple(null, null, PaneSide.Left), closeFocusedPane("a", null, PaneSide.Left))
    }

    @Test
    fun `openBeside sets companion and focuses right`() {
        assertEquals(Triple("a", "b", PaneSide.Right), openBeside("a", null, "b"))
        assertEquals(Triple("a", "c", PaneSide.Right), openBeside("a", "b", "c"))
        assertEquals(Triple("a", "b", PaneSide.Left), openBeside("a", "b", "a"))
    }

    @Test
    fun `focusedId follows focus in dual`() {
        assertEquals("b", resolveDualPanes(true, "a", "b", PaneSide.Right).focusedId)
    }
}
