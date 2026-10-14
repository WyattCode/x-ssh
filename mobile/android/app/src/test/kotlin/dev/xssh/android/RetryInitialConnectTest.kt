package dev.xssh.android

import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Test
import uniffi.xssh_ffi.FfiException

/** 第一次连就失败时自动再试:一次性的失败不该让用户去点重试。 */
class RetryInitialConnectTest {

    private fun transient() = FfiException.Message("connection reset by peer")

    @Test
    fun `a one-off failure is retried and the second try wins`() = runBlocking {
        var calls = 0
        val result = retryInitialConnect(delayMillis = { 0 }) {
            calls++
            if (calls == 1) throw transient()
            "ok"
        }
        assertEquals("ok", result)
        assertEquals(2, calls)
    }

    @Test
    fun `gives up after the attempt limit and rethrows the last error`() = runBlocking {
        var calls = 0
        try {
            retryInitialConnect(attempts = 3, delayMillis = { 0 }) {
                calls++
                throw transient()
            }
            fail("should have thrown")
        } catch (e: FfiException) {
            assertEquals(3, calls)
        }
    }

    @Test
    fun `permanent failures are not retried`() = runBlocking {
        var calls = 0
        try {
            retryInitialConnect(delayMillis = { 0 }) {
                calls++
                throw FfiException.Message("authentication failed")
            }
            fail("should have thrown")
        } catch (e: FfiException) {
            assertEquals(1, calls)
        }
    }

    @Test
    fun `disconnect-all during the handshake is not retried`() {
        assertFalse(isRetryableInitialFailure(SessionRegistry.Cancelled()))
        assertTrue(isRetryableInitialFailure(transient()))
    }
}
