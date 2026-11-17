# x-ssh v0.6.37 深度代码审查报告

> 审查方式：只读静态审查 + 本地验证。未修改任何源码，仅新建本文件。
> 验证结果：`npx vitest run` → 76 个测试文件、790 passed / 2 skipped；`tsc --noEmit`（node/web）均通过；`npm audit --omit=dev` 生产依赖 0 漏洞。
> 重点覆盖：`src/main/ssh.ts`、`src/main/index.ts`、`src/main/store.ts`、`src/preload/index.ts`、`src/renderer/src/stores/sessions.ts`、`src/renderer/src/components/TerminalView.vue`，以及 `mobile/core`、`mobile/android` 的核心会话/转发/SFTP 代码。

---

## 一、Bug 清单

### B1. SFTP 通道没有 `error` 监听，恶意/损坏的 SFTP 响应可直接打崩主进程

- 位置：`src/main/ssh.ts:1749-1774`（`getSftp()`）
- 严重度：**P0（崩溃/安全）**
- 置信度：**高**
- 症状推演：
  - `getSftp()` 只注册了 `sftp.on('close')` / `sftp.on('end')`，没有 `sftp.on('error')`。
  - ssh2 在 `sftp()` 建立成功后会移除自己内部的 `error` 监听（见 `node_modules/ssh2/lib/client.js:1577-1580` 的 `removeListeners()`）；此后收到畸形包、超长包时 `SFTP.js` 的 `doFatalSFTPError()` 会执行 `sftp.emit('error', err)`（`node_modules/ssh2/lib/protocol/SFTP.js:2712-2717`）。
  - 对一个没有 `error` 监听的 EventEmitter 发 `error`，Node 会抛出未捕获异常；本项目主进程没有任何 `process.on('uncaughtException')`，结果就是整个应用退出。
  - 触发输入：连接一个恶意/损坏的 SSH 服务器，打开 SFTP 抽屉或任何会调用 `getSftp()` 的功能，服务器返回长度非法或类型未知的 SFTP 包。普通用户无感知，远程即可让客户端崩溃。
- 修法：在 `session.sftp = sftp` 前注册 `sftp.on('error', ...)`，把错误转成一次 `sftp` 失效 + 可读的 UI 错误；同时保留 `close/end` 的缓存失效逻辑。

### B2. 覆盖远端文件会改写权限位：`0600` 私钥/`authorized_keys` 可能变成 `0644` 甚至 `0666`

- 位置：
  - `src/main/ssh.ts:2145`（`syncJob` 上传方向，直接 `sftp.createWriteStream(item.remote)`）
  - `src/main/ssh.ts:3154`（`putFileSilent`，外部编辑器保存回写）
  - `src/main/ssh.ts:2877` + `src/shared/fsUtils.ts:87-96`（`uploadJob` 固定传 `mode: 0o644`）
- 严重度：**P1（安全/数据完整性）**
- 置信度：**高**
- 症状推演：
  - ssh2 的 `createWriteStream` 在 `open()` 成功后无条件 `fchmod(handle, mode)`；未显式传 `mode` 时默认值是 `0o666`（`node_modules/ssh2/lib/protocol/SFTP.js:3853` 与 `3890-3930`）。`fsUtils.ts` 的注释已经准确描述过“默认 0o666 绕过 umask 并 fchmod 已有文件”，但只修了 `uploadJob`。
  - 用外部编辑器打开远端 `~/.ssh/authorized_keys` 并保存：`putFileSilent` 把它改成 `0666`，sshd 会因权限过宽拒绝该文件，用户被锁在门外。
  - 普通目录同步（`syncJob` up）也会把原本 `0600` 的私钥改写成 `0666`；`uploadJob` 覆盖时则写成 `0644`，同样会破坏 `authorized_keys` / 私钥 / 可执行脚本。
  - 对比：移动端 Rust 实现已经显式保留原权限（`mobile/core/xssh-core/src/sftp.rs:210-220`），桌面端没有对上。
- 修法：写入前 `sftp.stat(remote)` 取原 `mode`，存在时按“原 mode & 0o7777”传给 `createWriteStream`；不存在时用受控的新文件 mode（例如 `0o644`，而不是 `0o666`）。三处统一走一个 helper。

### B3. 连接时端口转发与会话关闭存在竞态：返回“已连接”的死 session，并泄漏本地监听

- 位置：`src/main/ssh.ts:1515-1537`、`src/main/ssh.ts:1657-1674`、`src/main/ssh.ts:719-743`；关闭路径 `src/main/ssh.ts:1575-1590`、`src/main/ssh.ts:1033-1053`
- 严重度：**P1（功能坏 + 资源泄漏）**
- 置信度：**高（代码路径确定，触发需时序）**
- 症状推演：
  1. `client.on('ready')` 里先开 shell，然后异步 `openForwards()` 等 `waitForListen`（单条最多 5s）；`settle({ ok: true })` 在它之后才执行。
  2. 如果这段时间连接断了（网络抖动、服务器踢人、远程 `-R` 的 `forwardIn` 很慢），`client.on('close')` 会先执行 `releaseSessionResources(id)`（此时 `session.forwardServers` 还是空）并 `sessions.delete(id)`。
  3. 随后 `openForwards()` 仍持有旧 `session` 对象，把新绑定的本地监听挂到 `session.forwardServers` 上——但清理已经跑过，这个 session 也不在 `sessions` 里了，监听端口从此泄漏到应用退出。
  4. 异步 IIFE 继续 `emit({status:'connected'})` 并 `settle({ok:true})`，渲染层 `runConnect` 把 pane 标记为 `connected` 并保存这个已不存在的 `sessionId`（`src/renderer/src/stores/sessions.ts:1930-1932`）。终端永远不会收到数据，也永远不会再收到该 id 的 error 事件（error 在 attach 之前已发过，被当作 unowned 忽略），用户看到永久“已连接”的死 pane。
  - 同类问题：`openRemoteForward()` 的 `forwardIn` 回调没有超时（`src/main/ssh.ts:930-940`），服务器不回包时 `openForwards()` 永不返回，`connect()` 永不 resolve，pane 永远停在“连接中”。
- 修法：`openForwards` 完成后先检查 `this.sessions.get(id) === session` 再挂资源/发 connected/settle；`openRemoteForward` 加与 `jumpForwardTimeoutMs` 同类的超时；`connect()` 整体加一个 shell-ready + forwards 的总超时。

### B4. 连接已断时 ssh2 的 `forwardOut/forwardIn` 会同步抛异常，多个调用点没有 try/catch

- 位置：`src/main/ssh.ts:690`（`-L` 本地监听 accept 回调）、`src/main/ssh.ts:993`（`-D` SOCKS 请求回调）、`src/main/ssh.ts:931`（`openRemoteForward`）、`src/main/ssh.ts:469`（`connectJump` 的 `forwardOut`）
- 严重度：**P1（主进程崩溃/未处理拒绝）**
- 置信度：**中（时序窗口小，但机制确定）**
- 症状推演：
  - ssh2 的 `forwardOut/forwardIn` 在第一行就检查 `_sock`：`if (!this._sock || !isWritable(this._sock)) throw new Error('Not connected')`（`node_modules/ssh2/lib/client.js:1398-1400`、`1333-1335`）。
  - 本地转发监听器的 `connection` 回调、SOCKS 的 `onData` 回调、`client.on('ready')` 里的 `connectJump.forwardOut`，都在没有 try/catch 的普通回调里调用它。连接刚断、socket 已不可写但监听器尚未关闭的一瞬间，异常会直接冒到 Node 事件循环；`openForwards()` 里的同步 throw 则会变成未处理的 Promise rejection。
  - 代码里 `unregisterRemoteForward` 已经用 `try { client.unforwardIn(...) } catch {}`（`src/main/ssh.ts:878-882`）承认了这组 API 会同步抛，但其他调用点漏了。
- 修法：所有 `forwardOut/forwardIn` 调用统一包一层 `safeForward*`，同步 throw 转成 `cb(err)` / `{ok:false}`；`openForwards` 的 IIFE 外层加 `try/catch` 并 `settle({ok:false})`。

### B5. 给已存在的主机级 `-R` 转发重复添加同端口，会静默破坏原来的远端转发

- 位置：`src/main/ssh.ts:748-760`（只检查 `runtimeRules`）、`src/main/ssh.ts:889-940`（先写表再 `forwardIn`，失败时删表）；渲染层 `src/renderer/src/components/ForwardDialog.vue:29`、`src/renderer/src/stores/sessions.ts:1687-1690`
- 严重度：**P1（功能坏）**
- 置信度：**高**
- 症状推演：
  - 主机配置里有 `-R 9000 → 127.0.0.1:5432`，连接时 `openRemoteForward` 把 handler 写入 `session.remoteForwards` 和 per-client `table`，服务器开始监听 9000。
  - 用户打开状态栏的端口转发对话框：它只列 `pane.params.portForwards`，而主机保存的规则并没有被写进 pane 参数（`openConnection/quickConnect` 不填这个字段），所以对话框里看不到 9000。
  - 用户再添加一个 `-R 9000`：`addForward` 只查 `runtimeRules`（主机级规则不在里面），于是进入 `openRemoteForward`。它先把 9000 的 handler **覆盖**进两张表，再 `forwardIn`；服务器回“端口已占用”，失败分支把 9000 从两张表里 `delete` 掉。
  - 结果：服务器上 9000 仍在监听旧转发，但客户端两张表都没有 handler；之后每一笔入站连接都被 `reject()`。UI 只显示一次“端口占用”，原来的转发却已经不可用，且 `unforwardIn` 从未调用。
  - 连接时主机配置里出现两个同端口 `-R` 规则也会走同一条路径。
- 修法：`addForward` 先检查 `session.remoteForwards` / 已绑定的静态端口；`openRemoteForward` 先 `forwardIn` 成功、再写表，失败时不要删除已存在的旧 handler。

### B6. `getSftp()` 没有超时：服务器接受通道却不回 SFTP 握手时，所有 SFTP IPC 永久挂起

- 位置：`src/main/ssh.ts:1749-1777`
- 严重度：**P2（功能坏）**
- 置信度：**中**
- 症状推演：`session.client.sftp(cb)` 的 `cb` 依赖服务端完成 subsystem + VERSION 握手。恶意/故障服务器可以接受通道后一直不说话；`getSftp` 返回的 Promise 永不 settle，SFTP 抽屉的 list/read/upload 全部无限等待，用户没有任何错误提示，也没有可取消路径。
- 修法：像 `connectJump` 一样给 `client.sftp()` 套 10-15s 超时，超时后 `session.sftpPromise = undefined` 并 reject 一个可翻译的 code。

### B7. `downloadJob` 的文件队列没有上限，超大目录会在主进程堆出无界对象数组

- 位置：`src/main/ssh.ts:2532`（`queue.push`）；对比上传的背压 `src/main/ssh.ts:2803-2810`、`downloadTree` 的 `src/main/ssh.ts:3079-3084`
- 严重度：**P2（性能/内存）**
- 置信度：**高**
- 症状推演：`walk()` 递归枚举远端目录时只判断取消，不等待队列消费；下载一个几十万文件的目录时，4 个 worker 的吞吐远低于 `readdir` 枚举速度，队列会一直增长到整棵树的条目都在内存里，主进程 RSS 飙升，严重时 OOM。
- 修法：复用 `QUEUE_MAX` 背压（与 `uploadJob`/`downloadTree` 相同的 `while (queue.length >= QUEUE_MAX) await delay(15)`）。

### B8. 全新下载中断后不会续传：partial 记录只在“本地已有非空文件”时才写入

- 位置：`src/main/ssh.ts:2559-2574`、`src/main/ssh.ts:2599-2613`
- 严重度：**P2（体验/带宽）**
- 置信度：**高**
- 症状推演：
  - 文件原本不存在（`localSize === 0`）时，`remoteInfo` 不会被赋值。
  - 传输中途断线，`catch` 里 `if (remoteInfo)` 为假，`partialDownloads` 不记录。
  - 用户点“继续下载”时，本地已有非空半文件，但 `prior` 是 undefined → `resumable=false` → `unlink` 后从头重下。
  - 也就是说，“断点续传”只对覆盖已有本地文件的场景生效，最常见的“首次下载大文件断线”完全无效。
- 修法：进入 worker 时就 `statFile` 远端（不需要等本地文件存在），并把远端 size/mtime 保存到局部变量，失败时无条件写入 `partialDownloads`。

### B9. 会话历史每收到一个输出块都复制整个 256KB 缓冲

- 位置：`src/main/ssh.ts:199-206`（`session.history = ((session.history ?? '') + chunk).slice(-HISTORY_MAX)`）
- 严重度：**P2（性能）**
- 置信度：**高**
- 症状推演：`cat` 大文件或编译日志时，每个 SSH data 事件（可能几 KB 到几十 KB）都会把已累积的 256KB 字符串重新拼接并切尾，产生 O(块数 × 256KB) 的拷贝与 GC 压力；主进程同时还要做 IPC 转发，终端明显掉帧。
- 修法：改成按块追加的环形数组/`Buffer` 队列，只在 `historyList()` 时 join；或每 N 块/每 500ms 才做一次截断。

### B10. OSC 52 可在无用户确认的情况下覆盖系统剪贴板，上限还有 2MB

- 位置：`src/renderer/src/components/TerminalView.vue:544-553`、`src/renderer/src/lib/osc52.ts:3-8`
- 严重度：**P2（安全/体验）**
- 置信度：**高**
- 症状推演：任何远端程序（或 `cat` 一个恶意日志）都能发送 `ESC ] 52 ; c ; <base64>`，渲染层会立即 `clipboard.writeText(text)`，最多解码 2,000,000 个 base64 字符。攻击者可以持续把用户剪贴板替换成恶意命令/钓鱼文本，而用户下一次粘贴就中招。目前没有开关、没有来源提示、没有大小与频率限制。
- 修法：加“允许远端写剪贴板”设置（默认关或首次询问）；给解码大小/频率加上限；`lastAppCopy` 与右键 Copy 的联动保持，但不要直接写系统剪贴板。

### B11. `settings:get` 不区分主进程专用键，渲染层可读取 `masterLock` 的 scrypt salt/hash

- 位置：`src/main/index.ts:2569`；`src/shared/settingsKeys.ts:76-88`
- 严重度：**P2（安全加固）**
- 置信度：**高**
- 症状推演：写入已经用 `isRendererSettableKey()` 限制，但读取没有。当前渲染层（或任何借 `sandbox:false` + 预加载 API 的注入代码）可以 `settings.get('masterLock')` 拿到 `{salt, hash}`，离线暴力破解主锁口令；也能读取完整的 `connectionLog`、`sessionHistory`。
- 修法：`settingsGet` 对 `MAIN_ONLY_KEYS` 返回 `undefined`（或只放行明确需要读取的键），并补单测。

### B12. `connLog:push` 接受渲染层任意伪造的审计记录

- 位置：`src/main/index.ts:2617-2619`
- 严重度：**P2（安全审计完整性）**
- 置信度：**高**
- 症状推演：主进程自己已经在真实连接/转发/传输事件里调用 `pushConnLog`，但这个 IPC 仍允许渲染层提交任意 `{at,event,host,port,username,detail,bytes}`。被注入的渲染层可以伪造“某主机某用户已连接/已转发”的记录，污染安全审计。
- 修法：删除该通道（主进程已覆盖全部事件），或至少校验 `event` 枚举并忽略 `host/port/username` 由主进程补齐。

### B13. `sandbox:false` + 全量 preload API：渲染层一旦被注入即等同本地文件/凭据访问

- 位置：`src/main/index.ts:1154-1158`；`src/preload/index.ts`
- 严重度：**P2（安全加固）**
- 置信度：**高**
- 症状推演：当前 `contextIsolation: true`、`nodeIntegration: false` 是好的，但 `sandbox: false` 让 preload 拥有完整 Node/Electron 能力，并且 `contextBridge` 把 `local:*`（任意目录列举/删除/重命名）、`sftp:uploadPaths`（任意本地文件上传）、`clipboard` 都暴露给渲染层。一旦出现任何能把 JS 注入渲染层的路径（第三方渲染依赖、未来新增的 HTML 拼接、`innerHTML`），攻击者不需要逃逸沙箱就能读写本机文件并把凭据传到远端。
- 修法：开启 `sandbox: true`；若 `clipboard`/`webUtils` 在沙箱 preload 不可用，改为通过新 IPC 暴露“只读当前剪贴板文本/写文本”“取拖拽文件路径”两个窄接口。

### B14. 本地文件重命名在 macOS/Linux 会静默覆盖同名目标

- 位置：`src/main/index.ts:1630-1646`
- 严重度：**P2（数据丢失）**
- 置信度：**高**
- 症状推演：`rename(from, to)` 在 POSIX 上是原子覆盖。用户在本地面板把 `a.txt` 改名成已存在的 `b.txt`，`b.txt` 内容直接消失，没有确认；Windows 会因目标存在而失败，行为不一致。创建文件用了 `wx` 防止覆盖（`1623`），重命名却没有同样保护。
- 修法：`to` 存在时拒绝并返回 `target-exists`（或先弹出覆盖确认），与 `localCreate`/`localCopyIn` 的“不覆盖”策略保持一致。

### B15. `remoteExec` 没有超时/输出上限，`verifyChecksum`、OS 探测、tmux 列表都可能永久挂起

- 位置：`src/main/ssh.ts:3509-3540`；调用点 `src/main/ssh.ts:2689`（校验和）、`src/main/index.ts:913`（OS 探测）、`src/main/ssh.ts:3672-3680`（tmux）
- 严重度：**P2（功能坏/内存）**
- 置信度：**高**
- 症状推演：
  - `remoteExec` 只监听 `close/error`，没有 `execTimeoutMs`，`out` 也无上限。远端挂载点卡死、命令等待 stdin、或服务器持续输出时，Promise 永不返回，`execCommand` 的调用方（IPC/后台任务）一直挂着；输出还会无界增长。
  - `detectHostOs` 用 `Promise.race` 8s 超时（`src/main/index.ts:910-917`），但超时只是让 race 失败，`remoteExec` 打开的 exec channel 仍然存在并继续收数据，反复连接会积累悬挂 channel。
- 修法：让 `execCommand` 复用 `execRemote` 的超时 + `channel.close()`，并像 `quietExec` 一样给 `out` 加 64KB 上限。

### B16. `-D` 动态转发的已建立连接不纳入会话清理集合

- 位置：`src/main/ssh.ts:667-674`（dynamic 监听器）、`src/main/ssh.ts:993-1010`（SOCKS 建连后只做 `pipe`，没有 `trackForwardSocket`）；对比 `-L` 的 `src/main/ssh.ts:704-705` 与清理 `src/main/ssh.ts:1017-1028`
- 严重度：**P2（资源泄漏）**
- 置信度：**中**
- 症状推演：SOCKS 客户端已连上并建立 channel 后，用户断开/会话掉线：`closeForwards` 关闭监听器、销毁 `forwardSockets`，但 `-D` 的 socket 不在集合里。`channel` 属于已 end 的 client，它的 `close` 不一定会让本地 socket 立即 `destroy`（当前代码只 `pipe`，没有 `close` 联动），一个保持半开写的本地客户端可能让 fd 留到进程退出。
- 修法：在 SOCKS 成功分支对 `socket` 和 `channel` 都调用 `trackForwardSocket(session, ...)`，与 `-L/-R` 一致。

### B17. `removeForward` 永远返回 `ok:true`，且不会终止已建立的转发连接

- 位置：`src/main/ssh.ts:816-845`
- 严重度：**P2（体验/边角）**
- 置信度：**中**
- 症状推演：对一个已经不存在、或端口被系统改绑的规则调用移除时，`toClose` 为空、`remoteForwards` 也没有 key，函数仍返回成功；UI 会显示“已停止”，实际无可验证状态。另外 `server.close()` 只停止 accept，已通过该转发建立的 socket 仍在 `forwardSockets` 里，直到会话结束才销毁，用户以为“关掉转发”后旧连接仍能继续传输。
- 修法：返回是否真的移除了某个资源（`removed:boolean`）；按规则记录其已建立的 socket（或至少对该端口的 socket 打标），移除时一并销毁。

### B18. 移动端 SFTP 在临时文件创建失败时退回直写，取消/断线会截断原文件

- 位置：`mobile/core/xssh-core/src/sftp.rs:218-220`（回退 `session.create(target)`）、`mobile/core/xssh-core/src/sftp.rs:243-253`（失败只清理 temp；无 temp 时目标已被截断）
- 严重度：**P2（数据丢失）**
- 置信度：**高**
- 症状推演：目标目录不允许创建新文件、但目标文件本身可写（例如别人家目录里 group-writable 的文件）时，`create_temp` 失败 → 直接 `create(target)` 截断目标。此时取消上传或网络断开，代码注释也承认“目标已经被截断，无能为力”，远端原文件内容丢失。
- 修法：回退路径至少先在同目录创建一个可写的普通临时文件（而非直接在目标上截断）；两条路径都保留“失败不动原文件”的语义，做不到就拒绝上传并提示。

### B19. 移动端上传的 `.xssh-part-*` / `.xssh-old-*` 残留文件没有清理机制

- 位置：`mobile/core/xssh-core/src/sftp.rs:173-180`（创建 temp）、`mobile/core/xssh-core/src/sftp.rs:259-278`（备份 + 改名）
- 严重度：**P2（体验/磁盘）**
- 置信度：**高**
- 症状推演：应用在上传过程中被杀、进程崩溃、或改名后删除备份失败时，会在远端目录留下 `.xssh-part-*` 或 `.xssh-old-*`。代码没有启动扫描/过期清理，用户会看到越来越多的隐藏垃圾文件。
- 修法：上传成功后确认删除备份；应用启动/连接时对该目录做一次“超过 24h 的 `.xssh-part-*` / `.xssh-old-*`”清理，或至少在文件面板提供入口。

### B20. 主锁使用同步 scrypt，且解锁没有节流

- 位置：`src/main/lock.ts:57-58`（`scryptSync`）、`src/main/lock.ts:88-93`（`unlock` 无尝试次数/延迟）
- 严重度：**P2（性能/安全加固）**
- 置信度：**高**
- 症状推演：`setPassphrase/unlock/disable` 都在主线程同步跑 scrypt（默认 N=16384），设置/解锁期间主进程事件循环停住，窗口/IPC 全部卡顿；`unlock` 对错误口令没有延迟或次数限制，本地可快速枚举（虽然 hash 本来就能离线爆破，但在线入口也不该免费加速）。
- 修法：改用异步 `scrypt`（worker/`crypto.scrypt`），并对连续失败加指数退避。

### B21. 密钥库生成/列表在主进程做同步 RSA 与并发子进程

- 位置：`src/main/keyManager.ts:208`（`generateKeyPairSync`，RSA 可到 4096 位）；`src/main/keyManager.ts:30-70`（每个 key 并发跑 `ssh-keygen -lf` 与 `ssh-keygen -y`）
- 严重度：**P2（性能）**
- 置信度：**高**
- 症状推演：生成 RSA 4096 时同步计算会让主进程 UI 冻结数秒；密钥库有几十个 key 时 `list()` 会同时拉起约 2N 个 `ssh-keygen` 子进程，Windows 上明显卡顿/杀软告警。
- 修法：生成改用 `ssh2.utils.generateKeyPair`（异步）或 worker；`list()` 用一个并发上限（如 4）串行化 `ssh-keygen`，并缓存 fingerprint。

### B22. `keysPublish` 的 here-doc 可被构造过的 `.pub` 内容击穿

- 位置：`src/main/index.ts:2780`（`cat >> ~/.ssh/authorized_keys <<'XSSH'\n${pub}\nXSSH`）；`src/main/keyManager.ts:260-268`（导入时无条件复制 `${srcPath}.pub`，不校验内容）
- 严重度：**P2（安全）**
- 置信度：**中**
- 症状推演：如果用户导入一个别人给的 key bundle，其中 `.pub` 文件包含一行 `XSSH`，后续内容就会被远端 shell 当成命令执行；随后“发布公钥到多台主机”会在所有目标上执行这些命令。当前只校验私钥文件包含 PRIVATE KEY 标记，`.pub` 完全没验证。
- 修法：不要用 here-doc 传 pub；用 `printf %s <base64>` 或单引号转义后 `echo`，并在导入/发布前校验 pub 行必须是 `type base64 [comment]` 格式。

### B23. `KeyManager.import` 有不可达的重复 throw

- 位置：`src/main/keyManager.ts:274-275`
- 严重度：**P2（可维护性）**
- 置信度：**高**
- 症状推演：`throw new Error('invalid-key')` 之后紧跟 `throw new Error('invalid-private-key')`，后者永远不执行；未来若有人按第二个字符串加分支会得到错误判断。
- 修法：删掉第二行。

### B24. `readTextFile` 先 stat 再 readFile，恶意服务端可在两者之间放大文件

- 位置：`src/main/ssh.ts:3305-3328`
- 严重度：**P2（内存）**
- 置信度：**低**
- 症状推演：`stat` 报 1KB，随后 `sftp.readFile` 时服务器返回几百 MB（或被替换成超大文件），主进程会一次性读进内存并 `toString('utf8')`。
- 修法：`createReadStream` 加字节上限（读满 2MB 即销毁并报 `file-too-large`），不要信任 stat 的结果。

---

## 二、优化空间

### 性能

1. `src/main/ssh.ts:201` — 会话历史 256KB 每 chunk 全量复制（见 B9），改为环形块队列，只在读取时 join。
2. `src/main/ssh.ts:2532` — 下载队列无界（见 B7），补 `QUEUE_MAX` 背压。
3. `src/main/ssh.ts:206-210` — 每个 SSH data 块单独 `webContents.send`，高吞吐时 IPC 消息数过多；按 16ms/64KB 合并后一次性发送。
4. `src/main/ssh.ts:1995-2021` — `walkRemoteTree` 对每个文件额外 `statFull`；`readdir` 的 attrs 已带 size/mtime，直接用可省掉一次 RTT/文件。
5. `src/main/ssh.ts:3280-3290` — `rmrf` 对单目录所有子项 `Promise.all`，超大目录会同时创建百万 Promise；改成有界工作队列（沿用 `Semaphore` 或显式栈）。
6. `src/main/ssh.ts:2409-2470` — `pipeStream` 暂停轮询固定 150ms，长时间暂停时每秒 6 次唤醒；可改用事件/`Atomics.waitAsync` 式唤醒。
7. `src/renderer/src/stores/sessions.ts:1257-1345` — `sftp:progress` 对所有 job 都做 toast/通知/历史/速度计算；批量小文件时开销集中在渲染层，可对 `done` 事件按 job 合并。
8. `src/main/index.ts:601` — 自动备份 `setInterval` 与 `settings.json` 全量重写；备份内容含全部主机/快照，定时器触发时会让设置写入队列变长，建议把备份写到独立文件并避免与设置写同一队列。
9. `src/main/reachability.ts:24-55` — 每轮探测对每台主机 spawn 一个 `ping`；50 台主机 = 50 个子进程。可改用 `dgram`/系统 ping 复用，或把并发从 8 降到 4 并缓存更长。
10. `src/main/keyManager.ts:208` / `src/main/lock.ts:57` — 同步 RSA/scrypt 阻塞主线程（见 B20/B21），改用异步 API 或 worker。

### 结构 / 重复逻辑

1. `src/main/ssh.ts`（3759 行）— 连接生命周期、转发、SFTP、同步、X11 全在一个类里；建议拆 `session.ts` / `forward.ts` / `transfer.ts` / `sftpOps.ts`，至少把 `syncJob`/`uploadJob`/`downloadJob` 抽成独立模块并用一个共享的 job 状态对象。
2. `src/main/index.ts`（3052 行）— IPC 注册与窗口/托盘/备份/密钥/更新全部混在一起；建议按 `registerHostIpc/registerSshIpc/registerSftpIpc/registerSettingsIpc` 拆分，`withTempHosts`、`detectHostOs` 移到独立服务。
3. `src/main/index.ts:2005-2176` — `sftpDownload/sftpDownloadMany/sftpDownloadTo/sftpSync/sftpUpload/...` 五处重复“取消/失败/校验和/计数”的结果映射；抽 `mapTransferResult()` 一处维护。
4. `src/renderer/src/components/SftpDrawer.vue`（3503 行）— 远端列表、本地面板、传输队列、右键菜单、预览、批量选择全在一个组件；建议拆出 `LocalPane`、`TransferBar`、`RemoteTable`。
5. `src/renderer/src/components/SettingsDialog.vue`（2429 行）— 每个设置页一个内联块；按 tab 拆子组件，降低重渲染范围。
6. `src/renderer/src/components/HostEditor.vue`（1609 行）— 表单、转发编辑、密钥选择、代理/跳板全在一起；拆出 `ForwardRuleEditor` 与 `AuthSection`。
7. `src/renderer/src/components/ForwardsPage.vue:37-149` 与 `src/renderer/src/components/ForwardDialog.vue:37-90` — 端口校验/重复检查/添加逻辑两份；共用一个 `validateForwardRule()` + `addForwardChecked()`。
8. `src/main/ssh.ts:3345-3380` 与 `src/main/ssh.ts:3509-3540` — `execRemote` 与 `remoteExec` 两套命令执行、超时、错误语义不一致（见 B15）；合并为一个带 timeout/output cap 的实现。
9. `src/renderer/src/stores/sessions.ts:1848-2270` — 会话连接/重连/关闭状态机与 UI 状态（tabs、toast、active pane）耦合；把状态机抽成纯 reducer，便于像 `reconnect.ts` 一样单测。
10. `src/main/index.ts:2406` 注释提到“没有 process.on('uncaughtException')”；短期作为最后防线可加 `unhandledRejection` 日志 + 会话隔离，长期仍应修 B1/B4 的具体监听。

### 依赖健康

- 生产依赖仅 `ssh2@1.17.0`（满足 `^1.16.0`）与 `@xterm/addon-search`；`npm audit --omit=dev` 为 0 漏洞，健康。
- `electron@33.x` 已进入维护尾期（dev 依赖），建议排期到当前主版本；升级时重点回归 `safeStorage`、`webUtils`、`clipboard` 与 preload 沙箱行为。
- `vitest@2.1.9` 配置里 `singleFork` 的原因（Windows SSR 缓存竞争）仍在；升级到 vitest 3 前保留该配置，避免测试文件静默漏跑。

### 错误处理一致性

1. `src/main/ssh.ts:1749-1777` — SFTP 只处理 close/end，不处理 error（B1）。
2. `src/main/ssh.ts:3509-3540` — `remoteExec` 无超时/无输出上限，与 `execRemote` 不一致（B15）。
3. `src/main/ssh.ts:3305-3328` — `readTextFile` 抛异常，而多数 SFTP 方法在 IPC 层被 `friendlyError` 包装；建议统一返回 `code` 而不是英文字符串，避免渲染层再做字符串匹配。
4. `src/main/index.ts:2617` — `connLogPush` 无输入校验（B12）。
5. `src/main/index.ts:1630-1646` — `localRename` 失败时才报错，成功覆盖时不报（B14）。
6. `src/main/ssh.ts:816-845` — `removeForward` 无“真的移除了吗”的返回值（B17）。
7. `src/main/ssh.ts:889-940` — `openRemoteForward` 失败时可能破坏既有状态（B5）。
8. `src/main/ssh.ts:1515-1537` / `1657-1674` — connect 的异步 IIFE 没有 catch/settle 兜底（B3）。

---

## 三、Top 10 行动清单（按 严重度 × 置信度 排序）

1. **B1｜P0｜高**：给 `getSftp()` 返回的 SFTPWrapper 注册 `error` 监听（`src/main/ssh.ts:1771` 附近）。这是远程可触发的主进程崩溃，最先修。
2. **B2｜P1｜高**：所有远端覆盖写保留原文件 mode，禁止 `createWriteStream` 默认 `0o666`/固定 `0o644`（`src/main/ssh.ts:2145/2877/3154` + `src/shared/fsUtils.ts:87-96`）。会破坏 `authorized_keys`/私钥/脚本权限。
3. **B5｜P1｜高**：`addForward`/`openRemoteForward` 先判重、先成功后写表，失败不删旧 handler（`src/main/ssh.ts:748-760`、`928-936`）。避免用户一次误操作把已工作的 `-R` 转发打死。
4. **B3｜P1｜高**：`openForwards` 完成后确认 session 仍在、给 `forwardIn` 加超时、connect 总超时（`src/main/ssh.ts:719-743`、`1515-1537`、`930-940`）。修掉“假 connected + 端口泄漏 + 永久连接中”。
5. **B4｜P1｜中**：所有 ssh2 `forwardOut/forwardIn` 调用统一 catch 同步 throw（`src/main/ssh.ts:469/690/931/993`）。时序窄但会崩主进程。
6. **B11｜P2｜高**：`settings:get` 过滤 `MAIN_ONLY_KEYS`，不让渲染层读到 `masterLock` 的 scrypt hash/salt（`src/main/index.ts:2569`）。
7. **B10｜P2｜高**：OSC 52 写剪贴板加用户开关/确认、大小与频率限制（`TerminalView.vue:544-553`、`osc52.ts:3-8`）。防止远端静默劫持剪贴板。
8. **B14｜P2｜高**：`localRename` 目标存在时拒绝覆盖（`src/main/index.ts:1641`）。避免 POSIX 上静默丢文件。
9. **B15｜P2｜高**：`remoteExec/execCommand` 加 timeout 与 64KB 输出上限（`src/main/ssh.ts:3509-3540`），并修 `detectHostOs` 超时后遗留 channel。
10. **B7 + B8｜P2｜高**：下载队列加 `QUEUE_MAX` 背压，且 worker 一开始就记录远端 size/mtime，让首次下载中断也能续传（`src/main/ssh.ts:2532`、`2559-2613`）。

> 次优先：B6（SFTP 握手超时）、B12（审计日志可伪造）、B13（sandbox 加固）、B16（-D socket 清理）、B17（removeForward 返回值/旧连接）、B20/B21（同步 scrypt/RSA 阻塞 UI）、B22（.pub here-doc 注入）、B18/B19（移动端上传回退与残留临时文件）。

---

## 四、附：已确认做得好的点（避免误伤，也便于后续改动不倒退）

- 主机密钥 TOFU 校验在目标机和跳板机都做了，且 `trustHostKey` 只接受“刚刚被拒绝过”的 fingerprint，渲染层不能凭空写 known_hosts（`src/main/index.ts:1898-1944`）。
- 本地路径遍历防护完整：`resolveDir/resolveInside/isSafeEntryName`（`src/shared/localPaths.ts`）与下载侧的 `safeLocalJoin`（`src/main/ssh.ts:1790-1808`）覆盖了 `..`、绝对路径、NUL、Windows 保留字符。
- 远端 shell 命令拼接基本都做了单引号转义 + `--`（`src/shared/fsUtils.ts:17-53`），`tar`/`unzip` 的 `./` 前缀也考虑了以 `-` 开头的文件名。
- 凭据存储桌面用 `safeStorage`，并区分 `bad/missing`，拒绝覆盖不可读的 vault（`src/main/store.ts:88-190`）；移动端 Android Keystore + 生物识别门禁（`Secrets.kt`）实现完整。
- 设置/主机/known_hosts 都有 `.bak` + 临时文件原子替换 + 损坏文件旁置（`src/main/durableFile.ts`），且 `will-quit` 会等待设置 flush。
- 测试覆盖较好：790 个通过，连接/多路复用/端口转发生命周期/下载树/上传计划/路径/主机密钥等都有针对性用例。
