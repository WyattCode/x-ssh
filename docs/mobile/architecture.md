# X-SSH 移动端架构(双原生 UI + 共享 Rust 核心)

> 决策日期: 2026-09-19。决策:**共享 Rust 核心 + 双原生 UI**(Android: Kotlin/Compose;iOS: Swift/SwiftUI)。
> 备选方案 Flutter / Capacitor 已在选型讨论中否决(原因:双原生手感与键盘/IME 控制力优先,且接受长期双 UI 维护成本)。
> 设备基线见 [`docs/android/xiaomi-18-fold-compat.md`](../android/xiaomi-18-fold-compat.md)。

## 1. 总览

```
┌─────────────────────────────┐        ┌─────────────────────────────┐
│ Android (Kotlin + Compose)  │        │ iOS (Swift + SwiftUI)       │
│  · 终端渲染器(Canvas)       │        │  · 终端渲染器 (CoreText)    │
│  · 键盘/IME/软键盘键条       │        │  · 键盘/软键盘键条           │
│  · 折叠屏适配 (WindowManager)│        │  · iPad 多任务/外接键盘      │
│  · Keystore 安全存储         │        │  · Keychain 安全存储         │
└───────────┬─────────────────┘        └───────────┬─────────────────┘
            │   uniffi 生成的 Kotlin 绑定            │  uniffi 生成的 Swift 绑定
            └───────────────────┬──────────────────┘
                     ┌──────────┴──────────┐
                     │  xssh-core (Rust)   │
                     │  · russh   SSH 客户端│
                     │  · russh-sftp        │
                     │  · alacritty_terminal│
                     │    终端仿真状态机     │
                     │  · ssh-key 密钥解析  │
                     │  · 端口/动态转发      │
                     │  · 主机/片段/快照模型 │
                     └─────────────────────┘
```

- **核心只写一遍**(协议、终端语义、数据模型),UI 各自原生 → 手感/性能上限最高。
- 核心**不含 UI**,可在 Windows 上用 `cargo test` 快速迭代(不需要模拟器)。

## 2. 技术选型(已核实)

| 用途 | 选型 | 版本/状态 | 许可 |
| --- | --- | --- | --- |
| SSH 客户端 | `russh` | 0.63,活跃;密码/公钥/keyboard-interactive/证书认证、PTY、本地/远程/UNIX 转发、**SSH Agent 转发**、keepalive、严格 KEX(防 Terrapin) | Apache-2.0 |
| SFTP | `russh-sftp` | 与 russh 同生态 | Apache-2.0 |
| 终端仿真 | `alacritty_terminal` | 0.26.0(2026-07);`Term`/`Grid`/选区/vi-mode/damage 追踪,可脱离 PTY 独立喂字节流 | Apache-2.0 |
| 密钥解析 | `ssh-key`(+`ssh-agent` 如需) | RustCrypto 生态 | MIT/Apache-2.0 |
| FFI 绑定 | `uniffi`(proc-macro 模式) | Mozilla 生产使用(Firefox 移动端),Kotlin/Swift 双向、异步支持 | MPL-2.0 |
| 加密后端 | russh `ring` feature(不用默认 aws-lc-rs) | 移动端交叉编译更省事(无需 CMake) | — |

**许可证结论**:全部为宽松许可(MPL-2.0 仅约束 uniffi 自身文件),闭源发布无碍。
**明确不用**:Termux 的 `terminal-emulator`/`terminal-view`(GPL-3.0,闭源不可用)。

## 3. 边界设计(uniffi 接口草案)

```rust
// 会话
fn connect(cfg: HostConfig, cb: Arc<dyn SessionCallback>) -> Result<SessionHandle>;
fn disconnect(h: SessionHandle);
fn write(h: SessionHandle, data: Vec<u8>);      // 键盘 → PTY
fn resize(h: SessionHandle, cols: u16, rows: u16);

// 终端快照(仅传脏行,批量推送)
struct TermSnapshot { rows: Vec<RowUpdate>, cursor: CursorInfo, title: Option<String> }

// 平台回调(core → UI)
trait SessionCallback {
  fn on_output(s: TermSnapshot);   // 8–16ms 合并一次
  fn on_state(st: ConnState);      // connecting/authenticating/connected/closed(err)
  fn on_host_key(fp: String) -> bool;         // 首次信任确认(async 场景由 uniffi 支持)
  fn ask_password(attempt: u8) -> Option<String>;
  fn ask_passphrase(key_id: String) -> Option<String>;
}

// 安全存储抽象(平台实现,core 调用)
trait SecretStore {  // Android: Keystore 加密的 SharedPreferences/文件;iOS: Keychain
  fn get(key: String) -> Option<Vec<u8>>;
  fn set(key: String, val: Vec<u8>);
  fn delete(key: String);
}
```

性能约定:
- 输出按帧合并(16ms 或 64KB 取先),经 uniffi 以 `Vec<u8>`/扁平数组传递,避免逐单元格对象;
- 快照只传 damage 行;完整重绘只在 resize/切屏时发生;
- 所有阻塞操作(密钥解密、KEX)在 core 的 tokio 线程池,不占用 UI 线程。

## 4. 仓库结构(建议)

```
X-SSH/                      (现有 Electron 版留在根目录,不动)
└── mobile/
    ├── core/               Rust workspace
    │   ├── xssh-core/      协议/会话/终端/存储抽象(平台无关,可在 Windows 上单测)
    │   └── xssh-ffi/       uniffi 导出层(cdylib / staticlib)
    ├── android/            Gradle 工程(Kotlin 2.x + Compose,minSdk 26,compileSdk 37)
    │   ├── app/
    │   └── buildSrc 或 gradle 任务: cargo-ndk 交叉编译 + uniffi-bindgen 生成 Kotlin
    ├── ios/                Xcode 工程(需 Mac;xcframework + Swift 绑定脚本)
    └── docs/               构建说明、接口文档
```

## 5. 构建链

| 平台 | 工具 | 命令(计划) |
| --- | --- | --- |
| 通用 | Rust stable + `cargo-ndk` + `uniffi-bindgen` | `rustup target add aarch64-linux-android x86_64-linux-android aarch64-apple-ios aarch64-apple-ios-sim` |
| Android | JDK 21 + Android SDK(API 37)+ NDK | `cargo ndk -t arm64-v8a -t x86_64 -o app/src/main/jniLibs build --release` |
| iOS | macOS + Xcode(macOS 运行器 / 云 CI) | `cargo build --target aarch64-apple-ios` → `xcodebuild -create-xcframework` |

## 6. 里程碑

- **M0(技术验证,先做)**:`alacritty_terminal` 嵌入 + 字节流→网格渲染,先在 **Windows 上跑通**(cargo test + 简易 TUI 输出);再交叉编译到 Android arm64 验证可编译、可运行。
- **M1**:russh 连接真实服务器(密码/密钥),PTY 打通,Android Compose 终端可打字(含软键盘键条 + 物理键盘全键位)。
- **M2**:小米 18 Fold 双屏适配(外屏单列 / 内屏双栏、折痕分界、切换不断连)+ 前台服务保活。
- **M3**:与桌面版对齐的极简 UI/主题/i18n(脚本把 `i18n.ts` 字典转 `strings.xml`);密钥库(导入/生成,Keystore 加密);已知主机。
- **M4**:端口转发(含动态 SOCKS5)/ 代理跳转 / SFTP / 片段 / 快照。
- **iOS 轨**:M1 起共享 core;UI 另行开工(需 Mac/云 CI)。

## 7. 风险与对策

| 风险 | 影响 | 对策 |
| --- | --- | --- |
| `alacritty_terminal` 在 Android/iOS 交叉编译失败(依赖 `rustix-openpty`/`polling` 等) | M0 阻塞 | M0 首日验证;失败则退到 `vte` 解析器 + 自研网格(工作量大),或平台各自仿真器(放弃语义一致性) |
| russh 加密后端(algorithms)交叉编译 | M1 阻塞 | 用 `ring` 后端;必要时 `aws-lc-rs` + NDK CMake |
| uniffi 回调跨线程/生命周期(会话对象长时间存活) | 架构性 | 用 handle(u64)而非对象引用;回调弱引用;M0 一并验证 |
| HyperOS 后台杀连接 | 体验 | 前台服务 + 省电白名单引导(见设备文档) |
| iOS 后台断连 | 体验 | 回前台自动重连(iOS 无法规避) |
| 终端渲染性能(120Hz、长回滚) | 体验 | 只重绘脏行;字号/行高缓存;必要时降帧选项 |

## 8. 本机工具链安装清单(待执行)

本机当前:**无 Rust、无 JDK、无 Android SDK**(已核实)。

```powershell
winget install Rustlang.Rustup                            # Rust + rustup
winget install EclipseAdoptium.Temurin.21.JDK             # JDK 21
winget install Google.AndroidStudio                       # Android SDK/NDK/模拟器(体积大)
# 之后:
rustup target add aarch64-linux-android x86_64-linux-android
cargo install cargo-ndk uniffi-bindgen-cli
# Android SDK 组件(API 37 + NDK 27 + platform-tools):
sdkmanager "platforms;android-37" "ndk;27.3.13750724" "platform-tools" "build-tools;37.0.0"
```

> iOS 构建需要 macOS(或云 CI),本机不装。