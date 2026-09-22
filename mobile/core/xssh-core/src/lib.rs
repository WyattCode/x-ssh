//! X-SSH 移动端共享核心。
//!
//! 平台无关:SSH 协议、终端仿真状态机、数据模型。
//! 本 crate 不依赖任何移动平台 API,可直接在桌面环境用 `cargo test` 迭代。

pub mod sftp;
pub mod ssh;
pub mod terminal;