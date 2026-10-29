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
struct RootView: View {
    @Environment(HostStore.self) private var hosts
    @State private var active: TerminalModel?
    @State private var columns: NavigationSplitViewVisibility = .automatic
    @State private var compactDetail: NavigationSplitViewColumn = .sidebar

    var body: some View {
        NavigationSplitView(columnVisibility: $columns, preferredCompactColumn: $compactDetail) {
            HostsView { host in
                active = TerminalModel(host: host, password: hosts.password(for: host))
                compactDetail = .detail
            }
        } detail: {
            if let active {
                TerminalScreen(model: active)
                    .id(active.id)
            } else {
                ContentUnavailableView("No session", systemImage: "terminal",
                                       description: Text("Pick a host to connect."))
            }
        }
    }
}
