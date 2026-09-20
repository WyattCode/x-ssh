package dev.xssh.android

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.BackHandler
import androidx.activity.compose.setContent
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.LocalContext

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        // 开发用:adb start 带 --es devAutoConnect <地址> [--es devUser u] [--es devPassword p]
        // 可直接进入终端联调/自动化;正式版本不带这些 extra 时行为不变。
        val dev = intent?.getStringExtra("devAutoConnect")?.takeIf { it.isNotBlank() }?.let { address ->
            // 端口用 --ei devPort 或 --es devPort;私钥用 --es devKeyPath 指向 App 私有目录里的文件。
            val port = intent.getIntExtra("devPort", 0).takeIf { it > 0 }
                ?: intent.getStringExtra("devPort")?.toIntOrNull()
                ?: 22
            DevTarget(
                address = address,
                user = intent.getStringExtra("devUser"),
                password = intent.getStringExtra("devPassword"),
                port = port,
                keyPath = intent.getStringExtra("devKeyPath"),
            )
        }
        setContent {
            XsshTheme {
                App(dev)
            }
        }
    }
}

/** 开发联调用目标(仅来自 adb intent extra,不落盘)。 */
data class DevTarget(
    val address: String,
    val user: String?,
    val password: String?,
    val port: Int = 22,
    val keyPath: String? = null,
)

sealed interface Screen {
    data object Home : Screen
    data class Editor(val host: Host?) : Screen
    data class Terminal(val host: Host) : Screen
}

/**
 * 应用壳:主机 → 终端 / 编辑器。
 * [expanded](内屏展开,≥600dp)时主机页为左右两栏,分界线对齐折痕。
 */
@Composable
fun App(devTarget: DevTarget? = null) {
    val context = LocalContext.current
    val store = remember { HostStore(context) }
    var hosts by remember { mutableStateOf(store.load()) }
    var screen by remember { mutableStateOf<Screen>(Screen.Home) }
    var selectedId by remember { mutableStateOf<String?>(null) }
    val expanded = LocalConfiguration.current.screenWidthDp >= 600

    LaunchedEffect(Unit) {
        val target = devTarget ?: return@LaunchedEffect
        val existing = hosts.firstOrNull {
            (it.address == target.address || it.label == target.address) && it.port == target.port
        }
        val host = existing ?: Host(
            name = target.address,
            address = target.address,
            port = target.port,
            username = target.user.orEmpty(),
            auth = if (target.password != null) AuthKind.PASSWORD else AuthKind.KEY,
            keyPath = target.keyPath ?: context.filesDir.resolve("xssh_dev_key").absolutePath,
            password = target.password.orEmpty(),
        )
        selectedId = host.id
        screen = Screen.Terminal(host)
    }

    fun persist(list: List<Host>) {
        hosts = list
        store.save(list)
    }

    BackHandler(enabled = screen != Screen.Home) {
        screen = Screen.Home
    }

    when (val current = screen) {
        is Screen.Home -> HomeScreen(
            hosts = hosts,
            selectedId = selectedId,
            expanded = expanded,
            onSelect = { selectedId = it.id },
            onConnect = { screen = Screen.Terminal(it) },
            onNew = { screen = Screen.Editor(null) },
            onEdit = { screen = Screen.Editor(it) },
            onDelete = { host ->
                persist(hosts.filterNot { it.id == host.id })
                if (selectedId == host.id) selectedId = null
            },
        )

        is Screen.Editor -> HostEditorScreen(
            initial = current.host,
            onBack = { screen = Screen.Home },
            onSave = { host ->
                val list = hosts.toMutableList()
                val index = list.indexOfFirst { it.id == host.id }
                if (index >= 0) list[index] = host else list.add(host)
                persist(list)
                selectedId = host.id
                screen = Screen.Home
            },
            onDelete = { host ->
                persist(hosts.filterNot { it.id == host.id })
                if (selectedId == host.id) selectedId = null
                screen = Screen.Home
            },
        )

        is Screen.Terminal -> TerminalScreen(
            host = current.host,
            onExit = { screen = Screen.Home },
            onTrustKey = { fingerprint ->
                // 换一个 Host 实例 → 终端屏的 remember(host) 失效 → 带着新指纹重连。
                val trusted = current.host.copy(keyFingerprint = fingerprint)
                if (hosts.any { it.id == trusted.id }) {
                    persist(hosts.map { if (it.id == trusted.id) it.copy(keyFingerprint = fingerprint) else it })
                }
                screen = Screen.Terminal(trusted)
            },
        )
    }
}
