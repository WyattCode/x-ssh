package dev.xssh.android

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
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

    override fun onCreate() {
        super.onCreate()
        ensureChannel(this)
        // 必须先进前台再做别的:Android 要求 startForegroundService 之后尽快调用。
        startForeground(NOTIFICATION_ID, buildNotification(0))
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

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (intent?.action == ACTION_DISCONNECT_ALL) {
            SessionRegistry.closeAll()
        }
        return START_NOT_STICKY
    }

    override fun onDestroy() {
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
            .setContentTitle(if (count > 1) "$count 个 SSH 会话连接中" else "SSH 会话连接中")
            .setSmallIcon(R.drawable.ic_stat_session)
            .setContentIntent(open)
            .addAction(Notification.Action.Builder(null, "全部断开", disconnect).build())
            .setOngoing(true)
            .build()
    }

    companion object {
        private const val CHANNEL_ID = "xssh_sessions"
        private const val NOTIFICATION_ID = 1
        private const val ACTION_DISCONNECT_ALL = "dev.xssh.android.DISCONNECT_ALL"

        private fun ensureChannel(context: Context) {
            val manager = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
            if (manager.getNotificationChannel(CHANNEL_ID) != null) return
            manager.createNotificationChannel(
                NotificationChannel(CHANNEL_ID, "会话保持", NotificationManager.IMPORTANCE_LOW).apply {
                    description = "显示后台仍在连接的 SSH 会话"
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
