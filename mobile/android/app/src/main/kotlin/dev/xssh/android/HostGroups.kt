package dev.xssh.android

/**
 * 主机分组 —— 规则和桌面版 `src/shared/hostGroups.ts` 一致,两边的数据能互通:
 *
 *  - 主机的分组是用户设的 [Host.group];没设、也没"决定过"([Host.groupLocked])、并且打开了按名称自动分组时,
 *    由名字推出来:"AI TOP ATOM 0"、"AI TOP ATOM 1" … 共用前缀 "AI TOP ATOM"。
 *    自动分出来的组不落盘,改名、加主机都只是重新算一遍。
 *  - 显示顺序:有名字的组按名称(自然顺序:0、1、2、10)排,没分组的永远在最后;
 *    组内保持传进来的顺序(首页已经按"置顶 → 最近使用"排过)。
 */

/** 分组名最长多少个字符(和桌面版一样)。 */
const val MAX_GROUP_LEN = 40

/** "AI TOP ATOM 3" → ("AI TOP ATOM", 3)。数字必须单独在末尾(前面是空格、短横或下划线)且至多三位,
 *  所以 "Ubuntu 26.04"、"Ubuntu 26.04 5090" 不会被当成编号系列。 */
internal fun splitSeries(label: String): Pair<String, Int>? {
    val m = SERIES.matchEntire(label.trim()) ?: return null
    val prefix = m.groupValues[1].trimEnd(' ', '\t', '_', '-').trim()
    if (prefix.isEmpty()) return null
    return prefix to m.groupValues[2].toInt()
}

private val SERIES = Regex("""^(.*\S)[\s_-]+(\d{1,3})$""")

/** 用户亲手设的分组(去空白);没设是空串。 */
private fun Host.ownGroup(): String = group.trim()

/**
 * 只靠名字成组的前缀(小写)→ 第一个成员的写法。至少两台共用才算;
 * 已经有自己分组、或用户决定过的主机不参与。
 */
internal fun autoGroupNames(hosts: List<Host>): Map<String, String> {
    val seen = LinkedHashMap<String, Pair<String, Int>>()
    for (h in hosts) {
        if (h.ownGroup().isNotEmpty() || h.groupLocked) continue
        val (prefix, _) = splitSeries(h.label) ?: continue
        val key = prefix.lowercase()
        val e = seen[key]
        seen[key] = if (e == null) prefix.take(MAX_GROUP_LEN) to 1 else e.first to e.second + 1
    }
    return seen.filterValues { it.second >= 2 }.mapValues { it.value.first }
}

/** 一台主机,和它显示在哪个组下("" = 没分组),以及是不是靠名字自动归过去的。 */
data class GroupedHost(val host: Host, val group: String, val auto: Boolean)

/** 每台主机显示在哪个组下。[autoOn] = 按名称自动分组。 */
fun effectiveGroups(hosts: List<Host>, autoOn: Boolean = true): List<GroupedHost> {
    val auto = if (autoOn) autoGroupNames(hosts) else emptyMap()
    return hosts.map { host ->
        val own = host.ownGroup()
        when {
            own.isNotEmpty() -> GroupedHost(host, own, auto = false)
            !host.groupLocked -> {
                val name = splitSeries(host.label)?.let { auto[it.first.lowercase()] }
                if (name != null) GroupedHost(host, name, auto = true) else GroupedHost(host, "", auto = false)
            }
            else -> GroupedHost(host, "", auto = false)
        }
    }
}

/** 列表里的一个分组。[name] 为空 = 没分组的那一堆;[auto] = 成员全是靠名字归进来的。 */
data class HostGroup(val name: String, val hosts: List<Host>, val auto: Boolean)

/**
 * 列表的分组:有名字的按名称排在前,没分组的在最后;组名不分大小写
 * ('AI TOP ATOM' 和 'ai top atom' 是一组,显示第一次出现的写法)。组内保持 [hosts] 的顺序。
 */
fun buildGroups(hosts: List<Host>, autoOn: Boolean = true): List<HostGroup> {
    class Acc(val name: String) {
        val members = ArrayList<Host>()
        var manual = false
    }
    val map = LinkedHashMap<String, Acc>()
    for (g in effectiveGroups(hosts, autoOn)) {
        val acc = map.getOrPut(g.group.lowercase()) { Acc(g.group) }
        acc.members.add(g.host)
        if (!g.auto) acc.manual = true
    }
    return map.values
        .sortedWith { a, b ->
            when {
                a.name.isEmpty() && b.name.isEmpty() -> 0
                a.name.isEmpty() -> 1
                b.name.isEmpty() -> -1
                else -> compareNatural(a.name, b.name)
            }
        }
        .map { HostGroup(it.name, it.members, auto = !it.manual && it.name.isNotEmpty()) }
}

/** 只有分组才需要标题:全是没分组的主机时整张列表和以前一模一样。 */
fun showGroupHeads(groups: List<HostGroup>): Boolean =
    groups.size > 1 || (groups.isNotEmpty() && groups[0].name.isNotEmpty())

/**
 * 屏幕上从上到下看得见的主机(分组顺序、折叠的组里的不算)。平板的键盘上下键、回车按这个走,
 * 和侧栏显示的顺序保持一致。
 */
fun displayedHosts(hosts: List<Host>, collapsed: Set<String>, autoOn: Boolean = true): List<Host> {
    val groups = buildGroups(hosts, autoOn)
    return buildHostEntries(groups, showGroupHeads(groups), collapsed)
        .filterIsInstance<HostEntry.Row>()
        .map { it.host }
}

/** 在用的分组名(给编辑页的候选),按名称排,不含没分组。 */
fun groupNames(hosts: List<Host>, autoOn: Boolean = true): List<String> =
    buildGroups(hosts, autoOn).map { it.name }.filter { it.isNotEmpty() }

/** 自然顺序,不分大小写:"DGX 2" 排在 "DGX 10" 前面。 */
internal fun compareNatural(a: String, b: String): Int {
    var i = 0
    var j = 0
    while (i < a.length && j < b.length) {
        val ca = a[i]
        val cb = b[j]
        if (ca.isDigit() && cb.isDigit()) {
            var ei = i
            while (ei < a.length && a[ei].isDigit()) ei++
            var ej = j
            while (ej < b.length && b[ej].isDigit()) ej++
            val na = a.substring(i, ei).trimStart('0')
            val nb = b.substring(j, ej).trimStart('0')
            if (na.length != nb.length) return na.length - nb.length
            val c = na.compareTo(nb)
            if (c != 0) return c
            i = ei
            j = ej
        } else {
            val c = ca.lowercaseChar().compareTo(cb.lowercaseChar())
            if (c != 0) return c
            i++
            j++
        }
    }
    return (a.length - i) - (b.length - j)
}

/** 列表里的一项:分组标题,或一台主机。手机首页和平板侧栏用同一份,折叠逻辑只写这一处。 */
sealed interface HostEntry {
    /** [key] 是折叠状态里记的名字(小写,没分组的是空串)。 */
    data class Head(val name: String, val count: Int, val collapsed: Boolean) : HostEntry {
        val key: String get() = name.lowercase()
    }

    /** [last] = 这是所在组的最后一台(下面不画分隔线)。 */
    data class Row(val host: Host, val last: Boolean) : HostEntry
}

/**
 * 把分组摊成一维的列表项。[heads] 为假(全是没分组的)时只有主机、没有标题;
 * [collapsed] 里的组只留标题,成员不出现。
 */
fun buildHostEntries(groups: List<HostGroup>, heads: Boolean, collapsed: Set<String>): List<HostEntry> =
    buildList {
        for (g in groups) {
            val shut = heads && g.name.lowercase() in collapsed
            if (heads) add(HostEntry.Head(g.name, g.hosts.size, shut))
            if (!shut) g.hosts.forEachIndexed { i, h -> add(HostEntry.Row(h, last = i == g.hosts.lastIndex)) }
        }
    }
