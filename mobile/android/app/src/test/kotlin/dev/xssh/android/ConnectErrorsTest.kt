package dev.xssh.android

import org.junit.Assert.assertFalse
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
    fun selfReferencingCauseDoesNotLoopForever() {
        val e = RuntimeException("loop")
        e.initCause(RuntimeException("inner").also { it.initCause(null) })
        assertFalse(ConnectErrors.isCoreMissing(e))
    }
}
