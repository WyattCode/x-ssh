import SwiftUI

struct HostsView: View {
    @Environment(HostStore.self) private var store
    let activeID: UUID?
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
                    Button("Add Host") { startAdding() }.buttonStyle(.borderedProminent)
                }
            } else if shown.isEmpty {
                ContentUnavailableView.search(text: query)
            }
        }
        .searchable(text: $query, prompt: Text("Search hosts"))
        .navigationTitle("Hosts")
        // 按钮全走系统工具栏:iPhone Duo 外屏上它们会自动竖到右侧。
        .toolbar {
            ToolbarItem(placement: .primaryAction) {
                Button("Add Host", systemImage: "plus") { startAdding() }
            }
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
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel", systemImage: "xmark") { dismiss() }
                }
                ToolbarItem(placement: .topBarPinnedTrailing) {
                    Button("Save", systemImage: "checkmark", action: save).disabled(!canSave)
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
