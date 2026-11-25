package dev.xssh.android

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** 分组规则和桌面版 `hostGroups.ts` 保持一致:这里的用例是那边规则的镜像。 */
class HostGroupsTest {

    private fun host(name: String, group: String = "", locked: Boolean = false) =
        Host(id = name, name = name, address = "10.0.0.1", group = group, groupLocked = locked)

    @Test
    fun `a number standing alone at the end makes a series`() {
        assertEquals("AI TOP ATOM" to 3, splitSeries("AI TOP ATOM 3"))
        assertEquals("node" to 12, splitSeries("node-12"))
        assertEquals("a b" to 7, splitSeries("a b_7"))
    }

    @Test
    fun `versions, long numbers and bare numbers are not series`() {
        assertNull(splitSeries("Ubuntu 26.04"))
        assertNull(splitSeries("Ubuntu 26.04.1"))
        assertNull(splitSeries("host 1234"))
        assertNull(splitSeries("42"))
        assertNull(splitSeries("plain"))
    }

    @Test
    fun `ubuntu with a trailing model number is the known quirk`() {
        // "Ubuntu 26.04 5090":末尾 4 位,不算。
        assertNull(splitSeries("Ubuntu 26.04 5090"))
    }

    @Test
    fun `a prefix shared by two hosts groups them, one host does not`() {
        val hosts = listOf(host("AI TOP ATOM 0"), host("AI TOP ATOM 1"), host("Rocky 10"))
        val g = effectiveGroups(hosts).associate { it.host.name to it }
        assertEquals("AI TOP ATOM", g.getValue("AI TOP ATOM 0").group)
        assertTrue(g.getValue("AI TOP ATOM 1").auto)
        assertEquals("", g.getValue("Rocky 10").group)
    }

    @Test
    fun `auto grouping off leaves names alone`() {
        val hosts = listOf(host("AI TOP ATOM 0"), host("AI TOP ATOM 1"))
        assertTrue(effectiveGroups(hosts, autoOn = false).all { it.group == "" })
    }

    @Test
    fun `a host the user placed keeps its group and does not count toward an auto group`() {
        val hosts = listOf(host("DGX Spark 0", group = "Lab"), host("DGX Spark 1"), host("DGX Spark 2", locked = true))
        val g = effectiveGroups(hosts).associate { it.host.name to it }
        assertEquals("Lab", g.getValue("DGX Spark 0").group)
        assertFalse(g.getValue("DGX Spark 0").auto)
        // 另两台里只有一台还能参与,凑不成组。
        assertEquals("", g.getValue("DGX Spark 1").group)
        assertEquals("", g.getValue("DGX Spark 2").group)
    }

    @Test
    fun `a locked host with no group stays out even when its name fits`() {
        val hosts = listOf(host("n 1"), host("n 2"), host("n 3", locked = true))
        val g = effectiveGroups(hosts).associate { it.host.name to it.group }
        assertEquals("n", g["n 1"])
        assertEquals("", g["n 3"])
    }

    @Test
    fun `groups are named first in natural order, ungrouped last, and members keep their order`() {
        val hosts = listOf(
            host("solo"),
            host("b 2", group = "Beta"),
            host("a 10", group = "alpha 10"),
            host("a 2", group = "alpha 2"),
            host("b 1", group = "beta"),
        )
        val groups = buildGroups(hosts)
        assertEquals(listOf("alpha 2", "alpha 10", "Beta", ""), groups.map { it.name })
        // 'Beta' 和 'beta' 是一组,显示第一次出现的写法,成员保持传入顺序。
        assertEquals(listOf("b 2", "b 1"), groups[2].hosts.map { it.name })
    }

    @Test
    fun `heads show only when there is something to tell apart`() {
        assertFalse(showGroupHeads(buildGroups(listOf(host("x"), host("y")))))
        assertTrue(showGroupHeads(buildGroups(listOf(host("x", group = "G")))))
        assertTrue(showGroupHeads(buildGroups(listOf(host("x", group = "G"), host("y")))))
        assertFalse(showGroupHeads(emptyList()))
    }

    @Test
    fun `auto flag is set only when every member got there by name`() {
        val groups = buildGroups(listOf(host("s 1"), host("s 2"), host("m 1", group = "s")))
        assertEquals(1, groups.filter { it.name.isNotEmpty() }.size)
        assertFalse(groups.first { it.name.isNotEmpty() }.auto)
        val onlyAuto = buildGroups(listOf(host("s 1"), host("s 2")))
        assertTrue(onlyAuto.first().auto)
    }

    @Test
    fun `group names for the editor skip the ungrouped pile`() {
        val names = groupNames(listOf(host("x"), host("a 1"), host("a 2"), host("y", group = "Zed")))
        assertEquals(listOf("a", "Zed"), names)
    }

    @Test
    fun `natural order compares digit runs as numbers and ignores case`() {
        assertTrue(compareNatural("DGX 2", "DGX 10") < 0)
        assertTrue(compareNatural("abc", "ABD") < 0)
        assertEquals(0, compareNatural("Same 3", "same 3"))
        assertTrue(compareNatural("a", "a1") < 0)
    }
}

class HostEntriesTest {
    private fun host(name: String, group: String = "") = Host(id = name, name = name, address = "10.0.0.1", group = group)

    @Test
    fun `without heads the list is just the hosts in order`() {
        val groups = buildGroups(listOf(host("a"), host("b")))
        val entries = buildHostEntries(groups, showGroupHeads(groups), emptySet())
        assertTrue(entries.all { it is HostEntry.Row })
        assertEquals(listOf("a", "b"), entries.map { (it as HostEntry.Row).host.name })
    }

    @Test
    fun `each group gets a head and the last member is marked`() {
        val groups = buildGroups(listOf(host("x", "G"), host("y", "G"), host("z")))
        val entries = buildHostEntries(groups, true, emptySet())
        assertEquals(
            listOf("head:G:2", "x", "y", "head::1", "z"),
            entries.map { if (it is HostEntry.Head) "head:${it.name}:${it.count}" else (it as HostEntry.Row).host.name },
        )
        val rows = entries.filterIsInstance<HostEntry.Row>()
        assertEquals(listOf(false, true, true), rows.map { it.last })
    }

    @Test
    fun `a collapsed group keeps its head and loses its members`() {
        val groups = buildGroups(listOf(host("x", "G"), host("y", "G"), host("z")))
        val entries = buildHostEntries(groups, true, setOf("g"))
        val head = entries.first() as HostEntry.Head
        assertTrue(head.collapsed)
        assertEquals(2, head.count)
        assertEquals(listOf("z"), entries.filterIsInstance<HostEntry.Row>().map { it.host.name })
    }

    @Test
    fun `keyboard order is the order on screen, and skips collapsed groups`() {
        // 传入顺序是 z、x、y;屏幕上 G 组(x、y)在前,没分组的 z 在后。
        val hosts = listOf(host("z"), host("x", "G"), host("y", "G"))
        assertEquals(listOf("x", "y", "z"), displayedHosts(hosts, emptySet()).map { it.name })
        assertEquals(listOf("z"), displayedHosts(hosts, setOf("g")).map { it.name })
        // 全是没分组的:不出标题,顺序就是传入顺序。
        assertEquals(listOf("b", "a"), displayedHosts(listOf(host("b"), host("a")), setOf("")).map { it.name })
    }

    @Test
    fun `group fields for save follow the three rules`() {
        assertEquals("Lab" to true, groupFieldsForSave("  Lab ", false))
        assertEquals("" to true, groupFieldsForSave("", true))
        assertEquals("" to false, groupFieldsForSave("   ", false))
        assertEquals("a".repeat(MAX_GROUP_LEN) to true, groupFieldsForSave("a".repeat(MAX_GROUP_LEN + 9), false))
    }
}
