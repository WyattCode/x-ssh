package dev.xssh.android

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class SftpHandleTest {
    @Test
    fun `drops the handle that just failed`() {
        val handle = Any()
        assertTrue(shouldDropSftpHandle(handle, handle))
    }

    @Test
    fun `keeps a handle that was already replaced`() {
        // reset() / rebind() 已经换过通道:别把新的也丢了。
        assertFalse(shouldDropSftpHandle(Any(), Any()))
        assertFalse(shouldDropSftpHandle(null, Any()))
        assertFalse(shouldDropSftpHandle(Any(), null))
    }
}
