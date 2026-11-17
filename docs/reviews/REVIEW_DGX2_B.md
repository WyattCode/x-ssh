# REVIEW_DGX2_B：修复引入的新 bug + 死角（只读）

> 基线 main `d492acf`（M3.197，32 提交，范围 `ca8532b..d492acf`）。
> 审查对象：32 个修复提交新增的代码本身，以及端口转发持久化/恢复、密钥导入导出边界、mobile 与主进程分歧、窗口/托盘生命周期。
> 严重度：P0/P1/P2；置信度：高/中高/中/中低/低。每条都带文件:行号与可复现的触发时序。

## 发现清单（按严重度 × 置信度；Top 10 最前）

| # | 严重度/置信度 | 一句话 | 位置 |
|---|---|---|---|
| F1 | P1 / 高 | 新的“整个连接建立”超时用握手超时值（默认 20s）包住了 openForwards，远端 -R 协商的 30s 单项超时永远到不了；慢转发会把刚建好的连接整条拆掉 | `src/main/ssh.ts:1479-1483`、`:1681-1685`、`:969`、`:835` |
| F2 | P1 / 高 | B12 拒绝渲染层审计后，`transfer` / `forward` 两类审计日志再无任何生产者，安全日志静默丢失全部传输与端口转发记录 | `src/main/connLogIpc.ts:7-10`、`src/renderer/src/stores/sessions.ts:1304`、`:1716-1739` |
| F3 | P1 / 高 | B18 只修了 mobile；桌面 upload/sync-up 仍是直接 `createWriteStream`（'w' 截断目标），取消或断线后远端原文件变成半截 | `src/main/ssh.ts:2241`、`:2977-2990`、`:2437-2476`、`mobile/core/xssh-core/src/sftp.rs:219-291` |
| F4 | P2 / 高 | `pendingRemoteForwards` 超时后不清理，且按 client（多路复用 master 共享）而不是 session 记录；回调永不返回时该远端端口对同 client 的所有会话永久不可用 | `src/main/ssh.ts:922-929`、`:967-985`、`:1073-1085` |
| F5 | P2 / 高 | iOS 的 OSC 52 写入剪贴板默认无条件、无大小限制；桌面已改为默认关闭 + 48KiB/1s，iOS 可被任意远端程序替换剪贴板并放大内存 | `mobile/core/xssh-core/src/terminal.rs:733`、`mobile/ios/XSSH/TerminalModel.swift:270`、`src/renderer/src/lib/osc52.ts:18-27` |
| F6 | P2 / 中高 | B19 的移动端清理按“文件名后缀 + 客户端时钟”判定，`list()` 浏览目录时直接删文件；用户自己的 `*.xssh-part-<hex>` 或时钟偏差下另一客户端的在传临时文件会被误删 | `mobile/core/xssh-core/src/sftp.rs:47-53`、`:127-134` |
| F7 | P2 / 中高 | `validatePublicKey` 只认单空格和固定类型，合法的制表符/多空格分隔、SSH 证书、`ssh-dss` 公钥会被判无效；导入路径随即删掉刚复制的私钥并报错 | `src/shared/publicKey.ts:2-6`、`src/main/keyManager.ts:259-266`、`:294-300` |
| F8 | P2 / 中 | 托盘只绑定第一次 `createWindow` 的窗口；macOS 关窗后（minimizeToTray 默认关）`mainWindow` 销毁，托盘点击/菜单仍操作旧对象，重开窗口也不会重绑 | `src/main/index.ts:300-315`、`:1235`、`:1268-1297`、`:3029-3032` |
| F9 | P2 / 中 | 窗口 `closed` 的异步清理（最长 10s）在无归属校验的情况下操作全局 `sshManager/mainWindow`；这段窗口期内重开窗口，旧清理会把新窗口的 manager 置空 | `src/main/index.ts:1293-1309`、`:1255`、`:3029-3032` |
| F10 | P2 / 中 | 保存的转发规则只要该 host 有任意已连接 pane 就显示 running；connect 时绑定失败（forward:in-use / forwardIn 超时）后 UI 和状态栏仍谎报运行中，移除时 `removed:false` 也被忽略 | `src/renderer/src/stores/sessions.ts:524-535`、`src/renderer/src/lib/forwards.ts:1-14`、`sessions.ts:1707-1715` |
| F11 | P2 / 中 | 主锁 `verifying` 是“拒绝并发”而不是共享单飞：第二个正确的解锁会立刻得到 false；派生期间手动 lock 会让正确口令被当成失败并计入退避 | `src/main/lock.ts:65-79`、`:88-108` |
| F12 | P2 / 中 | 新增的 connect-timeout / 迟到 shell 分支没有任何测试；B3 的超时测试故意在超时后调用回调，因此测不到“回调永不返回”的预约泄漏；B13 测试是源码子串匹配 | `src/main/forwardReview.test.ts:122-137`、`src/main/sandboxReview.test.ts:4-11`、`src/main/ssh.ts:1479-1483` |
| F13 | P2 / 中低 | `list()` 改成两个 worker 共享 `candidates` 后 `out` 顺序不确定，mtime 相同的密钥在不同刷新间会换位（旧实现按文件名顺序稳定） | `src/main/keyManager.ts:52-66` |
| F14 | P2 / 低 | `partialDownloads` 无容量上限、会话结束也不清理；B8 后首次失败就写入，长生命周期进程里只增不减 | `src/main/ssh.ts:1993`、`:2704-2712`、`:1090-1102` |
| F15 | P2 / 低 | `safeForwardOut/safeForwardIn` 的 try/catch 会把回调自身抛出的异常也吞下并再次调用回调；当前各回调靠 `settled` 兜底才没造成双执行 | `src/main/ssh.ts:671-679` |
| F16 | P2 / 中低 | 密钥导入没有大小/文件类型上限，`readFile` 整份读入主进程内存后才校验 | `src/main/keyManager.ts:254-256`、`src/main/index.ts:2742-2753` |

---

## F1. 连接级超时把 openForwards 包进去，和 30s 的 forwardIn 超时打架

- 位置：`src/main/ssh.ts:1479-1483`、`src/main/ssh.ts:1681-1685`（新 connectTimer）；`src/main/ssh.ts:969`（forwardIn 单项 30s）；`src/main/ssh.ts:835`（每个本地 bind 5s）；`src/main/ssh.ts:742-770`（串行 await openForwards）
- 严重度：**P1**
- 置信度：**高**
- 触发时序：
  1. 用户在 host 上保存了 `-R`（remote）转发，或保存了多条本地转发。
  2. 渲染层以自己的 `connectTimeoutSec`（默认 20，`sessions.ts:1920` 传 `readyTimeoutMs = sec*1000`）调用 `ssh.connect`。
  3. 握手成功、shell 打开后，`openForwards` 对每条 `-R` 调 `openRemoteForward`，等待 `forwardIn` 回调，最多 `forwardOutTimeoutMs = 30_000`（`:1954`）；本地规则每条 `waitForListen` 最多 5s（`:835`）。
  4. 默认 20s 到期，刚加的 `connectTimer` 先执行 `this.disconnect(id)`，把会话、shell、已绑定的转发全部拆掉，再 `settle('connect-timeout')`。`openRemoteForward` 的 30s 超时根本没有机会触发。
- 影响：慢速服务器（forwardIn 应答慢、SSH 网关限速）或 5 条以上慢绑定规则时，会话在转发完成前被误杀；用户看到的是“连接超时”，而不是某条转发失败。新增的 30s 单项超时在默认配置下是死代码。
- 补充：同一个 timer 也把 shell 打开时间算进 `readyTimeoutMs`。用户把 connectTimeoutSec 调到 1~3s 时，握手即使成功，只要 MOTD/登录脚本稍慢，连接也会被误判超时；修改前该设置只约束握手。
- 建议：连接级 watchdog 应只覆盖“握手 + shell”，`openForwards` 用独立预算（或至少 max(readyTimeout, 30s×规则数)），并让单项 forward 超时先于总超时触发；shell 与转发完成后再 clear。

## F2. B12 堵伪造的同时，把传输/转发审计日志的生产者一起删掉了

- 位置：`src/main/connLogIpc.ts:7-10`（`rendererConnLogPush` 永远返回 `{ok:false}`，`push` 未调用）；`src/main/index.ts:2624`（`IPC.connLogPush` 改走它）；`src/renderer/src/stores/sessions.ts:1304`（transfer 事件）、`:1716-1727`（remove forward）、`:1730-1739`（add forward）；`src/preload/index.ts:107`
- 严重度：**P1**
- 置信度：**高**
- 触发时序：
  1. 用户完成一次上传/下载（`p.done || p.error`，`sessions.ts:1298-1313`），或从转发对话框/端口转发页新增、移除一条转发（`sessions.ts:1716`、`:1730`）。
  2. 渲染层调用 `window.api.connLog.push(...)`，preload 走 `IPC.connLogPush`。
  3. 主进程 `rendererConnLogPush` 直接 `{ok:false}` 返回，不落盘。
  4. 主进程自己只在 connect/disconnect/error/os-detect/trust-host-key 处 `pushConnLog`（`index.ts:1039,1853-1883,1948`），没有任何代码生成 `event: 'transfer'` 或 `'forward'`。
- 影响：设置里的连接审计日志从此永远没有传输和端口转发记录。端口转发是安全敏感操作（可能把内网端口暴露给远端），B12 修的是“渲染层可伪造记录”，结果把合法记录也一起清零；同时 `connLog:push` IPC 变成只返回失败的死接口。
- 建议：把传输/转发审计改为由主进程在 `SshManager` 的 job/forward 成功点生成（带 sessionId → host 归属），渲染层的 `connLog:push` 可以继续拒绝；或在主进程对 `connLog:push` 只接受受限字段并在主进程补全 host/session 后落盘。

## F3. B18 只修了移动端；桌面上传仍在取消/断线时截断远端原文件

- 位置：`src/main/ssh.ts:2977`（uploadJob 直接 `sftp.createWriteStream(item.remote, ...)`，offset=0 时默认 flags='w' 截断）、`:2981`（pipeStream 无 `cleanupOnError`）、`:2986-2990`（失败只 destroy 流，远端半截文件保留）、`:2241`（sync up 同样直接写）、`:2437-2476`（pipeStream 的清理只处理本地 `cleanupOnError`）；对照 `mobile/core/xssh-core/src/sftp.rs:219-291`（temp + 备份 + rename）
- 严重度：**P1**
- 置信度：**高**
- 触发时序：
  1. 从本地拖一个已存在的文件到远端同名文件（overwrite 策略默认，或 resumeOffset 判定为 0）。
  2. `createWriteStream` 以 'w' 打开目标，服务端立即截断原文件。
  3. 传输中途用户点取消 / 网络断开 / 任一端写失败；worker catch 只 `read?.destroy(); write?.destroy(); failures++`。
  4. 远端留下一个 0 字节或半截内容、名字仍是原名的文件；下一轮“同大小且 mtime 不旧”判断还可能把半截文件当同步完成（mtime 更新且大小相同的情况）。
- 影响：桌面端仍然存在 B18 原始描述的数据丢失类问题；移动端已改为“目标全程不动、失败只删 temp”，两端行为不一致，且桌面是有更多用户的端。
- 建议：把移动端的 staging 方案移植到 `uploadJob` 与 sync-up：同目录独占临时文件（创建时带原 mode）、成功后原子替换、失败只删 temp；或至少在取消/失败时保留 `.xssh-part` 并显式恢复。同步路径和外部编辑保存回写也要走同一入口。

## F4. 远端转发“预约”超时不清、且没有会话归属，回调不返回时永久占位

- 位置：`src/main/ssh.ts:922-929`（`pendingRemoteForwards` 是 `WeakMap<Client, Set<number>>`，`pending.add`）、`:967-985`（超时只 `settled = true; resolve(false)`，没有 `pending.delete`；只有回调里 `:972` 才删）、`:1073-1085`（`closeForwards` / 会话销毁不清 pending）
- 严重度：**P2**
- 置信度：**高**
- 触发时序：
  1. 会话 A 在启用了 multiplex 的 client 上添加/自动打开 `-R 9000`；`openRemoteForward` 把 9000 加进该 client 的 pending。
  2. 服务器/网络在 channel 协商阶段静默丢弃，`forwardIn` 回调永不返回；30s 后 `timer` 执行，返回 false，但 pending 仍保留 9000。
  3. 同一 client 上的会话 B（或 A 重连后复用 master）再次请求 `-R 9000`，`addForward` 查 table 为空、但 `openRemoteForward` 查 pending 命中，返回 false，UI 报“remote listen port 9000 in use”。
  4. 由于 `closeForwards` 不清理 pending，除非旧回调某天到达，否则该端口对这条 master 永久不可用；如果 callback 永远不来，就是进程生命周期级泄漏。
- 影响：一次协商超时会把某条复用连接上的远端端口锁死；用户只能断开 master 后重建。代码注释/HANDOVER 说“保留到回调终结”是有意，但没有处理“回调永不终结”，也没有按会话清理。
- 建议：pending 记录归属 session + 到期时间；超时时至少在会话销毁/`closeForwards` 中删掉本会话的预约；或者在超时后立刻允许同端口重试、仅对迟到成功做 `unforwardIn`（现有回调分支已能处理）。

## F5. mobile 与桌面的 OSC 52 策略分叉：手机默认被远端写剪贴板且不限大小

- 位置：`mobile/core/xssh-core/src/terminal.rs:733`（`Event::ClipboardStore(_, text) => out.push(TerminalEvent::ClipboardStore(text))`，无开关/无长度上限）；`mobile/ios/XSSH/TerminalModel.swift:270`（收到事件直接 `UIPasteboard.general.string = text`）；对照 `src/renderer/src/lib/osc52.ts:18-27`（默认关闭、base64 ≤65536、1s 一次）与 `src/renderer/src/components/TerminalView.vue:544-553`
- 严重度：**P2**
- 置信度：**高**
- 触发时序：
  1. 用户连接任意主机并运行恶意/被攻陷程序；程序输出 `ESC ] 52 ; c ; <base64> BEL`。
  2. core 终端状态机无条件产生 `ClipboardStore`；iOS `TerminalModel.swift:270` 立刻写入系统剪贴板，桌面端 `allowRemoteClipboard` 默认 false 会直接吞掉。
  3. core 对 payload 大小没有上限（桌面端 base64 >64KiB 就拒绝），大 payload 会先在解析/事件队列里形成大字符串再写剪贴板。
- 影响：两端安全策略不一致；手机用户可能在不知情时被替换剪贴板（例如把复制的钱包地址换成攻击者地址），且缺少桌面端刚加的频率/大小闸门。Android 侧目前只在 `Session.kt:235` 处理 `TerminalEvent.Write`，`ClipboardStore` 被忽略；同一个 core 事件两端行为也不同。
- 建议：把桌面端的 opt-in + 48KiB/1s gate 下沉到 core 或各宿主；默认关闭，并在设置里加同样的开关。至少先加大小上限和频率限制。

## F6. B19 移动端清理是“浏览时按名字+客户端时钟删文件”，会误删活文件/用户文件

- 位置：`mobile/core/xssh-core/src/sftp.rs:47-53`（`stale_part` 只要求名字含 `.xssh-part-<纯 hex>`、mtime>0、`now - modified > 24h`）、`:127-134`（`list()` 的 `entries.retain` 内直接 `remove_file`，删除成功才从列表移除）
- 严重度：**P2**
- 置信度：**中高**
- 触发时序：
  1. 客户端与服务器时钟偏差超过 24h（服务器时钟慢），或某次上传已持续超过 24h；此时同目录中存在一个正在写入的 `foo.xssh-part-<hex>`（本进程另一个上传，或同一服务器上的另一台设备）。
  2. 用户/另一线程调用 `list()` 浏览该目录。
  3. `modified` 是服务器的 mtime，`now` 是手机本地时钟；`now - modified > 24h` 成立，`remove_file` 删掉正在写的临时文件。
  4. 上传端后续 `rename(temp, target)` 找不到 temp，整个上传失败（Unix 上 open 的 inode 被 unlink 后仍可写，失败点更隐蔽）。
- 另一个更常见的误删面：用户自己的普通文件恰好命名为 `report.xssh-part-deadbeef` 且超过 24h，浏览目录即被静默删除；注释只承诺“regular staging files”，但判定完全基于文件名，无法区分。
- 影响：浏览目录变成破坏性操作；误删对象可能是唯一副本（用户文件）或正在传输的数据。B19 的方向（清理残留）合理，但判定条件和执行时机都过于激进。
- 建议：用独占创建时写入的 sidecar/扩展属性或至少更长的随机前缀+长度校验来识别自家 temp；清理放到连接后/空闲任务而不是 `list()`；删除前要求 `modified` 明显早于本次进程启动时间，且对时钟偏差设方向（仅“过旧”而非“过新”）并加日志/可恢复。

## F7. `validatePublicKey` 过严：合法 `.pub` 会被判无效，导入时连私钥副本一起删

- 位置：`src/shared/publicKey.ts:2-6`（只接受 `ssh-rsa`/`ssh-ed25519`/`ecdsa-sha2-nistp*`/两种 sk 类型，且 type 与 base64 之间只允许**一个空格**）；`src/main/keyManager.ts:259-266`（`.pub` 读取/校验失败且不是 ENOENT 就 `rm(priv)` 并抛错）；`:294-300`（读取 `.pub` 同样只做 validate，失败不再回退到 `ssh-keygen -y`）
- 严重度：**P2**
- 置信度：**中高**
- 触发时序：
  1. 用户导入一把合法私钥，旁边的 `.pub` 用制表符或多个空格分隔（authorized_keys/部分工具输出允许任意空白），或是 `ssh-ed25519-cert-v01@openssh.com` / `ssh-rsa-cert-v01@openssh.com` 证书、或旧 `ssh-dss`。
  2. `keyManager.import` 先复制私钥到库，再 `readFile(pubSrc)` + `validatePublicKey`。
  3. 正则不匹配 → 抛 `invalid-key`；catch 发现 code 不是 ENOENT，删掉刚复制的私钥并向上抛。
- 影响：这些密钥无法导入（原始文件安全，但功能被拒），且错误表现为通用 `invalid-key`，用户不知道是格式/空白差异。生成路径的标准输出没问题，边界集中在“导入已有密钥”和“读取已有 .pub”。
- 建议：分隔符用 `\s+`（仍禁止换行/NUL），类型按 OpenSSH 公钥算法动态接受（含 `*-cert-v01@openssh.com`、`ssh-dss` 可 warning），或先尝试 `ssh-keygen -lf` 验证而不是自研白名单；校验失败时保留私钥副本并只标记 `.pub` 缺失，让后续 `ssh-keygen -y` 派生。

## F8. 托盘绑定第一个窗口且永不重绑；macOS 关窗后托盘操作旧对象

- 位置：`src/main/index.ts:300-315`（`setupTray(win)` 里 `if (tray) return`，tray 的 click/menu 闭包捕获传入的 `win`）、`:1235`（每个 `createWindow` 都调用 setupTray）、`:1268-1297`（`closed` 后 `mainWindow = null`）、`:3029-3032`（macOS `activate` 新建窗口）
- 严重度：**P2**
- 置信度：**中**
- 触发时序：
  1. macOS 上 `minimizeToTray` 默认 false，用户点红叉：`win.on('close')` 不 preventDefault，窗口销毁，但 `window-all-closed` 在 darwin 不退出。
  2. `tray` 仍持有旧 `win` 的闭包；点击托盘图标 → `win.isVisible()`/`win.show()` 在已销毁 BrowserWindow 上抛 “Object has been destroyed”；右键菜单的 Show/Hide/Palette 同样。
  3. 用户从 Dock 重新激活，`activate` 创建新窗口；`setupTray(newWin)` 因 `tray` 已存在直接 return，托盘继续绑定旧窗口。
- 影响：macOS 关一次窗口后托盘就坏掉（主进程未捕获异常），且无法通过重开窗口恢复，只能重启应用。Windows/Linux 因为 `window-all-closed` 退出，触发面小。
- 建议：`setupTray` 记住当前 `win`，在窗口 `closed` 时销毁 `tray`（`tray?.destroy(); tray = null`）或把 tray 回调改成读取全局 `mainWindow`/重新解析当前窗口；新窗口创建时重绑。

## F9. 窗口 `closed` 的异步清理会用旧窗口的收尾覆盖新窗口的全局状态

- 位置：`src/main/index.ts:1290-1309`（`closed` 里 `stops` 非空时 `Promise.race(..., 10s).finally(closeSessions)`）、`:1293-1298`（`closeSessions` 直接 `sshManager?.disposeAll(); sshManager = null; targetSender = null; mainWindow = null`）、`:1255`（`createWindow` 每次新建并覆盖全局 `sshManager`）、`:3029-3032`（macOS activate 重开）
- 严重度：**P2**
- 置信度：**中**
- 触发时序：
  1. macOS 上用户正在用外部编辑器编辑远端文件（`editCleanups` 非空），关窗。`closed` 先把各编辑 `save()` 推进 `Promise.race`，最长 10s 后才执行 `closeSessions`。
  2. 在这 10s 内用户从 Dock 激活，`activate` 发现无窗口，`createWindow` 运行：创建新的 `sshManager`、`targetSender`、`mainWindow`。
  3. 旧窗口的 `finally(closeSessions)` 这时才执行，它读的是**全局** `sshManager`，于是把新窗口刚创建的 manager `disposeAll()` 并置 null，`mainWindow` 也被置 null。
  4. 新窗口之后的 IPC `requireSshManager()` 报 not-ready，终端/连接全部失效；`mainWindow` 为 null 还会让 `isTrustedIpcSender` 拒绝所有 IPC。
- 影响：需要“有未完成的外部编辑 + 10s 内重开窗口”的组合，概率不高但恢复路径很糟（只能再重启一次）。单实例锁周边常见的重开路径正好踩中。
- 建议：`closed` 时捕获当前窗口专属的 manager 引用（在 `createWindow` 里用局部变量），`closeSessions` 只销毁自己的实例，且 `if (sshManager === mine)` 才置空；或把 `sshManager` 改为按窗口/生命周期归属，不在异步回调里写全局。

## F10. 保存的转发在绑定失败后仍显示 running，移除结果 `removed:false` 被忽略

- 位置：`src/renderer/src/stores/sessions.ts:524-535`（`saved.map((rule) => ({ rule, saved: true, running: panes.length > 0 }))`，只按是否有已连接 pane 判断）、`src/renderer/src/lib/forwards.ts:1-14`（状态栏按 `rows.filter(running)` 计数）、`src/renderer/src/stores/sessions.ts:1707-1715`（`removeForwardFrom` 不检查主进程返回的 `removed`，仍从 pane 列表删除并返回 ok）
- 严重度：**P2**
- 置信度：**中**
- 触发时序：
  1. host 上保存 `-L 8080 -> ...`；本机 8080 已被其它程序占用（或保存的 `-R` 的远端端口在服务器上被占用/forwardIn 超时）。
  2. 连接成功，主进程 `openForwards` 把该规则计入 failed，返回 `code: 'forward:in-use'`；渲染层只弹一次 toast（`sessions.ts:1949-1951`）。
  3. 端口转发页/状态栏仍把该保存规则显示为 running（只要 host 有任意 connected pane）。
  4. 用户点移除，主进程 `removeForward` 返回 `{ok:true, removed:false}`；`removeForwardFrom` 只检查 `r.ok`，照样把规则从 pane 列表删除并记录成功。
- 影响：恢复路径没有“本会话实际打开了哪些保存规则”的真实状态，只能猜“有 pane = 全运行”。用户会看到端口占用却没有失败态，且移除一个本就没运行的规则和移除运行中的规则表现相同。
- 建议：让主进程在 connect 结果/事件里返回实际成功打开的规则（或 forward 列表），渲染层据此标记 running；`removeForwardFrom` 对 `removed:false` 显示“未运行/已移除配置”而不是当成已停止。

## F11. 主锁异步化后的 `verifying` 不是单飞，而是“并发即失败”；epoch 变化被计入失败退避

- 位置：`src/main/lock.ts:65-79`（`if (!this.hash || this.verifying || Date.now() < this.nextAttempt) return false`；`verifying` 为 true 时旧调用直接 false）、`:88-108`（`setPassphrase` 在 `verifying` 时抛 `app-locked`；`lockEpoch !== epoch` 时 `unlocked=false`）
- 严重度：**P2**
- 置信度：**中**
- 触发时序 A（并发解锁）：用户双击解锁按钮/两个窗口同时提交同一正确口令。第一次进入 `verify` 设 `verifying=true` 并 await scrypt；第二次命中 `this.verifying` 立即返回 false → `unlock` 返回 false，UI 提示口令错误；第一个随后成功。第二次是明显误报。
- 触发时序 B（派生中锁定）：用户在解锁（derive 进行中）或设置新口令（`setPassphrase` derive 中）时触发了 `lock()`（空闲/失焦/手动）。`lock()` 使 epoch 变化；derive 完成后 `valid = this.lockEpoch === epoch && ...` 为 false，于是**正确口令**也被计入 `failures++` 并设置 500ms 退避；`setPassphrase` 则把 `unlocked` 设 false。
- 严重度说明：没有越权解锁（安全方向是正确的），但会把正确口令判成错误并延迟下一次尝试，用户会以为口令被改。
- 建议：把 `verifying` 改成共享的 in-flight Promise（并发调用 await 同一个结果），而不是返回 false；`setPassphrase` 可等待/拒绝但不要吞；`lockEpoch` 变化导致的不匹配不要计入 `failures`，只返回“状态已变，请重试”。

## F12. 新超时/迟到回调分支无测试；B3 超时用例反而把泄漏路径“测绿”了

- 位置：`src/main/forwardReview.test.ts:122-137`（超时后主动 `callback(null)`，只断言 table 为空和 `unforwardIn` 被调用，从不断言 `pendingRemoteForwards` 清空）；`src/main/ssh.ts:1479-1483`、`:1681-1685`、`:1516`、`:1590-1604`、`:1706-1749`（新 connect-timeout / 迟到 shell 守卫，全仓无对应测试，`grep connect-timeout` 只有 friendlyError/UI 文案测试）；`src/main/sandboxReview.test.ts:4-11`（读源码 `toContain`，不是运行时校验）
- 严重度：**P2**
- 置信度：**中**
- 触发时序：
  1. F4 的场景（forwardIn 回调永不返回）在现有 B3 测试里不存在：测试超时后立刻调用 callback，所以 `pending.delete` 总会执行，看不出“无回调时永久占位”。
  2. 连接级 watchdog 与 openForwards 的冲突（F1）也没有测试：没有用例让 `readyTimeoutMs < forwardIn 超时`，所以 30s 分支是否为死代码不会被 CI 发现。
  3. `sandbox: true` / `index.cjs` 只用源码子串验证；把 preload 路径写错、把 `sandbox` 放注释里、或构建产物不是 CJS 时，测试仍可能通过（HANDOVER 也承认“不是沙箱逃逸测试”）。
- 影响：这几处正是本轮修复中“新增的锁/超时/回调”最容易回归的地方，但测试没有钉住关键不变量：超时后预约可重试、总超时晚于单项超时、迟到 shell 不会复用已删除会话、构建产物真的是可被 sandbox 加载的 CJS。
- 建议：给 `openRemoteForward` 增加“超时后回调永不返回 → 同端口可以再次发起/或预约有界”的断言；给 connect 增加 `readyTimeoutMs < forwardTimeout` 的假时钟用例；把 sandbox 测试换成启动 Electron 或至少校验构建产物文件头/`require('electron')` 形态。

## F13. 密钥列表改成两个 worker 后，同 mtime 密钥的显示顺序不再稳定

- 位置：`src/main/keyManager.ts:52-66`（`candidates.shift()` 由两个并发 worker 消费，`out.push` 顺序随调度变化；随后只按 `mtime` 排序）
- 严重度：**P2**
- 置信度：**中低**
- 触发时序：
  1. 用户在很短时间内生成/导入两把密钥，mtime 落在同一毫秒（或文件系统只有秒级精度）。
  2. 打开密钥列表；两个 worker 各自拿到一把，谁的 `describe` 先完成谁先 `push`，`sort` 的 `(b.mtime ?? 0) - (a.mtime ?? 0)` 对相等值返回 0，V8 稳定排序保持这个随机插入顺序。
  3. 每次刷新/重开列表顺序可能不同；依赖位置的 UI 操作（键盘选择、删除确认）会跳。
- 影响：功能正确、不影响安全；旧实现按 `readdir` 顺序 `Promise.all`，至少同一次启动内稳定。注释“keep insertion order stable”已不成立。
- 建议：`sort` 增加 `id`/`name` 作为次级键，或先按文件名排序 `candidates` 再消费，使并行不影响最终顺序。

## F14. `partialDownloads` 无上限且不随会话清理，B8 后增长面更大

- 位置：`src/main/ssh.ts:1993`（`private partialDownloads = new Map<...>`）、`:2704-2712`（失败即写入）、`:1090-1102`（`releaseSessionResources` 只清 forwards/log/sftp，不碰 partialDownloads）
- 严重度：**P2**
- 置信度：**中低**
- 触发时序：
  1. 打开一个含大量文件的目录开始下载，网络在多个文件上反复中断；每个失败文件都会写入一条 `sessionId\0remotePath -> {localSize,remoteSize,remoteMtimeMs}`。
  2. 用户关闭该会话/整个应用窗口（macOS 不退出），`releaseSessionResources` 不清这些键；继续其它会话继续累积。
  3. 键中的 sessionId 是 UUID，新会话不会再命中旧键，旧记录永远无法复用也无法访问，只占内存。
- 影响：进程生命周期内的慢速内存增长；每个条目含长路径字符串和多字段对象，批量失败目录会明显放大。B8 之前只在“本地已有非空文件”时写入，触发面小得多。
- 建议：给 Map 设容量上限（LRU）；在 `releaseSessionResources`/`disconnect` 里按 `sessionId\u0000` 前缀清理；或把 partial 元数据随会话对象存放，会话销毁即回收。

## F15. `safeForwardOut/safeForwardIn` 会把回调抛出的异常当成 ssh2 同步异常再调一次回调

- 位置：`src/main/ssh.ts:671-679`
- 严重度：**P2**
- 置信度：**低**（当前所有调用点的 `settled` 守卫掩盖了后果）
- 触发时序：
  1. ssh2 同步调用 `cb(channel)`；回调内部在设置 `settled = true` 之前抛异常（例如 `connectJump` 成功路径里的 `makeSocketBridge`、或未来在回调开头新增的解析/断言）。
  2. `safeForwardOut` 的 `catch` 捕获的是**回调自己**的异常，于是用 `cb(error, undefined)` 再调一次；同一个回调被执行两遍。
  3. 现有 `connectJump` 的 `fail`/`res` 有 settled，local/SOCKS 回调也先设置 settled 才 pipe，所以暂未出现双 pipe；但 `jump` 成功路径是 `res(...)` 之后才可能抛，第二次会走 `fail`（已 resolve 后被忽略），属于隐患。
- 影响：不是当前可复现的数据损坏，但这是“为捕获 ssh2 同步 throw”引入的新模式本身的缺陷：catch 无法区分“调用抛”与“回调抛”。后续任何回调提前抛异常都会变成重复执行/错误分支。
- 建议：只包住调用本身，回调通过一次性 wrapper 标记是否已执行，例如 `let called=false; const once=(...a)=>{ if(called) return; called=true; cb(...a) }`，或先 `try { client.forwardOut(...) } catch(e) { queueMicrotask(()=>cb(e, undefined)) }`。同时给 `result`/`fail` 加幂等断言。

## F16. 密钥导入对文件大小没有任何上限，主进程会整份读入内存

- 位置：`src/main/keyManager.ts:254-256`（`const buf = await readFile(srcPath)`，此前没有 `stat`/大小检查；`keysImport` 的对话框也不限制类型/大小，`src/main/index.ts:2742-2753`）
- 严重度：**P2**
- 置信度：**中低**
- 触发时序：
  1. 用户在“导入私钥”对话框里选中一个普通大文件（误选的镜像/日志/压缩包，或恶意构造的几 GB 文件）。
  2. `readFile` 把整个文件读进主进程内存，之后才 `writeFile(priv, buf)` 复制到密钥库；`isPrivateKey` 也在这之后才检查。
  3. 文件足够大时主进程 OOM 或长时间阻塞/磁盘写满；若源是 FIFO/特殊文件，`readFile` 还可能一直等不到 EOF。
- 影响：这是密钥导入边界缺少的第一道闸；校验再严格也来不及，因为内存已经被占满。属于本轮 B22/B23 周边未覆盖的死角。
- 建议：`stat` 后限制（例如 ≤1 MiB）并拒绝非普通文件；先读前几 KB 判断私钥头，再决定是否完整复制；复制用流式并设置上限。

B_DONE


