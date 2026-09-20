//! 开发工具:把本机 shell 放进 PTY,用 xssh-core 的终端状态机渲染到控制台。
//!
//! 用途:不依赖 SSH 就能端到端验证「字节流 → 终端视图」链路(转义序列、宽字符、
//! 备用屏、回滚、resize)。这条链路稍后原样用于 SSH 通道。
//!
//! 用法:
//!   cargo run -p xssh-devpty
//!   cargo run -p xssh-devpty -- --cols 100 --rows 20 -- powershell -NoLogo -Command "Get-ChildItem"

use std::io::{Read, Write};
use std::sync::mpsc::{self, RecvTimeoutError};
use std::thread;
use std::time::{Duration, Instant};

use portable_pty::{native_pty_system, CommandBuilder, PtySize};
use xssh_core::terminal::{Terminal, TerminalEvent};

/// 控制台刷新间隔(~30fps)。
const FRAME: Duration = Duration::from_millis(33);
/// 事件轮询间隔。
const IO_TICK: Duration = Duration::from_millis(10);

fn main() -> anyhow::Result<()> {
    #[cfg(windows)]
    console::init();

    let (cols, rows, mut cmd_args) = parse_args();
    if cmd_args.is_empty() {
        #[cfg(windows)]
        {
            cmd_args = vec!["powershell.exe".into(), "-NoLogo".into(), "-NoProfile".into()];
        }
        #[cfg(not(windows))]
        {
            cmd_args = vec!["sh".into()];
        }
    }

    let pair = native_pty_system().openpty(PtySize {
        rows: rows as u16,
        cols: cols as u16,
        pixel_width: 0,
        pixel_height: 0,
    })?;

    let mut builder = CommandBuilder::new(cmd_args[0].clone());
    for arg in cmd_args.iter().skip(1) {
        builder.arg(arg);
    }
    let mut child = pair.slave.spawn_command(builder)?;
    eprintln!("[devpty] spawned pid {:?}", child.process_id());
    drop(pair.slave);

    let mut reader = pair.master.try_clone_reader()?;
    let mut writer = pair.master.take_writer()?;

    // PTY 输出 → 主线程
    let (out_tx, out_rx) = mpsc::channel::<Vec<u8>>();
    thread::spawn(move || {
        let mut buf = [0u8; 8192];
        loop {
            match reader.read(&mut buf) {
                Ok(0) => {
                    eprintln!("[devpty] reader: EOF");
                    break;
                }
                Ok(n) => {
                    if out_tx.send(buf[..n].to_vec()).is_err() {
                        break;
                    }
                }
                Err(e) => {
                    eprintln!("[devpty] reader error: {e}");
                    break;
                }
            }
        }
    });

    // 键盘输入 → PTY(按行提交,便于在普通控制台里做验证)
    let (in_tx, in_rx) = mpsc::channel::<Vec<u8>>();
    thread::spawn(move || {
        while let Ok(data) = in_rx.recv() {
            if writer.write_all(&data).is_err() || writer.flush().is_err() {
                break;
            }
        }
    });
    // 注意:持有写端克隆直到进程结束。否则在非交互 stdin(立即 EOF)下,
    // 写端被 drop 会让 ConPTY 认为输入关闭并终止子进程。
    let keep_input_open = in_tx.clone();
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

    let mut term = Terminal::new(cols, rows);
    let mut last_draw = Instant::now();
    let mut received: usize = 0;
    let mut last_beat = Instant::now();

    let exit_note = loop {
        match out_rx.recv_timeout(IO_TICK) {
            Ok(chunk) => {
                received += chunk.len();
                term.feed(&chunk);
                while let Ok(more) = out_rx.try_recv() {
                    received += more.len();
                    term.feed(&more);
                }
                // 终端应答(DSR/DA/焦点等)必须写回 PTY,否则子进程会挂起。
                for event in term.poll_events() {
                    match event {
                        TerminalEvent::Write(bytes) => {
                            let _ = keep_input_open.send(bytes);
                        }
                        TerminalEvent::Title(title) => eprintln!("[devpty] title: {title}"),
                        TerminalEvent::ResetTitle => eprintln!("[devpty] title reset"),
                        TerminalEvent::Bell => eprintln!("[devpty] bell"),
                        TerminalEvent::ClipboardStore(_) => {}
                    }
                }
            }
            Err(RecvTimeoutError::Timeout) | Err(RecvTimeoutError::Disconnected) => {}
        }

        if last_beat.elapsed() >= Duration::from_secs(1) {
            eprintln!("[devpty] beat: received={received}");
            last_beat = Instant::now();
        }

        if last_draw.elapsed() >= FRAME {
            draw(&term, "");
            last_draw = Instant::now();
        }

        if let Some(status) = child.try_wait()? {
            break format!("child exited: {status:?}");
        }
    };

    // 子进程退出后继续收取残余输出(最多 300ms)。
    let drain_deadline = Instant::now() + Duration::from_millis(300);
    loop {
        match out_rx.recv_timeout(Duration::from_millis(20)) {
            Ok(chunk) => term.feed(&chunk),
            Err(RecvTimeoutError::Disconnected) => break,
            Err(RecvTimeoutError::Timeout) if Instant::now() >= drain_deadline => break,
            Err(RecvTimeoutError::Timeout) => {}
        }
    }
    draw(&term, &exit_note);
    drop(keep_input_open);
    Ok(())
}

fn draw(term: &Terminal, footer: &str) {
    let text = term.text();
    let cursor = term.cursor();
    let mut out = std::io::stdout().lock();
    let _ = write!(out, "\x1b[H\x1b[2J{text}");
    let _ = write!(out, "\x1b[{};{}H", cursor.row + 1, cursor.col + 1);
    if !footer.is_empty() {
        let _ = write!(out, "\r\n[devpty] {footer}\r\n");
        let _ = out.flush();
    }
}

fn parse_args() -> (usize, usize, Vec<String>) {
    let mut cols = 120usize;
    let mut rows = 30usize;
    let mut cmd_args: Vec<String> = Vec::new();
    let mut args = std::env::args().skip(1);
    while let Some(arg) = args.next() {
        match arg.as_str() {
            "--cols" => cols = args.next().and_then(|v| v.parse().ok()).unwrap_or(cols),
            "--rows" => rows = args.next().and_then(|v| v.parse().ok()).unwrap_or(rows),
            "--" => {
                cmd_args.extend(args);
                break;
            }
            _ => {
                cmd_args.push(arg);
                cmd_args.extend(args);
                break;
            }
        }
    }
    (cols, rows, cmd_args)
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