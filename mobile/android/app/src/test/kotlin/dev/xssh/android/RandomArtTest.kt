package dev.xssh.android

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** 和 iOS 版 `RandomArtTests.swift` 同一组数据:两端画出来的图必须一模一样。 */
class RandomArtTest {
    private val known = "SHA256:S5eJEYbJ+XGdEbJIvbZgu0If7rMOhxgx/XmE+bYKScw"

    @Test
    fun knownFingerprintDrawsTheExpectedImage() {
        assertEquals(
            listOf(
                "     . ++...o+   ",
                "     .=o.=ooo    ",
                "    o ..=oo.     ",
                "     = .+*oo     ",
                "    . E.S+B.     ",
                "     +.+o=..     ",
                "    ..=ooo.      ",
                "      .+=.       ",
                "       +=o       ",
            ),
            RandomArt.lines(known),
        )
    }

    @Test
    fun imageHasTheFixedShape() {
        val art = RandomArt.lines(known)!!
        assertEquals(RandomArt.HEIGHT, art.size)
        assertTrue(art.all { it.length == RandomArt.WIDTH })
    }

    @Test
    fun unknownFormatsHaveNoImage() {
        assertNull(RandomArt.lines("MD5:aa:bb:cc"))
        assertNull(RandomArt.lines("SHA256:!!!not base64!!!"))
        assertNull(RandomArt.lines(""))
    }

    @Test
    fun fingerprintIsWrappedIntoShortLines() {
        assertEquals(
            listOf("S5eJEYbJ+XGd", "EbJIvbZgu0If", "7rMOhxgx/XmE", "+bYKScw"),
            RandomArt.wrapped(known),
        )
    }
}
