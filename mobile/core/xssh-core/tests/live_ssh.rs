//! 对真实 sshd 的端到端检查:连接 → 开 shell → 写 → 改尺寸 → 收回显 → 断开。
//!
//! 默认忽略(要有服务器)。手动跑:
//!
//! ```text
//! XSSH_TEST_HOST=127.0.0.1 XSSH_TEST_PORT=22 XSSH_TEST_USER=<u> XSSH_TEST_KEY=<私钥路径> \
//!   cargo test -p xssh-core --test live_ssh -- --ignored --nocapture
//! ```
//!
//! 为什么要有它:终端解析的单测覆盖不到网络层。给写数据/改尺寸/断开加超时时,
//! 计时器被写成了 `block_on` 的参数,在进入运行时之前构造,tokio 直接 panic ——
//! 结果**每一次**写、改尺寸、断开都失败,单测全绿。

use std::time::{Duration, Instant};

use xssh_core::ssh::{Auth, ServerMsg, Ssh, SshError, Target};

fn target(known_key: Option<String>) -> Option<Target> {
    let host = std::env::var("XSSH_TEST_HOST").ok()?;
    let user = std::env::var("XSSH_TEST_USER").ok()?;
    let key = std::env::var("XSSH_TEST_KEY").ok()?;
    let port = std::env::var("XSSH_TEST_PORT").ok().and_then(|p| p.parse().ok()).unwrap_or(22);
    Some(Target {
        host,
        port,
        username: user,
        auth: Auth::KeyFile { path: key.into(), passphrase: None },
        known_key,
    })
}

#[test]
#[ignore = "需要真实 sshd,见文件头"]
fn shell_round_trip_and_clean_disconnect() {
    let Some(first) = target(None) else {
        eprintln!("未设置 XSSH_TEST_* 环境变量,跳过");
        return;
    };
    // 测试用:第一次握手拿指纹,第二次带上它。
    let fingerprint = match Ssh::connect(&first) {
        Err(SshError::HostKeyUnknown { fingerprint }) => fingerprint,
        Err(other) => panic!("首次握手意外失败: {other}"),
        Ok(_) => panic!("没有已信任指纹却连上了 —— 主机密钥校验失效"),
    };
    let mut ssh = Ssh::connect(&target(Some(fingerprint)).unwrap()).expect("带指纹连接");
    let mut shell = ssh.open_shell(80, 24, "xterm-256color").expect("开 shell");

    shell.resize(100, 30).expect("改窗口尺寸");
    shell.write(b"echo xssh-live-$((6*7))\r").expect("写数据");

    let mut seen = Vec::new();
    let deadline = Instant::now() + Duration::from_secs(10);
    while Instant::now() < deadline {
        while let Some(msg) = shell.poll_msg() {
            if let ServerMsg::Data { data, .. } = msg {
                seen.extend_from_slice(&data);
            }
        }
        let text = String::from_utf8_lossy(&seen);
        // bash 会算出 42;Windows cmd 原样回显,两种都说明写进去了、回显回来了。
        if text.contains("xssh-live-42") || text.contains("xssh-live-$((6*7))") {
            break;
        }
        std::thread::sleep(Duration::from_millis(50));
    }
    let text = String::from_utf8_lossy(&seen);
    assert!(text.contains("xssh-live-"), "没收到回显,收到的是:\n{text}");

    let started = Instant::now();
    ssh.disconnect();
    assert!(started.elapsed() < Duration::from_secs(4), "断开被卡住了");
}
