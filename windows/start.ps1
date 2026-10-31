# SPDX-License-Identifier: Apache-2.0
#
# Start the workshop on Windows: Ollama (when it is not running), then the web
# app, then the browser. The desktop shortcut "RTX Spark Workshop" runs this.
# Closing this window stops the workshop app; Ollama keeps running in the
# background so the models stay loaded (windows\stop.ps1 stops both).
#
# Mở workshop trên Windows. Đóng cửa sổ này sẽ dừng ứng dụng workshop.
#
#     powershell -ExecutionPolicy Bypass -File windows\start.ps1 [-NoBrowser]

param([switch]$NoBrowser)

$Log = Join-Path (Split-Path -Parent $PSScriptRoot) '.run\start-log.txt'
. (Join-Path $PSScriptRoot 'lib.ps1')
try { $Host.UI.RawUI.WindowTitle = 'RTX Spark Workshop' } catch {}
Write-Log 'start'

function Stop-WithMessage([string]$En, [string]$Vi) {
    Show-Bad $En $Vi
    if ($Interactive) { $null = Read-Host "`n   Press Enter to close / Nhấn Enter để đóng" }
    exit 1
}

if (-not (Test-Path -LiteralPath $VenvPy)) {
    Show-Bad 'The workshop is not installed yet. Run the install command in PowerShell:' `
             'Workshop chưa được cài đặt. Hãy chạy lệnh cài đặt trong PowerShell:'
    Write-Host "`n       $InstallCmd`n"
    if ($Interactive) { $null = Read-Host '   Press Enter to close / Nhấn Enter để đóng' }
    exit 1
}

if (-not (Test-OllamaUp)) {
    Show-Info 'Starting Ollama...' 'Đang khởi động Ollama...'
    if (-not (Start-WorkshopOllama)) {
        # No copy of its own: an Ollama the user installed.
        $exe = Get-OllamaExe
        if ($exe) {
            Start-Process -FilePath $exe -ArgumentList 'serve' -WindowStyle Hidden
            for ($i = 0; $i -lt 30 -and -not (Test-OllamaUp); $i++) { Start-Sleep -Seconds 1 }
        }
    }
    if (-not (Test-OllamaUp)) {
        Stop-WithMessage 'Ollama does not start. Run the install command again.' 'Ollama không khởi động được. Hãy chạy lại lệnh cài đặt.'
    }
}
Show-Ok "Ollama $(Get-OllamaRunningVersion) is running" 'Ollama đang chạy'

# A model pulled again loses its context setting: re-apply it (local, nothing downloaded),
# as large as fits this computer (app\hardware.py).
if (Test-OllamaHas $ChatModel) {
    $ctx = "$(& $VenvPy (Join-Path $Root 'app\hardware.py') --context $ChatModel 2>$null)".Trim()
    if ($ctx -notmatch '^\d+$') { $ctx = $WinChatContext }
    $null = & $VenvPy (Join-Path $Root 'scripts\ollama-context.py') $ChatModel $ctx 2>&1
}

# An app left running (another window, or an older version) is replaced.
if (Test-HubUp) {
    Show-Info 'Restarting the workshop app...' 'Đang khởi động lại ứng dụng workshop...'
    Stop-WorkshopApp
}

$appArgs = @((Join-Path $Root 'app\server.py'))
if (-not $NoBrowser) { $appArgs += '--open' }
Write-Log "app: $VenvPy $($appArgs -join ' ')"
& $VenvPy @appArgs
$code = $LASTEXITCODE
if ($code -ne 0) {
    Stop-WithMessage "The workshop app stopped with an error ($code). Details: $Log" "Ứng dụng workshop dừng do lỗi ($code)."
}
exit 0
