# Windows 代码签名落地方案

> 状态：待你做一个决定（花不花钱、走哪条路）。这份文档只负责把选型和验收标准写清楚，
> **不预改 `package.json`** —— 现在就把证书相关配置塞进 `build.win`，会让 `npm run dist`
> 因找不到证书文件直接失败，等于把 CI 弄红。

## 为什么这件事排在功能打磨前面

发布链路现在的样子（2026-11-02 实测）：

- 0.6.0 的 Windows 安装包下载数 **1**；仓库 0 star、14 天 0 访问、用户提的 issue **0** 条。
- 也就是说：唯一还没被验证过的漏斗环节，是"陌生人能不能把包装上"，而不是"用着顺不顺"。
- 而首次运行会撞蓝底「Windows 已保护你的电脑」。**管着用户私钥的 SSH 客户端**在这个界面
  上劝退的效率，比普通应用高得多 —— 用户在这里被要求"绕过安全措施"去交私钥。

## 两条路

### A. Azure Artifact Signing（原 Trusted Signing，已改名）

微软官方文档（2026-08-03 更新）核实到的：

- 服务已更名 **Artifact Signing**，完全托管、端到端，面向外部开发者分发场景。
- **仍处于 public preview** —— 这是选型时要算进去的风险（接口/政策可能变）。
- 分 **Basic SKU / Premium SKU**；在 FIPS 140-3 Level 3 HSM 内托管证书全生命周期。
- 支持**摘要签名**（digest signing）：待签文件不出你的机器，只把摘要发过去签 —— 适合 CI。
- 账号结构：Azure 订阅 → 资源组 → Artifact Signing 账号 →（身份验证 + 证书配置文件）。
  **身份验证是必经环节**，个人主体要留审核时间。

**需要你自己上官网确认的**（我没写到文档里当结论）：具体价格、个人开发者是否满足
Basic SKU 资格、身份验证实际耗时。preview 期这几项变动频繁，我拒绝把二手数字写进方案。

### B. 传统商业 OV 证书（第三方 CA 年费）

- 生态最成熟，electron-builder 支持历史最长，`signtool` 直连。
- 要花钱（按年），要过 CA 的组织验证；证书本体是敏感资产，泄露即被人冒充你签名，
  所以必须托管在 CI secret / HSM 里，不能落本地仓库。

选型建议：**先按 A 询价**。A 走不通（个人主体不符合、或 preview 状态你不能接受）再退到 B。

## 落地时要动的三处（证书到位后我再改，现在只列位置）

1. `package.json` → `build.win`：加签名相关配置（证书来源、时间戳服务）。
   注意现有配置已经是 `"win": { "icon": "build/icon.ico", "target": "nsis" }`，
   `nsis.oneClick=false` / `allowToChangeInstallationDirectory=true` 保持不动。
2. `.github/workflows/ci.yml` 的 `release` job：注入凭据 secret（仓库 Settings → Secrets）。
   该 job 目前只有 `permissions: contents: write` 和 `GH_TOKEN`，签名要额外凭据。
   顺手一处：那里的注释写着"The app is not code-signed, so SmartScreen may warn"，
   签名后要一起改，否则注释会变成错的。
3. `README.md` 的「下载」段：删掉"还没有代码签名 / 点仍要运行"那两条，换成签名说明。

## 验收标准（做不到就算没签成）

```powershell
# 1) 签名有效且指向受信任的证书链
Get-AuthenticodeSignature ".\X-SSH Setup 0.6.1.exe" | Format-List Status, SignerCertificate
signtool verify /pa /v ".\X-SSH Setup 0.6.1.exe"
# 2) 时间戳存在（否则证书过期后签名就失效）
#    上面 signtool 输出里应能看到 timestamp
# 3) 在一台干净 Windows（新装、无历史信誉）上双击：不再出现蓝底 SmartScreen
```

第 3 条是唯一真正算数的。前两条绿了但蓝框还在，说明签名没被 SmartScreen 采信
（常见原因：证书链不完整、缺时间戳，或该证书刚签发还没有积累信誉）。
