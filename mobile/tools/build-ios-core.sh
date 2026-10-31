#!/bin/bash
# 把 Rust 核心(mobile/core/xssh-ffi)编成 iOS 用的 XSSHCore.xcframework,并生成 Swift 绑定。
# 产物放在 mobile/ios/Core/,不进 git(见 mobile/ios/.gitignore)。
# 前提: rustup 已装,且加过 aarch64-apple-ios 与 aarch64-apple-ios-sim 两个目标。
set -euo pipefail

export PATH="/opt/homebrew/opt/rustup/bin:$HOME/.cargo/bin:$PATH"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CORE="$ROOT/core"
OUT="$ROOT/ios/Core"
GEN="$OUT/generated"

cd "$CORE"
cargo build -p xssh-ffi --release --target aarch64-apple-ios
cargo build -p xssh-ffi --release --target aarch64-apple-ios-sim

rm -rf "$OUT"
mkdir -p "$GEN" "$OUT/headers"

# 用库模式从编出来的静态库里读接口,生成 Swift 文件 + C 头文件 + modulemap。
cargo run -q -p xssh-ffi --bin uniffi-bindgen -- generate \
  --library "$CORE/target/aarch64-apple-ios-sim/release/libxssh_ffi.a" \
  --language swift --out-dir "$GEN"

cp "$GEN"/*FFI.h "$OUT/headers/"
# xcframework 的 modulemap 必须叫 module.modulemap。
cp "$GEN"/*FFI.modulemap "$OUT/headers/module.modulemap"

xcodebuild -create-xcframework \
  -library "$CORE/target/aarch64-apple-ios/release/libxssh_ffi.a" -headers "$OUT/headers" \
  -library "$CORE/target/aarch64-apple-ios-sim/release/libxssh_ffi.a" -headers "$OUT/headers" \
  -output "$OUT/XSSHCore.xcframework"

echo "done: $OUT"
ls "$GEN"
