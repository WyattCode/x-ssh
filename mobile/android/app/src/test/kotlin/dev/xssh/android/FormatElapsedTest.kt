package dev.xssh.android

import org.junit.Assert.assertEquals
import org.junit.Test

class FormatElapsedTest {
    @Test
    fun underAnHourIsMinutesAndSeconds() {
        assertEquals("0:00", formatElapsed(0))
        assertEquals("0:09", formatElapsed(9_999))
        assertEquals("1:05", formatElapsed(65_000))
        assertEquals("59:59", formatElapsed(3_599_000))
    }

    @Test
    fun anHourOrMoreAddsTheHourField() {
        assertEquals("1:00:00", formatElapsed(3_600_000))
        assertEquals("12:03:07", formatElapsed(12 * 3_600_000L + 3 * 60_000L + 7_000L))
    }

    @Test
    fun clockSkewNeverShowsANegativeTime() {
        assertEquals("0:00", formatElapsed(-5_000))
    }
}
