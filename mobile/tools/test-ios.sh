#!/bin/bash
# 在本机跑 iOS 单元测试(CI 里没有 iOS 任务:需要带 iOS 27 SDK 的 macOS runner)。
# 用法:mobile/tools/test-ios.sh [模拟器名]  —— 不给名字就用 "iPhone Duo";本机没有它就用第一个可用的 iPhone 模拟器。
set -euo pipefail
cd "$(dirname "$0")/../ios"
name="${1:-iPhone Duo}"
if ! xcrun simctl list devices available | grep -q "    $name ("; then
  name=$(xcrun simctl list devices available | grep -E "^    iPhone" | head -1 | sed -E 's/^ +//; s/ \(.*//')
  echo "没找到指定的模拟器,改用:$name"
fi
xcodegen generate >/dev/null
xcodebuild test -project XSSH.xcodeproj -scheme XSSH \
  -destination "platform=iOS Simulator,name=$name" 2>&1 | grep -E "Test Case.*(passed|failed)|error:|TEST (SUCCEEDED|FAILED)"
