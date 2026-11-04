import SwiftUI

struct HostsView: View {
    @Environment(HostStore.self) private var store
    let activeID: UUID?
    /// 详情那一侧的「新建主机」按钮通过它让这里弹出编辑页。
    @Binding var addRequested: Bool
    let onConnect: (Host) -> Void

    @State private var editing: Host?
    @State private var isNew = false
    @State private var pendingDelete: Host?
    @State private var query = ""

    /// 最近用过的在前,没用过的按名字排。
    private var shown: [Host] {
        let q = query.trimmingCharacters(in: .whitespaces)
        return store.hosts
            .filter { q.isEmpty || $0.displayName.localizedCaseInsensitiveContains(q)
                || $0.address.localizedCaseInsensitiveContains(q) || $0.username.localizedCaseInsensitiveContains(q) }
            .sorted {
                switch ($0.lastUsed, $1.lastUsed) {
                case let (a?, b?): a > b
                case (_?, nil): true
                case (nil, _?): false
                default: $0.displayName.localizedCaseInsensitiveCompare($1.displayName) == .orderedAscending
                }
            }
    }

    var body: some View {
        List {
            ForEach(shown) { host in
                Button { onConnect(host) } label: { row(host) }
                    .buttonStyle(.plain)
                    .swipeActions {
                        Button("Delete", role: .destructive) { pendingDelete = host }
                        Button("Edit") { startEditing(host) }.tint(.blue)
                    }
                    .contextMenu {
                        Button("Connect", systemImage: "play") { onConnect(host) }
                        Button("Edit", systemImage: "pencil") { startEditing(host) }
                        Button("Delete", systemImage: "trash", role: .destructive) { pendingDelete = host }
                    }
            }
        }
        .overlay {
            if store.hosts.isEmpty {
                ContentUnavailableView {
                    Label("No Hosts", systemImage: "server.rack")
                } description: {
                    Text("Add a host to get started.")
                } actions: {
                    Button("Add Host") { startAdding() }.buttonStyle(.borderedProminent).controlSize(.large)
                }
            } else if shown.isEmpty {
                ContentUnavailableView.search(text: query)
            }
        }
        .searchable(text: $query, prompt: Text("Search hosts"))
        .navigationTitle("Hosts")
        // 按钮全走系统工具栏:iPhone Duo 外屏上它们会自动竖到右侧。
        // 放底部工具栏:竖条里顶部那一段紧挨着状态区(灵动岛 / 信号 / 电量),「+」贴上去会和状态图标碰在一起,
        // 按下放大时还会压到它;HIG 里底部工具栏的按钮留在竖条下方,拇指也够得着。
        .toolbar {
            // 搜索也显式放底部,和「+」由系统分开排位;只放「+」时搜索按钮会被它占掉。
            DefaultToolbarItem(kind: .search, placement: .bottomBar)
            ToolbarItem(placement: .bottomBar) {
                Button("Add Host", systemImage: "plus") { startAdding() }
            }
        }
        #if DEBUG
        // `-autoNewHost` / `-autoEditHost <名字>`:启动后直接弹出编辑页,命令行起的模拟器里核对弹层布局用。
        .task {
            try? await Task.sleep(for: .seconds(1))
            if DebugLaunch.flag("-autoNewHost") { startAdding() }
            else if let name = DebugLaunch.value("-autoEditHost"),
                    let host = store.hosts.first(where: { $0.displayName == name }) { startEditing(host) }
        }
        #endif
        .onChange(of: addRequested) { _, requested in
            if requested { addRequested = false; startAdding() }
        }
        .sheet(item: $editing) { host in
            HostEditor(host: host, password: isNew ? "" : store.password(for: host)) { saved, password in
                store.save(saved, password: password)
            }
        }
        .alert("Delete Host?", isPresented: Binding(get: { pendingDelete != nil },
                                                     set: { if !$0 { pendingDelete = nil } }),
               presenting: pendingDelete) { host in
            Button("Cancel", role: .cancel) {}
            Button("Delete", role: .destructive) { store.delete(host) }
        } message: { host in
            Text("“\(host.displayName)” and its saved password will be removed.")
        }
    }

    private func row(_ host: Host) -> some View {
        HStack(spacing: 10) {
            VStack(alignment: .leading, spacing: 2) {
                Text(verbatim: host.displayName).font(.headline)
                Text(verbatim: "\(host.username)@\(host.address):" + String(host.port))
                    .font(.caption.monospaced()).foregroundStyle(.secondary)
            }
            Spacer(minLength: 0)
            if host.id == activeID {
                Label("Running", systemImage: "circle.fill")
                    .labelStyle(.iconOnly).foregroundStyle(.green).font(.caption2)
                    .accessibilityLabel(Text("Running"))
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .contentShape(Rectangle())
    }

    private func startAdding() { isNew = true; editing = Host() }
    private func startEditing(_ host: Host) { isNew = false; editing = host }
}

struct HostEditor: View {
    private enum Field { case name, address, port, user, password }

    @Environment(\.dismiss) private var dismiss
    @Environment(\.horizontalSizeClass) private var sizeClass
    @State private var host: Host
    @State private var portText: String
    @State private var password: String
    @State private var saveFailed = false
    @FocusState private var focus: Field?
    let onSave: (Host, String) -> Bool

    init(host: Host, password: String, onSave: @escaping (Host, String) -> Bool) {
        _host = State(initialValue: host)
        _portText = State(initialValue: String(host.port))
        _password = State(initialValue: password)
        self.onSave = onSave
    }

    private var port: Int? { Int(portText).flatMap { Host.portRange.contains($0) ? $0 : nil } }
    private var canSave: Bool {
        var h = host
        h.port = port ?? 0
        return h.normalized().isValid
    }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    TextField("Name", text: $host.name)
                        .focused($focus, equals: .name).submitLabel(.next)
                        .onSubmit { focus = .address }
                    TextField("Address", text: $host.address)
                        .textInputAutocapitalization(.never).autocorrectionDisabled()
                        .keyboardType(.URL).textContentType(.URL)
                        .focused($focus, equals: .address).submitLabel(.next)
                        .onSubmit { applyTarget(); focus = .port }
                    TextField("Port", text: $portText)
                        .keyboardType(.numberPad)
                        .focused($focus, equals: .port)
                } footer: {
                    if !portText.isEmpty, port == nil {
                        Text("Port must be between 1 and 65535.").foregroundStyle(.red)
                    }
                }
                Section {
                    TextField("User", text: $host.username)
                        .textInputAutocapitalization(.never).autocorrectionDisabled()
                        .textContentType(.username)
                        .focused($focus, equals: .user).submitLabel(.next)
                        .onSubmit { focus = .password }
                    SecureField("Password", text: $password)
                        .textContentType(.password)
                        .focused($focus, equals: .password).submitLabel(.done)
                        .onSubmit { focus = nil }
                }
            }
            .navigationTitle(host.displayName.isEmpty ? String(localized: "New Host") : host.displayName)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                // 外屏(紧凑宽度)上弹层的按钮竖排进竖条:放底部工具栏,也就是右下角,和主机页一致;
                // 竖条最上面一格紧挨状态区,按钮放那儿会碰到状态图标。内屏弹层居中,用标准的顶部按钮。
                if sizeClass == .compact {
                    // 竖条里弹性空白是零尺寸;弹层是横向底栏时(内屏居中弹层)把这组按钮推到右下角。
                    ToolbarSpacer(.flexible, placement: .bottomBar)
                    ToolbarItem(placement: .bottomBar) {
                        Button("Cancel", systemImage: "xmark") { dismiss() }
                    }
                    ToolbarItem(placement: .bottomBar) {
                        Button("Save", systemImage: "checkmark", action: save).disabled(!canSave)
                    }
                } else {
                    ToolbarItem(placement: .cancellationAction) {
                        Button("Cancel", systemImage: "xmark") { dismiss() }
                    }
                    ToolbarItem(placement: .topBarPinnedTrailing) {
                        Button("Save", systemImage: "checkmark", action: save).disabled(!canSave)
                    }
                }
                // 数字键盘没有回车键,得给个收起的地方。
                ToolbarItemGroup(placement: .keyboard) {
                    Spacer()
                    Button("Done") { focus = nil }
                }
            }
            .alert("Couldn't Save", isPresented: $saveFailed) {
                Button("OK", role: .cancel) {}
            } message: {
                Text("The host or its password couldn't be stored. Try again.")
            }
        }
    }

    /// 地址里写了 `user@host:port` 就拆到各自的框里。
    private func applyTarget() {
        var h = host
        h.port = port ?? h.port
        let n = h.normalized()
        host.address = n.address
        if host.username.isEmpty { host.username = n.username }
        if n.port != h.port || port == nil { portText = String(n.port) }
    }

    private func save() {
        applyTarget()
        var h = host
        h.port = port ?? 0
        if onSave(h, password) { dismiss() } else { saveFailed = true }
    }
}
