import SwiftUI
import UniformTypeIdentifiers

struct HostsView: View {
    @Environment(HostStore.self) private var store
    @Environment(LaunchGate.self) private var gate
    /// 两栏布局(内屏展开):由外层按整个窗口的尺寸类传进来。不能在这里读 `horizontalSizeClass` ——
    /// 侧栏这一栏自己报的是紧凑,读出来永远是「单栏」,侧栏的背景就变不了色。
    let splitLayout: Bool
    let activeID: UUID?
    /// 正在连着的那台还在「连接中 / 等确认密钥」:行尾显示转圈而不是绿点。
    var activeConnecting = false
    /// 详情那一侧的「新建主机」按钮通过它让这里弹出编辑页。
    @Binding var addRequested: Bool
    let onConnect: (Host) -> Void
    /// 在列表的空白处(不在任何一台主机卡片上、也不在标题区)用力往左一甩 = 收起列表。
    var onCollapse: (() -> Void)?

    @State private var editing: Host?
    @State private var isNew = false
    @State private var pendingDelete: Host?
    @State private var query = ""
    @State private var searching = false
    @FocusState private var searchFocused: Bool
    /// 列表卡片的实际左边缘和宽度(量出来的,不是估的):搜索框按它对齐。
    @State private var cardX: CGFloat?
    @State private var cardWidth: CGFloat?
    @State private var listWidth: CGFloat = 320
    /// 每张主机卡片的底边(整个列表视图坐标系里);所有卡片底边的最大值下面才是「空白处」。
    /// 按主机分别记:删掉最后一台之后,新的最后一台没有布局变化、不会重新量,单记「最后一张」会留着过期的值。
    @State private var rowBottoms: [UUID: CGFloat] = [:]
    private var lastRowBottom: CGFloat { shown.compactMap { rowBottoms[$0.id] }.max() ?? 0 }

    /// 按添加的先后顺序排,点哪台就选中哪台(高亮),列表不会因为连接了某台就把它顶到第一个。
    private var shown: [Host] {
        let q = query.trimmingCharacters(in: .whitespaces)
        return store.hosts.filter {
            q.isEmpty || $0.displayName.localizedCaseInsensitiveContains(q)
                || $0.address.localizedCaseInsensitiveContains(q) || $0.username.localizedCaseInsensitiveContains(q)
        }
    }

    var body: some View {
        ScrollViewReader { proxy in
        List {
            ForEach(shown) { host in
                // 点一下 = 连接;长按 = 弹菜单(系统自带触觉反馈)。
                // 用 `.contextMenu` 带自定义 `preview:`:长按浮起来的是下面那张统一的圆角卡(每一行形状都一样),
                // 不是系统从列表单元格里取的形状(最上 / 最下一行变成胶囊、中间行是方的)。
                // 以前用 `Menu`:内屏的侧栏里菜单一弹出,整栏内容就被盖黑,看起来像「把会话收起来了」。
                Button { onConnect(host) } label: { row(host) }
                    .contentShape(.contextMenuPreview, RoundedRectangle(cornerRadius: splitLayout ? 20 : 12, style: .continuous))
                    .contextMenu {
                        Button("Connect", systemImage: "play") { onConnect(host) }
                        Button("Edit", systemImage: "pencil") { startEditing(host) }
                        Button("Delete", systemImage: "trash", role: .destructive) { pendingDelete = host }
                    }
                .buttonStyle(.plain)
                .foregroundStyle(.primary)
                // 读屏:正在连着的那台报「已选中」(视觉上是更亮 + 描边 + 绿点)。
                .accessibilityAddTraits(host.id == activeID ? .isSelected : [])
                .onGeometryChange(for: CGRect.self) { $0.frame(in: .named("hostsRoot")) } action: {
                    if $0.width > 0 { cardX = $0.minX; cardWidth = $0.width }
                    rowBottoms[host.id] = $0.maxY
                }
                .swipeActions {
                    Button("Delete", role: .destructive) { pendingDelete = host }
                    Button("Edit") { startEditing(host) }.tint(.blue)
                }
                    .listRowBackground(rowBackground(host))
                    .listRowInsets(EdgeInsets())
                    .listRowSeparator(splitLayout ? .hidden : .automatic)
                    // 分割线仍然从文字左边缘开始(和以前一样,和内容里的 16pt 内边距对齐)。
                    .alignmentGuide(.listRowSeparatorLeading) { _ in 16 }
                    .id(host.id)
            }
        }
        // 连上一台时,让列表滚到那张卡片(它在视野外也能看到自己选中了哪台)。
        .onChange(of: activeID) { _, id in
            guard let id else { return }
            withAnimation(.smooth(duration: 0.3)) { proxy.scrollTo(id, anchor: .center) }
        }
        // 紧凑宽度(主页)背景纯黑;展开成两栏时左边这一栏要和右边的会话(终端纯黑)有颜色区分,用深灰。
        .scrollContentBackground(.hidden)
        // 两栏时去掉列表自带的左右边距(约 20pt),卡片才能占满侧栏宽度;窄屏单栏保持系统边距。
        .modifier(SplitListMargins(split: splitLayout))
        .background((splitLayout ? Color.appSidebar : Color.appBackground).ignoresSafeArea())
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
        .coordinateSpace(name: "hostsRoot")
        // 只有从空白处开始的用力左甩才收起列表:滑主机卡片本身(删除 / 编辑)、标题区、会话内容都不算。
        .simultaneousGesture(DragGesture(minimumDistance: 40, coordinateSpace: .named("hostsRoot")).onEnded { v in
            guard splitLayout, onCollapse != nil else { return }
            guard v.startLocation.y > lastRowBottom + 8 else { return }
            if v.translation.width < -140, abs(v.translation.height) < 120, v.predictedEndTranslation.width < -400 {
                onCollapse?()
            }
        })        // 把排版变化告诉开屏:稳定之后开屏才淡出,过渡中间不会再有重排。
        .onGeometryChange(for: CGFloat.self) { $0.safeAreaInsets.trailing } action: { gate.touch(trailingInset: $0) }
        .onGeometryChange(for: CGSize.self) { $0.size } action: { listWidth = $0.width; gate.touch(trailingInset: 0) }
        .navigationTitle("Hosts")
        // 固定的小标题:大标题会在搜索展开时收起,整张列表跟着往上跳一截,过渡就不顺了。
        // 页面左上角直接放横向 logo(不是图标加文字)。系统标题只留给读屏用,不显示。
        .navigationBarTitleDisplayMode(.inline)
        .toolbar(removing: .title)
        // 按钮全走系统工具栏:iPhone Duo 外屏上它们会自动竖到右侧。
        // 放底部工具栏:竖条里顶部那一段紧挨着状态区(灵动岛 / 信号 / 电量),「+」贴上去会和状态图标碰在一起,
        // 按下放大时还会压到它;HIG 里底部工具栏的按钮留在竖条下方,拇指也够得着。
        .toolbar {
            ToolbarItem(placement: .topBarLeading) {
                BrandLockup(height: 19)
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
            .presentationBackground(Color.appBackground)
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
                Group {
                    if activeConnecting {
                        ProgressView().controlSize(.small)
                            .accessibilityLabel(Text("Connecting…"))
                    } else {
                        Label("Running", systemImage: "circle.fill")
                            .labelStyle(.iconOnly).foregroundStyle(.green).font(.caption2)
                            .accessibilityLabel(Text("Running"))
                    }
                }
                .transition(.opacity)
            }
        }
        .animation(.easeOut(duration: 0.2), value: activeConnecting)
        .frame(maxWidth: .infinity, alignment: .leading)
        // 内边距放进行内容里(列表行自己的内边距清零,见 `listRowInsets`):系统长按时只把「行内容」浮起,
        // 内边距在内容外面的话,浮起的就是一块窄了一圈、文字紧贴边缘的长方形,和卡片里的这一行对不上。
        // 两栏时每台主机是一张独立的圆角卡,卡片四周有留白(见 `rowBackground`),文字的内边距要把留白算进去。
        .padding(.horizontal, 16)
        .padding(.vertical, 14)
        // 点击区域只算卡片本身:卡片四周的留白(见 `rowBackground`)不能点,点到缝里会连上旁边那台。
        .contentShape(Rectangle())
        .padding(.horizontal, cardInset)
        .padding(.vertical, splitLayout ? Self.cardGap / 2 : 0)
    }

    static let cardGap: CGFloat = 8
    /// 两栏时卡片宽 = 侧栏宽的 94%,左右各留 3%(参考图里卡片和分界线之间就是这么一条窄缝)。
    /// 按侧栏实际宽度算,拖动改宽后比例不变。列表自带的左右边距已去掉(见 `SplitListMargins`)。
    private var cardInset: CGFloat { splitLayout ? listWidth * 0.03 : 0 }

    /// 一屏窄的时候是一整张圆角卡里分行(行间有细线);两栏时(内屏)是一台一张独立的圆角卡,
    /// 卡与卡之间露出侧栏底色,连着的那台卡片更亮并描边。
    @ViewBuilder private func rowBackground(_ host: Host) -> some View {
        if splitLayout {
            let on = host.id == activeID
            let shape = RoundedRectangle(cornerRadius: 20, style: .continuous)
            shape.fill(on ? Color.appSidebarSelected : Color.appSidebarCard)
                .overlay { shape.strokeBorder(Color.primary.opacity(on ? 0.2 : 0), lineWidth: 1) }
                .animation(.easeOut(duration: 0.2), value: on)
                .padding(.horizontal, cardInset)
                .padding(.vertical, Self.cardGap / 2)
        } else {
            Color.appCard
        }
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
        // 左右边缘和宽度都取自下面列表卡片的实际位置(靠竖条那一侧边距更小,固定边距会对不齐);
        // 还没有卡片(列表为空)时退回到系统的场景边距。
        .modifier(MatchCard(x: cardX.map { $0 + (splitLayout ? cardInset : 0) }, width: cardWidth.map { $0 - (splitLayout ? cardInset * 2 : 0) }))
        .padding(.vertical, 8)
    }

    private func startAdding() { isNew = true; editing = Host() }
    private func startEditing(_ host: Host) { isNew = false; editing = host }
}

private struct SplitListMargins: ViewModifier {
    let split: Bool
    func body(content: Content) -> some View {
        if split { content.contentMargins(.horizontal, 0, for: .scrollContent) } else { content }
    }
}

private struct MatchCard: ViewModifier {
    let x: CGFloat?
    let width: CGFloat?
    func body(content: Content) -> some View {
        if let x, let width {
            content.frame(width: width).frame(maxWidth: .infinity, alignment: .leading).padding(.leading, x)
        } else {
            content.scenePadding(.horizontal)
        }
    }
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
                        // 数字键盘(numberPad)没有回车键,收键盘就得另放一个浮在键盘上方的「完成」,它的位置系统说了算:
                        // 右边缘既不对齐表单也不对齐右侧竖条,还盖住下面的内容。用带回车键的数字 / 符号键盘,回车键就是「完成」。
                        .keyboardType(.numbersAndPunctuation)
                        .focused($focus, equals: .port).submitLabel(.done)
                        .onSubmit { applyTarget(); focus = nil }
                } footer: {
                    if !portText.isEmpty, port == nil {
                        Text("Port must be between 1 and 65535.").foregroundStyle(.red)
                    }
                }
                .listRowBackground(Color.appCard)
                Section {
                    TextField("User", text: $host.username)
                        .textInputAutocapitalization(.never).autocorrectionDisabled()
                        .textContentType(.username)
                        .focused($focus, equals: .user).submitLabel(.next)
                        .onSubmit { focus = host.authKind == .password ? .password : nil }
                    AuthKindPicker(selection: $host.authKind)
                    if host.authKind == .password {
                        SecureField("Password", text: $credentials.password)
                            .textContentType(.password)
                            .focused($focus, equals: .password).submitLabel(.done)
                            .onSubmit { focus = nil }
                    }
                }
                .listRowBackground(Color.appCard)
                if host.authKind == .key { keySection }
            }
            .scrollContentBackground(.hidden)
            .background(Color.appBackground)
            // 上下拖表单就收键盘(各个输入框的回车键也都能收),不再需要键盘上方那颗悬浮的「完成」。
            .scrollDismissesKeyboard(.interactively)
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
            }
            #if DEBUG
            .task {
                // `-autoFocus <字段>`:编辑页打开后让那个字段拿到焦点(弹出键盘),模拟器里核对键盘上方的「完成」用。
                try? await Task.sleep(for: .seconds(1.2))
                switch DebugLaunch.value("-autoFocus") {
                case "address": focus = .address
                case "port": focus = .port
                case "user": focus = .user
                case "name": focus = .name
                default: break
                }
            }
            #endif
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
                .listRowBackground(Color.appCard)
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

/// 「密码 / 私钥」切换。系统分段控件整体高约 31.4pt、没法单独调高,这里自己画:整体 34.5pt(高 10%),
/// 同样的胶囊形,选中那一格是高亮的胶囊。
private struct AuthKindPicker: View {
    @Binding var selection: AuthKind
    /// 每一格的高度。整个控件 = 38 + 上下内边距各 2 = 42pt(系统分段控件约 31.4pt → 34.5 → 38 → 40 → 42pt)。
    static let height: CGFloat = 38
    @Namespace private var pill

    var body: some View {
        HStack(spacing: 0) {
            option("Password", .password)
            option("Private Key", .key)
        }
        .padding(2)
        .background(Capsule().fill(Color.primary.opacity(0.08)))
        .accessibilityElement(children: .contain)
    }

    private func option(_ title: LocalizedStringKey, _ kind: AuthKind) -> some View {
        let on = selection == kind
        return Button { withAnimation(.smooth(duration: 0.2)) { selection = kind } } label: {
            Text(title)
                .font(.subheadline.weight(on ? .semibold : .regular))
                .foregroundStyle(Color.primary)
                .frame(maxWidth: .infinity)
                .frame(height: Self.height)
                .background {
                    if on { Capsule().fill(Color.primary.opacity(0.16)).matchedGeometryEffect(id: "pill", in: pill) }
                }
                .contentShape(Capsule())
        }
        .buttonStyle(.plain)
        .accessibilityAddTraits(on ? [.isButton, .isSelected] : .isButton)
    }
}
