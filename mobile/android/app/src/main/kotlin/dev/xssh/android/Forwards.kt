package dev.xssh.android

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject
import uniffi.xssh_ffi.ForwardInfo as FfiForwardInfo
import uniffi.xssh_ffi.ForwardMode as FfiForwardMode
import uniffi.xssh_ffi.ForwardSpec as FfiForwardSpec
import uniffi.xssh_ffi.Session

/** 和桌面版 / 核心一致的三种转发。 */
enum class ForwardMode {
    LOCAL, REMOTE, DYNAMIC;

    val wire: String
        get() = when (this) {
            LOCAL -> "local"
            REMOTE -> "remote"
            DYNAMIC -> "dynamic"
        }

    companion object {
        fun fromWire(value: String?): ForwardMode = when (value?.lowercase()) {
            "remote" -> REMOTE
            "dynamic" -> DYNAMIC
            else -> LOCAL
        }
    }
}

/** 一条保存在主机上的转发规则(连接时自动开)。 */
data class HostForward(
    val mode: ForwardMode = ForwardMode.LOCAL,
    val localPort: Int = 0,
    val remoteHost: String = "",
    val remotePort: Int = 0,
)

/** 同一连接内判重 / 列表用的键(和桌面版 `forwardKey` 一致)。 */
fun forwardKey(rule: HostForward): String = "${rule.mode.wire}:${rule.localPort}"

fun forwardKey(mode: ForwardMode, localPort: Int): String = "${mode.wire}:$localPort"

/** 给用户看的一行:`8080 → 127.0.0.1:5432` / `SOCKS 127.0.0.1:1080`。 */
fun ruleLabel(rule: HostForward): String {
    val host = rule.remoteHost.trim().ifEmpty { "127.0.0.1" }
    return when (rule.mode) {
        ForwardMode.DYNAMIC -> "127.0.0.1:${rule.localPort}"
        ForwardMode.LOCAL -> "${rule.localPort} → $host:${rule.remotePort}"
        ForwardMode.REMOTE -> "server:${rule.localPort} → $host:${rule.remotePort}"
    }
}

sealed class ForwardValidation {
    data object Ok : ForwardValidation()
    data object BadPort : ForwardValidation()
    data object Duplicate : ForwardValidation()
}

/** 校验一条规则。[existing] 用来查重(编辑时要把自己那条排除在外)。 */
fun validateForward(rule: HostForward, existing: List<HostForward> = emptyList()): ForwardValidation {
    if (rule.localPort !in 1..65535) return ForwardValidation.BadPort
    when (rule.mode) {
        ForwardMode.LOCAL, ForwardMode.REMOTE -> if (rule.remotePort !in 1..65535) return ForwardValidation.BadPort
        ForwardMode.DYNAMIC -> Unit
    }
    val key = forwardKey(rule)
    if (existing.any { forwardKey(it) == key }) return ForwardValidation.Duplicate
    return ForwardValidation.Ok
}

fun HostForward.toFfi(): FfiForwardSpec = FfiForwardSpec(
    mode = when (mode) {
        ForwardMode.LOCAL -> FfiForwardMode.LOCAL
        ForwardMode.REMOTE -> FfiForwardMode.REMOTE
        ForwardMode.DYNAMIC -> FfiForwardMode.DYNAMIC
    },
    localPort = localPort.toUShort(),
    remoteHost = remoteHost,
    remotePort = remotePort.toUShort(),
)

fun FfiForwardInfo.toHostForward(): HostForward = HostForward(
    mode = when (mode) {
        FfiForwardMode.LOCAL -> ForwardMode.LOCAL
        FfiForwardMode.REMOTE -> ForwardMode.REMOTE
        FfiForwardMode.DYNAMIC -> ForwardMode.DYNAMIC
    },
    localPort = localPort.toInt(),
    remoteHost = remoteHost,
    remotePort = remotePort.toInt(),
)

/** 从主机 JSON 读出规则列表;坏掉的条目丢掉。 */
fun parsePortForwards(array: JSONArray?): List<HostForward> {
    if (array == null) return emptyList()
    val out = ArrayList<HostForward>(array.length())
    for (i in 0 until array.length()) {
        val item = array.optJSONObject(i) ?: continue
        val local = item.optInt("localPort", 0)
        if (local !in 1..65535) continue
        val mode = ForwardMode.fromWire(item.optString("mode"))
        val remotePort = item.optInt("remotePort", 0)
        if (mode != ForwardMode.DYNAMIC && remotePort !in 1..65535) continue
        out += HostForward(
            mode = mode,
            localPort = local,
            remoteHost = item.optString("remoteHost"),
            remotePort = if (mode == ForwardMode.DYNAMIC) 0 else remotePort,
        )
    }
    return out
}

fun encodePortForwards(rules: List<HostForward>): JSONArray {
    val array = JSONArray()
    for (rule in rules) {
        array.put(
            JSONObject()
                .put("mode", rule.mode.wire)
                .put("localPort", rule.localPort)
                .put("remoteHost", rule.remoteHost)
                .put("remotePort", rule.remotePort),
        )
    }
    return array
}

/**
 * 连接成功后按主机上保存的规则逐条开转发。单条失败不打断其余、也不伤 shell。
 * 返回失败条数(给界面 toast)。
 */
fun applySavedForwards(session: Session, host: Host): Int {
    var failed = 0
    for (rule in host.portForwards) {
        val result = runCatching { session.addForward(rule.toFfi()) }
        if (result.isFailure) failed++
    }
    return failed
}

/** 把核心报错文本换成资源能认的标签(前缀匹配,和跳板机那套一样)。 */
fun forwardErrorKind(message: String?): String = when {
    message == null -> "unknown"
    message.contains("port in use", ignoreCase = true) -> "in_use"
    message.contains("already forwarding", ignoreCase = true) -> "already"
    message.contains("bad port", ignoreCase = true) -> "bad_port"
    message.contains("denied", ignoreCase = true) -> "denied"
    message.contains("not found", ignoreCase = true) -> "not_found"
    else -> "unknown"
}

/* ----------------------------- UI: editor list ----------------------------- */

/**
 * 主机编辑页「端口转发」一行:点开管理保存在主机上的规则。
 */
@Composable
fun ForwardField(rules: List<HostForward>, onChange: (List<HostForward>) -> Unit) {
    val p = LocalXssh.current
    var open by remember { mutableStateOf(false) }
    FormGroup {
        Row(
            Modifier
                .fillMaxWidth()
                .heightIn(min = 52.dp)
                .clickable { open = true }
                .padding(horizontal = BoxPad),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text(stringResource(R.string.fwd_title), color = p.text, fontSize = 16.sp)
            Spacer(Modifier.weight(1f))
            Text(
                if (rules.isEmpty()) stringResource(R.string.fwd_none_saved)
                else stringResource(R.string.fwd_summary, rules.size),
                color = p.textDim,
                fontSize = 15.sp,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
            Spacer(Modifier.width(6.dp))
            Icon(XIcons.Chevron, contentDescription = null, tint = p.textFaint, modifier = Modifier.size(18.dp))
        }
    }
    if (open) {
        ForwardEditorSheet(
            rules = rules,
            onChange = onChange,
            onDismiss = { open = false },
        )
    }
}

@Composable
private fun ForwardEditorSheet(
    rules: List<HostForward>,
    onChange: (List<HostForward>) -> Unit,
    onDismiss: () -> Unit,
) {
    val p = LocalXssh.current
    var editing by remember { mutableStateOf<HostForward?>(null) }
    var editingIndex by remember { mutableStateOf(-1) }
    SheetFrame(
        title = stringResource(R.string.fwd_saved_title),
        tablet = LocalChrome.current == Chrome.Tablet,
        onDismiss = onDismiss,
        trailing = {
            Box(
                Modifier.size(44.dp).clip(RoundedCornerShape(22.dp)).clickable {
                    editing = HostForward()
                    editingIndex = -1
                },
                contentAlignment = Alignment.Center,
            ) {
                Icon(XIcons.Plus, contentDescription = stringResource(R.string.fwd_add), tint = p.accent)
            }
        },
    ) {
        if (rules.isEmpty()) {
            Text(
                stringResource(R.string.fwd_empty),
                color = p.textDim,
                fontSize = 14.sp,
                modifier = Modifier.padding(horizontal = 20.dp, vertical = 16.dp),
            )
        }
        rules.forEachIndexed { index, rule ->
            Row(
                Modifier
                    .fillMaxWidth()
                    .clickable {
                        editing = rule
                        editingIndex = index
                    }
                    .padding(horizontal = 20.dp, vertical = 12.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Column(Modifier.weight(1f)) {
                    Text(modeLabel(rule.mode), color = p.accent, fontSize = 12.sp, fontWeight = FontWeight.Medium)
                    Text(ruleLabel(rule), color = p.text, fontSize = 15.sp, fontFamily = XsshFonts.monoUi)
                }
                Box(
                    Modifier.size(40.dp).clip(RoundedCornerShape(20.dp)).clickable {
                        onChange(rules.filterIndexed { i, _ -> i != index })
                    },
                    contentAlignment = Alignment.Center,
                ) {
                    Icon(XIcons.Close, contentDescription = stringResource(R.string.fwd_delete), tint = p.danger, modifier = Modifier.size(16.dp))
                }
            }
        }
    }
    editing?.let { draft ->
        ForwardRuleForm(
            initial = draft,
            existing = rules.filterIndexed { i, _ -> i != editingIndex },
            onSave = { saved ->
                onChange(
                    if (editingIndex >= 0) rules.toMutableList().also { it[editingIndex] = saved }
                    else rules + saved,
                )
                editing = null
            },
            onDismiss = { editing = null },
        )
    }
}

@Composable
private fun modeLabel(mode: ForwardMode): String = stringResource(
    when (mode) {
        ForwardMode.LOCAL -> R.string.fwd_mode_local
        ForwardMode.REMOTE -> R.string.fwd_mode_remote
        ForwardMode.DYNAMIC -> R.string.fwd_mode_dynamic
    },
)

@Composable
private fun ForwardRuleForm(
    initial: HostForward,
    existing: List<HostForward>,
    onSave: (HostForward) -> Unit,
    onDismiss: () -> Unit,
) {
    val p = LocalXssh.current
    var mode by remember { mutableStateOf(initial.mode) }
    var localPort by remember { mutableStateOf(if (initial.localPort == 0) "" else initial.localPort.toString()) }
    var remoteHost by remember { mutableStateOf(initial.remoteHost) }
    var remotePort by remember { mutableStateOf(if (initial.remotePort == 0) "" else initial.remotePort.toString()) }
    var error by remember { mutableStateOf<Int?>(null) }
    SheetFrame(
        title = stringResource(if (initial.localPort == 0) R.string.fwd_add else R.string.fwd_edit),
        tablet = LocalChrome.current == Chrome.Tablet,
        onDismiss = onDismiss,
        trailing = {
            Box(
                Modifier.size(44.dp).clip(RoundedCornerShape(22.dp)).clickable {
                    val rule = HostForward(
                        mode = mode,
                        localPort = localPort.toIntOrNull() ?: 0,
                        remoteHost = remoteHost.trim(),
                        remotePort = if (mode == ForwardMode.DYNAMIC) 0 else remotePort.toIntOrNull() ?: 0,
                    )
                    when (validateForward(rule, existing)) {
                        ForwardValidation.Ok -> onSave(rule)
                        ForwardValidation.BadPort -> error = R.string.fwd_err_bad_port
                        ForwardValidation.Duplicate -> error = R.string.fwd_err_already
                    }
                },
                contentAlignment = Alignment.Center,
            ) {
                Icon(XIcons.Check, contentDescription = stringResource(R.string.fwd_add), tint = p.accent)
            }
        },
    ) {
        Row(
            Modifier.padding(horizontal = 16.dp, vertical = 8.dp),
            horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            ForwardMode.entries.forEach { m ->
                val on = mode == m
                Text(
                    modeLabel(m),
                    color = if (on) p.accent else p.textDim,
                    fontSize = 13.sp,
                    fontWeight = if (on) FontWeight.SemiBold else FontWeight.Normal,
                    modifier = Modifier
                        .clip(RoundedCornerShape(14.dp))
                        .background(if (on) p.accent.copy(alpha = 0.15f) else p.bgElev)
                        .border(0.5.dp, if (on) p.accent else p.border, RoundedCornerShape(14.dp))
                        .clickable { mode = m; error = null }
                        .padding(horizontal = 12.dp, vertical = 8.dp),
                )
            }
        }
        Text(
            stringResource(
                when (mode) {
                    ForwardMode.LOCAL -> R.string.fwd_hint_local
                    ForwardMode.REMOTE -> R.string.fwd_hint_remote
                    ForwardMode.DYNAMIC -> R.string.fwd_hint_dynamic
                },
            ),
            color = p.textDim,
            fontSize = 13.sp,
            modifier = Modifier.padding(horizontal = 20.dp, vertical = 4.dp),
        )
        FormGroup {
            FormField(
                stringResource(R.string.fwd_local_port),
                localPort,
                { localPort = it.filter(Char::isDigit).take(5); error = null },
                placeholder = if (mode == ForwardMode.DYNAMIC) "1080" else "8080",
                mono = true,
                keyboard = KeyboardType.Number,
                asciiOnly = true,
            )
            if (mode != ForwardMode.DYNAMIC) {
                FormDivider()
                FormField(
                    stringResource(R.string.fwd_remote_host),
                    remoteHost,
                    { remoteHost = it; error = null },
                    placeholder = "127.0.0.1",
                    mono = true,
                    keyboard = KeyboardType.Uri,
                    asciiOnly = true,
                )
                FormDivider()
                FormField(
                    stringResource(R.string.fwd_remote_port),
                    remotePort,
                    { remotePort = it.filter(Char::isDigit).take(5); error = null },
                    placeholder = "5432",
                    mono = true,
                    keyboard = KeyboardType.Number,
                    asciiOnly = true,
                )
            }
        }
        error?.let {
            Text(
                stringResource(it),
                color = p.danger,
                fontSize = 13.sp,
                modifier = Modifier.padding(horizontal = 20.dp, vertical = 8.dp),
            )
        }
    }
}

/* ----------------------------- UI: live sheet ----------------------------- */

/**
 * 终端里的端口转发面板:看这条连接上开着的规则,可临时加一条、可拆掉。
 */
@Composable
@Suppress("UNUSED_PARAMETER")
fun ForwardSheet(
    host: Host,
    session: Session,
    tablet: Boolean,
    onHostChange: (Host) -> Unit,
    onDismiss: () -> Unit,
) {
    val p = LocalXssh.current
    val scope = rememberCoroutineScope()
    var live by remember { mutableStateOf(session.forwards().map { it.toHostForward() to it.id }) }
    var adding by remember { mutableStateOf(false) }
    var busy by remember { mutableStateOf(false) }
    var toast by remember { mutableStateOf<String?>(null) }
    fun refresh() {
        live = session.forwards().map { it.toHostForward() to it.id }
    }
    SheetFrame(
        title = stringResource(R.string.fwd_live_title),
        tablet = tablet,
        onDismiss = onDismiss,
        trailing = {
            Box(
                Modifier.size(44.dp).clip(RoundedCornerShape(22.dp)).clickable(enabled = !busy) { adding = true },
                contentAlignment = Alignment.Center,
            ) {
                Icon(XIcons.Plus, contentDescription = stringResource(R.string.fwd_add_live), tint = p.accent)
            }
        },
    ) {
        if (host.portForwards.isNotEmpty()) {
            Text(
                stringResource(R.string.fwd_saved_title),
                color = p.textDim,
                fontSize = 12.sp,
                fontWeight = FontWeight.Medium,
                modifier = Modifier.padding(horizontal = 20.dp, vertical = 6.dp),
            )
            host.portForwards.forEach { rule ->
                val running = live.any { forwardKey(it.first) == forwardKey(rule) }
                ForwardLiveRow(
                    rule = rule,
                    running = running,
                    temporary = false,
                    onRemove = null,
                )
            }
        }
        Text(
            stringResource(R.string.fwd_live_title),
            color = p.textDim,
            fontSize = 12.sp,
            fontWeight = FontWeight.Medium,
            modifier = Modifier.padding(horizontal = 20.dp, vertical = 6.dp),
        )
        if (live.isEmpty()) {
            Text(
                stringResource(R.string.fwd_empty_live),
                color = p.textDim,
                fontSize = 14.sp,
                modifier = Modifier.padding(horizontal = 20.dp, vertical = 12.dp),
            )
        }
        live.forEach { (rule, id) ->
            val saved = host.portForwards.any { forwardKey(it) == forwardKey(rule) }
            ForwardLiveRow(
                rule = rule,
                running = true,
                temporary = !saved,
                onRemove = {
                    if (busy) return@ForwardLiveRow
                    busy = true
                    scope.launch {
                        val err = withContext(Dispatchers.IO) {
                            runCatching { session.removeForward(id) }.exceptionOrNull()
                        }
                        if (err == null) refresh()
                        else toast = err.message
                        busy = false
                    }
                },
            )
        }
        toast?.let {
            Text(it, color = p.danger, fontSize = 13.sp, modifier = Modifier.padding(20.dp))
        }
    }
    if (adding) {
        ForwardRuleForm(
            initial = HostForward(),
            existing = live.map { it.first },
            onSave = { rule ->
                adding = false
                busy = true
                scope.launch {
                    val result = withContext(Dispatchers.IO) {
                        runCatching { session.addForward(rule.toFfi()) }
                    }
                    result.onSuccess {
                        refresh()
                        // 临时规则不写入主机;用户要持久化去编辑页。
                    }.onFailure { toast = it.message }
                    busy = false
                }
            },
            onDismiss = { adding = false },
        )
    }
}

@Composable
private fun ForwardLiveRow(
    rule: HostForward,
    running: Boolean,
    temporary: Boolean,
    onRemove: (() -> Unit)?,
) {
    val p = LocalXssh.current
    Row(
        Modifier.fillMaxWidth().padding(horizontal = 20.dp, vertical = 10.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Column(Modifier.weight(1f)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(modeLabel(rule.mode), color = p.accent, fontSize = 12.sp)
                if (temporary) {
                    Spacer(Modifier.width(8.dp))
                    Text(stringResource(R.string.fwd_tag_temp), color = p.warn, fontSize = 11.sp)
                }
                Spacer(Modifier.width(8.dp))
                Text(
                    stringResource(if (running) R.string.fwd_status_on else R.string.fwd_status_failed),
                    color = if (running) p.ok else p.danger,
                    fontSize = 11.sp,
                )
            }
            Text(ruleLabel(rule), color = p.text, fontSize = 15.sp, fontFamily = XsshFonts.monoUi)
        }
        if (onRemove != null) {
            Box(
                Modifier.size(40.dp).clip(RoundedCornerShape(20.dp)).clickable { onRemove() },
                contentAlignment = Alignment.Center,
            ) {
                Icon(XIcons.Close, contentDescription = stringResource(R.string.fwd_remove_live), tint = p.textDim, modifier = Modifier.size(16.dp))
            }
        }
    }
}
