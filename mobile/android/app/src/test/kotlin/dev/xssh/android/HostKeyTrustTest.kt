package dev.xssh.android

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class HostKeyTrustTest {
    @Test
    fun `withTrustedHostKey appends without wiping the prior key`() {
        val a = "SHA256:aaa"
        val b = "SHA256:bbb"
        val host = Host(keyFingerprint = a, keyFingerprints = listOf(a))
        val trusted = host.withTrustedHostKey(b)
        assertEquals(listOf(a, b), trusted.trustedHostKeys())
        assertEquals(a, trusted.keyFingerprint)
        assertEquals(listOf(a, b), trusted.keyFingerprints)
    }

    @Test
    fun `trustedHostKeys migrates a single keyFingerprint field`() {
        val a = "SHA256:aaa"
        val host = Host(keyFingerprint = a)
        assertEquals(listOf(a), host.trustedHostKeys())
    }

    @Test
    fun `withTrustedHostKey ignores blanks and duplicates`() {
        val a = "SHA256:aaa"
        val host = Host(keyFingerprint = a, keyFingerprints = listOf(a))
        assertEquals(listOf(a), host.withTrustedHostKey("  ").trustedHostKeys())
        assertEquals(listOf(a), host.withTrustedHostKey(a).trustedHostKeys())
        assertEquals(listOf(a), host.withTrustedHostKey(" $a ").trustedHostKeys())
    }

    @Test
    fun `blank fingerprint stays untrusted`() {
        assertTrue(Host().trustedHostKeys().isEmpty())
        assertTrue(Host(keyFingerprints = listOf("", "  ")).trustedHostKeys().isEmpty())
    }
}
