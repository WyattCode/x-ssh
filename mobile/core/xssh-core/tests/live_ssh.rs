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
        jump: None,
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

    // 不敲任何东西,欢迎语 / 第一个提示符也得收到。Handler 只转发登记过的终端通道,
    // 登记晚了(等 shell 请求返回才登记)这一段会被当成别的通道丢掉,终端开出来是空的。
    let mut greeting = 0usize;
    let deadline = Instant::now() + Duration::from_secs(5);
    while greeting == 0 && Instant::now() < deadline {
        while let Some(msg) = shell.poll_msg() {
            if let ServerMsg::Data { data, .. } = msg {
                greeting += data.len();
            }
        }
        std::thread::sleep(Duration::from_millis(20));
    }
    assert!(greeting > 0, "连上之后没收到任何初始输出(提示符丢了)");

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

    // 连续收 100 条以上的消息之后连接还得活着。
    //
    // russh 每个通道内部有一个容量 100 的消息队列(channel_buffer_size),收到数据先
    // `send().await` 塞进去,再调回调。我们只用回调、从不读那个队列,第 100 条之后
    // send 就永远等下去,整条连接冻住 —— Codex 恢复历史会话时刚好在第 99 条停住。
    // 每敲一个字符服务端回显一次,就是一条单独的消息。
    let mut messages = 0usize;
    for _ in 0..400 {
        shell.write(b"x").expect("写单个字符");
        std::thread::sleep(Duration::from_millis(15));
        while shell.poll_msg().is_some() {
            messages += 1;
        }
    }
    eprintln!("连敲 400 个字符期间收到 {messages} 条消息");
    shell.write(b"\x03").expect("Ctrl+C 清掉这一行");
    std::thread::sleep(Duration::from_millis(300));
    shell.write(b"echo xssh-final-$((6*7))\r").expect("最后一条命令");
    let mut tail = Vec::new();
    let deadline = Instant::now() + Duration::from_secs(10);
    while Instant::now() < deadline {
        while let Some(msg) = shell.poll_msg() {
            if let ServerMsg::Data { data, .. } = msg {
                tail.extend_from_slice(&data);
            }
        }
        if String::from_utf8_lossy(&tail).contains("xssh-final-") {
            break;
        }
        std::thread::sleep(Duration::from_millis(50));
    }
    assert!(
        String::from_utf8_lossy(&tail).contains("xssh-final-"),
        "收了 100 多条消息之后连接冻住了,最后一条命令没有回显"
    );

    let started = Instant::now();
    ssh.disconnect();
    assert!(started.elapsed() < Duration::from_secs(4), "断开被卡住了");
}

/// 同一条连接上:终端开着的同时开 SFTP,传一个文件来回,关掉 SFTP 后终端照常能用。
#[test]
#[ignore = "需要真实 sshd,见文件头"]
fn sftp_round_trip_alongside_shell() {
    let Some(first) = target(None) else {
        eprintln!("未设置 XSSH_TEST_* 环境变量,跳过");
        return;
    };
    let fingerprint = match Ssh::connect(&first) {
        Err(SshError::HostKeyUnknown { fingerprint }) => fingerprint,
        other => panic!("首次握手应要求确认主机密钥: {:?}", other.err()),
    };
    let mut ssh = Ssh::connect(&target(Some(fingerprint)).unwrap()).expect("带指纹连接");
    let mut shell = ssh.open_shell(80, 24, "xterm-256color").expect("开 shell");
    let sftp = ssh.open_sftp().expect("开 SFTP");

    let home = sftp.home().expect("家目录");
    eprintln!("家目录: {home}");
    assert!(!sftp.list(&home).expect("列目录").is_empty(), "家目录不该是空的");

    // 3 块多一点,跨过读写块的边界。
    let payload: Vec<u8> = (0..200_000u32).map(|i| (i % 251) as u8).collect();
    let path = xssh_core::sftp::join(&home, "xssh-sftp-test.bin");
    let mut calls = 0;
    let sent = sftp
        .upload(&path, &mut payload.as_slice(), payload.len() as u64, &mut |_, _| {
            calls += 1;
            true
        })
        .expect("上传");
    assert_eq!(sent, payload.len() as u64);
    assert!(calls >= 3, "进度回调应该按块来,实际 {calls} 次");

    let listed = sftp.list(&home).expect("再列一次");
    let entry = listed.iter().find(|e| e.name == "xssh-sftp-test.bin").expect("上传的文件应在列表里");
    assert_eq!(entry.size, payload.len() as u64);
    assert!(!entry.is_dir);

    let mut back = Vec::new();
    sftp.download(&path, &mut back, &mut |_, _| true).expect("下载");
    assert_eq!(back, payload, "下载回来的内容和上传的不一致");

    // 取消:进度回调返回 false 就停。
    let cancelled = sftp.download(&path, &mut Vec::new(), &mut |_, _| false);
    assert!(matches!(cancelled, Err(SshError::Cancelled)));

    let renamed = xssh_core::sftp::join(&home, "xssh-sftp-test-2.bin");
    sftp.rename(&path, &renamed).expect("改名");
    sftp.remove(&renamed, false).expect("删除");
    assert!(!sftp.list(&home).unwrap().iter().any(|e| e.name.starts_with("xssh-sftp-test")));
    sftp.close();

    // SFTP 通道的数据不能漏进终端,它关掉也不能让终端以为断了。
    shell.write(b"echo after-sftp-ok\r").expect("终端还能写");
    let mut seen = Vec::new();
    let deadline = Instant::now() + Duration::from_secs(10);
    while Instant::now() < deadline {
        while let Some(msg) = shell.poll_msg() {
            match msg {
                ServerMsg::Data { data, .. } => seen.extend_from_slice(&data),
                ServerMsg::Close { .. } | ServerMsg::Eof { .. } => panic!("SFTP 关闭被当成了终端关闭"),
                _ => {}
            }
        }
        if String::from_utf8_lossy(&seen).contains("after-sftp-ok") {
            break;
        }
        std::thread::sleep(Duration::from_millis(50));
    }
    assert!(String::from_utf8_lossy(&seen).contains("after-sftp-ok"), "关掉 SFTP 后终端没反应");
    ssh.disconnect();
}

/// 上传到已存在的文件,中途取消 —— **原文件必须原封不动**。
///
/// 这条是为一个真实事故写的:原来 `upload` 直接往目标路径写(`create` 会截断),
/// 取消时又 `remove_file(path)`,删掉的是用户原来那个文件。而上层把"会话断开"
/// 也算作取消,所以传一半掉个线,服务器上那个文件就没了,界面只说一句「已取消」。
#[test]
#[ignore = "需要真实 sshd,见文件头"]
fn cancelled_upload_leaves_the_target_alone() {
    let Some(first) = target(None) else {
        eprintln!("未设置 XSSH_TEST_* 环境变量,跳过");
        return;
    };
    let fingerprint = match Ssh::connect(&first) {
        Err(SshError::HostKeyUnknown { fingerprint }) => fingerprint,
        Err(other) => panic!("首次握手意外失败: {other}"),
        Ok(_) => panic!("没有已信任指纹却连上了"),
    };
    let ssh = Ssh::connect(&target(Some(fingerprint)).unwrap()).expect("带指纹连接");
    let sftp = ssh.open_sftp().expect("开 SFTP");
    let home = sftp.home().expect("家目录");
    let path = format!("{home}/xssh-upload-test.txt");

    const ORIGINAL: &[u8] = b"ORIGINAL-CONTENT-DO-NOT-LOSE\n";
    sftp.upload(&path, &mut &ORIGINAL[..], ORIGINAL.len() as u64, &mut |_, _| true)
        .expect("先放一个原始文件");

    // 传一个大一点的,进度回调第一次就喊停 —— 模拟用户点取消 / 会话断开。
    let big = vec![b'X'; 512 * 1024];
    let mut ticks = 0;
    let outcome = sftp.upload(&path, &mut &big[..], big.len() as u64, &mut |_, _| {
        ticks += 1;
        false
    });
    assert!(matches!(outcome, Err(SshError::Cancelled)), "取消应该报 Cancelled,实际 {outcome:?}");
    assert!(ticks >= 1, "进度回调没被调用,这条测试没测到东西");

    // 关键:原文件还在,内容一个字节没变。
    let mut got = Vec::new();
    sftp.download(&path, &mut got, &mut |_, _| true).expect("原文件还能读");
    assert_eq!(got, ORIGINAL, "取消上传把原文件弄坏了");

    // 临时文件不能留在服务器上。
    let leftovers: Vec<_> = sftp
        .list(&home)
        .expect("列目录")
        .into_iter()
        .filter(|e| e.name.contains("xssh-upload-test") && e.name.ends_with(".xssh-part"))
        .collect();
    assert!(leftovers.is_empty(), "取消之后留下了临时文件: {leftovers:?}");

    // 正常传完则要真的覆盖掉。
    const REPLACED: &[u8] = b"REPLACED\n";
    sftp.upload(&path, &mut &REPLACED[..], REPLACED.len() as u64, &mut |_, _| true)
        .expect("正常上传");
    let mut after = Vec::new();
    sftp.download(&path, &mut after, &mut |_, _| true).expect("读回来");
    assert_eq!(after, REPLACED, "正常上传没有覆盖成功");

    sftp.remove(&path, false).expect("清理");
    sftp.close();
    ssh.disconnect();
}

/// 经跳板机连:先登跳板机、再经它的隧道连目标。两台的主机密钥各验各的。
///
/// 目标端口用 `XSSH_TEST_JUMP_TARGET_PORT`(同一台机器上另起一个 sshd 就行 —— 手机那边只转发了
/// 跳板机的端口,目标只有经隧道才到得了)。没设就拿跳板机自己当目标。
#[test]
#[ignore = "需要真实 sshd,见文件头"]
fn jump_host_tunnels_to_the_target() {
    let Some(hop) = target(None) else {
        eprintln!("未设置 XSSH_TEST_* 环境变量,跳过");
        return;
    };
    let target_port: u16 = std::env::var("XSSH_TEST_JUMP_TARGET_PORT")
        .ok()
        .and_then(|p| p.parse().ok())
        .unwrap_or(hop.port);
    let via = |jump_key: Option<String>, target_key: Option<String>, port: u16| {
        let mut jump = hop.clone();
        jump.known_key = jump_key;
        let mut t = hop.clone();
        t.host = "127.0.0.1".into();
        t.port = port;
        t.known_key = target_key;
        t.jump = Some(Box::new(jump));
        t
    };

    // 跳板机的密钥还没信任:报的是**跳板机**的「不认识」,不是目标的。
    let jump_fp = match Ssh::connect(&via(None, None, target_port)) {
        Err(SshError::Jump(inner)) => match *inner {
            SshError::HostKeyUnknown { fingerprint } => fingerprint,
            other => panic!("应要求确认跳板机的密钥,实际: {other}"),
        },
        Err(other) => panic!("应要求确认跳板机的密钥,实际: {other}"),
        Ok(_) => panic!("跳板机没有已信任指纹却连上了"),
    };
    // 跳板机信任了、目标还没有:这回是目标的「不认识」(不带 Jump 包装)。
    let target_fp = match Ssh::connect(&via(Some(jump_fp.clone()), None, target_port)) {
        Err(SshError::HostKeyUnknown { fingerprint }) => fingerprint,
        Err(other) => panic!("应要求确认目标的密钥,实际: {other}"),
        Ok(_) => panic!("目标没有已信任指纹却连上了"),
    };
    // 跳板机的密钥"变了":拒绝,并且说的是跳板机。
    match Ssh::connect(&via(Some("SHA256:not-this-one".into()), Some(target_fp.clone()), target_port)) {
        Err(SshError::Jump(inner)) => assert!(matches!(*inner, SshError::HostKeyChanged { .. }), "{inner}"),
        other => panic!("跳板机密钥不符应被拒绝: {:?}", other.err()),
    }
    // 跳板机到不了的端口:隧道开不起来。
    match Ssh::connect(&via(Some(jump_fp.clone()), Some(target_fp.clone()), 1)) {
        Err(SshError::Tunnel(reason)) => eprintln!("隧道失败(预期): {reason}"),
        other => panic!("目标端口不通应报隧道失败: {:?}", other.err()),
    }

    // 都信任了:连上、开 shell、敲命令、收回显。
    let mut ssh = Ssh::connect(&via(Some(jump_fp), Some(target_fp), target_port)).expect("经跳板机连接");
    let mut shell = ssh.open_shell(80, 24, "xterm-256color").expect("开 shell");
    shell.write(b"echo via-jump-ok\r").expect("写数据");
    let mut seen = Vec::new();
    let deadline = Instant::now() + Duration::from_secs(10);
    while Instant::now() < deadline {
        while let Some(msg) = shell.poll_msg() {
            if let ServerMsg::Data { data, .. } = msg {
                seen.extend_from_slice(&data);
            }
        }
        if String::from_utf8_lossy(&seen).contains("via-jump-ok") {
            break;
        }
        std::thread::sleep(Duration::from_millis(50));
    }
    assert!(String::from_utf8_lossy(&seen).contains("via-jump-ok"), "经隧道没收到回显");
    let started = Instant::now();
    ssh.disconnect();
    assert!(started.elapsed() < Duration::from_secs(7), "断开被卡住了");
}
