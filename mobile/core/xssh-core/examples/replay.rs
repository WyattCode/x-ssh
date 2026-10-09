//! 回放安卓调试录制(见安卓端 `Recorder.kt`),打印终端模型里最终的屏幕。
//!
//! ```text
//! cargo run -p xssh-core --example replay -- rec.bin            # 最终屏幕
//! cargo run -p xssh-core --example replay -- rec.bin --every 2000  # 每 2 秒打一帧
//! ```
//!
//! 用来区分:全屏程序显示不全时,是"终端模型里就没有"(协议/解析问题),
//! 还是"模型里有、安卓没画出来"(绘制问题)。

use std::time::Duration;

use xssh_core::terminal::{style, Terminal, CELL_SEP};

struct Record {
    kind: u8,
    millis: u64,
    payload: Vec<u8>,
}

fn parse(bytes: &[u8]) -> Vec<Record> {
    let mut out = Vec::new();
    let mut i = 0;
    while i + 13 <= bytes.len() {
        let kind = bytes[i];
        let millis = u64::from_be_bytes(bytes[i + 1..i + 9].try_into().unwrap());
        let len = u32::from_be_bytes(bytes[i + 9..i + 13].try_into().unwrap()) as usize;
        let end = (i + 13 + len).min(bytes.len());
        out.push(Record { kind, millis, payload: bytes[i + 13..end].to_vec() });
        i = end;
    }
    out
}

fn dump(t: &Terminal, label: &str) {
    let size = t.size();
    let cursor = t.cursor();
    println!(
        "==== {label}  {}x{}  备用屏={}  光标=({},{}) 可见={}  回滚={}",
        size.cols,
        size.rows,
        t.alt_screen(),
        cursor.row,
        cursor.col,
        cursor.visible,
        t.history_len()
    );
    for (row, runs) in t.screen_runs().iter().enumerate() {
        let mut line = String::new();
        let mut marks = String::new();
        let mut col = 0usize;
        for run in runs {
            while col < run.col {
                line.push(' ');
                col += 1;
            }
            for cell in run.cells.split(CELL_SEP) {
                line.push_str(if cell.is_empty() { "" } else { cell });
                col += 1;
            }
            if run.bg != 0 || run.flags & style::INVERSE != 0 {
                marks.push_str(&format!(" [{}..{} 底色]", run.col, col));
            }
        }
        println!("{row:3}|{line}{marks}");
    }
}

fn main() {
    let mut args = std::env::args().skip(1);
    let path = args.next().expect("用法: replay <rec.bin> [--every <ms>]");
    let mut every: Option<u64> = None;
    while let Some(a) = args.next() {
        if a == "--every" {
            every = args.next().and_then(|v| v.parse().ok());
        }
    }
    let records = parse(&std::fs::read(&path).expect("读录制文件"));
    let first = records.iter().find(|r| r.kind == 1).expect("录制里没有尺寸记录");
    let cols = i32::from_be_bytes(first.payload[0..4].try_into().unwrap()) as usize;
    let rows = i32::from_be_bytes(first.payload[4..8].try_into().unwrap()) as usize;
    let mut t = Terminal::new(cols, rows);
    let (mut data_bytes, mut resizes) = (0usize, 0usize);
    let mut next_dump = every;
    for r in &records {
        if let (Some(at), Some(step)) = (next_dump, every)
            && r.millis >= at
        {
            std::thread::sleep(Duration::from_millis(160));
            t.tick();
            dump(&t, &format!("t={}ms", at));
            next_dump = Some(at + step);
        }
        match r.kind {
            0 => {
                data_bytes += r.payload.len();
                t.feed(&r.payload);
            }
            1 => {
                resizes += 1;
                let c = i32::from_be_bytes(r.payload[0..4].try_into().unwrap()) as usize;
                let h = i32::from_be_bytes(r.payload[4..8].try_into().unwrap()) as usize;
                t.resize(c, h);
            }
            _ => {}
        }
        // 真实会话里这些应答已经发回去了,录制里的后续字节就是对方看到应答之后的反应。
        let _ = t.poll_events();
    }
    std::thread::sleep(Duration::from_millis(160));
    t.tick();
    println!(
        "记录 {} 条,数据 {} 字节,尺寸变化 {} 次,时长 {}ms",
        records.len(),
        data_bytes,
        resizes,
        records.last().map(|r| r.millis).unwrap_or(0)
    );
    dump(&t, "最终");
}
