# 从零跑一遍「打开生物识别解锁并保存」。
#
# 用法: .\lock-flow.ps1
# 前置: 靶机 sshd 在 127.0.0.1:2222、adb reverse 已建、18 Fold 已常亮。
#
# 每一步都重新 dump 界面再定位 —— 软键盘一弹整页重排,缓存的坐标会落到别的字段上,
# 表现是"填了密码结果地址被改"。
$script:adbexe = "D:\Android\sdk\platform-tools\adb.exe"
$pkg = "dev.xssh.android.review"

function Dump {
    # 每次先删掉旧文件再 dump:uiautomator 失败时会留着上一次的 /sdcard/ui.xml,
    # 于是读到一份陈旧界面还以为是当前的(拿它判断状态会得出完全错的结论)。
    & $script:adbexe shell rm -f /sdcard/ui.xml 2>&1 | Out-Null
    & $script:adbexe shell uiautomator dump /sdcard/ui.xml 2>&1 | Out-Null
    return ((& $script:adbexe exec-out cat /sdcard/ui.xml) -join "`n")
}

function Tap($x, $y) {
    & $script:adbexe shell input swipe $x $y $x $y 80 | Out-Null
    Start-Sleep -Milliseconds 1200
}

function TapText($xml, $text) {
    $m = [regex]::Match($xml, ('(?:text|content-desc)="' + [regex]::Escape($text) + '"[^>]*bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"'))
    if (-not $m.Success) { return $false }
    Tap ([int](([int]$m.Groups[1].Value + [int]$m.Groups[3].Value) / 2)) ([int](([int]$m.Groups[2].Value + [int]$m.Groups[4].Value) / 2))
    return $true
}

function Texts($xml) {
    [regex]::Matches($xml, '(?:text|content-desc)="([^"]+)"') |
        ForEach-Object { $_.Groups[1].Value } | Where-Object { $_ -ne "" } | Select-Object -Unique
}

# 1. 重置成一台没有密码的测试主机
$json = '[{"id":"11111111-1111-1111-1111-111111111111","name":"local","address":"127.0.0.1","port":2222,"username":"user","auth":"password","keyPath":"","keyFingerprint":"","password":"","keyData":"","keyPassphrase":"","keyName":"","keyPublicFingerprint":"","lockSecrets":false}]'
$doc = '<?xml version=''1.0'' encoding=''utf-8'' standalone=''yes'' ?>' + "`n" + '<map>' + "`n" +
    '    <string name="list">' + $json + '</string>' + "`n" + '</map>' + "`n"
$file = "$env:TEMP\xssh_hosts_test.xml"
[System.IO.File]::WriteAllText($file, $doc, (New-Object System.Text.UTF8Encoding $false))
& $script:adbexe shell "run-as $pkg mkdir -p shared_prefs" 2>&1 | Out-Null
Get-Content $file -Raw | & $script:adbexe shell "run-as $pkg sh -c 'cat > shared_prefs/xssh_hosts.xml'" 2>&1 | Out-Null
& $script:adbexe shell am force-stop $pkg | Out-Null
Start-Sleep -Seconds 1
& $script:adbexe shell am start -n "$pkg/dev.xssh.android.MainActivity" 2>&1 | Select-Object -Last 1
Start-Sleep -Seconds 3

# 2. 进编辑页(等主机页渲染出来再点)
$found = $false
for ($i = 0; $i -lt 10; $i++) {
    $xml = Dump
    if ($xml -match '编辑') { $found = (TapText $xml "编辑"); break }
    Start-Sleep -Milliseconds 800
}
if (-not $found) { Write-Output "FAIL: no edit button"; exit 1 }
Start-Sleep -Seconds 2

# 3. 填密码(取值在右、标签在左的排法:密码框是 x 起点最靠右的那个 EditText)
$xml = Dump
if ($xml -notmatch '编辑主机') { Write-Output "FAIL: not in editor"; exit 1 }
$best = -1
$box = $null
foreach ($n in [regex]::Matches($xml, '<node[^>]*EditText[^>]*>')) {
    $b = [regex]::Match($n.Value, 'bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"')
    if (-not $b.Success) { continue }
    if ([int]$b.Groups[1].Value -gt $best) { $best = [int]$b.Groups[1].Value; $box = $b }
}
if ($null -eq $box) { Write-Output "FAIL: no password box"; exit 1 }
Tap ([int](([int]$box.Groups[1].Value + [int]$box.Groups[3].Value) / 2)) ([int](([int]$box.Groups[2].Value + [int]$box.Groups[4].Value) / 2))
& $script:adbexe shell input text "testpw123" | Out-Null
Start-Sleep -Milliseconds 1200
# 这里**不要**收键盘:编辑页把 ESC 和返回键都绑成了"返回上一页",
# 一按编辑页就关了(实测直接退回桌面),而键盘开着不影响后续 ——
# 每一步都会重新 dump、按当前布局现算坐标。

$xml = Dump
$filled = [regex]::Matches($xml, '<node[^>]*EditText[^>]*text="([^"]*)"[^>]*>') | ForEach-Object { $_.Groups[1].Value }
Write-Output "fields: $($filled -join ' | ')"

# 4. 打开「用生物识别解锁」
$sw = [regex]::Match($xml, '<node[^>]*checkable="true"[^>]*bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"')
if (-not $sw.Success) { Write-Output "FAIL: no switch"; exit 1 }
Tap ([int](([int]$sw.Groups[1].Value + [int]$sw.Groups[3].Value) / 2)) ([int](([int]$sw.Groups[2].Value + [int]$sw.Groups[4].Value) / 2))
$xml = Dump
Write-Output "switch on: $($xml -match 'checked=.true.')"

# 5. 保存(应弹出解锁框)
if (-not (TapText $xml "保存")) { Write-Output "FAIL: no save"; exit 1 }
Start-Sleep -Seconds 4

Write-Output "--- focus ---"
& $script:adbexe shell "dumpsys window | grep mCurrentFocus" 2>&1 | Select-Object -First 4
Write-Output "--- ui ---"
Texts (Dump)
Write-Output "--- log ---"
& $script:adbexe logcat -d 2>&1 | Select-String -Pattern "xssh " | Select-Object -Last 8
