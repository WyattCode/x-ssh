# Xiaomi 18 Fold 兼容性说明(X-SSH Android 版)

> 调研日期: 2026-09-19。信息来源见文末「参考资料」。
> 标注 **【待真机】** 的条目是推断/媒体报道,必须在真机上验证后才能作为开发依据。

## 0. TL;DR

- **形态**:宽折叠(官方称「中折叠」/护照式),**展开即横屏**;内屏 ≈ 两块外屏并排,折痕在正中 → **双栏布局是天然主界面**(左:主机/文件,右:终端)。
- **屏幕**:内屏 7.58" 2364×1672(√2≈1.414:1,382ppi);外屏 5.38" 1168×1712(≈1.466:1,385ppi)。双屏 LTPO 1–120Hz、峰值 4000nit、Dolby Vision。
- **系统**:HyperOS 4 = **Android 17 / API 37**;**中国大陆独占**,无 GMS。
- **三大工程风险**:
  1. HyperOS 后台省电杀连接 → 必须前台服务保活 + 引导用户设「无限制」;
  2. 外屏↔内屏切换(Activity 可能重建)不能断 SSH 连接;
  3. 物理键盘(Ctrl/Esc/Tab/箭头)必须完整支持,否则失去「键盘优先」的产品定位。
- **加分能力**:支持**掌上 PC 模式**(多窗口、窗口可调大小);USB-C 支持 **DisplayPort Alt Mode**(可外接显示器)。

## 1. 设备概览

| 项 | 值 |
| --- | --- |
| 发布 / 开售 | 2026-09-07 / 2026-09-10 |
| 销售范围 | **仅中国大陆**,无国际版 |
| 起售价 | ¥10,999(12+256);12+512 ¥11,999;16+512 ¥12,999;16+1TB ¥14,999;陶瓷典藏版(16+1TB)¥15,999 |
| SoC | 小米玄戒 XRing O3(3nm,10 核,4.35GHz 峰值) |
| RAM / 存储 | 12GB LPDDR5X / 16GB LPDDR6;256GB / 512GB / 1TB UFS 4.1 |
| 电池 / 充电 | 6000mAh(Si-C 双芯);67W 有线、50W 无线 |
| 系统 | HyperOS 4(Android 17) |
| 尺寸 | 展开 163.8 × 117.8 × 5.02 mm;折叠 83.6 × 117.8 × 10.68 mm |
| 重量 | 219 g |
| 防护 | IP58 / IP59 |
| 生物识别 | 侧边电源键指纹 |
| 摄像头 | 后置 200MP + 50MP 超广 + 50MP 潜望(3.5x);**内、外屏各一枚 16MP 前摄** |
| 连接 | Wi-Fi 7、蓝牙 6.0(HID)、NFC、红外;USB-C 3.2 Gen 2 + DP Alt Mode + OTG |
| 传感器 | 陀螺仪/加速度/气压/指南针/霍尔/心率等;无 3.5mm 耳机孔 |

## 2. 屏幕与几何(开发最关键)

| 项 | 内屏(折叠展开) | 外屏(折叠) |
| --- | --- | --- |
| 尺寸 | 7.58" | 5.38" |
| 分辨率 | 2364 × 1672(1.5K) | 1168 × 1712 |
| 宽高比 | **1.414 : 1(√2,A4 纸比例)** | **≈1.466 : 1** |
| PPI | 382 | 385 |
| 刷新率 | LTPO 1–120Hz | LTPO 1–120Hz |
| 触控采样 | 240Hz | 300Hz |
| 峰值亮度 | 4000 nit | 4000 nit |
| 面板 | Pol-less AMOLED,双层 UTG,抗反射镀膜 | AMOLED,Dragon Crystal Glass 3.0 |
| HDR | Dolby Vision / HDR10+ / HDR Vivid | 同左 |
| 其他 | DC 调光,屏占比 ~90.9% | — |

关键几何推算:

- 内屏可视区约 **157.2 × 111.2 mm**;因为铰链竖直居中,**每半屏约 78.6 × 111.2 mm**。
- 外屏可视区估算约 **77 × 113 mm** —— 即:**内屏 ≙ 两块外屏并排**。产品的双屏连续性天然是「手机 → 手机×2」。
- 密度:382/385ppi,内外同级。Android 上报 density 预计 420dpi 档 **【待真机 `wm density`】**。终端字号不要依赖系统字体缩放(sp),建议提供独立字号设置。
- **自然方向**:展开态机身为 163.8mm 宽(> 117.8mm 高)→ 内屏自然方向是**横屏**(`wm size` 预期报 2364×1672);外屏自然方向竖屏。
- 前摄:官方称「内外屏各一枚 16MP」。内屏前摄形态(屏下/挖孔)**【待真机】** → 直接影响 `DisplayCutout` / insets 处理。

## 3. 折叠形态对 UI 的含义

- **书式横向开合,铰链竖直居中**:展开后左右各一半,折痕为**竖线且正好在屏幕正中**。
- 布局设计:终端正文不要跨压折痕;把双栏分界线压在折痕上最自然(折痕即 `Column` 的中间分割线)。
- 建议布局(沿用桌面版信息架构):
  - **外屏(compact)**:单列 + 抽屉(主机列表 ↔ 终端切换);
  - **内屏(expanded)**:左栏主机/片段/文件,右栏终端(可多标签);折痕两侧各承担一栏。
- **姿态/铰链 API**:使用 Jetpack WindowManager 的 `WindowInfoTracker` 读取 `FoldingFeature`(state/orientation/occlusion);HyperOS 是否完整上报 HALF_OPENED **【待真机】**。
- **屏幕切换连续性(核心验收项)**:外→内切换伴随尺寸/密度变化,Activity 可能重建。SSH 连接、PTY、回滚缓冲必须放在 **ViewModel / 前台 Service / 单例** 中,严禁绑定 Activity 生命周期;终端缓冲区大小与光标位置跨切换保持一致。
- 不要锁定 `screenOrientation`;保持 `resizeableActivity=true`;同时适配分屏、自由窗口、掌上 PC 模式。

## 4. 系统与 API 版本

- **Android 17 = API Level 37**(代号 Cinnamon Bun),HyperOS 4 基于此。
- 构建建议:`compileSdk 37`,`targetSdk 37`(最低 36);`minSdk` 建议 26+。
- **Google Play 政策**:自 2026-08-31 起,新应用与更新必须 `targetSdk ≥ 36`。但本机国行无 GMS,Play 政策主要约束上架行为,若仅国内分发(APK / 小米应用商店)则以小米商店规则为准。
- **无 GMS 注意**:不要依赖 Firebase / Google 服务(推送、登录、崩溃上报均不可用);国内推送需接小米推送或自建长连接(SSH 保活本身就有长连接,可复用思路)。
- **HyperOS 4 特性**(与本 App 相关):
  - **掌上 PC 模式**:支持(官方 FAQ 确认),类桌面多窗口、窗口可自由缩放 → 终端窗口化、外接显示器场景要能响应任意窗口尺寸;
  - **「PC 级应用适配」**:官方桌面有 PC 级应用文件夹(对已知白名单应用开启),**【待真机】**确认是否影响第三方 App;
  - **平行窗口**(自动把单 Activity 拆两栏):**【待真机】**验证是否会被套用;若被套用,需要测试布局是否错乱,必要时在 Manifest 声明 opt-out;
  - **后台管控严格**(HyperOS 一贯策略):SSH 长连接必须用 **前台服务 + 常驻通知**;并引导用户:设置 → 应用 → 省电策略「无限制」、允许自启动、任务卡锁定。
- **前台服务类型**:Android 14+ 必须声明 `foregroundServiceType`。SSH 保活考虑 `dataSync`(注意 A15+ 有 6 小时/24 小时时长限制)或 `specialUse`(上架 Play 需说明,国内分发无此约束)。方案 **【待真机/A17 文档确认】**。
- 权限清单(预计):`INTERNET`、`FOREGROUND_SERVICE`(+ type)、`POST_NOTIFICATIONS`(13+)、`ACCESS_NETWORK_STATE`;本地文件侧用 SAF,不申请存储权限。

## 5. 输入与外设

- **物理键盘(产品灵魂,必须一等支持)**:
  - 蓝牙 6.0 HID;**第三方磁吸蓝牙键盘保护套已上市**(淘宝),官方暂无原厂键盘配件;
  - USB-C OTG 键盘同样可用;
  - 终端需支持:Ctrl / Alt / Esc / Tab / 方向键 / Home / End / PgUp/PgDn / F1–F12 / 组合键(Ctrl+C、Ctrl+D 等),以及 Meta/Alt 组合映射;
  - 外接键盘存在时应隐藏软键盘(`InputDevice.isVirtual` / `Configuration.keyboard != KEYBOARD_NOKEYS` 判定)。
- **软键盘**:终端要自定义扩展键排(Ctrl/Alt/Esc/Tab/方向/管道/~/Ctrl+C);外屏 77mm 宽,双拇指输入可行。
- **触控**:240/300Hz 采样;长按选择/复制粘贴在终端体验要单独设计(桌面版有「多行粘贴确认」,Android 版对应剪贴板监听)。
- **手写笔**:官方未提支持,不做规划。
- **<|place_holder_mm_span_0442|>外接显示**:USB-C DP Alt Mode → 掌上 PC + 外接屏时,App 需响应任意窗口尺寸(桌面级布局的免费复用场景)。

## 6. X-SSH Android 适配验收清单

1. [ ] 外屏单列布局可用:主机列表 → 终端,单手可操作,软键盘弹出不遮挡输入行。
2. [ ] 内屏展开自动变双栏:折痕两侧各一栏,布局不压折痕。
3. [ ] 外→内 / 内→外切换:SSH 会话不断开、终端内容与光标完整保留。
4. [ ] 物理键盘:全部功能键与 Ctrl 组合可用;有外接键盘时不弹软键盘。
5. [ ] 软键盘扩展键排:Esc/Ctrl/Tab/方向/Ctrl+C 一键可达。
6. [ ] 息屏 30 分钟、后台 2 小时后会话仍存活(前台服务 + 通知)。
7. [ ] HyperOS 省电策略「无限制」引导页(首次连接时提示)。
8. [ ] 掌上 PC / 自由窗口 / 分屏下窗口任意缩放不错位。
9. [ ] 平行窗口(若默认套用)布局正确,或已 opt-out。
10. [ ] 凭据不出原生层:私钥/密码存 Android Keystore 加密的私有目录;可选用生物识别解锁。
11. [ ] insets 正确:内屏前摄区域、外屏挖孔、手势条区域均不遮挡终端内容。
12. [ ] 120Hz 下终端滚动的功耗/掉帧可接受;提供「降低刷新/减少动画」选项(对应桌面版 `.perf-no-blur` 思路)。
13. [ ] 网络切换(Wi-Fi ↔ 5G)自动重连或明确提示。
14. [ ] 字体:等宽字体内置或可选;字号设置独立于系统字体缩放。

## 7. 真机验证清单(adb)

```powershell
# 基础参数
adb shell wm size                 # 内/外屏分别执行(切换后重跑)
adb shell wm density
adb shell dumpsys display | Select-String "mBaseDisplayInfo"
adb shell dumpsys window displays | Select-String "mCurrentFocus"

# 折叠姿态/FoldingFeature:写最小 demo 输出 WindowInfoTracker 状态,或 Android Studio Layout Inspector
# 平行窗口 / 强制可调整大小:开发者选项 →「强制将活动设为可调整大小」「平行窗口」对照测试
# HyperOS 保活:锁屏 / 切后台 / 清后台,观察前台服务与连接存活
# 键盘:配对蓝牙键盘 + USB-C 键盘,遍历功能键;观察 Configuration.keyboard
```

- 开启开发者选项:设置 → 我的设备 → 全部参数 → 连点「OS 版本」7 次。小米的「USB 调试(安全设置)」只影响模拟输入,普通调试不需要。
- **注意**:外屏 1168×1712 与内屏 2364×1672 的密度、insets、cutout 都需分别记录,写入 `docs/android/device-profiles.md`(后续建)。
- 模拟器不能模拟 HyperOS 行为(保活、平行窗口、掌上 PC),**必须用真机**,模拟器仅用于基础布局冒烟。

## 8. 参考资料

- GSMArena 发布稿(2026-09-07): <https://www.gsmarena.com/xiaomi_18_fold_is_here_with_the_xring_o3_soc_a_wide_format_and_a_cherry_red_colorway-news-74500.php>
- GSMArena 上手(2026-09-08): <https://www.gsmarena.com/xiaomi_18_fold_handson-news-74508.php>
- GSMArena 规格页: <https://www.gsmarena.com/xiaomi_18_fold_5g-14931.php>
- DeviceSpecifications 详细规格: <https://www.devicespecifications.com/en/model/a485683b>
- Beebom Gadgets 规格: <https://gadgets.beebom.com/mobile/xiaomi-18-fold>
- NanoReview: <https://nanoreview.net/en/phone/xiaomi-18-fold>
- 小米官网 18 Fold 参数页: <https://www.mi.com/prod/xiaomi-18-fold/specs>
- Android API Levels(Android 17 = API 37;Play target 36 要求): <https://apilevels.com/>
- 掌上 PC 模式说明(小米官方帮助): <https://cdn.cnbj1.fds.api.mi-img.com/ics-resources/articles/60dac2725a398495463fe910.html>