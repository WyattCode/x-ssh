# X-SSH 交接文档

> 移动端(Android/iOS,共享 Rust 核心 + 双原生 UI)的工作见 [`mobile/HANDOVER.md`](mobile/HANDOVER.md)。

## 项目概述
- 极简、键盘优先的 SSH 客户端。Electron + Vue 3 (Vite) + TypeScript。
- 平台: Windows (`win32`)。目录: `D:\Documents\Claude Code\X-SSH`。
- **git 仓库**(`main` 分支),远程: `https://github.com/WyattCode/x-ssh`(私有)。
- 版本: `package.json` 当前为 **0.5.0**(2026-10-28 发;这一轮把「只在编译里过关的交互」真正点了一遍,见第二十三次会话)。有 `CHANGELOG.md`(Keep a Changelog + 语义化),`v0.5.0` tag 已推。

## 常用命令(Windows/PowerShell)
- 必须用 `npm.cmd`(直接 `npm` 会因执行策略失败)。
- 校验: `npm.cmd run typecheck`、`npm.cmd run build`
- **本地 SFTP 靶机**:`powershell -File scripts\dev-sshd.ps1 start|stop|status|clean`。密钥、配置、`authorized_keys` 全在 `%TEMP%\xssh-target`,只绑 `127.0.0.1:2222`,**不碰 `%USERPROFILE%\.ssh`**;客户端私钥是 `%TEMP%\xssh-target\id_dev`(主机编辑页「密钥」直接填这个路径),登录用户是你当前 Windows 账号。配置里**不能写 `PerSourcePenalties`**(Windows 自带的 OpenSSH 是 9.x,不认识,写了 sshd 直接起不来)。脚本按 PID 文件停进程 —— 别自己按命令行匹配杀,会把执行命令的 PowerShell 一起匹配掉。
- **单元测试**: `npm.cmd run test`(Vitest 2;共 **334** 用例 / **30** 个文件:纯逻辑在 `src/shared/*` / `src/renderer/src/lib/*`,外加 `src/main/*.test.ts` 的集成测试(起真 ssh2 服务器),以及两个源码静态检查(`focusTrapCoverage`、`imeEnterCoverage`)。**没有任何组件测试**,界面交互只能人工验。
  - **配置里钉死了单进程**(`vitest.config.ts` 的 `singleFork`),别改回默认并行:Windows 上并行会让 Vitest 的 SSR 模块缓存互相踩,随机一整个文件报 `EPERM open ...\ssr\<hash>` 然后**静默不收集**,那一跑仍然报绿、只是数字变小(实测同一份代码连跑 10 次出现过 334 / 325 / 326 / 313 / 331 五种结果)。**看到用例数比 334 少,先怀疑这个,别怀疑测试挂掉。**
- **i18n 键对称校验**: `npm.cmd run lint:i18n`(现在串跑两个脚本:桌面端 `scripts/lint-i18n.mjs` + 移动端 `scripts/lint-i18n-mobile.mjs`;桌面端 zh / zh-TW / en 722/722/722 全对称,移动端三份资源对称且代码里 0 条内联中文)。
- **发版流程**:升 `package.json`/lock(`npm.cmd version x.y.z --no-git-tag-version`,会把 `schemes` 那行重排,手动还原)+ CHANGELOG → 提交推 `main` → `git tag vx.y.z` 并推 tag;CI(`ci.yml` 的 `release` 作业,windows-latest,约 8 分钟)自动建 GitHub Release 并挂 `X-SSH.Setup.x.y.z.exe` + `.blockmap`。**安卓不在这条流水线里**,APK 只能本机 `installDebug`。
- **本机部署**:`npm.cmd run package` → 关掉 `D:\Apps\X-SSH` 里的进程(按精确路径 `Path -eq 'D:\Apps\X-SSH\X-SSH.exe'` 筛,别按窗口标题;用户授权过可代关)→ `robocopy release\win-unpacked D:\Apps\X-SSH /E` → 对比 `X-SSH.exe` / `resources\app.asar` 哈希。**本机装的还是 2026-10-08 的旧构建**,0.4.1 / 0.5.0 都没部署过(2026-10-29 核过 `D:\Apps\X-SSH\X-SSH.exe` 的 mtime)。
- 打包: `npm.cmd run dist` → `release\X-SSH Setup 0.5.0.exe`(NSIS)+ `release\win-unpacked\X-SSH.exe` + `.blockmap`。electron-builder 已是 **26.x**。`release/` 里现在只有 0.4.0 的 Setup exe,win-unpacked 是 10-17 的。
- **图标**:全部由 `python build/icon-src/make_icons.py` 生成(Pillow + numpy),别手改产物。几何是从 `build/icon-src/reference/` 里用户给的三张参考图拟合的
  (两根镜像的平行四边形条、水平切口、倾角约 45.4°、圆角 63/1024,形状 IoU 0.97)。产物:`build/icon.icon`(macOS 26/27 Icon Composer 文档:
  四个 SVG 图层,白天 / 夜间两套条靠 `hidden-specializations` 切换,背景 `fill-specializations`;按 HIG 图层是**不带圆角的方形**、不自己画阴影高光)、
  `build/icon.png/.ico/-512/-256/.svg`(Windows / Linux / 托盘:夜间配色圆角方块;ICO 含 16~256 共 15 帧,覆盖 Windows 各缩放比例,每帧单独渲染、不是缩小来的;
  **小尺寸优化**:夜间配色「/」条中段和底几乎一样黑,16~24px 时会整段消失,所以 <64px 的图把它最暗处往 `SMALL_FLOOR` 抬,16px 抬满、64px 起不动)、
  `src/renderer/src/assets/logo-light|dark.png`(欢迎页字标,出图 192px 高 = 显示 48px × 4 倍,够 300% 系统缩放 × 应用 1.2 倍缩放;用户嫌 X 太大、离字太远,拆开重排:用户定的比例是 X 和字母**一样高**、上下对齐、间距 0.22 倍字高(参照 MCode 的字标,量过:标高 = 字高、间距 0.22、竖笔 0.23 倍字高),SSH 直接用用户给的设计稿 `build/icon-src/reference/ssh-{dark,light}.png`(之前自己腐蚀变细把字形弄坏了,用户否掉;**别再改笔画**),X 直接用应用图标原图 `reference/icon-{dark,light}.webp`(用户要求和应用图标统一;横幅已不再用),只抠底、缩放到字高;抠底门槛按每张图的底噪单独给,且只按一个方向算不透明度(深底只看比底亮的),否则白天版浅色条端会被抠掉、黑底会泛雾;夜间版 X 在白字旁显暗(用户反馈),对它的不透明度做了 gamma 0.6 提亮(`MARK_GAMMA`,只动字标不动应用图标),欢迎页显示高 48px;原来的欢迎语用户不要,已删)、安卓 `drawable(-night)/ic_launcher_*`、`ic_stat_session`。`icon.json` 用 dfabulich 的非官方 schema 校验过(含阴性对照),
  托盘图标按平台给:Windows 用 `icon.ico`(系统按 DPI 取对应帧,Electron 官方推荐),macOS / Linux 从 1024 图缩成 16pt / 24px 各带 @2x —— 以前直接给 1024 的 PNG。
  **Vue 坑**:scoped 样式里别写 `:global(:root[data-theme='light']) .lockup-light`,Vue 3.5 会把后半截丢掉、编出 `:root[...]{display:none}`,浅色主题整个窗口空白(本批差点带出去,复核时在编译后的 CSS 里发现);祖先选择器直接写就行。
  复核手法:SVG 用无头 Electron 光栅化后和 numpy 位图逐像素比(内部 ≤6 级、差异全在边缘抗锯齿);欢迎页用无头 Electron + 桩 preload 两种主题都截过图;安卓 `assembleDebug` 通过、APK 里白天 / 夜间两套都在,X 离中心最远 29.5dp(安全圆 33dp)。
  但**没有在 Icon Composer 里打开过、也没在 Mac 上打过包**(这台是 Windows):macOS 包必须在装了 Xcode 26 的 Mac 上打,electron-builder 会调 actool 编 Assets.car。
- 无代码签名,SmartScreen 可能提示(正常)。
- **CI**: `.github/workflows/ci.yml`,两个作业 —— `test-build`(`windows-latest`:typecheck → lint:i18n → unit test → build;NOTE: 仅 build,不跑 electron-builder,因无代码签名配置)、`rust-core`(`cargo test --workspace` + `cargo clippy -- -D warnings`;移动端核心不需要设备,所以进了 CI)。

## 架构要点

- **主机密钥:首次连接也人工确认(第十五次会话,2026-10-03)。** 原来 `connect()` 对**未知**主机密钥静默记下就放行(纯 TOFU)、`connectJump()` 对跳板机同样静默信任;「变更」才拒绝。现在 `hostVerifier` 对**未知 / 变更都拒绝**,把服务器出示的 SHA-256 指纹回传渲染层,面板弹(与密钥变更同款)确认卡,用户点按钮经新 IPC `ssh:trustHostKey`(写 `known_hosts.json`)显式信任再重连——替代原来的「删除记录 + 重碰」。跳板机密钥失败从此自带 code / 指纹 / 是哪一台(`KeyError`,`connect` 的 catch 透传),不再被吞成无 code 的普通失败;密钥类报错改按界面语言翻译(原来英文界面弹主进程硬编码中文)。`quietExec` 的后台探测不放松(仍只碰已记录主机);连接复用(multiplex)复用已验证过的连接,不引入新信任面。`src/main/connect.test.ts` 起真 ssh2 服务器 5 条钉住这条链。- **密码/密钥永不离开主进程**:SSH 在主进程(`src/main/ssh.ts`),渲染层经 IPC(preload `src/preload/index.ts`)调用。
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
- **主题三选一**(跟随系统 / 浅色 / 深色,和安卓同名):`composables/theme.ts` 存选择 `pref`、算出实际显示的 `mode`;顶栏按钮**点一下换下一个**(跟随系统 → 浅色 → 深色,和安卓 `ThemeMode.next()` 同序;用户明确不要菜单),图标同安卓(跟随系统 = 左半实心的圆 `auto`,`Icon.vue` 里以 `F ` 开头的段是实心填充),提示显示当前选择;设置 → 常规也有一排。写入走专门的 `theme:set`(主进程校验值、存盘、把 `nativeTheme.themeSource` 钉到选择上 —— Windows 标题栏跟着变 —— 并回传实际深浅),所以 `theme` 已从 `settings:set` 白名单挪到 `MAIN_ONLY_KEYS`。钉 themeSource 会连带钉住渲染层的 `prefers-color-scheme`,切回「跟随系统」时用主进程回传的真实值,不然会先闪一下旧颜色。窗口首帧底色也按实际深浅选。原来那个切换按钮的提示点完一直是「切换到日间模式」,根因在 `TooltipLayer.vue`:悬停时它把 `title` 摘下来暂存,Vue 此时改了 title 会写回元素,离开时它却把**暂存的旧文字**放回去,而 Vue 以为已经是新值、不会再改 —— 旧文字一直留着。现在悬停期间用 MutationObserver 盯着 title,改了就更新提示和暂存值(所有动态提示都受益)。
- **缩放百分比提示**(`composables/zoom.ts` + `components/ZoomHud.vue`):快捷键 / Ctrl+滚轮 / 药丸自己的按钮缩放时,顶栏下方弹出玻璃药丸(− 百分比 + 重置,细条标出位置和 100% 刻度),1.5 秒后淡出,鼠标停在上面不消失;药丸用 CSS `zoom: 1/倍率` 反向缩放,界面怎么缩它都一样大。倍率 = 1.2^级别,级别 -3…5、步长 0.5。
- **界面框架(09-29 重做,照用户给的设计图)**:左侧栏 `components/AppSidebar.vue`(连接 / 终端 / SFTP / 端口转发 / 设置,底部主题循环 + 收起成 64px 图标栏),右侧按 `store.page` 切页。
  - **终端页**一直挂载(`v-show`),其余页 `v-if`;`PaneNode` 的 `tab-active` 带上 `page === 'terminal'`,回到终端页时会重新 fit + 聚焦。关掉最后一个标签回连接页;启动时恢复了标签就直接进终端页。
  - 终端页标签栏右侧那排按钮里的「专注模式」(图标 `focus` = 窗口 + 虚线的侧栏(淡出)+ 只剩一个 `>_` 提示符 —— 表面是收起侧栏、核心是沉浸不被打扰;用户先后否掉了侧栏图标、取景框、Windows 靶心,又看过两轮候选(横向铺满 / 耳机 / 水滴 / 层层深入 / 聚光灯等)才定下这个;`store.termSidebarHidden`,设置键 `termSidebarHidden`,点一下隐藏侧栏、再点恢复,记住用户上次的选择,进终端页时自动套用;用户明确不要放左上角;叫过「全屏」,用户嫌和窗口全屏混淆):隐藏时侧栏直接 `display:none`、终端铺满窗口;**不做宽度动画** —— 终端会跟着宽度 fit,动画会连发一串 resize 给服务器。其他页侧栏照常显示。
  - 作用于终端的快捷键(关标签 / 关窗格 / 分屏 / 切窗格)只在终端页生效 —— 不然在连接页按 Ctrl+W 会关掉看不见的终端;SFTP 快捷键在终端页开抽屉、在别的页去 SFTP 页。
  - `openConnection(params, title, { stay })`:默认切到终端页,SFTP 页里连主机时 `stay` 留在原页。`toggleSettings` 现在切「设置」页,关掉回到进来前的页(`prevPage`)。
- **圆角规范(09-29,照 macOS 27 / WWDC25「新设计系统」)**:`styles/global.css` 里一套变量 —— `--r-card` 16(内容卡片)、`--r-tile` 11(卡片里的图标方块,同心算出来太小时用的回退值)、`--radius-sm` 8(中号控件:文本框、下拉、表单按钮)、`--radius` 12(对话框)、`--r-menu` 12 / `--r-item` 7(菜单和菜单项,同心:12 − 5 内边距)、`--r-pill`(胶囊)。原则:**嵌套形状同心**(内圆角 = 外圆角 − 间距);小/中号控件用圆角矩形,**大号和突出的控件用胶囊**(工具栏搜索框、加号、排序、视图切换、分组标签、会话条)。macOS 27 侧栏贴边、**选中项不画竖条、只给图标上色**(用户也明确不要那根蓝线)。Electron 33 = Chromium 130,还不支持 CSS `corner-shape: squircle`(139 起),所以没做连续曲率圆角;以后升级 Electron 可以加上。
- **终端抖动修复**(用户报了两次):① 终端页上侧栏收起 / 展开不做宽度动画(`.sidebar.instant`)—— 动画会让终端每帧挪零点几像素,WebGL 画的字一路闪;② `TerminalView.scheduleFit`:一次性的尺寸跳变(专注模式、收起侧栏)**立即** fit,连续变化(拖侧栏边、拉窗口)等停下 90ms 再 fit 一次 —— 原来每帧都 fit、每帧 reflow;③ 尺寸没变就不再给服务器发 resize(`sentSize`);④ 侧栏状态(专注模式 / 收起)一变,`TerminalView` 直接 nextTick 里 fit,不等 ResizeObserver(它只随下一帧渲染到达)。实测(假会话 + 记录 `ssh.resize`):进出专注模式、收起侧栏各只发 1 次、3ms 内;连续拉窗口 12 步只在停下后发 1 次。注意:后台隐藏窗口里 ResizeObserver 会漏报,测这类问题要靠直接触发或记录 resize 调用。
- **侧栏可拖宽**:右边缘 6px 拖拽条(`AppSidebar` 的 `.edge`,pointer capture),180~360px,松手存 `sidebarWidth`;收起(64px)时不能拖。设置 → 常规 →「边栏」有「重置边栏」(`store.resetSidebar`:默认宽 224、展开、取消全屏)。
- **按钮 / 页头统一**(`global.css`):`.btn`(32px 描边)、`.btn-primary`(实心强调色,一个视图的主操作)、`.btn-tinted`(淡强调色)、`.btn-danger`、`.pill`(单独放在页面上时用胶囊);`.page-head`(22px 标题行,`.count` 数字胶囊、`.page-actions` 右侧按钮)用在端口转发 / SFTP / 设置,内容列统一最大 1320 居中,换页标题不左右跳。设置页标题挪到卡片外面。工具栏图标按钮(终端标签栏、SFTP 工具栏)和侧栏同一套:悬停 `--hover`,选中 `--selected` + 图标上强调色。输入框统一「聚焦时边框变强调色」,只有胶囊搜索框(大号控件)加光环。按键 / 滚轮会收起提示框(被快捷键隐藏的按钮收不到 mouseout)。
- **交互状态统一**(`global.css`):`--hover`(文字色 5%)、`--selected`(9%)、`--ease`(一条动效曲线),侧栏、设置导航、分组标签、视图切换、SFTP 会话条、转发规则行都用它;可点的东西按下都有轻微缩小。各页外边距统一 24 / 36。
- 连接页头部:原来的大 X 先改成背景水印、弱化了三次,最后用户嫌不够清晰,**整个去掉了**(不要再加回去);之后用户又指出侧栏和头部两个字标重叠 —— 头部改成和其他页一样的 `.page-head`(22px 标题「连接」+ 右侧搜索框 400×40 胶囊 + 加号 40 圆),**全应用只在侧栏顶部放一个字标**;「我的连接」小标题也去掉了(和页标题重复),列表栏只剩分组标签 + 排序 / 视图。四个页面标题位置量过一致(x 260 / y 28 / 22px)。连接页上 `Ctrl+F` 或 `/`(不在输入框里时)聚焦搜索。量过:头部 / 统计 / 网格 / 列表栏左右边缘完全对齐,间距 16 / 20 / 36,卡片内图标、文字、按钮垂直居中偏差 0;卡片右内边距比左边少 2px 是有意的光学对齐(圆形按钮视觉更轻)。
- **连接页栅格(09-29 第二次复核后,用户嫌间隔不对称、不工整)**:`.wrap` 是尺寸容器(`container-type: inline-size` + `width:100%`,否则它会缩到内容宽),统计卡和主机卡**共用同样的列**(09-30 起四列,见下一条);统计 总数 / 在线 / 离线 / 已连接,内边距 16、图标 48,和主机卡一样 —— 量过 1440 / 1920 宽时两排的列边完全重合,统计的图标 / 数字和下面的系统图标 / 主机名同一条竖线(x 277 / 339)。主机卡两列时三张统计合成一条带分隔线的横条(三对二的列边对不齐)。有主机时不再显示虚线「新建连接」格子 / 行(右上角的 ＋ 就是入口;原来它独占最后一行,且比卡片矮 3px / 列表里矮 7px),只在一台主机都没有时出现。卡片左右内边距都是 16(去掉了原来 −2px 的「光学对齐」),列表行左右都是 12;纵向节奏 16(页头→统计)/ 24(统计→分组栏)/ 16(分组栏→卡片、卡片间距),每行卡片等高(`grid-auto-rows: 1fr`)。
- **连接页卡片缩小(09-30,用户:卡片太大、想多看到一些)**:主机卡 99 → 82 高,系统图标 48 → 40,内边距 12,名称 13.5 / 地址 12,标签只占一行;1440 宽时 4 列(容器 < 1076 三列、< 804 两列、< 532 一列),间距 12。⋯ 不占一列:悬停 / 键盘聚焦 / 菜单打开时浮现在 ▶ 左边、同一水平线(28 圆,`position:absolute; right:46px`),名称这时让出 30px,宽卡片上它顶替「上次连接时间」的位置(时间暂时隐藏)—— 放在右上角试过,用户觉得位置不对。卡片 / 列表行上右键直接弹出同一个菜单(在指针处打开)。统计改回四张 —— 第四张是「已连接」(当前连着的主机数,不是原来和分组标签重复的「分组」),四张统计和四列卡片列边对齐、图标 / 数字与系统图标 / 主机名同一竖线(x 273 / 325);卡片少于四列时统计合成一条横条(里面不画分隔线,用户嫌难看)。列表行 52 → 46。
- **快速连接(09-30)**:先做成页面底部一条输入框,用户要求按 macOS 规范改 —— HIG:「Put a search field at the trailing side of the toolbar」、搜索配建议,工具栏在窗口顶部,规范里没有窗口底部常驻输入框。现在**并进页头的搜索框**:输入能解析成 `user@host[:port]`(`lib/target.ts parseTarget`)时,框下弹出建议「连接到 …  Enter」,回车 / 点击:地址和已保存主机一致(host + port,写了用户名也要一致)就等于点它的卡片,否则打开命令面板直接进这台的输密码步骤(`store.paletteSeed` + `paletteQuick`,`CommandPalette` 打开时若第一项是快速连接就直接 `activate`)。没输地址时,筛选后只剩一台主机,回车直接连它。输入的是地址时不显示「没有匹配的主机」。占位文字改成「搜索主机,或输入 user@host 连接…」。页面底部回到留白。
- **在线小圆点(09-30,用户:太明显)**:6px、无光晕;离线灰点 60% 不透明;还没探测出结果(启动时、走跳板机 / 代理)的是 1px 细空心圈、80% 不透明(原来 8px + 1.5px 太显眼;试过完全不画,用户说看不见也不行)。
- **连接页头部 / 宽卡片(09-30,用户截图:没有分组时统计下面空一行只剩右边两个按钮;两列时卡片中间大片空白)**:排序和卡片 / 列表切换挪到页头(搜索框右边,40px 胶囊,和搜索、＋ 同高),分组栏只在有分组时出现,没有分组时卡片直接接在统计下面(统计下边距 24)。卡片是尺寸容器(`container: card`),内容宽 ≥ 300(卡片约 ≥ 326,即两列窗口)时右侧显示上次连接时间。**不显示系统名称**(用户:不够极简 —— 图标已经说明了系统,悬停图标看全名)。
- **全页面对称复核(09-29,用户要求「所有 tab 的布局、按钮、框、间距全部对称工整」)**:`scratchpad/ui/audit.js` 注入页面量每个可见元素(左右内边距不等、行内首尾子元素到边框的距离、`align-items:center` 行里子元素偏离中线 >1px、各类控件高度 / 圆角分布、区块纵向间距),`run23.js` 逐页跑。修掉的:
  - **设置**:内容列原来最宽 880 且靠左(右边一大片空,和其他页不一致)→ 和其他页一样占满 1320 列;行内控件统一 30px(分段 / 小按钮 / 输入框 / 下拉,原来 33 / 28 / 30 / 27);分组间距 28 → 24;数字框后的单位只写单位(「秒」「次」「KB/s」),「0 = 关闭」挪进说明 —— 顺带修了「连接超时」写着「0 关闭」其实最小是 1;单位列 112 → 52。
  - **SFTP 页**:工具栏统一 32(路径框 36、图标按钮 34、上传按钮 32 → 全 32);本机 / 远程两个面板头统一 52 高、左右内边距 14,**表头和每一行在两边完全对齐**(原来差 8px);本机面板头改成和远程一样的「图标块 + 名称 / 路径两行」(新图标 `monitor`),加了同样的底栏(N 项 · 已选 n),选中数不再挤在面板头里。
  - **端口转发**:表单输入框 34 → 32(和按钮一致);卡片内容到边框统一 17(4 + 12,和表单、连接页卡片一样,原来 19);规则行缩进到主机名下面(芯片和主机名同一条竖线),删除按钮 28 圆。
  - **主机编辑**:行左右内边距 16 / 16(原来 16 / 14),分组间距 24(和设置、连接页一致)。
  - 全应用纵向节奏:页头 → 内容 16,区块之间 24,卡片 / 行之间 16。有意保留的不对称:▶ 左内边距 +2(三角形视觉居中)、排序按钮文字 14 / 箭头 10、会话胶囊左边是圆形图标(5)、标签页左文字右关闭按钮。
- 卡片悬停只做轻微抬起 + 主机色 3% 的底色(用户嫌原来的光太强);▶ 垂直居中,⋯ 放在它左边、只在悬停 / 键盘聚焦 / 菜单打开时显示;卡片最小宽 320px(一般窗口 3 列,长名字不被截断)。
- **连接页** `components/HostsPage.vue`:`.page-head`(标题 + 搜索胶囊 + 加号)、搜索(名称 / 地址 / 用户 / 分组 / 标签 / 系统)、新建按钮;四个统计卡(总数 / 在线 / 离线 / 分组);分组标签页、排序(最近使用 / 名称 / 地址)、卡片 / 列表切换(`hostsView` / `hostsSort` / `sidebarCollapsed` 三个设置键);卡片:系统图标、在线点、地址、标签、⋯ 菜单(连接 / 打开 SFTP / 编辑 / 复制 / 删除,删除要确认)、连接按钮。用户明确**不要**设计图里的宣传口号和「user Pro」账号块。
- **系统图标**:连上后主进程在单独的 exec 通道跑一次只读的 `OS_PROBE_COMMAND`(`shared/hostOs.ts`,读 `/etc/os-release`、`/etc/dgx-release` 认 DGX、`uname`;包在 `sh -c` 里防 csh),解析后 `store.setOs` 存进 hosts.json,变了才发 `hosts:changed` 让界面重载。图标用 `simple-icons`(CC0,只按名导入用到的)`components/OsIcon.vue`;太暗的品牌色(CentOS / Apple)在深色主题改用文字色;没连过的显示通用服务器图标。编辑主机时地址没变才保留 os。
- **后台识别系统(09-29,用户:有的主机有图标、有的没有)**:原来只有连上时才识别,用户 15 台里只有 2 台连过新版。现在 `hosts:probe` 探测完,对**在线且还没有 os** 的主机(走跳板机 / 代理的也算)调 `detectMissingOs`(`main/index.ts`):用保存的凭据走 `SshManager.quietExec` —— 不开终端、不注册会话、不给渲染层发任何事件,只在一个 exec 通道跑 `OS_PROBE_COMMAND`,读完就断;**主机密钥必须已记录**(从没连过的不碰,密钥变了直接中止,绝不在后台做首次信任);同时两台,每个地址每次启动最多试一次,锁定时不跑;密码认证但没存密码的跳过。每次后台登录记一条连接日志(detail `os-detect`)。设置 → 连接 →「自动识别服务器系统」可关(`autoDetectOs`,默认开)。测试 `main/quietExec.test.ts` 起一个本地 ssh2 服务器验证:读得到系统、没请求过 pty/shell、没发事件、密钥没记录 / 变了都不登录。
  - 识别规则扩充(`shared/hostOs.ts`):设备类先看标记文件(DGX `/etc/dgx-release`、Proxmox `/etc/pve`、TrueNAS `midclt`、openmediavault、Unraid、群晖);没有 os-release 的老系统读 `/etc/redhat-release`(CentOS 6 就是这样,原来只会显示通用 Linux);uname 认 NetBSD / VMkernel(ESXi)。图标表(`OsIcon.vue`)补齐 simple-icons 里有的全部发行版:Pop!_OS、elementary、Zorin、EndeavourOS、Void、Slackware、MX、KDE neon、Garuda、Solus、Parrot、Nobara、Artix、CachyOS、Photon、RancherOS、Alibaba Cloud Linux、openEuler / EulerOS(华为)、Asahi、Qubes、Tails、Proxmox、TrueNAS、openmediavault、Unraid、群晖、VMware、NetBSD。**只有系统自己的 ID 对上才用品牌标志**,认不出的一律 Tux(`linux`)—— 原来按 `ID_LIKE` 归到上游家族,结果用户三台 TencentOS Server 3.3(`ID_LIKE="rhel fedora centos"`)戴上了 Red Hat 的红帽(09-30 用户截图发现)。已经按旧规则存下的记录在 `OsIcon.vue` 里纠正:家族标志(rhel / centos / fedora / debian / ubuntu / arch / suse)只在完整系统名(`pretty`)里真有这个名字时才用,否则画 Tux —— 不用重新登录服务器。系统图标悬停显示完整系统名。一个分组都没有时不显示分组标签(只剩一个「全部」没有意义)。
- **在线状态** `main/reachability.ts`:先 `ping`(不进 sshd 日志),不通再连 SSH 端口,**必须收到对端数据(SSH 横幅)才算在线** —— 这台机器开着 TUN 代理,任何地址的 TCP 握手都是本地瞬间完成的,只看握手会把所有主机判成在线(实测 192.0.2.1 被判在线);域名会被解析成 198.18.x.x 的假 IP 且 ping 秒回,所以假 IP 段的 ping 回复不算数(`pingVerdict` → 'proxied'),转去看端口。收到横幅后回一行版本号再断,避免 sshd 记「did not receive identification string」被 fail2ban 计数。走跳板机 / 代理的主机不探测('unknown',空心点)。连接页打开时探一次(启动时等主机列表加载完)、之后每 3 分钟、窗口重新可见且超时时补一次;已连接的主机直接算在线。**节流在 store 里**(`probeReach(undefined, { maxAge })`,模块级 `lastFullProbe` / `probeRoundBusy`):连接页是 `v-if` 挂载,原来每进一次就全量探一遍(对不回 ping 的主机就是一次 SSH 连接);同一时间只跑一轮;按主机记序号,旧一轮的结果不会盖掉新的(改了地址后的单台探测)。Windows 上 `ping` 用 `System32\PING.EXE` 全路径(裸名会先找当前目录);IPv6 的回复没有 `TTL=`,按「时间=Nms」也算回复。
- **端口转发页** `components/ForwardsPage.vue`:按主机列出保存在主机上的规则(连接时自动开)+ 会话里临时加的(同一主机**所有**已连接会话里的都算);分组数据在 store 的 `forwardGroups` getter 里,侧栏的数字用同一份(原来侧栏只数保存的,和页标题对不上)。主机头部:已连接显示「● 运行中」,没连接只显示一个「连接」按钮;行上只有临时规则带「临时」标记(不再每行重复「已保存」「未连接」)。删除保存的规则要确认,删除时按 store 里最新的主机数据改(原来连删两条会把第一条带回来),一次只删一条,失败会提示。**重连后保存的规则会丢**的老问题:`addForwardTo` 把临时规则写进 `pane.params.portForwards`,重连时主机只在 `!params.portForwards` 时才取保存的规则 —— 现在主进程把两者合并去重(`main/index.ts` 连接处)。转发出错主进程返回 `code`(`ForwardErrorCode`),渲染层按界面语言翻译(原来英文界面也弹中文)。新建规则可选「保存到主机」,主机在线时同时立刻开启(先开成功再保存,端口被占就不存);删除保存的规则时若在运行也一并停掉(`removeForward` 按监听端口匹配,连接时开的也能停)。store 新增 `addForwardTo(pane)` / `removeForwardFrom(pane)`。
- **三处按新框架重做**(09-29,用户批评「把旧页面套进新框里」,**不要再这样做**:新页面必须按连接页的语言从结构上重做):
  - **主机编辑** `HostEditor.vue`:从右侧滑入的面板(`Transition name="sheet"`),头部是主机头像 + 大号名称(占位 = user@host);「连接」卡片(地址 + 端口、用户名、认证分段 + 对应的密码 / 密钥行,`user@host:port` 在粘贴、离开输入框、保存时拆分 —— **不能用 watch 每个按键都拆**:敲 `myhost:2222` 时第一个数字就被拆走,变成主机 `myhost222`、端口 2)、「整理」卡片(分组、标签、颜色)、「更多选项」卡片(跳板机、代理、端口转发、连接后执行、终端外观、Agent 转发 —— 每项一行,收起时右侧显示摘要,点开就地展开);底部固定栏 删除 / 取消 / 保存。行内是无边框输入框,行本身是边框(Apple 分组表单)。脚本逻辑没动,只加了 `sections` 开关、摘要 computed 和拆分函数。标签那一行**不能是 `<label>`**:没有 `for` 的 label 会把点击转给里面第一个可标记元素,也就是第一个标签的 × 按钮 —— 点「标签」两个字就删掉一个标签。主机行同理(地址 + 端口两个输入框),改成 `div` + `<label for>`。面板本身 `tabindex=-1`,点空白处 / 关掉生成密钥小窗 / 删除密钥后焦点回到面板,Esc / 回车仍然有效。
  - **设置** `SettingsDialog.vue`:标题 + 胶囊标签(同连接页分组标签)+ 分组卡片,每行「名称 + 一行说明 | 控件」;内容最宽 880。脚本逻辑没动(清单见 git 历史里的旧模板)。数字框的单位固定宽 112px,保证数字框竖向对齐。
  - **SFTP** `SftpDrawer.vue`:一套模板两种布局 —— 页面:工具栏在页面背景上(上一级 / 主页 / 胶囊路径栏里的面包屑 + 编辑 + 书签 | 刷新 / 本机双栏 / 上传 / 更多),远程和本机两张卡片**左右并排**(本机在左,`order:-1`);抽屉:同样的块竖排、无卡片边框。行和表头共用一个网格(图标 / 名称 / 大小 / 修改时间),窄于 440px 用容器查询收起时间列。菜单带图标、分组分隔线;同步 / 部署 / 本机新建 / 预览对话框统一成 `.dlg`(原来同步和部署对话框的样式写在 PermDialog 的 scoped 里,根本没生效;本机新建框没居中)。脚本依赖的类名保留:`.row[data-name]`(框选命中测试)、`.body`(滚动容器 + `.marquee` 定位父级)、`drawerEl`(聚焦)、菜单宽度(more 176 / hist 300 / bm 220)与脚本里的定位数学一致。顺手修了 `openDeploy` / `runDeploy` 里 `!localSelCount` 少 `.value`(永远不拦截)。第二轮(用户嫌「一般」)加了:文件类型图标和颜色(`kindOf` / `KIND_ICON`,按扩展名,无扩展名但可执行的算脚本)、远程卡片头(主机图标 + 名称 + user@host + 筛选框 `filterText`,换目录清空)、行悬停快捷按钮(下载 / 重命名 / 删除,绝对定位不占网格列)、双栏中间的 → / ← 发送按钮(`uploadLocalSelection` / `downloadSelectionToLocal`,复用 `uploadPaths` / `downloadTo`)、底栏「N 项 · 已选 n · 大小」、拖入时整张远程卡片的虚线投放层、工具栏「上传文件」主按钮 + 新建文件夹按钮。
- **SFTP 页**:顶上是已连接会话的切换条(胶囊,同分组标签),下面是 `SftpDrawer` 的 `page` 模式;没有会话时列出主机点一下连(`stay`,不跳走)。
- **设置**是页面,和其他页一样**不响应 Esc**(原来 Esc 返回上一页:在任何输入框里按 Esc 都会跳走,点过标签后又完全不起作用;录快捷键时按 Esc 取消会连设置一起关掉)。录快捷键时按键 `stopPropagation`,录 Ctrl+1 不会顺便跳到第 1 个标签;点录制遮罩任意处取消。安全页的连接日志在直接打开到安全页时也会加载。设置里的窄屏规则改成容器查询(看内容列宽,不看窗口宽 —— 侧栏占了 224~360)。分段控件选中块用新变量 `--thumb`(浅色主题白色;原来 `--bg-elev-2` 比轨道还暗,浅色下几乎看不出选了哪个)。
- **标签**:`Host.tags`,编辑器里输入后回车 / 逗号加、空框退格删最后一个(有字时回车不触发编辑器的「回车保存」)。顺带修了编辑主机会丢 `lastUsedAt`(编辑后掉到最近使用末尾)的老问题;编辑器里的删除现在也要确认(原来直接删)。
- **`settings:set` 只接受白名单里的键**(`shared/settingsKeys.ts`)。渲染层被拒时 `store.saveSetting` 会 `console.error` —— "界面说存好了、其实没写进去"是这一类里最贵的 bug。
- **主进程里没有非空断言了**。需要 SSH 管理器的地方用 `requireSshManager()`(只有晚于窗口创建的 handler 才可以用);能在窗口创建前被调用到的(如 `sessionLog`、fire-and-forget 的 `send`)必须自己判空。

## 下一步(如果继续)
- **待亲眼看的**(都只过了 typecheck / 单测):
  - ~~设置 → 常规 → 语言那一排四个按钮排不排得下~~、~~繁体界面整体过一遍~~ 已在应用内点过(第二十三次会话:四个按钮 285px / 容器 296px 不溢出,繁體各页无截断);剩下 Codex 里右键「复制」和菜单靠底部时收进窗口仍未验。
  - **第十五次会话记:host-key 确认卡的三种形态**——首次连接(未信任)、密钥变更、跳板机密钥失败。
    **三种都在应用内点过了**(2026-10-08/09,装好的 0.4.0 + 临时 profile + 回环假 sshd,不碰真实 userData):
    - ① 首次连接(未信任):卡片标题「主机密钥未信任」、按钮「信任此密钥并连接」、正文「127.0.0.1:22600 的主机密钥
      还没有信任过,连接已中止。确认下面的指纹属于这台服务器后再信任。」,卡片上显示「服务器出示的指纹
      SHA256:…」;点信任后 `known_hosts.json` 写入该指纹(与靶机打印的钥匙逐字同源)并带 `firstSeen`。
    - ② 密钥变更:让靶机在两次连接之间换掉主机密钥(日志 `SWAPPED: now serving key B`)。卡片标题「主机密钥变更」,
      正文「…服务器重装过会这样,被中间人冒充也会这样 —— 确认后再信任新密钥。」,**旧指纹与新指纹两个都显示**,
      按钮是「信任新密钥并重连」(与未信任卡的按钮区分);点后进 shell,`known_hosts` 换成新指纹、`firstSeen` 更新。
    - ③ 跳板机密钥失败:连接一台经未记录跳板机的主机,卡片指明是跳板那台(`127.0.0.1:22601`)并显示其指纹;
      点信任后跳板指纹写入 `known_hosts`。另验到一条边界:跳板机没存密码时报「跳板机需要密码,但没有已保存的密码。
      请在「主机」编辑页为跳板主机设置密码后重试,或改用密钥认证」。
    - 靶机当时的坑(下次省时间):ssh2 服务端换钥匙要等第一个客户端 **close 之后再 close + 重新 listen**,
      否则换钥匙与在途连接相撞、靶机自己把自己弄断;bash 里起的后台进程会被命令收尾一并清掉,
      需要让「靶机 + 两次连接」跑在同一个进程里。
  - 移动端 M3.65 字标:MuMu 验过、**真机(18 Fold 等)没验**(见 `mobile/HANDOVER.md` M3.65)。
  - **中文输入法的回车**(第二十四次会话):已经用合成 `KeyboardEvent` 验到「输入法回车不被我们吞掉、真实回车照常执行」,但**没有在真实中文输入法下看过候选词框**——那要人手动打。想彻底确认,挑连接页搜索框和标签重命名两处各打一次中文、在候选框上按回车即可。
- `CHANGELOG.md` 现在有 `Unreleased` 段(第二十四次会话的输入法修复 + 测试配置)。要发版时升版本号、改日期。
- 按用户截图式 UI 反馈继续修复。
- 如版本号增加,改 `package.json` + 更新 `CHANGELOG.md` 后 `npm.cmd run dist` 重打包。
- 大规模改动前先跑 `npm.cmd run typecheck && npm.cmd run build` 与 `npm.cmd run lint:i18n` 保证通过。

# 会话记录:M3.182(Windows 深路径下载修复)

- **`downloadJob` / `downloadTree` / `putFileSilent` 补 `longPath`**:`\\?\` 前缀原来只在 `syncJob` 里用,下载(含拖出 / 外部编辑器回写)的 `mkdir` / `unlink` / `createWriteStream` / `createReadStream`,以及 `pipeStream` 失败清理的 `unlink` 都漏了 —— Windows 上深目录(node_modules 等)下载会失败或留下半截文件,而同一棵树的同步却正常。现在全部走 `this.longPath(...)`。

# 会话记录:第二十四次会话(2026-10-29,中文输入法的回车 + 测试套件自己会漏跑)

> **本会话总览**
> - **中文输入法按回车**:两半问题。① 一批入口没有组字判断,选词时的回车会被当成确认执行(最糟的是连接页搜索会直接连主机);② 更要命的一半是这些地方写着 `@keydown.enter.prevent` —— `.prevent` 在处理器**之前**执行,处理器里再判断已经晚了,候选词被 `preventDefault` 卡住,**中文用户在这些框里选不了词**。
> - **测试套件会静默漏跑**:Vitest 在 Windows 上并行跑文件会抢同一个 SSR 缓存文件,抢输的那个报 `EPERM`、用例被静默跳过,但整跑仍然报绿。这比上面那条严重得多。

用户说「继续吧,继续完善」,于是从最常见的中文交互往下挖,结果在验证过程中撞到一个影响所有人的问题。

## 一、中文输入法的回车(应用层面)

**先说清楚两半问题的区别**,这是这次唯一需要记住的判断方法:

- 处理器里写 `if (e.isComposing) return` 只挡住「我误把选词回车当确认」;
- 但模板上的 `@keydown.enter.prevent` 里的 `.prevent` 是 Vue 编译进 `withModifiers` 的,**它在调用处理器之前就 `preventDefault()` 了**。组字状态下的回车被取消默认行为,浏览器就不再把它交给输入法 → **候选词选不上**,输入框看起来对回车毫无反应。

所以正确写法只有一种:**模板不加 `.prevent`,处理器里先判断组字,再自己 `preventDefault()`**。

新增 `src/renderer/src/lib/ime.ts` 的 `isImeKey()`(`isComposing || keyCode === 229`,允许传 `undefined`,因为 `blur` 路径没有事件),替换掉原先散在四个组件里的六份重复写法;`SftpDrawer` 里原有的本地 `isImeEnter()` 保留为薄包装,免得改一堆调用点。

按危险程度排,修掉的是:

1. **连接页搜索框(最危)**:输入法是中文时在搜索框里打主机名,选词按的回车会走 `onSearchEnter` → 只剩一台主机就直接 `connect()`。等于**选个词就连上一台服务器**。
2. **标签重命名**:选词回车直接提交,标签被改成候选词替换前的半截文字,输入框也关了。
3. **SFTP 抽屉**:远程新建 / 重命名 / 路径编辑三处。修之前「守卫是写了但 `.prevent` 抢先」,等于候选词提交不了;`commitRename(entry, $event)` 那处有传事件、另外两处 `commitCreate` / `commitPathEdit` 模板没传 `$event`,守卫拿到 `undefined` 直接放行。现在三处统一。
4. **本地面板的「按模式选择」**(`selectByPattern`):全角括号这类模式串常用中文输入法打,原来回车会在打字中途就把文件选上。这个函数连事件参数都没有,是这次新加的。
5. **生成密钥**的两个输入框(密钥名、口令):回车会拿半截名字生成一对密钥并写进 `keys/`。
6. **命令广播**(`submitBroadcast`):广播是发给**所有**在线会话的真实命令,从这里发出去了很难收回。原来模板直接 `@keydown.enter.stop.prevent="submitBroadcast"`,完全绕过 `onKey` 里已有的组字判断。
7. **会话历史搜索**(`HistorySearch`):原来面板根上挂着 `@keydown.enter.prevent`,**无条件**取消所有回车;`onKey` 也没有组字判断,选词回车会直接 `pick()` 跳走并关窗。
8. **终端搜索框**:中文搜索时回车被 `.prevent` 卡住,候选词提交不了。
9. **锁屏**:`unlock()` 在组字时被触发,会拿半截口令去验证。

**没动、也不该动**:连接页主机卡片上的 `@keydown.enter.self`(焦点在卡片上,根本不在输入框,不会有组字)、权限对话框(只有八进制数字和复选框)、设置页两个 `@keyup.enter`(写的是幂等偏好,重复保存无害,已列进静态检查的例外)。

## 二、测试套件自己会静默漏跑(比上面重要)

改完之后跑 `npm run test`,先后拿到 334 和 325 两个数,都是绿的。一开始以为是我新加的测试有问题,查下去发现是**测试基础设施**的毛病:

- 现象:同一份代码连跑 10 次,得到 `334 / 325 / 326 / 313 / 331` 五种结果,缺的文件随机(有一次缺的恰好是几分钟前刚改过模块对应的测试)。
- 根因:Vitest 默认并行跑多个测试文件,它把 SSR 转译后的模块按内容哈希写进临时目录,**两个 worker 抢同一个文件**,抢输的那个报
  `Error: EPERM: operation not permitted, open 'C:\Users\...\Temp\<随机>\ssr\<hash>'`,
  而这个错误只算一条 "Unhandled Error",那个文件的用例**再也不会被收集**,整跑依然 `passed`。
- 修法:`vitest.config.ts` 固定 `pool: 'forks'` + `singleFork: true`。连跑 8 次全部 30 个文件 / 334 个用例,EPERM 也不再出现。总耗时仍约 3 秒,并行本来没换来什么。

**给以后的我**:看到用例数不等于 334,先看 `Test Files` 是不是 30,别急着找「测试挂了」。这条已经写进上面的「常用命令」小节。

## 三、静态兜底

新增 `src/renderer/src/composables/imeEnterCoverage.test.ts`,两条:

- 模板里处理回车的组件,源码里必须出现 `isImeKey(` 或 `isImeEnter(`;
- 模板里**不允许**出现带 `.prevent` 的 `@key*down*.enter` 绑定。

**做了阴性对照**(这类检查最容易写成永远通过):把 `TabBar` 的绑定改回 `.prevent` → 第二条如实报出 `TabBar.vue: @keydown.enter.prevent`;把 `commitRename` 里的守卫注释掉 → 第一条报出 `TabBar.vue`。还原后全绿。

## 四、这一轮的实测(不是只看 typecheck)

构建产物 + 临时 profile(`%TEMP%\x-ssh-verify-25`,调试端口 9224),用 CDP 在渲染层合成 `KeyboardEvent`,分别带 `isComposing: true` 和普通状态,读 `defaultPrevented`:

| 场景 | 真实回车 | 输入法回车 |
|---|---|---|
| 命令面板搜索框 | `prevented: true`(被处理) | `prevented: false`(放行给输入法) |
| 会话历史搜索 | 面板保持打开 | `prevented: false`,面板保持打开(不再误跳会话) |

两个方向都对得上:真实回车仍然照常执行,输入法回车完全放行。**注意这里只验了「事件是否被我们吞掉」,没有验真机输入法的候选词弹出** —— 那需要真人在中文输入法下打字。

**踩到的坑(记下来省下次)**:这台机器上 `ELECTRON_RUN_AS_NODE=1` 是常驻环境变量,直接跑 `electron.exe` 会退化成纯 Node 并报 `Cannot read properties of undefined (reading 'exports')`;必须先 `unset`。另外 `http_proxy` 也在环境里,`fetch('http://127.0.0.1:9224/...')` 会被代理挡掉,要用 `env -u http_proxy -u https_proxy -u HTTP_PROXY -u HTTPS_PROXY`。

## 五、文档订正

顺手改了「项目概述」里过期的一行:原来写「`package.json` 当前为 0.4.1」,实际早已是 0.5.0。同时把本机部署那条改成「`D:\Apps\X-SSH` 还是 10-08 的旧构建,0.4.1 / 0.5.0 都没部署过」。

验证:`typecheck`(node+web)、`vitest 334`(30 文件,连跑多次稳定)、`build`、`lint:i18n` 全绿。

---

# 会话记录:第二十三次会话(2026-10-27,实测第二十二次会话的焦点陷阱:三处缺陷)

> **本会话总览(按主题;逐条原因与证据在下面的「批」里,时间顺序)**
> - **焦点与键盘**:7 处焦点陷阱从未装上(TDZ,`01` 批)、嵌套陷阱互抢、确认框关闭后焦点掉 body、三个对话框焦点未进入、确认框队列跳过 danger 焦点;后来又补齐文本编辑器 / 片段变量框 / 抽屉四个弹层的陷阱,并修了编辑器打开不聚焦;快捷键录制会接受被硬编码占用的组合;模态打开时全局快捷键仍然生效。
> - **上传 / 下载**:同尺寸不同内容被当作已同步跳过;下载按大小乱续传会拼坏文件;目标目录不存在时一个字节都不写却报成功;取消与失败都返回成功;无会话时上传还会把请求数当成功数。
> - **超时**:`execRemote`(打包 / 解压 / 校验)与跳板机 `forwardOut` 都没有上限,远端卡住就永久挂起、渠道与登记一起泄漏。
> - **接口防护**:`local:readText` 无大小上限;`sftp:openWith` 能执行渲染层给的任意程序;`openWith` / `editExternal` 的 `name` 未按单段校验。
> - **提示与状态**:片段在没有会话时点了毫无反应;`hosts.save` 失败不提示;中文输入法回车被当作确认;语言在渲染层 reload 后退回「跟随系统」。
> - **工具与文档**:`scripts/dev-sshd.ps1`(一条命令起停本机靶机)、`focusTrapCoverage` 静态检查(模态组件漏接陷阱即测试失败)。

用户让接着干,于是去验第二十二次会话自称"已接 12 处"、却**一次都没在界面里点过**的那批交互。手法:构建产物 + 临时 profile(`--user-data-dir=%TEMP%\x-ssh-verify-23`,调试端口 9222,不碰真实 userData),用真实 Tab / Esc 键点,`document.activeElement` 判读。**结论:那 12 处里有 7 处根本没装上,而且装上的也有互抢问题。**

1. **【高】7 个组件的焦点陷阱从未安装。** 启动时控制台固定 7 条 `ReferenceError: Cannot access 'store' before initialization`。根因:第 22 次把 `useFocusTrap(...)` 写在 `const store = useSessions()` **之前**,而 composable 里 `watch(isOpen, cb, { immediate: true })` 会立刻求值 `() => store.paletteOpen`,抛 TDZ;Vue 把 effect 里的异常吞成 console.error,setup 继续执行,**监听却再也没装上**(依赖收集也一并断了)。受影响的是 CommandPalette、ConfirmDialog、HistorySearch、TmuxDialog 等 7 处。修在 composable 本身:首次读取和 watcher 都挪进 `onMounted`,调用方一行不动,也堵住以后再把 trap 写在状态声明前面的可能。
2. **【中】嵌套陷阱互抢,Tab 卡在第一个按钮。** 确认框叠在主机编辑器上时,两个 document 捕获监听同时生效:先注册的编辑器陷阱把焦点拽回面板(它认为"焦点跑出去了"),确认框陷阱又把焦点拽回自己第一个按钮 —— 反复按 Tab 始终停在"取消",永远到不了"放弃修改"。修:模块级 `openTraps` 栈,只有栈顶处理 Tab(打开入栈、关闭/卸载出栈)。
3. **【中】确认框关闭后焦点落回 body。** `ConfirmDialog` 是全局宿主,关闭时把当前聚焦的按钮连同 DOM 一起摘掉;触发它的对话框还开着、Esc 监听在它自己的面板上,于是键盘彻底失效。实测路径:编辑器改字段 → Esc 弹确认(焦点正确落在"取消",danger 保护没问题)→ Esc 取消 → 编辑器还在,但 Esc 和打字都没反应。修:打开时记下 `document.activeElement`,关闭后 `nextTick` 回填,`isConnected` 防调用方已关闭,队列里有下一个确认时不抢。

**实测通过**(构建产物 + 真实按键):编辑器首尾 Tab / Shift+Tab 折返;确认框内 Tab 在两个按钮间往返并折返;取消后焦点回到"名称"输入框、再按 Esc 能重新弹出确认;命令面板 Tab 从最后一行折回搜索框、Shift+Tab 从搜索框折回最后一行;设置 → 语言四个按钮总宽 285px、容器 296px,**不溢出**;切繁體后侧栏 / 设置 / 连接埠轉送 / 終端機各页即时切换,溢出审计(所有可见元素的 `scrollWidth > clientWidth`)为空;语言落盘并在**重启**后生效。

**已知、这轮没修**:渲染层 reload(主进程 `win.reload()`,渲染进程崩溃后走这条路)复用的是**创建窗口那一刻**的 `prefs`,所以语言会退回"跟随系统",直到下次重启;设置本身没丢(`settings.json` 里 `lang` 是正确的)。修它要动启动偏好那条路。另:设置页只在当前窗口宽度(1440)下量过,没测更窄的窗口。

验证:`typecheck`、`vitest 324`、`build`、`lint:i18n` 全绿。

## 续(同日):第二轮审核 + 修掉四条

三条并行只读审核(焦点/覆层、渲染层交互、主进程与共享)加逐条亲自核实。**误报一条**:自动备份用 `exportJson(true)` 被报成缺陷,其实是 `store.ts:175` 注释写明有意为之(定时备份要在锁定时也能跑);真正的小瑕疵只是 `writeFile` 没传 `mode`。确认的问题里先修了四条。

1. **全局快捷键没有模态判断(最高危)**:对话框开着时按 Ctrl+K,面板会在它**底下**打开(z-index 100 对 110~130),焦点被搬进看不见的搜索框,打字进那里、回车可能连上一台主机,可见对话框的 Esc / Tab 全失效。新增 `src/renderer/src/lib/modals.ts`(集中列出所有覆层根类名,导出 `modalCount()`),`App.vue` 的 `onGlobalKey` 在有模态时一律不处理快捷键(`effective()` 随之前移到数字跳转之前),唯一例外是只开着面板时它自己的开关快捷键。注意:焦点在输入框里时 `inEditable` 本来就会先返回,所以"面板里 Ctrl+K 关不掉"是原有行为,不是回归。
2. **三个对话框焦点从未进入**:`ForwardDialog` / `PublishKeyDialog` / `SessionReplayDialog` 常驻挂载、内部 `v-if` 显隐,`onMounted` 那次 focus 跑在启动时、`dialogEl` 还是 undefined。改成 `watch(openFlag)` 后 `nextTick` 聚焦。实测发布公钥与会话回放打开后焦点都在 `.kp-dialog` / `.rp-dialog` 内。
3. **确认框队列跳过 danger 焦点**:`answer()` 置 `open=false`、`present()` 又置回 `true` 在同一个 tick,`watch(open)` 新旧值都是 `true`,回调根本不跑,排队进来的第二条(可能是删除确认)会继承上一条"确定"按钮的焦点。`confirm.ts` 的 state 加 `seq`(每次 `present` 自增),宿主改为盯 `seq` 设焦点、单独盯 `open` 做关闭回填。
4. **多行粘贴确认后用了死的 `term`**:`TerminalView.pasteClipboard` 在 `await confirm(...)` 之后直接用 `term`,期间会话掉线 / 标签关闭会抛 TypeError 或粘进已替换的会话。取消分支改 `term?.focus()`,粘贴前加 `if (!term) return`。

**第二批(同日晚)**:① 确认框关闭后若 opener 已被移除(菜单项、刚被删掉的行)或已禁用,焦点仍会掉到 body —— `modals.ts` 加 `focusFallbackSurface()`(最上面一个 `[tabindex="-1"]`,兜底到 SFTP 抽屉根),`ConfirmDialog` 只在 opener 真可用时才回填;② `hosts.save` 在两处都没有 try/catch,磁盘满 / hosts 损坏时面板不关、毫无提示 —— `HostEditor` 改为 toast `ed.saveFail` 并留在面板里,`CommandPalette` 提示后照样用输入的密码连接(顺手加 `submitting` 守卫:连按两次回车原来会开两条连接)。正常路径实测:编辑器改字段 → Esc → Esc 取消后焦点仍在"名称";兜底路径只做代码确认(没造出 opener 被移除的场景)。

**第三批**:快捷键录制只按修饰键(Ctrl+Shift)会存成 `Mod+Shift+Shift` 这种永远匹配不上的死键,而它已经把原默认键位覆盖了 —— `SettingsDialog.recordChord` 现在遇到纯修饰键直接返回、继续等真正的键。实测:录制中按 Ctrl+Shift 仍停在"请按下新组合键…"、绑定未变;按 Ctrl+Alt+J 正常写入。注:应用工具按不了纯修饰键,这一条是用合成 `keydown` 事件在渲染层验证的。

**第四批(主进程防御)**:① `local:readText` 无大小上限,对一个大文件做"与本地比较"会把整个文件读进主进程内存 —— 加 2 MB 上限(与远端 `sftpReadText` 同一阈值),超限返回"文件过大"。② `sftp:openWith` 把渲染层给的程序路径直接 `spawn`,等于该通道可以运行机器上任意程序 —— 现在只允许设置里存过的程序(`externalEditor` 与 `fileOpeners` 的值),否则拒绝;这项检查放在**下载之前**(拒绝时不必先把文件拉下来)。`openWith` 与 `editExternal` 的 `name` 也加了单段校验(`basename(name) === name`),防止拼出临时目录外的路径。渲染层实际只传 `store.fileOpeners[ext]`,行为不变。应用内实测(临时 profile,无会话):未配置程序 → `程序没有在设置中配置`(先于会话检查)、`../evil` → `文件名无效`、不传程序 → 走到 `会话不存在`(正常路径没被挡住)。**真正打开的路径仍没验**(要靶机)。

**第五批(SFTP 抽屉的 IME)**:抽屉里四个回车处理(本机新建、远程新建、重命名、路径编辑)原来都不看 IME 组字,中文输入法里在候选词上按回车会按**尚未提交的旧文本**建出名字不对的目录,重命名框则直接被关掉、已输内容丢失。新增 `isImeEnter(e)`(`isComposing` 或 `keyCode === 229`),四个入口都先过它;重命名的模板调用补了 `$event`。**未在应用里验**(要真实 SFTP 会话 + 中文输入法)。

**第六批(本地面板的竞态)**:`refreshLocal` 没有远端 `load()` 已有的序号守卫,连点进入两级目录时,先发出的旧响应后到会把 `localPath` / `localEntries` 刷回旧目录,之后的上传 / 删除就作用在错的目录上。加 `localSeq`,过期响应直接丢弃(连 loading 标志也不回写)。

**第七批(上传/下载的判定)**:① 上传默认策略下原来只要 `remoteSize === localSize` 就跳过——改一个字符长度不变,远端永远不更新,界面还报成功。新增 `statFile()`(大小 + mtime),现在**同尺寸且远端不早于本地**(给 1 秒余量,SFTP 的 mtime 只有秒级)才跳过;本地更新则覆盖。② 下载原来只要本地文件更小就无条件追加,而"更小"可能是一个**旧版本**的完整文件,拼出来是坏的。新增 `partialDownloads`(键 `sessionId\0remotePath`),只有"本进程自己中断过、且远端大小与 mtime 都没变"才续传,否则删掉本地从头下;失败分支写记录、成功清除。**实测**(本地临时 sshd 靶机 + 应用内调用 `sftp.uploadPaths`):本地 4 字节 `AAAA` 上传后远端为 `AAAA`;改成同样 4 字节的 `BBBB` 再传,远端变 `BBBB`(旧实现会跳过);内容不变的第三次上传,远端 mtime 一点没动(确认是跳过而非重传)。**第九批(下载不再被原生确认框卡死)**:`sftp:downloadMany` / `sftp:downloadTo` 在目标位置已有同名文件时会弹**原生**覆盖确认框,而且没有别的出路 —— 无人值守的调用会一直挂着(我第一次验证下载续传就是这样卡了 30 秒、本地文件一个字节没动)。更实际的问题是:重连后的下载续传队列(`SftpDrawer.resumeDownloads`)也走这条通道,用户明明已经选过下载,回来还要再点一次框。现在两条通道加可选参数 `overwriteLocal`(默认 false = 仍询问),续传路径传 `true`。
**下载不再拼坏文件的实测**:远端 `big.txt` 20000 字节全 `R`,本地同名文件 10000 字节全 `L`(更小的旧版本);调 `downloadTo(..., overwriteLocal: true)` 后本地变成 20000 字节,与远端 SHA-256 **完全一致**。旧实现会从第 10000 字节往后追加,哈希必然不符。

下载的续传判定**仍未实测**(要制造一次真实中断);`openWith` 的正向打开也没验,需要在设置里配一个程序且不重载页面才能从右键菜单触发。

**第八批(上传结果不再撒谎)**:上一批顺带发现"上传一个不存在的本地路径返回 `{ ok: true, count: 1 }`"。根因:`uploadJob` 里 `walk()` 对 `stat` 失败的路径只 `failures++` 然后跳过,而这些计数**从未返回**;IPC 一律 `return { ok: true, count: paths.length }`(按请求数,不按成功数)。现在 `uploadJob` 返回 `{ files, failures }`,四处调用点(选文件上传 / 上传目录 / 上传指定路径 / 上传并解压)改成 `failures > 0` 就 `ok: false` + `error: "N 个文件失败"`,`count` 用真正的成功数;上传并解压那条在失败时不再继续解压。**实测**(临时靶机 + 应用内调用):不存在的路径 → `{ ok: false, count: 0, error: "1 个文件失败" }`;真实文件 → `{ ok: true, count: 1 }`。

**清理靶机的坑(记下来省下次)**:杀 sshd 别用 `Stop-Process` 按 `Path -like '*OpenSSH*'` 过滤(部分进程 `Path` 为空,杀不到),也别按命令行匹配 `xssh-target` —— **会把正在执行这条命令的 PowerShell 自己也匹配上**、当场把命令打断。按进程名 `sshd.exe` 精确匹配,或直接用记下的 PID。

**第十批(用靶机把剩下的两条验完,并修掉顺手发现的第三条)**:

- **`openWith` 正向**验过:把 `externalEditor` 设成 `notepad.exe` 后,`sftp:openWith` 传记事本 → `ok: true` 且**进程真的起来了**(`Get-Process notepad` 能看到);同一调用传 `cmd.exe` → `程序没有在设置中配置`。
- **下载中断续传**验过:远端 200 MB,传输中调 `sftp.cancel(jobId)`(jobId 从 `onProgress` 里抓),留下 148,570,112 字节的部分文件;再下一次 → 209,715,200 字节且与远端 SHA-256 一致。**前提是目标目录已存在**(见下一条),取消后部分文件会保留(设计如此)。
- **新发现并修**:下载到**不存在**的目标目录时,`downloadJob` 直接 `createWriteStream(join(localBase, name))`,ENOENT 被每个文件的 catch 记进 `failures`,而 IPC 无条件 `return { ok: true, count }` —— 现象是"报成功、一个字节没写、连目录都没建"。`downloadJob` 开头补 `mkdir(localBase, { recursive: true })`(续传队列指向被删掉的目录、拖到新文件夹都会碰到)。**这条只过了 typecheck,没重跑实测**。
- **新发现、未修**:被**取消**的传输同样返回 `ok: true, count: N`(下载的失败/取消都没有反映到返回值里,和上传那条是同一类问题,上传已修、下载没修)。
- 靶机清理的最终正确姿势:`scripts\dev-sshd.ps1 clean`;杀应用按 `Name -eq 'electron.exe'` 且命令行含临时 profile 目录;**别按命令行匹配 `xssh-target`**——会把跑命令的 PowerShell 自己杀掉。

**第十一批(下载返回值补齐,三件事一次验完)**:`downloadJob` 现在返回 `{ files, failures, cancelled }`,`sftp:download` / `downloadMany` / `downloadTo` 三条通道据此回报:取消 → `{ ok: false, canceled: true }`,有失败 → `{ ok: false, error: "N 个文件失败" }`,`count` 用真正的成功数。靶机上**一次跑完三项**(200 MB 文件):① 下载到**不存在**的两级目录 `…\xssh-new\sub` → `ok: true, count: 1`,目录被建出来、209,715,200 字节写入;② 传输中取消 → `{ ok: false, canceled: true }`;③ 紧接着续传 → 209,715,200 字节且与远端 SHA-256 一致。**取消后部分文件会保留**(续传的前提)。

**第十二批(`execRemote` 加超时)**:它只监听 `close`/`error`,远端命令卡住(tar 等 stdin、NFS 挂死)时打包下载 / 解压 / 校验三条路永远不返回,渠道也不释放、没有取消入口。现在实例字段 `execTimeoutMs`(默认 5 分钟)+ 超时后 `reject('远端命令超时')` 并 `channel.close()`;`finish()` 幂等,超时与正常关闭先到先算。测试 `connect.test.ts` 新增一条:假服务器接受 exec 但**永不结束**,`execTimeoutMs = 150` 时 `packAndDownload` 在 5 秒内以该错误拒绝(325 个用例全绿)。字段是公开的,以后测别的超时可以照用。**`forwardOut` 仍无超时**(跳板机上目标端口被静默丢弃时 `connect` 不 settle),那条没做。

**第十三批(跳板机 open 超时)**:`connectJump` 在跳板机 `ready` 之后调 `forwardOut`,回调是唯一出口;跳板机接受了 SSH 却在目标端口上被防火墙静默丢弃时,ssh2 没有自己的超时,`connect()` 永不 settle、会话登记泄漏。现在 `ready` 里起一个 `jumpForwardTimeoutMs`(默认 30 秒)计时,超时走原有的 `fail()`(关跳板客户端 + 拒绝),回调到达时清计时。测试 `connect.test.ts` 新增一条:假跳板机对 `tcpip` **永不回应**,200 毫秒超时下 `connect` 返回失败且错误里带"跳板机"(326 个用例全绿)。

**第十四批(补焦点陷阱 + reload 后的语言)**:① 文本编辑器、命令片段变量框、SFTP 抽屉里的四个弹层(新建 / 重命名、同步、部署、预览)都声明自己是模态却没有陷阱,Tab 会走进背后的页面、Esc 随之失效 —— 各自加 `tabindex="-1"` 与 `useFocusTrap`。**设置页不是模态**(`.settings` 只有 `display:flex` 和背景,没有遮罩 / 定位 / z-index,它是换页),审阅里那条是误报,没动。② 渲染层 reload(崩溃后 `win.reload()`)复用的是窗口创建时捕获的 `prefs`,语言会退回"跟随系统" —— `i18n.ts` 现在在模块加载时再向设置文件要一次 `lang`,不同才覆盖。实测:临时 profile 里把 `lang` 写成 `zh-TW` 后 reload,侧栏是"連線 / 終端機"(改之前会退回简体)。两条都过了 typecheck / build / 326 用例;**陷阱的界面行为仍未逐个点过**。

**第十五批(焦点陷阱的静态兜底)**:`src/renderer/src/composables/focusTrapCoverage.test.ts` 扫 `components/*.vue` 的**模板段**,凡是带模态根类(`overlay` / `layer` / `pm-overlay` / `dlg-layer` / `sv-backdrop` 等,名单与 `lib/modals.ts` 同源)或 `aria-modal` / `role="dialog"` 的组件,必须在源码里调用过 `useFocusTrap(`。TransferPanel 走 `.tpanel-backdrop`、是有意不设陷阱的侧栏(拖文件时要能操作后面的面板),列在 `ALLOWED` 里并注明理由。**踩了两次坑**:① 一开始用 `\boverlay\b` 会把 `.ctx-overlay` / `.pop-overlay` 这类右键菜单遮罩也算进来 —— 改成按 class 属性分词整体比对;② 只看整个文件会把 `HostsPage.vue` 脚本里那句选择器字符串 `'[aria-modal="true"], .overlay'` 误判成模态 —— 改为只扫 `<template>` 段。③ 最要命的一条:**阴性对照第一次没失败**,因为注释掉的 `// useFocusTrap(...)` 仍然含 `useFocusTrap(`;先剥注释再判断之后,注释掉那行会让测试如实报出 `SnippetVarsDialog.vue`(对照成立,恢复后 328 全绿)。这条检查只能证明"调用存在",证明不了 ref 指向正确的元素——界面行为仍需人工点。

**第十六批(把抽屉的 Tab 行为验掉,并记下界面路径)**:抽屉里的**本地面板默认是关的**(`localOpen = false`),要用工具栏那个 `ib` 按钮(`sfp.local`,"本机双面板")打开;打开后本地头部才有 `ib sm` 的「新建文件 / 新建文件夹」图标,那才是 `localNew()` → `localModal` 模态框的入口。**工具栏上叫「新建文件夹」的那个按钮是远端面板的行内输入**(`@blur="commitCreate"`),按 Tab 让它失焦会立刻提交并收起 —— 看着像"对话框被 Tab 关掉了",其实是正常行为。实测(真实按键):本地面板 → 新建文件夹 → 焦点在 `INPUT.box` → 连按三次 Tab 后仍回到同一输入框(输入框 / 取消 / 确定三个循环)→ Esc 关闭正常。文本编辑器与片段变量框的陷阱仍只有 `focusTrapCoverage` 的静态保证,**没有逐个按过**。

**操作教训**:用 `Start-Process` + `Start-Sleep` + `Wait-Process` 启动应用时,那次调用会一直阻塞到工具超时(900 秒)把窗口一起杀掉,白等十几分钟;去掉 `Start-Sleep`、只留 `Wait-Process -Id $p.Id`,调用会立刻返回"仍在运行",窗口留在那里给 `app` 工具接管。

**第十七批(文本编辑器打开时没有焦点)**:从 SFTP 抽屉右键「编辑」打开应用内编辑器后,焦点仍停在背后的 `ASIDE.sftp` 上 —— 陷阱只在第一次按 Tab 时才把焦点拉进来,在那之前 Esc 无效。`TextEditor` 补了 `watch(() => props.open)` + `nextTick(focus)`。实测:改前 `active` 是 `ASIDE.sftp drawer`、`inside: false`;改后是 `DIV.editor`、`inside: true`。
**注意**:编辑器里 Tab 被文本区当成缩进(实测内容从 24 字符涨到 26),所以这个对话框**没法用 Tab 循环来验证陷阱**,只能验"打开即有焦点"。片段变量框同样没有逐个按过。

**第十八批(片段变量框的陷阱也验了)**:先纠正两条自己的误判 —— 片段**不是**设置文件里的键,store 走的是 IPC `window.api.snippets.list()` / `save()`,所以 `settings.set('snippets', …)` 会被白名单拒掉(而且我最初没看返回值),直接改 profile 的 `settings.json` 也没用。用 `snippets.save()` 写入后 `Echo Var`(`echo {who}`)立刻出现在 store 里。**从命令面板点它时变量框没打开、焦点落到 BODY** —— 现在查清了:`activate()` 会先 `togglePalette(false)` 再 `sendSnippet`,而 `sendSnippet` 在**没有活跃会话**(`activePane?.sshSessionId` 为空)时**静默 return**;面板已经关了,于是看着像"应用无视了这次点击"。已补提示:`sendSnippet` 在无会话时 `toast(t('app.needLiveSession'))`(文案早就存在)。实测(临时 profile、无会话):命令面板里点 `Echo Var` → 出现"需要先建立连接"、不弹变量框。**有会话时**的路径另外验过:焦点在 `INPUT.sv-input`,Tab 依次到"发送"→关闭按钮仍在 `.sv` 内,Esc 关闭。

**审核剩余未修**:跳板机 `forwardOut` 无超时;`SftpDrawer` 几处输入框缺 IME 守卫、本地面板没有序号守卫;设置 / 文本编辑器 / 片段变量框与抽屉内几个弹窗仍无焦点陷阱;`recordChord` 的冲突检测没算硬编码键位(Mod+1..9、终端里的 Ctrl+C / Ctrl+V)。

验证:typecheck(node+web)、`vitest 324`、build 全绿;应用内临时 profile(`%TEMP%\x-ssh-verify-24`,端口 9223)实测:无模态时 Ctrl+K 正常开关、有主机编辑器且焦点在按钮上时 Ctrl+K 不再弹出、两个对话框打开即获得焦点。临时 profile 与进程已清理。

# 会话记录:第二十二次会话(2026-10-17 凌晨,"全面修复":收掉第三轮记录的低危项)

用户"全面修复"。把第二十一轮记录未修的 4 条低危 + 安卓触控尺寸全部做掉,随后发 0.4.5。验证:桌面 typecheck(node+web)、vitest 324、build、lint:i18n 全绿;安卓 BUILD SUCCESSFUL。

1. **模态焦点陷阱**(新 `src/renderer/src/composables/focusTrap.ts`):此前**所有**对话框 Tab 都能跑到背景元素上——键盘用户会往(视觉上被遮住的)背景里打字,而且焦点一离开子树,Esc 就失效(`aria-modal="true"` 的声明一直是空头支票)。实现要点:监听绑在 **document 的捕获阶段**而不是元素上(陷阱安装时焦点可能已经跑出去了);可选元素列表刻意贴近规范(用 `[tabindex]` 会把对话框根自己也圈进去、破坏循环);焦点在对话框外或停在根上时按 Tab 先拉回第一个/最后一个;对话框内无任何可聚焦元素时 `preventDefault` 并聚焦根,绝不放它逃逸。已接 12 处:CommandPalette、ConfirmDialog、HostEditor(复用已有 panelEl)、LockScreen、TmuxDialog、HistorySearch、PermDialog、ForwardDialog、PublishKeyDialog、SessionReplayDialog、FileDiff、DirDiffDialog。**注**:`PermDialog/FileDiff/DirDiffDialog` 由父级 `v-if` 挂载、无 `open` prop,故传 `() => true`。
2. **主机编辑器关闭脏检查**:Esc / X / 点遮罩 / 页脚"取消"统一走新的 `requestClose()`——与打开时快照(`formSnapshot()` 含 password/passphrase,因为输了口令又关掉同样是丢数据)比较,有改动先弹确认(三语言新键 `host.discardConfirm`/`host.discard`);生成密钥弹层开着时仍先关弹层。保存成功/删除成功后的关闭**不走**该检查。
3. **遮罩触发统一**:TransferPanel、SnippetVarsDialog 的 `@click.self` → `@mousedown.self`(与其余 13 处一致,避免拖选文本时误关)。
4. **安卓硬编码颜色收进调色板**:6 处 `Color(0xFF...)` 之前每处都带 `if (p.dark)` 双分支(显示正确),现收进 `XsshPalette` 的 4 个新语义字段:`switchThumb`(分段/开关滑块)、`keyFace`/`keyFacePressed`(按键面板)、`barBg`(终端工具条)。深浅两套都填好。
5. **安卓触控尺寸**:改用 `Modifier.minimumInteractiveComponentSize()` 而不是直接放大尺寸——**只扩触摸热区到平台最小值(48dp),可见视觉尺寸一点不变**。应用于 `ToolbarIcon`(40dp)、`SidebarRow` 关闭键(28dp)、`SidebarSearch` 清除键(24dp)、`Segmented` 分段项、`XsshSwitch` 开关。(先前误用 `heightIn(TouchMin)` 会把可见轨道也撑大,已改正。)

**仍未做**(有意搁置,理由:收益低/风险高):安卓 `HostEditorScreen` 的 `remember` 无 key(当前导航流不可达);平板 HoverTip 在触摸设备上的表现;桌面 `--row-sel` 已删。

# 会话记录:第二十一次会话(2026-10-17 凌晨,第三轮走查:安卓 Compose 首次界面走查 + 全局一致性 + 覆层契约)

用户要求"再走查一遍所有代码,特别是 UI 细节"。这轮刻意选**前两轮没覆盖的面**:① 安卓 Compose 界面(此前从未做过界面专项走查)、② 桌面外壳/主题/全局样式一致性、③ 所有覆层的交互契约一致性。三个并行代理报 30 余条,核实后**修 22 条**。验证:桌面 typecheck(node+web)、vitest 324、build、lint:i18n;安卓 BUILD SUCCESSFUL。

**最高危(DirDiffDialog 整个外壳无样式)**:`DirDiffDialog.vue` 用的 `.pm-overlay/.pm-dialog/.pm-head/.pm-x/.pm-foot/.pm-btn` 只在 **PermDialog 的 scoped 样式**里定义(scoped 不跨组件生效),`sync-field`/`sync-dialog` 更是全库无定义 → 目录对比对话框**没有遮罩定位、不居中、无背景**,点遮罩关闭也几乎点不中。修:把这套外壳(12 条规则)提到 `global.css` 作为共享对话框壳,PermDialog 改为消费全局;DirDiffDialog 的 `sync-*` 改为通用 `dialog-field`;`pm-err` 同样提全局。**这是可复用的教训:任何被两个组件共用的类名都不能只写在其中一个的 scoped 里。**

**已修其余项**:
- 桌面外壳:`--accent-contrast` 从未定义(4 个对话框靠 `#fff` 兜底,浅强调色下按钮文字不可读)——在 global.css 三处主题定义,并由 App.vue 按强调色**亮度**自动算黑白(复用 `accentSoft` 的位置);`--row-sel/--row-sel-ring` 定义了却零消费(含 App.vue 的 setProperty)→ 删除;App.vue 的横幅抢焦点守卫只查 `.overlay`,漏掉 HostEditor 的 `.layer` → 补;StatusBar 一整套 `.fw-*` 死样式 → 删除。
- 覆层契约:`DirDiffDialog/ForwardDialog/LockScreen/SessionReplayDialog/PublishKeyDialog/FileDiff` 6 个对话框**打开时无焦点**(Esc 完全失效)——全部补 `onMounted` 聚焦 + `tabindex="-1"`;LockScreen 是**全屏拦截层**却要手动点击才能输入 → 自动聚焦;**ConfirmDialog 的 danger 确认默认聚焦破坏性按钮**(回车即删)→ danger 时聚焦取消;ForwardDialog 删除转发**无确认**(转发页同操作有)→ 补 confirm+danger;HostEditor 生成密钥弹层开着时 Esc 只关弹层、点遮罩却关整个编辑器(丢表单)→ 遮罩也先关弹层;SnippetVarsDialog 的 Enter 未过滤 IME 组字 → 中文输入法选词的回车会误提交命令。
- 快捷键:终端聚焦时 **Mod+Shift+F 双触发**(终端的 "mod+F 也开搜索" 分支没排除 Shift,同时又冒泡到全局 history)——分支加 `!e.shiftKey`。
- 原生界面:主进程 **19 处原生对话框文案硬编码简体中文**(覆盖确认、导出/导入、选目录等),语言设为 en/zh-TW 的用户会看到中文弹窗,而托盘菜单早已本地化 → 建 `NL` 字典 + `dl(key)` 异步查询(与 `TRAY_LABELS`/`resolveLang` 同源)。
- 安卓(首次界面走查):**首次进文件页列表区整块空白**(loading 时渲染空串)——加 `CenterBusy` 转圈 + 列表占位 spinner;`Segmented` 分段控件触控高仅 ~32dp、`XsshSwitch` 开关 32dp——补到 48dp 热区(视觉尺寸不变)。

**记录未修**(低危,理由充分):12 处 `Color(0xFF...)` 硬编码但**均带 `if (p.dark)` 双分支**、深浅都对,属可接受的现状;安卓开关图标 40dp / 侧栏清除键 24dp(鼠标场景为主);全体模态无焦点陷阱(Tab 可逃逸到背景,系统性改动,单开一轮更合适);HostEditor 关闭无脏检查(需设计"是否保存"三选);遮罩触发方式 `click.self`(2 处)与 `mousedown.self`(13 处)不统一(低危);`HostEditorScreen` 的 `remember` 无 key(当前导航流下不可达)。

**⚠️ 下次打安卓 APK 前**:本轮又改了 Rust 无关但改了 Kotlin,`.so` 不受影响(未动 Rust),但需正常 `installDebug`。

# 会话记录:第二十次会话(2026-10-16 晚,界面细节专项走查:3 个并行审查代理 + 逐条亲自验证)

用户要求"全面审核代码,检查所有界面细节"。三个并行代理按 HANDOVER 沉淀的界面规范(圆角变量/交互状态/节奏/三语言/空态)分块深读全部 29 个组件 + global.css + i18n,报 31 条;核实后**修掉 19 条**,其余记录。验证:typecheck、vitest 324、build、lint:i18n(新增 4 键三字典)全过。

**已修(按组件)**:
- **TransferPanel / SnippetVarsDialog:11+5 处引用从未定义的 CSS 变量**(`--bg2/--bg3/--muted`)——面板背景透明、文字直接叠在终端上。映射到 --bg-elev/--bg-elev-2/--text-dim。(代理多报了一个 --err,实际不存在。)
- **CommandPalette**:① 广播框回车**双触发**——submitBroadcast 同步关面板后事件继续冒泡到 onKey,落入通用 Enter 分支误激活选中项(输入框加 `.stop`);② 键盘 ↑↓ **从不滚动选中项进视野**,长列表下盲选(加 listEl + watch(selected) → scrollIntoView nearest);③ 空态只有一行字(补 search 图标);④ `.sub` 无 ellipsis(长 IPv6 撑行)。
- **PaneNode**:错误/关闭卡 `width: min(300px, 86vw)` 基于视口,极窄窗格中溢出且**重连按钮滚动不可达**(flex center 的经典裁切)。改 `min(300px, 100%)` + `margin: auto`。分割条命中区 1px 难以起步,加 ::before 隐形热区。
- **HostEditor**:① 有托管密钥后「浏览」入口消失,外部路径旧主机在 select 里显示空白(保留浏览 + 动态补当前路径项);② 生成密钥弹层开着时焦点漂到背景,Esc 直接关整个编辑器**丢未保存表单**(面板 Esc 先判弹层);③ 保存按钮禁用无原因(title 三语言 `host.saveDisabled`)。
- **SettingsDialog**:① 数字框清空瞬间把默认值写盘(保活被静默清 0)且框被强制写回——空输入不再提交;② 备份间隔无上限(5000h 直接入库,与 max=720 矛盾)——钳 1..720;③ 清空连接日志无二次确认(全页唯一裸奔的破坏性操作)——加确认框;④ 强调色板默认 '#6ea8fe' 硬编码暗色值(**未修**,记录)。
- **ForwardsPage/ForwardDialog**:端口校验缺 `Number.isInteger`(80.5 可通过,与 ForwardsPage 不一致);对话框无焦点 Esc 失效(已 focus)。
- **StatusBar**:长主机名把右侧徽章推出窗外(seg.host min-width:0 + host-text ellipsis)。
- **TerminalView**:右键菜单快捷键硬编码 Ctrl,macOS 实际是 ⌘(用 TabBar 同款 modKey)。
- **HistorySearch**:精确化关键词后高亮索引越界、回车静默失效(watch results 钳位);500 条截断时计数撒谎(MAX_RESULTS+ 提示)。
- **SftpDrawer**:连续同步不随抽屉卸载停止(deleteExtras 场景 UI 不可见仍删文件)——onBeforeUnmount 补 watchStop。
- **snippetVars**:变量留空回车直接把残缺命令发进终端——必填校验 + 高亮 + `snip.varsRequired` 三字典。

**记录未修**(低危/改动大):HostEditor 生成弹层的 Tab 圈禁(Esc 已修,焦点圈禁要 inert);颜色色板 title 是原始色值(要 12 色×3 语言的键);按下缩小反馈在侧栏 nav / 分组 tab 缺失(纯打磨);CommandPalette pending 态遮罩点击直接关面板(与 Esc 的"返回搜索"不一致);TransferPanel 失败行不留原因展示且无 ETA;SettingsDialog 数字框未做草稿态(空输入守卫已覆盖主要危害)。

# 会话记录:第十九次会话(2026-10-16 下午,全代码审查:4 个并行审查代理 + 逐条亲自验证)

用户要求"审查所有代码"。分四块并行深读(桌面主进程+shared / 桌面渲染层 / 移动 Kotlin / 移动 Rust),共报 24 条;**每条都亲自读上下文核实后才动手**,修掉 18 条,其余记录。验证:桌面 typecheck + vitest 324、build;Rust cargo test 36 + clippy 干净;Kotlin testDebugUnitTest BUILD SUCCESSFUL。

**已修(确认级缺陷,按危害排)**:
1. **【高·桌面】`data:exportAll` 与自动备份的 `allowLocked` 正好写反**(index.ts:1070/376):锁定状态下手动导出把**全部明文密码**写进用户选的文件(主锁形同虚设),而计划自动备份反而被锁卡死、异常被吞、静默停摆 —— 与 store.ts 注释"allowLocked 供 scheduled auto-backup 使用"完全相反。已对调。
2. **【高·桌面】同步的目录枚举失败被静默吞掉,`deleteExtras` 据此批量删除真实文件**(ssh.ts walkLocalTree/walkRemoteTree):readdir/stat 任一失败 → 部分 map → "读不到"被当成"不存在" → 1543 行起逐个 `unlink`。现在 walk 返回 `boolean`(任何读失败 = false 且传播),四个调用点全部处理:syncJob 直接中止(抛"目录枚举失败,本次同步已中止")、refreshWatchBaseline 保留旧基线、runWatchPass 跳过本轮、diffDirs 抛错不再显示错误 diff。
3. **【高·移动】通知点开会压入第二个 MainActivity**:Manifest 无 `launchMode`、PendingIntent 无 flags → 双实例各自持有 hosts 状态,`persist` 互相覆盖(空表护栏防不了"非空但陈旧")。已加 `launchMode="singleTask"` + Intent flags。**注意**:devAutoConnect 只在 onCreate 读,singleTask 下重复 start 走 onNewIntent,行为不变。
4. **【高·桌面】下载恢复队列按**失败的旧会话 id**执行,重连后全部失败还被整队清空**(sessions.ts queueDownload / SftpDrawer.resumeDownloads)。`DownloadQueueOp` 加 `hostId`(入队时从 paneBySession 取,progress 事件先于掉线事件到达,所以通常拿得到),resume 时按 hostId 映射到该主机现在的活会话;映射不到或仍失败的 op **保留在队列**(新增 `setDownloadQueue`),不再丢记录。顺带修了 showResume 误看 `transferQueue` 的笔误。
5. **【中·桌面】锁定状态下 `lock:setPassphrase` 不验证旧口令即可换新口令并解锁**(lock.ts)——与 `reset` 特意防"桌边的人"的注释矛盾。已加 `enabled && !unlocked → 拒绝`。
6. **【中·桌面】`disposeAll` 不关转发监听和 master 的跳板隧道**(ssh.ts):macOS 关窗(进程存活)后端口被旧转发占死、跳板连接泄漏。已补 `closeForwards(session)` 与 masters 的 jumpClient/sock 收尾。
7. **【中·移动】自动重连握手进行中会话被关闭 → 刚建成的 transport 整条泄漏**(Sessions.kt reconnect):`withContext(IO)` 里 openTransport 完成后协程已取消,结果被丢弃。已在取回后用 `NonCancellable` 检查 `!job.isActive`,先 `close()` 再放弃。
8. **【中·桌面】连续同步(尤其 + 删除多余文件)不随抽屉卸载停止**(SftpDrawer onBeforeUnmount):关抽屉后 main 里的 watcher 继续轮询删除,UI 无入口停止。卸载时已补 `watchStop`。
9. **【中·桌面】SFTP 目录读取无乱序守卫**(SftpDrawer.load):快速导航时旧响应后到会回填错误目录。已加 `loadSeq` + sessionId 双守卫。
10. **【中·Rust】通道打开失败后 `events` 被 take 走不归还**(ssh.rs open_channel):这条连接从此永久 `ChannelInUse`。失败分支已归还;已打开的 channel 留给服务端按超时收尾。
11. **【中·桌面】快照恢复永不落盘**(openSnapshot):closeTab 逐个 persist 空列表,restoreTabsFrom 后没有 persist → 重启全部消失。已补。
12. **【中·Rust,潜在】`Shell::eof/close` 是仅有的两个没有 STEP_TIMEOUT 的写路径**(ssh.rs:660+):死连接 + 写缓冲塞满会话循环卡死。已与 write/resize 同一套超时。当前 FFI 未导出它们,属预防。
13. **【低】杂项**:Rust `Term::new/resize` 无尺寸上限(u32 巨值 → 分配失败 abort,已钳 1000);桌面恢复/解锁重连预置的 `reconnectAttempt` 成功后不清(下次掉线跳过 1s 档,runConnect 成功已清);glob 转义漏 `\` 和 `]`(Windows 文件名匹配失败);OpenSSH config 导出把代理明文密码嵌进 ProxyCommand(已改为注释占位);移动端 SFTP progress 回调抛异常会在 Rust 侧 panic 并绕过上传临时文件清理(Kotlin 侧已 try/catch);安卓前台服务在"最后会话刚清 + 新 startForegroundService"窗口内不调 startForeground 会 5 秒崩(onStartCommand 已无条件调)。

**记录未修**(低危/改动大/已知设计):settings 跨进程 read-modify-write 的丢失更新窗口(durableFile 队列是 per-process 的);`keyManager` 生成密钥时 passphrase 经 argv 明文可见于进程列表(ssh-keygen 无 stdin 选项,askpass 方案太绕);Rust Handler 的 unbounded 队列无背压(与 HANDOVER 已知的"没人收就堆"同源,是会话轮询存在的理由);移动端编辑页保存协程挂在 rememberCoroutineScope 上、离开页面静默丢弃。

**⚠️ 下次打安卓 APK 前**:本轮改了 Rust(ssh.rs/terminal.rs),必须先 `cargo ndk` 重编 .so(HANDOVER 坑 5),否则 APK 里是旧核心。桌面 `D:\Apps\X-SSH` 未更新到本批(仍是 0.4.2)——重新 package + robocopy 即可。

# 会话记录:第十八次会话(2026-10-16 凌晨,"连接被服务器重置"排查与修复)

用户报:服务器百分百正常,但关程序一段时间后回来连接经常失败("连接被服务器重置"),手动重试几次才连上;任何第三方 SSH 都没有这个问题。截图:Ubuntu 26.04 5090(user@192.168.1.101,**端口是 22**,标签里的 5090 是主机名的一部分)。

**根因(现场实测钉死,不是猜的)**:该服务器是 **OpenSSH 10.2p1**,`PerSourcePenalties` **默认开启**——它给"做了连接却不认证"的客户端地址记分(noauth),累计超过 min(15s) 后直接拒绝该地址的新连接,拒绝时发送明文 **"Not allowed at this time"** 后断开(客户端表现为 ECONNRESET)。从这台 PC 实测:连续 8 条预认证连接后,ssh2 连接在该地址上**拒绝/放行交替**——罚分就在阈值附近摆。喂罚分的两个来源都是 X-SSH 自己:① **在线探测**(ping 偶发 4s 超时 → `sshPortOpen` 的预认证连接;每 3 分钟 + 窗口可见都探);② **失败后的自动重连**(每次被拒的连接本身就是一条 noauth,重试在给罚分续命——滚雪球)。停止重试后罚分衰减 → "重试几次就连上"。第三方 SSH 不做探测、不自动重试,所以没有这个问题。连接日志(`connectionLog`)证实 10-10 18:37–18:39 有 6 连败,之后 18:46 才 connect 成功。验证命令:`journalctl -u ssh --since -1h | grep -i "penal"`(服务器侧可见拒绝记录)。

**修复(桌面端,4 文件 + 测试)**:
- `src/shared/reachability.ts`:`SshProbeOutcome`('open'/'closed'/'down')、`sshProbeOutcome()`、`SSH_PROBE_COOLDOWN_MS`(10 分钟)、`sshProbeCoolingDown()`。**探测过 sshd 的主机进入冷却**:ping 失败的那一轮不再每 3 分钟敲一次 SSH 端口,10 分钟内直接沿用 'online';拒绝/超时的主机不冷却(没有罚分可喂,且要尽快发现恢复)。**冷却的代价**:主机真下线时圆点最多晚 10 分钟变灰。
- `src/main/reachability.ts`:`sshPortOpen` 改返三态(任何对端数据=‘open’,含罚分拒绝文本;ECONNREFUSED='closed';其余='down'),模块级 `sshProbeMemo` 按 `host:port` 记忆。注意老版 sshd(9.8/9.9)静默拒绝时客户端只看到 RST,归 'down' 仍会重试——用户这台 10.2 发文本,已覆盖。
- `src/main/friendlyError.ts`:'not allowed at this time' → 专用文案("服务器暂时拒绝连接:该地址触发了连接频率限制…");导出 `isTransientConnectError()`(reset/超时/unreachable/罚分=瞬态;**认证失败/主机密钥绝不瞬态**)与 `penaltyRetryDelayMs()`(罚分拒绝 → 30s,让衰减跑完再试)。
- `src/shared/types.ts`:`ConnectResult` 加 `transient` / `retryDelayMs`;`src/main/ssh.ts` 的 `client.on('error')` 出口在 friendlyError **之前**用原始错误标注。
- `src/renderer/src/lib/reconnect.ts`:`retryDelayMs(attempt, random, minDelayMs)` = 退避但不低于下限(罚分场景 30s 起步,重试不再喂罚分)。
- `src/renderer/src/stores/sessions.ts`:`scheduleReconnect(paneId, { minDelayMs, keepError })`(keepError 时延迟期保持失败卡 + 文案尾缀"将自动重试",不闪"正在重连");**`runConnect` 失败且 `result.transient` 时自动进入重连循环**(以前只有已建立会话掉线才重试,初始失败全靠手点);守卫 `!pane.reconnectAttempt` 防循环内双重调度;`reconnect()` 的 `cancelReconnect` 保证用户手动重连接管定时器。
- i18n:+1 键 `app.autoRetrySoon`(三字典);`npm run lint:i18n` 桌面 734×3 / 移动端对称。
- 测试 311 → **324** 全绿:`friendlyError.test.ts` 新建(含阴性对照:认证失败绝不瞬态),`shared/reachability.test.ts` +4(冷却的阳性/阴性/过期/未探测),`reconnect.test.ts` +3(retryDelayMs 的下限/抖动)。typecheck、build 通过。

**没做的(下次可做)**:手机端同样会被罚分滚雪球(M3.60 自动重连 12 次、M3.68 首连重试 3 次都没有对"被拒"拉长间隔)——把 `penaltyRetryDelayMs` 的思路移植过去;服务器侧一劳永逸的办法是 `sshd_config` 加 `PerSourcePenaltyExemptList 192.168.1.0/24`(内网全豁免),已在回复里给用户。

**二次复核(同日)**:diff 全读,逐点验证——`finish` 幂等(data 后 end/close 竞态安全;移除的 'end' 处理由 'close' 兜底,行为等价);`locked`/`jump_needs_password` 在进入连接前返回(不经过 error 出口,无 transient 字段,绝不会自动重试);`transient: !keyRejected && …` 保证指纹卡不被自动重试顶掉;循环内失败由回调自己调度(`reconnectAttempt` 守卫防双重),用户手点 `reconnect()` 的 `cancelReconnect` 接管定时器,pane 关闭后 `findPane` 为 null 安全返回;罚分下限全程透传,`keepError` 只作用于首次等待;冷却只对 'open'(见过 sshd)生效。**修掉 1 处认知**:原以为 `client.on('close')` 的掉线 error 也会带 transient——实际 settled 标志挡住,不影响。记录不改:老版 sshd(<9.9)静默 RST 归 'down' 仍每轮重试(用户 10.2 发文本已覆盖);冷却中真下线晚 10 分钟变灰;已建立会话掉线的重连没接 30s 下限(掉线前连接认证过,不是罚分主体)。验证:324 全绿 ×2、typecheck、build。

# 会话记录:第十七次会话(2026-10-15,移动端复核修复 + 0.4.1 发版)

细节在 `mobile/HANDOVER.md` M3.68。桌面侧只有发版:

- 0.4.1 已推 `main`(`668d81e`)+ tag `v0.4.1`,CI 两条都绿,Release 里有安装包。随后 `e609645` 改正 CHANGELOG(我最初把 macOS 条目误记在 0.4.1 下,其实在 0.4.0 tag 里)。
- 发版前跑过:`typecheck`、`lint:i18n`、`vitest` 311、`build`,安卓单测 JVM 全绿。
- 这台 PC 的 `D:\Apps\X-SSH` 已更新到 0.4.1(用户授权代关进程,优雅关闭 4 个进程,哈希核对一致);**之前装的是比 0.4.0 更早的构建**,具体哪一版没核。装完没启动、没点界面。
- 工作区只剩未跟踪的 `.workbuddy/`(不是我们的,没动)。

# 会话记录:二次复核(2026-10-03,启动闪跳 + 主机密钥确认)

- **启动闪跳的补漏**:启动偏好是窗口创建那一刻读的,渲染进程崩溃后主进程会 `win.reload()` 一次,重载拿到的是旧值。`loadSettings`
  恢复读这五项,但**只在设置里有值且和当前不同时才改**(正常启动两边相同、什么都不动);缩放同理(`App.vue` 读设置里的 `zoom`,和当前不同才恢复)。
- **主机密钥确认(第十五次会话那批)审出 8 条,全修**:
  1. **卡片上没有指纹** —— 用户点「信任」时根本看不到在信任什么,等于多点一下的静默信任。现在卡片显示「服务器出示的指纹」,
     密钥变更时再显示「之前记录的指纹」(划线);格式和 `ssh-keygen -lf` 一样(`SHA256:` + base64 无填充,`shared/hostKey.ts formatFingerprint`,
     存储仍是 sha256 hex)。设置 → 安全的 known_hosts 列表也改成这个格式。
  2. 主机密钥类报错原来显示主进程硬编码的中文、跳板机不说是哪一台(交接文档写的「已按语言翻译」与代码不符)。现在按 `code` + `keyHost`
     走四条新文案(未信任 / 变更 × 目标 / 跳板机,带 `{host}`),三字典齐全;这类情况不再弹 toast(卡片已经说明)。
  3. `ssh:trustHostKey` 原来什么都不校验。现在 `SshManager` 记住每个 host:port **最近一次被拒的那把钥匙**(`noteRejected` / `takeRejectedKey`),
     只有和它完全一致才写入(用一次就作废),外加类型 / 64 位 hex 校验;信任动作记连接日志(`trust-host-key`)。渲染层收到拒绝就直接重连,
     让卡片按服务器当前出示的钥匙重新出现。
  4. 换了新钥匙时 `firstSeen` 重置(原来沿用旧钥匙的日期)。5. 钥匙 / 主机 / 端口三项一起赋值(原来钥匙可能沿用上一台的)。
  6. 跳板机 `keyPort` 默认 22。7. 删掉了「没有指纹就忘掉目标记录」的兜底(会忘错机器)。8. 主机密钥被拒时自动重连不再重试(原来最多重试 6 次、卡片一直不出现)。
  新测试:`shared/hostKey.test.ts`(3 条,和 node 的 base64 对照)、`connect.test.ts` 加一条「只能信任刚被拒的那把、换钥匙 / 换端口都不行、只能用一次」。
  桩页面截图核对了未信任 / 变更两种卡片。typecheck、vitest 299、lint:i18n、build 都过。

# 会话记录:启动闪跳修复(2026-10-03)

用户:侧栏收起的状态下打开程序会闪跳。原因:侧栏收起 / 宽度 / 专注模式、连接页的卡片 / 列表和排序都在 `loadSettings` 里**异步**读,
第一帧按默认值(展开 224px)画出来,读到设置后再收起、还带 0.2s 宽度动画;缩放比例也是挂载后才在 `App.vue` 里恢复,先画一帧 100%。
现在这些都放进主进程启动时同步交给页面的 `UiPrefs`(`readUiPrefs` → 启动参数 → preload `api.prefs`):store 的 `state()` 直接用它们
做初值(`bootPrefs`),`loadSettings` **不再重读**这五项(否则第一帧一个值、过一会儿又来一个);preload 里在页面任何脚本之前就
`webFrame.setZoomLevel(prefs.zoom)`。验证:桩页面在第一个 `.sidebar` 出现时量宽度 = 最终宽度(收起 64 / 展开 300)、启动期间
没有任何 `sidebar:width` 过渡;真程序用临时 `--user-data-dir`(预置 settings.json)+ CDP 读到 `api.prefs` 正确、侧栏一开始就是 64、
列表视图直接是列表。typecheck、vitest 295、build 都过。

# 会话记录:第十五次会话(2026-10-03,凭据安全收尾,桌面侧)

用户方向:把上一轮排好的两层做完——**TOFU 统一(桌面版首次改人工确认)** 与 **凭据 zeroize**。
移动端 M3.65(字标)那批未提交改动**不属于本会话**,未动;「语言」指桌面版(已在 `f6fef73` 做完),
只补了「待亲眼看」。本会话的全部改动 = 凭据/密钥安全那一层。

- **TOFU 统一(桌面版,8 个文件 + 测试)**:见「架构要点」新增条。改动:`shared/types.ts`(`ConnectResult`
  加 code / key / keyHost / keyPort)、`main/ssh.ts`(`connect` / `connectJump` 两处 `hostVerifier` 未知 / 变更
  统一拒绝;跳板失败改抛带身份的 `KeyError`;`connect` catch 透传;两个 verifier 统一 `String(hashedKey)`
  归一化)、`main/index.ts`(新 IPC `ssh:trustHostKey` 显式写指纹)、`shared/ipc.ts` / `preload/index.ts`
  (通道 + 暴露)、`renderer/src/stores/sessions.ts`(`Pane` 存 `hostKey / hostKeyHost / hostKeyPort`;
  `trustAndReconnect` 改「显式写入 → 重连」,无指纹时退回原 forget 路径)、`components/PaneNode.vue`
  (unknown 也走确认卡,按钮 / 文案按 unknown vs changed 区分)、`lib/i18n.ts`(三字典各 4 键)。
  测试:`src/main/connect.test.ts`(新,真 ssh2 服务器 5 条:已记录直通 / 未记录拒且不留痕 / 变更拒
  保留旧记录 / 未记录跳板在凭据送出前拒且不给隧道 / 已批准跳板走 direct-tcpip **双向**通道连到目标
  shell——ssh2 服务端对 `direct-tcpip` 发 `'tcpip'` 事件,数据是 `{destIP, destPort}`,**字段名是
  `destIP` 不是 `destAddr`**,客户端发的 `forwardOut` 目标地址在 `srcIP`/`srcPort` 里,**别按 RFC 想当然**)。
  验证:`typecheck`、`npm.cmd test`(295)、`lint:i18n`、`build` 全过。**应用内点验只做了第一种形态**
  (首次连接未信任卡,证据见「下一步」;② 变更卡、③ 跳板机卡未验,装 `D:\Apps\X-SSH` 后补)。
  点验用临时 profile(`--user-data-dir` 指向 `%APPDATA%\x-ssh-verify-15`)+ 回环假 sshd(ssh2 真服务器,
  ed25519 主机密钥持久化在 PEM 里以便跨重启身份稳定),全程不碰真实 userData;收尾已核对真实
  `known_hosts.json` 仍是 28 条、`hosts.json` 15 台、无 `127.0.0.1` 测试残留,临时目录与副本已删。
- **凭据 zeroize(核查,无代码改动)**:Rust 核心**认证完成后不长期持有明文凭据**——`Ssh` 结构体不含
  `Auth` 字段(russh `Handle` 不持有凭据,`Target.auth` 是 `connect` 的栈局部,返回即 drop);`russh::Method::Password`
  与 `ssh-key` 各算法的私钥在 Drop 时 zeroize(逐行核过 registry 源码:`russh-0.63.3` `auth.rs`、
  `ssh-key-0.7.0-rc.11` 各算法模块)。`SshError` 各支的 Display 全是固定短语(如「The key is encrypted」),
  不回显口令 / PEM —— 经 `FfiError::Message` 进 logcat / 界面这条路不泄凭据。所以 T2 的结论就是
  「**核心侧无需新增零化代码**」,证据写进了 `mobile/HANDOVER.md` §6。
  **唯一长期持有者是 Kotlin 侧**:`HostStore.load` 启动即把保存过凭据的主机全部解密成 `String`
  常驻进程列表;`String` 不可变,清零也留字节,只能等 GC(会话级 `credentials=null` 已做)。列为已知残留,
  下次单独立项(要重定义 `Host` / `Secrets` / `unlockCredentials` 契约,不是小活)。

# 会话记录:第三次复核(2026-09-30,后台识别 + 连接页新改动)

两个子代理分别审主进程(后台识别)和渲染层(连接页等),自己跑了几何审计 + 真实键鼠验证。修掉的:

- **后台识别(`quietExec` / `detectMissingOs`)**:超时从一开始就算(原来在跳板 / 代理连好之后才开始计时 —— 代理接了 TCP 不回握手就永远挂住,整个运行期不再识别);`connectProxy` 加 15s 握手超时,并把 socket 立刻交给调用方(`track`),超时时能关掉;所有退出路径(超时、出错、`client.connect` 同步抛错 —— 加密私钥没存口令时 ssh2 会同步抛)都关掉跳板、代理 socket 和客户端;真连接里 authConfig 失败也会关代理 socket 了。**跳板机密钥也必须已记录**(原来 `connectJump` 会在后台首次信任跳板机并送出保存的凭据)。忙标志在第一个 await 之前占住(两次探测同时结束会并行跑两轮、同一台登两次)。`store.setOs(id, os, at)`:地址已被改掉就不写(否则把旧机器的系统写到新地址上)。锁定 / 没有可用凭据时不算「试过」;中途关掉开关会停。登录被拒(密码错)或 shell 答不上来的地址记进 `osDetectFailed`(main 专用设置键),**一周内不再试** —— 原来每次启动都会用错密码登录失败一次;失败也记连接日志(`error` / `os-detect`)。`/usr/lib/os-release` 也读;`OsIcon` 的 arch 判断改成整词(Archcraft 不再冒用 Arch 标志)。测试新增 3 条(跳板密钥未记录拒绝、代理不回握手时按时超时且关闭 socket —— 做过阴性对照、坏私钥快速失败)。
- **搜索框快速连接**:「22.04」「web.prod」、半截 IP 这类不再被当成地址 —— 建议只在写了 `user@` / `:端口`、或正好是某台已保存主机的地址、或筛选结果为空时出现;回车:有建议走建议,否则筛选只剩一台就连它。已保存主机按不区分大小写的地址匹配(端口 / 用户名写了才比),建议里显示那台主机的名称和 user@host。建议只响应左键单击。
- **需要输密码的已保存主机**:点卡片 / ▶ / 回车 / 打开 SFTP / 端口转发页的「连接」原来都打开一个空的命令面板,现在 `store.askPasswordFor(host)` 让面板直接停在这台的输密码步骤(`palettePasswordFor`)。
- **卡片细节**:悬停让位只在窄卡片(或没有时间的宽卡片)上发生(原来宽卡片悬停也会让名字重新截断);显示 ⋯ 的条件从 `:focus-within` 改成 `:has(:focus-visible)`,菜单只有从键盘打开时才把焦点送进去 / 送回来 —— 原来右键或点 ⋯ 后焦点留在卡片上,⋯ 一直不消失、时间一直隐藏;Menu 键打开的菜单能用上下键。「已连接」只数已保存的主机。离线点去掉 0.6 透明度(浅色主题下对比度太低)。
- **最窄窗口**(容器 ≤ 560px):页头工具另起一行、统计 2×2、列表行去掉地址列(原来 ＋ 被裁掉、统计文字挤出边界、列表 ▶ 被裁)。注意这几条要写成 `.page-head .page-actions` / `.rows .hrow`,文件后面同优先级的规则会盖掉它们。
- **端口转发**:「连接」按钮连接中禁用(原来能连点开出多个会话)。**SFTP 页**本机栏名称 / 路径至少 80px(通配框先让),路径行字号颜色和远程一致。删了 `.sel-count`、`.state` 等无用样式,合并重复的 `.live`。

验证:typecheck、vitest 290、lint:i18n、build 都过;`run30.js`(搜索框各种输入 + 右键后焦点)、`run31/32.js`(700 / 1267 / 1440 宽)截图核对。

# 会话记录:新界面第二次全面复核(2026-09-29)

用户要求「二次复核所有 UI 和细节以及设计的逻辑合理性」。做法:三个子代理分块读代码(页面框架 / 主机编辑 + 设置 / SFTP + 终端 + 主进程),
自己用无头 Electron 把每页深浅色、宽窄窗口截一遍并跑 DOM 检查(溢出、截断、无标签的图标按钮),再用真实键鼠事件逐条验证修复。
修掉的(细节分别记在上面「架构要点」对应条目里):

- **连接页**:排序菜单被卡片盖住(水印时代留下的每段 `z-index:1` 各自成层,全删了);「打开 SFTP」要等连上才换页 —— 原来连失败也跳到 SFTP 页,显示的是**另一台已连主机的文件**(`store.openSftpFor`,连接中按钮变灰防重复点);`Ctrl+F` / `/` 有对话框时不再把焦点抢到背后的搜索框;卡片 / 行支持空格键,⋯ 菜单键盘打开时焦点进菜单、上下键移动、关掉回到按钮;搜索无结果改成图标 + 「没有与「xx」匹配的主机」+ 清除按钮,这时不再显示「新建连接」格子;窄窗口时搜索框可收缩、卡片最小宽不超过内容宽;启动恢复标签期间不先闪一下连接页(`booted`)。
- **主机编辑**:地址拆分误伤、点标签行删标签、焦点丢失后 Esc 失效(见上);私钥没有托管密钥时补回「浏览…」;四段说明文字(跳板机 / 代理 / 端口转发 / 连接后执行)放回展开面板里;地址占位缩短成「域名、IP 或 user@host:port」(原来被截断);颜色块有名字。
- **设置**:Esc、录快捷键、连接日志、窄屏、分段控件浅色(见上);备份几行补上标题(「主机备份(JSON)」「完整备份」「~/.ssh/config」),OpenSSH 那行按钮原来写的是「导出备份…」,改成「导入… / 导出…」。
- **端口转发**:见上「端口转发页」。
- **SFTP**:本机面板上放下文件后投放层一直盖着远程列表(放下事件在本机面板被拦住,外层计数没清零)—— 现在 `onLocalDrop` 和 `dragend` 都清零,且只有从系统或本机面板拖进来的文件才显示投放层(远程行之间拖动不显示「放下上传」);对话框里的文本框 / 下拉打字不再触发文件快捷键(在部署命令框按退格原来会让本机面板返回上一级,按 Delete 会弹出删除本机文件);筛选隐藏的行自动取消选择(原来「删除(2)」实际只删 1 个);菜单打开后按实际尺寸收回窗口内(原来按 170×210 估,文件菜单下半截会出屏);行悬停按钮会把焦点切到远程面板。
- **其他**:命令面板的主机用系统图标、选中用 `--selected`;命令面板里的片段和 tmux 附加会先切到终端页(原来在连接页也会往看不见的终端里打命令);没有标签时终端页不显示搜索 / 布局按钮;浅色主题的 `--ok` / `--warn` / `--danger` 加深(黄字在白底上原来约 1.4:1);macOS:非终端页顶部 20px 可拖窗口、侧栏字标下移让出红绿灯、专注模式时标签栏左边让出 78px(`<html class="mac">`,`main.ts`)。
- 主进程:系统探测超时的计时器清掉。

没改、记一下:探测系统用的 exec 在 authorized_keys 带 `command=` 的主机上会让强制命令多跑一次(无终端),目前没有开关;SFTP 页没有「再开一台」的入口(从连接页卡片菜单「打开 SFTP」)。
验证:typecheck、vitest 281、`lint:i18n`、build 都过;`scratchpad/ui/run19.js` 用真实键鼠验证了上面每条交互修复。

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
