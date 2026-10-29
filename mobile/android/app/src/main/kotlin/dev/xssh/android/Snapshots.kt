package dev.xssh.android

import android.content.Context
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.UUID
import org.json.JSONArray
import org.json.JSONObject

/* ─────────────────────────────── 会话快照 ───────────────────────────────

   对齐桌面版「命名会话快照」:记下当前工作区里有哪些主机、焦点在谁身上,
   之后一键回到那一台(其余条目仍在快照里,回家页再开)。

   移动端没有桌面那种多标签 / 分屏树 —— 这里只存 hostId + 显示名,不存密码 / 私钥。
   终端画面的 `Session.snapshot()` / `TerminalSession` 帧快照是另一回事,别混。
*/

/** 快照里的一台主机(只作引用;凭据仍在主机表里)。 */
data class SnapEntry(
    val hostId: String,
    /** 保存时的名字;主机改名 / 删除后列表仍能看懂。 */
    val label: String,
)

/** 一份命名工作区快照(对应桌面 `Snapshot`,tabs 收成 entries)。 */
data class SessionSnapshot(
    val id: String = UUID.randomUUID().toString(),
    val name: String,
    val savedAt: Long = System.currentTimeMillis(),
    val entries: List<SnapEntry>,
    val activeHostId: String? = null,
)

/** 默认名字:「快照 14:32:08」(前缀走文案,时刻本地)。 */
internal fun defaultSnapshotName(prefix: String, now: Long = System.currentTimeMillis()): String {
    val time = SimpleDateFormat("HH:mm:ss", Locale.getDefault()).format(Date(now))
    return "$prefix $time"
}

/**
 * 从当前活会话拍一份快照。没有活会话就返回 null(保存按钮应隐藏)。
 * [sessions] 已排好序(首页会话区同序即可);[activeHostId] 不在名单里就当 null。
 */
internal fun captureWorkspace(
    sessions: List<Pair<String, String>>,
    activeHostId: String?,
    name: String,
    now: Long = System.currentTimeMillis(),
): SessionSnapshot? {
    if (sessions.isEmpty()) return null
    val entries = sessions.map { (id, label) -> SnapEntry(hostId = id, label = label) }
    val active = activeHostId?.takeIf { id -> entries.any { it.hostId == id } }
    return SessionSnapshot(name = name, savedAt = now, entries = entries, activeHostId = active)
}

/**
 * 打开快照时丢掉已不在主机表里的条目;焦点优先原来的 active,否则第一个幸存者。
 * @return hostIds(仍存活、保序) to focusHostId(可能为 null = 全没了)
 */
internal fun resolveRestore(
    snap: SessionSnapshot,
    knownHostIds: Set<String>,
): Pair<List<String>, String?> {
    val survivors = snap.entries.map { it.hostId }.filter { it in knownHostIds }
    val focus = snap.activeHostId?.takeIf { it in survivors } ?: survivors.firstOrNull()
    return survivors to focus
}

/** 序列化(单测不需要 Context)。 */
internal fun encodeSnapshots(list: List<SessionSnapshot>): String {
    val array = JSONArray()
    list.forEach { s ->
        val entries = JSONArray()
        s.entries.forEach { e ->
            entries.put(JSONObject().put("hostId", e.hostId).put("label", e.label))
        }
        array.put(
            JSONObject()
                .put("id", s.id)
                .put("name", s.name)
                .put("savedAt", s.savedAt)
                .put("activeHostId", s.activeHostId ?: "")
                .put("entries", entries),
        )
    }
    return array.toString()
}

/** 反序列化;坏数据整表丢空,单条缺字段用默认。 */
internal fun decodeSnapshots(raw: String?): List<SessionSnapshot> {
    if (raw.isNullOrBlank()) return emptyList()
    return runCatching {
        val array = JSONArray(raw)
        (0 until array.length()).mapNotNull { index ->
            val item = array.optJSONObject(index) ?: return@mapNotNull null
            val entryArr = item.optJSONArray("entries") ?: JSONArray()
            val entries = (0 until entryArr.length()).mapNotNull { i ->
                val e = entryArr.optJSONObject(i) ?: return@mapNotNull null
                val hostId = e.optString("hostId")
                if (hostId.isEmpty()) return@mapNotNull null
                SnapEntry(hostId = hostId, label = e.optString("label"))
            }
            SessionSnapshot(
                id = item.optString("id").ifEmpty { UUID.randomUUID().toString() },
                name = item.optString("name").ifEmpty { "Snapshot" },
                savedAt = item.optLong("savedAt", 0L),
                entries = entries,
                activeHostId = item.optString("activeHostId").ifEmpty { null },
            )
        }
    }.getOrDefault(emptyList())
}

/** 快照存盘:SharedPreferences + JSON(不是秘密)。最多 [MAX] 条,新的在前。 */
class SnapshotStore(context: Context) {
    private val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

    fun load(): List<SessionSnapshot> = decodeSnapshots(prefs.getString(KEY_LIST, null))

    fun save(list: List<SessionSnapshot>) {
        prefs.edit().putString(KEY_LIST, encodeSnapshots(list.take(MAX))).apply()
    }

    /** 插入到最前并裁到 [MAX]。 */
    fun prepend(snap: SessionSnapshot): List<SessionSnapshot> {
        val next = (listOf(snap) + load().filterNot { it.id == snap.id }).take(MAX)
        save(next)
        return next
    }

    fun delete(id: String): List<SessionSnapshot> {
        val next = load().filterNot { it.id == id }
        save(next)
        return next
    }

    companion object {
        const val MAX = 30
        private const val PREFS = "xssh_snapshots"
        private const val KEY_LIST = "list"
    }
}

/**
 * 会话快照面板。手机贴底、平板居中(和片段同一套外壳)。
 *
 * - 活会话非空时顶上一行「保存当前」;
 * - 点一条 = 恢复(把焦点主机交出去连);🗑 = 删除。
 */
@Composable
fun SnapshotSheet(
    tablet: Boolean,
    /** 当前活会话 (hostId to label),已排好序。 */
    liveEntries: List<Pair<String, String>>,
    activeHostId: String?,
    knownHostIds: Set<String>,
    onRestore: (hostIds: List<String>, focusHostId: String) -> Unit,
    onDismiss: () -> Unit,
) {
    val p = LocalXssh.current
    val context = LocalContext.current
    val store = remember(context) { SnapshotStore(context) }
    var all by remember { mutableStateOf(store.load()) }
    var confirmingDelete by remember { mutableStateOf<SessionSnapshot?>(null) }
    val canSave = liveEntries.isNotEmpty()
    val defaultPrefix = stringResource(R.string.snap_default)

    SheetFrame(
        title = stringResource(R.string.snap_title),
        tablet = tablet,
        onDismiss = onDismiss,
        trailing = if (canSave) {
            {
                Text(
                    stringResource(R.string.snap_save),
                    color = p.accent,
                    fontSize = 16.sp,
                    fontWeight = FontWeight.SemiBold,
                    modifier = Modifier
                        .clip(RoundedCornerShape(8.dp))
                        .clickable {
                            val name = defaultSnapshotName(defaultPrefix)
                            val snap = captureWorkspace(liveEntries, activeHostId, name) ?: return@clickable
                            all = store.prepend(snap)
                        }
                        .padding(horizontal = 10.dp, vertical = 8.dp),
                )
            }
        } else {
            null
        },
    ) {
        if (all.isEmpty()) {
            Text(
                stringResource(R.string.snap_empty),
                color = p.textDim,
                fontSize = 14.sp,
                modifier = Modifier.padding(horizontal = 20.dp, vertical = 18.dp),
            )
        } else {
            all.forEach { snap ->
                val (survivors, focus) = resolveRestore(snap, knownHostIds)
                val missing = snap.entries.size - survivors.size
                val whenText = SimpleDateFormat("yyyy-MM-dd HH:mm", Locale.getDefault()).format(Date(snap.savedAt))
                val sub = buildString {
                    append(stringResource(R.string.snap_hosts_n, snap.entries.size))
                    if (missing > 0) {
                        append(" · ")
                        append(stringResource(R.string.snap_missing_n, missing))
                    }
                    append(" · ")
                    append(whenText)
                }
                Row(
                    Modifier
                        .fillMaxWidth()
                        .heightIn(min = 56.dp)
                        .clickable(enabled = focus != null) {
                            if (focus != null) {
                                onRestore(survivors, focus)
                                onDismiss()
                            }
                        }
                        .padding(horizontal = 16.dp, vertical = 10.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Column(Modifier.weight(1f)) {
                        Text(
                            snap.name,
                            color = if (focus != null) p.text else p.textFaint,
                            fontSize = 16.sp,
                            fontWeight = FontWeight.Medium,
                            maxLines = 1,
                            overflow = TextOverflow.Ellipsis,
                        )
                        Spacer(Modifier.height(2.dp))
                        Text(sub, color = p.textDim, fontSize = 12.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
                    }
                    Icon(
                        XIcons.Trash,
                        contentDescription = stringResource(R.string.snap_delete),
                        tint = p.textDim,
                        modifier = Modifier
                            .size(36.dp)
                            .clip(RoundedCornerShape(10.dp))
                            .clickable { confirmingDelete = snap }
                            .padding(8.dp),
                    )
                }
            }
        }
    }

    confirmingDelete?.let { target ->
        SheetFrame(
            title = stringResource(R.string.snap_delete_confirm),
            tablet = tablet,
            onDismiss = { confirmingDelete = null },
            trailing = {
                Text(
                    stringResource(R.string.snap_delete),
                    color = p.danger,
                    fontSize = 16.sp,
                    fontWeight = FontWeight.SemiBold,
                    modifier = Modifier
                        .clip(RoundedCornerShape(8.dp))
                        .clickable {
                            all = store.delete(target.id)
                            confirmingDelete = null
                        }
                        .padding(horizontal = 10.dp, vertical = 8.dp),
                )
            },
        ) {
            Text(
                target.name,
                color = p.text,
                fontSize = 15.sp,
                modifier = Modifier.padding(horizontal = 20.dp, vertical = 16.dp),
            )
        }
    }
}
