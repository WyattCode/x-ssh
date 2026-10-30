# 会话记录:连续改进 M3.83(2026-10-30,复核打磨:OSC52 空白 base64 + 主锁 Enter/busy + 离线点透明度)

功能清单已够,本轮按站立规则做开源复核打磨(不合并)。未动 PR #17 / #16 / #15 / #14 / #13 / #12 与更早的 #4–#11。
# 会话记录:连续改进 M3.84(2026-10-30,复核打磨:主题循环竞态 + 关闭全部确认 + 连接日志 disconnect/滚动)

功能清单已够,本轮按站立规则做开源复核打磨(不合并)。未动 PR #18 / #17 / #16 / #15 / #14 / #13 / #12 与更早的 #4–#11。
# 会话记录:连续改进 M3.85(2026-10-30,复核打磨:ZoomHud 失焦粘滞 + 窗格失焦 blur + keyManager IPC 错误码)

功能清单已够,本轮按站立规则做开源复核打磨(不合并)。未动 PR #19 / #18 / #17 / #16 / #15 / #14 / #13 / #12 与更早的 #4–#11。
# 会话记录:连续改进 M3.86(2026-10-30,复核打磨:TooltipLayer 失焦粘滞 + 片段变量重入/焦点 + 改地址清 reach)

功能清单已够,本轮按站立规则做开源复核打磨(不合并)。未动 PR #20 / #19 / #18 / #17 / #16 / #15 / #14 / #13 / #12 与更早的 #4–#11。
# 会话记录:连续改进 M3.87(2026-10-30,复核打磨:TextEditor Esc/保存错误/会话冻结 + SFTP 本机选区修剪 + 命令面板主机搜索)

功能清单已够,本轮按站立规则做开源复核打磨(不合并)。未动 PR #21 / #20 / #19 / #18 / #17 / #16 / #15 / #14 / #13 / #12 与更早的 #4–#11。
# 会话记录:连续改进 M3.88(2026-10-30,复核打磨:跳板一层对齐 Android + SFTP 远程选区 prune + 部署对话框 busy/错误)

功能清单已够,本轮按站立规则做开源复核打磨(不合并)。未动 PR #22 / #21 / #20 / #19 / #18 / #17 / #16 / #15 / #14 / #13 / #12 与更早的 #4–#11。
# 会话记录:连续改进 M3.89(2026-10-30,复核打磨:粘贴行数/死会话 + 同步对话框 busy/错误 + ForwardsPage 列表 + Android 粘贴消毒)

功能清单已够,本轮按站立规则做开源复核打磨(不合并)。未动 PR #23 / #22 / #21 / #20 / #19 / #18 / #17 / #16 / #15 / #14 / #13 / #12 与更早的 #4–#11。
# 会话记录:连续改进 M3.90(2026-10-30,复核打磨:密钥生成 busy + 回收公钥确认 + Android 主机保存 busy + known_hosts 当日龄)

功能清单已够,本轮按站立规则做开源复核打磨(不合并)。未动 PR #24 / #23 / #22 / #21 / #20 / #19 / #18 / #17 / #16 / #15 / #14 / #13 / #12 与更早的 #4–#11。

**核过已过时 / 已在未合并 PR(本轮不重做)**:
1. TransferPanel 失败原因 / ETA + Android 罚分地板 —— PR #12。
2. 桌面重连中途罚分地板 + local/SOCKS `forwardOut` 超时 —— PR #13。
3. HostEditor 密钥小层陷阱 / 命令面板遮罩回退 / 强调色样本 / 分组标签按下 —— PR #14。
4. TransferPanel 暂停图标响应式 / Android 坏 SFTP 句柄丢弃 / ForwardDialog Enter —— PR #15。
5. sendSnippet 活会话复核 / known_hosts·片段删除确认 / ForwardsPage 切 mode 清错 —— PR #16。
6. 快照恢复确认 + 关闭其他尊重 confirmClose + 侧栏按下缩小 —— PR #17。

**修了**:
1. **OSC 52 剪贴板:base64 里带空白/换行时静默失败**:抽出纯函数 `lib/osc52.ts` `decodeOsc52Payload`(去空白再 atob→TextDecoder),`TerminalView` 改用它;单测 7 条(空 / `?` / `aGk=` / 换行包裹 / 非法 / 超长 / UTF-8)。
2. **设置 → 安全 → 主锁 UX**:口令框支持 Enter(IME 守卫,无 `.prevent`);`unlockNow`/`disable`/`reset` 进 `lockBusy` 防连点,按钮统一 `:disabled="lockBusy"`;空口令解锁也 toast `lock.passReq`。
3. **连接页离线状态点缺设计透明度**:`.dot.offline` 补 `opacity: 0.6`(HANDOVER 原定;unknown 仍 0.8 空心圈)。

**验证**:`typecheck` + `lint:i18n` + vitest **341** 全绿(原 334;+`osc52` 7)。Android 本轮未改。未合并。
7. OSC52 空白 base64 + 主锁 Enter/busy + 离线点透明度 —— PR #18。

**修了**:
1. **主题循环竞态**:`composables/theme.ts` `setPref` 在 await IPC 前乐观写 `pref`,侧栏/设置连点不再吞掉一步;失败不回滚(避免闪),跟随系统时回读 media。
2. **标签栏「关闭全部」+ confirmClose**:新纯函数 `lib/tabCloseGuard.ts` `closeAllNeedsConfirm`(+4 测);`sessions.closeAll` 有活会话且开了确认时弹一次危险确认并先发 `exit`;TabBar 右键菜单加入口。
3. **连接日志 UI**:`.log-event.disconnect` 补中性灰芯片(原先无样式、和默认糊在一起);日志行包进 `.log-list`(`max-height:320px` 可滚),空态/清空按钮仍在外。

**验证**:`typecheck` + `lint:i18n` + vitest **338** 全绿(原 334;+`tabCloseGuard` 4)。Android 本轮未改。未合并。
7. OSC52 空白 base64 + 主锁 Enter/busy + 离线点透明度 —— PR #18。
8. 主题循环竞态 + 关闭全部确认 + 连接日志 disconnect/滚动 —— PR #19。

**修了**:
1. **ZoomHud 失焦粘滞**:`lib/zoomHud.ts` `shouldReleaseZoomHover`;`composables/zoom.ts` 在 `window.blur` / `visibilitychange→hidden` 时清掉 `hovering` 并重新计时隐藏 —— Alt-Tab 时指针还停在药丸上不会再永远挂着。
2. **窗格 / 离页焦点**:`TerminalView` 在 `focused` 或 `visible` 变 false 时 `term.blur()`。终端页是 `v-show` 常挂,切到连接 / SFTP / 设置后 xterm textarea 以前仍占着 `document.activeElement`,按键会打进还活着的 SSH。
3. **keyManager IPC 错误码**:抛 `invalid-key` / `bad-id` 稳定标记;`KeyErrorCode` + 主进程 `keyFail`;渲染层 `keyErrorMessage` 翻译。顺手给 HostEditor 生成/导入加 `keyBusy`,防双击生两把钥匙。

**验证**:`typecheck` + `lint:i18n` + vitest **343** 全绿(原 334;+`zoomHud` 4 + `keyError` 5)。Android 本轮未改。未合并。
7. OSC52 空白 base64 + 主锁 Enter/busy + 离线点透明度 —— PR #18。
8. 主题循环竞态 + 关闭全部确认 + 连接日志 disconnect/滚动 —— PR #19。
9. ZoomHud 失焦粘滞 + 窗格失焦 blur + keyManager IPC 错误码 —— PR #20。

**修了**:
1. **TooltipLayer 失焦粘滞**:`lib/tooltipDismiss.ts` `shouldDismissTooltip`;`TooltipLayer` 在 `window.blur` / `visibilitychange→hidden` 时 `release()` —— Alt-Tab 时延迟/已显示的 tip 不会永远挂着,title 也不会一直被摘掉。
2. **片段变量对话框**:`prompt` 重入时完整拆掉上一次(resolve=null + 关窗),避免挂死的 Promise;无占位符的后续调用也不会留下空壳对话框。`fillSnippetText` 抽出可测;`SnippetVarsDialog` Enter `preventDefault`、打开聚焦第一个空框、校验失败聚焦 `.bad`、输入清 error。
3. **改地址 / 删主机清 reach**:`sessions.clearReach`;HostsPage 在地址/端口变更后先清再探,避免还亮着旧 IP 的绿点;删除主机顺手丢掉孤儿 reach。

**验证**:`typecheck` + `lint:i18n` + vitest **342** 全绿(原 334;+`tooltipDismiss` 4 + `snippetVars` 4)。Android 本轮未改。未合并。



7. OSC52 空白 base64 + 主锁 Enter/busy + 离线点透明度 —— PR #18。
8. 主题循环竞态 + 关闭全部确认 + 连接日志 disconnect/滚动 —— PR #19。
9. ZoomHud 失焦粘滞 + 窗格失焦 blur + keyManager IPC 错误码 —— PR #20。
10. TooltipLayer 失焦粘滞 + 片段变量重入/焦点 + 改地址清 reach —— PR #21。

**修了**:
1. **TextEditor**:`Esc` 真正关窗(脚注早已写着 Esc 退出);保存失败拆成 `saveError` 横幅,不再用 `error` 整页盖住未存正文;`frozenSessionId` 开编辑时钉死会话,切标签不会读/写错会话;加载用 `loadSeq` 丢掉过期响应。
2. **SFTP 双栏本机选区**:`pruneSelection` + `watch(localSorted)` —— 同目录刷新后幽灵文件名不再撑大「已选 n」(对齐远程面板)。
3. **命令面板搜索**:`paletteHostScore` 对齐连接页(label/host/user/user@host/group/tags/os);换查询重置选中行;高亮用 `qTrim` 与打分一致。
4. **LockScreen**:输错后开始重打就清掉红色错误(Settings 的 lockBusy 仍在未合并的 #18,本轮不动)。

**验证**:`typecheck` + `lint:i18n` + vitest **343** 全绿(原 334;+`selectionPrune` 4 + `paletteHostScore` 5)。Android 本轮未改(复核目标区未见新的 P0)。未合并。
11. TextEditor Esc/saveError/session 冻结 + SFTP 本机选区 prune + 命令面板主机搜索 —— PR #22。

**修了**:
1. **HostEditor 跳板机(桌面落后 Android)**:`lib/jumpCandidates.ts` —— 候选排除自身与「自己已有跳板」的主机(只支持一层);已被别人当跳板且尚未自设时禁用下拉并提示 `host.jumpBlocked`;遗留嵌套选中项仍保留在选项里以便看清/清掉。
2. **SFTP 远程选区 prune**:改对 `entries`(目录真值)做 `pruneSelection`,不再被筛选框误清;被裁掉的 `anchor` 一并清掉(对齐未合并 #22 本机面板口径)。
3. **部署对话框**:`closeDeploy` 在 `deploy.busy` 时拒绝 Esc/遮罩/取消/关闭;失败写进对话框内 `deploy.error`(不再藏到抽屉 banner 后面);Enter 提交(Shift+Enter 换行,IME 守卫)。

**验证**:`typecheck` + `lint:i18n` + vitest **353** 全绿(原 334;+`jumpCandidates` 14 + `selectionPrune` 5)。Android 本轮未改代码(跳板规则桌面追上 `JumpField.kt`)。未合并。
11. TextEditor Esc/saveError/session 冻结 + SFTP 本机选区 prune + 命令面板主机搜索 —— PR #22。
12. 跳板一层对齐 Android + SFTP 远程选区 prune + 部署对话框 busy/错误 —— PR #23。

**修了**:
1. **终端多行粘贴误确认**:`lib/pasteLines.ts` `pasteLineCount` 归一化 CRLF 并去掉尾部换行,单行复制不再弹确认;确认期间 `pasteBusy` 防叠对话框;确认回来后复核 `paneBySession` 仍 connected 且 sessionId 匹配再 `term.paste`。
2. **同步对话框**:`busy`/`error` 进对话框;失败不再写抽屉 banner;成功才关;`closeSync` 在 busy 时拒绝 Esc/遮罩/取消/关闭;Enter 提交;切到 `both` 清掉隐藏的 `del`。
3. **ForwardsPage 列表**:删除按钮只锁当前 `busyKey` 那一行(不再整页锁死);`.del:active` 按下缩小;改 `form.target` 清残留 `err`。
4. **Android 粘贴消毒**:`PasteSanitize` 对齐桌面 `sanitizePasteText`(保留 tab/CR/LF,剥 C0/C1);剪贴板粘贴与拖入终端两条路径都过一遍。

**验证**:`typecheck` + `lint:i18n` + vitest **338** 全绿(原 334;+`pasteLines` 4)。Android 单测文件已加(`PasteSanitizeTest`),本环境未跑 Gradle。未合并。
11. HostEditor Esc/saveError/session 冻结 + SFTP 本机选区 prune + 命令面板主机搜索 —— PR #22。
12. 跳板一层对齐 Android + SFTP 远程选区 prune + 部署对话框 busy/错误 —— PR #23。
13. 粘贴行数/死会话 + 同步对话框 busy/错误 + ForwardsPage 列表 + Android 粘贴消毒 —— PR #24。

**修了**:
1. **密钥生成双提交**:`HostEditor` 的 `keyModal.busy` 挡住第二次 Enter/点击;`closeKeySheet` 在 busy 时拒绝;生成中禁用输入/类型切换/取消/保存,按钮文案切到「生成中…」。
2. **回收公钥无确认**:`PublishKeyDialog.revoke` 先走 `useConfirm(keyPub.revokeConfirm)`;发布与回收互相禁用对方按钮,防并行改远程 `authorized_keys`。
3. **Android 主机编辑双保存**:`HostEditorScreen.save` 加 `saving` 闸;生物识别解锁期间再点 ✓ / Ctrl+S 不再起第二个协程。
4. **known_hosts 当日龄**:`keyAge` 对不足一天返回 `''`(与 JSDoc「太新不显示」一致),不再画误导的 `0d` 徽章。

**验证**:`lint:i18n` + vitest **334** 全绿(无新增纯函数测试)。本环境未跑 Gradle / typecheck Electron。未合并。
# 会话记录:连续改进 M3.91(2026-10-30,复核打磨:快照删除/空布局 + 跟随药丸恢复跟随 + 日志失败提示 + Android 对话框双提交)

功能清单已够,本轮按站立规则做开源复核打磨(不合并)。未动 PR #25 / #24 / #23–#12 与更早的 #4–#11。

**核过已过时 / 已在未合并 PR(本轮不重做)**:
1–12. 同 M3.90 所列 PR #12–#23。
13. 粘贴行数/死会话 + 同步对话框 busy/错误 + ForwardsPage 列表 + Android 粘贴消毒 —— PR #24。
14. 密钥生成 busy + 回收公钥确认 + Android 主机保存 busy + known_hosts 当日龄 —— PR #25。

**修了**:
1. **快照 UI**:命令面板快照行改为 `kind: 'snapshot'`,右侧垃圾桶 + 确认后 `deleteSnapshot`(此前 API 存在但无入口);空标签保存 toast `pal.snapEmpty`,store 侧也拒绝写入空布局。
2. **跟随药丸**:`jumpFollow` 在滚到底的同时把 `followOutput` 重新打开,与 `followTip`「自动跟随」文案一致;菜单「滚到底」仍只滚动。
3. **会话日志失败**:`startLog` 非取消失败时 toast `term.logFail`(不再静默)。
4. **Android SFTP 对话框双提交**:`NameDialog` / `ConfirmDialog` 用 `done` 闸,Enter+按钮连点不会双改名/双删。

**验证**:`lint:i18n` + `typecheck` + vitest **334** 全绿。未跑 Gradle。未合并。
# 会话记录:连续改进 M3.92(2026-10-30,复核打磨:传输面板 Esc/关闭文案 + 密钥导入删除 busy + 删主机清 reach + Android 生物识别串行)

功能清单已够,本轮按站立规则做开源复核打磨(不合并)。未动 PR #26 / #25–#12 与更早的 #4–#11。

**核过已过时 / 已在未合并 PR(本轮不重做)**:
1–14. 同 M3.91 所列 PR #12–#25。
15. 快照删除/空布局保存 + 跟随药丸恢复跟随 + 日志失败 toast + Android Name/Confirm 双提交 —— PR #26。
16. TransferPanel 暂停响应性(`pausedIds` Set→响应式)—— PR #15;本轮只做 Esc/关闭 title。
17. Settings 强调色色板空值显示 —— PR #14;本轮未改 accent 写入。
18. 改地址清 reach —— PR #21;本轮补删主机清 reach。
19. keyGen busy —— PR #25;本轮只补 import/delete busy。

**修了**:
1. **TransferPanel**:关闭按钮 `title="Close"` → `:title="t('fileDiff.close')"`;Esc 关面板(与 HistorySearch 等一致)。
2. **HostEditor 密钥库**(keyModal 之外):`importKey` / `deleteKey` 加 `importing` / `deletingId` 闸 + 按钮 disabled,防双开系统对话框 / 叠确认双删。
3. **HostsPage reach**:`removeHost` 从 `reach` 丢掉已删 id(改地址清 reach 之外的泄漏)。
4. **Android SecretUnlock**:`authMutex` 串行生物识别;拿锁后再试一次直读,避免双击连接 / 主机+跳板叠两张系统解锁框。
# 会话记录:连续改进 M3.93(2026-10-30,复核打磨:强调色拖动少写盘 + 传输全暂停粘滞 + 连接页双击双开 + Android 断开一次退出)

功能清单已够,本轮按站立规则做开源复核打磨(不合并)。未动 PR #27 / #26–#12 与更早的 #4–#11。

**核过已过时 / 已在未合并 PR(本轮不重做)**:
1–15. 同 M3.92 所列 PR #12–#26。
16. TransferPanel Esc/关闭文案 + 密钥导入删除 busy + 删主机清 reach + Android authMutex —— PR #27。
17. TransferPanel 暂停响应性 —— PR #15;本轮只清 `allPaused` 粘滞。
18. 强调色空值色板 —— PR #14;本轮只改拖动时少写 settings。
19. 主题循环竞态 —— PR #19;本轮未动 `setPref`。

**修了**:
1. **Settings 强调色**:`@input` 只更新预览,`@change` 才 `saveSetting`(拖色板不再连写盘)。
2. **TransferPanel**:队列清空时复位 `allPaused` / `pausedIds`,下一笔传输不再误显示「全部继续」。
3. **HostsPage**:`connectingId` 闸 + busy 样式,卡片双击/连按不会开两个标签。
4. **Android TerminalView**:`disconnectSession` / `leaveScreen` 一次退出,防双击连 pop 导航栈。
# 会话记录:连续改进 M3.94(2026-10-30,复核打磨:自动重连按钮禁用 + 转发对话框 busy + Android 死态重连一次)

功能清单已够,本轮按站立规则做开源复核打磨(不合并)。未动 PR #28 / #27–#12 与更早的 #4–#11。

**核过已过时 / 已在未合并 PR(本轮不重做)**:
1–16. 同 M3.93 所列 PR #12–#27。
17. 强调色 `@change` / TransferPanel `allPaused` 复位 / HostsPage `connectingId` / Android `leaveScreen` —— PR #28。
18. TransferPanel Esc/关闭 + 密钥导入删除 busy + 删主机清 reach + Android authMutex —— PR #27。

**修了**:
1. **PaneNode 错误卡重连**:`reconnectAttempt` 期间禁用按钮并显示 `app.reconnecting`(自动退避窗口内避免与罚时重试竞态);补 `.idle-connect:disabled`。
2. **ForwardDialog**:`add()` 加 `busy` 重入闸 + `try/finally`;`remove()` 加 `removing` 闸 + await + `:disabled`,补 `.fw-del:disabled`。
3. **Android TerminalView 死态重连**:`requestReconnect()` 一次点击闸,防双击叠开握手(与 #28 leaveScreen 对称,未动 disconnect)。
# 会话记录:连续改进 M3.95(2026-10-30,复核打磨:门页信任/重试一次 + SFTP 打包删除 busy + tmux 附着 busy)

功能清单已够,本轮按站立规则做开源复核打磨(不合并)。未动 PR #29 / #28–#12 与更早的 #4–#11。

**核过已过时 / 已在未合并 PR(本轮不重做)**:
1–17. 同 M3.94 所列 PR #12–#28。
18. PaneNode 自动重连禁用 / ForwardDialog busy / Android `requestReconnect` —— PR #29。
19. Android `leaveScreen` / disconnect 一次 —— PR #28;本轮只做门页信任与失败重试一次。
20. Sync 对话框 busy / SFTP 选区 prune —— PR #24 / #22 / #23;本轮只补 pack/delete busy。

**修了**:
1. **Android ConnectGate**:`HostKeyGate` `trustOnce`;失败态 `actOnce`(remember 提到函数顶、`remember(failure)` 复位),防双敲信任/重试叠握手。
2. **SftpDrawer**:`packDownloadSelected` 加 busy 闸;`delSelected` 确认后 busy + try/finally。
3. **TmuxDialog**:`attach` busy 重入闸;会话行与输入框 `:disabled`;`.tm-sess:disabled`。
# 会话记录:连续改进 M3.96(2026-10-30,复核打磨:公钥发布回收 finally + SFTP 下载 busy + HostInfo 连接/删除一次)

功能清单已够,本轮按站立规则做开源复核打磨(不合并)。未动 PR #30 / #29–#12 与更早的 #4–#11。

**核过已过时 / 已在未合并 PR(本轮不重做)**:
1–18. 同 M3.95 所列 PR #12–#29。
19. ConnectGate trustOnce/actOnce + SftpDrawer pack/del busy + TmuxDialog —— PR #30。
20. 回收公钥确认文案 —— PR #25;本轮只补 publish/revoke try/finally 与互斥 disabled(主分支尚无 confirm)。

**修了**:
1. **PublishKeyDialog**:`publish`/`revoke` 重入闸 + try/finally;按钮互斥 disabled(抛错不再卡死)。
2. **SftpDrawer** `downloadSelected`:busy 闸 + try/finally(与 pack 对称;未动 pack/del/sync)。
3. **Android HostInfo HostActions**:`actOnce` 包住连接与确认删除,防双推终端 / 双删。
# 会话记录:连续改进 M3.97(2026-10-30,复核打磨:备份 finally + SFTP 跨栏 busy + 首页滑动确认删除一次)

功能清单已够,本轮按站立规则做开源复核打磨(不合并)。未动 PR #31 / #30–#12 与更早的 #4–#11。

**核过已过时 / 已在未合并 PR(本轮不重做)**:
1–19. 同 M3.96 所列 PR #12–#30。
20. PublishKeyDialog finally + SftpDrawer downloadSelected busy + HostActions actOnce —— PR #31。

**修了**:
1. **SettingsDialog** `backupNow`:重入闸 + try/finally(抛错不再卡死备份按钮)。
2. **SftpDrawer** `uploadLocalSelection` / `downloadSelectionToLocal`:busy 闸 + try/finally(跨栏箭头;未动 downloadSelected/pack/del/sync)。
3. **Android HomeScreen SwipeActions**:确认删除 `deleteOnce` + 关合重置,防双删。
# 会话记录:连续改进 M3.98(2026-10-30,复核打磨:主机删除 busy + 主锁 unlock/disable/reset lockBusy + 编辑页确认删除一次)

功能清单已够,本轮按站立规则做开源复核打磨(不合并)。未动 PR #32 / #31–#12 与更早的 #4–#11。

**核过已过时 / 已在未合并 PR(本轮不重做)**:
1–20. 同 M3.97 所列 PR #12–#31。
21. backupNow finally + SftpDrawer 跨栏 upload/download busy + HomeScreen SwipeActions deleteOnce —— PR #32。

**修了**:
1. **HostsPage** `remove`:removing 闸 + try/finally(未动 connectingId / connect / duplicate)。
2. **SettingsDialog** `unlockNow` / `disableMasterLock` / `resetMasterLock`:共用 lockBusy + unlock/reset 按钮 disabled(未动 backupNow / accent / saveMasterLock)。
3. **Android HostEditorScreen**:确认删除 `deleteOnce`(Sessions 在 swipe/HostActions 之外)。
# 会话记录:连续改进 M3.99(2026-10-30,复核打磨:检查更新 finally + 本地 SFTP 删除 busy + 片段确认删除一次)

功能清单已够,本轮按站立规则做开源复核打磨(不合并)。未动 PR #33 / #32–#12 与更早的 #4–#11。

**核过已过时 / 已在未合并 PR(本轮不重做)**:
1–21. 同 M3.98 所列 PR #12–#32。
22. HostsPage remove busy + Settings lockBusy unlock/disable/reset + HostEditor deleteOnce —— PR #33。

**修了**:
1. **SettingsDialog** `checkForUpdates`:try/finally 清 `checking`(未动 lock/backup/accent)。
2. **SftpDrawer** `localDelete` / `localDelSelected`:共用 busy 闸 + try/finally(本地栏;未动远程 upload/download/pack/del)。
3. **Android Snippets**:确认删除 `deleteOnce`(Sessions 在 HostEditor 删除之外)。

**验证**:`typecheck` + vitest **334** / 30 文件全绿。未跑 Gradle。未合并。
# 会话记录:连续改进 M3.100(2026-10-30,复核打磨:SFTP 新建/重命名失败还原编辑器 + 终端日志失败提示 + 滑动删除无障碍两步确认)

功能清单已够,本轮按站立规则做开源复核打磨(不合并)。未动 PR #34 / #33–#12 与更早的 #4–#11。本轮优先实质逻辑/状态/无障碍/i18n,未再堆 busy 闸。

**核过已过时 / 已在未合并 PR(本轮不重做)**:
1–22. 同 M3.99 所列 PR #12–#33。
23. checkForUpdates finally + local SFTP delete busy + Snippets deleteOnce —— PR #34。

**修了**:
1. **SftpDrawer** `commitCreate` / `commitRename`:API 失败时还原 inline 编辑器与已输入名并 `focusEdit`(避免只剩横幅、名字丢光)。
2. **TerminalView** `toggleLog`:非取消失败 toast;`term.logFail` 三语补齐。
3. **Android HomeScreen SwipeActions**:TalkBack 删除与视觉一致两步确认(第一下 `confirming`,第二下才 `onDelete`)。
# 会话记录:连续改进 M3.101(2026-10-30,复核打磨:断线清 logOn + 忘记主机密钥确认 + HostEditor 保存一次)

功能清单已够,本轮按站立规则做开源复核打磨(不合并)。未动 PR #35 / #34–#12 与更早的 #4–#11。本轮优先实质逻辑/状态/无障碍/i18n。

**核过已过时 / 已在未合并 PR(本轮不重做)**:
1–23. 同 M3.100 所列 PR #12–#34。
24. SFTP create/rename 失败还原编辑器 + toggleLog 失败 toast + TalkBack 两步删除 —— PR #35。
25. RESERVED_CHORDS / downloadMany cancel 返回 —— 已在 main。

**修了**:
1. **TerminalView**:`watch` pane `status !== 'connected'` 时清 `logOn`(主进程断线已 stopLog,菜单徽章不再挂着「停止记录」)。
2. **SettingsDialog** `forgetKnownHost`:危险确认 + `set.sec.forgetConfirm` 三语(误点 X 不再静默抹掉信任)。
3. **Android HostEditorScreen** `save()`:`saving` 闸 + try/finally(✓ / Ctrl+S / onDone 并发不再双存双跳)。
# 会话记录:连续改进 M3.102(2026-10-30,复核打磨:续传上传保留失败项 + 片段删除确认 + 本机新建防双提交)

功能清单已够,本轮按站立规则做开源复核打磨(不合并)。未动 PR #36 / #35–#12 与更早的 #4–#11。本轮优先实质逻辑/状态/i18n。

**核过已过时 / 已在未合并 PR(本轮不重做)**:
1–24. 同 M3.101 所列 PR #12–#35。
25. logOn 断线清除 + forgetKnownHost 确认 + HostEditor save 闸 —— PR #36。

**修了**:
1. **SftpDrawer** `resumePending` + store `setTransferQueue`:失败(非取消)的上传保留在队列,与 `resumeDownloads` 对称;部分失败后 `showResume` 同时看两队列。
2. **SettingsDialog** `deleteSnippet`:危险确认 + `set.gen.snipDeleteConfirm` 三语。
3. **SftpDrawer** `localSubmit`:`localSubmitting` 闸 + OK 按钮 disable(防双建/双改名)。
# 会话记录:连续改进 M3.103(2026-10-30,复核打磨:历史重试跳过覆盖确认 + 主机编辑保存闸 + 清空传输历史确认)

功能清单已够,本轮按站立规则做开源复核打磨(不合并)。未动 PR #37 / #36–#12 与更早的 #4–#11。本轮优先实质逻辑/状态/i18n。

**核过已过时 / 已在未合并 PR(本轮不重做)**:
1–25. 同 M3.102 所列 PR #12–#36。
26. resumePending 保留失败上传 + deleteSnippet 确认 + localSubmit 闸 —— PR #37。

**修了**:
1. **SftpDrawer** `retryHistory`:向 `downloadTo` 传 `overwriteLocal: true`(与 `resumeDownloads` 同策;用户已选过目标目录,不再弹覆盖确认)。
2. **HostEditor** `save()`:`saving` 闸 + try/finally + 按钮 disable/「保存中…」(桌面与 Android #36 对齐,防双写双关)。
3. **SftpDrawer** `clearHistory`:危险确认 + `sfp.clearHistConfirm` 三语。
# 会话记录:连续改进 M3.104(2026-10-30,复核打磨:OpenSSH 导入反馈 + Android 命名/确认对话框防双提交)

功能清单已够,本轮按站立规则做开源复核打磨(不合并)。未动 PR #38 / #37–#12 与更早的 #4–#11。本轮优先实质逻辑/状态/无障碍/i18n。

**核过已过时 / 已在未合并 PR(本轮不重做)**:
1–26. 同 M3.103 所列 PR #12–#37。
27. retryHistory overwriteLocal + HostEditor saving + clearHistory 确认 —— PR #38。
28. keyGen busy / sync busy 等 —— 更早未合并 PR。

**修了**:
1. **OpenSSH 导入**:main ENOENT 返回稳定码 `missing-config`;Settings + CommandPalette toast 成功数/无新主机/缺失配置;`set.sec.importSsh*` 三语(不再吞失败、不再吐硬编码中文)。
2. **Android Files NameDialog**:`submitted` 闸,防回车+按钮双建/双改名。
3. **Android Tablet ConfirmDialog**:`confirmOnce`,防回车+按钮双删/双覆盖(Files/片段确认共用)。

**验证**:`typecheck` + `lint:i18n` + vitest **334** / 30 文件全绿。未跑 Gradle。未合并。
# 会话记录:连续改进 M3.105(2026-10-30,复核打磨:文件过大/预览 i18n + 片段防双存 + Android 主机密钥信任防双击)

功能清单已够,本轮按站立规则做开源复核打磨(不合并)。未动 PR #39 / #38–#12 与更早的 #4–#11。本轮优先实质逻辑/状态/无障碍/i18n。

**核过已过时 / 已在未合并 PR(本轮不重做)**:
1–28. 同 M3.104 所列 PR #12–#38。
29. OpenSSH 导入 toast + Android NameDialog/ConfirmDialog —— PR #39。
30. keyGen busy / sync busy 等 —— 更早未合并 PR。

**修了**:
1. **文件过大 / 预览错误 i18n**:`readTextFile` / `readBinaryFile` / `localReadText` 返回稳定码 `file-too-large` / `preview-too-large`;SftpDrawer 预览与对比、TextEditor、SessionReplay 映射到 `sfp.previewFail` / `sfp.previewTooLarge` / `sfp.fileTooLarge` 三语(英文界面不再见硬编码中文)。
2. **桌面片段保存**:`savingSnippet` + 先写死 `snippetForm.id`,防双击/双回车生成两个不同 id 的重复片段。
3. **Android HostKeyGate**:`trustOnce`,防回车+按钮双信任/双重连(Compose remember 置顶)。

**验证**:`typecheck` + `lint:i18n`(752) + vitest **334** / 30 文件全绿。未跑 Gradle。未合并。
# 会话记录:连续改进 M3.106(2026-10-30,复核打磨:本机文件名/发布密钥 i18n + Android 连接失败页防双触发)

功能清单已够,本轮按站立规则做开源复核打磨(不合并)。未动 PR #40 / #39–#12 与更早的 #4–#11。本轮优先实质逻辑/状态/无障碍/i18n。

**核过已过时 / 已在未合并 PR(本轮不重做)**:
1–29. 同 M3.105 所列 PR #12–#39。
30. file-too-large/preview i18n + snippet save-once + HostKeyGate trustOnce —— PR #40。
31. keyGen busy / sync busy 等 —— 更早未合并 PR。

**修了**:
1. **本机文件名无效**:localCreate/Rename/Delete 返回稳定码 `invalid-name`;SftpDrawer 新建/重命名/删除映射 `sfp.invalidName` 三语(英文不再见「文件名不能用」)。
2. **发布/回收公钥逐主机错误**:`withTempHosts` 用 `host-missing` / `app-locked` / `connect-failed`;PublishKeyDialog `hostOpError` + `keyPub.hostMissing|appLocked|connectFailed` 三语。
3. **Android ConnectGate 失败页**:`remember(failure)` + `actOnce`,防回车+重试/修复按钮双触发重连(不改 HostKeyGate)。

**验证**:`typecheck` + `lint:i18n`(753) + vitest **334** / 30 文件全绿。未跑 Gradle。未合并。
# 会话记录:连续改进 M3.115(2026-10-30,复核打磨:connection-lost / store 锁定·备份码 / friendlyError 机器码透传 / Android 片段防双存)

功能清单已够,本轮按站立规则做开源复核打磨(不合并)。未动 PR #49 `fix/review-polish-m3114` 与 #48–#12、#4–#11。本轮优先实质逻辑/i18n/状态,不堆 busy-gate。

**核过已过时 / 已在未合并 PR(本轮不重做)**:
1–N. 同 M3.114 所列 PR #12–#48,外加 #49 jump/proxy connect codes + passphrase-empty IPC。

**修了**:
1. **会话断开 i18n**:`ssh.ts` 两处 `连接已断开` → 稳定码 `connection-lost`;`sessions.applyEvent` 映射到已有 `app.sessionLost`(英文界面不再见硬编码中文)。
2. **主机备份/导出锁定码**:`store.ts` `exportJson`/`exportSshConfig`/`importJson` 抛 `app-locked` / `invalid-backup`;Settings 主机 JSON/SSH 导出导入 toast 映射 `app.locked` / `set.sec.invalidBackup`(三语补键);`lock.setPassphrase` 锁定态抛 `app-locked`(口令空仍留给 #49 IPC)。
3. **friendlyError 机器码透传**:kebab-case 码(如 `passphrase-empty`)不再被 `passphrase` 启发式改写成私钥文案;单测覆盖。
4. **Android 片段防双存**:`SnippetEditor` `saving` 闸,镜像 HostEditor M3.107。

**验证**:`typecheck` + `lint:i18n` + vitest **335** / 30 文件全绿(+1 friendlyError 透传用例)。未跑 Gradle。未合并。
# 会话记录:连续改进 M3.116(2026-10-30,复核打磨:pack tar 退出码 / sync 任务名 i18n / remote-exit)

功能清单已够,本轮按站立规则做开源复核打磨(不合并)。未动 PR #50 `fix/review-polish-m3115` 与 #49–#12、#4–#11。本轮优先实质逻辑/i18n。

**核过已过时 / 已在未合并 PR(本轮不重做)**:
1–N. 同 M3.115 所列 PR #12–#49,外加 #50 connection-lost / store app-locked·invalid-backup / friendlyError kebab / Android SnippetEditor save-once。

**修了**:
1. **P0 packAndDownload**:`execRemote` tar 非零退出仍去下载残缺归档 → 检查 `packed.code`,清理 tmp,返回稳定码 `pack-failed`;SftpDrawer 映射到已有 `sfp.packFail`。
2. **同步任务名 i18n**:进度完成名 `同步` → 机器码 `sync`;`formatTransferName` + TransferPanel / toast·notify·connLog 显示映射到 `sfp.sync`(历史仍存原始 token)。
3. **remote-exit:N**:`remoteExec` 非零退出码改为稳定码;PublishKeyDialog `mapError` + 三语 `keyPub.remoteExit`。

**验证**:`typecheck` + `lint:i18n` + vitest **337** / 30 文件全绿(+3 formatTransferName)。未跑 Gradle。未合并。
# 会话记录:连续改进 M3.145(2026-10-30,复核打磨:SFTP 上传失败 toast + 桌面信任防双击 + 删除跳板主机警告)

功能清单已够,本轮按站立规则做开源复核打磨(不合并)。未动 PR #4–#79(尤其 #79 auth_failed / oldFingerprint;#78 jump_missing;#77 SFTP rename/create/delete;#67 theme;#65/#64 host save/delete toast;#63/#62 forward remove / trust persist)。

**修了**:
1. **SFTP 上传失败可感知**:`uploadLocalSelection` / `uploadPick` / `uploadDirPick` / `onDrop` / `runDeploy` 在写 `error.value` 的同时 toast。并发成功上传触发的 `load()` 会清空 banner,以前看起来像没反应;下载路径早已 toast。
2. **桌面信任防重入**:`trustAndReconnect` 用 `trustingPanes` Set 挡住双击/回车+点击。Android HostKeyGate 自 M3.105 已有 `trustOnce`;本轮不改 `!ok` 仍 reconnect 的行为(#62 管 toast / 持久化顺序)。
3. **删除被当作跳板的主机要警告**:HostsPage / HostEditor 确认文案换 `hosts.deleteConfirmJump`;Android `HostActions` + 左滑 `SwipeActions(jumpUsedBy)` 用 `host_confirm_delete_jump`。只警告不拦删。

**验证**:`typecheck` + `lint:i18n`(桌面 750/750/750,移动端对称) + vitest **334** / 30 文件全绿。未跑 Gradle。未合并。本地 DeepSeek via ds.py tag `xssh-m3145-a`,HAND_APPLY 21/21,无 hand-fix。
# 会话记录:连续改进 M3.146(2026-10-30,复核打磨:批量跳板 fail-closed + 跳板候选 Android 对齐 + jump_needs_key)

功能清单已够,本轮按站立规则做开源复核打磨(不合并)。未动 PR #4–#80(尤其 #80 SFTP 上传 toast / trustingPanes / 删除跳板警告;#79 auth_failed;#78 jump_missing 于 ssh:connect / HostEditor jumpGone/jumpBlocked;#67 桌面主题持久化;#65/#64 主机存删 toast;#63/#62 转发移除;#106 withTempHosts 主机缺失/锁定码)。

**修了**:
1. **`withTempHosts`(发布/吊销密钥)跳板 fail-closed**:跳板已删不再悄悄直连;密码跳板无存密、密钥跳板无 keyPath 直接按主机推失败结果(交互连接路径早已有 `jump_needs_password`,批量路径以前没有)。
2. **HostEditor 跳板候选对齐 Android**:`jumpCandidates` 排除自身已设跳板的主机(只支持一层);遗留嵌套选择用 `host.jumpNested` 提示,可选框仍可清掉。
3. **桌面 `jump_needs_key`**:`ssh:connect` 在密钥跳板无 keyPath 时提前返回(对齐 Android `term_err_jump_no_key`);`sessions`/`i18n`/`types`/`reconnect.test` 一并接上。未改 #78 的 `jump_missing` 分支。

**验证**:`typecheck` + `lint:i18n`(桌面 751/751/751,移动端对称) + vitest **334** / 30 文件全绿。未跑 Gradle。未合并。本地 DeepSeek via ds.py tag `xssh-m3146-a`,HAND_APPLY 14/14,无 hand-fix。
# 会话记录:连续改进 M3.147(2026-10-30,复核打磨:HostEditor 密钥必选 + needs_key/needs_password + quietJump keyPath)

功能清单已够,本轮按站立规则做开源复核打磨(不合并)。未动 PR #4–#81(尤其 #81 withTempHosts / jumpCandidates / jump_needs_key;#80 SFTP 上传 toast / trustingPanes / 删除跳板警告;#79 auth_failed;#78 jump_missing;#67 桌面主题持久化;#65/#64 主机存删 toast;#63/#62 转发移除)。

**修了**:
1. **HostEditor 密钥认证必须先有私钥(对齐 Android `edit_err_no_key`)**:`canSave` / `saveBlockReason` 在 `auth === 'key'` 且无 `keyPath` 时禁用保存并提示 `host.keyRequired`;Enter 进 `save()` 时同样 toast,避免存下「看起来能连、一点就炸」的配置。
2. **桌面 `needs_key` / `needs_password`**:`ssh:connect` 在目标主机缺私钥或缺密码时提前返回(对齐 Android `term_err_no_key` / `term_err_no_password`),不再落到硬编码中文「未选择私钥文件」或笼统认证失败;`sessions` / `i18n` / `types` / `reconnect.test` 一并接上。未改 #81 的 `jump_needs_key` / #78 的 `jump_missing`。
3. **`quietJumpConfig` 密钥跳板无 keyPath 直接 null**:后台 OS 探测不再对缺私钥的跳板做一次必败登录并给地址记一周退避。

**验证**:`typecheck` + `lint:i18n`(桌面 752/752/752,移动端对称) + vitest **334** / 30 文件全绿。未跑 Gradle。未合并。本地 DeepSeek via ds.py tag `xssh-m3147-a`,HAND_APPLY 14/14,无 hand-fix。
# 会话记录:连续改进 M3.148(2026-10-30,复核打磨:加密私钥口令码 + HostEditor 保存拦截 + quiet 探测跳过)

功能清单已够,本轮按站立规则做开源复核打磨(不合并)。未动 PR #4–#82(尤其 #82 HostEditor keyRequired / needs_key / needs_password / quietJumpConfig keyPath;#81 withTempHosts / jump_needs_key;#80 SFTP upload / trustingPanes / delete jump warn;#79 auth_failed;#78 jump_missing;#67 theme;#65/#64 host save/delete;#63/#62 forward remove)。

**修了**:
1. **加密私钥口令有稳定错误码(Android KeyEncrypted 对齐)**:`passphraseConnectCode` → `needs_passphrase` / `bad_passphrase`;`connect` / `authConfig` catch / `connectJump` 带上 code;渲染层 i18n,不再只靠中文 friendlyError;自动重连在这两种 code 上停;network-online revive 测试补上。
2. **HostEditor 保存前拦截缺口令的加密托管密钥**:`passphraseProtected === true` 且无已填/已存口令时禁用保存并提示 `host.passphraseRequired`;生成带口令的密钥时把口令拷进主机字段(避免立刻又被挡)。
3. **quiet OS 探测跳过「加密且无口令」的密钥**:`keyLikelyEncrypted` + `quietParams` / `quietJumpConfig` 返回 null,避免把地址记进一周失败黑名单。

**验证**:`typecheck` + `lint:i18n`(桌面 752/752/752,移动端对称) + vitest **338** / 30 文件全绿。未跑 Gradle。未合并。本地 DeepSeek via ds.py tag `xssh-m3148-a`,HAND_APPLY 23/23,生成口令拷贝处有一处手修(关 modal 后清掉 keyModal 明文)。
# 会话记录:M3.149(静默失败收尾:历史导出 / SFTP 打包·解压·同步 / 多选下载)

> 分支 `fix/review-polish-m3149`(自 `origin/main`)。**不要合并**;开放 PR #4–#83 一律未动(尤其 #83 needs_passphrase / #82 keyRequired / #81 withTempHosts / #80 上传 toast / #79 auth_failed / #77 rename-create-delete / #76 单文件下载)。

这一轮只收「失败看起来和成功一样」的静默失败,不加功能。

- **历史搜索导出**(`HistorySearch.exportLog`):原来 `void window.api.history.export(text)`,主进程写盘失败(磁盘满 / 无权限)返回 `{ ok:false, error }` 时界面与成功完全一样 —— 保存对话框已经关了,屏幕上没有任何提示。现在 await 结果,`!ok && !canceled` 时 toast `r.error ?? hist.exportFail`;取消 / 成功不提示。三字典新增 `hist.exportFail`(导出失败 / Export failed / 匯出失敗)。
- **SFTP 打包下载 / 上传解压 / 增量同步**:失败原来只写 `error.value`,并发的 `load()` 会把它清掉(或用户根本没在看横幅),看着像没反应。现在与 #80 的上传一致:设 error 的同时 toast(`sfp.packFail` / `sfp.extractFail` / `sfp.syncFail`);持续同步的 `watchStart` 失败同样提示,成功不提示。
- **SFTP 多选下载**:`downloadMany` 的失败分支补 toast(`sfp.downloadFail`),与 `downloadSelectionToLocal` / `onLocalDrop` 一致。单文件 Save-As 分支(#76)未动。

验证:`npm run typecheck`、`npm run lint:i18n`、`npx vitest run`(≥334;`vitest.config.ts` 的 `singleFork` 未改)。

---
# M3.150 — 复核打磨(三处静默失败)

> 分支 `fix/review-polish-m3150`(自 `origin/main`)。**不合并**;PR #4–#84 全部未动(尤其 #84 历史导出 / 打包解压同步 / 多选下载提示、#83 needs_passphrase / HostEditor 加密密钥、#82 keyRequired、#81 withTempHosts / 跳板候选、#80 SFTP 上传 / onDrop / runDeploy、#79 auth_failed、#78 jump_missing、#77 重命名 / 新建 / 删除加载守卫、#76 单文件下载、#75–#72、#67 主题、#65/#64 主机保存 / 删除、#63/#62 转发移除、#58/#47 tmuxAttach、#54 sessions isCancelled、#42 editExternal / openWith、#39/#46 ssh-config 导入)。

## 修了什么(都是静默失败,不是新功能)

1. **SFTP「与本地对比」失败只有横幅**(`SftpDrawer.diffWithLocal`):远端读失败、本地读失败两条分支原来只写 `error`,而横幅会被下一次 `load()` 清掉 —— 和 #80/#84 的上传 / 打包提示同一类。现在两条分支都 `toast(msg, 'error')`;用户取消选文件(`!picked.ok || !picked.path`)仍然静默返回,不弹提示。
2. **图片预览失败是硬编码简体中文**(`SftpDrawer.previewFile`):`readBinary` 失败且没有 `error` 时,英 / 繁界面会显示「无法预览」。改成 `tt('sfp.previewFail')`,三份字典各加一条(zh 无法预览 / en Preview failed / zh-TW 無法預覽)。
3. **安卓 SFTP「前往路径」输入 `~` 时 `home()` 失败被吞**(`mobile/android/app/src/main/kotlin/dev/xssh/android/Files.kt`):原来只有 `onSuccess`,失败时对话框关掉、路径不变,看起来和成功一样。现在补 `onFailure`(跳过 `CancellationException`),用 `files.notify(FileText.of(R.string.files_cannot_read_folder, e.reason()), error = true)` 弹底部提示 —— 用户已经在浏览目录,不该整页变错误。复用现有字符串,没加新资源;首次加载 / 重试的 `home()` 路径未动。

## 验证

- `npm run typecheck`
- `npm run lint:i18n`(桌面三份字典仍对称)
- `npx vitest run`(期望 ≥334;`vitest.config.ts` 的 `singleFork` 不要改)

## 没做 / 有意搁置

- `fontSize` 未使用、桌面端 `local.home` 静默、StatusBar 配置 vs 实时、`setWindowOpenHandler` —— 都是有意保留的。
- 本轮只碰上面三处;上传 / onDrop / runDeploy、打包 / 解压 / 同步、downloadMany / 单文件下载、history.export、needs_passphrase / auth_failed / withTempHosts、主题 setPref、ForwardsPage、TransferPanel reveal、SettingsDialog 开关 / importSshConfig、App.vue editExternal / openWith、sessions.ts isCancelled、TmuxDialog 全部未动。
## M3.151 — 复核打磨:三处「失败看起来和成功一样」(分支 `fix/review-polish-m3151`)

> 只修静默失败,不加功能。**不要合并**;**不要碰已开的 PR #4–#85**(尤其 #85 SFTP diff toast / previewFail i18n / Android GoTo `~`;#84 历史导出 / pack/extract/sync/watchStart / 多选下载 toast;#83 needs_passphrase / HostEditor 加密私钥 / 静默 OS 探测;#82 keyRequired;#81 withTempHosts;#80 upload*/onDrop/runDeploy toast / trustingPanes / jump-delete warn;#79 auth_failed;#78 jump_missing;#77 rename/create/delete;#76 单文件下载;#74 TransferPanel reveal;#73/#75 prefs;#67 主题;#65/#64 主机保存/删除;#58 链接 toast;#54 isCancelled;#42 editExternal/openWith;#22 TextEditor 保存失败横幅)。

1. **Android 复制公钥失败完全静默**(`HostEditorScreen.kt` 的 `CredentialFields`):`draft.publicKey()` 返回 null(口令错 / 私钥不可用)时按钮什么都不做,和复制成功长得一模一样。补 `else { onMessage(publicKeyFailed) }`,新增字符串 `edit_public_key_failed`(values / values-zh / values-b+zh+Hant 三份对称)。生成密钥 / 导入 / 加锁开关那条路没动。
2. **Android SFTP 打开符号链接时 `isDir` 失败被吞成「当文件打开」**(`Files.kt` 的 `open()`):`runCatching { files.isDir(...) }.getOrDefault(false)` 把异常变成 false,目录符号链接会被当文件下载。改成 `onSuccess` / `onFailure`,失败时 `files.notify(FileText.of(R.string.files_open_failed, e.reason()), error = true)`(复用已有字符串),`CancellationException` 照旧不提示。`entry.isDir` / 非链接的 `files.open` / GoTo `~` 没动。
3. **桌面 SFTP `stopWatch` 假装成功**(`src/main/index.ts` + `SftpDrawer.vue`):主进程在 `sshManager` 为空时仍返回 `{ ok: true }`,渲染层无条件清 `watchActive` —— 药丸消失、其实什么都没停。主进程改成 `if (!sshManager) return { ok: false }`;渲染层只在 `r.ok` 时清状态,`!ok` 或抛异常时 toast `sfp.syncFail`(不新增 i18n 键)。`startSync` / `watchStart` / pack / extract 没动。

验证:
- 桌面:`npm.cmd run typecheck`、`npm.cmd run lint:i18n`、`npm.cmd run test`、`npm.cmd run build`
- 安卓:`./gradlew :app:assembleDebug`(或 `installDebug`);`npm.cmd run lint:i18n` 会跑 `lint-i18n-mobile.mjs`,三份资源必须对称
- 人工:安卓编辑页用错口令点「复制公钥」应看到「无法读取公钥」;桌面开连续同步后让 `sshManager` 失效(关窗 / 会话结束)再点停止,应弹 `sfp.syncFail` 而不是静默消失。
# M3.152 — 复制失败不再假装成功(2026-10-30)

> 分支 `fix/review-polish-m3152`(从 `origin/main` 切出)。**未合并**;PR #4–#86 一律没碰。

## 修了什么

1. **安卓终端「复制」在读不到选区文字时仍清掉选区**(`Sessions.kt` 的 `copySelection`)。`selectionText()` 返回 null 时原来照样 `selectClear()`,剪贴板没变、选区却没了 —— 看着像复制成功。现在签名改成 `onText: (String) -> Boolean`(true = 已写入剪贴板),取不到文字直接返回、不动选区;只有回调返回 true 才 `selectClear()` + `publishFrame()`。
2. **安卓 `copyText` 在剪贴板服务缺失时静默 return**(`Tablet.kt`)。改成返回 `Boolean`,四个调用点全部处理失败:
   - `TerminalScreen.kt` 的 `copySelection` 返回 Boolean,失败弹 `clipboard_unavailable` Toast;
   - `HostEditorScreen.kt` 的 `CredentialFields`(生成密钥 / 复制公钥)失败走 `onMessage(clipboardFailed)`(没有动 `publicKey()` 的 null-else,那是 #86);
   - `Files.kt` 的 `copyPaths`、`Ctrl+C`、右键「复制当前路径」失败走 `files.notify(..., error = true)`;
   - `Tablet.kt` 主机菜单「复制地址」失败弹 Toast。
   新增字符串 `clipboard_unavailable`(values / values-zh / values-b+zh+Hant 三份)。
3. **桌面主机编辑器删除密钥失败时静默**(`HostEditor.vue` 的 `deleteKey`)。原来只在 `r.error` 有值时才提示,`!r.ok` 且无 error 时什么都不说。现在 `else` 分支统一 `toast(r.error ?? t('host.keyDeleteFail'), 'error')`,三语言新增 `host.keyDeleteFail`。
# M3.153 — TransferPanel reveal 路径 + 粘贴/空表落盘 Toast(2026-10-30)

> 分支 `fix/review-polish-m3153`(从 `origin/main` 切出)。**未合并**;PR #4–#87 一律没碰。

## 修了什么

1. **桌面 TransferPanel「在文件夹中显示」下错路径且静默**(`TransferPanel.vue` 的 `reveal`)。下载完成项原来把 `h.localDir`(目录)交给 `revealLocal`,只打开文件夹、不选中文件;`SftpDrawer.revealHistory` 已用 `localJoin(h.localDir, h.name)`。现在对齐路径,并 `await` + 失败 toast `sfp.revealFail`(主线上 #74 只补了 toast、未修路径;本切片路径是新的)。
2. **安卓终端粘贴在剪贴板服务缺失时静默**(`TerminalScreen.kt`)。先取 `ClipboardManager`,为 null 时 Toast `clipboard_unavailable` 后返回;有服务但内容为空仍静默(无内容可粘)。`clipboard_unavailable` 三语言新增(与未合的 #87 文案一致)。
3. **安卓 `persist` 拒绝空表落盘只打 Log**(`MainActivity.kt`)。数据安全护栏拒绝用空内存覆盖非空磁盘时,补 Toast `hosts_persist_refused`(三语言),避免用户以为删/存成功。
# M3.154 — HostStore seal-fail toast + extract/pack empty i18n codes (2026-10-30)

> 分支 `fix/review-polish-m3154`(从 `origin/main` 切出)。**未合并**;PR #4–#88 一律没碰。

## 修了什么

1. **安卓 `HostStore.writeSecret` 封失败静默撒谎**(`HostStore.kt` / `MainActivity.kt`)。`Secrets.seal` / `writeLocked` 失败时沿用旧密文只打 `Log.w`,`save` 仍成功 → 用户以为新密码已存。现在 `save` 返回是否发生 seal 回退,`persist` 用 Toast `host_seal_failed`(三语言)说明"密码没存上,其他改动已保存"。空表拒绝落盘仍属 #88,未动。
2. **桌面 `extractArchive` 空 stderr 中文兜底**(`ssh.ts` / `SftpDrawer.vue`)。`out.trim() || '解压失败'` 让 EN UI 看到中文;改为机器码 `extract-failed`,渲染层映射到已有 `sfp.extractFail`。(#51 只改了 pack-failed;#84 只加 toast,未改此码。)
3. **桌面 `packAndDownload` 空列表中文**(`ssh.ts` / `SftpDrawer.vue` / `i18n.ts`)。`没有可打包的项` → 机器码 `pack-empty` + 新键 `sfp.packEmpty`(三语)。未动 #51 的 tar 退出码路径(主线尚无)。
# M3.155 — paste/clipboard toast + HistorySearch copyFail + SnippetStore commit (2026-10-30)

> 分支 `fix/review-polish-m3155`(从 `origin/main` 切出)。**未合并**;PR #4–#89 一律没碰。

## 修了什么

1. **安卓终端粘贴 / 拖放读剪贴板静默失败**(`TerminalScreen.kt`)。`primaryClip` / `coerceToText` 抛 `SecurityException`、或没有 `ClipboardManager` 时,粘贴 lambda 直接崩掉,看起来像"点了没反应"。现在 null CM / `SecurityException` → Toast `clipboard_unavailable`(三语言,与 #87/#88 同文案,主线尚无此键);空剪贴板仍静默。`onDrop` 同样包住。
2. **桌面 History 搜索复制假成功**(`HistorySearch.vue` / `i18n.ts`)。`clipboard.writeText` 是同步 void,抛错后仍 `toggleHistory(false)` 关对话框。现在 try/catch,失败 toast `hist.copyFail`(三语)并保持对话框打开。未动 `exportLog`(#84)。
3. **安卓命令片段保存用 `apply()` 假成功**(`Snippets.kt`)。`save` 改 `commit(): Boolean`;调用方先组 `next` 再落盘,成功才改内存/关编辑页,失败 Toast `snip_save_failed` / `snip_delete_failed` 并留在编辑页。
# M3.156 — 终端/SFTP 剪贴板失败不再静默 (2026-10-30)

> 分支 `fix/review-polish-m3156`(从 `origin/main` 切出)。**未合并**;PR #4–#90 一律没碰。

## 修了什么

1. **桌面终端复制失败静默**(`TerminalView.vue`)。`copySelection` / `copyFromMenu` / `copyOnSelect` 的 `clipboard.writeText` 原先无 try/catch;剪贴板锁住或超大时抛错 → 快捷键/右键复制/选中即复制看起来没反应。现在 try/catch + toast `term.copyFail`(三语言)。OSC 52 路径原本就有 catch,未动。
2. **桌面 SFTP「复制路径」失败静默**(`SftpDrawer.vue` 的 `copySelectedPaths`)。同样包 try/catch + toast `sfp.copyFail`。
3. **桌面终端粘贴 `readText` 失败静默**(`TerminalView.vue` 的 `pasteClipboard`)。`clipboard.readText` 抛错时 toast `term.pasteFail` 并返回;空剪贴板仍静默。
# M3.158 — HistorySearch/HostEditor 列表失败提示 + StatusBar 实时转发计数 (2026-10-30)

> 分支 `fix/review-polish-m3158`(从 `origin/main` 切出)。**未合并**;PR #4–#92 一律没碰。

## 修了什么

1. **桌面历史搜索加载失败静默**(`HistorySearch.vue`)。`history.list` 拒绝时对话框空列表读成「无匹配」。现 try/catch + toast `hist.loadFail`，空态可点 `hist.retry`。
2. **桌面主机编辑密钥列表失败静默**(`HostEditor.vue`)。`keys.list` 拒绝时下拉像「没有密钥」。现 try/catch + toast `host.keyListFail`，失败态可点重试。
3. **StatusBar 端口转发角标少计**(`StatusBar.vue` + `lib/forwards.ts`)。原先用 `pane.params.portForwards.length`（仅临时规则）；主机已保存规则由主进程连上时打开，从不进 params。现按 `forwardGroups` 的 `running` 行计数（`liveForwardCount`）。

## 验证

```
npm run typecheck
npm run lint:i18n
npm run test
```

安卓侧只改了 Kotlin(没动 Rust),`assembleDebug` / `installDebug` 照常;**没有在真机上点过**复制失败那条路(要造一个剪贴板服务不可用的环境)。
安卓侧只改了 Kotlin + strings(没动 Rust)。**没有在真机/模拟器上点过**剪贴板服务不可用与空表落盘护栏。
typecheck / lint:i18n / vitest **334** / 30 全绿。安卓只改了 Kotlin + strings(没动 Rust)。**没有在真机/模拟器上点过** seal 失败路径。
typecheck / lint:i18n / vitest **334** / 30 全绿。安卓只改了 Kotlin + strings(没动 Rust)。**没有在真机/模拟器上点过** 剪贴板拒绝 / 片段写盘失败路径。
typecheck / lint:i18n(桌面 752/752/752) / vitest **334** / 30 全绿。未在真机上模拟剪贴板锁定。

## 注意

- **不要合并**:这一批是 review 修复,等人工过一遍再合。
- 未触碰的开放 PR:#4–#86(尤其 #86 的 `publicKey()` null-else / symlink `isDir` / 桌面 `stopWatch`;#85 的 SFTP diff toast / `previewFail` / GoTo `~`;#84 的 history export / pack / extract / sync / multi-download;#83 passphrase;#60 log-start;#58 link;#42 editExternal;#40 preview i18n)。
- 未触碰的开放 PR:#4–#87(尤其 #87 的 copySelection/copyText;#86 publicKey/symlink/stopWatch;#85 diff/preview/GoTo;#84 export/pack;#74 TransferPanel reveal toast;#57 openExternal)。
- 未触碰的开放 PR:#4–#88(尤其 #88 TransferPanel reveal / paste / persist empty;#87 copySelection;#86 publicKey/symlink;#85 diff/preview;#84 export/pack toast;#51 pack-failed)。
- 未触碰的开放 PR:#4–#89(尤其 #88 TransferPanel reveal / paste CM-null / persist empty;#87 copySelection/copyText;#86 publicKey/symlink;#85 diff/preview;#84 export/pack toast)。`clipboard_unavailable` 文案与 #87/#88 对齐以便合并。
- 未触碰 `/workspace/MCode`。
- 未触碰的开放 PR:#4–#90(尤其 #90 HistorySearch.copyFail / Android paste SecurityException / Snippet commit;#87 Android copyText;#88 paste CM-null;#89 HostStore seal)。
- 未触碰 `/workspace/MCode`。未改 preload 剪贴板签名。
## 注意

- **不要合并**:这一批是 review 修复,等人工过一遍再合。
- 未触碰的开放 PR:#4–#92。未触碰 `/workspace/MCode`。未改 Android。
# M3.160 — 复核打磨(分支 `fix/review-polish-m3160`,基于 main @ 5946b1f,**勿合并**)

> 三条 P1 修复;只动 Windows + Android,不碰 macOS / iOS。

- **A(Android)侧边栏开关落盘失败不再翻转**:`UiPrefs.setSidebarVisible()` 用 `commit()` 的返回值报告是否写进磁盘,`Tablet.toggleSidebar()` 只在成功时改状态,失败弹 `tab_sidebar_persist_failed`(三语言)。
- **B(桌面)`loadKnownHosts` 失败不再炸连接流程**:加 try/catch 保留上一份列表(空列表会被读成"没有可信密钥",`hostKeyKnown()` 会把每台主机当成新的),只在 ok→fail 那一次弹 `set.sec.knownLoadFail`。
- **C(桌面)连接日志读取失败有内联提示**:`SettingsDialog.loadConnLog` 加 try/catch,`connLogError` 显示在卡片里并 toast `set.sec.connLogLoadFail`。
# M3.161 — 复核打磨(分支 `fix/review-polish-m3161`,基于 main @ 5946b1f,**勿合并**)

> 三条 P1 修复;只动 Windows + Android,不碰 macOS / iOS。

- **A(桌面)hosts.json 损坏不再静默变空表**:`HostStore.list()` 在 `hostsLoadFailed` 时抛 `hosts-load-failed`;`loadHosts` try/catch 保留上一份列表并 toast `hosts.loadFail`(只弹一次)。
- **B(Android)终端字体选择落盘失败回滚**:`UiPrefs.setTerminalFont` 用 `commit()`,`TerminalFontChoice.choose` 失败回滚并 toast `font_persist_failed`。
- **C(Android <13)语言选择落盘失败不 recreate**:`AppLanguages.apply` 返回 Boolean,失败 toast `lang_persist_failed` 并回滚勾选。
# M3.162 — 复核打磨(分支 `fix/review-polish-m3162`,基于 main @ 5946b1f,**勿合并**)

> 两条 P0/P1 修复;只动 Windows + Android,不碰 macOS / iOS。

- **A(桌面)secrets.bin 损坏不再静默变「未保存密码」**:`HostStore.secretsStatus()` + IPC;启动 toast `app.secretsLoadFail`;sshConnect 在无内联密码/口令且 vault bad 时返回 `secrets_load_failed`。
- **B(Android)主机列表 JSON 整段解析失败不再被空表覆盖**:`hasProtectedDiskData()` 护栏替换 `diskCount()>0`;`loadFailed` + toast `hosts_load_failed`。
# M3.163 — 复核打磨(分支 `fix/review-polish-m3163`,基于 main @ 5946b1f,**勿合并**)

> 两条 P0 修复;只动 Windows + Android,不碰 macOS / iOS。

- **A(桌面)settings.json 损坏不再被空表覆盖**:`SettingsStore.loadFailed` + `status()` IPC;启动 toast `app.settingsLoadFail`;双方 durable 都坏时 `set()` 拒绝写入。
- **B(Android)片段列表 JSON 解析失败不再被空表覆盖**:`hasProtectedDiskData()` + `loadFailed` toast `snip_load_failed`;`save` 改 commit 并拒空覆盖。

---
> **M3.164 — 分支 `fix/review-polish-m3164`(基于 main @ 5946b1f)· 请勿合并(do not merge)**
> - Windows 密钥库 `.labels.json` 改为 fail-closed:主文件与 `.bak` 都解析不出来时**不再用 `{}` 覆盖**,`generate` / `import` 直接拒绝;新增 `keys:labelsStatus` IPC,主机编辑页打开时提示一次。
> - 命令片段列表读取失败不再把列表清空(看起来像「没有片段」),保留旧列表并 toast `snip.loadFail`。
> - 主机编辑页密钥列表读取失败提示 `host.keyListFail`(PICK C)。
> - 仅 Windows 切片;未动 macOS / iOS / Android;未改 #63 的 `writeLabels(...).catch(...)` 与 generate/import 回滚。
> **M3.165(分支 `fix/review-polish-m3165`,基于 main @ 5946b1f)—— 请勿合并,待复核**
> - **A. `known_hosts.json` 损坏时 fail-closed**:`KnownHosts` 新增 `KnownHostsCorruptError`;`load()` 解析失败(主文件与 `.bak` 都读不出)时置 `loadFailed`,`set()` / `forget()` 在**改动内存 map 之前**直接抛错,`persist()` 在 `loadFailed` 且非 `force` 时拒绝写入 —— 旧逻辑只在 map 为空时跳过,信任一台新主机就会把 `{那一台}` 写回去、抹掉其余全部指纹。`importAll()`(用户主动的整份恢复)走 `persist(true)`,允许覆盖损坏文件并清掉 `loadFailed`。新增 `status()` 供主进程判断;`list()` 不抛错(设置页照常显示空列表)。
> - **B. 信任失败提示**:`ssh:trustHostKey` 返回 `{ ok, code?: 'corrupt' | 'rejected' | 'error', error? }`;渲染层 `trustAndReconnect` 按 `code === 'corrupt'` 弹 `app.trustFailCorrupt`(说明已拒绝写入、请修复或从备份恢复),其余弹 `app.trustFail`。`knownHosts:forget` / `ssh:forgetHostKey` 改为 `{ ok }` / `{ ok: false, error }`(与 #63 同形,便于合并),设置页删除失败会提示 `set.sec.forgetFail`。
> - 新增 `src/main/knownHosts.test.ts`(4 条:损坏时 set / forget 抛错且文件字节不变、`importAll` 可覆盖并清标志、正常 load 后 set 生效)。
> - 仅 Windows 这一片;未动 macOS / iOS / Android。
> **M3.166(分支 `fix/review-polish-m3166`,基于 main @ 5946b1f)—— 请勿合并,待复核**
> - **D. Android 空表落盘拒绝时 Toast**:`MainActivity.persist` 在 `diskCount()>0` 护栏命中时除 `Log.e` 外弹出 `hosts_persist_refused`(en/zh/zh-Hant)。不引入 `hasProtectedDiskData` / `loadFailed`(属 #97)。
> - **C. Windows 本机多选删除只弹一次失败 Toast**:`SftpDrawer.localDelSelected` 收集首个错误,循环后单次 `toast`,去掉 per-item + summary 的 N+1。
> - Windows + Android;未动 macOS / iOS。
# M3.167 — 复核打磨(分支 `fix/review-polish-m3167`,基于 main @ 5946b1f,**勿合并**)

> 三条 P1 修复;只动 Windows + Android,不碰 macOS / iOS。

- **A(Android)主机列表存盘改 commit**:`HostStore.save(): Boolean`;`persist` 仅在写入成功后更新内存,失败 toast `hosts_save_failed`(不重做 #101 拒空 toast / #97 loadFailed)。
- **B(Android)平板侧栏偏好改 commit**:`UiPrefs.setSidebarVisible`;失败回滚 UI + toast `sidebar_persist_failed`(不重做 #94 theme / #96 font)。
- **C(桌面)远程多选删除失败补单次 toast**:`SftpDrawer.delSelected` 收集 firstErr 后 toast 一次(不重做 #101 localDelSelected)。
# M3.168 — 复核打磨(分支 `fix/review-polish-m3168`,基于 main @ 5946b1f,**勿合并**)

> 两条 P1 修复;只动 Windows SFTP 抽屉,不碰 macOS / iOS / Android。

- **A(桌面)SFTP 重命名 / 新建失败可感知**:`commitRename` / `commitCreate` 在写 `error` 的同时 toast(`sfp.renameFail` / `sfp.createFail`)。`load()` 开头会清 banner,以前权限不够时像没反应。
- **B(桌面)SFTP 单文件下载失败可感知**:`downloadSelected` 的 Save-As 分支原先丢弃返回值;现在与多选路径一样 toast `sfp.downloadFail`(取消仍安静)。
# M3.169 — 复核打磨(分支 `fix/review-polish-m3169`,基于 main @ 5946b1f,**勿合并**)

> 三条 P1 修复;只动 Windows + Android,不碰 macOS / iOS。

- **A(桌面)SFTP chmod 失败可感知**:`PermDialog.apply` 在写 dialog `error` 的同时 toast(`sfp.permFail` / `sfp.permFailMany` / catch message)。关掉对话框后以前像没反应。
- **B(Android)SFTP 前往 `~` 失败可感知**:GoTo 对话框里 `files.home()` 失败原先无 `onFailure`(对话框关了像没点);现在 `files.notify(..., error = true)`,与列表加载失败一致。
- **C(桌面)密钥标签写入不再吞错**:`KeyManager.writeLabels` 去掉 `.catch(() => undefined)`,generate/import/remove 的写盘失败会冒泡到现有 toast。
# M3.170 — 复核打磨(分支 `fix/review-polish-m3170`,基于 main @ 5946b1f,**勿合并**)

> 一条 P1 + 两条 P2;只动 Windows + Android,不碰 macOS / iOS。

- **A(Android)复制公钥失败可感知**:`HostEditor`「复制公钥」在 `publicKey()` 返回 null 时原先无 `onMessage`(像没点);现在 `onMessage(edit_err_key_unusable)`,与生成密钥失败对称。
- **B(桌面)目录对比失败 toast**:`DirDiffDialog.run` 在写 dialog `err` 的同时 toast(`dirDiff.fail` / catch message)。关掉对话框后以前像没反应。
- **C(桌面)本地新建/重命名失败 toast**:`SftpDrawer.localSubmit` 在写 `localModal.error` 的同时 toast(`sfp.createFail` / `sfp.renameFail`),与远端 #103 对称。
# M3.171 — 复核打磨(分支 `fix/review-polish-m3171`,基于 main @ 5946b1f,**勿合并**)

- PublishKeyDialog: publish/revoke 失败在 dialog err 之外再 toast(keyPub.fail / revokeFail);不碰 #94 listFail。
- HostEditor generateKey: 失败 toast,与 importKey 对齐(保留 keyModal.error)。
- ForwardDialog add: 绑定失败 toast(fw.fail);badPort 仍只写 dialog err。
- 未合并。未动 #4–#105。
# M3.172 — 复核打磨(分支 `fix/review-polish-m3172`,基于 main @ 5946b1f,**勿合并**)

- TextEditor: SFTP load/save 失败在 inline error 之外再 toast(ed.loadFail / ed.saveFail)。
- SessionReplayDialog: 读失败 toast(replay.readFail);不碰 #40/#43 的 code→i18n 映射。
- ForwardsPage add: 直播绑定失败 toast(fw.fail);校验分支仍只写 page err;不碰 #76 saveHost catch。
- 未合并。未动 #4–#106。
# M3.173 — 复核打磨(分支 `fix/review-polish-m3173`,基于 main @ 5946b1f,**勿合并**)

- SftpDrawer load(): 目录 list 失败在 banner 之外再 toast(sfp.readDirFail / e.message)。
- previewFile: 预览失败 toast(同一字符串);不碰 #85 的 previewFail i18n 映射。
- refreshLocal: 本机目录读失败 toast(sfp.localErr);不碰 #94 local.home / #105 localSubmit。
- 未合并。未动 #4–#107。
# M3.174 — 复核打磨(分支 `fix/review-polish-m3174`,基于 main @ 5946b1f,**勿合并**)

- fontSize.ts: settings.set 拒绝时滚回字号并 toast `app.fontSizeFail`(zh/en/zh-TW);对齐 #77 zoom。未动 zoom.ts。
- Android UiPrefs.setTerminalFontSize: commit()+Boolean; TerminalScreen 捏合写盘失败回滚+toast `font_size_persist_failed`。未重做 #96 setTerminalFont/AppLanguage。
- SettingsDialog editor/openers 本轮未做。未合并。未动 #4–#108。

---

# X-SSH 交接文档

## M3.135(分支 `fix/review-polish-m3135`,**未合并**)

> 只做缺陷 / 界面打磨,**没有新功能**。`typecheck` / `lint:i18n` / vitest **334/334** 已绿;PR 未合并。

1. **`splitPane` 从不落盘**:`stores/sessions.ts` 的 `splitPane` 改了 `tab.layout` / `tab.panes` 并连接,却不像 `applyLayoutPreset` / `openConnection` / `closePane` 那样调 `persistTabs()` —— 开着「启动恢复上次标签」时,Ctrl+D / 标签栏分屏在下次启动会退回单窗格。已在焦点交接之后补 `this.persistTabs()`。
2. **拖分隔条不落盘**:`components/PaneNode.vue` 的 `onDividerDown` 每次 `pointermove` 都走 `store.resizePane`,但 `pointerup` 只摘监听 —— 松手后退出,下次恢复又回到拖动前的比例。现在在 `up` 里调一次 `store.persistTabs()`(只在松手时写,不在每次移动时写,避免刷爆 settings.json)。`resizePane` 本身没动。
3. **续传队列 / 传输历史静默回滚**:`queueUpload` / `queueDownload` / `setDownloadQueue` / `pushTransferHistory` 原来先改内存再 fire-and-forget `settings.set`,主进程返回 `{ ok: false }`(或抛错)时界面上的续传条 / 历史会显示下次启动就消失的条目(`setDownloadQueue` 更糟:以为消费掉的续传操作其实还留在磁盘上)。现在四个都先存 `prev`,失败或抛错时**静默回滚**,**不弹 toast**(后台 / 自动路径,与 #69 `addSftpRecent` 同类;#67 已经给用户主动的清空操作加了提示)。`clearTransferQueue` / `clearDownloadQueue` / `clearTransferHistory` / `removeTransferHistory` 属 #67,未动。

**状态说明**:#69–#12 这批 PR **都还没合并**,本分支也不包含它们;上面第 3 条只是沿用 #69 的「静默回滚」写法,不依赖它落地。
## M3.136（分支 `fix/review-polish-m3136`，**未合并**）
- 修复：`setActivePane` 持久化当前面板（`activeIndex`）；新增 `openTabsActiveIndex` 的保存/恢复，`setActive` / `nextTab` / `closeOthers` 同步持久化当前标签；`persistTabs` 失败时提示 `app.tabsPersistFail`。
- 说明：PR #70–#12 均未合并；本轮未重做 splitPane/divider、queue*、theme、setLang、addSftpRecent、applyLayoutPreset、openSnapshot、closeOthers 确认逻辑等既有改动。
> **M3.159(分支 `fix/review-polish-m3159`,基于 main @ 5946b1f,未合并)**:三个 P1 修复,只动 Windows + Android。
> - **A. 安卓外观切换**:`UiPrefs.themeMode` 的 setter 改走 `setThemeMode()`(`commit()` 并返回成败);`MainActivity` 的 `ThemeControl` 只在写入成功时才改 `mode` / 夜间模式,失败弹 `theme_persist_failed` 并保持旧主题(不再"界面变了、重启又回去")。三份 `strings.xml` 各加一条。
> - **B. 发布公钥对话框**:`keys.list()` 失败不再抛到控制台 —— 记 `keysFailed`、清空列表、toast `keyPub.listFail`,并在下拉框下给一个「重试」按钮(`keyPub.retry`,三字典)。
> - **C. SFTP 抽屉**:本机主目录 `local.home()` 失败时落到 `localError`(`sfp.localErr`),不再静默无反应。
> 未重做 #4–#93(尤其 HostEditor #93、HostStore.save #92)。**不要合并。**

> 移动端(Android/iOS,共享 Rust 核心 + 双原生 UI)的工作见 [`mobile/HANDOVER.md`](mobile/HANDOVER.md)。

# 会话记录:连续改进 M3.77(2026-10-30,复核打磨:TransferPanel 失败原因/ETA + Android 罚分重试下限)

功能清单已够,本轮按站立规则做开源复核打磨(不合并)。

**修了**:
1. **桌面 TransferPanel**:进行中失败/取消残留行会留在 Active 并显示可换行的失败原因(以前 `!error` 过滤把 4 秒残留直接藏掉);历史徽章只留短状态,原因另起 `.tp-err` 行;进行中行加 ETA(`formatEta` + `sfp.etaSec`/`sfp.etaMin` 三字典)。
2. **Android PerSourcePenalties**:移植桌面 `penaltyRetryDelayMs` —— `ReconnectPolicy.isRateLimited` / `penaltyRetryDelayMs`(30s),`delayMillis(attempt, lastError)` 取 max;首连 `retryInitialConnect` 的 delay 签名改为 `(attempt, error)`;`Sessions.reconnect` 把上次错误喂给下一次等待。单测覆盖罚分地板与首连捕获。

**验证**:桌面 `typecheck` + vitest(含 transferFormat);Android 单测文件已更新(本机若无 SDK 则 CI/`testDebugUnitTest` 再跑)。未合并。
# 会话记录:连续改进 M3.78(2026-10-30,复核打磨:已建会话重连罚分地板 + local/SOCKS forwardOut 超时)

功能清单已够,本轮按站立规则做开源复核打磨(不合并)。未动 PR #12 与更早的 #4–#11。

**核过仍真**:
1. 跳板机 `connectJump` 的 `forwardOut` 超时(**已在 main**,第十三批 `jumpForwardTimeoutMs`)——本轮不重做。HANDOVER「审核剩余未修」里那条过时。
2. **已建会话掉线后的自动重连缺 30s 罚分地板**(二次复核原注)——仍真:中途 `runConnect` 失败被 `!reconnectAttempt` 挡住,`result.retryDelayMs` 进不了下一轮等待。

**修了**:
1. **桌面重连罚分地板(中途)**:`nextReconnectFloorMs` + `Pane.reconnectMinDelayMs`;每次失败都记下地板;`scheduleReconnect` 取 `max(opts, pane)` 并在有地板时 keepError;成功 / 取消 / 密钥拒 / 用尽次数都清。中途罚分只补「将自动重试」文案、不 toast、不双重调度。
2. **local `-L` / SOCKS `-D` `forwardOut` 超时**:新字段 `forwardOutTimeoutMs`(默认 30s,`unref`);超时拆本地 socket(SOCKS 尽力回 `0x05 0x05`);晚到的回调不再 pipe。集成测:假 sshd 永不答 `tcpip`,`forwardOutTimeoutMs=200` 时本地客户端 5s 内被拆。

**验证**:`typecheck` + vitest **339** 全绿(原先 334;+`nextReconnectFloorMs` 与 local forward 超时)。未合并。
## HANDOVER M3.117 — review polish (upload cancel return / remote-forward dest timeout / channel-closed)

**Branch:** `fix/review-polish-m3117` (from origin/main). **Do NOT merge.** Open PR (see report).
**Skipped / do not redo:** PR #51 `fix/review-polish-m3116` (pack tar exit / sync name i18n / remote-exit) and #50–#12, #4–#11. Features / intentional deferrals / M3.77–M3.116 done items.

### Fixes shipped
1. **Cancelled upload returned ok:true** — `uploadJob` now returns `cancelled` (captured before job-id cleanup, same shape as `downloadJob`). All four IPC upload sites (`sftpUpload` / `uploadDir` / `uploadPaths` / `uploadExtract`) short-circuit on `r.cancelled`. Stops deploy toasting success and upload-extract falling through to `extractArchive` after the user cancelled mid-upload.
2. **Remote-forward (-R) dest.connect hang** — accepted remote channels piped to a black-holed local destination never timed out. 30s timer (local constant; does **not** add `forwardOutTimeoutMs` — PR #13 owns that for local/SOCKS) destroys both ends.
3. **Multiplex bridge write-after-close Chinese on EN UI** — `makeSocketBridge` throws `channel-closed` instead of `已关闭`; `sessions` maps it (and legacy Chinese) in `runConnect` + `applyEvent` error path; i18n `app.channelClosed` zh/en/zh-TW.

### Verify
- typecheck OK; lint:i18n OK (desktop 750/750/750); vitest **334**/30 green.
- Model: DeepSeek-V4.1-Flash-1017 via ds.py; thinking=off medium; 15/15 HAND_APPLY first try. No hand-fix. Incidents: none.

### Next
Continue continuous-improve from origin/main on a new branch; do **not** touch/merge this PR or #51–#12 / #4–#11. Prefer substantive P0/P1 over busy-gates.

---



# 会话记录:连续改进 M3.79(2026-10-30,复核打磨:密钥生成层焦点陷阱 + 命令面板遮罩回退 + 强调色样本 + 分组标签按下反馈)

功能清单已够,本轮按站立规则做开源复核打磨(不合并)。未动 PR #12 / #13 与更早的 #4–#11。

**核过已过时(本轮不重做)**:
1. SftpDrawer IME Enter / 本机 `localSeq` —— main 已有。
2. `recordChord` RESERVED_CHORDS(Mod+1..9 / Mod+c/v/f) —— main 已有。
3. 声明的模态 `useFocusTrap` + `focusTrapCoverage` —— main 已有(批量 14/15)。
4. 跳板 `forwardOut` 超时 / 下载取消 `ok:false` —— main 已有。

**修了**:
1. **HostEditor 生成密钥小层缺自己的焦点陷阱**:面板陷阱把 Tab 圈进整块 aside,用户在密钥名框里 Tab 会走进背后的主机表单。`keySheetEl` + `useFocusTrap(..., () => keyModal.open)` + `tabindex="-1"`(陷阱栈顶层生效)。
2. **CommandPalette 遮罩在密码/广播步骤直接关面板**:与 Esc「回退到搜索」不一致、误点丢流程。`onOverlayDown` 在 pending/broadcast 时清步骤并回焦搜索,否则才关面板。
3. **设置强调色样本在浅色主题仍显示暗色默认 `#6ea8fe`**:`accentSwatch` 按 `themeMode` 选 `#2f6fed` / `#6ea8fe`。
4. **连接页分组标签缺按下缩小**:`.gtabs button:active { transform: scale(0.97) }`。

**验证**:`typecheck` + vitest **334** 全绿(无新增用例)。未合并。

# 会话记录:连续改进 M3.80(2026-10-30,复核打磨:TransferPanel 暂停图标响应式 + Android 坏 SFTP 通道丢弃 + ForwardDialog Enter)

功能清单已够,本轮按站立规则做开源复核打磨(不合并)。未动 PR #14 / #13 / #12 与更早的 #4–#11。
# 会话记录:连续改进 M3.81(2026-10-30,复核打磨:snippet 发送前活会话复核 + known_hosts/片段删除确认 + ForwardsPage 切 mode 清错)

功能清单已够,本轮按站立规则做开源复核打磨(不合并)。未动 PR #15 / #14 / #13 / #12 与更早的 #4–#11。
# 会话记录:连续改进 M3.82(2026-10-30,复核打磨:快照恢复确认 + 关闭其他尊重 confirmClose + 侧栏按下缩小)

功能清单已够,本轮按站立规则做开源复核打磨(不合并)。未动 PR #16 / #15 / #14 / #13 / #12 与更早的 #4–#11。

**核过已过时 / 已在未合并 PR(本轮不重做)**:
1. TransferPanel 失败原因 / ETA —— PR #12。
2. Android PerSourcePenalties 30s 罚分地板 —— PR #12。
3. 桌面重连中途罚分地板 + local/SOCKS `forwardOut` 超时 —— PR #13。
4. HostEditor 密钥小层陷阱 / 命令面板遮罩回退 / 强调色样本 / 分组标签按下 —— PR #14。
5. M3.79 HANDOVER 里桌面「遗留」多数已在 main 或上述 PR。

**修了**:
1. **桌面 TransferPanel 暂停图标不更新**:`pausedIds` 原是普通 `Set`,Vue 3 不追踪;现 `ref<Set>` + `lib/transferPause.ts`(`toggleId` / `allPausedFlag` / `prunePaused`)每次替换 Set;`allPaused` 改 computed(有新任务或跑完即翻回);离开 active 的 id 会 prune;关闭按钮 `title` 改 `t('sfp.close')`。
2. **Android RemoteFiles 坏通道复用**:`withSftp` 在 `block` 抛错时若句柄仍是当前实例则清空并按 `reset()` 方式释放,下次重开。**手修**:换目录 cancel 上一次 `list` 的 `CancellationException` 不丢通道。
3. **桌面 ForwardDialog**:端口/主机框 Enter 提交(IME 守卫);切 mode 清掉过期 `err`。

**验证**:`typecheck` + vitest **343** 全绿(原 334;+`transferPause` 9)。Android:新增 `SftpHandle.kt` + `SftpHandleTest.kt`(本机无 SDK,未跑 `testDebugUnitTest`;CI / 有 SDK 时再跑)。未合并。
5. TransferPanel 暂停图标响应式 / Android 坏 SFTP 句柄丢弃 / ForwardDialog Enter —— PR #15。

**修了**:
1. **桌面 sendSnippet 对话框后仍往死会话打字**:确认 / 填变量 `await` 之后用 `liveSnippetSessionId` + `paneBySession` 复核原 `sid` 仍是 connected 且匹配,否则 toast `app.needLiveSession`;`lib/snippetSession.ts` + 5 条单测。
2. **设置 → 安全 known_hosts 删除无确认**:`forgetKnownHost` 先 `confirm(set.sec.forgetConfirm)`(danger)。
3. **设置 → 常规片段删除无确认**:`deleteSnippet` 先 `confirm(set.gen.snipDeleteConfirm)`(danger,带标题)。
4. **端口转发页切 mode 残留坏端口错**:`watch(() => form.mode, …)` 清 `err`(与 #15 ForwardDialog 同口径)。

**验证**:`typecheck` + `lint:i18n` + vitest **339** 全绿(原 334;+`snippetSession` 5)。Android 本轮未改。未合并。
5. TransferPanel 暂停图标响应式 / Android 坏 SFTP 句柄丢弃 / ForwardDialog Enter —— PR #15。
6. sendSnippet 活会话复核 / known_hosts·片段删除确认 / ForwardsPage 切 mode 清错 —— PR #16。

**修了**:
1. **命令面板恢复快照静默掐断活会话**:`openSnapshot` 在任一 pane `connected` 时先 `confirm(pal.snapRestoreConfirm)`(danger),取消则不动;`lib/snapshotGuard.ts` `hasLiveConnectedPane` + 单测。
2. **标签栏「关闭其他」绕过 confirmClose**:`closeOthers` 改 async,`closeOthersNeedsConfirm` 为真时一次确认并先对各活会话发 `exit`(与 `closeTabSafe` 同口径)。
3. **侧栏 nav / 底栏按钮缺按下缩小**:`AppSidebar` `.nav-item:active` / `.foot-btn:active` 补 `transform: scale(0.97)`(+ transition)。分组标签按下仍在未合并的 #14,本轮不碰 HostsPage。

**验证**:`typecheck` + `lint:i18n` + vitest **345** 全绿(原 334;+`snapshotGuard` 11)。Android 本轮未改。未合并。

## HANDOVER M3.107 — review polish (editExternal/openWith + backup import + Android HostEditor save)

**Branch:** `fix/review-polish-m3107` (from origin/main). **Do NOT merge.** Open PR (see report).
**Skipped / do not redo:** PR #41 `fix/review-polish-m3106` (invalid-name local FS / publish-revoke / ConnectGate actOnce) and #40–#12, #4–#11. Features / intentional deferrals / M3.77–M3.106 done items.

### Fixes shipped
1. **External edit / Open with silent fail + Chinese errors** — `sftpEditExternal` / `sftpOpenWith` return stable `invalid-name` / `program-not-allowed`; `App.vue` toasts via `openErr()` + `sfp.openFail|invalidName|programNotAllowed` (zh/en/zh-TW).
2. **Full-data import invalid backup + double-fire** — `importAll` → `invalid-backup`; Settings `exportAllData`/`importAllData` gated by existing `backupBusy` + disabled buttons; `set.sec.invalidBackup` i18n.
3. **Android HostEditor / HostSheet double save** — `saving` + try/finally around `buildHostForSave` in `HostEditorScreen.kt` and `Tablet.kt` `HostSheet` (not desktop HostEditor.vue — that was #38).

### Verify
- typecheck OK; lint:i18n OK (desktop 753/753/753); vitest **334**/30 green.
- Model: DeepSeek-V4.1-Flash-1017 via ds.py; thinking=off medium; 17/17 HAND_APPLY first try (applicator accepted BEFORE/END/AFTER/END). No hand-fix. Incidents: none.

### Next
Continue continuous-improve from origin/main on a new branch; do **not** touch/merge this PR or #41–#12 / #4–#11. Prefer substantive P0/P1 over busy-gates.

## HANDOVER M3.108 — review polish (path-invalid + reveal toast / no-public-key / nothing-to-pack)

**Branch:** `fix/review-polish-m3108` (from origin/main). **Do NOT merge.** Open PR (see report).
**Skipped / do not redo:** PR #42 `fix/review-polish-m3107` (editExternal/openWith / backupBusy / Android HostEditor+HostSheet saving) and #41–#12, #4–#11. Features / intentional deferrals / M3.77–M3.107 done items. Left `文件过大` size branches alone (#40).

### Fixes shipped
1. **path-invalid + TransferPanel silent reveal** — `localReadText` path check + `sftpRevealLocal` return `path-invalid`; SessionReplay / SftpDrawer diff+revealHistory map `sfp.pathInvalid`; TransferPanel `reveal()` awaits and toasts (was `void` swallow).
2. **no-public-key** — `keysPublicKey` / publish / revoke return stable code; PublishKeyDialog maps `keyPub.noPublicKey`.
3. **nothing-to-pack** — `packAndDownload` empty items → code; SftpDrawer maps `sfp.nothingToPack`.

### Verify
- typecheck OK; lint:i18n OK (desktop 752/752/752); vitest **334**/30 green.
- Model: DeepSeek-V4.1-Flash-1017 via ds.py; thinking=off medium; 24/24 HAND_APPLY after applicator fix for multi-hunk-under-one-FILE (first apply got only 7). No hand-fix of product code. Incidents: applicator miss logged, not a model fail.

### Next
Continue continuous-improve from origin/main on a new branch; do **not** touch/merge this PR or #42–#12 / #4–#11. Prefer substantive P0/P1 over busy-gates.

## HANDOVER M3.109 — review polish (key import codes / update-parse / history export toast)

**Branch:** `fix/review-polish-m3109` (from origin/main). **Do NOT merge.** Open PR (see report).
**Skipped / do not redo:** PR #43 `fix/review-polish-m3108` (path-invalid / no-public-key / nothing-to-pack) and #42–#12, #4–#11. Features / intentional deferrals / M3.77–M3.108 done items.

### Fixes shipped
1. **Key import/delete Chinese errors** — `keyManager` throws `invalid-private-key` / `illegal-key-id`; HostEditor `keyOpError()` maps to `host.invalidPrivateKey` / `host.illegalKeyId`.
2. **Update check parse fail** — `update-parse-failed` + Settings maps `set.gen.updateParseFail`.
3. **History export silent fail** — `exportLog` awaits result and toasts success/fail (`hist.exported` / `hist.exportFail`).

### Verify
- typecheck OK; lint:i18n OK (desktop symmetric); vitest **334**/30 green.
- Model: DeepSeek-V4.1-Flash-1017 via ds.py; thinking=off medium; 19/19 HAND_APPLY first try. No hand-fix. Incidents: none.

### Next
Continue continuous-improve from origin/main on a new branch; do **not** touch/merge this PR or #43–#12 / #4–#11. Prefer substantive P0/P1 over busy-gates.
## HANDOVER M3.110 — review polish (sync-list-failed / no-private-key / files-failed + cancelled flag)

**Branch:** `fix/review-polish-m3110` (from origin/main). **Do NOT merge.** Open PR (see report).
**Skipped / do not redo:** PR #44 `fix/review-polish-m3109` (key import/delete / update-parse / history export) and #43–#12, #4–#11. Features / intentional deferrals / M3.77–M3.109 done items.

### Fixes shipped
1. **Sync / dir-diff list fail** — `ssh.ts` throws `sync-list-failed`; SftpDrawer `sftpErr` + DirDiffDialog map to `sfp.syncListFailed` / `dirDiff.listFailed`.
2. **Key auth with no key path** — `authConfig` throws `no-private-key`; connect returns `code`; sessions maps `app.noPrivateKey`.
3. **Transfer partial-fail Chinese + cancelled flag** — main emits `files-failed:N` / `checksum-mismatch:N` and `CANCELLED_TEXT='cancelled'`; index IPC same; `formatTransferError` + `transferStatusText`; sessions uses shared `isCancelled` (prefers stamped `cancelled` flag, still accepts legacy `已取消`); TransferPanel history + notify/connLog map codes. i18n `sfp.filesFailed` / `sfp.checksumMismatch`.

### Verify
- typecheck OK; lint:i18n OK (desktop 754/754/754); vitest **336**/30 green (+2 transferFormat cases).
- Model: DeepSeek-V4.1-Flash-1017 via ds.py; thinking=off medium; 53/54 HAND_APPLY first try; 1 ambiguous SftpDrawer uploadFail×2 hand-finished. No product hand-fix. Incidents: applicator ambiguity only.

### Next
Continue continuous-improve from origin/main on a new branch; do **not** touch/merge this PR or #44–#12 / #4–#11. Prefer substantive P0/P1 over busy-gates.
## HANDOVER M3.111 — review polish (ssh-config import toast / window-not-ready / publish host codes)

**Branch:** `fix/review-polish-m3111` (from origin/main). **Do NOT merge.** Open PR (see report).
**Skipped / do not redo:** PR #45 `fix/review-polish-m3110` (sync-list / no-private-key / files-failed+checksum+cancelled) and #44–#12, #4–#11. Features / intentional deferrals / M3.77–M3.110 done items.

### Fixes shipped
1. **OpenSSH config import silent** — ENOENT → `ssh-config-missing`; SettingsDialog toasts fail/success (`set.sec.sshConfigMissing` / imported count).
2. **window-not-ready** — all `窗口未就绪`/`窗口尚未就绪` → code; `app.windowNotReady`; sessions `forwardError` + SftpDrawer `sftpErr` + PublishKey `pubErr`.
3. **Publish/revoke per-host Chinese** — `withTempHosts` → `host-missing` / `app-locked` / `connect-failed`; PublishKeyDialog maps via `pubErr`.

### Verify
- typecheck OK; lint:i18n OK (desktop 754/754/754); vitest **334**/30 green.
- Model: DeepSeek-V4.1-Flash-1017 via ds.py; thinking=off medium; 58/60 HAND_APPLY; 2 SftpDrawer upload/uploadDir NOMATCH hand-finished. No product hand-fix. Incidents: applicator miss on 2 anchors only.

### Next
Continue continuous-improve from origin/main on a new branch; do **not** touch/merge this PR or #45–#12 / #4–#11. Prefer substantive P0/P1 over busy-gates.
## HANDOVER M3.112 — review polish (delete-failed / extract-failed / sync-items-failed / tmux attach toast)

**Branch:** `fix/review-polish-m3112` (from origin/main). **Do NOT merge.** Open PR (see report).
**Skipped / do not redo:** PR #46 `fix/review-polish-m3111` (ssh-config import toast / window-not-ready / Publish per-host codes) and #45–#12, #4–#11. Features / intentional deferrals / M3.77–M3.111 done items.

### Fixes shipped
1. **SFTP partial delete Chinese** — `ssh.ts` throws `delete-failed:N`; SftpDrawer `sftpErr` → `sfp.deletePartial`.
2. **Archive extract fail code** — remote extract returns `extract-failed` (was Chinese/`stderr`); SftpDrawer maps via `sftpErr` → `sfp.extractFail`.
3. **Sync item failures** — sync emit `sync-items-failed:N`; TransferPanel `histStatus` + sessions `xferErr` → `sfp.syncItemsFailed`.
4. **Tmux attach always closed dialog** — await `tmuxAttach`, toast `tmux.attachFail` on `!ok`, only close on success (IPC already returns `{ok}` when sshManager missing).

### Verify
- typecheck OK; lint:i18n OK (desktop 752/752/752); vitest **334**/30 green.
- Model: DeepSeek-V4.1-Flash-1017 via ds.py; thinking=off medium; 23/23 HAND_APPLY clean. No product hand-fix. Incidents: none.

### Next
Continue continuous-improve from origin/main on a new branch; do **not** touch/merge this PR or #46–#12 / #4–#11. Prefer substantive P0/P1 over busy-gates.
## HANDOVER M3.113 — review polish (backup-not-configured / session-gone / remote-timeout / unsafe-filename)

**Branch:** `fix/review-polish-m3113` (from origin/main). **Do NOT merge.** Open PR (see report).
**Skipped / do not redo:** PR #47 `fix/review-polish-m3112` (delete-failed / extract-failed / sync-items-failed / tmux attach) and #46–#12, #4–#11. Features / intentional deferrals / M3.77–M3.112 done items.

### Fixes shipped
1. **backupNow conflated errors** — distinguish `backup-not-configured` vs `backup-failed`; Settings maps `set.sec.backupNotConfigured` / `set.sec.backupWriteFail`.
2. **SFTP session / timeout / unsafe name Chinese** — `session-missing` / `session-gone` / `remote-timeout` / `unsafe-filename`; SftpDrawer `sftpErr` + DirDiffDialog `diffErr`; connect.test expects `remote-timeout`.

### Verify
- typecheck OK; lint:i18n OK (desktop 755/755/755); vitest **334**/30 green.
- Model: DeepSeek-V4.1-Flash-1017 via ds.py; thinking=off medium; 41/41 HAND_APPLY clean. No product hand-fix. Incidents: none.

### Next
Continue continuous-improve from origin/main on a new branch; do **not** touch/merge this PR or #47–#12 / #4–#11. Prefer substantive P0/P1 over busy-gates.
## HANDOVER M3.114 — review polish (jump/proxy connect codes + passphrase-empty)

**Branch:** `fix/review-polish-m3114` (from origin/main). **Do NOT merge.** Open PR (see report).
**Skipped / do not redo:** PR #48 `fix/review-polish-m3113` (backup-not-configured / session-missing|gone|remote-timeout|unsafe-filename) and #47–#12, #4–#11. Features / intentional deferrals / M3.77–M3.113 done items.

### Fixes shipped
1. **Jump forward / connect Chinese** — `jump-forward-timeout` / `jump-connect-failed` via KeyError codes; sessions i18n; connect.test asserts code.
2. **HTTP/SOCKS5 proxy Chinese** — `proxy-handshake-timeout` / `socks5-*` / `http-proxy-failed`; connect() returns `code`; sessions maps seven `app.*` keys.
3. **Master-lock empty passphrase** — IPC `passphrase-empty`; Settings maps to `lock.passReq`.

### Verify
- typecheck OK; lint:i18n OK (desktop 758/758/758); vitest **334**/30 green.
- Model: DeepSeek-V4.1-Flash-1017 via ds.py; thinking=off medium; 17/17 HAND_APPLY clean. No product hand-fix. Incidents: none.

### Next
Continue continuous-improve from origin/main on a new branch; do **not** touch/merge this PR or #48–#12 / #4–#11. Prefer substantive P0/P1 over busy-gates.

---


## HANDOVER M3.118 — review polish (sync cancel return / waitForListen timeout / multi-item transfer name)

**Branch:** `fix/review-polish-m3118` (from origin/main). **Do NOT merge.** Open PR (see report).
**Skipped / do not redo:** PR #52 `fix/review-polish-m3117` (upload cancel return / -R dest.connect 30s / channel-closed) and #51–#12, #4–#11. Features / intentional deferrals / M3.77–M3.117 done items.

### Fixes shipped
1. **Cancelled sync returned ok:true** — `syncJob` now returns `{ cancelled, errors }` (cancel flag read before job-id cleanup). IPC `sftp:sync` returns `{ ok: false, canceled: true }` on cancel. `SftpDrawer.startSync` ignores cancel (same pattern as upload/download) so the drawer does not toast `sfp.syncFail`. Did **not** remap the `${errors} 项失败` progress emit (#47) or the `同步` job name (#51).
2. **addForward waitForListen hang** — `waitForListen` now settles false after 5s if neither `listening` nor `error` fires, so a stuck bind cannot leave the Forwards UI spinner forever. Does **not** touch `forwardOutTimeoutMs` (PR #13).
3. **Multi-file transfer name showed Chinese `N 项` on EN UI** — download/upload multi-item labels emit `items:N`; renderer `formatTransferName` (+ legacy `N 项`) localizes via `sfp.nItems` in TransferPanel + sessions toasts; history keeps the raw token. Sync name left alone (#51).

### Verify
- typecheck OK; lint:i18n OK; vitest **337**/30 green (+3 `formatTransferName`).
- Model: DeepSeek-V4.1-Flash-1017 via ds.py; thinking=off medium; 20/20 HAND_APPLY first try + 1 companion hand edit (`startSync` canceled gate). No hand-fix. Incidents: none.

### Next
Continue continuous-improve from origin/main on a new branch; do **not** touch/merge this PR or #52–#12 / #4–#11. Prefer substantive P0/P1 over busy-gates.
## HANDOVER M3.119 — review polish (pack download cancel / palette overlay / shared isCancelled)

**Branch:** `fix/review-polish-m3119` (from origin/main). **Do NOT merge.** Open PR (see report).
**Skipped / do not redo:** PR #53 `fix/review-polish-m3118` (sync cancel / waitForListen 5s / items:N) and #52–#12, #4–#11. Features / intentional deferrals / M3.77–M3.118 done items.

### Fixes shipped
1. **packAndDownload ignored downloadJob cancel/failures** — archive download cancel (or per-file failures) still returned `{ ok: true }`. Now returns `{ ok: false, canceled: true }` / failures error. Did **not** add tar exit check (#51 `pack-failed`).
2. **CommandPalette overlay vs Esc** — password / broadcast sub-views: overlay click now backs out like Esc instead of closing the whole palette.
3. **sessions Chinese-only isCancelled** — deleted the local `error === '已取消'` helper; import shared `transferFormat.isCancelled` (prefers stamped `cancelled` flag; TransferPanel parity). Did **not** rename CANCELLED_TEXT (#45).
## HANDOVER M3.120 — review polish (external-edit save notify / cleanup race / openPath fail)

**Branch:** `fix/review-polish-m3120` (from origin/main). **Do NOT merge.** Open PR (see report).
**Skipped / do not redo:** PR #54 `fix/review-polish-m3119` (pack download cancel / palette overlay / shared isCancelled) and #53–#12, #4–#11. Features / intentional deferrals / M3.77–M3.119 done items.

### Fixes shipped
1. **External-edit autosave silent failure** — `putFileSilent` errors after external-editor save were swallowed (`.catch(() => undefined)`). Now shows a localized OS notification (`editSaveFailTitle` / `editSaveFailBody` via `NL`/`dl`), honoring the notify toggle. No success spam.
2. **External-edit 30-min cleanup race** — teardown did not clear the 300ms debounce; a late timer could put against a deleted temp file. Added idempotent `stop()` + `editCleanups` map; 30-min timer and window `closed` both call it (clears debounce, unwatch, rm).
3. **editExternal / openWith ignore `shell.openPath` failure** — Electron returns an error string on failure; it was discarded and handlers returned `{ ok: true }` (and editExternal still started a watcher). Now cleanup temp dir and return `{ ok: false, error: friendlyError(…) }`. Did **not** add App.vue toasts / return codes (#42).

### Verify
- typecheck OK; lint:i18n OK; vitest **334**/30 green.
- Model: DeepSeek-V4.1-Flash-1017 via ds.py; thinking=off medium; 5/5 HAND_APPLY first try. No hand-fix. Incidents: none.

### Next
Continue continuous-improve from origin/main on a new branch; do **not** touch/merge this PR or #53–#12 / #4–#11. Prefer substantive P0/P1 over busy-gates.

---

Continue continuous-improve from origin/main on a new branch; do **not** touch/merge this PR or #54–#12 / #4–#11. Prefer substantive P0/P1 over busy-gates. Stale HANDOVER notes (download cancel unfixed / click.self overlay / recordChord reserved) are obsolete where covered by #12–#54.
## HANDOVER M3.121 — review polish (dragCache fail / dialog filter i18n / spawnDetached)

**Branch:** `fix/review-polish-m3121` (from origin/main). **Do NOT merge.** Open PR (see report).
**Skipped / do not redo:** PR #55 `fix/review-polish-m3120` (external-edit save notify / cleanup race / openPath fail) and #54–#12, #4–#11. Features / intentional deferrals / M3.77–M3.120 done items.

### Fixes shipped
1. **drag-out prefetch poison + temp leak** — failed `downloadTree` left a rejected promise in `dragCache` for 60s (retry blocked) and never `rm`'d the half-downloaded `xssh-drag-*` dir. Now try/catch `rm`s on failure, evicts the cache entry immediately, and identity-guards the expiry timer.
2. **Dialog filter labels hardcoded Chinese** — upload-extract `归档文件` and pick-executable `程序` → `NL`/`dl` (`filterArchive` / `filterExecutable`).
3. **spawn(external editor / open-with) ignored launch failure** — missing binary returned `{ ok: true }` (and edit still watched). New `spawnDetached` settles on `spawn`/`error`; cleans temp and returns `{ ok: false }`. Did **not** change openPath handling (#55) or App.vue toasts (#42).

### Verify
- typecheck OK; lint:i18n OK; vitest **334**/30 green.
- Model: DeepSeek-V4.1-Flash-1017 via ds.py; thinking=off medium; 7/7 HAND_APPLY first try. No hand-fix. Incidents: none.

### Next
Continue continuous-improve from origin/main on a new branch; do **not** touch/merge this PR or #55–#12 / #4–#11. Prefer substantive P0/P1 over busy-gates.
## HANDOVER M3.122 — review polish (localList fail / openExternal await / hist untitled)

**Branch:** `fix/review-polish-m3122` (from origin/main). **Do NOT merge.** Open PR (see report).
**Skipped / do not redo:** PR #56 `fix/review-polish-m3121` (dragCache fail / dialog filter i18n / spawnDetached) and #55–#12, #4–#11. Features / intentional deferrals / M3.77–M3.121 done items.

### Fixes shipped
1. **localList swallows FS errors → empty pane** — `IPC.localList` catch returned `{ path, entries: [] }` on EACCES/ENOENT, so the drawer looked empty with no banner. Rethrow so `refreshLocal` catch shows `sfp.localErr`. Early `!resolved` / `!st.isDirectory()` returns unchanged.
2. **openExternal false success** — handler returned `true` before `shell.openExternal` settled and swallowed rejections. Now `async`, `await`, fail-closed (`false` on reject). http/https allow-list unchanged.
3. **historyList fallback label hardcoded Chinese** — `s.label ?? '会话'` leaked into EN UI (HistorySearch host filter / rows / export). Machine missing-label is `''`; display uses new `hist.untitled` (zh/en/zh-TW) via `displayLabel`, mapping legacy `'会话'` too. Filter `:value` stays raw.
## HANDOVER M3.123 — review polish (tmuxAttach fail-closed / reveal access / link open toast)

**Branch:** `fix/review-polish-m3123` (from origin/main). **Do NOT merge.** Open PR (see report).
**Skipped / do not redo:** PR #57 `fix/review-polish-m3122` (localList rethrow / openExternal fail-closed / hist.untitled) and #56–#12, #4–#11. Features / intentional deferrals / M3.77–M3.122 done items.

### Fixes shipped
1. **tmuxAttach false success** — `tmuxAttachOrCreate` returned void and IPC always `{ ok: true }` when sshManager existed, even with no session/stream (silent no-op). Now returns `boolean`; IPC propagates so #47's `tmux.attachFail` toast can fire.
2. **revealLocal missing path** — `showItemInFolder` does not throw for deleted downloads; handler now `access`es first and fail-closes so SftpDrawer history reveal toast fires.
3. **Terminal link open silent fail** — `openLink` ignored `openExternal` false/reject. Toast `term.linkOpenFail` (zh/en/zh-TW).

### Verify
- typecheck OK; lint:i18n OK (750/750/750 desktop); vitest **334**/30 green.
- Model: DeepSeek-V4.1-Flash-1017 via ds.py; thinking=off medium; 10/10 HAND_APPLY first try. No hand-fix. Incidents: none.

### Next
Continue continuous-improve from origin/main on a new branch; do **not** touch/merge this PR or #56–#12 / #4–#11. Prefer substantive P0/P1 over busy-gates.
Continue continuous-improve from origin/main on a new branch; do **not** touch/merge this PR or #57–#12 / #4–#11. Prefer substantive P0/P1 over busy-gates.

---


## HANDOVER M3.124 — review polish (connect-time forward bind fail-closed / remote addForward / update open toast)

**Branch:** `fix/review-polish-m3124` (from origin/main). **Do NOT merge.** Open PR (see report).
**Skipped / do not redo:** PR #58 `fix/review-polish-m3123` (tmuxAttach boolean / revealLocal access / term.linkOpenFail) and #57–#12, #4–#11. Features / intentional deferrals / M3.77–M3.123 done items. Do not change `waitForListen` body (#53 owns timeout).

### Fixes shipped
1. **Connect-time port forwards silent success** — `openForwards` now awaits local/dynamic `waitForListen` and remote `forwardIn`; failed binds are closed/dropped (not concatenated into `forwardServers`). SSH still connects; `ConnectResult.code = 'forward:in-use'` + `error` = failed ports; renderer toasts `fw.connectBindFail`.
2. **Runtime remote `addForward` always ok** — remote mode returned `[]` from `openRule`, so `forwardIn` failures were swallowed and `runtimeRules` still recorded. Now awaits `openRemoteForward` and returns `in-use` on failure.
3. **Settings update download ignores openExternal fail** — toast `set.gen.updateOpenFail` when `openExternal` returns false.

### Verify
- typecheck OK; lint:i18n OK (751/751/751 desktop); vitest **334**/30 green.
- Model: DeepSeek-V4.1-Flash-1017 via ds.py; thinking=off medium; 16/16 HAND_APPLY first try. No hand-fix. Incidents: none.

### Next
Continue continuous-improve from origin/main on a new branch; do **not** touch/merge this PR or #58–#12 / #4–#11. Prefer substantive P0/P1 over busy-gates.
## HANDOVER M3.125 — review polish (session-log write stuck / log-start toast / tmuxList fail-closed)

**Branch:** `fix/review-polish-m3125` (from origin/main). **Do NOT merge.** Open PR (see report).
**Skipped / do not redo:** PR #59 `fix/review-polish-m3124` (connect-time forward bind / runtime forwardIn / updateOpenFail) and #58–#12, #4–#11. Features / intentional deferrals / M3.77–M3.124 done items.

### Fixes shipped
1. **Session-log write error leaves logging stuck** — `startLog` write-stream `error` cleared `logging` but kept `logWrite`, so a later start always returned false until Stop. Now drops `logWrite` (when still this stream) and ends the broken stream.
2. **Start logging menu ignores failure** — `toggleLog` toasts `term.logFail` when main returns `{ ok: false }` and the dialog was not canceled.
3. **tmuxList failure looks like empty** — no longer swallow session-gone into `[]` / `tmux.empty`. Manager throws when session missing; IPC stops `.catch(() => [])`; TmuxDialog toasts `tmux.listFail`.

### Verify
- typecheck OK; lint:i18n OK (751/751/751 desktop); vitest **334**/30 green.
- Model: DeepSeek-V4.1-Flash-1017 via ds.py; thinking=off medium; 15/15 HAND_APPLY first try. No hand-fix. Incidents: none.

### Next
Continue continuous-improve from origin/main on a new branch; do **not** touch/merge this PR or #59–#12 / #4–#11. Prefer substantive P0/P1 over busy-gates.

---
## HANDOVER M3.126 — 备份/快捷键失败不再静默(修复,不合并)

分支 `fix/review-polish-m3126`(自 origin/main),**不要合并**;PR #4–#60 一律不碰(尤其 #60 startLog/logWrite/term.logFail/tmuxList、#59 连接期转发绑定/forwardIn/updateOpenFail、#58 tmuxAttach/revealLocal/term.linkOpenFail、#57 localList 重抛/openExternal await/hist.untitled)。只改 `src/main/index.ts` 与 `HANDOVER.md`,未新增功能。

- **A(P0)「立即备份」不再说谎**:`writeAutoBackupSync` 改为返回 `{ ok: true } | { ok: false; reason: 'disabled' | 'no-dir' | 'write' }`;`IPC.dataBackupNow` 按 reason 用 `dl()` 映射到 `backupDisabled` / `backupNoDir` / `backupWriteFail`。写盘失败(磁盘满/权限/目录没了)不再被说成「未启用或未选目录」,英文界面也不再弹中文。渲染层 `backupNow()` 原样显示 `r.error`,未改。
- **B(P1)定时备份写失败会通知**:`scheduleAutoBackup` 的定时器只在 `reason === 'write'` 且通知开启时弹 `backupWriteFailTitle/Body`;disabled / no-dir 静默(用户中途改设置属正常)。`backupTimer.unref?.()` 保留。
- **C(P1)启动时全局呼出快捷键注册失败会提示**:`applyGlobalShowHideFromSettings` 检查 `setGlobalShowHide` 的返回值,失败时弹 `globalShortcutFailTitle/Body`;不清除已保存的快捷键(冲突可能是临时的),`setGlobalShowHide` 与设置页保存路径未改。
- 新增 NL 键(zh / zh-TW / en):`backupDisabled`、`backupNoDir`、`backupWriteFail`、`backupWriteFailTitle`、`backupWriteFailBody`、`globalShortcutFailTitle`、`globalShortcutFailBody`。
## HANDOVER M3.127 — 主机密钥信任 / 转发移除的失败处理

分支 `fix/review-polish-m3127`(自 `origin/main`),**不合并**,跳过 #4–#61。

- **A(P0)信任主机密钥不再吞掉拒绝记录**:`SshManager` 新增非消费式 `matchesRejectedKey`;`IPC.sshTrustHostKey` 先用它做闸门,`knownHosts.load/set` 包进 try/catch(失败返回 `{ ok: false }`,不再抛成未处理的 IPC 错误),只有写入成功后才 `takeRejectedKey` 消费。之前先消费再写,写盘失败后第二次点「信任」只会得到 `{ ok: false }`,必须重连才能重新记录。
- **B(P0)「信任并重连」不再在信任失败时重连**:`sessions.trustAndReconnect` 在 `{ ok: false }` 时改为 toast `app.trustFail` 并直接返回;无 `hostKey` 的路径仍照旧重连,以便卡片刷新。
- **C(P1)状态栏转发对话框移除失败会提示**:`ForwardDialog.vue` 的 `remove` 改为 `await store.removeForward(...)`,失败时 toast `fw.removeFail`(与 `ForwardsPage` 一致),不再 fire-and-forget。
- **D** i18n 三语补齐 `app.trustFail` / `fw.removeFail`(zh / en / zh-TW 保持对称)。

未改动:`writeAutoBackupSync`、`scheduleAutoBackup`、`applyGlobalShowHideFromSettings`、`startLog`/`stopLog`、`tmuxListSessions`、`openForwards`/`addForward`/`waitForListen`、`localList`、`openExternal`、`revealLocal`、`tmuxAttachOrCreate`。
## HANDOVER M3.128 — 审查修复(键名写入失败 / 忘记主机密钥 / 转发删除)

分支 `fix/review-polish-m3128`(自 `origin/main`)。**不要合并**;跳过已开的 PR #4–#62(尤其 #62 / #61 / #60 / #59 / #58 / #57 / #47 / #44 / #55 / #56),本批不重复其改动。

- **A) 密钥标签写入失败不再被吞掉** — `src/main/keyManager.ts`:`writeLabels` 去掉 `.catch(() => undefined)`,磁盘满 / 权限错误会真正抛出;`generate` 与 `import` 在标签写入失败时回滚刚写入的密钥文件(私钥 + `.pub`)并抛出,避免「界面显示已命名、重启后变回 UUID」。`readLabels` 与 `remove` 的清理逻辑不变。
- **B) 忘记已知主机有了失败路径** — `src/main/index.ts` 的 `IPC.knownHostsForget` 改为返回 `{ ok }` / `{ ok: false, error }`;`src/preload/index.ts` 的 `knownHosts.forget` 返回类型同步;`SettingsDialog.forgetKnownHost` 失败时 toast(`set.sec.forgetFail`)且不再刷新列表。
- **C) 端口转发页删除规则不再「假成功」** — `ForwardsPage.vue` 的 `remove`:运行中的规则若 `removeForwardFrom` 失败,toast(`fw.removeFail`)并直接返回,不再把主机配置里的规则删掉(此前监听仍在、下次连接又不会开、且无提示)。
- **D) i18n** — `zh` / `en` / `zh-TW` 三语同步新增 `set.sec.forgetFail`、`fw.removeFail`。
## HANDOVER M3.129 — 设置写失败不再假装成功 / 快照回滚 / 删除主机失败提示

分支 `fix/review-polish-m3129`(从 `origin/main` 切出),**不合并**;跳过 #4–#63 的开放 PR(尤其 #63 writeLabels / knownHostsForget / ForwardsPage、#62 matchesRejectedKey / trustFail / ForwardDialog、#61 AutoBackupResult、#60 logWrite / tmuxList、#59 forwards / updateOpenFail、#58 linkOpenFail / revealLocal / tmuxAttach、#57 localList / openExternal、#55/#56/#47/#44/#43 TransferPanel reveal)。只做实质缺陷与 UI 打磨,不加功能。

- **A(P0)设置写盘失败不再被吞**:`SettingsStore.set` 原来把写失败 `.catch` 成一条日志、返回的 promise 照样 resolve,IPC `settings:set` 于是回 `{ ok: true }` —— 渲染层乐观更新、用户以为存住了,下次启动又变回旧值。现在 `set` 返回的 `op` 会 reject(调用方 / IPC 看得到),队列本身用 `op.catch(...)` 续上,一次磁盘错误不会堵死后面所有键;`settings:set` 捕获后回 `{ ok: false, error: 'settings-write-failed' }`(不让 invoke 直接 reject,渲染层本来就按 `ok` 分支)。主进程两处 fire-and-forget(`windowBounds`、`sessionHistory`)补 `.catch(() => undefined)`,避免变成未处理的 rejection。`settings.test.ts` 新增一条:写失败时 reject、之后 `set` 仍能成功、`flush()` 不重抛(用可切换的 `writeDurable` 桩 —— chmod 在 Windows 上对目录无效,不能拿它造失败)。
- **B(P1)快照保存 / 删除失败回滚**:`saveSnapshot` / `deleteSnapshot` 先改内存再写盘、且不看返回值 —— 主进程拒绝该键或写失败时界面照样显示快照。现在记下旧列表,`ok === false` 就回滚并 toast(`pal.snapFail` / `pal.snapDeleteFail`)。
- **C(P1)删除主机失败有提示**:`HostEditor.remove` 确认后直接 `await hosts.delete`,写盘失败时面板不关也没有任何说明。现在 try/catch,失败 toast `hosts.deleteFail` 并留在面板里(与 `save` 的 `ed.saveFail` 一致)。
- i18n 三个字典各加 3 个键(`pal.snapFail` / `pal.snapDeleteFail` / `hosts.deleteFail`),`npm.cmd run lint:i18n` 需保持对称。
## HANDOVER M3.130 — 主机删除/保存失败提示 + SFTP 书签回滚

> 分支 `fix/review-polish-m3130`(自 `origin/main`)。**不要合并**;跳过 #4–#64 的开放 PR(尤其 #64 的 SettingsStore.set / settings-write-failed / snapshot rollback / HostEditor.deleteFail、#63 的 writeLabels / knownHostsForget / ForwardsPage.removeFail)。

- **A) `store.removeHost` 不再静默**:`window.api.hosts.delete` 在主进程写 hosts 文件失败时 reject,连接页菜单的删除原来没有 try/catch —— 卡片留着、什么都不说(未处理的 rejection)。现在 catch 后 toast `hosts.deleteFail`。`HostEditor.vue`(#64)未动。
- **B) `store.saveHost` 不再静默**:写失败时 toast `hosts.saveFail` 并 `throw new Error('hosts-save-failed')`,让已经 try/catch 的调用方(端口转发页删除)照常中止,`duplicateHost` 也不会假装副本已存在。
- **C) SFTP 书签回滚**:`toggleSftpBookmark` 原来是乐观更新 + 不看 `settings.set` 的返回值,主进程拒绝该键(或 #64 落地后持久化写失败)时星星照样翻,下次启动书签却没了。现在保存 `prev`,返回 `ok === false` 就回滚并 toast `sfp.bookmarkFail`。`addSftpRecent`(后台 MRU)有意不动。
- **D) i18n**:三份字典各加 `hosts.deleteFail` / `hosts.saveFail` / `sfp.bookmarkFail`(zh / en / zh-TW 对称)。
- 未动:`SettingsStore.set`、`settings.ts`、`IPC.settingsSet`、`saveSnapshot` / `deleteSnapshot`、`HostEditor.vue`、`ForwardsPage.remove`、`writeLabels`、`knownHostsForget`、`openExternal`、`localList`、`TerminalView` 的 openLink。未合并、未碰 MCode。
## HANDOVER M3.131 — 设置写盘失败不再装作成功(分支 `fix/review-polish-m3131`)

> 分支 `fix/review-polish-m3131`(自 `origin/main`),**不合并**。与 #4–#65 的开放 PR 无重叠:#65(removeHost / saveHost / bookmarkFail)、#64(SettingsStore.set / 快照回滚 / HostEditor.deleteFail)、#63(writeLabels / knownHostsForget / ForwardsPage)、#62(ForwardDialog)、#61(AutoBackup)、#60–#40(busy 门 / 片段保存一次 / TransferPanel / importSshConfig / openExternal / localList)全部未触碰。

这一轮只修「写盘失败却装作成功」这一类,不加功能:

- **A) 命令片段保存 / 删除**(`SettingsDialog.vue`):`store.saveSnippet` / `deleteSnippet` 走设置写盘,抛错时原来只有一条未处理的 rejection(删除完全静默)。现在两处都 try/catch,失败 toast `snip.saveFail` / `snip.deleteFail`,保存失败时表单保持打开。**没有**加保存中的 busy 门(#40 负责)。
- **B) 连接审计日志清空**(`main/index.ts` + `SettingsDialog.vue`):主进程 `connLogClear` 原来无条件 `{ ok: true }`;现在写失败返回 `{ ok: false }`(`SettingsStore.set` 目前仍吞错,#64 让它 reject 之后这条才真正生效)。渲染层拿到 `ok: false` 时 toast `set.sec.connLogClearFail` 并**不清空列表**,不再出现「界面说清空了、磁盘上还在」。
- **C) 外部编辑器 / 按扩展名打开程序**(`SettingsDialog.vue`):`pickEditor` / `clearEditor` / `upsertOpener` / `setOpenerProgram` / `removeOpener` 原来先改 store 再写盘、不看返回值 —— 用户以为存住了,下次启动就没了。现在检查 `r.ok === false`,toast `set.gen.writeFail`,并把已经改过的 `store.fileOpeners` 回滚到写盘前的快照。
- **D) i18n**:新增 `snip.saveFail` / `snip.deleteFail` / `set.sec.connLogClearFail` / `set.gen.writeFail`,zh / zh-TW / en 三份齐全(`npm.cmd run lint:i18n` 对称)。

未做 / 不在本轮:`SettingsStore.set` 本身是否 reject(#64)、快照回滚、`HostEditor`、`removeHost` / `saveHost`、书签、`writeLabels`、`knownHostsForget`、`ForwardsPage`、`openExternal`、`localList`、`App.vue` 的 `editExternal`、片段保存的 busy 门(#40)。**没有合并任何 PR,也没碰 `/workspace/MCode`。**

验证:`npm.cmd run typecheck`、`npm.cmd run lint:i18n`、`npm.cmd run build`。界面行为(toast 文案、回滚后的列表)**没有在运行中的应用里点过** —— 要造一次写盘失败才看得到。

## HANDOVER M3.132 — theme persist + SFTP queue/history fail-closed (PR open, NOT merged)

Branch: `fix/review-polish-m3132` from `origin/main`. Do **not** merge; do **not** touch open PRs #4–#66.

### Shipped
1. **theme:set fail-closed** — persist `theme` before `applyThemeSource`; return `{ ok, dark, error? }`. Renderer `setPref` toasts `app.themeFail` and leaves `pref` untouched on refuse/throw (no more “switch locally anyway”).
2. **Transfer history clear/remove** — rollback + `sfp.persistFail` toast when `settings.set` refuses/throws.
3. **Resume-queue discard** — same rollback/toast for `clearTransferQueue` / `clearDownloadQueue`; SftpDrawer discard buttons await and recompute `showResume` from both queues.

### Verify
- `npm run typecheck` / `lint:i18n` / `test` (expect ≥334).
- Manual: flip theme with settings file unwritable → toast, UI stays; discard resume bar with refused key → bar stays.

### Not in this PR
SettingsStore.set (#64), snippets/connLog/editor (#66), removeHost/saveHost/bookmark (#65), addSftpRecent, zoom/fontSize/lang, knownHostsForget, Terminal linkOpenFail, previewFail.
## HANDOVER M3.133 — snapshot/closeOthers confirmClose + saveSetting toast (PR open, NOT merged)

Branch: `fix/review-polish-m3133` from `origin/main`. Do **not** merge; do **not** touch open PRs #4–#67.

### Shipped
1. **openSnapshot honors confirmClose** — if any pane is connected, confirm once, send `exit`, then replace tabs.
2. **closeOthers honors confirmClose** — same for other tabs; async (TabBar `run` already tolerates it).
3. **saveSetting** toasts `set.gen.writeFail` and returns `boolean`; **setGlobalShowHide** rolls back in-memory accel + restores previous OS shortcut when persist fails.

### Verify
- `npm run typecheck` / `lint:i18n` / `test` (expect ≥334).
- Manual: enable confirm-on-close → open snapshot / close others with live tabs → dialog; refuse a settings key → toast; fail persist of global hotkey → field + OS shortcut revert.

### Not in this PR
theme/transfer (#67), snippets/connLog/editor (#66), hosts/bookmark (#65), SettingsStore/snapshots save (#64), addSftpRecent, lang/zoom/fontSize, applyLayoutPreset, TabBar.vue.
## HANDOVER M3.134 — layout preset confirmClose + lang persist + sftpRecent rollback (PR open, NOT merged)

Branch: `fix/review-polish-m3134` from `origin/main`. Do **not** merge; do **not** touch open PRs #4–#68.

### Shipped
1. **applyLayoutPreset honors confirmClose** — confirm + send `exit` + `cancelReconnect` before disconnecting other panes when any is connected.
2. **Language persist fail-closed** — removed fire-and-forget `watch(pref)`; `setLang` writes first, only then flips `pref`; toasts `app.langFail` on refuse/throw.
3. **addSftpRecent silent rollback** — memory restored when `settings.set` refuses/throws (no toast).

### Verify
- `npm run typecheck` / `lint:i18n` / `test` (expect ≥334).
- Manual: confirm-on-close + multi-pane → layout preset dialog; refuse lang write → UI stays; SFTP browse with refused sftpRecent → MRU unchanged.

### Not in this PR
openSnapshot/closeOthers/saveSetting (#68), theme/transfer clears (#67), bookmarks (#65), SettingsStore (#64), zoom/fontSize/sftpShowHidden, queueUpload, TabBar.vue.

---
## M3.137(分支 `fix/review-polish-m3137`,**未合并**)

- 分支 `fix/review-polish-m3137` 从 `origin/main` 切出,**未合并**。
- 修复(都是既有行为的小缺陷,不加新功能):
  - **历史「转到会话」不落盘 / 死会话静默无反应**:`focusSession` 改为返回 `boolean`,只有活动标签 / 面板真的变了才 `persistTabs()`(原来直接改 `activeId` / `activePaneId`、从不落盘,开着「启动恢复上次标签」时退出会把跳转前的标签恢复回来);`HistorySearch.pick` 在会话已关闭时 toast `hist.sessionGone`(原来照样关窗、什么都不发生)。
  - **SFTP 页「连接」失败无提示 / 面板焦点错**:`openSftpFor` 成功路径补 `setActivePane`(多面板标签不再把 SFTP 绑到第一个面板);连接失败时切回终端页并 toast 失败原因(原来停在 SFTP 选择页,错误卡片看不见)。
  - **`splitPane` 空面板崩溃**:加 `if (!src) return`(与 `applyLayoutPreset` 一致)。
  - i18n 新增 `hist.sessionGone`(zh / en / zh-TW 三份对称)。
- **未合并**:#71–#12、#4–#11 等开放 PR 均**未合并**;本分支不重做它们的内容(`setActivePane` / `persistTabs` 失败提示 / `splitPane` 的 `persistTabs` / `queue*` 静默回滚 / `removeTransferHistory` / `localList` / `isCancelled` 等仍归各自 PR)。
## M3.138(分支 `fix/review-polish-m3138`,**未合并**)

> 只做缺陷 / 界面打磨,不加功能。**#72–#12、#4–#11 的 PR 都还没合并**,这一批也不含它们。

- **`closePane` 的 confirmClose 绕过(P1)**:原来只有「标签里只剩一个面板」时才确认 + 发 `exit`,多面板分屏下 Ctrl+Shift+W / 面板 × 直接杀掉活会话,既没有对话框也没有优雅退出(只 `disconnect`)。现在只要 `confirmClose` 开着且该面板 `connected` 就确认,确认后先发 `exit\n` 再断开。设置里 `set.conn.confirmCloseDesc` 的文案本来就写的是「标签/面板」,代码现在才对齐。`closeTab` / `closeTabSafe` / `closeOthers` / `openSnapshot` / `applyLayoutPreset` 未动。
- **SFTP「显示隐藏文件」写盘失败会撒谎(P1)**:`toggleHidden` 原来是 `showHidden` 先翻、`void settings.set(...)` 不管结果 —— 主进程拒键或写盘失败时眼睛图标一直停在错的状态,直到重启才回退。现在 `async`,失败(`ok === false` 或抛错)回滚并 toast `sfp.showHiddenFail`(三字典新增)。
- **SFTP 抽屉宽度持久化失败静默(P1)**:`onResizeEnd` 拖完就 `void settings.set('sftpWidth', …)`,被拒时面板停在下次启动会跳回去的宽度。新增 `savedWidth`(最后一次确认落盘的值,初值 = 启动宽度),写入失败**静默回滚**(后台动作,不弹 toast)。`onResizeStart` / `onResizeMove` / `onWindowResize` 未动。
- 未触碰:`focusSession` / `openSftpFor` / `splitPane` 主体 / `setActive` / `setActivePane` / `persistTabs` / `nextTab` / `closeOthers` / `openSnapshot` / `applyLayoutPreset` / `queue*` / `clearTransfer*` / `removeTransferHistory` / `theme` / `setLang` / `addSftpRecent` / `saveSetting` / `zoom` / `fontSize` / `openExternal` / `localList` / `local.home` / `TerminalView` / `HostEditor` / `HostsPage` / `SettingsDialog` / `PaneNode` / `HistorySearch`。
- 仍按原计划搁置(归别处):`fontSize` 未使用、`zoom` 不持久化、`local.home` 静默、StatusBar 的 configured-vs-live 转发、`setWindowOpenHandler`、预览「无法预览」。
## M3.139(分支 `fix/review-polish-m3139`,**未合并**)

> 只做缺陷 / 界面打磨,不加功能。**#73–#12、#4–#11 的 PR 都还没合并**,这一批也不含它们。

- **侧栏 / 主机视图偏好写盘失败会撒谎(P1)**:`setSidebarCollapsed` / `setTermSidebarHidden` / `setHostsView` / `setHostsSort` 原来先改内存再 `void saveSetting`,主进程拒键或写盘失败时开关一直停在错的状态,直到重启才回退。现在直接 `settings.set`,失败回滚并 toast `set.gen.writeFail`。`setSidebarWidth` 松手落盘同理,失败**静默回滚**到 `savedSidebarWidth`(与 M3.138 的 `sftpWidth` 同款,不弹 toast)。`saveSetting` 本身未动(#68)。
- **传输面板「在文件管理器中打开」吞失败(P1)**:`TransferPanel.reveal` 原来 `void revealLocal` 不管 `{ ok: false }`(SftpDrawer 的同款按钮已经 toast)。现在 await,失败 toast `sfp.revealFail`(已有键)。
- **连接/启动开关写盘失败会撒谎(P1)**:设置里「启动恢复上次标签」「自动重连」「关闭前确认」「桌面通知」四个开关同样先翻再 `void saveSetting`。改为 `settings.set` 直写,失败回滚 + toast `set.gen.writeFail`。其它开关 / 片段 / 编辑器 / 连接日志仍归 #66 等,未动。
- i18n 新增 `set.gen.writeFail`(zh / en / zh-TW;文案与 #66/#68 对齐便于并行合并)。
- 未触碰:`closePane` / `focusSession` / `openSftpFor` / `splitPane` / `setActive*` / `persistTabs` / `nextTab` / `closeOthers` / `openSnapshot` / `applyLayoutPreset` / `queue*` / `clearTransfer*` / `theme` / `setLang` / `addSftpRecent` / `saveSetting` / `trustAndReconnect` / `zoom` / `fontSize` / `SftpDrawer` / `HostEditor` / `HostsPage` / `PaneNode` / `HistorySearch`。
## M3.140(分支 `fix/review-polish-m3140`,**未合并**)

> 只做缺陷 / 界面打磨,不加功能。**#74–#12、#4–#11 的 PR 都还没合并**,这一批也不含它们。

- **启动/窗口剩余开关写盘失败会撒谎(P1)**:设置里「恢复时自动连接」「恢复工作目录」「最小化到托盘」「通知提示音」四个开关原来先翻内存再 `void saveSetting`,主进程拒键或写盘失败时开关一直停在错的状态,直到重启才回退(与 M3.139 的 restoreTabs/autoReconnect/confirmClose/notifications 同款)。现在直接 `settings.set`,失败回滚并 toast `set.gen.writeFail`。M3.139 那四个未动。
- **终端粘贴/选择开关写盘失败会撒谎(P1)**:「粘贴前确认」「清理粘贴」「选中即复制」「中键粘贴」「右键粘贴」五个开关同样先翻再 fire-and-forget。改为 `settings.set` 直写,失败回滚 + toast `set.gen.writeFail`。光标/字体/主题/数字框/其它开关/快捷键/强调色未动。
- i18n 新增 `set.gen.writeFail`(zh / en / zh-TW;文案与 #66/#68/#74 对齐便于并行合并)。
- 未触碰:`closePane` / `focusSession` / `openSftpFor` / `splitPane` / `setActive*` / `persistTabs` / sidebar/hosts setters / `TransferPanel` / `SftpDrawer` / `saveSetting` / `zoom` / `fontSize` / M3.139 四个启动开关。
## M3.141(分支 `fix/review-polish-m3141`,**未合并**)

> 只做缺陷 / 界面打磨,不加功能。**#75–#4 的 PR 都还没合并**,这一批也不含它们。

- **SFTP 单文件下载失败无反馈(P1)**:`downloadSelected` 多选路径会检查 `r.ok` / `r.canceled`,单文件走 Save-As 的 `sftp.download` 却直接 `await` 后 return。磁盘满 / 权限 / 传输失败时点击像没反应。现在与 `downloadMany` 一样把失败写进 `error`(`sfp.downloadFail`)。
- **端口转发「保存到主机」失败静默(P1)**:`ForwardsPage.add` 在已连上时先 `addForwardTo` 成功,再 `saveHost`;hosts 写盘抛错时 try 无 catch,表单不关但 `err` 空、rejection 未处理。现在只包住 `saveHost`,失败设 `err = ed.saveFail` 并 return,已开的现场转发保留(下次连接不会自动开这条)。未改 `saveHost` 本体(#65)。
- **连接类剩余开关写盘失败会撒谎(P1)**:「连接复用」「连接时附到 tmux」「Shell 集成」「自动识别服务器系统」「校验校验和」五个开关原来先翻内存再 `void saveSetting`。改为直接 `settings.set`,失败回滚并 toast `set.gen.writeFail`。M3.139/M3.140 那批启动/粘贴开关、光标/字体/主题/数字框/`autoBackup`/快捷键/强调色未动。
- i18n 新增 `set.gen.writeFail`(zh / en / zh-TW;文案与 #66/#68/#74/#75 对齐便于并行合并)。
- 未触碰:`closePane` / `focusSession` / `openSftpFor` / `splitPane` / `setActive*` / `persistTabs` / sidebar/hosts / `TransferPanel` / `saveSetting` / `zoom` / `fontSize` / `editExternal`/`openWith` / `saveHost`。
- 仍按原计划搁置:`fontSize` 未使用、`zoom` 不持久化、`local.home` 静默、StatusBar configured-vs-live、`setWindowOpenHandler`、预览「无法预览」。

## M3.142(分支 `fix/review-polish-m3142`,**未合并**)

> 只做缺陷 / 界面打磨,不加功能。**#76–#4 的 PR 都还没合并**,这一批也不含它们。

- **SFTP 重命名 / 新建 / 删除失败被 load 清掉(P1)**:`commitRename` / `commitCreate` / `delSelected` 失败时写了 `error`,随即 `await load()`,而 `load()` 开头把 `error` 清空 —— 权限不够 / 文件占用时点击像没反应。现在 rename/create 失败直接 return 不 reload;delete 在 load 之后把失败信息写回去。上传 / 下载 / pack 路径未动(#76 的单文件下载未碰)。
- **缩放写盘失败会跨启动撒谎(P1)**:`zoom.ts` 立刻改 `webFrame` 缩放,再 debounce `settings.set('zoom')` 且不看结果。拒绝键 / 写盘失败时本会话看着缩了,下次启动静默回到旧值。现在 `persistZoom` 检查 `ok === false` 与 throw,失败 toast `app.zoomFail` 并滚回已持久化的级别;`restore` 同步 `persistedLevel`。不是「补做缩放持久化」(本来就会写),只是 fail-closed。
- i18n 新增 `app.zoomFail`(zh / en / zh-TW)。
- 未触碰:theme(#67)、HostEditor remove/save(#64/#65)、trustAndReconnect(#62)、ForwardsPage.remove(#63)、downloadSelected(#76)、设置开关波、fontSize / local.home / StatusBar / setWindowOpenHandler / preview 无法预览。
- 仍按原计划搁置:`fontSize` 未使用、`local.home` 静默、StatusBar configured-vs-live、`setWindowOpenHandler`、预览「无法预览」。

## M3.143(分支 `fix/review-polish-m3143`,**未合并**)

> 只做缺陷 / 界面打磨,不加功能。**#77–#4 的 PR 都还没合并**,这一批也不含它们。

- **跳板机已删仍直连(P0,桌面 ↔ 安卓缺口)**:`ssh:connect` 在 `jumpHostId` 指向的主机不在库里时原来静默跳过跳板、按直连走 —— 内网地址会表现为莫名其妙的网络失败;安卓 `TerminalScreen` 早已拒绝并报「跳板机已经删除了」。现在主进程返回 `code: 'jump_missing'`,`sessions.ts` 映射到 `app.jumpMissing` toast/面板文案。
- **主机编辑页跳板机状态与安卓不对齐(P1)**:选中的跳板已被删时下拉变成空白、用户不知道为什么连不上;这台本身是别人跳板时仍可再套一层。现在 `jumpGone` 保留「已删除」选项 + `host.jumpGone` 提示;`jumpBlocked` 对齐安卓(仅「被用作跳板且当前未设跳板」时禁用新增跳板,遗留值仍可清掉)+ `host.jumpBlocked`。
- i18n 新增 `app.jumpMissing` / `host.jumpDeleted` / `host.jumpGone` / `host.jumpBlocked`(zh / en / zh-TW)。
- 未触碰:M3.142/#77 SFTP rename/mkdir/create/delete + zoom;M3.141–M3.137 设置开关 / SFTP 下载 toast / closePane;theme / HostEditor save-delete / trustAndReconnect / ForwardsPage.remove / known_hosts / SFTP upload 波。
## M3.144(分支 `fix/review-polish-m3144`,**未合并**)

> 只做缺陷 / 界面打磨,不加功能。**#78–#4 的 PR 都还没合并**,这一批也不含它们。

- **认证失败无 errorCode → 自动重连锤凭据(P0,桌面 ↔ 安卓缺口)**:安卓 `ReconnectPolicy.isPermanent` 早已把认证失败当永久错误;桌面 `ssh.ts` 只给主机密钥拒绝打 `code`,认证失败(`All configured authentication methods failed` / 私钥口令 / keyboard-interactive)留下 `code` 为空 —— `scheduleReconnect` 只停 host_key_*,网络恢复 / 唤醒也会把无 code 的错误面板重新拉起。现在主进程 `isAuthConnectError` → `code: 'auth_failed'`(含 `authConfig` 捕获),渲染层映射 `app.authFailed`;`scheduleReconnect` 遇到**任意** `errorCode` 即停;`handleWake` 改走与 `handleNetworkOnline` 相同的 `shouldReviveOnOnline`。
- **密钥变更卡可能藏起「之前记录的指纹」(P1)**:`PaneNode.oldFingerprint` 用严格 `k.port === port`,而 `hostKeyKnown` 用 `|| 22`;遗留 / 导入条目 port 为空时变更卡只显示新指纹。现与 `hostKeyKnown` 同一套归一化。
- i18n 新增 `app.authFailed`(zh / en / zh-TW)。`friendlyError.test` +2 → vitest **336**。
- 未触碰:M3.143/#78 jump_missing / HostEditor jumpGone;M3.142–M3.137 设置开关 / SFTP / closePane;theme / HostEditor save-delete / trustAndReconnect / ForwardsPage.remove / known_hosts / SFTP upload 波。
- 仍按原计划搁置:`fontSize` 未使用、`local.home` 静默、StatusBar configured-vs-live、`setWindowOpenHandler`、预览「无法预览」。

## M3.175(分支 `fix/review-polish-m3175`,勿合并)
- 下载校验和不匹配不再当成功:`downloadJob` 返回 `checksumFails`,三条下载 IPC 回 `ok:false` + `checksum-mismatch:N`;界面按 `sfp.checksumMismatch` 显示(zh / zh-TW / en)。
- 下载 / 上传的目录遍历失败(`walkError`)同样回 `ok:false`,不再把半截传输报成成功。
- 只动 Windows / Android 相关路径;未碰 macOS / iOS。
## M3.176

- 分支 `fix/review-polish-m3176`(基于 `main` @ `5946b1f`),**未合并**;只动 Windows / Android,不碰 macOS / iOS。
- **增量同步不再把文件级失败报成成功**:`syncJob` 返回 `{ errors }`,IPC `sftp:sync` 有失败就 `ok:false` + `sync-items-failed:N`,抽屉用新键 `sfp.syncItemsFailed` 显示(zh / en / zh-TW)。取消语义与 `${errors} 项失败` 的 emit 文案没动(分别归 #53 / #47)。
- **持续同步失败不推进基线**:`runWatchPass` 在同步抛错或有文件失败时保留旧基线,下一轮重试这些文件(原来会越过部分失败,失败文件因大小/时间"对上"而永远不再同步)。
## M3.177

- 分支 `fix/review-polish-m3177`(基于 main @ 5946b1f),**do-not-merge**,Windows + Android 专项。
- A: `downloadTree` 读目录失败不再当空目录成功返回(重抛);子项全部失败时抛 `download-tree-empty:<name>`;部分成功仍保留。
- B: 设置 → 外部编辑器 / 按扩展名打开程序,`settings.set` 被拒时回滚 store 并提示 `set.gen.writeFail`;表单只在成功后清空。
- 新增 i18n 键:`set.gen.writeFail`(zh / zh-TW / en)。
## M3.178(分支 `fix/review-polish-m3178`,**勿合并**)
- **打包下载不再假成功**:`packAndDownload` 现在检查 tar 退出码与 `downloadJob` 的 `{files,failures,cancelled}`;tar 非零 / 下载有失败 / 被取消 / 一个文件都没下到,一律返回 `ok:false`(取消带 `canceled:true`),不再静默 `ok:true` 交回一个缺失或半截的归档。
- **标签布局写盘失败会提示**:`persistTabs` 的 `openTabs` 写入被拒 / 抛错时,toast 一次 `app.tabsPersistFail`(同一段失败只提示一次,写成功即复位),不再让内存里的新布局和磁盘上的旧布局悄悄分叉。
- **快照写盘失败回滚**:`saveSnapshot` / `deleteSnapshot` 写入被拒时回滚 `snapshots` 并 toast `app.snapPersistFail`,界面不再显示一个下次启动就消失的快照。
- 新增 i18n 键:`app.tabsPersistFail`、`app.snapPersistFail`(zh / zh-TW / en 三份)。
## M3.179(分支 `fix/review-polish-m3179`,**勿合并**)
- **下载顶层目录读不出来不再假成功**:`downloadJob` 的 `walk` 在 `readdir` 失败时一律静默跳过,顶层文件夹读不出来就变成「建了个空目录、0 个文件、返回 ok:true」。现在 `depth === 0` 记进 `failures`,IPC 如实报「N 个文件失败」;嵌套目录仍按原样尽力跳过。
- **上传冲突检查失败不再静默覆盖**:`remoteConflicts` 原来任何错误都返回 `[]`,被 `resolveUploadOverwrite` 当成「没有冲突」直接按覆盖上传。现在失败即抛出,`resolveUploadOverwrite` 捕获后返回 `'cancel'`(失败关闭,不传)。
- **本地覆盖确认不再把 EACCES 当「不存在」**:`confirmOverwriteLocal` 原来 `stat` 任何错误都当文件不存在,锁住/无权限的本地文件会被静默覆盖。现在只有 `ENOENT` 算不存在,其余错误按「已存在」处理、照常弹确认。
## M3.180(分支 `fix/review-polish-m3180`,**勿合并**)
- **下载子目录建不出来不再静默跳过**:`downloadJob` 的 `walk` 在子项 `walk` 抛错时只 `/* skip */`,不记 `failures` —— 嵌套目录 `mkdir` 全失败(EACCES/EPERM)时 `discovered` 与 `failures` 都是 0,IPC 对非空远端文件夹返回 `{ok:true, count:0}`。现在子项 catch 记进 `failures`,如实报「N 个文件失败」。
- **下载目标目录建不出来不再继续**:`downloadJob` 开头 `mkdir(localBase)` 原来 `.catch(() => undefined)`,目标不可写时仍往下跑、每个文件写失败。现在失败即清理 `jobSession`/`jobRate` 并抛出,IPC 返回 `ok:false`。
- **安卓保存主机失败会提示并回滚**:`HostStore.save` 改用 `commit()` 并返回 `Boolean`,`MainActivity.persist` 写盘失败时弹 `hosts_save_failed` 并把内存列表退回(磁盘满 / 写入被拒不再「界面说存好了、下次启动回退」)。

## 项目概述
- 极简、键盘优先的 SSH 客户端。Electron + Vue 3 (Vite) + TypeScript。
- 平台: Windows (`win32`)。目录: `D:\Documents\Claude Code\X-SSH`。
- **git 仓库**(`main` 分支),远程: `https://github.com/WyattCode/x-ssh`(私有)。
- 版本: `package.json` 当前为 **0.5.0**(2026-10-28 发;这一轮把「只在编译里过关的交互」真正点了一遍,见第二十三次会话)。有 `CHANGELOG.md`(Keep a Changelog + 语义化),`v0.5.0` tag 已推。

## 常用命令(Windows/PowerShell)
- 必须用 `npm.cmd`(直接 `npm` 会因执行策略失败)。
- 校验: `npm.cmd run typecheck`、`npm.cmd run build`
- **本地 SFTP 靶机**:`powershell -File scripts\dev-sshd.ps1 start|stop|status|clean`。密钥、配置、`authorized_keys` 全在 `%TEMP%\xssh-target`,只绑 `127.0.0.1:2222`,**不碰 `%USERPROFILE%\.ssh`**;客户端私钥是 `%TEMP%\xssh-target\id_dev`(主机编辑页「密钥」直接填这个路径),登录用户是你当前 Windows 账号。配置里**不能写 `PerSourcePenalties`**(Windows 自带的 OpenSSH 是 9.x,不认识,写了 sshd 直接起不来)。脚本按 PID 文件停进程 —— 别自己按命令行匹配杀,会把执行命令的 PowerShell 一起匹配掉。
- **单元测试**: `npm.cmd run test`(Vitest 2;共 **336** 用例 / **30** 个文件:纯逻辑在 `src/shared/*` / `src/renderer/src/lib/*`,外加 `src/main/*.test.ts` 的集成测试(起真 ssh2 服务器),以及两个源码静态检查(`focusTrapCoverage`、`imeEnterCoverage`)。**没有任何组件测试**,界面交互只能人工验。
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

- **主机密钥可多枚并存(M3.75,2026-10-30):** `known_hosts.json` 每条 `host:port` 存 `fps: string[]`(加载时迁入旧的裸字符串 / `{fp}`);`set()`/`ssh:trustHostKey` **追加**不覆盖;`accepts()` 任一匹配即通过。导出带 `fingerprints[]` + 兼容字段 `fingerprint`(第一把)。要丢掉旧密钥请「忘记」整条记录后再信任。安卓侧见 `mobile/HANDOVER.md` M3.75。
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
- **连接页** `components/HostsPage.vue`:`.page-head`(标题 + 搜索胶囊 + 加号)、搜索(名称 / 地址 / 用户 / 分组 / 标签 / 系统)、新建按钮;四个统计卡(总数 / 在线 / 离线 / 分组);分组标签页、排序(最近使用 / 名称 / 地址)、卡片 / 列表切换(`hostsView` / `hostsSort` / `sidebarCollapsed` 三个设置键);卡片:系统图标、在线点、地址、标签、⋯ 菜单(连接 / 打开 SFTP / 编辑 / 复制 / 删除,删除要确认)、连接按钮。用户明确**不要**设计图里的宣传口号和「example Pro」账号块。
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

## M3.76 Windows Hello 私钥门禁（桌面）

- Windows 可选：连接使用私钥前经 `UserConsentVerifier`（powershell.exe）做系统验证；会话缓存 5 分钟；锁屏/`suspend` 清除。
- **不是**私钥文件加密（`userData/keys/*` 仍是 0600 明文）；与安卓 M3.72 Keystore 生物识别不是同一强度。
- 门禁关或非 Windows：无行为变化。Hello 未配置时 fail-open 并记连接日志 `userVerifyUnavailable`。

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
      按钮是「信任新密钥并重连」(与未信任卡的按钮区分);点后进 shell,`known_hosts` **追加**新指纹(旧的仍保留,便于轮换窗口),`firstSeen` 保持首次信任时间。
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

# 会话记录:M3.181(2026-10-30,会话日志写失败 + 安卓凭据封存失败)

- **会话日志中途写失败**:`startLog` 的 `ws.on('error')` 原来只把 `logging=false`,界面仍显示「记录中」、再点「开始记录」永远返回 false。现在同时 `end()` + 清 `logWrite` + 经新 IPC `sessionLog:failed` 通知渲染层,`TerminalView` 收到后把 `logOn` 置 false 并提示 `term.logWriteFail`。
- **安卓凭据封存失败**:`HostStore.writeSecret` 封不上时保留旧密文(不丢数据),但界面以为存好了。现在 `save()` 记 `lastSaveSealFailed`,`MainActivity.persist` 据此 Toast `hosts_secret_seal_failed`,明确告诉用户磁盘上仍是旧凭据。
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
