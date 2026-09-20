//! 开发工具:连接真实 SSH 服务器,用 xssh-core 渲染到控制台。
//!
//! 用法:
//!   cargo run -p xssh-devssh -- --user <u> --key <privkey> [--host 127.0.0.1] [--port 22]
//!   cargo run -p xssh-devssh -- --user <u> --key <privkey> -- dir /b

use std::io::Write;
use std::path::PathBuf;
use std::sync::mpsc;
use std::thread;
use std::time::{Duration, Instant};

use xssh_core::ssh::{Auth, ServerMsg, Ssh, Target};
use xssh_core::terminal::{Terminal, TerminalEvent};

const FRAME: Duration = Duration::from_millis(33);
const IO_TICK: Duration = Duration::from_millis(10);

fn main() -> anyhow::Result<()> {
    #[cfg(windows)]
    console::init();

    let cli = parse_args();

    let auth = if let Some(key) = cli.key {
        Auth::KeyFile { path: key, passphrase: None }
    } else if let Some(password) = cli.password {
        Auth::Password(password)
    } else {
        anyhow::bail!("need --key <path> or --password <pw>");
    };

    let target = Target { host: cli.host, port: cli.port, username: cli.user, auth };
    let mut ssh = Ssh::connect(&target)?;
    eprintln!("[devssh] connected; server key {}", ssh.server_key());

    let mut shell = match cli.command {
        Some(command) => ssh.open_exec(cli.cols as u16, cli.rows as u16, "xterm-256color", &command)?,
        None => ssh.open_shell(cli.cols as u16, cli.rows as u16, "xterm-256color")?,
    };

    let mut term = Terminal::new(cli.cols, cli.rows);
    let mut last_draw = Instant::now();
    let mut received: usize = 0;
    let mut exit_status: Option<u32> = None;
    let mut closed = false;

    // 控制台输入 -> 服务端(按行提交)。
    let (in_tx, in_rx) = mpsc::channel::<Vec<u8>>();
    thread::spawn(move || {
        let mut line = String::new();
        loop {
            line.clear();
            match std::io::stdin().read_line(&mut line) {
                Ok(0) | Err(_) => break,
                Ok(_) => {}
            }
            if in_tx.send(line.as_bytes().to_vec()).is_err() {
                break;
            }
        }
    });

    loop {
        // 服务端消息 -> 终端
        while let Some(msg) = shell.poll_msg() {
            match msg {
                ServerMsg::Data { data, .. } | ServerMsg::ExtendedData { data, .. } => {
                    received += data.len();
                    term.feed(&data);
                }
                ServerMsg::Eof { .. } => {}
                ServerMsg::ExitStatus { status, .. } => exit_status = Some(status),
                ServerMsg::Close { .. } => closed = true,
                ServerMsg::Disconnected => closed = true,
            }
        }

        // 终端应答 -> 服务端(DSR/DA 等;不回写会挂起远端程序)
        for event in term.poll_events() {
            if let TerminalEvent::Write(bytes) = event {
                shell.write(&bytes)?;
            }
        }

        // 控制台输入 -> 服务端
        while let Ok(data) = in_rx.try_recv() {
            shell.write(&data)?;
        }

        if last_draw.elapsed() >= FRAME {
            draw(&term, "");
            last_draw = Instant::now();
        }

        if closed {
            break;
        }

        thread::sleep(IO_TICK);
    }

    // 收尾:再取一次残余消息。
    while let Some(msg) = shell.poll_msg() {
        if let ServerMsg::Data { data, .. } | ServerMsg::ExtendedData { data, .. } = msg {
            term.feed(&data);
        }
    }
    let footer = match exit_status {
        Some(status) => format!("exit status {status}; received {received} bytes"),
        None => format!("channel closed; received {received} bytes"),
    };
    draw(&term, &footer);
    Ok(())
}

struct Cli {
    host: String,
    port: u16,
    user: String,
    key: Option<PathBuf>,
    password: Option<String>,
    cols: usize,
    rows: usize,
    command: Option<String>,
}

fn parse_args() -> Cli {
    let mut cli = Cli {
        host: "127.0.0.1".into(),
        port: 22,
        user: String::new(),
        key: None,
        password: None,
        cols: 120,
        rows: 30,
        command: None,
    };

    let mut args = std::env::args().skip(1);
    while let Some(arg) = args.next() {
        match arg.as_str() {
            "--host" => {
                if let Some(value) = args.next() {
                    cli.host = value;
                }
            }
            "--port" => {
                if let Some(value) = args.next() {
                    cli.port = value.parse().unwrap_or(cli.port);
                }
            }
            "--user" => {
                if let Some(value) = args.next() {
                    cli.user = value;
                }
            }
            "--key" => cli.key = args.next().map(PathBuf::from),
            "--password" => cli.password = args.next(),
            "--cols" => {
                if let Some(value) = args.next() {
                    cli.cols = value.parse().unwrap_or(cli.cols);
                }
            }
            "--rows" => {
                if let Some(value) = args.next() {
                    cli.rows = value.parse().unwrap_or(cli.rows);
                }
            }
            "--" => {
                let rest: Vec<String> = args.collect();
                if !rest.is_empty() {
                    cli.command = Some(rest.join(" "));
                }
                break;
            }
            _ => {}
        }
    }
    cli
}

fn draw(term: &Terminal, footer: &str) {
    let text = term.text();
    let cursor = term.cursor();
    let mut out = std::io::stdout().lock();
    let _ = write!(out, "\x1b[H\x1b[2J{text}");
    let _ = write!(out, "\x1b[{};{}H", cursor.row + 1, cursor.col + 1);
    if !footer.is_empty() {
        let _ = write!(out, "\r\n[devssh] {footer}\r\n");
    }
    let _ = out.flush();
}

#[cfg(windows)]
mod console {
    use std::ffi::c_void;
    use std::os::raw::c_int;

    const STD_OUTPUT_HANDLE: u32 = -11i32 as u32;
    const ENABLE_PROCESSED_OUTPUT: u32 = 0x0001;
    const ENABLE_VIRTUAL_TERMINAL_PROCESSING: u32 = 0x0004;
    const CP_UTF8: u32 = 65001;

    unsafe extern "system" {
        fn GetStdHandle(handle: u32) -> *mut c_void;
        fn GetConsoleMode(handle: *mut c_void, mode: *mut u32) -> c_int;
        fn SetConsoleMode(handle: *mut c_void, mode: u32) -> c_int;
        fn SetConsoleOutputCP(cp: u32) -> c_int;
    }

    pub fn init() {
        unsafe {
            SetConsoleOutputCP(CP_UTF8);
            let handle = GetStdHandle(STD_OUTPUT_HANDLE);
            let mut mode = 0u32;
            if GetConsoleMode(handle, &mut mode) != 0 {
                SetConsoleMode(
                    handle,
                    mode | ENABLE_PROCESSED_OUTPUT | ENABLE_VIRTUAL_TERMINAL_PROCESSING,
                );
            }
        }
    }
}