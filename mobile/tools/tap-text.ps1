param(
    [string]$Text = "连接",
    [int]$MinX = 0
)

# 点包含某段文字的那个可点节点的中心。
#
# 不能靠"往前找最近的可点节点":文字在按钮里,但再往前可能还有别的可点容器
# (双栏时左栏的主机卡片就能把它抢走 —— 点下去是选中卡片,不是按连接)。
# 这里改成:先拿到文字的坐标,再找**唯一一个包含该坐标**的可点节点。
$adb = "D:\Android\sdk\platform-tools\adb.exe"

& $adb shell uiautomator dump /sdcard/ui.xml 2>&1 | Out-Null
$xml = (& $adb exec-out cat /sdcard/ui.xml) -join "`n"

# 文字的 bounds
$pattern = 'text="' + [regex]::Escape($Text) + '"[^>]*bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"'
$candidates = @()
foreach ($m in [regex]::Matches($xml, $pattern)) {
    $tx1 = [int]$m.Groups[1].Value
    $ty1 = [int]$m.Groups[2].Value
    $tx2 = [int]$m.Groups[3].Value
    $ty2 = [int]$m.Groups[4].Value
    if ($tx1 -lt $MinX) { continue }
    $candidates += , @($tx1, $ty1, $tx2, $ty2)
}
if ($candidates.Count -eq 0) { Write-Output "text not found: $Text"; exit 1 }
$t = $candidates[0]
$cx = [int](($t[0] + $t[2]) / 2)
$cy = [int](($t[1] + $t[3]) / 2)

# 包含这个点的可点节点里,取面积最小的那个(最贴近文字 = 真正的按钮)。
$best = $null
$bestArea = [int]::MaxValue
foreach ($n in [regex]::Matches($xml, '<node[^>]*clickable="true"[^>]*bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"[^>]*>')) {
    $x1 = [int]$n.Groups[1].Value
    $y1 = [int]$n.Groups[2].Value
    $x2 = [int]$n.Groups[3].Value
    $y2 = [int]$n.Groups[4].Value
    if ($cx -lt $x1 -or $cx -gt $x2 -or $cy -lt $y1 -or $cy -gt $y2) { continue }
    $area = ($x2 - $x1) * ($y2 - $y1)
    if ($area -lt $bestArea) { $bestArea = $area; $best = @($x1, $y1, $x2, $y2) }
}
if ($null -eq $best) { Write-Output "no clickable node contains: $Text"; exit 1 }

$bx = [int](($best[0] + $best[2]) / 2)
$by = [int](($best[1] + $best[3]) / 2)
Write-Output "tap '$Text' at $bx,$by (text center $cx,$cy)"
& $adb shell input swipe $bx $by $bx $by 80 | Out-Null