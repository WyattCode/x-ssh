package dev.xssh.android

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * 会话快照:拍工作区、恢复时丢掉已删主机、JSON 往返、条数上限语义。
 * 不碰 SharedPreferences(编码函数纯)。
 */
class SnapshotsTest {

    @Test
    fun `capture requires at least one live session`() {
        assertNull(captureWorkspace(emptyList(), null, "Snap"))
    }

    @Test
    fun `capture keeps order and drops unknown active`() {
        val snap = captureWorkspace(
            listOf("a" to "Alpha", "b" to "Beta"),
            activeHostId = "missing",
            name = "Snap",
            now = 1_700_000_000_000L,
        )!!
        assertEquals(listOf("a", "b"), snap.entries.map { it.hostId })
        assertNull(snap.activeHostId)
        assertEquals("Snap", snap.name)
        assertEquals(1_700_000_000_000L, snap.savedAt)
    }

    @Test
    fun `capture keeps active when present`() {
        val snap = captureWorkspace(
            listOf("a" to "A", "b" to "B"),
            activeHostId = "b",
            name = "S",
        )!!
        assertEquals("b", snap.activeHostId)
    }

    @Test
    fun `resolveRestore drops missing hosts and picks focus`() {
        val snap = SessionSnapshot(
            name = "S",
            entries = listOf(SnapEntry("a", "A"), SnapEntry("gone", "G"), SnapEntry("c", "C")),
            activeHostId = "gone",
        )
        val (ids, focus) = resolveRestore(snap, setOf("a", "c"))
        assertEquals(listOf("a", "c"), ids)
        assertEquals("a", focus) // active gone → first survivor
    }

    @Test
    fun `resolveRestore keeps active when still known`() {
        val snap = SessionSnapshot(
            name = "S",
            entries = listOf(SnapEntry("a", "A"), SnapEntry("b", "B")),
            activeHostId = "b",
        )
        val (ids, focus) = resolveRestore(snap, setOf("a", "b"))
        assertEquals(listOf("a", "b"), ids)
        assertEquals("b", focus)
    }

    @Test
    fun `resolveRestore all missing yields empty`() {
        val snap = SessionSnapshot(name = "S", entries = listOf(SnapEntry("x", "X")))
        val (ids, focus) = resolveRestore(snap, setOf("a"))
        assertTrue(ids.isEmpty())
        assertNull(focus)
    }

    @Test
    fun `json round trip preserves fields`() {
        val original = listOf(
            SessionSnapshot(
                id = "id-1",
                name = "Morning",
                savedAt = 42L,
                entries = listOf(SnapEntry("h1", "DGX"), SnapEntry("h2", "Web")),
                activeHostId = "h2",
            ),
            SessionSnapshot(
                id = "id-2",
                name = "Empty-ish",
                savedAt = 99L,
                entries = emptyList(),
                activeHostId = null,
            ),
        )
        val back = decodeSnapshots(encodeSnapshots(original))
        assertEquals(original, back)
    }

    @Test
    fun `decode bad json yields empty`() {
        assertEquals(emptyList<SessionSnapshot>(), decodeSnapshots("not-json"))
        assertEquals(emptyList<SessionSnapshot>(), decodeSnapshots(null))
    }

    @Test
    fun `default name includes prefix and clock`() {
        val name = defaultSnapshotName("Snapshot", now = 0L)
        assertTrue(name.startsWith("Snapshot "))
        assertEquals(3, name.removePrefix("Snapshot ").split(':').size)
    }

    @Test
    fun `cap constant matches desktop`() {
        assertEquals(30, SnapshotStore.MAX)
    }

    @Test
    fun `resolveRestore ignores active outside entries`() {
        val snap = SessionSnapshot(
            name = "S",
            entries = listOf(SnapEntry("a", "A")),
            activeHostId = "b", // known host but not in this snapshot
        )
        val (ids, focus) = resolveRestore(snap, setOf("a", "b"))
        assertEquals(listOf("a"), ids)
        assertEquals("a", focus)
    }
}
