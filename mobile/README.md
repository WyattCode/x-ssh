# X-SSH 移动端(共享核心 + 双原生 UI)

方案与决策见 [`docs/mobile/architecture.md`](../../docs/mobile/architecture.md)。
**交接文档见 [`mobile/HANDOVER.md`](HANDOVER.md)**(当前状态、明天第一步、环境命令、踩坑清单)。

当前进度:
- **M0 完成**:终端核心(字节流→网格/光标/脏行/事件应答),12 单测全绿。
- **M1 核心完成**:SSH(密码/私钥、shell/exec、PTY、超时、断线事件)已验证;
  Android arm64 交叉编译通过;`xssh-devssh` 连真实服务器跑通。
- **Android 壳 v2 已上机**:深色 X-SSH 主题、主机列表/编辑器/终端三页,
  18 Fold 内屏自动两栏(分界线压折痕)、外屏单栏;TAB/文本注入可自动化。
- **卡点**:MIUI 应用级联网控制拦住了 X-SSH(已找到「联网控制」页并确认条目受限,
  下一步在 WLAN 页签放行),详见交接文档 §1。

## 目录

```
mobile/
├── core/                 Rust workspace(平台无关,可在 Windows 上直接迭代)
│   ├── xssh-core/        终端仿真状态机 + SSH 会话(russh)
│   ├── xssh-ffi/         uniffi 导出层(Kotlin/Swift 绑定)
│   ├── xssh-devpty/      开发工具:本机 shell → ConPTY → 核心渲染到控制台
│   └── xssh-devssh/      开发工具:真实 SSH 服务器 → 核心渲染到控制台
├── android/              Kotlin + Compose(Gradle 9.7.1 + AGP 9.4.1)
├── tools/android-dev.ps1 设备助手:截图(双屏自适应)/按键/文本/装机/诊断
├── HANDOVER.md           交接文档
└── ios/                  (待建)Swift + SwiftUI,iOS 构建需 macOS
```

## 工具链(已装)

- Rust stable + `cargo-ndk` 4.1.2
- JDK 21:`C:\Program Files\Eclipse Adoptium\jdk-21.0.12.101-hotspot`
- Android SDK:`D:\Android\sdk`(`platforms;android-37.0`、`build-tools;37.0.0`、`platform-tools`);NDK:`ndk\28.2.13676358`
- 交叉编译示例:
  ```powershell
  $env:ANDROID_HOME = "D:\Android\sdk"
  $env:ANDROID_NDK_HOME = "D:\Android\sdk\ndk\28.2.13676358"
  cargo ndk -t arm64-v8a -P 26 build -p xssh-core
  ```
  注意:cargo-ndk 4.x 的 API level 是 `-P/--platform`(`-p` 已让位给 cargo 的 `--package`)。

## 常用命令

```powershell
# 单元测试(终端语义:转义序列、宽字符、备用屏、脏行、DSR 应答)
cargo test

# 开发终端:把本机 shell 显示在控制台(交互输入按行提交)
cargo run -p xssh-devpty
cargo run -p xssh-devpty -- --cols 90 --rows 14 -- cmd.exe /c dir

# Android 交叉编译检查(核心;不需要 NDK 即可 `check`)
cargo check --target aarch64-linux-android -p xssh-core
```

## 本地 SSH 靶机(M1 联调用)

便携版 Win32-OpenSSH,监听 `127.0.0.1:22`,仅公钥认证。

- 位置:`%LOCALAPPDATA%\Temp\opencode\xssh-sshd\`
- 私钥(客户端):`xssh-sshd\id_xssh_dev`;公钥已写入 `authorized_keys`
- 启动:`Start-Process "$env:LOCALAPPDATA\Temp\opencode\xssh-sshd\OpenSSH-Win64\sshd.exe" -ArgumentList "-f","$env:LOCALAPPDATA\Temp\opencode\xssh-sshd\sshd_config" -WindowStyle Hidden`
- 停止:`Stop-Process -Name sshd`
- 验证:`ssh -i <父路径>\id_xssh_dev -o StrictHostKeyChecking=no -o UserKnownHostsFile=NUL 127.0.0.1`

## 已固化到核心的关键行为

- **终端应答必须回写连接**:DSR 等查询(`ESC[6n`)若不应答,远端程序会挂起(ConPTY 实测;vim 同理)。`Terminal::poll_events()` 返回 `TerminalEvent::Write(bytes)`,宿主负责写回。
- 视口文本 `screen_lines()` 保留全部行(渲染器需要);`text()` 裁剪末尾空行(测试/日志用)。
- `take_damage()` 每帧只返回脏行;光标所在单元每帧都会报告为脏(渲染器需重画光标)。