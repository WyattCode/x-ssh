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
- **单元测试**: `npm.cmd run test`(Vitest 2;共 **295** 用例:纯逻辑在 `src/shared/*` / `src/renderer/src/lib/*`,外加 `src/main/*.test.ts` 的集成测试(起真 ssh2 服务器)。**没有任何组件测试**,界面交互只能人工验。
- **i18n 键对称校验**: `npm.cmd run lint:i18n`(现在串跑两个脚本:桌面端 `scripts/lint-i18n.mjs` + 移动端 `scripts/lint-i18n-mobile.mjs`;桌面端 zh / zh-TW / en 722/722/722 全对称,移动端三份资源对称且代码里 0 条内联中文)。
- 打包: `npm.cmd run dist` → `release\X-SSH Setup 0.3.0.exe`(NSIS)+ `release\win-unpacked\X-SSH.exe` + `.blockmap`。electron-builder 已是 **26.x**。
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
  - 设置 → 常规 → 语言那一排四个按钮排不排得下;Codex 里右键「复制」和菜单靠底部时收进窗口;繁体界面整体过一遍。(第十二次会话末记;「桌面版语言」代码在 `f6fef73` 已做完,这四项至今**没在应用里点过**。)
  - **第十五次会话记:host-key 确认卡的三种形态**——首次连接(未信任)、密钥变更、跳板机密钥失败(本会话改动未提交,需先 dist)。
    **已验一种**:① 首次连接(未信任)在应用内点通过(2026-10-03,临时 profile + 回环假 sshd,非装包验证):
    卡片标题「主机密钥未信任」、按钮「信任此密钥并连接」、正文「主机密钥未获信任,连接已中止;若此服务器是你自己的,
    可确认其身份后信任」;点下信任后 `known_hosts.json` 精确写入该主机指纹(与靶机 `ssh-keygen` 输出逐字相同)并带
    `firstSeen`。**未验两种**:② 密钥变更卡、③ 跳板机密钥失败卡——驱动脚本在这两段没跑通(先找不到主机页搜索框,
    后靶机进程被行内命令的收尾带走),留待装包后手工点或把脚本流程修稳再跑。
  - 移动端 M3.65 字标:MuMu 验过、**真机(18 Fold 等)没验**(见 `mobile/HANDOVER.md` M3.65)。
- `CHANGELOG.md` 的 Unreleased 已累积这一轮(快速连接 / 后台识别系统 / 新界面,第十五次会话补了主机密钥确认);三种语言 / 防丢失 / 右键复制已随 0.3.0 发过。要发版时升版本号、改日期。
- 按用户截图式 UI 反馈继续修复。
- 如版本号增加,改 `package.json` + 更新 `CHANGELOG.md` 后 `npm.cmd run dist` 重打包。
- 大规模改动前先跑 `npm.cmd run typecheck && npm.cmd run build` 与 `npm.cmd run lint:i18n` 保证通过。

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
