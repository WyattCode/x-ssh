import SwiftUI

@main
struct XSSHApp: App {
    @State private var hosts = HostStore()

    var body: some Scene {
        WindowGroup {
            RootView()
                .environment(hosts)
        }
    }
}

/// 侧栏 = 主机列表,详情 = 终端。窄的时候(外屏)系统自动折成单栈,内屏摊开成两栏,
/// 不按设备类型分支 —— Apple 对 iPhone Duo 的要求就是靠尺寸类自适应。
/// 会话由这里持有:视图被折叠 / 旋转重建时连接不受影响,只有「断开」或换主机才会收掉。
struct RootView: View {
    @Environment(HostStore.self) private var hosts
    @Environment(\.scenePhase) private var scenePhase
    @State private var active: TerminalModel?
    @State private var columns: NavigationSplitViewVisibility = .automatic
    @State private var compactColumn: NavigationSplitViewColumn = .sidebar

    var body: some View {
        NavigationSplitView(columnVisibility: $columns, preferredCompactColumn: $compactColumn) {
            HostsView(activeID: active.flatMap { $0.isEnded ? nil : $0.host.id }, onConnect: open)
        } detail: {
            if let active {
                TerminalScreen(model: active, onClose: close)
                    .id(active.id)
            } else {
                ContentUnavailableView("No session", systemImage: "terminal",
                                       description: Text("Pick a host to connect."))
            }
        }
        .onChange(of: scenePhase) { _, phase in active?.setForeground(phase == .active) }
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
