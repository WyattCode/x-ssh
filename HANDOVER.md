# X-SSH 交接文档

## 项目概述
- 极简、键盘优先的 SSH 客户端。Electron + Vue 3 (Vite) + TypeScript。
- 平台: Windows (`win32`)。目录: `D:\Documents\Claude Code\X-SSH`。
- **不是 git 仓库**(无 `.git`)。不要用 git diff/status。
- 版本: `package.json` 当前为 **0.1.1**。

## 常用命令(Windows/PowerShell)
- 必须用 `npm.cmd`(直接 `npm` 会因执行策略失败)。
- 校验: `npm.cmd run typecheck`、`npm.cmd run build`
- 打包: `npm.cmd run dist` → `release\X-SSH Setup 0.1.1.exe`(NSIS)+ `release\win-unpacked\X-SSH.exe` + `.blockmap`。
- 无代码签名,SmartScreen 可能提示(正常)。

## 架构要点
- **密码/密钥永不离开主进程**:SSH 在主进程(`src/main/ssh.ts`),渲染层经 IPC(preload `src/preload/index.ts`)调用。
- i18n:`src/renderer/src/lib/i18n.ts`,定义 `zh` 与 `en` 两个字典。**两个键集合必须一致**(现 334/334)。
  - 动态键模式: `tab.*` / `group.*` / `sck.*` / `sck.*Hint`(缺失 hint 回退 `''`)。
  - 主题名(Nord/Dracula 等)为专有名词 **不翻译**,不建键。
- 产品理念: 极简、键盘优先、密码/密钥不出主进程。
- 更新功能(在线检查更新)按用户要求**已移除**。

## 本会话已完成
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

## 已知限制 / 注意
- **shell 集成 + `onConnect` 同时开启**: `onConnect` 命令仍会执行,但其输出可能被 shell 集成首屏的屏清序列吞掉(边缘组合)。
- **双面板远程→本机** 仍走系统原生「拖出到桌面」(原生拖拽一次仅一个文件,多选并行拖出非 Electron 支持)。
- **上传续传注意**: 每个文件上传前都做 `statSize` 与本地 `stat`,大目录批量上传会增加往返延迟(为正确性而做)。
- 快照/标签恢复保存的 pane 参数已剥离 `password`/`passphrase`,恢复后为**断开状态**,需用户重新连并重新输入凭据。
- 双面板本机浏览只为展示目录/文件名,不含文件大小修改时间;本机侧暂未做重命名/新建/删除。

## 下一步(如果继续)
- 按用户截图式 UI 反馈继续修复。
- 如版本号需增加,改 `package.json` 后 `npm.cmd run dist` 重打包。
- 大规模改动前先跑 `npm.cmd run typecheck && npm.cmd run build` 保证通过。
