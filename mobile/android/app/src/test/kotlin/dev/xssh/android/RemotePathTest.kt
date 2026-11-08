package dev.xssh.android

import org.junit.Assert.assertEquals
import org.junit.Test

class RemotePathTest {
    @Test
    fun dotAndDotDotAreFolded() {
        assertEquals("/a", normalizeRemotePath("/a/b/.."))
        assertEquals("/a/c", normalizeRemotePath("/a/./b/../c/"))
        assertEquals("/a/b", normalizeRemotePath("/a//b"))
    }

    @Test
    fun dotDotStopsAtRoot() {
        assertEquals("/", normalizeRemotePath("/.."))
        assertEquals("/x", normalizeRemotePath("/../../x"))
        assertEquals("/", normalizeRemotePath("/"))
    }

    @Test
    fun serverNamesCannotEscapeTheTargetDirectory() {
        assertEquals("_", localSafe(".."))
        assertEquals("_", localSafe("."))
        assertEquals("_", localSafe(""))
        assertEquals("_", localSafe("   "))
        assertEquals("a_b", localSafe("a/b"))
        assertEquals("a_b", localSafe("a\\b"))
        assertEquals("_.._x", localSafe("/../x"))
        assertEquals("report 2024.txt", localSafe("report 2024.txt"))
        assertEquals("日志", localSafe("日志"))
    }
}
