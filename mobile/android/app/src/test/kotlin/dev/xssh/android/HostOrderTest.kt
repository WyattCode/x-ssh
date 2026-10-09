package dev.xssh.android

import org.junit.Assert.assertEquals
import org.junit.Test

/**
 * 首页显示顺序:置顶 → 最近使用 → 添加顺序。
 *
 * 排序是纯函数,列表(手机 / 折叠屏 / 平板侧栏)都从这一处取值 ——
 * 判据只有一条:**用户最可能点的排最前**。
 */
class HostOrderTest {

    private fun host(id: String, pinned: Boolean = false, lastUsed: Long = 0) =
        Host(id = id, name = id, address = "10.0.0.1", pinned = pinned, lastUsed = lastUsed)

    @Test
    fun `pinned hosts come first regardless of recency`() {
        val ordered = orderHosts(listOf(host("a", lastUsed = 100), host("p", pinned = true)))
        assertEquals(listOf("p", "a"), ordered.map { it.id })
    }

    @Test
    fun `among pinned, most recently used first`() {
        val ordered = orderHosts(
            listOf(host("old", pinned = true, lastUsed = 5), host("new", pinned = true, lastUsed = 9)),
        )
        assertEquals(listOf("new", "old"), ordered.map { it.id })
    }

    @Test
    fun `unpinned sort by last used, newest first`() {
        val ordered = orderHosts(listOf(host("b", lastUsed = 2), host("c", lastUsed = 7), host("a", lastUsed = 3)))
        assertEquals(listOf("c", "a", "b"), ordered.map { it.id })
    }

    @Test
    fun `never-used hosts keep the order they were added in`() {
        // 老数据没有 lastUsed / pinned 两个字段(加载出来都是默认值)—— 升级前后列表一模一样。
        val ordered = orderHosts(listOf(host("x"), host("y"), host("z")))
        assertEquals(listOf("x", "y", "z"), ordered.map { it.id })
    }

    @Test
    fun `the whole order together`() {
        val ordered = orderHosts(
            listOf(
                host("plain1"),
                host("recent", lastUsed = 50),
                host("pin-old", pinned = true),
                host("plain2"),
                host("pin-new", pinned = true, lastUsed = 99),
                host("older", lastUsed = 40),
            ),
        )
        assertEquals(listOf("pin-new", "pin-old", "recent", "older", "plain1", "plain2"), ordered.map { it.id })
    }
}
