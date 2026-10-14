package dev.xssh.android

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/**
 * 解不开的密文在保存时不能被覆盖成空(密钥库瞬时故障 → 永久丢密码)。
 * 输入只用 `HostStore.load` 真会产生的形态:没加锁的解不开时 `locked*` 是 null,只有 unreadable 标记。
 */
class FallbackSealedTest {
    private val disk = "YWJj:ZGVm"

    @Test
    fun `unreadable plain secret carries the on-disk ciphertext`() {
        assertEquals(disk, fallbackSealed(locked = null, unreadable = true, disk = disk))
    }

    @Test
    fun `readable secret does not resurrect the disk value`() {
        // 用户主动清空密码:不该被磁盘旧值顶回来。
        assertNull(fallbackSealed(locked = null, unreadable = false, disk = disk))
    }

    @Test
    fun `locked ciphertext wins`() {
        assertEquals("L:x", fallbackSealed(locked = "L:x", unreadable = true, disk = disk))
    }

    @Test
    fun `nothing on disk gives nothing`() {
        assertNull(fallbackSealed(locked = null, unreadable = true, disk = null))
        assertNull(fallbackSealed(locked = null, unreadable = true, disk = ""))
    }
}
