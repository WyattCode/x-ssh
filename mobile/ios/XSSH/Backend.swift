import Foundation

/// 所有碰 Rust 核心的调用都在这条串行队列上:`write` / `resize` / `disconnect` 里是 `block_on`,
/// 断网时最长等 10 秒,而且持着通道锁、`poll` 也跟着停 —— 放在主线程就是整个界面卡死。
/// 界面只拿到打包好的帧(屏幕行 + 光标),在主线程画。
final class Backend: @unchecked Sendable {
    enum Output {
        case frame(rows: [ScreenRow], cursor: CursorState)
        case title(String)
        case closed(exitStatus: UInt32?)
        case clipboard(String)
        case bell
    }

    private let queue = DispatchQueue(label: "dev.xssh.io", qos: .userInteractive)
    private let lock = NSLock()

    // 下面这些只在 queue 上读写(term 例外,见 `currentTerm`)。
    private var session: Session?
    private var shell: Shell?
    private var _term = Term(cols: 80, rows: 24)
    private var running = false
    private var paused = false
    private var needsFrame = false
    private var exitStatus: UInt32?

    // lock 保护:连接代数(取消 / 重连时旧的尝试作废)、有没有帧还没被界面取走。
    private var generation = 0
    private var framePending = false

    var onOutput: (@Sendable (Output) -> Void)?

    init() { TermTheme.apply(to: _term) }

    /// 输入模式要从主线程同步读(方向键用 SS3 还是 CSI、粘贴要不要括起来)。
    var currentTerm: Term { lock.lock(); defer { lock.unlock() }; return _term }
    private func setTerm(_ t: Term) { lock.lock(); _term = t; lock.unlock() }

    private func bump() -> Int { lock.lock(); defer { lock.unlock() }; generation += 1; return generation }
    private func isCurrent(_ g: Int) -> Bool { lock.lock(); defer { lock.unlock() }; return g == generation }

    func connect(_ config: HostConfig, cols: UInt32, rows: UInt32, cellPixels: (UInt32, UInt32),
                 completion: @escaping @Sendable (Result<Void, Error>) -> Void) {
        let gen = bump()
        queue.async { [self] in
            tearDown()
            let term = Term(cols: cols, rows: rows)
            TermTheme.apply(to: term)
            term.setCellPixels(width: cellPixels.0, height: cellPixels.1)
            setTerm(term)
            exitStatus = nil
            do {
                let session = try Session.connect(config: config)
                let shell = try session.openShell(cols: cols, rows: rows, term: "xterm-256color")
                // 连接期间用户已经取消 / 换了一次连接:别留下一条没人管的会话。
                guard isCurrent(gen) else { session.disconnect(); return }
                self.session = session
                self.shell = shell
                running = true
                completion(.success(()))
                scheduleTick(gen)
            } catch {
                guard isCurrent(gen) else { return }
                completion(.failure(error))
            }
        }
    }

    func shutdown() {
        _ = bump()
        queue.async { [self] in tearDown() }
    }

    private func tearDown() {
        running = false
        shell = nil
        if let session { session.disconnect() }
        session = nil
    }

    func setPaused(_ value: Bool) { queue.async { [self] in paused = value } }

    func ackFrame() { lock.lock(); framePending = false; lock.unlock() }

    func send(_ data: Data) {
        queue.async { [self] in
            guard let shell else { return }
            let term = currentTerm
            if term.scrollOffset() > 0 { term.scrollToBottom(); needsFrame = true }
            try? shell.write(data: data)
        }
    }

    func resize(cols: UInt32, rows: UInt32, cellPixels: (UInt32, UInt32)) {
        queue.async { [self] in
            let term = currentTerm
            term.resize(cols: cols, rows: rows)
            term.setCellPixels(width: cellPixels.0, height: cellPixels.1)
            try? shell?.resize(cols: cols, rows: rows)
            needsFrame = true
        }
    }

    func scroll(lines: Int32) {
        queue.async { [self] in currentTerm.scroll(lines: lines); needsFrame = true }
    }

    // MARK: 轮询

    private func scheduleTick(_ gen: Int) {
        let delay: DispatchTimeInterval = paused ? .milliseconds(250) : .milliseconds(16)
        queue.asyncAfter(deadline: .now() + delay) { [self] in
            guard running, isCurrent(gen) else { return }
            tick()
            if running { scheduleTick(gen) }
        }
    }

    private func tick() {
        guard let shell else { return }
        let term = currentTerm
        var dirty = needsFrame
        var closed = false
        for event in shell.poll() {
            switch event {
            case .data(let data): term.feed(data: data); dirty = true
            case .eof, .close, .disconnected: closed = true
            case .exitStatus(let s): exitStatus = s
            }
        }
        if term.tick() { dirty = true }
        for event in term.takeEvents() {
            switch event {
            case .write(let data): try? shell.write(data: data)
            case .title(let t): onOutput?(.title(t))
            case .resetTitle: onOutput?(.title(""))
            case .bell: onOutput?(.bell)
            case .clipboardStore(let text): onOutput?(.clipboard(text))
            }
        }
        if dirty || closed {
            lock.lock()
            let free = !framePending || closed
            if free { framePending = true }
            lock.unlock()
            if free {
                needsFrame = false
                onOutput?(.frame(rows: term.rows(), cursor: term.cursor()))
            } else {
                needsFrame = true
            }
        }
        if closed {
            running = false
            onOutput?(.closed(exitStatus: exitStatus))
        }
    }
}
