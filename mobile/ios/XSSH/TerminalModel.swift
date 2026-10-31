import Foundation
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
    private let password: String
    private(set) var knownKey: String?

    private(set) var state: State = .idle
    private(set) var rows: [ScreenRow] = []
    private(set) var cursor = CursorState(col: 0, row: 0, visible: true)
    private(set) var title = ""
    var ctrlArmed = false
    var wantsKeyboard = true

    private let backend = Backend()
    private var measured: (cols: Int, rows: Int)?
    private var cell: (width: UInt32, height: UInt32) = (16, 32)
    private var startTask: Task<Void, Never>?
    private var resizeTask: Task<Void, Never>?
    private var connectedSize: (cols: Int, rows: Int)?

    init(host: Host, password: String, knownKey: String?) {
        self.host = host
        self.password = password
        self.knownKey = knownKey
        backend.onOutput = { [weak self] output in
            Task { @MainActor [weak self] in self?.apply(output) }
        }
    }

    deinit { backend.shutdown() }

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
            auth: .password(password: password), knownKey: knownKey, jump: nil)
        backend.connect(config, cols: UInt32(size.0), rows: UInt32(size.1), cellPixels: cell) { [weak self] result in
            Task { @MainActor [weak self] in self?.connectFinished(result) }
        }
    }

    private func connectFinished(_ result: Result<Void, Error>) {
        guard state == .connecting else { return }
        switch result {
        case .success:
            state = .connected
            rows = []
            // 连接期间尺寸又变了(键盘落定):补发一次。
            if let m = measured, connectedSize?.cols != m.cols || connectedSize?.rows != m.rows {
                connectedSize = m
                backend.resize(cols: UInt32(m.cols), rows: UInt32(m.rows), cellPixels: cell)
            }
        case .failure(let error):
            state = Self.state(for: error, known: knownKey)
        }
    }

    private static func state(for error: Error, known: String?) -> State {
        guard let e = error as? FfiError else { return .failed(error.localizedDescription) }
        switch e {
        case .HostKeyUnknown(let fp), .JumpHostKeyUnknown(let fp): return .needsTrust(fingerprint: fp)
        case .HostKeyChanged(let fp), .JumpHostKeyChanged(let fp): return .keyChanged(new: fp, old: known)
        default: return .failed(e.localizedDescription)
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
        startTask?.cancel()
        resizeTask?.cancel()
        backend.shutdown()
    }

    func setForeground(_ active: Bool) { backend.setPaused(!active) }

    // MARK: 输出

    private func apply(_ output: Backend.Output) {
        switch output {
        case .frame(let rows, let cursor):
            self.rows = rows
            self.cursor = cursor
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
        var bytes = Array(text.utf8)
        if ctrlArmed, text.unicodeScalars.count == 1, let first = text.unicodeScalars.first {
            ctrlArmed = false
            bytes = Self.control(first) ?? bytes
        }
        backend.send(Data(bytes))
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
        ctrlArmed = false
        backend.send(Data(bytes))
    }

    func press(_ key: Key) {
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
        backend.send(Data(seq.utf8))
    }

    /// 粘贴:换行统一成回车;程序开了括号粘贴就包起来,多行文本不会被当成逐行输入执行。
    func paste() {
        guard var text = UIPasteboard.general.string, !text.isEmpty else { return }
        text = text.replacingOccurrences(of: "\r\n", with: "\r").replacingOccurrences(of: "\n", with: "\r")
        if backend.currentTerm.inputModes().bracketedPaste {
            // 文本里自带的结束标记要去掉,不然能提前逃出括号。
            text = text.replacingOccurrences(of: "\u{1B}[201~", with: "")
            text = "\u{1B}[200~" + text + "\u{1B}[201~"
        }
        ctrlArmed = false
        backend.send(Data(text.utf8))
    }

    /// 拖动滚动:普通屏滚回滚历史;备用屏(vim / less)开了 alternateScroll 就发方向键。
    func scroll(lines: Int) {
        guard lines != 0 else { return }
        let term = backend.currentTerm
        let modes = term.inputModes()
        if modes.altScreen {
            guard modes.alternateScroll else { return }
            let seq = (modes.appCursor ? "\u{1B}O" : "\u{1B}[") + (lines > 0 ? "A" : "B")
            backend.send(Data(String(repeating: seq, count: min(abs(lines), 10)).utf8))
        } else {
            backend.scroll(lines: Int32(lines))
        }
    }
}
