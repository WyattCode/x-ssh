package dev.xssh.android

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.net.ConnectivityManager
import android.net.Network
import android.os.Build
import android.os.IBinder
import androidx.core.app.ServiceCompat
import androidx.core.content.ContextCompat
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.flow.collectLatest
import kotlinx.coroutines.launch

/**
 * 托住活着的会话的前台服务。
 *
 * 它本身不管 SSH —— 会话在 [SessionRegistry] 里。它存在的唯一理由是:让系统别冻结、
 * 别回收这个进程。没有它,切去看别的应用几分钟回来,连接就没了。
 * 常驻通知是这个交换条件的一部分,顺便也是「后台还连着几台机器」的唯一可见提示。
 */
class SessionService : Service() {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)

    override fun onBind(intent: Intent?): IBinder? = null

    /**
     * 默认网络换了(Wi-Fi 断了切到 5G、出了电梯、飞行模式关掉):告诉会话表,
     * 正在等下一次重连的会话别再干等倒计时,马上去试。
     *
     * 挂在前台服务上而不是界面上:最需要它的时候,恰恰是应用在后台、界面根本不在。
     * 服务只在有会话时活着,没有会话也就不必听。
     */
    private val networkWatch = object : ConnectivityManager.NetworkCallback() {
        override fun onAvailable(network: Network) {
            SessionRegistry.onNetworkAvailable()
        }
    }

    override fun onCreate() {
        super.onCreate()
        ensureChannel(this)
        // 必须先进前台再做别的:Android 要求 startForegroundService 之后尽快调用。
        startForeground(NOTIFICATION_ID, buildNotification(0))
        runCatching { getSystemService(ConnectivityManager::class.java)?.registerDefaultNetworkCallback(networkWatch) }
            .onFailure { android.util.Log.w(TAG, "network watch not registered: ${it.message}") }
        scope.launch {
            SessionRegistry.sessions.collectLatest { sessions ->
                if (sessions.isEmpty()) {
                    // 最后一条会话没了就退场,不留通知占着状态栏。
                    ServiceCompat.stopForeground(this@SessionService, ServiceCompat.STOP_FOREGROUND_REMOVE)
                    stopSelf()
                } else {
                    notificationManager().notify(NOTIFICATION_ID, buildNotification(sessions.size))
                }
            }
        }
    }

    /** 换了界面语言:常驻通知和通知类别名跟着换(界面不重建,通知不会自己刷新)。 */
    override fun onConfigurationChanged(newConfig: android.content.res.Configuration) {
        super.onConfigurationChanged(newConfig)
        ensureChannel(this)
        val count = SessionRegistry.sessions.value.size
        if (count > 0) notificationManager().notify(NOTIFICATION_ID, buildNotification(count))
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (intent?.action == ACTION_DISCONNECT_ALL) {
            SessionRegistry.closeAll()
        }
        return START_NOT_STICKY
    }

    override fun onDestroy() {
        runCatching { getSystemService(ConnectivityManager::class.java)?.unregisterNetworkCallback(networkWatch) }
        scope.cancel()
        super.onDestroy()
    }

    private fun notificationManager() =
        getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager

    private fun buildNotification(count: Int): Notification {
        val open = PendingIntent.getActivity(
            this,
            0,
            Intent(this, MainActivity::class.java),
            PendingIntent.FLAG_IMMUTABLE,
        )
        val disconnect = PendingIntent.getService(
            this,
            1,
            Intent(this, SessionService::class.java).setAction(ACTION_DISCONNECT_ALL),
            PendingIntent.FLAG_IMMUTABLE,
        )
        return Notification.Builder(this, CHANNEL_ID)
            .setContentTitle(
                if (count > 1) {
                    resources.getQuantityString(R.plurals.term_notify_title_many, count, count)
                } else {
                    getString(R.string.term_notify_title_one)
                },
            )
            .setSmallIcon(R.drawable.ic_stat_session)
            .setContentIntent(open)
            .addAction(Notification.Action.Builder(null, getString(R.string.term_notify_disconnect_all), disconnect).build())
            .setOngoing(true)
            .build()
    }

    companion object {
        private const val CHANNEL_ID = "xssh_sessions"
        private const val NOTIFICATION_ID = 1
        private const val ACTION_DISCONNECT_ALL = "dev.xssh.android.DISCONNECT_ALL"

        private fun ensureChannel(context: Context) {
            val manager = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
            // 已经有了也再建一次:同一个 id 重复创建只会更新名字和说明(重要程度不动),
            // 换了界面语言之后,系统设置里的通知类别名跟着变。
            manager.createNotificationChannel(
                NotificationChannel(CHANNEL_ID, context.getString(R.string.term_channel_name), NotificationManager.IMPORTANCE_LOW).apply {
                    description = context.getString(R.string.term_channel_desc)
                    setShowBadge(false)
                },
            )
        }

        /** 开了第一条会话就叫起服务;重复调用无害。 */
        fun ensureRunning(context: Context) {
            val app = context.applicationContext
            ensureChannel(app)
            ContextCompat.startForegroundService(app, Intent(app, SessionService::class.java))
        }

        /** Android 13 起不给通知权限就看不到常驻通知(服务本身照常跑)。 */
        val NOTIFICATION_PERMISSION: String?
            get() = if (Build.VERSION.SDK_INT >= 33) "android.permission.POST_NOTIFICATIONS" else null
    }
}
