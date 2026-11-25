# 会话记录:M3.220(2026-11-25,应用内更新一轮二次审核 + 独立审查的收尾修复:v0.8.1 已发)

## 做了什么(细节见 CHANGELOG [0.8.1])

- v0.8.0 发布后对 updater 做**二次审核 + 独立代码审查**,修 9 条:①打包形态彻底忽略 `XSSH_UPDATE_FEED_URL`(electron-builder 26 不签更新清单,客户端只校验清单自述的 sha512,打包态认环境变量 = 能设变量的人可以让 Windows 静默装任意代码,且版本只升不降、装上洗不掉;覆盖改为仅未打包生效,打包版带该变量启动打醒目日志);②删掉 `before-quit` 里的手动 `quitAndInstall`(`autoInstallOnAppQuit=true` 时库自带退出安装钩子,而 `will-quit` 的 preventDefault 会让 before-quit 多轮派发、手动调用又把内部的 `quitAndInstallCalled` 复位开门,可能并发两个安装器,且手动调用是非静默会弹向导);③异常原文不再上界面(主进程分 5 个稳定机器码 `update-channel-404`/`update-rate-limited`/`update-check-timeout`/`update-network`/`update-check-failed`,广播与 IPC 只带码、原文只进 `host.log`,三语短句);④检查更新加 20 s 超时;⑤新增 `app:getUpdateState` 回读并把 `start()` 移到建窗口之后;⑥「已是最新」不再挂「前往下载」;⑦删卡片里死的名/备注展示与占位;⑧`scripts/lint-i18n.mjs` 加中文半角标点禁令(半角逗号、半角冒号后接汉字即报错);⑨切语言时错误文案跟随重算(展示走 computed,不存成品文案)。
- 独立审查(子 Agent)追加 8 条收尾:超时注释改成实话(库对 `checkForUpdates` 去重,挂死任务未 settle 前再点只是复用同一任务,超时只解界面阻塞、真重试要重启进程,库无取消 API);`not-available` 允许从 `error` 迁入(迟到的"其实没更新"要清掉过期的超时提示);`AppUpdateState` 新增 `fresh`,「检查确认无更新」成为状态机里看得见的状态;超时单测改走注入假时钟并断言 `clearTimeoutFn`;新增"迟到 reject 不产生 unhandledRejection"用例;删死导出 `getAutoUpdater`;删三语孤儿文案 `set.gen.updateParseFail`;`onMounted` 改成先订阅后回读。
- 审查给的两条"既有通病"**没并入本版**(设置里开关的键盘可达性是全仓 20 个开关同构问题;「＋新建片段」双加号是 0.8.0 之前就有的),另开单处理。

## 验证

- 门禁:`typecheck` 0 错、vitest **107 文件 974 通过 | 2 skip**、`lint:i18n`(主进程无硬编码中文,26 文件)、`check:contrast`(66 tokens AA)。
- **真包界面实测(mac zip 产物,7 个场景)**:检查确认无更新 → 卡片「已是最新版本 0.8.0」且只有「检查」一个按钮(1.2 s);关掉面板重开仍是这句话(修之前退回「版本未知」);再点一次检查状态不乱(308 ms);把包内 `app-update.yml` 指到不存在的路径 → 红字「找不到更新源(清单不存在)」,界面全文扫不到 HttpError/Headers/cf-ray/node_modules/堆栈,英文原文只在主进程日志(250 ms);把包内 feed 指到本地假源(9.9.9) → 「发现新版本 9.9.9」+「检查」「前往下载」两按钮(128 ms),关面板重开不丢,**状态流只有 checking→available,再等 10 s 不出现 downloading/downloaded**(mac 不自动下载守住)。
- 打包态忽略 feed 覆盖:真包带 `XSSH_UPDATE_FEED_URL=https://127.0.0.1:8499` 启动,日志打 "…IGNORED in packaged builds…" 并走默认 GitHub 源(未 setFeedURL)。
- 变异核对:拆掉 `isPackaged` 闸门、拆掉错误分类分支、拆掉超时释放 `checking` 三处,现有测试都会红(独立审查跑过)。

## 没验证 / 已知

- **Windows 真机仍然没验**:自动下载 + 退出时"库内建静默安装"这条新写法没跑过真机;打包态忽略 feed 覆盖在 Windows 上的表现同样没实测。0.8.1 是它在真实用户手上的第一次。
- 切语言时错误文案跟随重算只有静态依据(`t` 读 `lang.value`)+ 状态机单测,没做真机切语言复测。
- 匿名 GitHub Releases API 限流(60 次/小时/IP)下的反复检查未测;`update-rate-limited` 把所有 403 归为"太频繁",代理/仓库权限类 403 会被这个文案误导(已知取舍)。
- ≤0.7.x 用户包里没有 updater 代码,收不到任何提示,只能手动重装(结构性事实,本版未做迁移引导)。
- 包仍未签名、未公证;mac 侧要开自动更新仍需 Apple Developer ID(¥688/年,Team ID 定了不能换)。

---

# 会话记录:M3.219(2026-11-25,应用内检查更新接入:v0.8.0 已发)

## 做了什么(细节见 CHANGELOG [0.8.0])

- 接入 `electron-updater@^6`(6.8.11;electron-builder 仍是 26.15.3,**没升级**——Ed25519 更新清单签名是 v27 才有的强制项,升 v27 要一起搬 `mac.sign` 配置,单独立项)。`build.publish` = provider github / WyattCode / x-ssh。核心状态机新增 `src/main/updater.ts`(纯函数 + 可注入假 autoUpdater),IPC 沿用 `app:checkUpdate` 并新增 `app:updateState` 广播,设置新增「启动时自动检查更新」(默认开)。
- 平台分工是产品决定:**Windows** 检查→自动下载→下次退出时安装,因此 `win.verifyUpdateCodeSignature=false`(未签名包过不了 electron-updater 默认的 Authenticode/publisherName 校验会永远拒装;这是唯一显式降级点,产物 sha512 校验照旧,代码里没有任何“跳过校验”开关)。**macOS 只提示 + 打开发布页,绝不自动替换**(Squirrel.Mac 要求更新包与运行中 app 同 Team ID 签名,我们是 ad-hoc)。
- `XSSH_UPDATE_FEED_URL` 只接受合法 https,生效时打醒目日志,且不可能借此关掉任何校验。CI 两个 release job 的上传列表追加 `latest.yml` / `latest-mac.yml`(feed 入口,缺了客户端一律 404),**不需要新增 secret**(上传用现成的 `GITHUB_TOKEN`)。

## 验证

- 门禁:`typecheck` 0 错、vitest **107 文件 963 通过 | 2 skip**、`lint:i18n`(主进程无硬编码中文,26 文件)、`check:contrast`(66 tokens)。
- 真包实测(mac zip + 本地 HTTPS 假 feed,feed 里 version=9.9.9):renderer 侧状态流 `checking → available(9.9.9)`,**没有** `downloading`/`downloaded`(mac 不许自动下载这条守住)。默认 GitHub 源经真 TLS 打到 github.com(线上 v0.7.1 release 里还没有 `latest-mac.yml` → HTTP 404 → 走 error 态,app 不崩)。
- electron-builder 26.15.3 在 `--publish never` 下确实生成 `latest-mac.yml`(version / sha512 / size 齐全),这条是打包实跑确认,不是文档推断。
- 过程中修掉一个**单测全绿但真包启动即挂**的 bug:`(await import('electron-updater')).autoUpdater` 在打包后拿到 CJS 命名空间,顶层没有 `autoUpdater` → `au` 为 undefined → `au.setFeedURL` 抛错且被 catch 吞成一行日志。改成 `mod.autoUpdater ?? mod.default?.autoUpdater` 并在拿不到时抛可读英文错;新增 6 条“模块形状”测试(顶层形状 / default-only / 两者皆无)。

## 没验证 / 已知

- **Windows 真机没验**:自动下载与 `quitAndInstall`(和设置持久化的 before-quit 顺序有交互)只过单测,要在真 Windows 上跑一次才算。
- **更新链路对外真正生效要等下一次 tag**:CI 从 v0.8.0 起才上传 `latest*.yml`;而且 **已装 0.7.x 及更早的用户不会收到任何提示**(他们的包里没有 updater 代码),只能靠发版说明引导手动重装一次。
- 匿名访问 GitHub Releases API 有限流(60 次/小时/IP),启动自动检查 + 手动多次检查是否会被限流,未测。
- 本地假 feed 那轮用了自签证书 + `--ignore-certificate-errors`(Chromium 不认自签),公网真证书链路只在“默认源打到 github.com”那轮间接覆盖。
- 包仍未签名、未公证。mac 侧要开自动更新必须先有 Apple Developer ID(¥688/年,Team ID 定了不能换)。

---

# 会话记录:M3.218(2026-11-24,红绿灯标定重测,100% 档一起压到顶栏正中:v0.7.1 已发)

## 做了什么(细节见 CHANGELOG [0.7.1])

- `src/main/macLights.ts`:删掉"缩放 = 1.0 时传 `null` 交回系统默认"这条特例(系统默认是给 28pt 标题栏调的,灯心 13.5 pt,而 100% 档顶栏中线在 19.25 pt,调档时肉眼可见跳一下)。全档走同一公式。
- 标定常量按 3840×2160(dpr 2.0)屏逐像素重测:灯心 = 推的 y + 7.25 pt(按钮框高约 14.5 pt,旧常量把灯按 22 pt 高算),可见色带中线 = 20 × 缩放 − 0.75 pt ⇒ **推的 y = 20 × 缩放 − 8.0**(旧的是 20 × 缩放 − 5.75,且 120 % 档另有 +1.25 特例,一并删)。
- 测试(`macLights.test.ts`)改成 100% 档断言有明确 y、且与相邻档共斜率;斜率测试扩到 1.5 / 2.5。

## 验证

- 门禁:`npm run typecheck` 0 错、vitest **106 文件 936 通过 | 2 skip**、`lint:i18n`、`check:contrast`(66 tokens)。
- **真实像素逐档核验**(这次补上了 M3.215 留的坑):50/100/120/150/200/240/250 % 各档截整屏、扫红/绿/底色带与顶栏色带。灯心与顶栏中线偏差 +0.25…+1.00 pt(≤2 设备像素,修前 −5.75…+2.75);灯心 x 七档全等(693.5 px);相邻档纵向位移正好 40 px / 每 1.0 倍率(= 20 pt,严格线性)。50% 档灯到第一个标签控件还留 8 pt。
- 测量自校验:每档要求"量到的色带高度 = 80 px × 倍率"才认这一帧 —— 截图链路会把合成帧冻住(页面 `devicePixelRatio` 跟着缩放变,截屏还是老那一帧),不合格的重启 app 再测。

## 没验证 / 已知

- 110 % / 130 % 等档没单独量,按线性外推(斜率在三段区间实测一致)。
- 常量仍是这台 4K 屏 + 当前 macOS / Electron 33.4.11 的测量值,大版本升级要重测。
- 屏被锁或合成帧冻结时这套截屏验证会得出假数据,判据与恢复办法已记在 skill `electron-mac-release-pipeline`。
- 包未签名、未公证(同 0.7.0)。

---

# 会话记录:M3.217(2026-11-23,macOS 出包链路 + 顶栏红绿灯跟随缩放:v0.7.0 已发)

## 做了什么(细节见 CHANGELOG [0.7.0])

- macOS(Apple Silicon)出包:`scripts/build-mac.mjs` **实跑一次** `xcrun actool --version` 判断能不能出 `.icon`(Liquid Glass),跑不通才回落 `.icns`;`scripts/make-mac-icon.mjs`(`npm run icon:mac`)从 `build/icon.svg` 拼 `.iconset` 出 `.icns`,仓库不留临时文件。CI 新增 `release-mac`,`needs: release`,附 `SHA256SUMS-macos.txt`;`CSC_IDENTITY_AUTO_DISCOVERY=false`,包未签名。
- 顶栏红绿灯:撤掉 `207dce5` 的 `zoom: 1/--zf` 反向缩放,改成主进程按缩放档调 `setWindowButtonPosition`(新 `src/main/macLights.ts` + 纯函数测试);进出全屏后重推;`XSSH_MAC_LIGHTS=1` 打 set/readback 日志。
- 给灯留的边距改成按屏幕点保底:`styles/global.css` 的 `max(78px, 70px / --zf)`(专注模式生效的是这条,权重高于 `TabBar.vue` 内那条)、`HostRail.vue` 的 `max(82px, 70px / --zf)`;`--zf` 由 `AppSidebar.vue` / `TabBar.vue` 设在各自根元素上。
- `workflow_dispatch` 也跑 release/release-mac(打 tag 前可先验通链路);README 写明校验文件是两行(dmg+zip)。

## 验证

- CI run `45166359039` 四个 job 全绿(`test-build` / `rust-core` / `release` / 首次 `release-mac`);mac job 日志有 `[build-mac] icon: build/icon.icon (Liquid Glass via actool)` —— macos-26 runner 上 `actool` 可用,而**本机 `actool` 退 134**(从没跑过 `xcodebuild -runFirstLaunch`),本机走 `.icns` 回落,两条路都见过。
- 灯位(Electron 33.4.11,dpr 2.0):10% 阶梯逐档 `setWindowButtonPosition` 与 `getWindowButtonPosition` 读回一致(1.2 → y18.25/18,2.0 → y34.25/34,1.0 → null 交回系统默认)。`getWindowButtonPosition` 存在(d.ts 2641),读回按整 pt 取整。
- 顶栏与边距(CDP 实测):各档 `.tabbar` `zoom:1`(反向缩放确认已撤);专注模式左边距 120/200/50 % = 78/78/140 CSS px(= 93.6/156/70 pt),灯占 x 13.0…64.6 pt,最低倍率也不压到控件。
- 界面走查 7 屏(默认 / 200 % / 50 % / 命令面板 / 设置 / 新建主机 / 专注模式 50 %):无错位、无裁切、无叠字。
- 门禁:`npm run typecheck` 0 错、vitest **106 文件 934 通过 | 2 skip**、`lint:i18n`、`check:contrast`(66 tokens)。两个独立审查 Agent:逻辑与安全通过;提的 3 处注释/文档矛盾(`composables/zoom.ts`、CHANGELOG 旧条、`global.css` 阈值算错)与 `setMacLights` 空吞异常都已修。

## 没验证 / 已知

- **红绿灯的真实像素位置没人亲眼看过**:本机 `screencapture` 只出壁纸(录屏权限没授给跑 Agent 的 python),CDP 截图不含系统控件。要看真实效果得开 `release/mac-arm64/X-SSH.app`。默认 120 % 档灯比系统默认位低约 5.2 pt,是方案本身的取舍。
- 包未签名、未公证(没有 Developer ID);`codesign -dv` 报 `Identifier=Electron`(继承 Electron 的 ad-hoc 签名),以后上自动更新必须换正式签名。
- `macLights.ts` 里的常量(13.0 / 18.8 / 5.75 pt)是像素测量值,macOS 或 Electron 大版本变了要重测;该 API 无 getter 之外的方式确认 OS 最终画在哪。
- 托盘图标在明/暗菜单栏下的着色、⌘W 在有标签页时关标签还是关窗口:未验。

---

# 会话记录:M3.216(2026-11-23,错误提示不再露出内部错误码 + 主机栏同系统图标压暗:v0.6.57 已发)

## 做了什么(细节见 CHANGELOG [0.6.57])

- `lib/mainError.ts`:新增 `mainErrorOr(err, fallbackKey, t)`(= `mainErrorText` 或调用方自己的默认文案,空字符串也退回默认);`TextEditor.vue` 打开 / 保存失败改走 `sftpErrorText`(原来直接打印 `r.error`,`raw-error:` 前缀都露出来);`ForwardDialog` / `ForwardsPage` / `HistorySearch` / `CommandPalette` / `SettingsDialog` 里同样的 `r.error ?? t(…)` 都换成 `mainErrorOr`(+ 测试)。
- `DirDiffDialog.vue`:失败分支里三次连续给 `err.value` 赋值、最后一次把转好的文案盖掉,改成只算一次(`diffErr` 先认 `sync-list-failed`,其余走 `sftpErrorText`);catch 里用 `ipcReason(e)`。`SessionReplayDialog.vue`:`path-invalid` 那行是没有赋值的孤立表达式,改成链式三元。
- `PublishKeyDialog.vue`:失败行的错误原来渲染三遍(`hostOpError` / `pubErr` / `mapError` 是同一个函数的别名),改成一遍;没有密钥时下拉框显示禁用的「还没有密钥」(`keyPub.noKeys`)。
- `HostRail.vue`:`quietGroups`(按 `allGroups` 判断:组内至少 2 台、系统 id 已知且全相同)给 `OsIcon` 加 `quiet` 类,`filter: saturate(.35) brightness(.85)` + `opacity .8`;悬停和当前打开的那一行恢复原色。`StartScreen.vue`:提示里的「Shift」换成 `start.splitKey`(Shift+点击 / Shift+click / Shift+點擊)。

## 验证

- 真实窗口(CDP):编辑器打开 `nginx.conf`(测试用假 SFTP 不支持读)→ 显示「Operation unsupported」,不带前缀;发布公钥对话框的空下拉框;主机栏压暗和悬停恢复,深色和浅色主题都看了;另走查了启动页、命令面板、主机栏筛选 / 多选、终端查找和右键菜单、分屏、文件页菜单、权限 / 删除确认、转发 / 发布公钥 / 回放对话框。
- 类型检查、i18n lint 通过;测试 932 通过,另 2 个是 `localAccess.test.ts` 的软链接 EPERM(原有)。

## 没验证 / 已知

- 没用真实数据看压暗效果(测试配置里的系统图标是手动设的);系统不同的分组图标不变。
- 错误提示框(右上角、距顶 52px)会盖住文本编辑器右上角的「保存」「关闭」几秒钟;要改得挪提示框,影响所有界面,没动。
- 50% / 60% 缩放下的标题栏细线、多显示器不同缩放比例、NVIDIA 绿和 CentOS 等图标的品牌色在真实数据下的样子。
- 发版顺序:先合并远程、推 `main`,最后才打标签(0.6.56 是先打标签后发现落后,标签后来强制挪过)。

---

# 会话记录:M3.215(2026-11-23,标签页键盘操作 + 全界面二次审查的小修:v0.6.56 已发)

## 做了什么(细节见 CHANGELOG [0.6.56])

- `TabBar.vue`:`role="tablist"` / `aria-selected`;标签栏是一个 Tab 停靠点(`stopId`:当前标签,被过滤隐藏时是第一个),左右 / Home / End 切换并把焦点留在标签栏,Enter / 空格调 `store.focusTerminal()` 交还终端;点击标签也调一次 `focusTerminal()`。
- `TerminalView.vue`:`focusInTabStrip()`(焦点在 `[role=tablist]` 里时,切换标签带来的 `visible` / `focused` / 挂载聚焦不抢焦点);`termFocusTick` 的监听改成渲染后再判断 `focused && visible`(点击别的标签时,这个窗格要等本次渲染才知道自己是当前窗格)。
- `StartScreen.vue`:输入框 `role="combobox"` + `aria-activedescendant`,建议列表项有 id。
- `lib/tooltipText.ts`:`splitTip` 只认「修饰键 + 键」(`Ctrl+K`、`⌘⇧P`),不再把括号里恰好含 Alt / Shift 字样的说明当快捷键(+ 测试)。
- `HostEditor.vue`:换主机时 `sections.jump` 也复位;删掉没用的 `onConnectSummary` / `appearanceSummary`;「命令延迟」输入框回到标签列,单位另成 `host.onConnectDelayUnit`。
- `TooltipLayer.vue`:主机行提示的位置越过 `aside` 的右边线;`LockScreen.vue`:新 `lock.prompt`;`SftpDrawer.vue`:路径栏靠左(`.crumb.last { margin-right: auto }`)、窄栏下标题对齐第一行工具;`SettingsDialog.vue`:`.r-desc` 加 `text-wrap: pretty` + `overflow-wrap: anywhere`。
- `i18n.ts`:17 处汉字之间的半角标点改全角;`sck.palette2` 加「(备用)」;`lock.setHint` 重写;英文的 `host.hostPh` / `host.passwordAsk` / `tmux.newPh` 缩短。

## 验证

- 真实窗口(CDP):Tab 键进入标签栏 → 左右 / Home / End 切换且焦点留在标签上(连着终端的标签也是)→ Enter 后焦点到 xterm;点击标签后焦点在终端;启动页组合框属性;主机行提示的左边在侧栏边线右侧 6 像素。走查了启动页、命令面板、主机编辑四个标签、设置五个标签、文件页、转发页、锁定页、tmux / 历史 / 传输面板、浅色主题、723 像素宽窗口、英文 / 繁体。
- 类型检查、i18n lint 通过;测试 931 通过,另 2 个是 `localAccess.test.ts` 的软链接 EPERM(原有)。`quietExec.test.ts` 全量跑时失败过一次,单独跑和再跑全量都过,像是偶发。

## 没验证 / 已知

- 在终端里按 Tab 是发给 shell 的,键盘用户进了终端就没法 Tab 回标签栏(终端的固有限制)。
- 50% / 60% 缩放下的标题栏细线、多显示器不同缩放比例;NVIDIA 绿、CentOS 等图标的品牌色;canvas 量不准 CJK 占位符宽度,简体 / 繁体主机地址输入框的占位符在窄窗口下是否截断,靠肉眼看着是够的。

---

# 会话记录:M3.214(2026-11-23,主机栏品牌色 + 工具图标圆角高亮 + 统一提示框:v0.6.55 已发)

## 做了什么(细节见 CHANGELOG [0.6.55])

- `HostRail.vue`:去掉 0.6.50 加的 `.rail-os :deep(.os-tile)` 中性色覆盖(品牌色回到 `OsIcon` 自己的逻辑),只留圆角 6 和 `svg` 68%;`setRowTip()`(`@pointerenter`,先于 `TooltipLayer` 的 `mouseover` 执行)按行里地址 / 名字是否被截断(`scrollWidth > clientWidth`)设置 `row.title`;`.rail-more` 有自己的 `title`。
- `TabBar.vue`:`.tool::before`(inset 6px、圆角)承担悬停 / 选中底色;焦点框 `outline-offset: -6px; border-radius: 12px`。
- `TooltipLayer.vue`(早就存在的统一提示层,不是系统提示):`.rail-host` 内的提示贴在行右边;`splitTip()`(新 `lib/tooltipText.ts` + 测试)把括号里的快捷键拆成 `<kbd>`;**修了嵌套 title 的 Bug**:`onOver` 里目标在已悬停元素内部、且找到的带 title 祖先包含该元素时,视为仍在悬停,不切换。
- i18n:`rail.hint` 改为「并排打开 (Shift+点击)」(三语种)。

## 验证

- 真实鼠标移动(`mv.cjs` + CDP `mouseMoved`):行 → 「…」→ 行 → 右上角工具;长地址行(测试配置里手加的 `gpu-cluster-17`)显示完整地址。浅色主题:主机行提示、布局图标高亮、「+」的提示。类型检查、构建通过;测试 929 通过,另 2 个是 `localAccess.test.ts` 的软链接 EPERM(原有)。

## 没验证 / 已知

- 英文 / 繁体下的提示文案、右上角文件图标的悬停、提示框在窗口右边缘附近的位置;`splitTip` 靠关键词判断括号里是不是快捷键。
- 品牌色:测试环境只有 Ubuntu 橙和通用图标,NVIDIA 绿、CentOS 等没亲眼核对。

---

# 会话记录:M3.213(2026-11-22,细线按屏幕缩放算 + 启动页窄栏:v0.6.54 已发)

## 做了什么(细节见 CHANGELOG [0.6.54])

- `src/main/index.ts` `windowOverlay()`:高度 = `Math.max(8, Math.floor((39 * overlayFactor * scale - 1) / scale))`,`scale` 取窗口所在显示器的 `scaleFactor`(没有窗口时取主屏)。0.6.53 只用了 `Math.floor(39 * factor)`,在 180% / 200% 仍盖住细线第一行。**实测方法**:`shotwin.ps1` 截真窗口,逐档设置缩放(`window.api.zoom.set(Math.log(p/100)/Math.log(1.2))`),比较页面区域和窗口右端(按钮下面)的细线行;`par.cjs` 逐行比较按钮下面和页面的颜色(浅色主题)。
- `StartScreen.vue`:`.col` 加 `container-type: inline-size`;`@container (max-width: 440px)` 里名字列改回自适应宽度。

## 验证

- 70% ~ 250% 细线一致(深色);浅色 80 / 120 / 150 / 200 逐行颜色一致;窄栏 300 ~ 520 宽度量过名字、地址宽度。类型检查、构建通过;测试 926 通过,另 2 个是 `localAccess.test.ts` 的软链接 EPERM(原有)。

## 没验证 / 已知

- 50% / 60% 缩放下按钮下面没有细线(Windows 按钮条最小高度);多显示器不同缩放没拖动实测。
- 主机行的原生悬停提示盖住下面一台(原有,未处理);设置、端口转发、命令面板、文件面板这轮没重新走查。

---

# 会话记录:M3.212(2026-11-22,细线通栏 + 启动页对齐 + 主机栏图标放大:v0.6.53 已发)

## 做了什么(细节见 CHANGELOG [0.6.53])

- `src/main/index.ts` `windowOverlay()`:高度 `Math.round(39 * overlayFactor)` → `Math.floor(...)`。实测(`PrintWindow` 截真窗口、量像素亮度):120% 缩放、系统缩放 1.5 时,细线占物理像素第 70、71 两行,覆盖条原来盖到第 70 行,按钮下面只剩一行;改后两行都在。其它缩放档只靠推导(覆盖条不再超过 39 × 缩放),没逐档量。
- `StartScreen.vue`:`.list` 用 `margin: 0 -10px` 抵消行的内边距,h2 / `.keys` / `.none` 去掉 10px 缩进;`.item b` 固定 190px 宽。
- `HostRail.vue`:`OsIcon` 26 → 28,`.rail-os :deep(.os-tile svg)` 宽高 68%。

## 验证

- 真窗口前后对比截图(启动页、主机栏、细线放大 4 倍);测试配置里手改 `hosts.json` 的 `lastUsedAt` 凑出 4 行最近使用。类型检查、构建通过;测试 926 通过,另 2 个是 `localAccess.test.ts` 的软链接 EPERM(原有)。

## 没验证 / 已知

- 浅色主题下按钮下面那一小条的颜色是否和页面一致(`windowOverlay` 的浅色底是 `#eef0f3`);其它缩放档的细线;英文 / 繁体下的启动页。
- 主机行的悬停提示会盖住下面一台(原有);「未分组」比英文分组标题大一号(未处理)。

---

# 会话记录:M3.211(2026-11-22,启动页匹配列表 + 最近使用只列用过的:v0.6.52 已发)

## 做了什么(细节见 CHANGELOG [0.6.52])

- `StartScreen.vue`:`suggestions`(按 完全相同 / 名字开头 / 名字包含 / 地址包含 排序,最多 5 台,末尾加 `{ kind: 'new' }`);`parseTarget` 把不带点的裸词当搜索词返回 null,这里对 `^[a-zA-Z0-9][a-zA-Z0-9_-]*$` 的裸词补一个 `root@词` 的新地址项;`onKey`(上下、回车、Esc);`activate(undefined)` 时把输入交给 `paletteSeed`。`recent` 先过滤 `lastUsedAt`。
- i18n:`start.asNew` / `start.newConn`;英文 `start.palette` 改成 Palette(三条提示要放进 520px 的一行)。

## 验证

- 实际操作过:多台匹配、无匹配只剩新地址、已保存主机的完整地址(不重复出新地址项)、带空格无匹配(进命令面板并带字)、上下键、Esc、回车直连、鼠标点第二行。全新配置加一台没连过的主机:不显示「最近使用」。英文 / 繁体新文案、英文提示行高度量过。
- 类型检查、构建通过;测试 926 通过,另 2 个是 `localAccess.test.ts` 的软链接 EPERM(原有)。

## 没验证 / 已知

- 主机名特别长时,那一行的地址会被挤掉。匹配列表没有 `aria-activedescendant`。

---

# 会话记录:M3.210(2026-11-22,启动页紧凑版:v0.6.51 已发)

## 做了什么(细节见 CHANGELOG [0.6.51])

- `StartScreen.vue`:模板和样式整体重写(单行 `.item` 列表,取最近 4 台;`.go` 细线框;`.col` 垂直居中);`onEnter` 里不含 `@` 的输入先按主机名匹配(完全同名或唯一包含 → 直接连;多台 → `paletteSeed` + 打开命令面板)。去掉了 `reachOf` 和 `OsIcon`。
- `HostRail.vue`:图标 24 → 26,颜色从 `--text-dim` 调到接近 `--text`。
- i18n:新增 `start.ph`;英文 `start.rail` / `start.split` 改短。

## 验证

- 截图看过:有主机、空配置(全新 user-data-dir)、英文 + 浅色、主机栏收起。实际操作过:输入唯一匹配的主机名回车直连、输入多台匹配的字打开命令面板。
- 类型检查、构建通过;测试 926 通过,另 2 个是 `localAccess.test.ts` 的软链接 EPERM(原有)。

## 没验证 / 已知

- 英文快捷键文案改短后没再截图;窄窗口没看。
- 不含 `@` 的输入只要唯一包含于某台主机名就直接连,可能把想新建的裸主机名连到已保存的主机上。
- 「最近使用」不足 4 台用过的主机时会用没连过的凑数(原有)。

---

# 会话记录:M3.209(2026-11-22,主机栏紧凑两行 + 主机弹窗第二轮:v0.6.50 已发)

## 做了什么(细节见 CHANGELOG [0.6.50])

- `HostRail.vue`(只加了文件末尾一段样式 + 图标尺寸 28 → 24):`.rail-label` 亮色;`.rail-os :deep(.os-tile)` 统一成中性底、灰色图形;`.dot.online` 不显示、`.dot.offline` 空心圈;搜索框细线框;锁图标颜色;列表底部 mask 渐隐。`stateOf()` 逻辑没动。
- `HostEditor.vue`:面板 600×430;`.row >` 的输入控件 `max-width: 300px`;终端分类改成普通行(`row stack` 是标签在上、输入在下);`goToMissing()`;`.sub` 无底色;`.sub .box-select select` 去掉内层框。**遗留**:`onConnectSummary` / `appearanceSummary` 和 `sections.onConnect` / `sections.appearance` 模板已不用,没删。
- i18n:`rail.filter` 改为「搜索」;英文 `host.termTheme` / `host.termFont` 改短(标签列 84px 放不下)。

## 验证

- 主机弹窗:四个分类、网络全部展开、密钥认证、英文 + 浅色主题截图看过;脚本检查过英文和繁体下没有折行的标签。主机栏:多选、解锁拖动、底部渐隐、空心圈截图看过。
- 类型检查、构建通过;测试 926 通过,另 2 个是 `localAccess.test.ts` 的软链接 EPERM(原有)。

## 没验证 / 已知

- 用户那边「DGX SPARK」分组标题是大写,是分组名本身存成了大写,不是样式。
- 主机行的悬停提示会盖住下面一台(原有)。大多数主机连不通时空心圈会很多。
- 启动页、左右并排没走查。

---

# 会话记录:M3.208(2026-11-22,标签栏焦点框 / 搜索框 / 菜单 Esc:v0.6.49 已发)

## 做了什么(细节见 CHANGELOG [0.6.49])

- `TabBar.vue`:`.tool` / `.rail-toggle` 的 `:focus-visible` 改成向内画(全局的按钮焦点框在盒子外 2px,而这两种格子和标签栏同高,上下边被裁掉);搜索框样式和计数;`onMenuEsc`(window 捕获阶段)关闭布局菜单和标签右键菜单并 `stopPropagation`。

## 验证

- 布局菜单 Esc、键盘焦点落在工具图标上、点布局图标再按 Esc 的路径,截图 / DOM 看过。脚本检查过主界面每一类可聚焦控件的焦点框是否被容器裁掉。
- 类型检查、构建通过;测试 926 通过,另 2 个是 `localAccess.test.ts` 的软链接 EPERM(原有)。

## 没验证 / 已知

- 标签右键菜单的 Esc 只改了代码(脚本没能弹出菜单);弹窗内控件的焦点框没排查;浅色主题和英文下没看。
- 标签本身 `tabindex=-1`,Tab 键到不了;主机栏展开 + 搜索框打开 + 窄窗口时标签条只剩一个半标签。

---

# 会话记录:M3.207(2026-11-22,主机弹窗分栏 + 命令面板紧凑单行 + 全屏程序下的闪跳:v0.6.48 已发)

## 做了什么(细节见 CHANGELOG [0.6.48])

- `HostEditor.vue`:左侧分类 `tab`(conn / org / net / term),右侧各 `section` 用 `v-show`;`tabMarked()` 画小绿点;输入控件统一成透明 + 细线框;`bodyRo`(ResizeObserver 观察正文的各个分类)负责重算「更多设置」按钮(只靠 `onUpdated` 时展开一行后不出现)。
- `TerminalView.vue`:`fitDeferred()` 先发新尺寸、本地暂不改,`writeWithPendingFit()` 在远端数据到达时把改尺寸和这批数据同步写入(xterm 内部的 `_core.writeSync`,有回退)再同帧重画;`DEFER_FIT_MS = 120`。只用于一次性的宽度变化和窗口尺寸稳定之后,字体 / DPR 等仍走立即的 `doFit()`。
- `CommandPalette.vue`:单行行样式;`livePane()` / `switchTo()`(已连接的主机回车切过去);`actionMode`(`>` 前缀);Ctrl+E 编辑;广播操作 `keepOpen`,打开面板时清 `broadcastOpen`。

## 验证

- 测试服务器改成收到尺寸变化后延迟 45ms 整屏重画,逐帧录屏:修之前退出专注模式有两帧折行错乱,修之后没有。
- 主机弹窗:新建、编辑、密钥认证、四个分类、英文、浅色主题截图看过。命令面板:切换到已连接主机、`>` 模式、Ctrl+E、广播输入框、英文 / 繁体文案实际操作过。
- 类型检查、构建通过;测试 926 通过,另 2 个是 `localAccess.test.ts` 的软链接 EPERM(原有)。

## 没验证 / 已知

- 真实主机(几十毫秒延迟、tmux / Claude Code)上的闪跳没看过;等重画的 120ms 里若主机正好有别的输出(tail -f、按键回显),仍可能闪一下。
- `_core.writeSync` 和 `_renderService._renderRows` 都是 xterm 私有方法:升级 xterm 后要重新逐帧录屏。
- 命令面板的 Shift+Enter 并排、密码输入子界面没实际操作;繁体下的主机分栏弹窗、启动页、左右并排没走查。
- 设置和端口转发弹窗里的输入框还是灰底,没有跟着统一。

---

# 会话记录:M3.206(2026-11-22,收起主机栏终端闪黑 + 失败提示前缀:v0.6.47 已发)

## 做了什么(细节见 CHANGELOG [0.6.47])

- `TerminalView.vue`:`paintNow()` 在 `fit.fit()` 之后和画布尺寸变化(`canvasRo`,device-pixel-content-box 的 ResizeObserver,建在 xterm 自己的之后)时同帧重画。原因:WebGL 渲染器改画布尺寸会清空画布,而它的重画排在下一帧。**调用的是 xterm 私有方法 `_core._renderService._renderRows`**(有保护,改名后不报错,只是闪黑会回来):升级 xterm 后要重新逐帧录屏确认。
- `lib/ipcError.ts`(有测试):去掉 Electron 给 invoke 失败加的包装;用在 `HostEditor.vue`、`ForwardsPage.vue`、`SftpDrawer.vue`。

## 验证

- 逐帧录屏(CDP `Page.startScreencast`):修之前收起那一下有一帧终端亮像素为 0,修之后多次收起 / 展开没有空白帧。
- 保存失败用只读的 hosts.json 真实触发过;端口转发和同步监视两处提示只改了代码,没触发。
- 类型检查、构建通过;测试 926 通过,另 2 个是 `localAccess.test.ts` 的软链接 EPERM(原有)。

## 没验证

- 拖动主机栏宽度、调整窗口大小、并排面板没有单独录屏;跑 tmux / htop 的真实主机没看过。

---

# 会话记录:M3.205(2026-11-22,主机弹窗细节 + 主机栏图标加大:v0.6.46 已发)

## 做了什么(细节见 CHANGELOG [0.6.46])

- 主机栏顶部 / 底部图标 `ink` 10.1 → 11.1(`HostRail.vue`、`AppSidebar.vue`)。
- `HostEditor.vue`:保存按钮「缺字段」时用 `.blocked` 描边样式并在旁边显示原因(只限这个状态,不是全局 `.btn-primary:disabled`,否则其它「忙碌时禁用」的主按钮会闪成描边);名称框常显下划线;标签行输入底;滚动条悬停才显示;`.more-anchor`(正文下边缘的零高度锚点)承载渐隐和「更多设置」按钮,按钮消失前把焦点还给弹窗(否则 Esc 失效)。

## 验证

- 构建通过;测试 922 通过,另 2 个是 `localAccess.test.ts` 的软链接 EPERM(原有)。
- 运行的应用里看过:空表单、填好、滚到底、压窄到 430px、英文界面;保存失败的红字条是手动插入模拟的。

## 没验证

- 繁体界面;真实的保存失败。

---

# 会话记录:M3.204(2026-11-22,界面整体重做:单一外壳 + 居中弹窗 + 主机分组排序 + 新扁平 logo + 缩放整十:v0.6.45 已发)

> 起因:用户逐轮看真实界面提出的一长串问题。每一轮都用真窗口截图 / 像素测量验证(`PrintWindow` 截应用窗口,连系统画的最小化 / 最大化 / 关闭一起量),不只看 CDP 页面截图。

## 做了什么(细节见 CHANGELOG [0.6.45])

- **单一外壳**:去掉「连接 / 终端 / 文件」多页面,只有主机栏 + 标签栏 + 状态行;设置 / 端口转发 / 编辑主机是居中弹窗(`ModalShell.vue`),文件(SFTP)是右侧并排面板,可展开。启动页 `StartScreen.vue`。
- **缩放**:`shared/zoom.ts`,只走 50…250% 的整十档,默认 120%;Windows 右上角系统按钮高度跟标签栏(39×缩放,留出最后 1px 细线);弹窗时系统按钮按各弹窗遮罩深浅变暗(`captionDim.ts`)。
- **主机分组与排序**(`shared/hostGroups.ts`,有测试):按名称「前缀 + 数字」自动成组(只是显示规则,不写数据),手动分组用 `group` + `groupLocked`,手动顺序用 `order`;批量移动走 `hosts:patch`(一次写盘);排序锁 `sortLocked`;默认排序改为名称自然序。
- **logo**:桌面首页的 `BrandLockup.vue`(矢量,原版「SSH」字形 + 扁平 X);`build/icon-src/flat/make.cjs`(应用 / 托盘图标)和 `lockup.cjs`(桌面 / Android / iOS 横向 logo 的 PNG)是生成脚本,**不要再跑旧的 `make_icons.py`**(会覆盖回旧版)。iOS `BrandMark.swift` 里写死的横向 logo 宽高比跟着改成 557/113。
- **顶栏 / 底栏**:主机栏标题行和标签栏同高 40px,底栏和状态行同高 40px(`--band-top` / `--band-bot`);图标统一大小、颜色和系统按钮一样亮,方框和线宽对齐到整数屏幕像素(`lib/iconSnap.ts`,有测试)。

## 验证

- 类型检查、i18n、对比度、构建全过;测试 922 通过,另 2 个是 `localAccess.test.ts` 的软链接 EPERM(原有,与本次无关)。
- 真窗口量过:顶栏 / 底栏高度、图标中线、图标大小和亮度、清晰度(边缘发虚像素的占比)。

## 没验证 / 已知

- Windows 右上角系统按钮下那条细线在真实窗口里是否连上、弹窗时那块变暗的实际效果:我这边的页面截图抓不到,只用窗口截图间接看过。
- Mac 顶栏(避开红绿灯的处理)和用 CSS 缩放的元素里的图标清晰度没实机看过。
- 拖放只用合成事件测过,没有真实鼠标拖过。
- 手机端只换了横向 logo 图片和 iOS 一个宽高比常量,没编译 iOS;命令面板里的分组仍只认手动设的分组,不认自动分组。
- 标签条在 210% 以上缩放且同时开主机栏和文件面板时被挤得很窄,标签名会被截断。

# 会话记录:M3.203(2026-11-20,SFTP 上传一律失败 + Windows 同步下载失败:v0.6.44 已发)

> 起因:用户截图——上传文件提示「1.png · 失败」「1 个文件失败」。
> **验证方式**:用 Git for Windows 自带的真 OpenSSH `sftp-server.exe`(外面套一层 ssh2 `Server` 转发 subsystem),在 **Electron 自带的 Node**(`ELECTRON_RUN_AS_NODE=1 electron.exe node_modules/vitest/vitest.mjs run …`)里跑 `SshManager` 的全部 SFTP 操作。普通 Node 26 和 Electron 33 的 Node 20 在流事件上行为不同,不要只用 `npx vitest`。

## 根因

- **上传全挂(自 v0.6.38,提交 657d8d7「先写临时文件再改名」)**:`pipeStream` 的 `close` 处理要求 `writable.writableFinished`,但 ssh2 的 SFTP `WriteStream._final()` 里先 `destroy()` 再 `cb()`,正常结束只发 `close`、不发 `finish`,`writableFinished` 一直是 false → 每次都抛 `transfer-closed-before-finish`,临时文件被清掉。现在以 `writableFinished || (writableEnded && !errored)` 为成功。`writableEnded` 能代表「数据全写完」,因为只有在读完并等完 drain 之后才调 `end()`,而 `_final` 要等所有 `_write` 回调(服务器确认)之后才执行。
- 之前测试全绿是因为用的是**模拟的 Writable**,它们会发 `finish`。新的 `src/main/uploadComplete.test.ts` 里 `ssh2LikeWrite` 模拟 ssh2 的真实行为。以后给 ssh2 流写测试,要模仿「`_final` 里销毁」。
- **服务器不支持 `posix-rename@openssh.com`**:ssh2 的 `ext_openssh_rename` 在扩展没被通告时**同步抛** `Error("Server does not support this extended request")`(没有 `code`),旧代码只认 `code === 8`。新增 `replaceRemote()`:抛错 / code 8 → 退回普通 rename;目标已存在则先挪成 `.xssh-old-<uuid>`,改名成功后删,失败放回。手机端 Rust 早就是这个思路(`sftp.rs` 的 backup)。
- **Windows 同步下载全挂(自 2026-09 daab5a0)**:`syncJob` 里 `this.parentOf(item.local)` 用 POSIX 函数算 Windows 路径的上一级,得 `/`,去 `mkdir C:\` → EPERM。改成 `dirname(item.local)`。

## 这次排查过、结论正常的

- 用真服务器跑了约 45 项:上传(小 / 大 / 空 / 文件夹 / 25 并发 / 中文空格名 / 覆盖 / keep)、下载(文件 / 文件夹 / 校验和 / 覆盖)、读写文本和二进制、putFileSilent、createFile、rename、chmod、删除、diffDirs、syncJob 三个方向 + deleteExtras + 嵌套、取消 / 暂停上传、取消下载。都正常。
- 手机端 Rust:`cargo test -p xssh-core --test live_ssh -- --ignored`(要设 `XSSH_TEST_HOST/PORT/USER/KEY`)对同一个服务器跑 `cancelled_upload_leaves_the_target_alone` 和 `sftp_round_trip_alongside_shell`,通过。这两个测试默认 `ignored`,CI 不跑。

## 已知 / 没动

- 下载中途取消会在目标文件夹留下 `<name>.xssh-part-<uuid>`:是 `downloadJob` 有意保留以便续传(`partialDownloads`),不是 bug;但用户不再重试就一直留着。
- 没有在用户的 DGX Spark 上实测;chmod / 保留权限只能在真 Linux 上验证(本机后端是 NTFS)。
- Android 0.2.2 的 Kotlin 带了 11-17 同批提交,但 `.so` 仍是 11-14 的旧库。

# 会话记录:M3.202(2026-11-19,界面同类问题全面清理——聚焦蓝框、中文标点、透底、等宽字体:v0.6.43 已发)

> 起因:v0.6.41 只修了命令面板一处的蓝框和英文逗号;用户随后在主机编辑页看到一模一样的问题,要求按「同类问题全软件排查」来做。
> **验证方式**:这次是把构建产物真的开起来截图看的(见下「怎么走查」),不是只跑检查。

## 根因与改法

- **蓝框**:`styles/global.css` 有一条 `input:focus-visible, textarea:focus-visible, [tabindex]:focus-visible { outline … !important }` 的兜底规则。文本输入框永远匹配 `:focus-visible`(鼠标点击也算),于是每个输入框都被强制画 2px 框,叠在各组件自己的聚焦提示上。现在这条规则**只管非文本控件**(checkbox / radio / range / color / file)和 `tabindex` 不为 `-1` 的元素;文本输入框全局 `outline: none`,**各自负责聚焦提示**。新增文本输入框时必须自带提示(有边框的变 accent 边;无边框的用下划线 / 行底色 / 容器边框)。
- 这次补了提示的:`HostEditor .p-name`(下划线)、`HistorySearch .bar:focus-within`、`TabBar .filter-box:focus-within`、`ForwardDialog .fw-in:focus`、`TmuxDialog .tm-new input:focus`、`CommandPalette .search:focus`。`TextEditor` 的编辑区没有额外提示,只有光标。
- **`tabindex="-1"` 不再描边**:那些是只由脚本聚焦的面板 / 滚动区(设置页 `.content`、各对话框),之前会给整页画一个蓝框。
- **中文标点**:`lib/i18n.ts` 的 zh / zh-TW 和 `src/main/index.ts` 里的中文字符串,紧邻汉字的 `, ; : ? ( )` 全部换成全角,共 339 行。**保留**「中文 (English)」这种括号里全是拉丁字母、前面带空格的写法。以后新增中文文案请直接用全角标点。
- **透底**:没有自带 `backdrop-filter` 模糊却用了半透明背景的面板改为不透明:命令面板(0.6.41)、`ConfirmDialog .dialog`、`HistorySearch .panel`、`TextEditor .editor`、全局 `.pm-dialog`。带 14px 以上模糊的菜单 / toast / 缩放提示是有意的毛玻璃,没动。
- **等宽字体里的中文**:等宽字体会把汉字逐个拉开。命令面板的说明文字、主机分组名、`.mono` 输入框的 placeholder 改用界面字体;只有地址和命令本身保持等宽。
- 其它:主机编辑页端口前的冒号改成「端口」标签;颜色去掉两个近似色(`#4dabf7`、`#fab005`),换成 `#a9744f`、`#94a3b8`,旧颜色的主机通过 `swatches` 计算属性多显示一个色块保持可选中;设置页切换分页时滚动回顶;tmux / 广播框标题去掉菜单项带来的「…」;命令面板 Enter 提示按选中项显示「连接 / 执行」。

## 怎么走查(下次照做)

- 构建后用独立数据目录起一个实例,避开单实例锁和用户真实数据:`node_modules/electron/dist/electron.exe . --remote-debugging-port=9333 --user-data-dir=<临时目录>`,再通过 CDP(`Page.captureScreenshot` / `Runtime.evaluate` / `Input.*`)驱动和截图。
- 要看「连上才有」的界面,用 `ssh2` 的 `Server` 在 127.0.0.1 起一个假服务器(接受任意密码,给一个回显 shell 和一个只读 SFTP 列表),再用 `window.api.hosts.save(...)` 塞几台演示主机。
- 结束后只杀这个 electron.exe 和假服务器的 node 进程。

## 没做 / 已知

- **Android 的 `strings.xml` 有同样的半角标点**(zh、zh-Hant 各约 50 行),没改——改了要重新出 Android 包,等用户决定。
- 没逐个截图看的:权限对话框、目录对比、公钥发布、会话回放、锁屏、文本编辑器。
- SFTP 页头部的主机地址不显示端口(连非 22 端口也只显示 `user@host`),这次没动。

# 会话记录:M3.201(2026-11-20,终端网址链接不再吞中文;iOS 审查收尾:v0.6.42 已发)

> 起因:用户截图指出 `http://192.168.10.213:8888/v1。使用现有密钥…` 整句中文都带着下划线。
> **真机没验过**:只在 Node 里拿样例过了正则、类型检查通过、CI 绿;没有在装好的应用里点过链接。

- 根因:`TerminalView.vue` 里 `WebLinksAddon` 用的是 xterm 默认网址正则,一直匹配到下一个空白;中文句子没有空格,整句被当成链接(悬停高亮、点击还会打开带中文的网址)。
- 修法(#43):给插件传自己的 `urlRegex`:**保留默认正则排除的所有字符,只多排除非 ASCII(`\u0080-\uffff`)**。第一版只写了 ASCII 白名单,把引号和尖括号放进了链接中间,`["http://a","http://b"]` 会连成一个链接、HTML 的 `href="…">` 会把标记吞进去,二次审查才查出来;别再把允许范围放宽。
- 取舍:路径里带未编码中文的网址(`http://h/中文`)只会链到 `http://h/`。要点开完整地址得是已编码形式。
- 合并时遇到:Windows 那边同时在发版(0.6.40、0.6.41),分支落后于 main,`gh pr update-branch` 后要重跑 CI 才能合;这个仓库没开自动合并,`--auto` 会报错。
- iOS 一侧同期合并了 #42(不涉及版本号、没打 tag):换主机后键盘失灵、会话结束卡死、对方突然断线不提示、主机页「搜索 / 新建」靠右下角。TestFlight 第 2 个构建(版本仍 0.1.0)已在用户明确要求下上传。**注意**:`mobile/HANDOVER.md` 审查 ⑦ 写的「直板机终端控制条靠右」已被用户否掉,现在是居中,以代码为准。

# 会话记录:M3.200(2026-11-19,连接弹窗(命令面板)外观整理:v0.6.41 已发)

> 起因:用户截图指出连接弹窗的问题——搜索框一圈蓝色描边被圆角裁切、弹窗半透明透出背后内容、看不出哪台已连。
> **真机没验过**:只有类型检查 + i18n 检查 + 对比度检查 + 构建;没人在装好的应用里看过效果。

- 改动都在 `src/renderer/src/components/CommandPalette.vue` 和 `lib/i18n.ts`(新增 `pal.hostsRecent` / `pal.connected` / `pal.newHostShort`)。
- 搜索框:用 `.palette .search:focus-visible { outline: none !important }` 压过 `global.css` 的全局聚焦描边(那条是 `!important` 的兜底规则,必须靠更高优先级 + `!important` 才盖得住),聚焦改为下边线变 accent。密码框、广播框共用 `.search`,一起变。
- 弹窗背景由 90% 透明混色改为不透明 `--bg-elev`。
- 「已连接」标记:只认 `status === 'connected'` 且带 `hostId` 的 pane;连接中的、直接输地址连的不标。回车仍然是再开一个连接,没改成跳到已有标签。
- 端口 22 不显示;搜索本来就不匹配端口(`paletteHostScore`),所以不影响搜索。
- 底部「新建主机」按钮:`onKey` 里 Enter 落在 `.hint-new` 上时直接放行,否则会去连高亮的主机。列表行自己(也是 button)用 Tab 聚焦后按 Enter 仍是激活高亮行而非聚焦行,这是原有行为,没动。
- 已知没处理:列表最后一行被滚动区域切一半;底部提示的「Enter 连接」对命令片段/操作行措辞不准。

# 会话记录:M3.199(2026-11-19,终端「选中即复制」与远端剪贴板:v0.6.39、v0.6.40 已发)

> 起因:用户在 Codex / tmux 里右键被提示「程序占用了鼠标」,选完还得再点复制;随后又报「Codex 里选中没复制上」。
> **真机没验过**:这一节的行为都只有单测 + 类型检查 + 构建产物核对,没人在装好的应用里点过;macOS 一侧完全没跑过。

## 一、v0.6.39(`d82aac5` + `c55d6f8`,已推 main、已打 tag)

- **选中即复制,永远开着,两端一致**。`lib/releaseCopy.ts`:终端上按下鼠标 → 这次手势里选区**变过** → 松开时写一次剪贴板。
  「变过」靠 `term.onSelectionChange`(清空和新选区都会触发;双击选词是在 mousedown 里就选好的,所以 `down()` 挂在捕获阶段、抢在 xterm 之前)。
  只点一下、没产生新选区 → 不写。**走过的弯路**:第一版是「按住 Shift 才复制」,第二版拿选区位置做前后比对(双击会被判成没变),都已删掉。
- 设置里的「选中即复制」开关、`store.copyOnSelect`、`settingsKeys` 里的键、三语文案一并删除;`settings.json` 里的旧值不再读,留着无害。
- 右键菜单「全选」之后直接复制(它没有鼠标松开这一步)。
- macOS 开了 `macOptionClickForcesSelection`:程序占用鼠标时 Windows 用 Shift 拖选、**Mac 用 Option**(此前 Mac 上这种情况选不了字)。提示文案按平台取 `term.shiftSelectHint` / `term.optionSelectHint`。
  **代价**:xterm 的「Option+点击移动光标」在 Mac 上大概率失效(两个选项互斥),没验证。
- CI:标签 `v0.6.39` 的 run #201 绿;**同一个提交在 `main` 上的 run #200 红**,日志要登录才看得到,原因未知(疑似不稳定用例)。

## 二、v0.6.40(0.6.39 之后的改动)

- **`allowRemoteClipboard` 默认开**(`sessions.ts`:初值 `true`,读取 `!== false`)。原因:Codex 的选区是它自己画的,复制走 OSC 52;
  0.6.38 默认关掉之后它照样提示「Copy sent to terminal」,本机剪贴板却是空的,用户无从得知。
- **闸门从「每秒一次」换成「程序占着终端 + 用户刚操作过才放行」**(`lib/osc52.ts`,`OSC52_USER_WINDOW_MS = 10_000`):
  只认该终端上的真实 `keydown` / 鼠标按下 / 从该终端开始的鼠标松开 / 终端右键菜单的选择,而且**操作那一刻**终端必须已在备用屏或鼠标跟踪模式(`programOwnsTerminal`)。
  **第一版只有时间窗(5 秒),是错的**:在提示符下对 `cat 文件` / 嵌套 `ssh` 按回车本身就是一次按键,恶意输出紧跟着到,照样放行 —— 二次审查才抓到。
  模式在按键时取样而不是写入时,所以输出里自己切备用屏不能给自己开窗。
  **不要改成 `term.onData`** —— 终端对远端查询的自动应答也走 onData,远端可以自己给自己开窗。
  已知限制:提示符下脚本直接打印 OSC 52 不再生效;占着终端的程序内部(分页器看恶意文件)按键仍放行;片段面板 / 命令面板触发的动作不算用户操作。
  大小上限(base64 ≤

... [OUTPUT TRUNCATED - 201,391 chars omitted out of 251,316 total] ...

alog、ForwardDialog、PublishKeyDialog、SessionReplayDialog、FileDiff、DirDiffDialog。**注**:`PermDialog/FileDiff/DirDiffDialog` 由父级 `v-if` 挂载、无 `open` prop,故传 `() => true`。
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