package dev.xssh.android

import org.junit.Assert.assertEquals
import org.junit.Test

class PasteSanitizeTest {

    @Test
    fun `empty text is unchanged`() {
        assertEquals("", PasteSanitize.sanitize(""))
    }

    @Test
    fun `tab newline and carriage return are kept`() {
        assertEquals("a\tb\nc\rd", PasteSanitize.sanitize("a\tb\nc\rd"))
    }

    @Test
    fun `escape and DEL are stripped`() {
        assertEquals("ab", PasteSanitize.sanitize("a\u001Bb\u007F"))
    }

    @Test
    fun `C1 controls are stripped`() {
        assertEquals("ab", PasteSanitize.sanitize("a\u0085b\u009F"))
    }

    @Test
    fun `ordinary text passes through`() {
        assertEquals("hello world", PasteSanitize.sanitize("hello world"))
    }
}
