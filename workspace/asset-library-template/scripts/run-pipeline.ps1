param(
    [ValidateSet('run')]
    [string]$Command = 'run',
    [string]$OnlyFile = '',
    [ValidateSet('none', 'sample', 'all')]
    [string]$Coordinates = 'sample',
    [ValidateSet('none', 'sample', 'all')]
    [string]$Render = 'sample',
    [ValidateSet('none', 'sample', 'all')]
    [string]$Ocr = 'none',
    [switch]$Refresh,
    [string]$Root = '',
    [string]$OutputRoot = ''
)

$ErrorActionPreference = 'Stop'
$assetRoot = Split-Path -Parent $PSScriptRoot
$sourceRoot = if ($Root) { $Root } else { $assetRoot }
$pythonCandidates = @()
$bundledPython = Join-Path $env:USERPROFILE '.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe'
if (Test-Path -LiteralPath $bundledPython) {
    $pythonCandidates += $bundledPython
}
$pathPython = Get-Command python -ErrorAction SilentlyContinue
if ($null -ne $pathPython) {
    $pythonCandidates += $pathPython.Source
}

$pythonExecutable = $null
foreach ($candidate in ($pythonCandidates | Select-Object -Unique)) {
    & $candidate -c 'import pypdf, pdfplumber, PIL' 2>$null
    if ($LASTEXITCODE -eq 0) {
        $pythonExecutable = $candidate
        break
    }
}
if ($null -eq $pythonExecutable) {
    throw '未找到 Python。请安装 Python 3.11+ 并执行 pip install -r scripts\requirements.txt。'
}

$arguments = @(
    (Join-Path $PSScriptRoot 'asset_pipeline.py'),
    'run',
    '--root', $sourceRoot,
    '--coordinates', $Coordinates,
    '--render', $Render,
    '--ocr', $Ocr
)

if ($OutputRoot) {
    $arguments += @('--output-root', $OutputRoot)
}

if ($OnlyFile) {
    $arguments += @('--only', $OnlyFile)
}
if ($Refresh) {
    $arguments += '--refresh'
}

$pdftoppmPath = $null
$bundledPdftoppm = Join-Path $env:USERPROFILE '.cache\codex-runtimes\codex-primary-runtime\dependencies\native\poppler\Library\bin\pdftoppm.exe'
if (Test-Path -LiteralPath $bundledPdftoppm) {
    $pdftoppmPath = $bundledPdftoppm
}
else {
    $pdftoppmCommand = Get-Command pdftoppm -ErrorAction SilentlyContinue
    if ($null -ne $pdftoppmCommand) {
        $pdftoppmPath = $pdftoppmCommand.Source
    }
}
if ($null -ne $pdftoppmPath) {
    $arguments += @('--pdftoppm', $pdftoppmPath)
}

$tesseractCandidates = @(
    'C:\Program Files\Tesseract-OCR\tesseract.exe',
    'C:\Program Files (x86)\Tesseract-OCR\tesseract.exe'
)
$tesseractPath = $tesseractCandidates | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
if ($null -eq $tesseractPath) {
    $tesseractCommand = Get-Command tesseract -ErrorAction SilentlyContinue
    if ($null -ne $tesseractCommand) {
        $tesseractPath = $tesseractCommand.Source
    }
}
if ($null -ne $tesseractPath) {
    $arguments += @('--tesseract', $tesseractPath)
}
$localTessdata = Join-Path $assetRoot 'runtime\tessdata'
if (Test-Path -LiteralPath $localTessdata) {
    $arguments += @('--tessdata-dir', $localTessdata)
}

& $pythonExecutable @arguments
if ($LASTEXITCODE -ne 0) {
    throw "资产流水线失败，退出码 $LASTEXITCODE"
}
