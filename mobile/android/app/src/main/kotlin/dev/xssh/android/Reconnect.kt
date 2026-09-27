package dev.xssh.android

import uniffi.xssh_ffi.FfiException
import uniffi.xssh_ffi.ServerEvent

/**
 * 断线自动重连的规则。和界面、Rust 对象都无关,单独放一处好测。
 *
 * 手机上的 SSH 最常见的"坏掉"不是服务器出事,而是**网络换了**:Wi-Fi 换 5G、进电梯、
 * 锁屏后被系统限制联网。连接是好的、账号是对的,只是那条 TCP 死了 —— 重新连一次就行。
 * 所以掉线之后先自己连回去,别让用户退回列表再点一次。
 */
object ReconnectPolicy {
    /** 最多试几次。按 [delayMillis] 的间隔加起来大约五分钟,够走出电梯、等地铁出隧道。 */
    const val MAX_ATTEMPTS = 12

    /** 第 [attempt] 次(从 1 起)之前等多久:1、2、4、8、16 秒,之后每次 30 秒。 */
    fun delayMillis(attempt: Int): Long {
        require(attempt >= 1) { "attempt starts at 1" }
        val seconds = if (attempt <= 5) 1L shl (attempt - 1) else 30L
        return seconds * 1000
    }

    /**
     * 这次失败再试也没用吗。
     *
     * - 主机密钥不认识 / 变了:那是**安全问题**,自动重连绝不能绕过它,必须停下来让人看。
     * - 私钥口令不对、认证失败:凭据错了,再试一百次也一样,还可能触发服务器封禁。
     * - 其余(连不上、超时、DNS、握手中断)都当成网络问题,值得再试。
     */
    fun isPermanent(error: Throwable): Boolean = when (error) {
        is FfiException.HostKeyUnknown,
        is FfiException.HostKeyChanged,
        is FfiException.JumpHostKeyUnknown,
        is FfiException.JumpHostKeyChanged,
        is FfiException.KeyEncrypted,
        -> true
        is FfiException.Message -> error.message.orEmpty().contains("authentication failed", ignoreCase = true)
        else -> false
    }
}

/**
 * 一批服务端事件说明了什么:连接还在,还是**传输断了**(该自动重连),还是**正常结束**(不该)。
 *
 * 区分这两种结束是整件事的关键:用户敲了 `exit`、在 tmux 里 detach,远端会发 `Close`
 * (往往带着 `ExitStatus`)—— 这时候自动连回去就是和用户对着干。而网络断了,
 * 核心的心跳发不出去,报的是 `Disconnected`,那才是要重连的那种。
 */
enum class LinkOutcome { Alive, Ended, Dropped }

/** 按一批事件判断 [LinkOutcome]。同一批里既有 `Close` 又有 `Disconnected` 时按掉线算。 */
fun linkOutcome(events: List<ServerEvent>): LinkOutcome {
    var ended = false
    for (event in events) {
        when (event) {
            is ServerEvent.Disconnected -> return LinkOutcome.Dropped
            is ServerEvent.Close -> ended = true
            else -> Unit
        }
    }
    return if (ended) LinkOutcome.Ended else LinkOutcome.Alive
}

/**
 * 「连接后进入 tmux」时在远端执行的命令。
 *
 * - `new-session -A -s xssh`:有这个会话就接上,没有就新建 —— 断线重连回来还是原来那个画面,
 *   正在跑的命令不受影响。会话名固定,和桌面版的 `tmuxSessionName` 默认值无关,各管各的。
 * - 服务器上没装 tmux 时退回登录 shell,而不是直接失败把连接关掉。
 * - 整段交给 `sh -c`:这条命令由用户的登录 shell 来解释,可能是 bash、zsh 也可能是 fish,
 *   `if … then … fi` 只有 sh 系才认;单引号里的内容外层 shell 原样传给 sh。
 */
const val TMUX_COMMAND =
    "sh -c 'if command -v tmux >/dev/null 2>&1; then exec tmux new-session -A -s xssh; " +
        "else exec \"\${SHELL:-/bin/sh}\" -l; fi'"

/** 重连成功后写进终端的一行分隔:让人知道上面那些是断线前的输出。 */
const val RECONNECTED_MARKER = "\r\n\u001b[2m── 连接已恢复 ──\u001b[0m\r\n"
