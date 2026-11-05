import SwiftUI

@main
struct XSSHApp: App {
    @State private var hosts = HostStore()
    @State private var fold = FoldState()
    @State private var splash = true

    var body: some Scene {
        WindowGroup {
            ZStack {
                RootView()
                    .environment(hosts)
                    .environment(fold)
                    .background { FoldTracker(state: fold).ignoresSafeArea() }
                // 开屏:主程序在下面已经加载,这一层停一下就淡出,主程序慢慢露出来。
                if splash {
                    SplashView()
                        .transition(.opacity)
                        .zIndex(1)
                }
            }
            .task {
                #if DEBUG
                if DebugLaunch.flag("-noSplash") { splash = false; return }
                #endif
                try? await Task.sleep(for: .milliseconds(1100))
                withAnimation(.easeInOut(duration: 0.6)) { splash = false }
            }
        }
    }
}

/// 侧栏 = 主机列表,详情 = 终端。窄的时候(外屏)系统自动折成单栈,内屏摊开成两栏,
/// 不按设备类型分支 —— Apple 对 iPhone Duo 的要求就是靠尺寸类自适应;半开时导航容器自己避让折痕,
/// 这里不再手工摆栏宽。只有终端画布这种整块排版的内容才自己避开接缝(见 `FoldState.usableRect`)。
/// 会话由这里持有:视图被折叠 / 旋转重建时连接不受影响,只有「断开」或换主机才会收掉。
struct RootView: View {
    @Environment(HostStore.self) private var hosts
    @Environment(\.scenePhase) private var scenePhase
    @Environment(\.horizontalSizeClass) private var sizeClass
    @State private var active: TerminalModel?
    @State private var addHostRequested = false
    @State private var containerSize: CGSize = .zero
    @State private var columns: NavigationSplitViewVisibility = .automatic
    @State private var compactColumn: NavigationSplitViewColumn = .sidebar

    var body: some View {
        split
            // 容器尺寸只用来判断横 / 竖,必须不受软键盘影响:搜索 / 输入时键盘把可用高度压矮,
            // 竖屏会被误判成横屏,侧栏跟着来回跳(搜索时的过渡不顺就是这个)。所以量一块忽略键盘的背景。
            .background {
                GeometryReader { geo in
                    Color.clear
                        .onChange(of: layoutKey(geo.size), initial: true) { _, _ in
                            containerSize = geo.size
                            updateColumns(geo.size)
                        }
                        .onChange(of: active?.id) { _, _ in updateColumns(geo.size) }
                }
                .ignoresSafeArea(.keyboard)
            }
    }

    /// 横向(宽 > 高)才有地方让主机列表和终端并排;竖向时列表是浮在详情上面的,会盖住居中的内容,
    /// 所以竖向一律先收起列表(空状态里有「主机」按钮可以拉出来)。按容器宽高比判断,不看设备朝向。
    private func layoutKey(_ size: CGSize) -> String { "\(sizeClass == .compact)-\(size.width > size.height)" }

    private func updateColumns(_ size: CGSize) {
        if sizeClass == .compact { columns = .automatic }
        else if size.width > size.height { columns = .all }
        else { columns = .detailOnly }
    }

    private var split: some View {
        NavigationSplitView(columnVisibility: $columns, preferredCompactColumn: $compactColumn) {
            HostsView(activeID: active.flatMap { $0.isEnded ? nil : $0.host.id }, addRequested: $addHostRequested, onConnect: open)
        } detail: {
            if let active {
                TerminalScreen(model: active, onBack: { compactColumn = .sidebar; columns = .all }, onClose: close)
                    .id(active.id)
            } else {
                EmptySessionView(showHosts: columns == .all ? nil : { columns = .all })
                    // 没会话时右侧竖条也要有按钮:内屏上主机列表在左边的侧栏里,详情这一侧的竖条放「新建主机」。
                    .toolbar {
                        ToolbarItem(placement: .bottomBar) {
                            Button("Add Host", systemImage: "plus") { addHostRequested = true }
                        }
                    }
            }
        }
        // 内屏(宽 × 高都是常规尺寸)是 iPad 布局的自然延伸:主机列表常驻在左边,不默认收起。
        // 紧凑 ↔ 常规(合上 ↔ 展开 / 半折)切换时,系统不会给已有的导航容器重新装上竖条工具栏,侧栏状态也会错乱。
        // 按尺寸类重建导航容器;会话和主机数据都在这里(RootView)持有,重建不会断连接。
        .id(sizeClass == .compact)
        // 输入框放在被重建的导航容器外面:姿态切换时它不会被拆掉,焦点和「要不要键盘」都保持。
        .background {
            if let active {
                KeyCapture(model: active, ctrlArmed: active.ctrlArmed,
                           wantsKeyboard: active.wantsKeyboard && !active.showsPrompt)
                    .frame(width: 1, height: 1)
                    .allowsHitTesting(false)
            }
        }
        .onChange(of: scenePhase) { _, phase in active?.setForeground(phase == .active) }
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

    private func open(_ host: Host) {
        // 点的就是正在跑的那台:直接回到它,别断了重连。
        if let current = active, current.host.id == host.id, !current.isEnded {
            compactColumn = .detail
            updateColumns(containerSize)
            return
        }
        active?.disconnect()
        hosts.touch(host)
        active = TerminalModel(host: host, credentials: hosts.credentials(for: host), knownKey: hosts.knownKey(host))
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

