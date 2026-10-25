# SPDX-License-Identifier: Apache-2.0
#
# Shared helpers for the Windows edition: setup.ps1, start.ps1 and stop.ps1
# dot-source this file. Works in Windows PowerShell 5.1 and PowerShell 7.
# Nothing here needs administrator rights: every file lives under the user's
# profile (the workshop folder, uv in ~\.local\bin, Ollama's models in ~\.ollama).
#
# Dùng chung cho setup.ps1, start.ps1 và stop.ps1 (bản Windows).

$ErrorActionPreference = 'Continue'   # native tools write to stderr; exit codes are checked instead
$ProgressPreference = 'SilentlyContinue'   # Invoke-WebRequest's progress bar makes downloads many times slower
try {
    [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
} catch {}
try { [Console]::OutputEncoding = New-Object System.Text.UTF8Encoding $false } catch {}
$OutputEncoding = New-Object System.Text.UTF8Encoding $false
# Python reads and writes UTF-8 everywhere (Vietnamese text), whatever the code page.
$env:PYTHONUTF8 = '1'
$env:PYTHONIOENCODING = 'utf-8'

$Root = Split-Path -Parent $PSScriptRoot
$Run = Join-Path $Root '.run'
New-Item -ItemType Directory -Force -Path $Run | Out-Null
# The Pythons uv installs live in the workshop folder, not in %APPDATA%: a packaged (MSIX)
# terminal redirects %APPDATA% writes into its own folder, and the link uv makes from
# 3.13 to 3.13.x then points at nothing ("Missing expected target directory").
$env:UV_PYTHON_INSTALL_DIR = Join-Path $Run 'python'
if (-not $Log) { $Log = Join-Path $Root 'setup-log.txt' }
$Interactive = [Environment]::UserInteractive -and -not $env:CI

# ------------------------------------------------------------------ settings
# The environment wins, then workshop.local.env (this machine only), then workshop.env.
function Read-EnvFile([string]$Path) {
    $h = @{}
    if (Test-Path -LiteralPath $Path) {
        foreach ($line in [IO.File]::ReadAllLines($Path, [Text.Encoding]::UTF8)) {
            $l = $line.Trim()
            if (-not $l -or $l.StartsWith('#') -or -not $l.Contains('=')) { continue }
            $kv = $l.Split('=', 2)
            $v = ($kv[1] -split ' #', 2)[0].Trim().Trim('"').Trim("'")
            $h[$kv[0].Trim()] = $v
        }
    }
    return $h
}
$script:EnvFile = Read-EnvFile (Join-Path $Root 'workshop.env')
$script:EnvLocal = Read-EnvFile (Join-Path $Root 'workshop.local.env')
function Get-Setting([string]$Key, [string]$Default = '') {
    $v = [Environment]::GetEnvironmentVariable($Key)
    if ($v) { return $v }
    if ($script:EnvLocal.ContainsKey($Key) -and $script:EnvLocal[$Key]) { return $script:EnvLocal[$Key] }
    if ($script:EnvFile.ContainsKey($Key) -and $script:EnvFile[$Key]) { return $script:EnvFile[$Key] }
    return $Default
}

$ChatModel = Get-Setting 'CHAT_MODEL' 'nemotron-3.5-lightning:30b-a3b'
$EmbedModel = Get-Setting 'EMBED_MODEL' 'qwen3-embedding:4b'
$Lab1Base = Get-Setting 'LAB1_BASE_OLLAMA' 'qwen2.5:1.5b-instruct'
$Lab1Tuned = Get-Setting 'LAB1_TUNED_MODEL' 'aurora-assistant'
$OllamaUrl = (Get-Setting 'OLLAMA_URL' 'http://127.0.0.1:11434').TrimEnd('/')
$HubPort = Get-Setting 'HUB_PORT' '8090'
$OllamaVersion = Get-Setting 'WIN_OLLAMA_VERSION' 'v0.40.8'
$MinOllama = '0.32.9'
$PythonVersion = Get-Setting 'WIN_PYTHON' '3.13'
$WinChatContext = Get-Setting 'WIN_CHAT_CONTEXT' '32768'
$OllamaContext = Get-Setting 'OLLAMA_CONTEXT_LENGTH' '32768'
$AuroraUrl = Get-Setting 'AURORA_GGUF_URL' ''
$AuroraSha = Get-Setting 'AURORA_GGUF_SHA256' ''
# Enterprise demos on Windows: llama.cpp's llama-server, a GGUF build of Qwen 3.6, PhoWhisper, Piper.
$LlamaBuild = Get-Setting 'WIN_LLAMA_BUILD' 'b11819'
$GgufRepo = Get-Setting 'BATCH_GGUF_REPO' 'unsloth/Qwen3.6-35B-A3B-GGUF'
$GgufRevision = Get-Setting 'BATCH_GGUF_REVISION' 'a483e9e6cbd595906af30beda3187c2663a1118c'
$GgufFile = Get-Setting 'BATCH_GGUF' 'Qwen3.6-35B-A3B-UD-Q4_K_M.gguf'
$GgufMmproj = Get-Setting 'BATCH_MMPROJ' 'mmproj-F16.gguf'
$AsrModel = Get-Setting 'ASR_MODEL' 'vinai/PhoWhisper-medium'
$AsrRevision = Get-Setting 'ASR_MODEL_REVISION' '55a7e3eb6c906de891f8f06a107754427dd3be79'
$PiperVersion = Get-Setting 'PIPER_VERSION' '1.8.0'
$VoiceRevision = Get-Setting 'VOICE_REVISION' 'c10ece1aade47bb51c153c893d14e5bf8e5b7117'
$TorchCuda = Get-Setting 'WIN_TORCH_CUDA' 'torch==2.14.0+cu134'
$TorchCudaIndex = Get-Setting 'WIN_TORCH_CUDA_INDEX' 'https://pypi.nvidia.com/nvtorch_oot/'
$TorchCpu = Get-Setting 'WIN_TORCH_CPU' 'torch==2.9.1+cpu'
$TorchCpuIndex = Get-Setting 'WIN_TORCH_CPU_INDEX' 'https://download.pytorch.org/whl/cpu'

$Repo = 'an6122003/rtx-spark-ai-workshop'
$InstallCmd = "irm https://raw.githubusercontent.com/$Repo/main/install.ps1 | iex"
$OllamaDir = Join-Path $Run 'ollama'
$VenvPy = Join-Path $Root '.venv\Scripts\python.exe'
$HubUrl = "http://127.0.0.1:$HubPort/"

# ------------------------------------------------------------------- output
function Write-Log([string]$Text) {
    $line = '[{0}] {1}' -f (Get-Date -Format 'HH:mm:ss'), $Text
    [IO.File]::AppendAllText($Log, $line + [Environment]::NewLine, (New-Object System.Text.UTF8Encoding $false))
}
function Show-Line([string]$Mark, [ConsoleColor]$Color, [string]$En, [string]$Vi) {
    Write-Host '   ' -NoNewline
    Write-Host $Mark -ForegroundColor $Color -NoNewline
    Write-Host "  $En"
    if ($Vi) { Write-Host "      $Vi" -ForegroundColor DarkGray }
}
function Show-Ok([string]$En, [string]$Vi = '')   { Show-Line ([string][char]0x2714) Green $En $Vi; Write-Log "ok: $En" }
function Show-Bad([string]$En, [string]$Vi = '')  { Show-Line ([string][char]0x2718) Red $En $Vi; Write-Log "FAIL: $En" }
function Show-Warn([string]$En, [string]$Vi = '') { Show-Line '!' Yellow $En $Vi; Write-Log "warn: $En" }
function Show-Info([string]$En, [string]$Vi = '') {
    Write-Host "   $En"
    if ($Vi) { Write-Host "   $Vi" -ForegroundColor DarkGray }
}
$script:StepNo = 0
function Show-Step([string]$En, [string]$Vi) {
    $script:StepNo++
    Write-Host ''
    Write-Host ([string][char]0x2500 * 66) -ForegroundColor DarkGray
    Write-Host ('Step {0}. {1}' -f $script:StepNo, $En)
    Write-Host "        $Vi" -ForegroundColor DarkGray
    Write-Log "=== step $($script:StepNo): $En"
}
function Show-LogTail([int]$Lines = 12) {
    Write-Host '      --- last lines of setup-log.txt ---' -ForegroundColor DarkGray
    if (Test-Path -LiteralPath $Log) {
        Get-Content -LiteralPath $Log -Tail $Lines -Encoding UTF8 | ForEach-Object { Write-Host "      $_" }
    }
}

# ------------------------------------------------------- running programs
# One command line from a list of arguments, quoted for Windows' C runtime rules.
function Join-ArgList([string[]]$ArgList) {
    ($ArgList | ForEach-Object {
        if ($_ -eq '') { '""' }
        elseif ($_ -match '[\s"]') { '"' + ($_ -replace '(\\*)"', '$1$1\"' -replace '(\\+)$', '$1$1') + '"' }
        else { $_ }
    }) -join ' '
}

# Run a program quietly into the log, with a spinner on screen. Returns its exit code.
function Invoke-Logged([string]$Message, [string]$Exe, [string[]]$ArgList, [string]$WorkDir = $Root) {
    Write-Log "run: $Exe $(Join-ArgList $ArgList)"
    $out = Join-Path $Run 'step-out.txt'
    $err = Join-Path $Run 'step-err.txt'
    Remove-Item -LiteralPath $out, $err -ErrorAction SilentlyContinue
    try {
        $p = Start-Process -FilePath $Exe -ArgumentList (Join-ArgList $ArgList) -WorkingDirectory $WorkDir `
            -NoNewWindow -PassThru -RedirectStandardOutput $out -RedirectStandardError $err
    } catch {
        Write-Log "could not start ${Exe}: $($_.Exception.Message)"
        return 127
    }
    $null = $p.Handle   # without this, ExitCode can come back empty after the process ends
    $frames = '|/-\'
    $i = 0
    $sw = [Diagnostics.Stopwatch]::StartNew()
    while (-not $p.HasExited) {
        if ($Interactive) {
            Write-Host ("`r   {0} {1}  {2:mm\:ss} " -f $frames[$i % 4], $Message, $sw.Elapsed) -NoNewline -ForegroundColor DarkGray
        } elseif ($i -gt 0 -and $i % 120 -eq 0) {
            # Unattended (CI): a line a minute, with the step's latest output.
            $last = ''
            foreach ($f in $err, $out) {
                try {
                    $t = Get-Content -LiteralPath $f -Tail 1 -ErrorAction Stop
                    if ($t) { $last = [string]$t; break }
                } catch {}
            }
            Write-Host ("   ... {0}: {1:hh\:mm\:ss}  {2}" -f $Message, $sw.Elapsed, $last)
        }
        Start-Sleep -Milliseconds 500
        $i++
    }
    $p.WaitForExit()
    if ($Interactive) { Write-Host ("`r" + (' ' * 79) + "`r") -NoNewline }
    foreach ($f in $out, $err) {
        if (Test-Path -LiteralPath $f) {
            $text = [IO.File]::ReadAllText($f, [Text.Encoding]::UTF8)
            if ($text) { [IO.File]::AppendAllText($Log, $text, (New-Object System.Text.UTF8Encoding $false)) }
        }
    }
    Write-Log "exit code $($p.ExitCode)"
    return $p.ExitCode
}

# Big files (models) with Windows' own curl.exe: it resumes an interrupted download.
function Get-BigDownload([string]$Url, [string]$OutFile) {
    $curl = Join-Path $env:SystemRoot 'System32\curl.exe'
    if (-not (Test-Path -LiteralPath $curl)) { return (Get-Download $Url $OutFile) }
    Write-Log "download (resumable) $Url"
    $part = "$OutFile.part"
    $show = if ($Interactive) { '--progress-bar' } else { '--silent' }
    for ($attempt = 1; $attempt -le 4; $attempt++) {
        & $curl -L --fail --show-error $show --retry 5 --retry-delay 5 -C - -o $part $Url
        if ($LASTEXITCODE -eq 0) {
            Move-Item -LiteralPath $part -Destination $OutFile -Force
            return $true
        }
        Write-Log "curl exit $LASTEXITCODE (attempt $attempt)"
        Start-Sleep -Seconds 5
    }
    return $false
}

function Get-Download([string]$Url, [string]$OutFile) {
    Write-Log "download $Url"
    $tmp = "$OutFile.part"
    try {
        Invoke-WebRequest -Uri $Url -OutFile $tmp -UseBasicParsing -TimeoutSec 600
        Move-Item -LiteralPath $tmp -Destination $OutFile -Force
        return $true
    } catch {
        Write-Log "download failed: $($_.Exception.Message)"
        Remove-Item -LiteralPath $tmp -ErrorAction SilentlyContinue
        return $false
    }
}

# Unzip with Windows' own tar.exe (much faster than Expand-Archive), falling back to it.
function Expand-Zip([string]$Zip, [string]$Dest) {
    New-Item -ItemType Directory -Force -Path $Dest | Out-Null
    $tar = Join-Path $env:SystemRoot 'System32\tar.exe'
    if (Test-Path -LiteralPath $tar) {
        & $tar -xf $Zip -C $Dest 2>&1 | Out-Null
        if ($LASTEXITCODE -eq 0) { return $true }
    }
    try { Expand-Archive -LiteralPath $Zip -DestinationPath $Dest -Force; return $true } catch { return $false }
}

# ------------------------------------------------------------------ probes
function Get-Json([string]$Url, [int]$TimeoutSec = 5) {
    try { return Invoke-RestMethod -Uri $Url -TimeoutSec $TimeoutSec -UseBasicParsing } catch { return $null }
}
function Test-OllamaUp { return [bool](Get-Json "$OllamaUrl/api/version" 4) }
function Get-OllamaRunningVersion {
    $v = Get-Json "$OllamaUrl/api/version" 4
    if ($v) { return [string]$v.version }
    return ''
}
function Test-VersionAtLeast([string]$Have, [string]$Want) {
    try { return ([version]($Have -replace '[^0-9.].*$', '')) -ge ([version]$Want) } catch { return $false }
}
function Test-OllamaHas([string]$Model) {
    $tags = Get-Json "$OllamaUrl/api/tags" 10
    if (-not $tags) { return $false }
    $names = @($tags.models | ForEach-Object { $_.name })
    if ($names -contains $Model) { return $true }
    return (-not $Model.Contains(':')) -and ($names -contains "${Model}:latest")
}
function Test-HubUp { return [bool](Get-Json "${HubUrl}api/health" 3) }

# The workshop's own copy of Ollama (a pinned release, unpacked under .run\ollama),
# or one the user installed themselves.
function Get-OllamaExe {
    $own = Join-Path $OllamaDir 'ollama.exe'
    if (Test-Path -LiteralPath $own) { return $own }
    $cmd = Get-Command 'ollama.exe' -ErrorAction SilentlyContinue
    if ($cmd) { return $cmd.Source }
    $user = Join-Path $env:LOCALAPPDATA 'Programs\Ollama\ollama.exe'
    if (Test-Path -LiteralPath $user) { return $user }
    return $null
}

# Start the workshop's own Ollama hidden in the background, with the workshop's settings.
# It keeps running when this window closes (models stay loaded); stop.ps1 stops it.
function Start-WorkshopOllama {
    $exe = Join-Path $OllamaDir 'ollama.exe'
    if (-not (Test-Path -LiteralPath $exe)) { return $false }
    $env:OLLAMA_HOST = ($OllamaUrl -replace '^https?://', '')
    $env:OLLAMA_CONTEXT_LENGTH = $OllamaContext
    $env:OLLAMA_KEEP_ALIVE = '30m'
    $env:OLLAMA_MAX_LOADED_MODELS = '4'
    $logFile = Join-Path $Run 'ollama.log'
    Remove-Item -LiteralPath $logFile -ErrorAction SilentlyContinue
    Write-Log "start: $exe serve"
    $p = Start-Process -FilePath $exe -ArgumentList 'serve' -WindowStyle Hidden -PassThru `
        -RedirectStandardOutput (Join-Path $Run 'ollama-out.log') -RedirectStandardError $logFile
    [IO.File]::WriteAllText((Join-Path $Run 'ollama.pid'), [string]$p.Id)
    for ($i = 0; $i -lt 60; $i++) {
        if (Test-OllamaUp) { return $true }
        if ($p.HasExited) { break }
        Start-Sleep -Seconds 1
    }
    return (Test-OllamaUp)
}

# What Ollama runs models on, from its startup log: 'cuda', 'cpu', ... or '' when unknown.
function Get-OllamaCompute {
    foreach ($f in (Join-Path $Run 'ollama.log'), (Join-Path $env:LOCALAPPDATA 'Ollama\server.log')) {
        if (-not (Test-Path -LiteralPath $f)) { continue }
        $line = Get-Content -LiteralPath $f -Tail 400 -ErrorAction SilentlyContinue |
            Where-Object { $_ -match 'inference compute' } | Select-Object -Last 1
        if ($line -and $line -match 'library=(\w+)') { return $Matches[1].ToLower() }
    }
    return ''
}

# Keep the PC awake, screen on, while this script runs: the setup downloads for up to an hour
# with nobody touching the laptop, and idle sleep would cut it off. Ends with the process.
function Set-KeepAwake {
    try {
        if (-not ('Workshop.Power' -as [type])) {
            Add-Type -Namespace Workshop -Name Power -MemberDefinition `
                '[System.Runtime.InteropServices.DllImport("kernel32.dll")] public static extern uint SetThreadExecutionState(uint esFlags);'
        }
        $null = [Workshop.Power]::SetThreadExecutionState([uint32]2147483651)   # CONTINUOUS | SYSTEM_REQUIRED | DISPLAY_REQUIRED
    } catch {
        Write-Log "keep awake: $($_.Exception.Message)"
    }
}

# $true when a laptop runs on its battery.
function Test-OnBattery {
    try {
        Add-Type -AssemblyName System.Windows.Forms
        return [System.Windows.Forms.SystemInformation]::PowerStatus.PowerLineStatus -eq 'Offline'
    } catch {
        return $false
    }
}

function Get-Uv {
    $cmd = Get-Command 'uv.exe' -ErrorAction SilentlyContinue
    if ($cmd) { return $cmd.Source }
    $p = Join-Path $HOME '.local\bin\uv.exe'
    if (Test-Path -LiteralPath $p) { return $p }
    return $null
}

function Stop-WorkshopApp {
    $pidFile = Join-Path $Run 'hub.pid'
    if (Test-Path -LiteralPath $pidFile) {
        $id = 0
        if ([int]::TryParse(([IO.File]::ReadAllText($pidFile)).Trim(), [ref]$id) -and $id -gt 0) {
            Stop-Process -Id $id -Force -ErrorAction SilentlyContinue
        }
        Remove-Item -LiteralPath $pidFile -ErrorAction SilentlyContinue
    }
    for ($i = 0; $i -lt 10 -and (Test-HubUp); $i++) { Start-Sleep -Seconds 1 }
}
