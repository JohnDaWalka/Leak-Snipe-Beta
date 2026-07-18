# LeakSnipe - Full Setup Script for a Fresh Windows Machine
# Run this once in an elevated PowerShell window:
#   Set-ExecutionPolicy Bypass -Scope Process -Force
#   .\Setup-LeakSnipe.ps1

$ErrorActionPreference = "Stop"
$ProgressPreference    = "SilentlyContinue"   # makes Invoke-WebRequest much faster

# ─── Where to put the repo ───────────────────────────────────────────────────
$InstallDir = "C:\Projects\LeakSnipe"
$RepoUrl    = "https://github.com/JohnDaWalka/LeakSnipe.git"

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "   LeakSnipe - Full Setup" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  Install dir : $InstallDir"
Write-Host "  Repo        : $RepoUrl"
Write-Host ""

# ─── Helper: run a command and throw on failure ───────────────────────────────
function Invoke-Cmd {
    param([string]$Cmd, [string]$Label)
    Write-Host ">> $Label" -ForegroundColor Yellow
    Invoke-Expression $Cmd
    if ($LASTEXITCODE -and $LASTEXITCODE -ne 0) {
        throw "$Label failed (exit $LASTEXITCODE)"
    }
}

# ─── Helper: download + silently install an .exe / .msi ─────────────────────
function Install-Installer {
    param([string]$Url, [string]$OutFile, [string]$Args, [string]$Label)
    Write-Host ">> $Label" -ForegroundColor Yellow
    if (-not (Test-Path $OutFile)) {
        Invoke-WebRequest -Uri $Url -OutFile $OutFile -UseBasicParsing
    }
    Start-Process -FilePath $OutFile -ArgumentList $Args -Wait -NoNewWindow
    Remove-Item $OutFile -ErrorAction SilentlyContinue
}

# ─── 1. Git ──────────────────────────────────────────────────────────────────
if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
    Write-Host "Installing Git..." -ForegroundColor Yellow
    $gitExe = "$env:TEMP\git-setup.exe"
    Install-Installer `
        -Url "https://github.com/git-for-windows/git/releases/download/v2.46.0.windows.1/Git-2.46.0-64-bit.exe" `
        -OutFile $gitExe `
        -Args "/VERYSILENT /NORESTART /NOCANCEL /SP- /CLOSEAPPLICATIONS /RESTARTAPPLICATIONS /COMPONENTS=""icons,ext\reg\shellhere,assoc,assoc_sh""" `
        -Label "Git 2.46"
    $env:PATH += ";C:\Program Files\Git\cmd"
} else {
    Write-Host "Git already installed: $(git --version)" -ForegroundColor Green
}

# ─── 2. Python 3.12 ──────────────────────────────────────────────────────────
$pythonOk = $false
foreach ($cmd in @("python", "python3", "py")) {
    try {
        $ver = & $cmd --version 2>&1
        if ($ver -match "3\.(1[0-9]|[89])") { $pythonOk = $true; break }
    } catch {}
}
if (-not $pythonOk) {
    Write-Host "Installing Python 3.12..." -ForegroundColor Yellow
    $pyExe = "$env:TEMP\python312-setup.exe"
    Install-Installer `
        -Url "https://www.python.org/ftp/python/3.12.4/python-3.12.4-amd64.exe" `
        -OutFile $pyExe `
        -Args "/quiet InstallAllUsers=1 PrependPath=1 Include_test=0" `
        -Label "Python 3.12"
    $env:PATH = [System.Environment]::GetEnvironmentVariable("PATH", "Machine") + ";" + $env:PATH
} else {
    Write-Host "Python already installed: $(python --version)" -ForegroundColor Green
}

# ─── 3. Node.js LTS ──────────────────────────────────────────────────────────
if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    Write-Host "Installing Node.js LTS..." -ForegroundColor Yellow
    $nodeMsi = "$env:TEMP\node-setup.msi"
    Install-Installer `
        -Url "https://nodejs.org/dist/v20.15.1/node-v20.15.1-x64.msi" `
        -OutFile $nodeMsi `
        -Args "/quiet /norestart" `
        -Label "Node.js v20 LTS"
    $env:PATH = [System.Environment]::GetEnvironmentVariable("PATH", "Machine") + ";" + $env:PATH
} else {
    Write-Host "Node.js already installed: $(node --version)" -ForegroundColor Green
}

# ─── 4. Rust (for Tauri) ─────────────────────────────────────────────────────
if (-not (Get-Command cargo -ErrorAction SilentlyContinue)) {
    Write-Host "Installing Rust toolchain..." -ForegroundColor Yellow
    $rustupExe = "$env:TEMP\rustup-init.exe"
    Invoke-WebRequest -Uri "https://win.rustup.rs/x86_64" -OutFile $rustupExe -UseBasicParsing
    Start-Process -FilePath $rustupExe -ArgumentList "-y --default-toolchain stable" -Wait -NoNewWindow
    Remove-Item $rustupExe -ErrorAction SilentlyContinue
    $env:PATH += ";$env:USERPROFILE\.cargo\bin"
} else {
    Write-Host "Rust already installed: $(rustc --version)" -ForegroundColor Green
}

# ─── 5. Visual Studio C++ Build Tools (for Tauri/Rust) ───────────────────────
$vcInstalled = Test-Path "${env:ProgramFiles(x86)}\Microsoft Visual Studio\2022\BuildTools\VC\Auxiliary\Build\vcvars64.bat"
if (-not $vcInstalled) {
    $vcInstalled = Test-Path "${env:ProgramFiles(x86)}\Microsoft Visual Studio\2022\Community\VC\Auxiliary\Build\vcvars64.bat"
}
if (-not $vcInstalled) {
    Write-Host "Installing VS 2022 C++ Build Tools (this takes a few minutes)..." -ForegroundColor Yellow
    $vsExe = "$env:TEMP\vs_buildtools.exe"
    Invoke-WebRequest -Uri "https://aka.ms/vs/17/release/vs_buildtools.exe" -OutFile $vsExe -UseBasicParsing
    Start-Process -FilePath $vsExe -ArgumentList "--quiet --wait --norestart --nocache --add Microsoft.VisualStudio.Workload.VCTools --includeRecommended" -Wait -NoNewWindow
    Remove-Item $vsExe -ErrorAction SilentlyContinue
} else {
    Write-Host "VS C++ Build Tools already installed." -ForegroundColor Green
}

# ─── 6. Tesseract OCR ────────────────────────────────────────────────────────
if (-not (Test-Path "C:\Program Files\Tesseract-OCR\tesseract.exe")) {
    Write-Host "Installing Tesseract OCR..." -ForegroundColor Yellow
    $tessExe = "$env:TEMP\tesseract-setup.exe"
    Install-Installer `
        -Url "https://github.com/UB-Mannheim/tesseract/releases/download/v5.4.0.20240606/tesseract-ocr-w64-setup-5.4.0.20240606.exe" `
        -OutFile $tessExe `
        -Args "/VERYSILENT /NORESTART" `
        -Label "Tesseract OCR 5.4"
} else {
    Write-Host "Tesseract already installed." -ForegroundColor Green
}

# ─── 7. Clone / update repo ──────────────────────────────────────────────────
Write-Host ""
Write-Host "Setting up repo at $InstallDir ..." -ForegroundColor Yellow

if (Test-Path (Join-Path $InstallDir ".git")) {
    Write-Host "Repo already cloned — pulling latest changes..." -ForegroundColor Green
    Invoke-Cmd "git -C `"$InstallDir`" pull --ff-only" "git pull"
} else {
    New-Item -ItemType Directory -Force -Path (Split-Path $InstallDir) | Out-Null
    Invoke-Cmd "git clone `"$RepoUrl`" `"$InstallDir`"" "git clone"
}

# ─── 8. Python virtual environment + dependencies ────────────────────────────
Write-Host ""
Write-Host "Setting up Python virtual environment..." -ForegroundColor Yellow

$venv = Join-Path $InstallDir ".venv"
if (-not (Test-Path $venv)) {
    Invoke-Cmd "python -m venv `"$venv`"" "python -m venv"
}

$pip = Join-Path $venv "Scripts\pip.exe"
Invoke-Cmd "& `"$pip`" install --upgrade pip -q" "pip upgrade"
Invoke-Cmd "& `"$pip`" install -e `"$InstallDir`" -q" "pip install LeakSnipe"
if (Test-Path (Join-Path $InstallDir "sidecar\requirements.txt")) {
    Invoke-Cmd "& `"$pip`" install -r `"$InstallDir\sidecar\requirements.txt`" -q" "pip install sidecar deps"
}

# ─── 9. Node modules (leaksnipe-ui) ──────────────────────────────────────────
Write-Host ""
Write-Host "Installing Node packages for leaksnipe-ui..." -ForegroundColor Yellow
$uiDir = Join-Path $InstallDir "leaksnipe-ui"
if (Test-Path (Join-Path $uiDir "package.json")) {
    Push-Location $uiDir
    npm install --silent
    Pop-Location
} else {
    Write-Warning "leaksnipe-ui/package.json not found — skipping npm install"
}

# ─── 10. .env file ───────────────────────────────────────────────────────────
Write-Host ""
$envFile = Join-Path $InstallDir ".env"
if (-not (Test-Path $envFile)) {
    $envExample = Join-Path $InstallDir ".env.example"
    if (Test-Path $envExample) {
        Copy-Item $envExample $envFile
        Write-Host "Created .env from .env.example" -ForegroundColor Green
        Write-Host "  --> Edit $envFile and add your API keys before running LeakSnipe." -ForegroundColor Yellow
    }
} else {
    Write-Host ".env already exists - skipping copy." -ForegroundColor Green
}

# ─── Done! ────────────────────────────────────────────────────────────────────
Write-Host ""
Write-Host "========================================" -ForegroundColor Green
Write-Host "   Setup complete!" -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Green
Write-Host ""
Write-Host "Next steps:" -ForegroundColor Cyan
Write-Host "  1. Open $envFile and fill in your API keys"
Write-Host "  2. Double-click: $InstallDir\Launch-LeakSnipe.bat"
Write-Host ""
Write-Host "First launch will compile Rust/Tauri (~1-2 min). Subsequent launches are fast."
Write-Host ""
