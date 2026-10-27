# Loopback SSH server for checking the SFTP paths by hand.
#
#   powershell -File scripts\dev-sshd.ps1 start|stop|status|clean
#
# Everything lives under $env:TEMP\xssh-target: host key, a throwaway client key
# (`id_dev`, private key kept there for the app's key-auth field) and the
# authorized_keys the server reads. Nothing touches %USERPROFILE%\.ssh.
# Binds 127.0.0.1 only.
param([string]$Action = 'start')

$ErrorActionPreference = 'Stop'
$dir = Join-Path $env:TEMP 'xssh-target'
$port = 2222
$pidFile = Join-Path $dir 'sshd.pid'
$keygen = 'C:\Windows\System32\OpenSSH\ssh-keygen.exe'
$sshd = 'C:\Windows\System32\OpenSSH\sshd.exe'

function Ensure-Target {
  New-Item -ItemType Directory -Force -Path $dir | Out-Null
  if (!(Test-Path (Join-Path $dir 'host_ed25519'))) {
    & $keygen -q -t ed25519 -N '""' -f (Join-Path $dir 'host_ed25519') | Out-Null
  }
  if (!(Test-Path (Join-Path $dir 'id_dev'))) {
    & $keygen -q -t ed25519 -N '""' -C 'xssh-dev' -f (Join-Path $dir 'id_dev') | Out-Null
  }
  Copy-Item (Join-Path $dir 'id_dev.pub') (Join-Path $dir 'authorized_keys') -Force
  # No PerSourcePenalties: the OpenSSH shipped with Windows is 9.x and rejects
  # that option outright, so sshd never starts.
  @"
Port $port
ListenAddress 127.0.0.1
HostKey $dir\host_ed25519
AuthorizedKeysFile $dir\authorized_keys
PubkeyAuthentication yes
PasswordAuthentication no
PermitRootLogin no
StrictModes no
Subsystem sftp internal-sftp
LogLevel VERBOSE
"@ | Set-Content -Path (Join-Path $dir 'sshd_config') -Encoding ascii
}

switch ($Action) {
  'start' {
    Ensure-Target
    if (Test-Path $pidFile) {
      $old = Get-Content $pidFile -ErrorAction SilentlyContinue
      if ($old -and (Get-Process -Id $old -ErrorAction SilentlyContinue)) {
        "already running (pid $old) on 127.0.0.1:$port"; break
      }
    }
    $p = Start-Process -FilePath $sshd -ArgumentList '-D', '-e', '-f', (Join-Path $dir 'sshd_config') `
      -RedirectStandardError (Join-Path $dir 'sshd.log') -WindowStyle Hidden -PassThru
    Set-Content -Path $pidFile -Value $p.Id -Encoding ascii
    Start-Sleep -Seconds 2
    if ($p.HasExited) { "sshd failed to start:"; Get-Content (Join-Path $dir 'sshd.log') -Tail 5 }
    else {
      "running (pid $($p.Id)) on 127.0.0.1:$port"
      "  key:  $(Join-Path $dir 'id_dev')"
      "  user: $env:USERNAME"
    }
  }
  'stop' {
    if (Test-Path $pidFile) {
      $old = Get-Content $pidFile -ErrorAction SilentlyContinue
      # By recorded pid only: matching on the command line also matches the
      # shell that runs this script, and on Path it misses sshd entirely.
      if ($old -and (Get-Process -Id $old -ErrorAction SilentlyContinue)) { Stop-Process -Id $old -Force }
      Remove-Item $pidFile -ErrorAction SilentlyContinue
      "stopped"
    } else { "not running" }
  }
  'status' {
    $listening = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue
    if ($listening) { "listening on 127.0.0.1:$port" } else { "not listening" }
  }
  'clean' {
    & $PSCommandPath stop | Out-Null
    Start-Sleep -Seconds 1
    if (Test-Path $dir) { Remove-Item -Recurse -Force $dir }
    "removed $dir"
  }
  default { "usage: dev-sshd.ps1 start|stop|status|clean" }
}