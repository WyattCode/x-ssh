#!/bin/bash
# 在本机跑 iOS 单元测试(CI 里没有 iOS 任务:需要带 iOS 27 SDK 的 macOS runner)。
# 用法:mobile/tools/test-ios.sh [模拟器名,默认 "iPhone Duo"]
set -euo pipefail
cd "$(dirname "$0")/../ios"
xcodegen generate >/dev/null
xcodebuild test -project XSSH.xcodeproj -scheme XSSH \
  -destination "platform=iOS Simulator,name=${1:-iPhone Duo}" 2>&1 | grep -E "Test Case.*(passed|failed)|error:|TEST (SUCCEEDED|FAILED)"
