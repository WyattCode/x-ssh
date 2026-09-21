package dev.xssh.android

import android.graphics.drawable.ColorDrawable
import android.graphics.Color
import android.content.res.Configuration
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.BackHandler
import androidx.activity.compose.setContent
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.platform.LocalContext

class MainActivity : ComponentActivity() {
    override fun onStart() {
        super.onStart()
        AppVisibility.foreground = true
    }

    override fun onStop() {
        AppVisibility.foreground = false
        super.onStop()
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        // 调试录制只在可调试的包里可用(还要有 files/record 标记文件才真的录)。
        if (applicationInfo.flags and android.content.pm.ApplicationInfo.FLAG_DEBUGGABLE != 0) {
            DebugRecorder.dir = filesDir
        }
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
        val prefs = UiPrefs(this)
        // 让系统也知道 app 选的是哪种外观。点开 app 的第一帧是**系统画的启动窗口**,
        // 那时这里的代码还没跑,系统只看夜间模式配置来挑 values / values-night 的底色 ——
        // 不告诉它,app 里选了深色而手机是浅色时,启动还是会先闪一下白。
        applyNightMode(this, prefs.themeMode)
        // 冷启动底色要和选中的外观一致:选了深色而系统是浅色时,
        // 资源里的 windowBackground 是白的,不在这里改就会先闪一下白。
        val systemDark = (resources.configuration.uiMode and Configuration.UI_MODE_NIGHT_MASK) ==
            Configuration.UI_MODE_NIGHT_YES
        val startDark = when (prefs.themeMode) {
            ThemeMode.Light -> false
            ThemeMode.Dark -> true
            ThemeMode.System -> systemDark
        }
        window.setBackgroundDrawable(ColorDrawable(if (startDark) Color.BLACK else Color.WHITE))

        setContent {
            var mode by remember { mutableStateOf(prefs.themeMode) }
            XsshTheme(mode) {
                // 每一帧的窗口形态(尺寸档 + 铰链)只算一次,所有界面从这里取。
                CompositionLocalProvider(
                    LocalAdaptive provides rememberAdaptive(),
                    LocalThemeControl provides ThemeControl(mode) {
                        mode = it
                        prefs.themeMode = it
                        applyNightMode(this, it)
                    },
                ) {
                    App(dev)
                }
            }
        }
    }
}

/**
 * 按 app 设置夜间模式(Android 12+,系统会记住)。之后系统画这个 app 的启动窗口时,
 * 就按这里的选择去挑浅色 / 深色的底色。跟随系统就交还给系统(AUTO)。
 */
private fun applyNightMode(context: android.content.Context, mode: ThemeMode) {
    if (android.os.Build.VERSION.SDK_INT < android.os.Build.VERSION_CODES.S) return
    val manager = context.getSystemService(android.app.UiModeManager::class.java) ?: return
    val target = when (mode) {
        ThemeMode.Light -> android.app.UiModeManager.MODE_NIGHT_NO
        ThemeMode.Dark -> android.app.UiModeManager.MODE_NIGHT_YES
        ThemeMode.System -> android.app.UiModeManager.MODE_NIGHT_AUTO
    }
    runCatching { manager.setApplicationNightMode(target) }
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
 * 应用壳:主机 → 终端 / 编辑器。布局形态由 [LocalAdaptive] 决定,各界面自己适配。
 */
@Composable
fun App(devTarget: DevTarget? = null) {
    val context = LocalContext.current
    val store = remember { HostStore(context) }
    var hosts by remember { mutableStateOf(store.load()) }

    // 正开着的是哪条会话 —— 这一项要活过 Activity 重建。
    //
    // `configChanges` 挡掉了折叠、旋转、改字号这些,但挡不掉全部(系统语言、
    // 分屏进出的某些路径都会重建)。重建之后 SSH 会话在 SessionRegistry 里还活着,
    // 丢的只是"我刚才在哪一屏" —— 表现就是正敲着命令突然被踢回主机列表。
    var termHostId by rememberSaveable { mutableStateOf<String?>(null) }
    var screen by remember {
        // 在**第一次组合时**就算出来,不要等副作用 —— 否则会先渲染一帧主机页再跳走。
        val restored = termHostId
            ?.takeIf { SessionRegistry[it] != null }
            ?.let { id -> hosts.firstOrNull { it.id == id } }
        mutableStateOf<Screen>(if (restored != null) Screen.Terminal(restored) else Screen.Home)
    }
    var selectedId by rememberSaveable { mutableStateOf<String?>(null) }

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
        termHostId = host.id
        screen = Screen.Terminal(host)
    }

    fun persist(list: List<Host>) {
        hosts = list
        store.save(list)
    }

    BackHandler(enabled = screen != Screen.Home) {
        // 返回只是离开这一屏,会话照跑(主机页会显示「运行中」)。
        termHostId = null
        screen = Screen.Home
    }

    when (val current = screen) {
        is Screen.Home -> HomeScreen(
            hosts = hosts,
            selectedId = selectedId,
            onSelect = { selectedId = it.id },
            onConnect = {
                termHostId = it.id
                screen = Screen.Terminal(it)
            },
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
            onExit = {
                termHostId = null
                screen = Screen.Home
            },
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
