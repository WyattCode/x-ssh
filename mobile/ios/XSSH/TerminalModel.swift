import Foundation
import SwiftUI

/// 一条终端会话:连接 → 开 shell → 每帧把远端输出喂给 Rust 的终端,再把屏幕行取出来画。
/// Rust 那边全是互斥锁里的快速调用,这里在主线程轮询(和安卓同一套「宿主按帧调用」约定)。
@Observable
@MainActor
final class TerminalModel: Identifiable {
    enum State: Equatable {
        case connecting
        case needsTrust(fingerprint: String)
        case keyChanged(fingerprint: String)
        case connected
        case failed(String)
        case closed
    }

    let id = UUID()
    let host: Host
    private let password: String
    private var trusted: String?

    private(set) var state: State = .connecting
    private(set) var rows: [ScreenRow] = []
    private(set) var cursor = CursorState(col: 0, row: 0, visible: true)
    private(set) var title = ""
    var ctrlArmed = false

    private var session: Session?
    private var shell: Shell?
    private var term = Term(cols: 80, rows: 24)
    private var cols: UInt32 = 80
    private var gridRows: UInt32 = 24
    private var loop: Task<Void, Never>?

    init(host: Host, password: String, trustedKey: String? = nil) {
        self.host = host
        self.password = password
        self.trusted = trustedKey
    }

    func start(known: String?) {
        trusted = known
        state = .connecting
        let config = HostConfig(
            host: host.address, port: UInt16(clamping: host.port), username: host.username,
            auth: .password(password: password), knownKey: trusted, jump: nil)
        let (c, r) = (cols, gridRows)
        Task {
            let result = await Task.detached { () -> Result<(Session, Shell), Error> in
                do {
                    let session = try Session.connect(config: config)
                    let shell = try session.openShell(cols: c, rows: r, term: "xterm-256color")
                    return .success((session, shell))
                } catch { return .failure(error) }
            }.value
            switch result {
            case .success(let (session, shell)):
                self.session = session
                self.shell = shell
                self.state = .connected
                self.startLoop()
            case .failure(let error):
                self.state = Self.state(for: error)
            }
        }
    }

    func trustAndReconnect(fingerprint: String, store: HostStore) {
        store.trust(host, fingerprint: fingerprint)
        start(known: fingerprint)
    }

    private static func state(for error: Error) -> State {
        guard let e = error as? FfiError else { return .failed(error.localizedDescription) }
        switch e {
        case .HostKeyUnknown(let fp), .JumpHostKeyUnknown(let fp): return .needsTrust(fingerprint: fp)
        case .HostKeyChanged(let fp), .JumpHostKeyChanged(let fp): return .keyChanged(fingerprint: fp)
        default: return .failed(e.localizedDescription)
        }
    }

    // MARK: 渲染循环

    private func startLoop() {
        loop?.cancel()
        loop = Task { [weak self] in
            while !Task.isCancelled {
                guard let self else { return }
                self.pump()
                try? await Task.sleep(for: .milliseconds(16))
            }
        }
    }

    private func pump() {
        guard let shell else { return }
        var dirty = false
        for event in shell.poll() {
            switch event {
            case .data(let data): term.feed(data: data); dirty = true
            case .eof, .close, .disconnected: state = .closed
            case .exitStatus: break
            }
        }
        if term.tick() { dirty = true }
        for event in term.takeEvents() {
            switch event {
            case .write(let data): try? shell.write(data: data)
            case .title(let t): title = t
            case .resetTitle: title = ""
            default: break
            }
        }
        if dirty {
            rows = term.rows()
            cursor = term.cursor()
        }
    }

    /// 视口尺寸变了(折叠 / 展开 / 软键盘都会触发):同步给本地终端和服务器。
    func resize(cols: Int, rows: Int) {
        guard cols > 0, rows > 0, UInt32(cols) != self.cols || UInt32(rows) != gridRows else { return }
        self.cols = UInt32(cols)
        self.gridRows = UInt32(rows)
        term.resize(cols: self.cols, rows: self.gridRows)
        try? shell?.resize(cols: self.cols, rows: self.gridRows)
        self.rows = term.rows()
        self.cursor = term.cursor()
    }

    // MARK: 输入

    func send(_ text: String) {
        var bytes = Array(text.utf8)
        if ctrlArmed, let first = text.unicodeScalars.first, text.unicodeScalars.count == 1 {
            ctrlArmed = false
            let v = first.value
            if v >= 0x40 && v <= 0x7E { bytes = [UInt8(v & 0x1F)] }
        }
        try? shell?.write(data: Data(bytes))
    }

    enum Key { case esc, tab, up, down, left, right }

    func press(_ key: Key) {
        let app = term.inputModes().appCursor
        let arrow: (String) -> String = { app ? "\u{1B}O\($0)" : "\u{1B}[\($0)" }
        switch key {
        case .esc: send("\u{1B}")
        case .tab: send("\t")
        case .up: send(arrow("A"))
        case .down: send(arrow("B"))
        case .right: send(arrow("C"))
        case .left: send(arrow("D"))
        }
    }

    func disconnect() {
        loop?.cancel()
        session?.disconnect()
    }
}
