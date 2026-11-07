package dev.xssh.android

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class ConnectErrorsTest {
    @Test
    fun missingClassIsRecognised() {
        assertTrue(ConnectErrors.isCoreMissing(NoClassDefFoundError("uniffi.xssh_ffi.UniffiLib")))
    }

    @Test
    fun linkErrorBuriedInTheCauseChainIsRecognised() {
        assertTrue(ConnectErrors.isCoreMissing(RuntimeException("wrapper", UnsatisfiedLinkError("dlopen failed"))))
    }

    @Test
    fun messageNamingTheLibraryIsRecognised() {
        assertTrue(ConnectErrors.isCoreMissing(RuntimeException("Unable to load library 'xssh_ffi'")))
        assertTrue(ConnectErrors.isCoreMissing(IllegalStateException("could not open libxssh_ffi.so")))
    }

    @Test
    fun ordinaryNetworkFailuresAreNot() {
        assertFalse(ConnectErrors.isCoreMissing(RuntimeException("Connection refused")))
        assertFalse(ConnectErrors.isCoreMissing(java.net.SocketTimeoutException("timed out")))
    }

    @Test
    fun commonNetworkErrorsGetAFriendlyKind() {
        assertEquals(FriendlyError.Disconnected, ConnectErrors.friendly("ssh: Disconnected"))
        assertEquals(FriendlyError.Timeout, ConnectErrors.friendly("connection timed out"))
        assertEquals(FriendlyError.Refused, ConnectErrors.friendly("Connection refused"))
        assertEquals(FriendlyError.Unreachable, ConnectErrors.friendly("No route to host"))
        assertEquals(FriendlyError.AuthFailed, ConnectErrors.friendly("ssh: unable to authenticate, Permission denied"))
        assertEquals(FriendlyError.AuthFailed, ConnectErrors.friendly("Too many authentication failures"))
    }

    @Test
    fun unknownOrLongMessagesStayRaw() {
        assertNull(ConnectErrors.friendly("something odd"))
        // 被别的路径包进整段话里的原文不能被盖掉。
        assertNull(ConnectErrors.friendly("局域网权限没开,所以连不上。原文:Connection refused。请到系统设置里打开「附近的设备」,然后再试一次。"))
    }

    @Test
    fun selfReferencingCauseDoesNotLoopForever() {
        val e = RuntimeException("loop")
        e.initCause(RuntimeException("inner").also { it.initCause(null) })
        assertFalse(ConnectErrors.isCoreMissing(e))
    }
}
