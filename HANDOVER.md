# X-SSH 交接文档

> 移动端(Android/iOS,共享 Rust 核心 + 双原生 UI)的工作见 [`mobile/HANDOVER.md`](mobile/HANDOVER.md)。

## 项目概述
- 极简、键盘优先的 SSH 客户端。Electron + Vue 3 (Vite) + TypeScript。
- 平台: Windows (`win32`)。目录: `D:\Documents\Claude Code\X-SSH`。
- **git 仓库**(`main` 分支),远程: `https://github.com/WyattCode/x-ssh`(私有)。
- 版本: `package.json` 当前为 **0.3.0**;有 `CHANGELOG.md`(Keep a Changelog + 语义化)。

## 常用命令(Windows/PowerShell)
- 必须用 `npm.cmd`(直接 `npm` 会因执行策略失败)。
- 校验: `npm.cmd run typecheck`、`npm.cmd run build`
- **单元测试**: `npm.cmd run test`(Vitest 2,与 Vite 5 兼容;共 **267** 用例,全部落在纯逻辑层:`src/shared/*`、`src/renderer/src/lib/*`、`composables/*`)。**没有任何组件测试**,界面交互只能人工验。)
- **i18n 键对称校验**: `npm.cmd run lint:i18n`(现在串跑两个脚本:桌面端 `scripts/lint-i18n.mjs` + 移动端 `scripts/lint-i18n-mobile.mjs`;桌面端 zh / zh-TW / en 640/640/640 全对称,移动端三份资源对称且代码里 0 条内联中文)。
- 打包: `npm.cmd run dist` → `release\X-SSH Setup 0.3.0.exe`(NSIS)+ `release\win-unpacked\X-SSH.exe` + `.blockmap`。
- 无代码签名,SmartScreen 可能提示(正常)。
- **CI**: `.github/workflows/ci.yml`,两个作业 —— `test-build`(`windows-latest`:typecheck → lint:i18n → unit test → build;NOTE: 仅 build,不跑 electron-builder,因无代码签名配置)、`rust-core`(`cargo test --workspace` + `cargo clippy -- -D warnings`;移动端核心不需要设备,所以进了 CI)。

## 架构要点
- **密码/密钥永不离开主进程**:SSH 在主进程(`src/main/ssh.ts`),渲染层经 IPC(preload `src/preload/index.ts`)调用。
- **共享纯函数**: `src/shared/fsUtils.ts`(POSIX 路径 `posixJoin`/`parentOf`、并发钳制 `clampConcurrency`、归档命令构造 `buildPackCommand`/`buildExtractCommand`、粘贴清理 `sanitizePasteText`、私钥识别 `isPrivateKey`/`sanitizeKeyName`),由主进程(`ssh.ts`)与渲染层(store/组件)共用并配套单元测试。**新增通用纯逻辑请放这里**。
- **SSH 密钥库**: `src/main/keyManager.ts` 管理用户密钥到 `<userData>/keys/`(每个密钥一个 id 文件 + `.pub`);`ssh-keygen` 生成/`-lf` 指纹。IPC `keys:list/generate/import/delete` → preload `api.keys.*`。**只存私钥文件不存 passphrase**;主机编辑器(认证为 key 时)从密钥库下拉选择、生成、导入、删除。
- **其余共享纯逻辑**(都在 `src/shared/`,测试与实现同目录):
  - `settingsKeys.ts` —— `settings:set` 的**键白名单**。settings 文件里还住着 `masterLock`(应用主锁的记录)、`connectionLog`、会话历史,所以这一层是必需的,不是洁癖;顺带有一条测试会扫源码,确保渲染层真在用的键都登记过(**加了新偏好却忘了登记,运行时会静默写不进去**)。
  - `localPaths.ts` —— `local:*` 那组 IPC 的路径规则。渲染层同时给目录和条目名,`join(dir, "../..")` 走得出去、`join(dir, "/etc/passwd")` 会整个顶掉 dir,所以条目名必须是**单段**。
- **渲染层的纯逻辑**(`src/renderer/src/lib/`):`reconnect.ts`(重连决策:什么事件该触发重试、退避、网络恢复后该不该复活)、`transferFormat.ts`(字节/速率/相对时间/取消判定)、`fileMode.ts`(chmod 的八进制 ↔ 位 ↔ 符号三种表示必须一致),以及 `paneLayout.ts`、`imeSync.ts`、`shortcuts.ts` 等。
- i18n:`src/renderer/src/lib/i18n.ts`,定义 `zh`(简体)、`zh-TW`(繁体,台湾用语)、`en` 三个字典。**三个键集合必须一致**(现 640/640/640,`npm.cmd run lint:i18n` 校验)。语言偏好 `lang` 可以是 `zh` / `zh-TW` / `en` / `system`,没存过就跟随系统(`src/shared/lang.ts`:Hant 或 TW/HK/MO → 繁体,其余 zh → 简体,其余 → 英文;主进程把 `app.getPreferredSystemLanguages()` 传给渲染层)。**移动端是另一套**(Android 资源 values / values-zh / values-b+zh+Hant,见 mobile/HANDOVER.md M3.62),对称性由 `scripts/lint-i18n-mobile.mjs` 看着。
- **设置文件不能丢**(`src/main/settings.ts`,第十二次会话续修的):用户报"外部编辑器之类的设置过一阵就丢"。原因是关窗时存 `windowBounds` 不 await、紧接着退出,进程死在 `writeFile`(先截断)半路,settings.json 只剩半截;下次启动读不出来就当成空的,第一次 `set()` 把只含一个键的文件写回去,其余全丢(用户那份文件里当时只剩清空之后新写的 7 个键)。现在:每次写先把完整内容写进 `settings.json.bak`,再用临时文件 + rename 替换主文件(Windows 上 EPERM 就重试,一直失败才退回直接写);读的时候主文件缺失 / 空 / 半截就用备份,坏掉的主文件另存 `settings.json.corrupt`;`set()` **同步**排进写队列(原来先 await 一下才排,退出时 flush 会漏掉那一笔);`will-quit` 里等写完(最多 3 秒)再退。`src/main/settings.test.ts` 8 条,其中"半截文件启动后再写一项"那条拿旧实现跑是失败的(阴性对照做过)。
  - **二次复核扩大到所有数据文件**:`hosts.json`(主机列表)、`secrets.bin`、`known_hosts.json` 原来也是直接 `writeFile`,而且主机库读失败时**什么保护都没有** —— 半截的 hosts.json 读成空列表,下一次保存(连接时的 `touch` 就会存)把空列表写回去,所有主机没了。现在共用 `src/main/durableFile.ts`(`writeDurable` 先写 `.bak` 再临时文件 + rename、同一文件在进程内排队写;`readDurable` 主文件坏了读备份、坏文件另存 `.corrupt`;`sweepTemps` 清崩溃留下的临时文件)。主机库 / known_hosts 读不出来且备份也坏时,**不会用空内容覆盖**(和 secrets 原有规则一样)。`durableFile.test.ts` 7 条、`store.test.ts` 3 条,store 那三条拿旧实现跑全失败(阴性对照)。
  - 退出要等写完,窗口销毁后缩放防抖回调再读 bounds 会抛错弹框:关窗时清掉防抖计时器、`persistBounds` 先查 `isDestroyed()`。
- **右键「复制」在 Codex 这类程序里是灰的**(第十二次会话续,用户截图):Codex / Claude Code / vim 打开了鼠标模式,拖动选的是它们自己画的高亮,xterm 没有选区,菜单就把复制禁掉了 —— 而程序其实已经用 OSC 52 把文字复制过来了(`TerminalView.vue` 早就接了 OSC 52)。现在记住最近一次 OSC 52 的内容(2 分钟内有效),终端自己没选区时右键「复制」用它;程序占着鼠标又什么都没复制时,复制下面提示「按住 Shift 拖动来选择」(xterm.js 在 Windows 上 Shift 拖动强制本地选区)。注意:程序跑在 tmux 里时,tmux 默认不转发内层程序的 OSC 52(要 `set -g set-clipboard on`),那种情况只能 Shift 拖动。二次复核补了两条:① 程序那次复制只在它**还占着鼠标**时才算、并且一敲键盘就作废(`term.onKey`;不能用 onData —— 鼠标模式下右键本身就会经 onData 报给程序),否则旧的 OSC 52 文字会盖掉用户在别处复制的东西;② 右键菜单原来按固定 240px 估高度往回收,实际约 310px,靠近窗口底部右键时最后几项被切掉(用户截图里就是),现在渲染后量实际尺寸再收进窗口。
  - 动态键模式: `tab.*` / `group.*` / `sck.*` / `sck.*Hint`(缺失 hint 回退 `''`)。
  - 主题名(Nord/Dracula 等)为专有名词 **不翻译**,不建键。
- 产品理念: 极简、键盘优先、密码/密钥不出主进程。
- 更新功能(在线检查更新)按用户要求**已移除**。

## 已知限制 / 注意
- **shell 集成 + `onConnect` 同时开启**: `onConnect` 命令仍会执行,但其输出可能被 shell 集成首屏的屏清序列吞掉(边缘组合)。
- **双面板远程→本机** 仍走系统原生「拖出到桌面」(原生拖拽一次仅一个文件,多选并行拖出非 Electron 支持)。
- **上传续传注意**: 每个文件上传前都做 `statSize` 与本地 `stat`,大目录批量上传会增加往返延迟(为正确性而做)。
- 快照/标签恢复保存的 pane 参数已剥离 `password`/`passphrase`,恢复后为**断开状态**,需用户重新连并重新输入凭据。
- **背对玻璃拟态**: `backdrop-filter` 在低核/弱 iGPU 机器上开销大,`renderer/src/main.ts` 启动时探测 `hardwareConcurrency`/`deviceMemory`,命中则给 `<html>` 加 `.perf-no-blur` 全局关闭模糊(仅保留半透明)。
- **`settings:set` 只接受白名单里的键**(`shared/settingsKeys.ts`)。渲染层被拒时 `store.saveSetting` 会 `console.error` —— "界面说存好了、其实没写进去"是这一类里最贵的 bug。
- **主进程里没有非空断言了**。需要 SSH 管理器的地方用 `requireSshManager()`(只有晚于窗口创建的 handler 才可以用);能在窗口创建前被调用到的(如 `sessionLog`、fire-and-forget 的 `send`)必须自己判空。

## 下一步(如果继续)
- **待亲眼看的**(第十二次会话末只过了 typecheck / 单测):设置 → 常规 → 语言那一排四个按钮排不排得下;
  Codex 里右键「复制」和菜单靠底部时收进窗口;繁体界面整体过一遍。
- `CHANGELOG.md` 还没写这一轮(三种语言、设置 / 主机列表防丢失、右键复制);要发版时补上并改版本号。
- 按用户截图式 UI 反馈继续修复。
- 如版本号增加,改 `package.json` + 更新 `CHANGELOG.md` 后 `npm.cmd run dist` 重打包。
- 大规模改动前先跑 `npm.cmd run typecheck && npm.cmd run build` 与 `npm.cmd run lint:i18n` 保证通过。

# 会话记录:第十二次会话后半(2026-09-27 晚,提交 `f6fef73`)

- **繁体中文 + 跟随系统**:`i18n.ts` 加 `zh-TW` 字典(台湾用语,640 条),设置里语言四个按钮,`src/shared/lang.ts` 做系统语言识别,
  托盘菜单也按同一套规则。没存过语言时**从默认简体改成了跟随系统**(英文 Windows 上会显示英文)。
- **设置 / 主机列表防丢失**:见上面「架构要点」里「设置文件不能丢」那两条(`durableFile.ts`、`will-quit` 等写完)。
- **右键复制**:见「架构要点」里「右键「复制」在 Codex 这类程序里是灰的」。
- 部署:`D:\Apps\X-SSH` 已是这版(robocopy 后 `app.asar` / `X-SSH.exe` 哈希与 `release\win-unpacked` 一致)。
  桌面快捷方式那个 `%USERPROFILE%\Desktop\X-SSH` 目录现在不存在,只部署了 `D:\Apps\X-SSH`。
- 测试 267 条(新增 `settings.test.ts` 8、`store.test.ts` 3、`durableFile.test.ts` 7、`lang.test.ts` 20);
  `store.test.ts` 与 settings 的"半截文件"用例拿旧实现跑全失败(阴性对照)。
- 移动端这一轮见 `mobile/HANDOVER.md` M3.60–M3.62。

# 会话记录:第十二次会话复核(2026-09-27)

把上一个会话(第十、十一次)留在工作区、还没提交的改动逐文件读了一遍,找出 2 个 bug;
用户又要求把复核中发现的老问题一起修掉。全部在 `e90222a` 里提交。

**这批改动里的 bug**

1. **移动端「密码 读不出来」永远不出现**。`brokenSecrets` 拿 `Host.locked*` 去判,可 `HostStore.load`
   只往 `locked*` 里放**加锁**的密文,而加锁的又被排除在外 —— 一条都报不出来。测试之所以绿,
   是因为它手工造了 `Host(lockedPassword = 普通密文)`,一个 `load` 永远产生不了的状态。
   改成 `load` 解密时就记下 `Host.unreadableSecrets`(顺带不再在每次重组时解密三条)。
   `SecretState` / `readPlainOrNull` / `brokenSecrets` 删掉,`UnreadableSecretsTest` 只用 `load` 真会给的形态;
   阴性对照做过。详见 `mobile/HANDOVER.md` M3.58 第 3 条。
2. **条目名检查把 Windows 规则套到了所有平台**(`shared/localPaths.ts`)。同一套检查也管重命名和删除**已有**文件,
   于是 macOS / Linux 上 `backup-10:30.tar` 这种名字列得出来、删不掉也改不了名。Windows 专属规则
   (保留字符、结尾的点和空格)现在只在 Windows 上生效;NUL 和越权写法各平台都拒。补了 4 条测试。

**顺带修掉的老问题(改动之前就有)**

3. **本地面板在 macOS / Linux 上拼出反斜杠**:原来一律 `dir + '\\' + name`,得到 `/Users/me\notes.txt`。
   现在 `localJoin` / `localParent`(`shared/fsUtils.ts`)看路径本身的形态选规则。
4. **在 `C:\Users` 点「上一级」到了奇怪的地方**:原来得到 `C:`,而 Windows 把 `C:` 理解成
   "C 盘上的当前目录"(`path.normalize('C:')` 是 `C:.`)。现在落在 `C:\`,`C:\` 再往上还是它自己。
5. **递归改权限让文件夹进不去**:原来文件和文件夹一律用同一个权限,选 644 递归下去,所有文件夹都没了执行位。
   现在文件夹凡是有读权限的位置同时加上执行位(chmod 的 `X`,`treeDirMode`),文件严格按所选;
   单个条目、不递归时照原样。勾选框文案同步改了(中英文)。

**小整理**:`decideStatusEvent` 的 `markClosed` 改名 `setStatus`(它对 connecting / connected 也用);
`index.ts` 里一个顶层函数缩进错了、两处注释顶格;`formatBytes` 的注释提到一个不存在的参数。

**验证**:桌面 typecheck 干净、vitest 229 个、`electron-vite build`、`lint:i18n` 都过;安卓 33 个 JVM 单测过。
**没在运行中的桌面应用里点过** —— 改权限和本地面板这两块只有单测覆盖,下次用桌面版时顺手试一下。

# 会话记录:全面复核与修复(2026-09-26)

## 二次复核(同日,PC 端)

改完之后又自己通读了一遍改动,查出并修掉 5 个问题。这一步值得单记 —— 测试全绿并不等于逻辑对。

**真 bug 两个**

1. **`resolveInside` 拒绝一切根目录下的操作**(`shared/localPaths.ts`)。包含性判据写成 `base + sep`,
   而 `normalize("C:\\")` 会保留尾分隔符,于是前缀变成 `C:\\` —— **驱动器根目录下什么都建不出来**,
   带尾斜杠的目录同样中招。改成"路径已以分隔符结尾就不再补一个"。
   补了两条测试,并用阴性对照确认它们在旧逻辑下会失败(正好那两条挂)。
   真实路径上端到端验过:家目录能列(65 项)、`C:\` 下能建、四种越权写法仍全被拒。
2. **`closePane` 里的 `pane.sshSessionId!`**(`stores/sessions.ts`)。`await confirm(...)` 会让出,
   期间会话可能掉线把 id 清掉,之后这个断言就把 `undefined` 发过了 IPC。改成重新读一次再判空。

**我自己留下的三处噪音**

- `decideStatusEvent` 的 `retired` 参数是死的(真正的判断在 `applyEvent` 里提前返回,抽函数时写在了两层),
  另外 `reconnectAttempt` / `connectRetries` / `notify` 传了或返回了却没人读。接口收成实际用到的三个,
  那条测死分支的测试也删了。
- `TransferPanel` 里 `statusText` 和 `isCancelled` 导了没用(改包装函数时留下的)。
- 三处拒绝返回值是英文 `invalid name`,而它们会直接显示在新建/重命名弹窗里,旁边的错误都走 `friendlyError` 是中文。
  统一改成中文。另有一处注释写着 "refusals are logged" 但代码里没有日志,改成与实现相符。

**顺带核实的**

- `emitProgress` 是所有进度事件的唯一出口,而三条取消路径都是「先发终止事件、后删 `cancelledJobs`」,
  所以新加的 `cancelled` 标志每次都读得到 —— 逻辑成立。
- `settings:set` 的 15 处**直接调用**(绕过 `store.saveSetting`、拿不到拒绝日志)用的键全在白名单里;
  测试的扫描模式原本只覆盖两种写法,第三种是巧合命中,已写明确。

**复核中发现但没动的**:`ForwardDialog`、`PaneNode`、`App.vue`、`glob.ts` 里还有几处非空断言,
都在这一轮没碰过的代码里,逐处判断需要各自的上下文 —— 属于重构,不该混进来。

**这一轮踩的坑(工具层面)**

- **PowerShell 的 `Set-Content -Encoding UTF8` 会写 BOM**,用它改 `App.vue` 时加了 BOM 并把 9 个中文字符变成乱码
  (还会按 LF 重写、丢掉 CRLF)。已从 git 还原,之后改写文件一律走 Node。
- **`\u001b` 在 Node 里既是「ESC 字符」也是「反斜杠-u-0-0-1-b 这段文本」**,用它做查找替换会把已经正确的转义也一起改掉。
  Rust 字节串又要 `\x1b` 而不是 `\u{1b}`(后者编译不过)。这一处来回改了三遍才对。
- **测试期望值自己写错一次**(`ESC[1;2A` vs `1;3A`):公式是 `1 + Alt(2) + Ctrl(4)`,Shift 那一位由实体键盘分支另算。

通读全部代码后做的一轮修复。范围:**真缺陷 + 重复实现 + 测试盲区**,不做架构重构。
每一条都跑过 `typecheck` / `build` / `lint:i18n` / 桌面 `test` / `cargo test` / `clippy` / 安卓 `testDebugUnitTest`。

## 一、真缺陷(每条都有测试钉着)

### 移动端(会永久丢凭据的那一类)

1. **加锁主机 + 换登录方式会丢凭据**。`HostDraft.build()` 里三条 `locked*` 密文是无条件透传的,`carriedSecrets()` 把规则抽出来并配测试。
2. **加锁记录可能带上一条普通密钥的密文**(最严重)。`buildHostForSave` 兜底沿用旧密文时没看它是不是 `L:` 前缀 —— 那一条落盘后 `Secrets.open` 只认普通密钥、`readLocked` 只认 `L:`,`lockSecrets` 却写着 true,密码**两边都读不出来**。`carriedLocked()` 拒绝这种组合。
   - **阴性对照做过**:把修复临时禁用,只有为它命名的那条测试失败,其余全过。
3. **"没存过"和"存了但读不出来"分不开**。重装/密钥库被清之后 `Secrets.open` 返回空串,界面说「未保存」,用户以为从没存过而反复重填。~~新增 `SecretState` / `readPlainOrNull`~~ —— **这一版从没生效过,第十二次会话重做**(见下面「第十二次会话复核」第 1 条)。

### 桌面端

4. **`settings:set` 接受任意键**:而 `masterLock` 就在同一个 settings 文件里 —— 渲染层改掉它,内存里的 `MasterLock` 要到下次启动才发现。现在有白名单(`shared/settingsKeys.ts`)。
   - 补完白名单后跑了一次源码扫描核对,**发现漏了 `sftpTransferHistory`**;这条审计固化成测试,加了新键忘了登记会**测试失败**而不是运行时静默。
5. **`local:*` 五个 handler 的路径只做 `join`**:`local:delete` 还带递归。`join(dir, "../..")` 走得出去,`join(dir, "/etc/passwd")` 顶掉 dir。现在条目名必须是单段(`shared/localPaths.ts`),越权、Windows 保留名、兄弟目录前缀都有测试。
6. **重连竞态**:`reconnect()` 里 `void disconnect()` 之后立刻清 `sshSessionId`,而那条会话的事件随后才到 —— 被当成新会话掉线,自动重连失效、甚至把刚建好的连接判成 error。`retiredSessions` 认得出主动退役的会话。
7. **`errorCode` 只在连接成功时清除**:一个曾以 `locked` 失败的 pane,`handleNetworkOnline` 的 `!errorCode` 判据会**永久为假**,自动恢复对它失效。改成重试开始时就清。
8. **取消态在英文界面被当成失败**:`SftpDrawer` 与 `TransferPanel` 各写一份取消判定,都匹配中文 `"已取消"`,而英文的 `sfp.cancelled` 是 `"Cancelled"`。主进程现在写结构化的 `cancelled` 标志,不再靠比对文案。

## 二、重复实现收敛

- `transferFormat.ts`:`fmtSize`/`fmtBytes`/`fmtAgo`/`timeAgo`/`isCancelled`/`statusText`/`pct` 原来在两个组件里各一份(略有出入,取消判定就是因此分叉的),现在一处。
- `fsUtils.ts` 新增 `windowsJoin`/`windowsParent`(本地面板用,与 POSIX 版刻意分开:远端恒为 POSIX,本地是这台机器),配 7 个边界测试。
  (第十二次会话:本地面板改用按路径形态选规则的 `localJoin` / `localParent`,macOS / Linux 不再拼出反斜杠。)
- `Lock.reset` 与 `disable` 的实现逐字相同 → 抽 `forget()`。
- `store.ts` 里两处 `const { x: _p } = …; void _p` 的绕法 → `stripRuntimeFlags()`。

## 三、清理

- **`App.vue` 里 92 行死样式**(`.idle*`)。注意:`PaneNode.vue` 在**用**这些类名,但它有自己完整的一份副本(带 `position: absolute`,那才是生效的);App.vue 那份在 `<style scoped>` 下永远不适用。删之前扫过子组件确认。
- `CommandPalette` 的 `if (store.snapshots.length || true)` 恒真分支、`selected.value = 0` 的重复赋值。
- `index.ts` 里一个悬空的文档注释(常量早就挪走了)。
- **主进程 21 处非空断言归零**:`requireSshManager()` 让假设显式,能早于窗口创建的 handler 自己判空。
- **5 个裸控制字符**。`HardwareKeys.kt` 的 `ESC`、`DEL`、**NUL** 是作为真实字节写进源码的(编辑器里看不见、评审也看不见 —— 手册里记的坑 56 就是这个),`FontPicker.kt`/`TerminalScreen.kt` 的 U+001F 分隔符、`terminal.rs` 的 ESC 同理。全部换成转义,值不变。

## 四、测试与工具

- **桌面端 140 → 218** 个用例。新增 `settingsKeys`、`localPaths`、`reconnect`、`transferFormat`、`fileMode` 五组。
- **安卓端从零建起 JVM 单测**(`app/src/test/`,原来一个测试目录都没有):`CredentialCarryTest`、~~`SecretStateTest`~~(第十二次会话换成 `UnreadableSecretsTest`)、`LocalNetworkTest`、`KeyEncoderTest`,共 32 个。为此在 `build.gradle.kts` 加了 `testOptions` 与 JUnit。
  - `KeyEncoderTest` 值得留着:按键编码错了**不会报错**,发出去的是合法但错误的字节,远端要么插进正文要么不认。DECCKM(应用光标)、Ctrl 映射、SGR/X10 滚轮、括号粘贴都钉住了。
- **`scripts/lint-i18n-mobile.mjs`**(新):校验 `values/` 与 `values-en/` 的键集合与占位符对称,并检查 Kotlin 里的 `R.string.*` 都有定义。已并入 `npm run lint:i18n`。它同时报出「还没迁移的硬编码中文界面串」的**数量**(现 41 条,分布在 7 个文件),这个数就是迁移进度。
- **CI 增加 `rust-core` 作业**:`cargo test --workspace` + `cargo clippy -- -D warnings`。移动端核心不需要设备,本来就该进 CI。

## 五、组件拆分(保守)

只把**边界清楚、自成一体的**挪出去,不动内部逻辑:`SftpDrawer` 2961 → 2571 行。
- `PermDialog.vue`(chmod):连样式一起搬走,位运算抽成 `fileMode.ts` 并配 16 个测试(八进制/位/符号三种表示必须一致 —— 显示错了会把错权限应用到真文件上)。
- `DirDiffDialog.vue`(目录对比):只读,自带扫描。
- `SettingsDialog.vue` 1935 行**没动**:它的各个分区共享大量状态,按现在的把握拆容易把行为改掉。留作下次。

## 六、这一轮自己踩的坑(记下来)

- **PowerShell 的 `Set-Content -Encoding UTF8` 会写 BOM**。用它改 `App.vue` 时加了 BOM 并把 9 个中文字符变成乱码(9800 行的 `Set-Content` 还会按 LF 重写、丢掉 CRLF)。已从 git 还原,之后所有文件改写一律走 Node。`strings.xml` 也被这个坑过一次。**改这个仓库里的非 ASCII 文件,不要用 PowerShell 写回。**
- **`\u001b` 在 Node 里既是「ESC 字符」也是「反斜杠-u-0-0-1-b 这段文本」**,用它做查找替换会把已经正确的转义也一起改掉。Rust 字节串又要 `\x1b` 而不是 `\u{1b}`(后者根本编译不过)。这一处我来回改了三遍才对。
- 测试期望值自己写错一次(`ESC[1;2A` vs `1;3A`):**公式是 `1 + Alt(2) + Ctrl(4)`**,Shift 那一位由实体键盘分支另算。

## 七、还没做

- 移动端 41 条硬编码中文串迁到 `strings.xml`(需要给 7 个 Compose 文件引入资源,改动面不小,而且要在真机上过一遍)。
- `masterLock` 那条路还能更严:目前只是拒绝渲染层写,没校验值本身。
- 桌面端仍然**没有组件测试**(218 个用例全在纯逻辑层)。

---

# 更早的会话记录
### A. 既有功能(第 1~3 轮,已完成并打包)
本地端口转发、代理跳转、分组 + OpenSSH 导入、命令片段、已知主机、通知、状态栏、标签颜色、命令面板、多行粘贴确认、自定义终端主题、下载断点恢复、i18n 框架;全站 i18n 迁移;欢迎页 `user@host` + `<code>` 强调;`documentElement.lang` 初始化。

### B. 本轮新增功能(全部 typecheck/build 通过)
1. **SSH Agent 转发 `-A`** — 主机级 `Host.agentForward`;主进程 `config.agentForward` + 自动取 agent socket(`ssh.ts`、`HostEditor.vue`、`shared/types.ts`)。
2. **连接后自动命令** — 主机级 `Host.onConnect`;shell 就绪后 `stream.write(onConnect + '\n')`(`ssh.ts`)。
3. **标签拖拽排序** — `TabBar.vue`(draggable/`dragstart`/`drop`)+ `store.moveTab(fromId,toId)`。
4. **命名会话快照** — `Snapshot` 类型、`store.saveSnapshot/deleteSnapshot/openSnapshot/loadSnapshots`;持久化到 settings `snapshots`;命令面板新增「会话快照」区(一键保存 + 恢复列表)。
5. **命令片段确认** — `Snippet.confirm`;`store.sendSnippet` 异步 + `useConfirm` 弹窗;`SettingsDialog` 片段表单加「发送前确认」勾选。
6. **命令历史跨重启持久化** — 关窗(`win.on('closed')`)把 `sshManager.historyList()` 合并写入 settings `sessionHistory`(上限 300 条);`history:list` 返回 [persisted, ...live]。
7. **上传断点续传** — 上传前 `statSize` 比对远端,`start=offset` 续传,远端>=本机则跳过并计入进度。
8. **SFTP 双面板(本机侧)** — 抽屉工具栏「本机」切换;本机目录浏览(nav/双击/上级);拖拽本机文件到远程面板即上传(自定义 MIME `application/x-ssh-local`)。新增 IPC `local:list`/`local:home` + preload `api.local.list/home` + main handler。

### C. 复核修复(本轮)
- `submitQuick` 命中已保存主机时,`quickConnect` 返回 `'needs-password'` 未处理 → 补 `.then` 打开命令面板输密码。
- **删除**了欢迎页快速连接输入框(`>_ 输入 ssh://…`)。相关代码全部清除:`parseAddr`/`submitQuick`/`quickText`/`quickInitial`、`HostEditor` 的 `initial` prop、`.quick` CSS、i18n 键 `app.quickPh`。

## 本会话改动文件
- `src/main/ssh.ts`: agent forward、`onConnect`、上传断点续传、`stat` 导入。
- `src/main/index.ts`: `history:list` 合并 persisted、`local:list`/`local:home` handler、`win.on('closed')` 持久化历史、`stat`/`readdir` 导入、`LocalEntry` 导入。
- `src/shared/types.ts`: `Host.agentForward/onConnect`、`ConnectParams.agentForward/onConnect`、`Snippet.confirm`、新 `LocalEntry` 接口。
- `src/shared/ipc.ts`: 新增 `localList`/`localHome`。
- `src/preload/index.ts`: 新增 `api.local`。
- `src/renderer/src/stores/sessions.ts`: `moveTab`、`Snapshot` 类型与 actions、`restoreTabsFrom`(复用/兼容旧格式)、`sendSnippet` 异步 + confirm、`quickConnect` 传 agentForward/onConnect、模块级 `useConfirm`。
- `src/renderer/src/components/CommandPalette.vue`: 会话快照区;`sendSnippet` 改 `void`。
- `src/renderer/src/components/TabBar.vue`: 拖拽排序。
- `src/renderer/src/components/SftpDrawer.vue`: 本机双面板(状态/函数/模板/CSS)、`onDrop` 读取自定义载荷。
- `src/renderer/src/components/SettingsDialog.vue`: 片段 confirm 表单。
- `src/renderer/src/components/HostEditor.vue`: agentForward/onConnect 表单项(本轮已还原 `initial`)。
- `src/renderer/src/App.vue`: 移除欢迎页快速连接输入及配套逻辑/CSS (本轮);`loadSnapshots` 挂载。
- `src/renderer/src/lib/i18n.ts`: 新增/删除多个键,保持 zh/en 一致。
