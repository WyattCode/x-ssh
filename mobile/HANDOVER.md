# X-SSH 移动端交接文档

> 更新: 2026-09-21 凌晨(第五次)。项目: `mobile/`(Android + iOS 双原生 UI + 共享 Rust 核心)。
> 设备: Xiaomi 18 Fold(型号 2608BPX34C),已装 demo App。

## 0. 一句话状态

**真机 SSH 全链路已经跑通**(私钥认证 → PTY → 终端渲染 → 键盘输入 → 远端回显),
走的是 `adb reverse` 的回环隧道 —— App UID 的**回环不受限**,所以 MIUI 那道封锁
不再挡开发。MIUI 仍然禁着 App 直连局域网/公网(WLAN 页签开关还没打开),那是
**发布前要解决的问题,不是每天开发的前置条件**。

第三次会话新查明: Android 16+ 的本地网络保护要求单独的 `ACCESS_LOCAL_NETWORK`
运行时权限,manifest 里原本没有 —— 就算 MIUI 放行,连 `192.168.x.x` 仍会超时,
且表现和现在一模一样(超时),极易误判。已补上声明与申请。

**第五次会话: 整套 UI 按平板/折叠屏重做。** 三种形态各自有布局(外屏 425dp 单列 +
拇指区悬浮按钮 / 内屏竖 608dp 双列网格 / 内屏横 860dp 列表+详情双栏),分栏的分界线
用 `androidx.window` 的真实铰链坐标,实测压在折痕上(x=1182px,误差 0 像素);半折时
进桌面模式(终端在折痕上方,按键与输入法在下方)。触摸目标一律 ≥48dp,方向键长按连发。
**注意: 功能移植远未完成**,桌面端的 SFTP/端口转发/多标签/分屏等核心能力
(`xssh-core` 只有 `ssh.rs` + `terminal.rs`)都还没有;这次做的是已有三个界面的交互。

**第四次会话: 主机密钥校验已上机。** 之前 `check_server_key` 接受任意密钥(只把指纹
记下来),等于没有中间人防护 —— 这是安全缺陷,不是缺功能。现在:核心只接受已信任的
指纹,首次连接与指纹变更都在握手处拒绝,再由 UI 让人裁决;信任结果按「地址:端口」
存在主机记录里。五种情况都在真机上验过(见 §2「M2」)。

## 1. 下一步(精确操作)

### 1.0 不必等 MIUI:用 adb reverse 直接联调(已验证)

App UID 连局域网/公网全超时,但**回环正常**(实测得到的是 `Connection refused`
而不是 `Timeout`)。所以把 PC 的 sshd 反向映射到手机回环口即可:

```powershell
$adb = "D:\Android\sdk\platform-tools\adb.exe"
& $adb reverse tcp:2222 tcp:22      # 手机 127.0.0.1:2222 → PC 22;插拔 USB 后要重设
& $adb shell am force-stop dev.xssh.android
& $adb shell am start -n dev.xssh.android/.MainActivity `
    --es devAutoConnect 127.0.0.1 --ei devPort 2222 --es devUser user `
    --es devKeyPath /data/data/dev.xssh.android/files/xssh_dev_key
```

实测:进终端、显示 Windows 提示符、`input text` 输入命令、远端回显,全部正常。
(`devPort` / `devKeyPath` 是第三次会话新增的调试参数。)

### 1.1 打开 MIUI 联网控制页(已验证可行)
```powershell
$adb = "D:\Android\sdk\platform-tools\adb.exe"
& $adb shell am start -n com.miui.securitycenter/com.miui.networkassistant.ui.activity.FirewallActivity
```
页面结构(内屏 2364×1672 横屏下的坐标,供 `input tap` 用):
- 页签行:`数据-卡1` [150,291]-[838,373] / `数据-卡2` [838,291]-[1526,373] / **`WLAN` [1526,291]-[2214,373]**(中心约 1870, 332)
- 搜索框:中心约 (1181, 458);输入 `X-SSH` 搜索
- 当前观察:在「数据-卡1」页签下搜索 X-SSH,条目**名字是红色**(MIUI 语义:受限),
  但开关显示为开(蓝色)—— 需要用 **WLAN 页签** 再确认一次(手机走 Wi-Fi,起决定作用的是 WLAN)。
- 若 WLAN 下开关是关的 → 点开;顺手也检查「数据-卡1/卡2」是否被关。

### 1.2 放行后立即验证
```powershell
& $adb shell am force-stop dev.xssh.android
& $adb shell am start -n dev.xssh.android/.MainActivity --es devAutoConnect <目标IP> --es devUser <user> --es devPassword <pw>
# 等 3~5 秒截图;成功=进入终端并显示提示符,失败=connection timed out / authentication failed
```
注意:设备上当前的主机条目已被改成 `192.168.10.106`(见 §7),先确认该地址是否是当前想连的服务器。

### 1.3 之后的 M2 清单
- 折叠外屏适配验证(合上手机:应自动变单栏,连接不断)
- 屏幕切换不断连(`configChanges` 只是应急;正解 ViewModel/前台 Service 持有会话)
- 键盘条/IME 实机打磨(中文 IME、Ctrl 组合、方向键)
- 前台服务保活 + HyperOS 省电白名单引导

## 2. 今日完成(按里程碑)

### 调研(设备)
- Xiaomi 18 Fold 兼容性文档: `docs/android/xiaomi-18-fold-compat.md`
- 关键结论:内屏 7.58" 2364×1672(√2 比例,**展开即横屏**,内屏≙两块外屏并排,
  折痕在正中)、外屏 5.38" 1168×1712、HyperOS 4 = Android 17 (API 37)、
  仅中国发售、支持掌上 PC 模式、USB-C DP Alt Mode。

### 架构决策
- **双原生 UI + 共享 Rust 核心**(否决 Flutter/Capacitor)。文档: `docs/mobile/architecture.md`
- 核心选型(均已验证可用):
  - SSH: `russh` 0.63(ring 后端,移动端交叉编译免 CMake)
  - 终端仿真: `alacritty_terminal` 0.26
  - FFI: `uniffi` 0.32(proc-macro,`flat_error`)
- 仓库结构:
  ```
  mobile/
  ├─ core/
  │  ├─ xssh-core/   终端状态机(terminal.rs) + SSH 会话(ssh.rs),12 单测全绿
  │  ├─ xssh-ffi/    uniffi 导出层(cdylib/staticlib)+ uniffi-bindgen bin
  │  ├─ xssh-devpty/ 桌面调试:本机 shell → ConPTY → 核心渲染(能跑,已验证)
  │  └─ xssh-devssh/ 桌面调试:真实 SSH → 核心渲染(已验证连 Ubuntu 服务器)
  ├─ android/        Kotlin + Compose(Gradle 9.7.1 + AGP 9.4.1)
  ├─ tools/android-dev.ps1  设备/截图/自动化助手
  └─ README.md
  ```

### M0 / M1 核心(已验证)
- **终端**: 字节流→网格/光标/脏行;宽字符列对齐;隐藏字符(conceal)补空格;
  **DSR(`ESC[6n`)应答必须回写**,否则远端程序挂起(ConPTY 实测,真要命);
  `Terminal::poll_events()` → `TerminalEvent::{Write,Title,Bell,ClipboardStore}`。
- **SSH**: 密码/私钥认证、shell/exec、PTY、keepalive(30s×3)、**15s 连接超时**、
  断线事件(`ServerMsg::Disconnected`)→ UI 不再假死;`Ssh::connect` 同步 API,核心自持 tokio 运行时。
- **验证**: `xssh-devssh` 连 `192.168.1.101`(Ubuntu)成功执行 `journalctl` 并渲染;
  连本机 Windows OpenSSH 靶机(localhost)成功(exec + 交互 shell)。
- **Android 交叉编译**: `cargo ndk -t arm64-v8a -P 26 build -p xssh-core` 通过。

### M2 主机密钥校验(第四次会话,真机验证)
- **核心** `xssh-core/src/ssh.rs`: `Target.known_key` + `verify_host_key()` → `HostKeyVerdict::{Trusted,Unknown,Changed}`;
  `check_server_key` 只对 `Trusted` 返回 `true`,其余拒绝握手;`connect()` 把 russh 的笼统错误换成
  `SshError::HostKeyUnknown{fingerprint}` / `HostKeyChanged{expected,actual}`。3 个单测(共 15 passed)。
  **指纹逐字节比对**:`SHA256:` 后面是 base64,大小写有意义,只 `trim()` 首尾空白。
- **FFI**: `HostConfig.known_key`;`FfiError::{HostKeyUnknown,HostKeyChanged}`,
  Display **就是指纹**(`flat_error` 只带文本过边界,见坑 18)。
- **Kotlin**: `Host.keyFingerprint` 落 SharedPreferences;`TerminalScreen` 出确认页/告警页;
  `App` 的 `onTrustKey` 写回主机并换新 `Host` 实例触发重连;
  `HostEditorScreen` 保存时**同端点保留、改了地址或端口则清空**指纹。
- **真机验证**(`adb reverse tcp:2222 tcp:22` → 本机 OpenSSH):
  ① 没信任过 → 弹「首次连接这台主机」+ 指纹,不连;② 点信任 → 连上,指纹落盘;
  ③ 存了错指纹 → 「主机密钥已改变」并列出两个指纹,不连;④ 点「仍然信任新密钥」→ 连上并覆盖;
  ⑤ 指纹正确 → 静默直连。另验证:改名保存后指纹还在;端口 2222→2223 保存后指纹清空。
- 桌面版 CLI `xssh-devssh --known-key <指纹>` 同样走这条路径(三种结果均已手验)。

### Android App(UI v2 已上机)
- 设计令牌与 Windows 版 `global.css` 一一对应(#0e0f12 / #16181d / #262a33 / #6ea8fe),
  默认深色;终端配色与 `terminalThemes.ts` 的 systemDark 一致。
- 页面: 主机列表(搜索/卡片/⋮菜单)、编辑器(基础+认证分区)、终端(全屏等宽、
  IME 直通输入、可横滑按键条 Esc/Tab/Ctrl/Alt/方向/^C/^D/`|`/`~`/`/`/`-`、双指缩放字号、状态灯+断开)。
- **18 Fold 内屏(608dp)自动两栏**,分界线正好压在折痕上;外屏(约 445dp)单栏。
- 已实机验证: 深色主题、安全边距、两栏、编辑表单、TAB/ENTER/文本注入、保存主机、
  devAutoConnect 自动进入终端。
- **屏幕截图注意**(折叠屏有两个 display):
  `adb exec-out screencap -p -d 4639175402683733248`(内屏;外屏 id 见 §4)。

### MIUI 联网排查(第二次会话)
- 定位到 MIUI「联网控制」并可用 adb 直接打开(见 §1.1);X-SSH 在列表中名字为红(受限)。
- 交叉验证:PC 端 `xssh-devssh` 连 `192.168.1.101` 正常(密码认证 + 终端 + 执行命令),
  手机 shell UID `nc` 也通,唯独 App UID 全超时 → 判定为 MIUI 应用级防火墙,而非协议/服务端问题。
- 已确认 App 的 `INTERNET` 权限已授予、AOSP netpolicy 无限制(排除普通权限问题)。

## 3. 环境速查(今日安装)

| 组件 | 位置/版本 |
| --- | --- |
| Rust | 1.98.1,`~\.cargo\bin`(**PATH 未全局刷新,命令前加** `$env:Path = "$env:USERPROFILE\.cargo\bin;$env:Path"`) |
| Android targets | `aarch64-linux-android`, `x86_64-linux-android` |
| cargo-ndk | 4.1.2(**API level 用 `-P`,不是 `-p`**) |
| JDK | `C:\Program Files\Eclipse Adoptium\jdk-21.0.12.101-hotspot` |
| Android SDK | `D:\Android\sdk`(platform-tools / platforms;android-37.0 / build-tools;37.0.0 / ndk;28.2.13676358) |
| Gradle | `D:\Android\gradle-9.7.1`(不用 wrapper) |
| 本地 SSH 靶机 | 便携 OpenSSH,配置 `%LOCALAPPDATA%\Temp\opencode\xssh-sshd\`(0.0.0.0:22,私钥 `id_xssh_dev`,防火墙规则 "OpenSSH dev 22") |
| 用户测试服务器 | `192.168.1.101`(Ubuntu,OpenSSH 10.2;**密码不写进仓库**) |
| 网络 | PC `192.168.10.153`,手机 `192.168.10.150` |

### 常用命令
```powershell
# 核心测试 / lint
cd mobile\core; cargo test; cargo clippy --workspace --all-targets

# 交叉编译核心 + FFI(.so 供 APK 打包)
$env:ANDROID_HOME="D:\Android\sdk"; $env:ANDROID_NDK_HOME="D:\Android\sdk\ndk\28.2.13676358"
cargo ndk -t arm64-v8a -P 26 -o ..\android\app\src\main\jniLibs build -p xssh-ffi --release

# 重新生成 Kotlin 绑定(改了 FFI 接口后)
cargo run -p xssh-ffi --bin uniffi-bindgen -- generate --library target\release\xssh_ffi.dll `
  --language kotlin --out-dir ..\android\app\src\main\kotlin --no-format

# 构建 APK
$env:JAVA_HOME="C:\Program Files\Eclipse Adoptium\jdk-21.0.12.101-hotspot"
& "D:\Android\gradle-9.7.1\bin\gradle.bat" -p "D:\Documents\Claude Code\X-SSH\mobile\android" `
  assembleDebug --no-daemon --console=plain

# 设备助手(mobile/tools/android-dev.ps1): shot/tap/text/key/swipe/start/dump/asapp/fw/stay
```

## 4. 设备事实(排查时要记住)

- 型号 `2608BPX34C`,当前主用户 **User 0**(注意:曾装到 User 11「第二空间」导致 am/run-as 找不到包)。
- 内屏 display id `4639175402683733248`(展开,2364×1672 @440dpi → 608dp),
  外屏 `4639175068132267009`(1168×1712);截图必须带 `-d`。
- **触屏注入(tap/swipe)被 MIUI 拦截**(无 `USB调试(安全设置)` 时直接 SecurityException;
  即便开了也不可靠)——但 **keyevent / input text 可用**,自动化走 TAB/ENTER/文本注入。
- App 私有目录: `/data/data/dev.xssh.android/files/`(已推入测试私钥 `xssh_dev_key`,399B);
  推法: `adb shell "run-as dev.xssh.android sh -c 'cat > files/xssh_dev_key'" < 本地私钥`。
- 保持亮屏: 开发者选项「充电时保持唤醒」已开(`mStayOn=true`);30s 息屏会导致截图全黑。
- MIUI「USB 安装」确认框:屏幕要亮着,否则安装被取消(`INSTALL_FAILED_USER_RESTRICTED`)。

### M2.5 平板/折叠屏交互(第五次会话,真机验证)
- **新增 `Adaptive.kt`**: 窗口尺寸档(Compact<600≤Medium<840≤Expanded,按**窗口**不是屏幕)
  + `androidx.window:window:1.5.1` 的 `FoldingFeature`(铰链方向/半开/位置)。
  界面只读 `LocalAdaptive`,不判断机型 —— 平板、分屏、小窗、内外屏走同一套规则。
- **主机页**: 窄屏单列 + 右下悬浮「新建」(顶栏单手够不着);中屏 `GridCells.Adaptive(264dp)`
  自动两列;宽屏列表+详情,左栏宽度 = 折痕位置。详情栏给出指纹、认证方式和大号操作按钮。
- **终端**: 窄屏一行横滚按键,宽屏 `FlowRow` 折两行**全部露出**;方向键/退格长按连发;
  字号捏合后落盘(`UiPrefs`);画布留 8dp 边距避开 52dp 圆角;桌面模式上下分屏。
- **触感与反馈**: 按下即时缩放 + 轻震;卡片长按出菜单;所有可点区域 ≥48dp。
- **真机验证**(截图逐一比对): 内屏横(双栏,分界线像素级压折痕)、内屏竖(双列网格)、
  compact(`wm size 1168x1712` 覆盖成外屏尺寸)、桌面模式(`cmd device_state state 2`)、
  连着会话转屏后**会话存活且能继续输入**(echo 两次都回显)。

### M2.6 像素级对齐(第五次会话后半段)
定了一套**只有两条竖线**的栅格,写在 `Components.kt` 顶部:
- `Gutter` 16dp —— 一切**盒子**的外缘(卡片、输入框、按钮、按键条、终端画布);
- `Gutter + BoxPad` 32dp —— 一切**文字**的左缘(盒子内缩 16,无盒子的标题直接缩到 32)。

改前实测是三条线各走各的(标题 18.2 / 卡片文字 30.2 / 搜索文字 32.0),所以看着乱。
改后 `uiautomator` 实测:
- 主机卡片 **118.2dp → 81.5dp(−31%)**,三行压成两行(标签移到名称同排并**右对齐**,
  于是每张卡标签的右缘都落在同一 x;地址独占一行永不被挤掉);
- 所有文字左缘 = 32.0dp;竖向间距一律 12dp(副标题→搜索→首卡→卡间);搜索框 56.0dp;
- 双栏两侧标题顶端 66.9dp 对 66.9dp、次行 98.2 对 98.2,文字各距外缘 32dp,
  盒子各距外缘 16dp —— **隔着折痕镜像对称**;
- 终端屏:画布文字、首个按键、状态圆点同在 16dp;头部标题在 32dp;
  按键与按钮右缘同在(屏宽 − 16)dp;
- 编辑页:顶栏收进表单那一列(返回左缘 = 卡片左缘,保存右缘 = 卡片右缘),
  分组标题与输入框左缘严格同线。

### M2.7 外屏(真机折叠,425x623dp)
物理折叠后实测,并按 compact 特有的问题做了三处调整:
- **按键顺序按使用频率重排**。外屏一行只露得出 **7 个**键,原顺序露出的是
  `Esc Tab Ctrl Alt ← ↑ ↓` —— 右方向键和 `^C` 都在屏外,中断一条命令还得先横滚。
  现在是 `↑ ↓ ← → Tab ^C Esc`,常用的全在眼前(宽屏折行全部露出,顺序不影响)。
- **指纹不再从中间断行**。`SHA256:<43 字符>` 在 425dp 上会断成两行,而人要做的正是
  逐字符比对。算法名提到标签里(「本次收到 · SHA256」),摘要独占完整一行(349.5dp < 361dp)。
- **列表为空时不显示悬浮按钮**。它正好压在居中的空状态文字上,而「还没有主机」那一屏
  自己就带新建按钮,浮一个是重复。
- **物理圆角核对**:外屏圆角左右不对称(左 28px,右 **154px = 56dp**)。按圆心+半径算过
  所有控件的四个角,全部落在挖角内侧,悬浮按钮右下角余量 31px —— 不会被切。
  截图是帧缓冲,看不出物理挖角,这一项只能算不能看。

## 5. 关键坑(踩过,别再踩)

1. **DSR 应答**:终端事件不回写 → 远端程序挂起(ConPTY 必现;vim 同理)。已修 + 单测。
2. **cargo-ndk 4.x**: API level 是 `-P`;`-p` 已被 cargo 占用(会报 `unknown package: 26`)。
3. **AGP 9 内置 Kotlin**:必须删掉 `org.jetbrains.kotlin.android` 插件;Compose 插件保留。
4. **uniffi 异常字段名 `message`** 与 Kotlin `Exception.message` 冲突 → 用 `#[uniffi(flat_error)]`。
5. **改 Rust 后必须重建 `.so`**(`cargo ndk ...`)再打 APK,否则 APK 里还是旧库(今天因此浪费过一轮排查)。
6. **adb 进程会占住输出管道**导致工具误杀:所有 adb 调用重定向到文件,或结束加 `adb kill-server`。
7. **锁屏/息屏时 screencap 全黑**;多显示器必须 `-d`。
8. Windows OpenSSH 靶机需 `ListenAddress 0.0.0.0` + 入站防火墙规则才对外可达。
9. ConPTY 写端被 drop 会连带终止子进程(devpty 已用 `keep_input_open` 规避)。
10. **MIUI 联网控制页**:搜索模式会隐藏页签;清空搜索后列表可能短暂为空(等一下或退出搜索再进);
    X-SSH 名字红色 = 受限;`uiautomator dump` 看不到搜索结果的业务行,只能用截图判读。
11. **App 联网被禁的表征**:`am start` 正常、UI 正常,但连接一律超时(core 的 15s `Timeout`);
    用 `run-as <pkg> ... nc` 可快速区分"网络被禁"与"服务端问题"。
12. **Android 16+ 本地网络保护**:连 `192.168.x.x` 还要 `ACCESS_LOCAL_NETWORK` 运行时权限,
    只有 `INTERNET` 不够;被拒时同样是**静默超时**,和 MIUI 封锁、服务端不可达长得一模一样。
    排查口诀:App UID 连**公网**也超时 → 整体封锁(MIUI);只有内网超时 → 本地网络权限。
    `adb shell appops get <pkg> ACCESS_LOCAL_NETWORK` 能看到 `ignore` 与 `rejectTime`。
13. **`adb shell input text` 的空格**:要写成 `%s`(`input text 'echo%shi'`);直接写空格会丢词。
    另外它是连续快速提交,正好能压出输入法相关的竞态(见坑 14)。
14. **隐藏输入框的哨兵竞态**(已修):终端用一个零宽字符作哨兵,提交后重置输入框。重置是
    **异步生效**的,输入法同帧连发时,后一个事件里还是旧内容,按固定哨兵裁前缀会把上一个
    字符重复发出("echo"→"echoo")。改成两个零宽字符轮换,用哨兵区分「重置生效」与「陈旧事件」。
15. **终端要主动抢焦点**(已修):连上后若不点一下屏幕,隐藏输入框没有焦点
    (`dumpsys input_method` 里 `mServedView=null`),外接键盘和 `input text` 都进不去。
16. **`input tap` 在 MIUI 上会丢事件**(实测同一坐标连点 5 次只生效 1 次)。表现是
    「按钮点了没反应」,极易误判成代码 bug —— 本次就为此查了一轮。自动化里一律写成
    **点到界面变化为止**的重试循环,并用 `uiautomator dump` 判读结果,别只点一次就下结论。
    判断注入本身是否还活着: 点另一个按钮(如「返回」)看界面是否变。
17. **`am start` 要带 `-S`**:App 已在前台时同一 component 的 intent 走 `onNewIntent`,
    而 `MainActivity` 只在 `onCreate` 读 `devAutoConnect`,于是调试参数被静默忽略
    (只在输出里留一句 `Warning: Activity not started`)。
18. **`uniffi(flat_error)` 只带 Display 文本过边界**,字段不过去。所以两个主机密钥错误的
    Display **就是指纹本身**,宿主直接拿来存/比;人话措辞在 Kotlin 侧拼。改这类语义时
    记得同步 `FfiError` 的注释,否则下一个人会去解析字符串。
19. **折叠形态可以用命令模拟,不必真去掰机器**:`cmd device_state print-states` 列出
    CLOSED/HALF_OPENED/OPENED…,`cmd device_state state 2` 进半折(桌面模式),
    `state reset` 还原;窄屏形态用 `wm size 1168x1712` 覆盖成外屏尺寸(`wm size reset` 还原)。
    **但切到 CLOSED 后外屏是锁屏**,需要 PIN 才能进应用,远程测不了外屏真机。
20. **铰链坐标是「窗口」坐标**:拿它做分栏时,外层容器**不能**先加 `safeDrawingPadding`,
    否则挖孔在侧边(内屏横屏 51dp)会把分界线整体推离折痕。内边距要放进各栏自己加。
21. **`staticCompositionLocalOf` 不比较新旧值**:提供一个每次重组都新建的 data class,
    会让整棵树全量重组。`rememberAdaptive()` 里必须 `remember` 住。
22. **手写 `pointerInput` 手势会丢掉点击语义**,读屏软件点不动,`uiautomator` 也看不到
    可点节点的文字。自定义手势的控件要补 `semantics { role = Role.Button; onClick {...} }`。
23. **终端内容是 Canvas 画的**,`uiautomator dump` 拿不到里面的字,自动化断言只能靠截图;
    同理读屏软件目前也读不了终端输出(待办)。
24. **`widthIn(max=…)` 必须写在 `fillMaxWidth()` 之前**。反过来写,`fillMaxWidth` 先把
    最小宽度钉成整屏宽,`widthIn` 的上限被最小值顶掉,等于没写(编辑页顶栏因此没收窄)。
25. **对齐要量,不能看**。`uiautomator dump` 的 bounds 是精确像素(密度 2.75),
    `scratchpad/measure.py` 直接打印各元素左缘/高度/间距;Canvas 内容(终端)量不到,
    用 PIL 扫截图找最左亮像素。这次好几处 2dp 级别的偏差肉眼根本看不出来。
26. **外屏圆角不对称**(左 28px / 右 154px),`dumpsys display` 的 `RoundedCorners` 里有
    每个角的圆心与半径;贴边内容要用「圆心+半径」算是否落在挖角外,截图看不出来。
27. **真机会自己休眠回锁屏**,之后需要 PIN/指纹才能继续调试(外屏尤其容易)。
    长时间自动化前先确认亮屏策略,断了就得请用户解锁。
28. **Git Bash 会把 `/data/...` 改写成 Windows 路径**,`adb shell am start -n pkg/.Act` 也会被吃掉。
    所有 adb 命令前加 `export MSYS_NO_PATHCONV=1 MSYS2_ARG_CONV_EXCL='*'`。

## 6. 已知问题 / 待办

**第三次会话已完成**
- [x] 真机 SSH 全链路验证(经 `adb reverse`,见 §1.0)
- [x] `ACCESS_LOCAL_NETWORK` 声明 + 连内网前申请 + 失败提示(`LocalNetwork.kt`)
- [x] 修复输入重复(哨兵竞态)与终端自动聚焦
- [x] 调试参数支持 `devPort` / `devKeyPath`
- [x] `mobile/` 与 `docs/` 纳入 git(之前两天的成果一直是未跟踪状态)

**必须做(M2)**
- [ ] MIUI 联网开关 → 直连局域网(发布前必须;开发已可用 §1.0 绕开)
- [ ] 放行后回归:确认 `ACCESS_LOCAL_NETWORK` 授予流程在真机上走通(现在是 `ignore`)
- [ ] 折叠/展开、旋转的**会话存活**(现在 `configChanges` 应急;正解: ViewModel/前台 Service 持有会话)
- [ ] Android 前台服务保活 + HyperOS 省电白名单引导页
- [x] 平板/折叠屏三形态布局 + 桌面模式(见 §2「M2.5」)
- [x] 外屏实机走一遍(见 §2「M2.7」);仅剩按键条横向滚动未验证(注入 swipe 时设备已锁屏)
- [ ] 终端内容的读屏支持(Canvas 绘制,TalkBack 读不到)

**安全(M3)**
- [x] **主机密钥校验**:核心只认已信任指纹,首次连接/指纹变更均拒绝握手并抛带指纹的错误;
      UI 出确认页(首次)与告警页(变更,列出「已信任」与「本次收到」);指纹随主机落盘。
- [ ] 主机密钥改为一台主机可信任多把(现在一条记录只存一个指纹,服务端轮换要重新确认)
- [ ] 桌面版是 TOFU(首次静默记下,变更才拦;`src/main/ssh.ts` 的 `hostVerifier`)——
      与移动端现在的「首次也要人确认」不一致,发布前统一
- [ ] 密钥库: 导入/生成/生物识别解锁(uniffi 已有 `AuthMethod::KeyFile`)
- [ ] 密码/私钥 zeroize(FFI 跨边界有副本)

**体验**
- [ ] 回滚条(scrollback)+ 选择/复制粘贴(需要核心暴露 `scroll_display` / 选区 API)
- [ ] 多标签/多会话;标签颜色、命令片段、快照(与桌面版对齐)
- [ ] 端口转发 / 代理跳转 / SFTP(桌面版已有,iOS/Android 待接)
- [ ] 主机列表编辑器: 保存反馈(Toast)、名称自动填充、密钥库选择器
- [ ] 头部「＋ 新建」按钮样式核对(疑与 Ghost 预期不符,截图看清再定)
- [ ] 终端主题切按(Nord/Dracula/... 与桌面版同名系统)

**工程**
- [ ] `jniLibs/*.so` 已 gitignore;应挂到 Gradle 任务里自动 `cargo ndk`(换机一键构建)
- [ ] 主机存储从 SharedPreferences 迁到 Rust 核心(与桌面版数据模型统一,便于导入导出)
- [ ] i18n: 把 `src/renderer/src/lib/i18n.ts` 的 zh/en 字典脚本化转 `strings.xml`
- [ ] iOS 轨(共享核心已就绪;需要 Mac/云 CI)

## 7. 设备遗留状态(2026-09-20 第二次更新)

- App(debug)已装 **User 0**;主机列表里已有一条测试主机,当前显示目标是 `user@192.168.10.106:22`(用户手动改过;原测试主机为 `dev / user@192.168.10.153:22 / 私钥`)。
- 排查确认:App 的 `android.permission.INTERNET` 已授予;AOSP netpolicy 无限制;
  **以 App UID 执行 `run-as dev.xssh.android ... nc` 连任何目标都超时**,而 shell UID 正常
  → 结论:MIUI 应用级联网控制拦住了该 App。
- 「联网控制」页已能通过 adb 打开(见 §1.1),X-SSH 在「数据-卡1」页签下名字为红(受限);
  **WLAN 页签的开关状态尚未确认/未打开**(下一步就干这个)。
- 手机屏幕**常亮**已开(`mStayOn=true`);开发者选项「USB 调试(安全设置)」状态未知
  (tap 注入仍不可靠,自动化请走 keyevent / input text)。
- 双屏:内屏 display id `4639175402683733248`,外屏 `4639175068132267009`;截图必须带 `-d`。
- PC 上: 便携版 sshd 在跑(0.0.0.0:22);Gradle 用 `--no-daemon` 构建(无残留进程);
  本地靶机私钥 `%LOCALAPPDATA%\Temp\opencode\xssh-sshd\id_xssh_dev`。
- 截图与日志在 `%LOCALAPPDATA%\Temp\opencode\`(重启可能被清,重要结论已进本文档)。
