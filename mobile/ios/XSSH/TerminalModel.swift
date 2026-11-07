import Foundation
import GameController
import SwiftUI
import UIKit

/// 一条终端会话的界面状态。Rust 那边的活全在 `Backend` 的串行队列上,这里只管状态、输入和防抖。
/// 会话归 `RootView` 持有,不跟着视图走 —— 折叠 / 展开 / 旋转把详情页重建时,连接不会断。
@Observable
@MainActor
final class TerminalModel: Identifiable {
    enum State: Equatable {
        case idle
        case connecting
        case needsTrust(fingerprint: String)
        case keyChanged(new: String, old: String?)
        case connected
        case failed(String)
        case closed(exitStatus: UInt32?)
    }

    enum Key {
        case esc, tab, backTab, up, down, left, right, home, end, pageUp, pageDown
        case function(Int)
    }

    let id = UUID()
    let host: Host
    private let credentials: Credentials
    private(set) var knownKey: String?

    private(set) var state: State = .idle {
        didSet { if state == .connected, oldValue != .connected { connectedAt = Date() } }
    }
    /// 这次会话连上的时刻(主机列表里连着的那一行显示已连接时长)。
    private(set) var connectedAt: Date?
    /// 主机列表里「已连接」那行显示连上的时刻(true)还是时长(false):点一下切换,跟着会话走。
    var showsConnectedClock = false
    private(set) var rows: [ScreenRow] = []
    private(set) var cursor = CursorState(col: 0, row: 0, visible: true)
    private(set) var title = ""
    /// 滚动位置(离底部多少行 / 回滚历史共多少行)、是否备用屏、视口里的选区:画滚动条和选区高亮用。
    private(set) var scrollOffset = 0
    private(set) var historyLen = 0
    private(set) var onAltScreen = false {
        didSet { if onAltScreen != oldValue { resetAltScroll() } }
    }
    /// 全屏程序(备用屏)里没有回滚历史,程序一共多长我们不知道。滚动条用「估算」:记下用户拖动累计走了多少行(`altPos`,往回拖为正、往前为负)
    /// 以及这次走到过的最远两端(`altMin` / `altMax`);总长 = 两端之差 + 一屏,滑块位置 = 当前在两端之间的哪里。
    /// 起点在底部的程序(聊天类)往回拖,滑块往上走;起点在顶部的程序(less)往前拖,滑块往下走 —— 都对。
    private var altPos = 0
    private var altMin = 0
    private var altMax = 0
    private func resetAltScroll() { altPos = 0; altMin = 0; altMax = 0; altScrollRemainder = 0 }
    /// 滚动条用的「历史长度 / 离底部多少行」:普通屏是真实的,备用屏是上面的估算。
    var barHistory: Int { onAltScreen ? altMax - altMin : historyLen }
    var barOffset: Int { onAltScreen ? altPos - altMin : scrollOffset }
    private(set) var selection: ViewSelection?
    /// 用户已经开始用这个终端(敲了字 / 按了键 / 粘贴 / 滚动):界面据此把顶部的侧栏开关和会话名称收起来,不挡着内容。
    private(set) var userActive = false
    var ctrlArmed = false
    /// Alt 待用:下一次发出去的内容前面加 ESC(终端里 Alt+键 就是这么编码的)。
    var altArmed = false
    /// 默认不弹系统键盘:连上后要打字,点屏幕或按工具栏的键盘钮再弹(和主机列表、编辑页里的输入框无关)。
    var wantsKeyboard = false
    /// 接着外接键盘。注意不能因此把「键盘」钮置灰:模拟器(和 iPad 的浮动键盘)接着外接键盘时软键盘照样会弹出来,
    /// 钮灰了就收不掉它。
    private(set) var hasHardwareKeyboard = false
    /// 快捷键面板(Esc / Tab / Ctrl / 方向键…)。和系统键盘各自独立开关,默认收起 —— 同安卓。
    var showsKeys = false
    /// 点「断开 / 取消」后、会话页正在淡出的那一小段时间(见 `RootView.close`,内屏用)。
    var leaving = false

    private let backend = Backend()
    private var measured: (cols: Int, rows: Int)?
    private var cell: (width: UInt32, height: UInt32) = (16, 32)
    private var startTask: Task<Void, Never>?
    private var resizeTask: Task<Void, Never>?
    private var connectedSize: (cols: Int, rows: Int)?

    init(host: Host, credentials: Credentials, knownKey: String?) {
        self.host = host
        self.credentials = credentials
        self.knownKey = knownKey
        // 接着外接键盘时系统本来就不弹软键盘,但隐形输入框得是第一响应者,实体键盘的字才进得来:
        // 默认不弹软键盘不能连带让外接键盘打不了字。外接键盘接上就当作「要键盘」,拔掉就收回。
        #if targetEnvironment(simulator)
        // 模拟器会把 Mac 的键盘当成外接键盘,连上就弹软键盘,和真机没接键盘时的行为对不上;模拟器里不检测。
        hasHardwareKeyboard = false
        #else
        hasHardwareKeyboard = GCKeyboard.coalesced != nil
        #endif
        wantsKeyboard = hasHardwareKeyboard
        keyboardObservers = [
            NotificationCenter.default.addObserver(forName: .GCKeyboardDidConnect, object: nil, queue: .main) { [weak self] _ in
                MainActor.assumeIsolated {
                    #if !targetEnvironment(simulator)
                    self?.hasHardwareKeyboard = true; self?.wantsKeyboard = true
                    #endif
                }
            },
            NotificationCenter.default.addObserver(forName: .GCKeyboardDidDisconnect, object: nil, queue: .main) { [weak self] _ in
                MainActor.assumeIsolated { self?.hasHardwareKeyboard = false; self?.wantsKeyboard = false }
            },
        ]
        backend.onOutput = { [weak self] output in
            Task { @MainActor [weak self] in self?.apply(output) }
        }
    }

    @ObservationIgnored private var keyboardObservers: [NSObjectProtocol] = []

    deinit {
        keyboardObservers.forEach(NotificationCenter.default.removeObserver)
        backend.shutdown()
    }

    /// 正在显示需要用户处理的卡片(信任 / 密钥变更 / 失败):这时不弹键盘,别把卡片挤得只剩一条缝。
    var showsPrompt: Bool {
        switch state {
        case .needsTrust, .keyChanged, .failed: true
        default: false
        }
    }

    var isEnded: Bool {
        switch state {
        case .closed, .failed, .keyChanged: true
        default: false
        }
    }

    // MARK: 连接

    /// 视图量到可用尺寸后调用。第一次:等布局稳定(键盘动画)再连,PTY 一开始就是对的尺寸;
    /// 之后的变化(软键盘、折叠、拖拽分屏)防抖后再通知服务器,避免动画期间每帧发一次 SIGWINCH。
    func measured(cols: Int, rows: Int, cellPixels: (UInt32, UInt32)) {
        guard cols > 0, rows > 0 else { return }
        cell = cellPixels
        let size = (cols, rows)
        if let m = measured, m == size { return }
        measured = size
        switch state {
        case .idle:
            startTask?.cancel()
            startTask = Task { [weak self] in
                try? await Task.sleep(for: .milliseconds(350))
                guard !Task.isCancelled else { return }
                self?.connect()
            }
        case .connected, .closed:
            resizeTask?.cancel()
            resizeTask = Task { [weak self] in
                try? await Task.sleep(for: .milliseconds(150))
                guard !Task.isCancelled, let self, let m = self.measured else { return }
                self.connectedSize = m
                self.backend.resize(cols: UInt32(m.cols), rows: UInt32(m.rows), cellPixels: self.cell)
            }
        default:
            break
        }
    }

    func connect() {
        let size = measured ?? (80, 24)
        connectedSize = size
        state = .connecting
        let config = HostConfig(
            host: host.address, port: UInt16(clamping: host.port), username: host.username,
            auth: authMethod, knownKey: knownKey, jump: nil)
        backend.connect(config, cols: UInt32(size.0), rows: UInt32(size.1), cellPixels: cell) { [weak self] result in
            Task { @MainActor [weak self] in self?.connectFinished(result) }
        }
    }

    private var authMethod: AuthMethod {
        switch host.authKind {
        case .password: .password(password: credentials.password)
        case .key: .keyData(pem: credentials.privateKey,
                            passphrase: credentials.passphrase.isEmpty ? nil : credentials.passphrase)
        }
    }

    private func connectFinished(_ result: Result<Void, Error>) {
        // 用户已经取消 / 断开:迟到的结果不再改状态(否则列表里那一行会在收场动画中途提前松手)。
        guard state == .connecting, !userDisconnected else { return }
        switch result {
        case .success:
            state = .connected
            rows = []
            #if DEBUG
            runLaunchCommand()
            #endif
            // 连接期间尺寸又变了(键盘落定):补发一次。
            if let m = measured, connectedSize?.cols != m.cols || connectedSize?.rows != m.rows {
                connectedSize = m
                backend.resize(cols: UInt32(m.cols), rows: UInt32(m.rows), cellPixels: cell)
            }
        case .failure(let error):
            state = Self.state(for: error, known: knownKey)
        }
    }

    #if DEBUG
    /// `-autoKeyboard` 弹出软键盘;`-autoRun "<命令>"` 连上后自动敲这条命令(分号分隔多条)。
    private func resetUserActive() { userActive = false }

    private func runLaunchCommand() {
        if DebugLaunch.flag("-autoKeyboard") { wantsKeyboard = true }
        if DebugLaunch.flag("-autoKeys") { showsKeys = true }
        guard let command = DebugLaunch.value("-autoRun") else { return }
        Task { @MainActor [weak self] in
            try? await Task.sleep(for: .seconds(1.5))
            self?.send(command + "\r")
            self?.resetUserActive()
        }
    }
    #endif

    private static func state(for error: Error, known: String?) -> State {
        guard let e = error as? FfiError else { return .failed(error.localizedDescription) }
        switch e {
        case .HostKeyUnknown(let fp), .JumpHostKeyUnknown(let fp): return .needsTrust(fingerprint: fp)
        case .HostKeyChanged(let fp), .JumpHostKeyChanged(let fp): return .keyChanged(new: fp, old: known)
        case .KeyEncrypted:
            return .failed(String(localized: "The private key needs a passphrase, or the one saved is wrong. Edit the host to fix it."))
        default: return .failed(e.userMessage)
        }
    }

    func trust(fingerprint: String, store: HostStore) {
        guard store.trust(host, fingerprint: fingerprint) else {
            state = .failed(String(localized: "Couldn't save the host key."))
            return
        }
        knownKey = fingerprint
        connect()
    }

    /// 取消连接 / 主动断开:会话和轮询都收掉。连接还在进行时,Backend 会在连上后立刻断开。
    func disconnect() {
        userDisconnected = true
        startTask?.cancel()
        resizeTask?.cancel()
        backend.shutdown()
    }

    /// 已经被用户断开 / 取消过:连接和轮询都收掉了,这个模型不能再拿来「回到它」,再点同一台必须新连一条。
    /// (它的 `state` 还是 `.connected`,所以不能靠 `isEnded` 判断 —— 列表里「连着的那台」靠 `isEnded` 决定,
    /// 收场动画要它保持到收完。)
    private(set) var userDisconnected = false

    func setForeground(_ active: Bool) { backend.setPaused(!active) }

    // MARK: 输出

    private func apply(_ output: Backend.Output) {
        // 同上:断开之后迟到的 `.closed`(正在跑的那一拍轮询发出的)不能把状态改成「已结束」。
        if userDisconnected { return }
        switch output {
        case .frame(let rows, let cursor, let view):
            self.rows = rows
            self.cursor = cursor
            scrollOffset = Int(view.scrollOffset)
            historyLen = Int(view.history)
            onAltScreen = view.altScreen
            selection = view.selection
            backend.ackFrame()
        case .title(let t): title = t
        case .closed(let status): if state == .connected { state = .closed(exitStatus: status) }
        case .clipboard(let text): UIPasteboard.general.string = text
        case .bell: UIImpactFeedbackGenerator(style: .rigid).impactOccurred()
        }
    }

    /// VoiceOver 用:整屏文字(行尾空白不要)。
    var screenText: String {
        rows.map { row in
            row.runs.map { $0.cells.split(separator: "\u{1F}", omittingEmptySubsequences: false).joined() }
                .joined().trimmingCharacters(in: .whitespaces)
        }.joined(separator: "\n")
    }

    // MARK: 输入

    func send(_ text: String) {
        userActive = true
        resetAltScroll()
        var bytes = Array(text.utf8)
        if ctrlArmed, text.unicodeScalars.count == 1, let first = text.unicodeScalars.first {
            ctrlArmed = false
            bytes = Self.control(first) ?? bytes
        }
        emit(bytes)
    }

    /// 所有按键输入的出口:待用的 Alt 在这里加 ESC 前缀并收掉。
    private func emit(_ bytes: [UInt8]) {
        var out = bytes
        if altArmed { out.insert(0x1B, at: 0); altArmed = false }
        backend.send(Data(out))
    }

    /// Ctrl+字母 / 符号 → 控制字符;不适用就返回 nil(原样发)。
    static func control(_ scalar: Unicode.Scalar) -> [UInt8]? {
        switch scalar.value {
        case 0x20: return [0]
        case 0x40...0x7E: return [UInt8(scalar.value & 0x1F)]
        default: return nil
        }
    }

    func sendRaw(_ bytes: [UInt8]) {
        userActive = true
        resetAltScroll()
        ctrlArmed = false
        emit(bytes)
    }

    func press(_ key: Key) {
        userActive = true
        resetAltScroll()
        let app = backend.currentTerm.inputModes().appCursor
        let csi = "\u{1B}["
        let ss3 = "\u{1B}O"
        let cursorKey: (String) -> String = { (app ? ss3 : csi) + $0 }
        let seq: String
        switch key {
        case .esc: seq = "\u{1B}"
        case .tab: seq = "\t"
        case .backTab: seq = csi + "Z"
        case .up: seq = cursorKey("A")
        case .down: seq = cursorKey("B")
        case .right: seq = cursorKey("C")
        case .left: seq = cursorKey("D")
        case .home: seq = cursorKey("H")
        case .end: seq = cursorKey("F")
        case .pageUp: seq = csi + "5~"
        case .pageDown: seq = csi + "6~"
        case .function(let n):
            switch n {
            case 1...4: seq = ss3 + ["P", "Q", "R", "S"][n - 1]
            case 5: seq = csi + "15~"
            case 6...8: seq = csi + "\(n + 11)~"
            case 9, 10: seq = csi + "\(n + 11)~"
            case 11, 12: seq = csi + "\(n + 12)~"
            default: return
            }
        }
        // Ctrl 只对可打印字符有意义:按过方向键等就取消待用状态。
        ctrlArmed = false
        emit(Array(seq.utf8))
    }

    /// 粘贴:换行统一成回车;程序开了括号粘贴就包起来,多行文本不会被当成逐行输入执行。
    func paste() {
        userActive = true
        guard var text = UIPasteboard.general.string, !text.isEmpty else { return }
        text = text.replacingOccurrences(of: "\r\n", with: "\r").replacingOccurrences(of: "\n", with: "\r")
        if backend.currentTerm.inputModes().bracketedPaste {
            // 文本里自带的结束标记要去掉,不然能提前逃出括号。
            text = text.replacingOccurrences(of: "\u{1B}[201~", with: "")
            text = "\u{1B}[200~" + text + "\u{1B}[201~"
        }
        ctrlArmed = false
        altArmed = false
        backend.send(Data(text.utf8))
    }

    // MARK: 选择 / 复制

    /// 长按开始选择(视口坐标;默认选一个词),拖动时扩展。
    func selectStart(row: Int, col: Int, rightHalf: Bool, kind: SelectKind = .word) {
        backend.perform { $0.selectStart(row: UInt32(row), col: UInt32(col), rightHalf: rightHalf, kind: kind) }
    }

    func selectUpdate(row: Int, col: Int, rightHalf: Bool) {
        backend.perform { $0.selectUpdate(row: UInt32(row), col: UInt32(col), rightHalf: rightHalf) }
    }

    func selectClear() {
        guard selection != nil else { return }
        backend.perform { $0.selectClear() }
    }

    /// 选中的文字(没选为 nil)。
    var selectedText: String? { backend.currentTerm.selectionText() }

    /// 把选中的文字放进系统剪贴板;返回有没有复制到东西。
    @discardableResult
    func copySelection() -> Bool {
        guard let text = selectedText, !text.isEmpty else { return false }
        UIPasteboard.general.string = text
        return true
    }

    /// 拖滚动条:直接滚到离底部 `offset` 行的位置(0 = 贴底)。
    func scrollTo(offset: Int) {
        let target = max(0, min(offset, barHistory))
        let delta = target - barOffset
        guard delta != 0 else { return }
        if onAltScreen { scroll(lines: delta, maxEvents: 40) } else { backend.scroll(lines: Int32(delta)) }
    }

    /// 拖动滚动:普通屏滚回滚历史;备用屏(vim / less)开了 alternateScroll 就发方向键。
    func scroll(lines: Int, maxEvents: Int = 10) {
        guard lines != 0 else { return }
        userActive = true
        let term = backend.currentTerm
        let modes = term.inputModes()
        guard modes.altScreen else {
            // 普通屏(命令行):滚回滚历史。
            backend.scroll(lines: Int32(lines))
            return
        }
        // 备用屏(vim / less / htop / Codex 这类全屏程序)没有回滚历史,拖动要翻译成程序听得懂的输入,按优先级:
        // ① 程序开了鼠标上报 → 发鼠标滚轮(现代 TUI 的聊天 / 长输出区都是靠这个滚);
        // ② 开了 alternateScroll(DECSET 1007)→ 发方向键;
        // ③ 都没开 → 发翻页键(半屏一次),让 less / 大多数 TUI 至少能翻。
        let count = min(abs(lines), maxEvents)
        altPos += lines
        altMin = min(altMin, altPos)
        altMax = max(altMax, altPos)
        if modes.mouseReport {
            let (cols, rows) = measured ?? (80, 24)
            let col = max(1, cols / 2), row = max(1, rows / 2)
            // 手指往下拖(lines > 0)= 看更早的内容 = 滚轮向上(按钮 64);向下是 65。
            let button = lines > 0 ? 64 : 65
            let event: String
            if modes.sgrMouse {
                event = "\u{1B}[<\(button);\(col);\(row)M"
            } else {
                let b = Character(UnicodeScalar(UInt8(32 + button)))
                let c = Character(UnicodeScalar(UInt8(min(255, 32 + col))))
                let r = Character(UnicodeScalar(UInt8(min(255, 32 + row))))
                event = "\u{1B}[M\(b)\(c)\(r)"
            }
            backend.send(Data(String(repeating: event, count: count).utf8))
        } else if modes.alternateScroll {
            let seq = (modes.appCursor ? "\u{1B}O" : "\u{1B}[") + (lines > 0 ? "A" : "B")
            backend.send(Data(String(repeating: seq, count: count).utf8))
        } else {
            altScrollRemainder += lines
            let page = max(3, (measured?.rows ?? 24) / 2)
            while abs(altScrollRemainder) >= page {
                backend.send(Data((altScrollRemainder > 0 ? "\u{1B}[5~" : "\u{1B}[6~").utf8))
                altScrollRemainder += altScrollRemainder > 0 ? -page : page
            }
        }
    }
    /// 备用屏里没有鼠标 / alternateScroll 时,拖动累计的行数(攒够半屏发一次翻页键)。
    private var altScrollRemainder = 0
}

extension FfiError {
    /// 核心给的就是人话(`ssh: Connection refused (os error 61)`),别让界面显示枚举的类型名。
    var userMessage: String {
        switch self {
        case .Message(let m), .HostKeyUnknown(let m), .HostKeyChanged(let m), .JumpHostKeyUnknown(let m),
             .JumpHostKeyChanged(let m), .KeyEncrypted(let m), .Cancelled(let m): m
        }
    }
}
