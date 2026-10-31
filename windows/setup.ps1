# SPDX-License-Identifier: Apache-2.0
#
# ============================================================================
#  RTX SPARK AI WORKSHOP - one-command setup for Windows
#  WORKSHOP AI TRÊN RTX SPARK - cài đặt bằng một lệnh trên Windows
# ============================================================================
#
#  The install command runs it (PowerShell):    Lệnh cài đặt sẽ chạy tệp này:
#
#      irm https://raw.githubusercontent.com/an6122003/rtx-spark-ai-workshop/main/install.ps1 | iex
#
#  or again, from the workshop folder:          hoặc chạy lại trong thư mục workshop:
#
#      powershell -ExecutionPolicy Bypass -File windows\setup.ps1
#
#  It installs and checks everything for the hands-on labs, then opens the
#  workshop in the browser. Safe to run again: finished steps are skipped.
#  No administrator rights needed.
#  Chương trình cài và kiểm tra mọi thứ cho các bài thực hành rồi mở workshop
#  trên trình duyệt. Chạy lại an toàn. Không cần quyền quản trị.
#
#  Options / Tuỳ chọn:
#    -Yes        do not pause for the third-party software notice
#    -CheckOnly  inspect this computer, change nothing
#    -NoStart    do not open the workshop app at the end
#    -SkipEnterprise  skip the enterprise batch demos (about 25 GB)
#    -Test       small CPU models for GitHub's test machines: checks the wiring, not the answers
#
#  Everything is logged to setup-log.txt. / Mọi chi tiết được ghi vào setup-log.txt.
# ============================================================================

param([switch]$Yes, [switch]$CheckOnly, [switch]$NoStart, [switch]$SkipEnterprise, [switch]$Test)

$RootDir = Split-Path -Parent $PSScriptRoot
$LocalEnv = Join-Path $RootDir 'workshop.local.env'
$TestMark = '# Written by windows\setup.ps1 -Test'
if ($Test) {
    # Tiny models that run on a 4-core CPU without a GPU (the GitHub test machines).
    $lines = @(
        ($TestMark + ": small models for GitHub's CPU-only test machines."),
        'CHAT_MODEL=qwen2.5:1.5b-instruct',
        'EMBED_MODEL=qwen3-embedding:0.6b',
        'WIN_CHAT_CONTEXT=8192',
        'OLLAMA_CONTEXT_LENGTH=8192',
        'LAB3_MAX_STEPS=4',
        'BATCH_GGUF_REPO=ggml-org/SmolVLM-256M-Instruct-GGUF',
        'BATCH_GGUF_REVISION=b9e4379657e1450d04d02eec8e345667265b0a00',
        'BATCH_GGUF=SmolVLM-256M-Instruct-Q8_0.gguf',
        'BATCH_MMPROJ=mmproj-SmolVLM-256M-Instruct-Q8_0.gguf',
        'BATCH_SLOTS=4',
        'BATCH_SLOT_CONTEXT=4096',
        'ASR_MODEL=vinai/PhoWhisper-tiny',
        'ASR_MODEL_REVISION=cc51d32be916efebde04ff549854fa1741cb5c02',
        'ENT_INBOX_COUNT=40',
        'ENT_INVOICES_COUNT=10',
        'ENT_CALLS_COUNT=6',
        'LAB1_BASE_HF=Qwen/Qwen2.5-0.5B-Instruct',
        'LAB1_SMOKE_STEPS=2'
    )
    [IO.File]::WriteAllLines($LocalEnv, $lines)
} elseif ((Test-Path -LiteralPath $LocalEnv) -and
          ([IO.File]::ReadAllLines($LocalEnv) | Select-Object -First 1) -like "$TestMark*") {
    Remove-Item -LiteralPath $LocalEnv   # a test run's settings must not stay on a real machine
}
$Log = Join-Path $RootDir 'setup-log.txt'
[IO.File]::WriteAllText($Log, '')
. (Join-Path $PSScriptRoot 'lib.ps1')

$Arch = [string][Runtime.InteropServices.RuntimeInformation]::OSArchitecture
Write-Log "setup started: $([Environment]::OSVersion.VersionString) $Arch, PowerShell $($PSVersionTable.PSVersion), folder $Root"
if ($Test) { Write-Log 'test mode: small CPU models (workshop.local.env)' }

$CoreOk = $true
$Lab1 = 'missing'; $Lab2 = 'unchecked'; $Lab3 = 'unchecked'
$Lab1Note = ''; $Lab2Note = ''; $Lab3Note = ''

if ($Interactive) { try { Clear-Host } catch {} }
Write-Host @'

   ┌──────────────────────────────────────────────────────────────┐
   │                                                              │
   │     R T X   S P A R K   A I   W O R K S H O P                │
   │     Workshop AI chạy hoàn toàn trên máy RTX Spark            │
   │                                                              │
   │     1  Fine-tuning Local LLMs   · Tinh chỉnh mô hình         │
   │     2  Build RAG                · Hỏi đáp trên tài liệu      │
   │     3  Build an Agentic Workflow· Agent phân tích dữ liệu    │
   │                                                              │
   └──────────────────────────────────────────────────────────────┘

'@

if ($Interactive -and -not $Yes -and -not $CheckOnly) {
    Write-Host @'
   This will download and install third-party software, each under its own
   license: Ollama, uv, Python and Python packages, llama.cpp, PyTorch, Piper
   and open AI models (NVIDIA Nemotron, Qwen, PhoWhisper). It reads this
   computer first and only downloads AI models that fit it: up to about 58 GB.
   Leave this window open.

   Chương trình sẽ tải và cài phần mềm của bên thứ ba, mỗi phần mềm theo giấy
   phép riêng: Ollama, uv, Python và các gói Python, llama.cpp, PyTorch, Piper
   và các mô hình AI mở (NVIDIA Nemotron, Qwen, PhoWhisper). Chương trình đọc
   cấu hình máy trước và chỉ tải mô hình vừa với máy: tối đa khoảng 58 GB.
   Hãy để cửa sổ này mở.

'@
    Write-Host '   Press Enter to continue, or Ctrl-C to cancel.'
    $null = Read-Host '   Nhấn Enter để tiếp tục, hoặc Ctrl-C để huỷ'
}
Write-Host "`n   Full details / Chi tiết đầy đủ: $Log"
if (-not $CheckOnly) { Set-KeepAwake }

function Test-Url([string]$Url) {
    try {
        $null = Invoke-WebRequest -Uri $Url -Method Head -UseBasicParsing -TimeoutSec 15
        return $true
    } catch {
        return [bool]$_.Exception.Response   # an HTTP error still means the site is reachable
    }
}

# ================================================================ computer ===
Show-Step 'Checking this computer' 'Kiểm tra máy tính'

$os = [Environment]::OSVersion.Version
if ($os.Build -ge 22000) {
    Show-Ok "Windows 11 (build $($os.Build))"
} else {
    Show-Warn "Windows build $($os.Build): this edition is made for Windows 11" 'Bản này dành cho Windows 11'
}
if ($Arch -eq 'Arm64') {
    Show-Ok 'Processor: Arm64 (Windows on Arm)'
} elseif ($Arch -eq 'X64') {
    Show-Warn 'Processor: x64. This edition is made for the RTX Spark (Windows on Arm); it also works with an NVIDIA graphics card' `
              'Bản này dành cho RTX Spark (Windows on Arm); máy x64 có card NVIDIA vẫn dùng được'
} else {
    Show-Bad "Processor: $Arch is not supported" 'Bộ xử lý này không được hỗ trợ'
    exit 1
}

$GpuName = ''
$smi = Get-Command 'nvidia-smi.exe' -ErrorAction SilentlyContinue
if ($smi) {
    $q = & $smi.Source --query-gpu=name,driver_version --format=csv,noheader 2>$null | Select-Object -First 1
    if ($q) {
        $parts = ([string]$q).Split(',')
        $GpuName = $parts[0].Trim()
        Show-Ok "Graphics: $GpuName (driver $($parts[1].Trim()))"
    }
}
if (-not $GpuName) {
    Show-Warn 'No NVIDIA graphics driver found: the AI models will run on the processor, slowly' `
              'Không tìm thấy driver đồ hoạ NVIDIA: mô hình AI sẽ chạy trên CPU, rất chậm'
}

$MemGB = [math]::Round((Get-CimInstance Win32_ComputerSystem).TotalPhysicalMemory / 1GB)
if ($Test -or $MemGB -ge 8) { Show-Ok "$MemGB GB memory (the AI models are chosen to fit it)" "Bộ nhớ $MemGB GB (mô hình AI sẽ được chọn cho vừa)" }
else { Show-Warn "$MemGB GB memory: only the smallest AI models can run" "Máy có $MemGB GB bộ nhớ: chỉ chạy được các mô hình nhỏ nhất" }

# The floor for the tools and the small models; each AI model's own size is checked when it is chosen.
$FreeGB = [math]::Round((Get-Item -LiteralPath $Root).PSDrive.Free / 1GB)
$NeedGB = if ($Test) { 12 } else { 20 }
if ($FreeGB -ge $NeedGB) { Show-Ok "$FreeGB GB free disk" }
else {
    Show-Bad "Only $FreeGB GB free on this drive; at least $NeedGB GB is needed" "Chỉ còn $FreeGB GB trống; cần ít nhất $NeedGB GB"
    if (-not $CheckOnly) { exit 1 }
}

if (Test-OnBattery) {
    Show-Warn 'Running on battery: plug in the charger and keep the lid open until setup finishes' `
              'Máy đang chạy bằng pin: hãy cắm sạc và để mở nắp máy cho đến khi cài xong'
}

$Online = (Test-Url 'https://registry.ollama.ai/v2/') -and (Test-Url 'https://github.com')
if ($Online) { Show-Ok 'Internet connection works' 'Kết nối internet hoạt động' }
else { Show-Warn 'No internet connection: only what is already installed can be used' 'Không có internet: chỉ dùng được những gì đã cài' }

# Smart App Control (1 = on) blocks unsigned programs such as llama.cpp's; it is off or only evaluating on most PCs.
$sac = Get-ItemProperty -Path 'HKLM:\SYSTEM\CurrentControlSet\Control\CI\Policy' -Name 'VerifiedAndReputablePolicyState' -ErrorAction SilentlyContinue
if ($sac -and $sac.VerifiedAndReputablePolicyState -eq 1) {
    Show-Warn 'Smart App Control is on and may block the workshop''s programs. If a step fails, ask IT to turn it off (Windows Security > App & browser control)' `
              'Smart App Control đang bật, có thể chặn các chương trình của workshop. Nếu có bước lỗi, nhờ IT tắt nó (Windows Security > App & browser control)'
}

if ($CheckOnly) {
    Write-Host "`n   -CheckOnly: nothing was changed. / Không thay đổi gì.`n"
    exit 0
}

# ================================================================== python ===
Show-Step 'Preparing the Python environment' 'Chuẩn bị môi trường Python'

$uv = Get-Uv
if (-not $uv -and $Online) {
    $null = Invoke-Logged 'Installing uv (Python installer)' 'powershell.exe' @(
        '-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', 'irm https://astral.sh/uv/install.ps1 | iex')
    $uv = Get-Uv
}
if (-not $uv) {
    Show-Bad 'Could not install uv, the tool that installs Python' 'Không cài được uv (công cụ cài Python)'
    Show-LogTail
    exit 1
}
Show-Ok "uv: $(& $uv --version 2>$null)"

$needVenv = -not (Test-Path -LiteralPath $VenvPy)
if (-not $needVenv) {
    $have = & $VenvPy -c "import sys; print('%d.%d' % sys.version_info[:2])" 2>$null
    if ("$have".Trim() -ne $PythonVersion) { $needVenv = $true }
}
if ($needVenv) {
    $venvArgs = @('venv', '--python', $PythonVersion)
    if (Test-Path -LiteralPath (Join-Path $Root '.venv')) { $venvArgs += '--clear' }
    $venvArgs += (Join-Path $Root '.venv')
    $null = Invoke-Logged "Installing Python $PythonVersion" $uv $venvArgs
}
$code = Invoke-Logged 'Installing pandas, matplotlib and openpyxl' $uv @(
    'pip', 'install', '--python', $VenvPy, '-r', (Join-Path $Root 'hands-on-3-agent\requirements.txt'))
$probe = & $VenvPy -c "import platform, sys, pandas, matplotlib, openpyxl; print(sys.version.split()[0], platform.machine())" 2>$null
if ($code -eq 0 -and $probe) {
    Show-Ok "Python environment ready: Python $probe" 'Môi trường Python đã sẵn sàng'
} else {
    Show-Bad 'The Python environment is incomplete' 'Môi trường Python chưa đầy đủ'
    Show-LogTail
    exit 1
}

# ================================================================== ollama ===
Show-Step 'Preparing the AI model server (Ollama)' 'Chuẩn bị máy chủ mô hình AI (Ollama)'

$ArchTag = if ($Arch -eq 'Arm64') { 'arm64' } else { 'amd64' }
$ownExe = Join-Path $OllamaDir 'ollama.exe'
$verFile = Join-Path $OllamaDir 'VERSION'
$ownVer = if (Test-Path -LiteralPath $verFile) { ([IO.File]::ReadAllText($verFile)).Trim() } else { '' }

# Is the Ollama that answers our own copy? (Then a new pinned version can replace it.)
$ownRunning = $false
$pidFile = Join-Path $Run 'ollama.pid'
if (Test-Path -LiteralPath $pidFile) {
    $opid = 0
    if ([int]::TryParse(([IO.File]::ReadAllText($pidFile)).Trim(), [ref]$opid)) {
        $proc = Get-Process -Id $opid -ErrorAction SilentlyContinue
        $ownRunning = [bool]($proc -and $proc.Path -and ($proc.Path -eq $ownExe))
    }
}

$needOwn = -not (Test-OllamaUp) -or $ownRunning
if ($needOwn -and ((-not (Test-Path -LiteralPath $ownExe)) -or $ownVer -ne $OllamaVersion)) {
    if (-not $Online) {
        Show-Bad 'Ollama is not installed and there is no internet' 'Chưa có Ollama và không có internet'
        exit 1
    }
    $zip = Join-Path $Run "ollama-windows-$ArchTag.zip"
    $url = "https://github.com/ollama/ollama/releases/download/$OllamaVersion/ollama-windows-$ArchTag.zip"
    Show-Info "Downloading Ollama $OllamaVersion ($ArchTag)..." "Đang tải Ollama $OllamaVersion..."
    if (-not (Get-Download $url $zip)) {
        Show-Bad "Could not download Ollama from $url" 'Không tải được Ollama'
        exit 1
    }
    if ($ownRunning) { Stop-Process -Id $opid -Force -ErrorAction SilentlyContinue; Start-Sleep -Seconds 2 }
    Remove-Item -LiteralPath $OllamaDir -Recurse -Force -ErrorAction SilentlyContinue
    if (-not (Expand-Zip $zip $OllamaDir)) {
        Show-Bad 'Could not unpack Ollama' 'Không giải nén được Ollama'
        exit 1
    }
    [IO.File]::WriteAllText($verFile, $OllamaVersion)
    Remove-Item -LiteralPath $zip -ErrorAction SilentlyContinue
    Show-Ok "Ollama $OllamaVersion installed in the workshop folder" 'Đã cài Ollama trong thư mục workshop'
}
if (-not (Test-OllamaUp)) {
    if (-not (Start-WorkshopOllama)) {
        Show-Bad 'Ollama does not start' 'Ollama không khởi động được'
        if (Test-Path -LiteralPath (Join-Path $Run 'ollama.log')) {
            Get-Content -LiteralPath (Join-Path $Run 'ollama.log') -Tail 15 | ForEach-Object { Write-Log "ollama: $_" }
        }
        Show-LogTail
        exit 1
    }
    Start-Sleep -Seconds 3   # it logs the GPU it found just after starting
}
$ver = Get-OllamaRunningVersion
if (Test-VersionAtLeast $ver $MinOllama) { Show-Ok "Ollama $ver is running" 'Ollama đang chạy' }
else { Show-Warn "Ollama $ver is older than ${MinOllama}: tool calls may not work" "Ollama $ver quá cũ" }

$compute = Get-OllamaCompute
if ($compute -eq 'cuda') {
    Show-Ok 'Ollama runs the models on the NVIDIA GPU (CUDA)' 'Ollama chạy mô hình trên GPU NVIDIA'
} elseif ($GpuName -and $compute) {
    Show-Warn "Ollama found no usable GPU ($compute): models run on the processor" `
              'Ollama không dùng được GPU: mô hình chạy trên CPU'
} elseif ($compute) {
    Write-Log "ollama compute: $compute"
}

# =========================================================== model choice ===
Show-Step 'Choosing the AI models for this computer' 'Chọn mô hình AI phù hợp với máy'

# app\hardware.py reads the GPU, its memory (or memory shared with the CPU), the RAM and the
# free disk, and judges every chat model of its catalog: fits, slower (partly on the CPU), or
# too large for this computer, which is never offered.
$Plan = $null
$planJson = & $VenvPy (Join-Path $Root 'app\hardware.py') --json 2>$null
if ($LASTEXITCODE -eq 0 -and $planJson) {
    try { $Plan = ConvertFrom-Json ($planJson -join "`n") } catch { $Plan = $null }
}
$EntFits = $true; $EntWhy = ''
if (-not $Plan) {
    Show-Warn 'Could not read this computer: keeping the configured models' 'Không đọc được cấu hình máy: giữ các mô hình đã cấu hình'
} else {
    $hw = $Plan.hardware
    $kindText = switch ([string]$hw.kind) {
        'unified'  { 'unified memory shared by the CPU and the GPU' }
        'discrete' { "$($hw.vram_gb) GB of GPU memory" }
        default    { 'no NVIDIA GPU: models run on the processor' }
    }
    $gpuText = if ($hw.gpu) { [string]$hw.gpu } else { 'no GPU' }
    Show-Ok "$gpuText, $kindText; $([math]::Round($hw.ram_gb)) GB RAM, $([math]::Round($hw.disk_free_gb)) GB free disk"
    Write-Log "plan: $planJson"
    $usable = @($Plan.models | Where-Object { $_.status -eq 'fits' -or $_.status -eq 'slow' })
    $locked = @($Plan.models | Where-Object { $_.status -eq 'too_big' -or $_.status -eq 'no_disk' })
    $current = @($Plan.models | Where-Object { $_.id -eq $ChatModel }) | Select-Object -First 1

    if (Test-SettingChosen 'CHAT_MODEL') {
        # Chosen before (an earlier setup, the workshop page, or by hand): kept.
        Show-Ok "Chat model: $ChatModel (chosen earlier)" "Mô hình chat: $ChatModel (đã chọn trước đó)"
        if ($current -and $current.status -eq 'too_big' -and $Plan.recommended) {
            Show-Warn "$ChatModel is larger than this computer can run; $($Plan.recommended) would fit. Change it on the workshop page (Models)" `
                      "$ChatModel lớn hơn mức máy chạy được; nên dùng $($Plan.recommended). Đổi trong trang workshop (mục Mô hình)"
        }
    } elseif (-not $usable) {
        Show-Bad 'This computer has too little memory or disk for any of the chat models' 'Máy không đủ bộ nhớ hoặc ổ đĩa cho mô hình chat nào'
        $CoreOk = $false
    } else {
        $choice = [string]$Plan.recommended
        Write-Host ''
        Write-Host '   Chat models that run on this computer / Mô hình chat chạy được trên máy này:'
        for ($i = 0; $i -lt $usable.Count; $i++) {
            $m = $usable[$i]
            $tag = if ($m.id -eq $Plan.recommended) { '  recommended / đề xuất' } elseif ($m.status -eq 'slow') { '  slower: partly on the CPU / chậm hơn' } else { '' }
            Write-Host ('     {0}  {1,-34} {2,5} GB' -f ($i + 1), $m.id, $m.size_gb) -NoNewline
            Write-Host $tag -ForegroundColor $(if ($tag -like '*recommended*') { 'Green' } else { 'DarkGray' })
        }
        if ($locked) {
            Write-Host "     $($locked.Count) larger model(s) need more than this computer has and are not offered." -ForegroundColor DarkGray
            Write-Host "     $($locked.Count) mô hình lớn hơn cần nhiều hơn khả năng của máy nên không được chọn." -ForegroundColor DarkGray
        }
        if ($Interactive -and -not $Yes) {
            $first = [array]::IndexOf(@($usable | ForEach-Object { $_.id }), $choice) + 1
            Write-Host "`n   Press Enter for $first, or type another number."
            $answer = Read-Host "   Nhấn Enter để chọn $first, hoặc gõ số khác"
            $n = 0
            if ([int]::TryParse("$answer".Trim(), [ref]$n) -and $n -ge 1 -and $n -le $usable.Count) { $choice = [string]$usable[$n - 1].id }
        }
        Set-LocalSetting 'CHAT_MODEL' $choice
        $ChatModel = $choice
        Show-Ok "Chat model for this computer: $ChatModel" "Mô hình chat cho máy này: $ChatModel"
    }
    # A small embedding model on a computer with little memory (the document index is rebuilt for it).
    if (-not (Test-SettingChosen 'EMBED_MODEL') -and $Plan.embed_model -and $Plan.embed_model -ne $EmbedModel) {
        Set-LocalSetting 'EMBED_MODEL' ([string]$Plan.embed_model)
        $EmbedModel = [string]$Plan.embed_model
        Show-Ok "Embedding model for this computer: $EmbedModel" "Mô hình nhúng cho máy này: $EmbedModel"
    }
    if (-not $Plan.enterprise.fits) {
        $EntFits = $false
        $EntWhy = switch ([string]$Plan.enterprise.reason) {
            'disk'   { 'needs about 30 GB more free disk' }
            'no_gpu' { 'needs an NVIDIA GPU' }
            default  { 'needs about 40 GB of GPU or unified memory' }
        }
    } else {
        # The batch demos' 25 GB must still fit once the chat model has arrived.
        $chosen = @($Plan.models | Where-Object { $_.id -eq $ChatModel -and -not $_.installed }) | Select-Object -First 1
        if ($chosen -and ($hw.disk_free_gb - $chosen.size_gb) -lt 30) { $EntFits = $false; $EntWhy = 'needs about 30 GB more free disk' }
    }
}

# ================================================================== models ===
Show-Step 'Downloading the AI models' 'Tải các mô hình AI'

$models = @($ChatModel, $EmbedModel, $Lab1Base) | Select-Object -Unique
foreach ($m in $models) {
    if (Test-OllamaHas $m) { Show-Ok "$m ready" "$m đã có"; continue }
    if (-not $Online) { Show-Bad "$m is missing and there is no internet" "Thiếu $m và không có internet"; $CoreOk = $false; continue }
    Write-Log "pull $m"
    $ok = $false
    for ($attempt = 1; $attempt -le 3 -and -not $ok; $attempt++) {
        if ($attempt -gt 1) { Show-Info "Trying again ($attempt/3)..." "Thử lại ($attempt/3)..." }
        Show-Info "Downloading $m..." "Đang tải $m..."
        & $VenvPy (Join-Path $Root 'scripts\pull-model.py') $m
        $ok = ($LASTEXITCODE -eq 0) -and (Test-OllamaHas $m)
    }
    if ($ok) { Show-Ok "$m downloaded" "Đã tải $m" }
    else { Show-Bad "Could not download $m" "Không tải được $m"; $CoreOk = $false }
}
if (Test-OllamaHas $ChatModel) {
    # Hands-on 3 sends the tool list and the data preview with every step: give the chat model room
    # (32,768 tokens, or 16,384 where the larger cache would not fit this computer's memory).
    $ctx = "$(& $VenvPy (Join-Path $Root 'app\hardware.py') --context $ChatModel 2>$null)".Trim()
    if ($ctx -notmatch '^\d+$') { $ctx = $WinChatContext }
    $out = & $VenvPy (Join-Path $Root 'scripts\ollama-context.py') $ChatModel $ctx 2>&1
    $out | ForEach-Object { Write-Log "context: $_" }
    if ($LASTEXITCODE -eq 0) { Show-Ok "Chat model context: $ctx tokens" }
    else { Show-Warn 'Could not set the chat model context' 'Không đặt được ngữ cảnh cho mô hình chat' }
}

# ================================================================== lab 1 ===
Show-Step 'Hands-on 1: fine-tuning on the GPU' 'Bài 1: tinh chỉnh mô hình trên GPU'

# One Python environment with PyTorch for Hands-on 1 (training) and the call demo
# (speech-to-text): NVIDIA's CUDA PyTorch for Windows on Arm, or CPU PyTorch without
# an NVIDIA GPU. About 3 GB.
$TorchPy = Join-Path $Run 'torch-venv\Scripts\python.exe'
$TorchSpec = if ($GpuName) { $TorchCuda } else { $TorchCpu }
$TorchIndex = if ($GpuName) { $TorchCudaIndex } else { $TorchCpuIndex }
function Install-TorchVenv {
    # Rebuilt only when the PyTorch build changes (2 GB); other packages are topped up in place.
    $torchStamp = Join-Path $Run 'torch-venv\workshop-torch.txt'
    $packages = @('transformers>=4.56,<5', 'peft>=0.15,<1', 'accelerate>=1.6,<2', 'sentencepiece', 'protobuf',
                  'safetensors', 'huggingface_hub', 'hf_xet', 'soundfile', 'scipy', 'numpy')
    $haveTorch = (Test-Path -LiteralPath $TorchPy) -and (Test-Path -LiteralPath $torchStamp) -and
                 ([IO.File]::ReadAllText($torchStamp)).Trim() -eq $TorchSpec
    if (-not $haveTorch) {
        $null = Invoke-Logged 'Preparing PyTorch (Python)' $uv @('venv', '--clear', '--python', $PythonVersion, (Join-Path $Run 'torch-venv'))
        Show-Info "Installing $TorchSpec (up to 2 GB)..." "Đang cài $TorchSpec..."
        # unsafe-best-match: PyTorch's CPU index also mirrors common packages, some without a
        # Windows-on-Arm build; take each package from whichever index has the right one.
        $code = Invoke-Logged "Installing $TorchSpec" $uv @('pip', 'install', '--python', $TorchPy, $TorchSpec,
            '--extra-index-url', $TorchIndex, '--index-strategy', 'unsafe-best-match')
        if ($code -ne 0) { return $false }
        [IO.File]::WriteAllText($torchStamp, $TorchSpec)
    }
    $code = Invoke-Logged 'Installing transformers and peft' $uv (@('pip', 'install', '--python', $TorchPy) + $packages)
    if ($code -ne 0) { return $false }
    & $TorchPy -c 'import torch, transformers, peft, soundfile, scipy' 2>$null
    return ($LASTEXITCODE -eq 0)
}

$TorchOk = Install-TorchVenv
$TorchDevice = ''
if ($TorchOk) {
    $TorchDevice = "$(& $TorchPy -c "import torch; print(torch.cuda.get_device_name(0) if torch.cuda.is_available() else 'cpu')" 2>$null)".Trim()
    Show-Ok "PyTorch ready ($TorchSpec, $TorchDevice)" 'PyTorch đã sẵn sàng'
    if ($GpuName -and $TorchDevice -eq 'cpu') {
        Show-Warn 'PyTorch does not see the GPU: training and speech-to-text will run on the processor' `
                  'PyTorch không thấy GPU: huấn luyện và chuyển giọng nói sẽ chạy trên CPU'
    }
} else {
    Show-Bad "Could not install $TorchSpec" "Không cài được $TorchSpec"
    Show-LogTail
}

# The GGUF converter, from the source of the same llama.cpp release as the batch engine.
$ConvSrc = Join-Path $Run 'llama.cpp-src'
$TrainOk = $false
if ($TorchOk) {
    $convVer = Join-Path $ConvSrc 'VERSION'
    $haveConv = if (Test-Path -LiteralPath $convVer) { ([IO.File]::ReadAllText($convVer)).Trim() } else { '' }
    if ((Test-Path -LiteralPath (Join-Path $ConvSrc 'convert_hf_to_gguf.py')) -and $haveConv -eq $LlamaBuild) {
        Show-Ok "GGUF converter ready (llama.cpp $LlamaBuild)" 'Bộ chuyển đổi GGUF đã có sẵn'
        $TrainOk = $true
    } elseif ($Online) {
        $zip = Join-Path $Run 'llama.cpp-src.zip'
        $tmp = Join-Path $Run 'llama.cpp-src.tmp'
        Remove-Item -LiteralPath $tmp, $ConvSrc -Recurse -Force -ErrorAction SilentlyContinue
        if ((Get-Download "https://codeload.github.com/ggml-org/llama.cpp/zip/refs/tags/$LlamaBuild" $zip) -and (Expand-Zip $zip $tmp)) {
            $top = Get-ChildItem -LiteralPath $tmp -Directory | Select-Object -First 1
            New-Item -ItemType Directory -Force -Path $ConvSrc | Out-Null
            foreach ($item in 'convert_hf_to_gguf.py', 'conversion', 'gguf-py') {
                $from = Join-Path $top.FullName $item
                if (Test-Path -LiteralPath $from) { Copy-Item -LiteralPath $from -Destination $ConvSrc -Recurse -Force }
            }
            $code = Invoke-Logged 'Installing the GGUF converter' $uv @('pip', 'install', '--python', $TorchPy, (Join-Path $ConvSrc 'gguf-py'))
            if ($code -eq 0 -and (Test-Path -LiteralPath (Join-Path $ConvSrc 'convert_hf_to_gguf.py'))) {
                [IO.File]::WriteAllText($convVer, $LlamaBuild)
                Show-Ok "GGUF converter installed (llama.cpp $LlamaBuild)" 'Đã cài bộ chuyển đổi GGUF'
                $TrainOk = $true
            } else { Show-Bad 'Could not install the GGUF converter' 'Không cài được bộ chuyển đổi GGUF' }
        } else { Show-Bad "Could not download llama.cpp $LlamaBuild (source)" 'Không tải được mã nguồn llama.cpp' }
        Remove-Item -LiteralPath $zip, $tmp -Recurse -Force -ErrorAction SilentlyContinue
    } else { Show-Bad 'The GGUF converter is missing and there is no internet' 'Thiếu bộ chuyển đổi GGUF và không có internet' }
}

# The base model, cached so the lab runs without internet.
$Runner = Join-Path $Root 'hands-on-1-finetune\run_finetune.py'
if ($TrainOk) {
    $code = Invoke-Logged "Downloading the base model ($(Get-Setting 'LAB1_BASE_HF' 'Qwen/Qwen2.5-1.5B-Instruct'))" $TorchPy @($Runner, '--download-only')
    if ($code -eq 0) { Show-Ok 'Base model cached for offline training' 'Đã lưu mô hình gốc để huấn luyện offline' }
    else { Show-Bad 'Could not download the base model' 'Không tải được mô hình gốc'; $TrainOk = $false }
}

# Train the example once, as on the Spark: it proves the GPU path and gives the comparison its model.
# Again when an update brings different training examples, so every machine's Aurora says the same.
$TrainerFile = Join-Path $Run 'lab1-trainer.json'
$TrainData = try { (Get-FileHash -LiteralPath (Join-Path $Root 'hands-on-1-finetune\data\train.jsonl') -Algorithm SHA256).Hash } catch { '' }
$Trained = $null
if (Test-Path -LiteralPath $TrainerFile) { try { $Trained = Get-Content -LiteralPath $TrainerFile -Raw | ConvertFrom-Json } catch {} }
if ($TrainOk -and $Trained -and $Trained.data -eq $TrainData -and (Test-OllamaHas $Lab1Tuned)) {
    Show-Ok "Fine-tuned model '$Lab1Tuned' already in Ollama" "Mô hình '$Lab1Tuned' đã có trong Ollama"
    $Lab1 = 'ready'
} elseif ($TrainOk) {
    Remove-Item -LiteralPath $TrainerFile -ErrorAction SilentlyContinue
    $trainArgs = @($Runner, '--epochs', '5')
    $smokeSteps = Get-Setting 'LAB1_SMOKE_STEPS' ''
    if ($smokeSteps) { $trainArgs += @('--max-steps', $smokeSteps) }
    $code = Invoke-Logged 'Training the example model (about a minute on the GPU)' $TorchPy $trainArgs
    if ($code -eq 0 -and (Test-OllamaHas $Lab1Tuned)) {
        $info = @{ ready = $true; device = $TorchDevice; torch = $TorchSpec; trained = (Get-Date -Format 's'); data = $TrainData } | ConvertTo-Json -Compress
        [IO.File]::WriteAllText($TrainerFile, $info)
        Show-Ok "Example model '$Lab1Tuned' trained and added to Ollama" "Đã huấn luyện mô hình mẫu '$Lab1Tuned'"
        $Lab1 = 'ready'
    } else {
        Show-Bad 'Training did not work on this machine (details in setup-log.txt)' 'Huấn luyện chưa chạy được trên máy này'
        Show-LogTail 20
    }
}

# Without a working trainer: the ready-trained Aurora, so the comparison still works.
if ($Lab1 -ne 'ready') {
    $OllamaExe = Get-OllamaExe
    if (Test-OllamaHas $Lab1Tuned) {
        $Lab1 = 'compare-only'
    } elseif ($AuroraUrl -and $Online -and $OllamaExe) {
        $dir = Join-Path $Run 'aurora'
        New-Item -ItemType Directory -Force -Path $dir | Out-Null
        $gguf = Join-Path $dir 'aurora-assistant-q8_0.gguf'
        if (-not (Test-Path -LiteralPath $gguf)) {
            Show-Info 'Downloading the ready-trained Aurora model (about 1.6 GB)...' 'Đang tải mô hình Aurora đã huấn luyện sẵn...'
            $null = Get-BigDownload $AuroraUrl $gguf
        }
        $good = Test-Path -LiteralPath $gguf
        if ($good -and $AuroraSha) {
            $good = (Get-FileHash -LiteralPath $gguf -Algorithm SHA256).Hash -eq $AuroraSha.ToUpper()
            if (-not $good) { Remove-Item -LiteralPath $gguf -ErrorAction SilentlyContinue; Write-Log 'aurora: checksum mismatch' }
        }
        if ($good) {
            Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'aurora.Modelfile') -Destination (Join-Path $dir 'Modelfile') -Force
            $code = Invoke-Logged "Adding $Lab1Tuned to Ollama" $OllamaExe @('create', $Lab1Tuned, '-f', (Join-Path $dir 'Modelfile')) $dir
            if ($code -eq 0 -and (Test-OllamaHas $Lab1Tuned)) {
                Show-Ok "Ready-trained $Lab1Tuned added to Ollama" "Đã thêm mô hình Aurora huấn luyện sẵn"
                $Lab1 = 'compare-only'
            }
        }
    }
    if ($Lab1 -eq 'compare-only') { $Lab1Note = 'comparison works; training did not' }
    else {
        $Lab1 = 'failed'; $Lab1Note = 'no fine-tuned model'
        Show-Bad 'Hands-on 1 has no fine-tuned model' 'Bài 1 chưa có mô hình đã tinh chỉnh'
    }
}

# ================================================================== lab 2 ===
Show-Step 'Hands-on 2: the document index' 'Bài 2: chỉ mục tài liệu'

$env:WORKSHOP_APP = Join-Path $Root 'app'
$indexCheck = "import os, sys; sys.path.insert(0, os.environ['WORKSHOP_APP']); import lab2_rag; d = lab2_rag.load_index(); print(d['chunk_count'] if d else 0)"
$chunks = [int]("0" + (& $VenvPy -c $indexCheck 2>$null))
if ($chunks -gt 0) {
    Show-Ok "Document index ready: $chunks passages, $EmbedModel" 'Chỉ mục tài liệu đã sẵn sàng'
} else {
    $code = Invoke-Logged 'Building the document index' $VenvPy @(
        (Join-Path $Root 'hands-on-2-rag\ingestion\build_index.py'),
        '--corpus', (Join-Path $Root 'hands-on-2-rag\corpus'), '--out', (Join-Path $Run 'rag-index'),
        '--base-url', $OllamaUrl, '--model', $EmbedModel, '--target-chars', '1600', '--overlap-chars', '320')
    $chunks = [int]("0" + (& $VenvPy -c $indexCheck 2>$null))
    if ($code -eq 0 -and $chunks -gt 0) { Show-Ok "Document index built: $chunks passages, $EmbedModel" 'Đã tạo chỉ mục tài liệu' }
    else { Show-Bad 'Could not build the document index' 'Không tạo được chỉ mục tài liệu'; $CoreOk = $false }
}

# ============================================================= enterprise ===
Show-Step 'Enterprise demos: batch engine and sample data (about 25 GB)' `
          'Demo doanh nghiệp: máy chủ xử lý hàng loạt và dữ liệu mẫu (khoảng 25 GB)'

$Ent = 'ready'; $EntNote = ''
$EntDir = Join-Path $Run 'enterprise'
$LlamaDir = Join-Path $Run 'llama.cpp'
$GgufDir = Join-Path $Run 'models\batch'
$TtsPy = Join-Path $Run 'tts-venv\Scripts\python.exe'
$VoiceDir = Join-Path $EntDir 'voices'
function Set-EntFailed([string]$Why, [string]$Vi) {
    $script:Ent = 'failed'; $script:EntNote = $Why
    Show-Bad $Why $Vi
    Show-LogTail
}

if ($SkipEnterprise -or $env:WORKSHOP_SKIP_ENTERPRISE) {
    $Ent = 'skipped'; $EntNote = 'skipped (-SkipEnterprise)'
    Show-Warn 'Skipped (-SkipEnterprise)' 'Đã bỏ qua'
} elseif (-not $EntFits -and -not $Test -and -not $env:WORKSHOP_FORCE_ENTERPRISE) {
    # The batch engine holds about 32 GB while it runs: only on computers that can spare it.
    $Ent = 'skipped'; $EntNote = "this computer $EntWhy"
    Show-Warn "Skipped: the batch engine $EntWhy" 'Đã bỏ qua: máy chủ xử lý hàng loạt cần nhiều bộ nhớ hoặc ổ đĩa hơn máy này có'
}

# 1. llama.cpp's llama-server: the CUDA build for an NVIDIA GPU, the CPU build otherwise.
if ($Ent -eq 'ready') {
    $flavour = if ($GpuName) { 'cuda-13.4' } else { 'cpu' }
    $larch = if ($Arch -eq 'Arm64') { 'arm64' } else { 'x64' }
    $want = "$LlamaBuild $flavour $larch"
    $verFile = Join-Path $LlamaDir 'VERSION'
    $have = if (Test-Path -LiteralPath $verFile) { ([IO.File]::ReadAllText($verFile)).Trim() } else { '' }
    if ((Test-Path -LiteralPath (Join-Path $LlamaDir 'llama-server.exe')) -and $have -eq $want) {
        Show-Ok "llama.cpp $LlamaBuild ($flavour) ready" 'llama.cpp đã có sẵn'
    } elseif (-not $Online) {
        Set-EntFailed 'llama.cpp is not installed and there is no internet' 'Chưa có llama.cpp và không có internet'
    } else {
        $base = "https://github.com/ggml-org/llama.cpp/releases/download/$LlamaBuild"
        $zips = @("llama-$LlamaBuild-bin-win-$flavour-$larch.zip")
        if ($flavour -ne 'cpu') { $zips += "cudart-llama-bin-win-$flavour-$larch.zip" }
        Show-Info "Downloading llama.cpp $LlamaBuild ($flavour, $larch)..." "Đang tải llama.cpp..."
        Remove-Item -LiteralPath $LlamaDir -Recurse -Force -ErrorAction SilentlyContinue
        $got = $true
        foreach ($z in $zips) {
            $zip = Join-Path $Run $z
            if ((Get-Download "$base/$z" $zip) -and (Expand-Zip $zip $LlamaDir)) { Remove-Item -LiteralPath $zip }
            else { $got = $false }
        }
        # Some builds keep their files in a sub-folder: bring them up next to each other.
        $exe = Get-ChildItem -LiteralPath $LlamaDir -Recurse -Filter 'llama-server.exe' -ErrorAction SilentlyContinue | Select-Object -First 1
        if ($exe -and $exe.DirectoryName -ne $LlamaDir) {
            Get-ChildItem -LiteralPath $exe.DirectoryName | Move-Item -Destination $LlamaDir -Force
        }
        if ($got -and (Test-Path -LiteralPath (Join-Path $LlamaDir 'llama-server.exe'))) {
            [IO.File]::WriteAllText($verFile, $want)
            Show-Ok "llama.cpp $LlamaBuild ($flavour) installed" 'Đã cài llama.cpp'
        } else { Set-EntFailed "Could not install llama.cpp $LlamaBuild" 'Không cài được llama.cpp' }
    }
}

# 2. The batch model: a GGUF build of Qwen 3.6, and its vision part for the invoices.
if ($Ent -eq 'ready') {
    New-Item -ItemType Directory -Force -Path $GgufDir | Out-Null
    foreach ($f in @($GgufFile, $GgufMmproj) | Where-Object { $_ }) {
        $dest = Join-Path $GgufDir $f
        if (Test-Path -LiteralPath $dest) { Show-Ok "$f ready" "$f đã có"; continue }
        if (-not $Online) { Set-EntFailed "$f is missing and there is no internet" "Thiếu $f và không có internet"; break }
        Show-Info "Downloading $f from $GgufRepo..." "Đang tải $f..."
        if (Get-BigDownload "https://huggingface.co/$GgufRepo/resolve/$GgufRevision/$f" $dest) { Show-Ok "$f downloaded" "Đã tải $f" }
        else { Set-EntFailed "Could not download $f" "Không tải được $f"; break }
    }
}

# 3. Text-to-speech for the sample calls: Piper has no Windows-on-Arm build, so it gets
#    an x64 Python of its own (Windows runs it through its x64 emulation).
if ($Ent -eq 'ready') {
    $probeTts = { & $TtsPy -c 'import piper, onnxruntime' 2>$null; return ($LASTEXITCODE -eq 0) }
    if ((Test-Path -LiteralPath $TtsPy) -and (& $probeTts)) {
        Show-Ok 'Text-to-speech ready (Piper)' 'Bộ đọc văn bản đã sẵn sàng'
    } else {
        $x64 = "cpython-$PythonVersion-windows-x86_64-none"
        $null = Invoke-Logged 'Installing the text-to-speech engine (Piper)' $uv @('venv', '--clear', '--python', $x64, (Join-Path $Run 'tts-venv'))
        $null = Invoke-Logged 'Installing the text-to-speech engine (Piper)' $uv @('pip', 'install', '--python', $TtsPy, "piper-tts==$PiperVersion")
        if ((Test-Path -LiteralPath $TtsPy) -and (& $probeTts)) { Show-Ok "Text-to-speech installed (Piper $PiperVersion)" 'Đã cài bộ đọc văn bản' }
        else { Set-EntFailed 'Could not install piper-tts' 'Không cài được bộ đọc văn bản' }
    }
}
if ($Ent -eq 'ready') {
    $voice = 'vi_VN-vais1000-medium.onnx'
    if ((Test-Path -LiteralPath (Join-Path $VoiceDir $voice)) -and (Test-Path -LiteralPath (Join-Path $VoiceDir "$voice.json"))) {
        Show-Ok 'Vietnamese voice ready' 'Giọng đọc tiếng Việt đã có sẵn'
    } else {
        New-Item -ItemType Directory -Force -Path $VoiceDir | Out-Null
        $vbase = "https://huggingface.co/rhasspy/piper-voices/resolve/$VoiceRevision/vi/vi_VN/vais1000/medium"
        $ok = $true
        foreach ($f in $voice, "$voice.json", 'MODEL_CARD') { $ok = $ok -and (Get-Download "$vbase/$f" (Join-Path $VoiceDir $f)) }
        if ($ok) { Show-Ok 'Vietnamese voice downloaded' 'Đã tải giọng đọc tiếng Việt' }
        else { Set-EntFailed 'Could not download the Piper voice' 'Không tải được giọng đọc' }
    }
}

# 4. Speech-to-text: PhoWhisper, in the PyTorch environment of Hands-on 1.
if ($Ent -eq 'ready' -and -not $TorchOk) {
    Set-EntFailed 'PyTorch is missing (see Hands-on 1 above)' 'Thiếu PyTorch (xem Bài 1 ở trên)'
}
if ($Ent -eq 'ready') {
    $asrDir = Join-Path $HOME (".cache\huggingface\hub\models--" + ($AsrModel -replace '/', '--') + "\snapshots\$AsrRevision")
    if (Test-Path -LiteralPath (Join-Path $asrDir 'config.json')) {
        Show-Ok "Speech-to-text model ready ($AsrModel)" 'Mô hình chuyển giọng nói đã có sẵn'
    } elseif (-not $Online) {
        Set-EntFailed "$AsrModel is missing and there is no internet" 'Thiếu mô hình chuyển giọng nói'
    } else {
        $env:WORKSHOP_ASR_MODEL = $AsrModel; $env:WORKSHOP_ASR_REVISION = $AsrRevision
        $env:HF_HUB_DISABLE_TELEMETRY = '1'; $env:HF_HUB_DISABLE_PROGRESS_BARS = '1'
        # One file at a time: without symlink rights (no Developer Mode), parallel downloads crash (WinError 1314).
        $dl = "import os; from huggingface_hub import snapshot_download; print(snapshot_download(os.environ['WORKSHOP_ASR_MODEL'], revision=os.environ['WORKSHOP_ASR_REVISION'], max_workers=1))"
        $null = Invoke-Logged "Downloading $AsrModel" $TorchPy @('-c', $dl)
        if (Test-Path -LiteralPath (Join-Path $asrDir 'config.json')) { Show-Ok "Speech-to-text model downloaded ($AsrModel)" 'Đã tải mô hình chuyển giọng nói' }
        else { Set-EntFailed "Could not download $AsrModel" 'Không tải được mô hình chuyển giọng nói' }
    }
}

# 5. The sample data: customer messages, scanned invoices, recorded calls.
if ($Ent -eq 'ready') {
    $code = Invoke-Logged 'Creating the sample data (messages, invoices, calls)' $VenvPy @((Join-Path $Root 'app\enterprise.py'), 'prepare')
    if ($code -eq 0 -and (Test-Path -LiteralPath (Join-Path $EntDir 'calls\truth.json'))) {
        Show-Ok 'Sample data ready: messages, invoices and recorded calls' 'Dữ liệu mẫu đã sẵn sàng'
    } else { Set-EntFailed 'The sample data could not be created' 'Không tạo được dữ liệu mẫu' }
}

# 6. Start the engine once, process a few items of each job, stop it.
if ($Ent -eq 'ready') {
    $stamp = "$LlamaBuild $GgufRepo/$GgufFile@$GgufRevision $AsrModel@$AsrRevision"
    $stampFile = Join-Path $Run 'enterprise-check'
    if ((Test-Path -LiteralPath $stampFile) -and ([IO.File]::ReadAllText($stampFile)).Trim() -eq $stamp) {
        Show-Ok 'Batch engine already checked on this machine' 'Máy chủ đã được kiểm tra trên máy này'
    } else {
        $code = Invoke-Logged 'Starting the batch engine and testing it (2-6 minutes)' $VenvPy @((Join-Path $Root 'app\enterprise.py'), 'smoke')
        if ($code -eq 0) {
            [IO.File]::WriteAllText($stampFile, $stamp)
            Show-Ok 'Batch engine works: messages, invoices and calls processed' 'Máy chủ hoạt động: đã xử lý thử tin nhắn, hóa đơn và cuộc gọi'
        } else { Set-EntFailed 'The batch engine did not pass its test' 'Máy chủ chưa chạy được' }
    }
}

# ============================================================ final check ===
Show-Step 'Final check - every lab, end to end' 'Kiểm tra cuối - chạy thử từng bài'

$stArgs = @((Join-Path $Root 'app\selftest.py'), '--lab2', '--tools', '--json')
# Test mode skips the Hands-on 3 agent: its loop is the same code as on the Spark, and a
# tiny model on a 4-core CPU needs minutes per step. The tools check covers Windows here.
if (-not $Test) { $stArgs += '--lab3' }
if ($Lab1 -in @('ready', 'compare-only')) { $stArgs += '--lab1' }
if ($Test) { $stArgs += '--plumbing' }
$stOut = Join-Path $Run 'step-out.txt'
$results = @()
if ($env:WORKSHOP_SKIP_CHECK -and (Test-Path -LiteralPath (Join-Path $Run 'selftest.json'))) {
    # CI's second run: the labs were checked a minute ago; reuse that result.
    Show-Info '(final check skipped: WORKSHOP_SKIP_CHECK)'
    Copy-Item -LiteralPath (Join-Path $Run 'selftest.json') -Destination $stOut -Force
} else {
    $null = Invoke-Logged 'Running every lab once' $VenvPy $stArgs
}
if (Test-Path -LiteralPath $stOut) {
    $raw = [IO.File]::ReadAllText($stOut, [Text.Encoding]::UTF8)
    [IO.File]::WriteAllText((Join-Path $Run 'selftest.json'), $raw, (New-Object System.Text.UTF8Encoding $false))
    # ConvertFrom-Json as a parameter, not in a pipeline: Windows PowerShell 5.1
    # passes a JSON array down a pipeline as one object.
    try { $results = ConvertFrom-Json $raw } catch { $results = @() }
}
foreach ($r in $results) {
    $detail = [string]$r.detail
    switch ([string]$r.lab) {
        '1' {
            if ($r.ok) { Show-Ok "Hands-on 1: $detail" 'Bài 1 hoạt động' }
            elseif ($r.skipped) { Show-Warn "Hands-on 1: $detail" }
            else { Show-Bad "Hands-on 1: $detail"; $Lab1 = 'failed' }
        }
        '2' {
            if ($r.ok) { Show-Ok "Hands-on 2: $detail" 'Bài 2 hoạt động'; $Lab2 = 'ready' }
            else { Show-Bad "Hands-on 2: $detail"; $Lab2 = 'failed' }
        }
        '3' {
            if ($r.ok) { Show-Ok "Hands-on 3: $detail" 'Bài 3 hoạt động'; if ($Lab3 -ne 'failed') { $Lab3 = 'ready' } }
            else { Show-Bad "Hands-on 3: $detail"; $Lab3 = 'failed' }
        }
        'tools' {
            if ($r.ok) { Show-Ok "Hands-on 3 tools: $detail" 'Công cụ Python của Bài 3 hoạt động' }
            else { Show-Bad "Hands-on 3 tools: $detail"; $Lab3 = 'failed' }
        }
    }
}
if (-not $results) {
    Show-Bad 'The final check did not run' 'Bước kiểm tra cuối không chạy được'
    Show-LogTail
    $Lab2 = 'failed'; $Lab3 = 'failed'
}
if ($Test -and $Lab3 -eq 'unchecked') { $Lab3 = 'ready'; $Lab3Note = 'tools checked (test mode)' }

# Desktop and Start-menu shortcuts, so the next start is a double-click.
$IconFile = Join-Path $Run 'workshop.ico'
& $VenvPy (Join-Path $PSScriptRoot 'make_icon.py') $IconFile 2>$null
function New-WorkshopShortcut([string]$Path) {
    try {
        $shell = New-Object -ComObject WScript.Shell
        $lnk = $shell.CreateShortcut($Path)
        $lnk.TargetPath = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
        $lnk.Arguments = '-NoProfile -ExecutionPolicy Bypass -File "' + (Join-Path $Root 'windows\start.ps1') + '"'
        $lnk.WorkingDirectory = $Root
        if (Test-Path -LiteralPath $IconFile) { $lnk.IconLocation = $IconFile }
        $lnk.Description = 'Start the AI workshop / Mở workshop AI'
        $lnk.Save()
        return $true
    } catch {
        Write-Log "shortcut ${Path}: $($_.Exception.Message)"
        return $false
    }
}
$ShortcutName = 'RTX Spark Workshop.lnk'
foreach ($folder in [Environment]::GetFolderPath('Desktop'), [Environment]::GetFolderPath('Programs')) {
    if ($folder -and (Test-Path -LiteralPath $folder)) { $null = New-WorkshopShortcut (Join-Path $folder $ShortcutName) }
}

# ================================================================ summary ===
function Show-Status([string]$Name, [string]$State, [string]$Note) {
    switch ($State) {
        'ready'        { $text = ([string][char]0x2714) + ' ready / sẵn sàng'; $color = 'Green' }
        'compare-only' { $text = '! comparison only / chỉ phần so sánh'; $color = 'Yellow' }
        'later'        { $text = '- in a later update / có trong bản cập nhật sau'; $color = 'DarkGray' }
        'missing'      { $text = '- not installed / chưa cài'; $color = 'DarkGray' }
        'skipped'      { $text = '- skipped / đã bỏ qua'; $color = 'DarkGray' }
        default        { $text = ([string][char]0x2718) + ' needs help / cần hỗ trợ'; $color = 'Red' }
    }
    Write-Host ('   {0,-32}' -f $Name) -NoNewline
    Write-Host $text -ForegroundColor $color -NoNewline
    if ($Note) { Write-Host "  $Note" -ForegroundColor DarkGray } else { Write-Host '' }
}
if (-not $CoreOk) {
    if ($Lab2 -eq 'unchecked') { $Lab2 = 'failed' }
    if ($Lab3 -eq 'unchecked') { $Lab3 = 'failed' }
}
Write-Host ''
Write-Host ([string][char]0x2500 * 66) -ForegroundColor DarkGray
Write-Host ''
Show-Status 'Hands-on 1  Fine-tuning' $Lab1 $Lab1Note
Show-Status 'Hands-on 2  RAG' $Lab2 $Lab2Note
Show-Status 'Hands-on 3  Agentic workflow' $Lab3 $Lab3Note
Show-Status 'Enterprise  Batch demos' $Ent $EntNote
Write-Log "summary: lab1=$Lab1 lab2=$Lab2 lab3=$Lab3 enterprise=$Ent"

$failed = ($Lab1 -eq 'failed') -or ($Lab2 -ne 'ready') -or ($Lab3 -ne 'ready') -or ($Ent -eq 'failed')
if (-not $failed) {
    Write-Host @'

   ┌──────────────────────────────────────────────────────────────┐
   │   ✔  S E T U P   C O M P L E T E                             │
   │      C À I   Đ Ặ T   H O À N   T Ấ T                          │
   └──────────────────────────────────────────────────────────────┘

   Next time, double-click "RTX Spark Workshop" on the desktop.
   Lần sau, bấm đúp "RTX Spark Workshop" trên màn hình nền.
'@ -ForegroundColor Green
} else {
    Write-Host @"

   ┌──────────────────────────────────────────────────────────────┐
   │   !  SETUP FINISHED - SOME PARTS NEED HELP                   │
   │      ĐÃ CÀI XONG - MỘT SỐ PHẦN CẦN HỖ TRỢ                     │
   └──────────────────────────────────────────────────────────────┘

   The parts marked above need attention. Send this file to the organiser:
   Các phần được đánh dấu cần hỗ trợ. Hãy gửi tệp này cho người phụ trách:

       $Log

   Running the install command again is safe:
   Chạy lại lệnh cài đặt hoàn toàn an toàn:

       $InstallCmd
"@ -ForegroundColor Yellow
}

if (-not $NoStart) {
    if (Test-HubUp) {
        Show-Info 'Restarting the workshop app with the new version...' 'Đang khởi động lại ứng dụng workshop với phiên bản mới...'
        Stop-WorkshopApp
    }
    Write-Host "`n   Opening the workshop... / Đang mở workshop...`n"
    & (Join-Path $PSScriptRoot 'start.ps1')
    exit $LASTEXITCODE
}
if ($failed) { exit 1 }
exit 0
