# SPDX-License-Identifier: Apache-2.0
#
# RTX Spark AI Workshop - install or update on Windows. In PowerShell:
#
#     irm https://raw.githubusercontent.com/an6122003/rtx-spark-ai-workshop/main/install.ps1 | iex
#
# Downloads the workshop into %USERPROFILE%\ai-workshop (or updates it there,
# keeping Ollama, the models, local settings and results), then runs
# windows\setup.ps1. No administrator rights needed. The DGX Spark (Linux)
# edition lives in github.com/an6122003/nemoclaw-rag-demo.
#
# Options, through the environment (set them before the command):
#   $env:WORKSHOP_DIR      install folder (default: ~\ai-workshop)
#   $env:WORKSHOP_BRANCH   branch to install (default: main), or a full commit id
#   $env:WORKSHOP_REPO     GitHub repository to install from (default:
#                          an6122003/rtx-spark-ai-workshop; a fork works too)
#   $env:WORKSHOP_YES=1 / WORKSHOP_NO_START=1 / WORKSHOP_CHECK_ONLY=1 /
#   WORKSHOP_SKIP_ENTERPRISE=1 / WORKSHOP_TEST=1
#                          the -Yes / -NoStart / -CheckOnly / -SkipEnterprise / -Test switches of setup.ps1
#
# This file stays ASCII: `irm | iex` runs it as text, in the user's own session,
# so it ends with `return`, never `exit` (which would close their window).

& {
    $ErrorActionPreference = 'Stop'
    $ProgressPreference = 'SilentlyContinue'
    try {
        [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
    } catch {}

    $repo = if ($env:WORKSHOP_REPO) { $env:WORKSHOP_REPO } else { 'an6122003/rtx-spark-ai-workshop' }
    $branch = if ($env:WORKSHOP_BRANCH) { $env:WORKSHOP_BRANCH } else { 'main' }
    $dir = if ($env:WORKSHOP_DIR) { $env:WORKSHOP_DIR } else { Join-Path $HOME 'ai-workshop' }
    if ($env:OS -ne 'Windows_NT') {
        Write-Host '   This installer is for Windows. The DGX Spark (Linux) edition: github.com/an6122003/nemoclaw-rag-demo' -ForegroundColor Red
        return
    }

    Write-Host ''
    if (Test-Path -LiteralPath (Join-Path $dir 'windows\setup.ps1')) {
        Write-Host "   Updating the workshop in $dir ..."
        Write-Host '   Dang cap nhat workshop ...' -ForegroundColor DarkGray
    } else {
        Write-Host "   Installing the workshop in $dir ..."
        Write-Host '   Dang cai workshop ...' -ForegroundColor DarkGray
    }

    $tmp = Join-Path $env:TEMP ('ai-workshop-' + [guid]::NewGuid().ToString('N'))
    New-Item -ItemType Directory -Path $tmp | Out-Null
    $zip = Join-Path $tmp 'workshop.zip'
    $ref = if ($branch -match '^[0-9a-f]{40}$') { $branch } else { "refs/heads/$branch" }
    $url = "https://codeload.github.com/$repo/zip/$ref"
    try {
        Invoke-WebRequest -Uri $url -OutFile $zip -UseBasicParsing
    } catch {
        Write-Host "   Could not download $url ($($_.Exception.Message))" -ForegroundColor Red
        Write-Host '   Check the internet connection, then run the command again.' -ForegroundColor Red
        return
    }
    $tar = Join-Path $env:SystemRoot 'System32\tar.exe'
    if (Test-Path -LiteralPath $tar) { & $tar -xf $zip -C $tmp } else { Expand-Archive -LiteralPath $zip -DestinationPath $tmp -Force }
    $src = Get-ChildItem -LiteralPath $tmp -Directory | Select-Object -First 1
    if (-not $src) {
        Write-Host '   The download is damaged. Run the command again.' -ForegroundColor Red
        return
    }

    # The new version over the old one. Nothing is deleted, so .run (Ollama, the
    # document index, results), .venv and workshop.local.env stay as they are.
    New-Item -ItemType Directory -Force -Path $dir | Out-Null
    & robocopy.exe $src.FullName $dir /E /NFL /NDL /NJH /NJS /NP /R:2 /W:2 | Out-Null
    $copied = $LASTEXITCODE -lt 8
    Remove-Item -LiteralPath $tmp -Recurse -Force -ErrorAction SilentlyContinue
    if (-not $copied) {
        Write-Host "   Could not copy the workshop files into $dir (robocopy $LASTEXITCODE)." -ForegroundColor Red
        Write-Host '   Close any window that uses that folder, then run the command again.' -ForegroundColor Red
        return
    }

    $setupArgs = @()
    if ($env:WORKSHOP_YES) { $setupArgs += '-Yes' }
    if ($env:WORKSHOP_NO_START) { $setupArgs += '-NoStart' }
    if ($env:WORKSHOP_CHECK_ONLY) { $setupArgs += '-CheckOnly' }
    if ($env:WORKSHOP_SKIP_ENTERPRISE) { $setupArgs += '-SkipEnterprise' }
    if ($env:WORKSHOP_TEST) { $setupArgs += '-Test' }
    $ps = (Get-Process -Id $PID).Path   # the same PowerShell that runs this command
    & $ps -NoProfile -ExecutionPolicy Bypass -File (Join-Path $dir 'windows\setup.ps1') @setupArgs
    $global:LASTEXITCODE = $LASTEXITCODE
}
