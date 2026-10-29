import SwiftUI

struct HostsView: View {
    @Environment(HostStore.self) private var store
    @State private var editing: Host?
    @State private var isNew = false
    let onConnect: (Host) -> Void

    var body: some View {
        List {
            ForEach(store.hosts) { host in
                Button { onConnect(host) } label: {
                    VStack(alignment: .leading, spacing: 2) {
                        Text(host.name.isEmpty ? host.address : host.name).font(.headline)
                        Text(verbatim: "\(host.username)@\(host.address):" + String(host.port))
                            .font(.caption.monospaced()).foregroundStyle(.secondary)
                    }
                }
                .swipeActions {
                    Button("Delete", role: .destructive) { store.delete(host) }
                    Button("Edit") { isNew = false; editing = host }.tint(.blue)
                }
            }
        }
        .overlay {
            if store.hosts.isEmpty {
                ContentUnavailableView("No hosts", systemImage: "server.rack",
                                       description: Text("Tap + to add one."))
            }
        }
        .navigationTitle("Hosts")
        // 按钮全走系统工具栏:iPhone Duo 外屏上它们会自动竖到右侧。
        .toolbar {
            ToolbarItem(placement: .primaryAction) {
                Button("Add Host", systemImage: "plus") { isNew = true; editing = Host() }
            }
        }
        .sheet(item: $editing) { host in
            HostEditor(host: host, password: isNew ? "" : store.password(for: host)) { saved, pw in
                store.save(saved, password: pw)
            }
        }
    }
}

struct HostEditor: View {
    @Environment(\.dismiss) private var dismiss
    @State var host: Host
    @State var password: String
    let onSave: (Host, String) -> Void

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    TextField("Name", text: $host.name)
                    TextField("Address", text: $host.address)
                        .textInputAutocapitalization(.never).autocorrectionDisabled()
                    TextField("Port", value: $host.port, format: .number.grouping(.never))
                        .keyboardType(.numberPad)
                }
                Section {
                    TextField("User", text: $host.username)
                        .textInputAutocapitalization(.never).autocorrectionDisabled()
                    SecureField("Password", text: $password)
                }
            }
            .navigationTitle(host.name.isEmpty ? "New Host" : host.name)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel", systemImage: "xmark") { dismiss() }
                }
                ToolbarItem(placement: .topBarPinnedTrailing) {
                    Button("Save", systemImage: "checkmark") { onSave(host, password); dismiss() }
                        .disabled(host.address.isEmpty || host.username.isEmpty)
                }
            }
        }
    }
}
