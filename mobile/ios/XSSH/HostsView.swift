import SwiftUI
import UniformTypeIdentifiers

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
    @State private var searching = false
    @FocusState private var searchFocused: Bool

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
        // 自己的搜索框,不用系统的 `.searchable`:系统搜索展开时整个标题区收起 / 重排,列表跟着跳,过渡不连贯。
        // 这里点一下搜索钮,顶部滑出一个搜索框,列表跟着平滑下移,标题和右侧竖条纹丝不动。
        .safeAreaInset(edge: .top, spacing: 0) {
            if searching { searchField.transition(.move(edge: .top).combined(with: .opacity)) }
        }
        .animation(.smooth(duration: 0.25), value: searching)
        .navigationTitle("Hosts")
        // 固定的小标题:大标题会在搜索展开时收起,整张列表跟着往上跳一截,过渡就不顺了。
        // 页面左上角是品牌:logo + 名字。(系统标题只留给读屏用,不显示。)
        .navigationBarTitleDisplayMode(.inline)
        .toolbar(removing: .title)
        // 按钮全走系统工具栏:iPhone Duo 外屏上它们会自动竖到右侧。
        // 放底部工具栏:竖条里顶部那一段紧挨着状态区(灵动岛 / 信号 / 电量),「+」贴上去会和状态图标碰在一起,
        // 按下放大时还会压到它;HIG 里底部工具栏的按钮留在竖条下方,拇指也够得着。
        .toolbar {
            ToolbarItem(placement: .topBarLeading) {
                HStack(spacing: 10) {
                    BrandMark(size: 34)
                    Text(verbatim: "X-SSH").font(.title3.weight(.semibold))
                }
                .fixedSize()
                .accessibilityElement(children: .combine)
                .accessibilityLabel(Text("Hosts"))
            }
            .sharedBackgroundVisibility(.hidden)
            ToolbarItem(placement: .bottomBar) {
                Button(searching ? "Close Search" : "Search", systemImage: searching ? "xmark" : "magnifyingglass") {
                    searching.toggle()
                    if searching { searchFocused = true } else { query = ""; searchFocused = false }
                }
            }
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
            HostEditor(host: host, credentials: isNew ? Credentials() : store.credentials(for: host)) { saved, credentials in
                store.save(saved, credentials: credentials)
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

    private var searchField: some View {
        HStack(spacing: 8) {
            Image(systemName: "magnifyingglass").foregroundStyle(.secondary)
            TextField("Search hosts", text: $query)
                .textInputAutocapitalization(.never).autocorrectionDisabled()
                .focused($searchFocused).submitLabel(.search)
            if !query.isEmpty {
                Button("Clear", systemImage: "xmark.circle.fill") { query = "" }
                    .labelStyle(.iconOnly).foregroundStyle(.secondary).buttonStyle(.plain)
            }
        }
        .padding(.horizontal, 14)
        .frame(minHeight: 44)
        .background(.regularMaterial, in: Capsule())
        // 和下面的列表卡片同一套左右边距:靠竖条那一侧边距更小,固定的 16 会让搜索框和卡片边缘对不齐。
        .scenePadding(.horizontal)
        .padding(.vertical, 8)
    }

    private func startAdding() { isNew = true; editing = Host() }
    private func startEditing(_ host: Host) { isNew = false; editing = host }
}

struct HostEditor: View {
    private enum Field { case name, address, port, user, password, passphrase }

    @Environment(\.dismiss) private var dismiss
    @Environment(\.horizontalSizeClass) private var sizeClass
    @State private var host: Host
    @State private var portText: String
    @State private var credentials: Credentials
    @State private var keyInfo: KeyInfo?
    @State private var keyProblem: String?
    @State private var importing = false
    @State private var copied = false
    @State private var saveFailed = false
    @FocusState private var focus: Field?
    let onSave: (Host, Credentials) -> Bool

    init(host: Host, credentials: Credentials, onSave: @escaping (Host, Credentials) -> Bool) {
        _host = State(initialValue: host)
        _portText = State(initialValue: String(host.port))
        _credentials = State(initialValue: credentials)
        _keyInfo = State(initialValue: Self.inspect(credentials))
        self.onSave = onSave
    }

    private var port: Int? { Int(portText).flatMap { Host.portRange.contains($0) ? $0 : nil } }
    private var canSave: Bool {
        var h = host
        h.port = port ?? 0
        guard h.normalized().isValid else { return false }
        return host.authKind == .password || keyInfo != nil
    }

    private static func inspect(_ c: Credentials) -> KeyInfo? {
        guard !c.privateKey.isEmpty else { return nil }
        return try? inspectKey(pem: c.privateKey, passphrase: c.passphrase.isEmpty ? nil : c.passphrase)
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
                        .onSubmit { focus = host.authKind == .password ? .password : nil }
                    Picker("Authentication", selection: $host.authKind) {
                        Text("Password").tag(AuthKind.password)
                        Text("Private Key").tag(AuthKind.key)
                    }
                    .pickerStyle(.segmented)
                    if host.authKind == .password {
                        SecureField("Password", text: $credentials.password)
                            .textContentType(.password)
                            .focused($focus, equals: .password).submitLabel(.done)
                            .onSubmit { focus = nil }
                    }
                }
                if host.authKind == .key { keySection }
            }
            .navigationTitle(host.displayName.isEmpty ? String(localized: "New Host") : host.displayName)
            .navigationBarTitleDisplayMode(.inline)
            .fileImporter(isPresented: $importing, allowedContentTypes: [.data, .plainText]) { result in
                importKey(from: result)
            }
            .toolbar {
                // 外屏(紧凑宽度)上弹层的按钮竖排进竖条:放底部工具栏,也就是右下角,和主机页一致;
                // 竖条最上面一格紧挨状态区,按钮放那儿会碰到状态图标。内屏居中弹层用同一套(也报紧凑宽度)。
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
                Text("The host or its credentials couldn't be stored. Try again.")
            }
        }
    }

    // MARK: 私钥

    @ViewBuilder private var keySection: some View {
        Section {
            if let info = keyInfo {
                VStack(alignment: .leading, spacing: 4) {
                    Text(verbatim: info.algorithm).font(.subheadline.weight(.semibold))
                    Text(verbatim: info.fingerprint).font(.caption.monospaced()).foregroundStyle(.secondary)
                        .textSelection(.enabled)
                }
                Text(verbatim: info.publicKey).font(.caption.monospaced()).lineLimit(3)
                    .textSelection(.enabled)
                Button(copied ? "Copied" : "Copy Public Key", systemImage: copied ? "checkmark" : "square.on.square") {
                    UIPasteboard.general.string = info.publicKey
                    copied = true
                    Task { try? await Task.sleep(for: .seconds(2)); copied = false }
                }
            } else {
                Text(keyProblem ?? String(localized: "No key yet. Generate one, or import an existing private key."))
                    .font(.footnote).foregroundStyle(keyProblem == nil ? Color.secondary : Color.red)
            }
            SecureField("Key passphrase (optional)", text: $credentials.passphrase)
                .focused($focus, equals: .passphrase).submitLabel(.done)
                .onSubmit { focus = nil; refreshKeyInfo() }
                .onChange(of: credentials.passphrase) { _, _ in refreshKeyInfo() }
            // 一行一个按钮:三个并排在窄的弹层里会把文字挤成竖排。
            Button("Generate", systemImage: "key", action: generate)
            Button("Import…", systemImage: "arrow.down.doc") { importing = true }
            Button("Paste", systemImage: "clipboard", action: pasteKey)
        } header: {
            Text("Private Key")
        } footer: {
            Text("The key is stored in the Keychain on this device. Add the public key to ~/.ssh/authorized_keys on the server.")
        }
    }

    private func refreshKeyInfo() {
        guard !credentials.privateKey.isEmpty else { keyInfo = nil; return }
        do {
            keyInfo = try inspectKey(pem: credentials.privateKey,
                                     passphrase: credentials.passphrase.isEmpty ? nil : credentials.passphrase)
            keyProblem = nil
        } catch let e as FfiError {
            keyInfo = nil
            if case .KeyEncrypted = e { keyProblem = String(localized: "This key is protected. Enter its passphrase below.") }
            else { keyProblem = String(localized: "Couldn't read this key: \(e.userMessage)") }
        } catch {
            keyInfo = nil
            keyProblem = String(localized: "Couldn't read this key: \(error.localizedDescription)")
        }
    }

    private func generate() {
        focus = nil
        do {
            let g = try generateKey(comment: "x-ssh-ios", passphrase: credentials.passphrase.isEmpty ? nil : credentials.passphrase)
            credentials.privateKey = g.pem
            keyInfo = g.info
            keyProblem = nil
            #if DEBUG
            NSLog("GENERATED_PUBKEY %@", g.info.publicKey)
            #endif
        } catch {
            keyInfo = nil
            keyProblem = String(localized: "Couldn't generate a key: \(error.localizedDescription)")
        }
    }

    private func pasteKey() {
        guard let text = UIPasteboard.general.string, !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
            keyProblem = String(localized: "The clipboard is empty.")
            return
        }
        credentials.privateKey = text
        refreshKeyInfo()
    }

    private func importKey(from result: Result<URL, Error>) {
        switch result {
        case .failure(let e):
            keyProblem = String(localized: "Couldn't read this key: \(e.localizedDescription)")
        case .success(let url):
            let scoped = url.startAccessingSecurityScopedResource()
            defer { if scoped { url.stopAccessingSecurityScopedResource() } }
            guard let data = try? Data(contentsOf: url), data.count < 64 * 1024,
                  let text = String(data: data, encoding: .utf8) else {
                keyProblem = String(localized: "That file doesn't look like a private key.")
                return
            }
            credentials.privateKey = text
            refreshKeyInfo()
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
        if onSave(h, credentials) { dismiss() } else { saveFailed = true }
    }
}
