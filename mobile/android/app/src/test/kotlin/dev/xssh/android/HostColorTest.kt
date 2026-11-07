package dev.xssh.android

import org.junit.Assert.assertEquals
import org.junit.Assert.assertSame
import org.junit.Assert.assertTrue
import org.junit.Test

class HostColorTest {
    private fun hosts(n: Int) = List(n) { Host(id = "h$it", name = "host$it") }

    @Test
    fun firstTwelveHostsGetTwelveDifferentColours() {
        val colored = assignColors(hosts(12))
        assertEquals(12, colored.map { it.colorIndex }.toSet().size)
        assertTrue(colored.all { it.colorIndex in 0 until HostPips.size })
    }

    @Test
    fun existingColoursAreNeverChanged() {
        val input = hosts(3).mapIndexed { i, h -> if (i == 1) h.copy(colorIndex = 7) else h }
        val out = assignColors(input)
        assertEquals(7, out[1].colorIndex)
        // 没编号的两台避开 7。
        assertTrue(out[0].colorIndex != 7 && out[2].colorIndex != 7)
        assertTrue(out[0].colorIndex != out[2].colorIndex)
    }

    @Test
    fun aNewHostTakesAFreeSlotNotTheNextNumber() {
        // 0 号和 2 号已被占用,新来的拿 1 号(最小的空位)。
        val input = listOf(Host(id = "a", colorIndex = 0), Host(id = "b", colorIndex = 2), Host(id = "c"))
        assertEquals(1, assignColors(input)[2].colorIndex)
    }

    @Test
    fun beyondTwelveHostsColoursAreSharedEvenly() {
        val colored = assignColors(hosts(24))
        val counts = colored.groupingBy { it.colorIndex }.eachCount()
        assertTrue(counts.values.all { it == 2 })
    }

    @Test
    fun nothingToDoReturnsTheSameList() {
        val done = assignColors(hosts(3))
        assertSame(done, assignColors(done))
    }

    @Test
    fun sameInputGivesSameOutput() {
        assertEquals(assignColors(hosts(5)), assignColors(hosts(5)))
    }
}
