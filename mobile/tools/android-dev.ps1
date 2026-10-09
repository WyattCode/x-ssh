#requires -Version 5.1
<#
X-SSH Android 设备助手(Xiaomi 18 Fold 双屏:截图自动选当前前台所在显示)

  .\android-dev.ps1 shot  <名称>
  .\android-dev.ps1 tap   <x> <y>
  .\android-dev.ps1 text  <文字>
  .\android-dev.ps1 key   <KEYCODE|数字>
  .\android-dev.ps1 swipe <x1> <y1> <x2> <y2>
  .\android-dev.ps1 start [地址 [用户 密码]]
  .\android-dev.ps1 dump
  .\android-dev.ps1 asapp <命令>
  .\android-dev.ps1 fw
  .\android-dev.ps1 stay
#>
param(
    [Parameter(Position = 0)][string]$Cmd = "shot",
    [Parameter(Position = 1)][string]$A = "",
    [Parameter(Position = 2)][string]$B = "",
    [Parameter(Position = 3)][string]$C = "",
    [Parameter(Position = 4)][string]$D4 = ""
)

$adb = "D:\Android\sdk\platform-tools\adb.exe"
$pkg = "dev.xssh.android"
$dir = Join-Path $env:LOCALAPPDATA "Temp\opencode"
New-Item -ItemType Directory -Force -Path $dir | Out-Null

function Get-ActiveDisplayId {
    $w = Join-Path $dir "win-active.txt"
    & $adb shell dumpsys window displays *> $w
    $cur = ""
    foreach ($line in Get-Content $w) {
        if ($line -match "Display: mDisplayId=(\d+)") { $cur = $Matches[1] }
        if ($line -match "mCurrentFocus=Window") { return $cur }
    }
    return "0"
}

function Get-UniqueId([string]$displayId) {
    $d = Join-Path $dir "disp-active.txt"
    & $adb shell dumpsys display *> $d
    $pattern = "displayId=$displayId, uniqueId=.{0,2}local:(\d+)"
    $m = Select-String -Path $d -Pattern $pattern
    if ($m -and $m.Matches.Count -gt 0) { return $m.Matches[0].Groups[1].Value }
    return ""
}

switch ($Cmd) {
    "shot" {
        Add-Type -AssemblyName System.Drawing
        $name = if ($A) { $A } else { "shot" }
        $id = Get-UniqueId (Get-ActiveDisplayId)
        if (-not $id) { Write-Output "cannot detect display id"; break }
        $png = Join-Path $dir "$name.png"
        $small = Join-Path $dir "$name-small.png"
        cmd /c "`"$adb`" exec-out screencap -p -d $id > `"$png`""
        if (-not (Test-Path $png)) { Write-Output "screencap failed"; break }
        $bytes = [System.IO.File]::ReadAllBytes($png)
        if ($bytes.Length -gt 8 -and $bytes[0] -eq 0x89) {
            $img = [System.Drawing.Image]::FromStream((New-Object System.IO.MemoryStream(, $bytes)))
            $wpx = [int]($img.Width * 0.36)
            $hpx = [int]($img.Height * 0.36)
            $bmp = New-Object System.Drawing.Bitmap $wpx, $hpx
            $g = [System.Drawing.Graphics]::FromImage($bmp)
            $g.DrawImage($img, 0, 0, $wpx, $hpx)
            $bmp.Save($small, [System.Drawing.Imaging.ImageFormat]::Png)
            Write-Output ("shot: {0}x{1} display={2} -> {3}" -f $img.Width, $img.Height, $id, $small)
            $img.Dispose()
            $bmp.Dispose()
        } else {
            $head = [System.Text.Encoding]::UTF8.GetString($bytes[0..([Math]::Min(160, $bytes.Length - 1))])
            Write-Output ("not png: " + $head)
        }
    }
    "tap" { & $adb shell input tap $A $B }
    "text" { & $adb shell input text $A }
    "key" { & $adb shell input keyevent $A }
    "swipe" { & $adb shell input swipe $A $B $C $D4 300 }
    "start" {
        & $adb shell am force-stop $pkg
        Start-Sleep -Seconds 1
        if ($A) {
            & $adb shell am start -n "$pkg/.MainActivity" --es devAutoConnect $A --es devUser $B --es devPassword $C
        } else {
            & $adb shell am start -n "$pkg/.MainActivity"
        }
    }
    "dump" {
        & $adb shell uiautomator dump /sdcard/ui.xml *> $null
        & $adb shell cat /sdcard/ui.xml > (Join-Path $dir "ui.xml")
        Write-Output ("dumped: " + (Join-Path $dir "ui.xml"))
    }
    "asapp" { & $adb shell "run-as $pkg sh -c '$A'" 2>&1 | Select-Object -First 8 }
    "fw" { & $adb shell am start -n "com.miui.securitycenter/com.miui.networkassistant.ui.activity.FirewallActivity" }
    "stay" {
        & $adb shell dumpsys power *> (Join-Path $dir "power.txt")
        $hit = Select-String -Path (Join-Path $dir "power.txt") -Pattern "mWakefulness=|mStayOn=" | Select-Object -First 2
        ($hit | ForEach-Object { $_.Line.Trim() }) -join " | "
    }
}
