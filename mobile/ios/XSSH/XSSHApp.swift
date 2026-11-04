import SwiftUI

@main
struct XSSHApp: App {
    @State private var hosts = HostStore()
    @State private var fold = FoldState()

    var body: some Scene {
        WindowGroup {
            RootView()
                .environment(hosts)
                .environment(fold)
                .background { FoldTracker(state: fold).ignoresSafeArea() }
        }
    }
}

/// 侧栏 = 主机列表,详情 = 终端。窄的时候(外屏)系统自动折成单栈,内屏摊开成两栏,
/// 不按设备类型分支 —— Apple 对 iPhone Duo 的要求就是靠尺寸类自适应。
/// 会话由这里持有:视图被折叠 / 旋转重建时连接不受影响,只有「断开」或换主机才会收掉。
struct RootView: View {
    @Environment(HostStore.self) private var hosts
    @Environment(FoldState.self) private var fold
    @Environment(\.scenePhase) private var scenePhase
    @State private var active: TerminalModel?
    @State private var columns: NavigationSplitViewVisibility = .automatic
    @State private var compactColumn: NavigationSplitViewColumn = .sidebar

    var body: some View {
        NavigationSplitView(columnVisibility: $columns, preferredCompactColumn: $compactColumn) {
            HostsView(activeID: active.flatMap { $0.isEnded ? nil : $0.host.id }, onConnect: open)
                .navigationSplitViewColumnWidth(min: sidebarWidth.min, ideal: sidebarWidth.ideal, max: sidebarWidth.max)
        } detail: {
            Group {
                if let active {
                    TerminalScreen(model: active, onClose: close)
                        .id(active.id)
                } else {
                    ContentUnavailableView("No session", systemImage: "terminal",
                                           description: Text("Pick a host to connect."))
                        // 接缝横着时提示放在上半屏,别跨在折线上。
                        .safeAreaPadding(.bottom, fold.heightBelowSeam)
                }
            }
            // 侧栏是浮在详情上面的玻璃层,详情本身铺满整个窗口。接缝竖着时,
            // 内容从接缝右边缘开始,既不被侧栏盖住,也不压在折线上。
            .safeAreaPadding(.leading, fold.verticalSeam?.maxX ?? 0)
        }
        .onChange(of: scenePhase) { _, phase in active?.setForeground(phase == .active) }
        // 接缝竖着:两栏必须同时可见,列表和终端才各占一半;接缝没了再交还给系统。
        .onChange(of: fold.verticalSeam != nil, initial: true) { _, onSeam in
            columns = onSeam ? .all : .automatic
        }
        // 选了主机之后系统会把侧栏收起来,接缝左边那半屏就空了:收起一次就重新展开,并去掉收起按钮。
        .onChange(of: columns) { _, now in
            if fold.verticalSeam != nil, now != .all { columns = .all }
        }
        .toolbar(removing: fold.verticalSeam != nil ? .sidebarToggle : nil)
        #if DEBUG
        .overlay { SeamOutline() }
        .task { await autoOpenFromLaunchArguments() }
        .onChange(of: active?.state) { _, state in
            // `-autoTrust`:首次连接的主机密钥确认也自动点掉,模拟器里不用手点。
            if case .needsTrust(let fingerprint) = state, DebugLaunch.flag("-autoTrust") {
                active?.trust(fingerprint: fingerprint, store: hosts)
            }
        }
        #endif
    }

    #if DEBUG
    /// `-autoOpen <主机名>`:启动后自动打开那台主机,命令行起的模拟器没法点屏幕时用。
    private func autoOpenFromLaunchArguments() async {
        guard let name = DebugLaunch.value("-autoOpen") else { return }
        try? await Task.sleep(for: .seconds(1))
        if let host = hosts.hosts.first(where: { $0.displayName == name }) { open(host) }
    }
    #endif

    /// 书本姿态(接缝竖着):主机列表正好占满接缝左边那一半。其余情况交给系统自己定宽。
    private var sidebarWidth: (min: CGFloat, ideal: CGFloat, max: CGFloat) {
        if let seam = fold.verticalSeam { return (seam.minX, seam.minX, seam.minX) }
        return (280, 320, 400)
    }

    private func open(_ host: Host) {
        // 点的就是正在跑的那台:直接回到它,别断了重连。
        if let current = active, current.host.id == host.id, !current.isEnded {
            compactColumn = .detail
            return
        }
        active?.disconnect()
        hosts.touch(host)
        active = TerminalModel(host: host, password: hosts.password(for: host), knownKey: hosts.knownKey(host))
        compactColumn = .detail
    }

    private func close() {
        active?.disconnect()
        active = nil
        compactColumn = .sidebar
    }
}

#if DEBUG
/// 调试用启动参数的读取;只在 Debug 构建里存在。
enum DebugLaunch {
    static func flag(_ name: String) -> Bool { ProcessInfo.processInfo.arguments.contains(name) }
    static func value(_ name: String) -> String? {
        let args = ProcessInfo.processInfo.arguments
        guard let i = args.firstIndex(of: name), i + 1 < args.count else { return nil }
        return args[i + 1]
    }
}
#endif
