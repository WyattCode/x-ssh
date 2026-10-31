import Foundation
import Security

struct Host: Identifiable, Codable, Hashable {
    var id = UUID()
    var name = ""
    var address = ""
    var port = 22
    var username = ""
    var lastUsed: Date?

    init(id: UUID = UUID(), name: String = "", address: String = "", port: Int = 22,
         username: String = "", lastUsed: Date? = nil) {
        self.id = id
        self.name = name
        self.address = address
        self.port = port
        self.username = username
        self.lastUsed = lastUsed
    }

    /// 每个字段都容忍缺失:以后加字段不会让旧文件整个解码失败(解码失败 = 主机列表看起来被清空)。
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = (try? c.decode(UUID.self, forKey: .id)) ?? UUID()
        name = (try? c.decode(String.self, forKey: .name)) ?? ""
        address = (try? c.decode(String.self, forKey: .address)) ?? ""
        port = (try? c.decode(Int.self, forKey: .port)) ?? 22
        username = (try? c.decode(String.self, forKey: .username)) ?? ""
        lastUsed = try? c.decode(Date.self, forKey: .lastUsed)
    }

    var displayName: String { name.isEmpty ? address : name }

    static let portRange = 1...65535

    var isValid: Bool {
        !address.trimmingCharacters(in: .whitespaces).isEmpty
            && !username.trimmingCharacters(in: .whitespaces).isEmpty
            && Self.portRange.contains(port)
    }

    /// 去掉首尾空白;地址里写了 `user@host:port` 就拆开。
    func normalized() -> Host {
        var h = self
        h.name = name.trimmingCharacters(in: .whitespacesAndNewlines)
        h.username = username.trimmingCharacters(in: .whitespacesAndNewlines)
        var addr = address.trimmingCharacters(in: .whitespacesAndNewlines)
        if let at = addr.lastIndex(of: "@") {
            if h.username.isEmpty { h.username = String(addr[..<at]) }
            addr = String(addr[addr.index(after: at)...])
        }
        // 只有一个冒号且后面全是数字才当端口(IPv6 字面量有多个冒号,不动)。
        if addr.filter({ $0 == ":" }).count == 1, let colon = addr.firstIndex(of: ":"),
           let p = Int(addr[addr.index(after: colon)...]) {
            h.port = p
            addr = String(addr[..<colon])
        }
        h.address = addr
        return h
    }
}

/// 主机列表存 Application Support/X-SSH/hosts.json;密码只进钥匙串,不落在 JSON 里。
/// 已信任的主机密钥指纹存 known_hosts.json(键是 host:port)。
/// 读写都走 `Durable`:写之前先备份旧文件;读到坏文件另存 .corrupt、改读备份,绝不拿空内容盖掉。
@Observable
final class HostStore {
    private(set) var hosts: [Host] = []
    private var known: [String: String] = [:]

    private let dir: URL

    init(directory: URL? = nil) {
        let base = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
        dir = directory ?? base.appendingPathComponent("X-SSH", isDirectory: true)
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        hosts = Durable.read([Host].self, from: dir.appendingPathComponent("hosts.json")) ?? []
        known = Durable.read([String: String].self, from: dir.appendingPathComponent("known_hosts.json")) ?? [:]
        #if DEBUG
        seedFromLaunchArguments()
        #endif
    }

    #if DEBUG
    /// 模拟器里没法顺手敲表单:`-seedHost name:address:port:user:password` 直接塞一台主机(只在 Debug 构建里有)。
    private func seedFromLaunchArguments() {
        let args = ProcessInfo.processInfo.arguments
        guard let i = args.firstIndex(of: "-seedHost"), i + 1 < args.count else { return }
        let f = args[i + 1].split(separator: ":", omittingEmptySubsequences: false).map(String.init)
        guard f.count == 5, let port = Int(f[2]) else { return }
        let host = Host(name: f[0], address: f[1], port: port, username: f[3])
        hosts.removeAll { $0.address == host.address && $0.port == host.port }
        _ = save(host, password: f[4])
    }
    #endif

    /// 先写钥匙串再写列表:密码存不进去就整个失败,不留一台「没有密码」的主机。
    @discardableResult
    func save(_ host: Host, password: String?) -> Bool {
        let host = host.normalized()
        if let password {
            if password.isEmpty { Keychain.remove(host.id.uuidString) }
            else if !Keychain.set(password, for: host.id.uuidString) { return false }
        }
        var next = hosts
        if let i = next.firstIndex(where: { $0.id == host.id }) { next[i] = host } else { next.append(host) }
        guard persist("hosts.json", next) else { return false }
        hosts = next
        return true
    }

    func delete(_ host: Host) {
        let next = hosts.filter { $0.id != host.id }
        guard persist("hosts.json", next) else { return }
        hosts = next
        Keychain.remove(host.id.uuidString)
    }

    func touch(_ host: Host) {
        guard let i = hosts.firstIndex(where: { $0.id == host.id }) else { return }
        var next = hosts
        next[i].lastUsed = Date()
        if persist("hosts.json", next) { hosts = next }
    }

    func password(for host: Host) -> String { Keychain.get(host.id.uuidString) ?? "" }

    private static func knownKeyName(_ host: Host) -> String { "\(host.address.lowercased()):\(host.port)" }

    func knownKey(_ host: Host) -> String? { known[Self.knownKeyName(host)] }

    @discardableResult
    func trust(_ host: Host, fingerprint: String) -> Bool {
        var next = known
        next[Self.knownKeyName(host)] = fingerprint
        guard persist("known_hosts.json", next) else { return false }
        known = next
        return true
    }

    private func persist<T: Encodable>(_ name: String, _ value: T) -> Bool {
        do { try Durable.write(value, to: dir.appendingPathComponent(name)); return true } catch { return false }
    }
}

private enum Durable {
    static func read<T: Decodable>(_ type: T.Type, from url: URL) -> T? {
        let fm = FileManager.default
        let backup = url.appendingPathExtension("bak")
        for candidate in [url, backup] {
            guard let data = try? Data(contentsOf: candidate) else { continue }
            if let value = try? JSONDecoder().decode(T.self, from: data) { return value }
            // 读不出来:留着给人看,别让下一次保存把它盖了。
            if candidate == url {
                let corrupt = url.appendingPathExtension("corrupt")
                try? fm.removeItem(at: corrupt)
                try? fm.moveItem(at: url, to: corrupt)
            }
        }
        return nil
    }

    static func write<T: Encodable>(_ value: T, to url: URL) throws {
        let data = try JSONEncoder().encode(value)
        // 旧文件能解析才拿来当备份,半截的不能把好备份顶掉。
        if let old = try? Data(contentsOf: url), (try? JSONSerialization.jsonObject(with: old)) != nil {
            try? old.write(to: url.appendingPathExtension("bak"), options: [.atomic, .completeFileProtection])
        }
        try data.write(to: url, options: [.atomic, .completeFileProtection])
    }
}

enum Keychain {
    private static func query(_ account: String) -> [String: Any] {
        [kSecClass as String: kSecClassGenericPassword,
         kSecAttrService as String: "dev.xssh.ios",
         kSecAttrAccount as String: account]
    }

    /// 已有就原地更新,没有才新增 —— 不再「先删后加」,中间失败不会丢旧密码。
    static func set(_ value: String, for account: String) -> Bool {
        let data = Data(value.utf8)
        let status = SecItemUpdate(query(account) as CFDictionary, [kSecValueData as String: data] as CFDictionary)
        if status == errSecSuccess { return true }
        guard status == errSecItemNotFound else { return false }
        var add = query(account)
        add[kSecValueData as String] = data
        add[kSecAttrAccessible as String] = kSecAttrAccessibleWhenUnlockedThisDeviceOnly
        return SecItemAdd(add as CFDictionary, nil) == errSecSuccess
    }

    static func get(_ account: String) -> String? {
        var q = query(account)
        q[kSecReturnData as String] = true
        q[kSecMatchLimit as String] = kSecMatchLimitOne
        var out: CFTypeRef?
        guard SecItemCopyMatching(q as CFDictionary, &out) == errSecSuccess, let data = out as? Data else { return nil }
        return String(data: data, encoding: .utf8)
    }

    static func remove(_ account: String) { SecItemDelete(query(account) as CFDictionary) }
}
