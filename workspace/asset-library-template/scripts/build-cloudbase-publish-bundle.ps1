param(
    [ValidateSet('plan', 'bundle')]
    [string]$Command = 'plan',
    [Parameter(Mandatory = $true)][string]$ResourceId,
    [Parameter(Mandatory = $true)][string]$OrganizationId,
    [string]$Output = ''
)

$ErrorActionPreference = 'Stop'
$assetRoot = Split-Path -Parent $PSScriptRoot
$bundledPython = Join-Path $env:USERPROFILE '.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe'
$python = if (Test-Path -LiteralPath $bundledPython) { $bundledPython } else {
    (Get-Command python -ErrorAction SilentlyContinue).Source
}
if (-not $python) { throw '未找到 Python 3。' }
$arguments = @((Join-Path $PSScriptRoot 'cloudbase_publish_bundle.py'), $Command, '--root', $assetRoot, '--resource-id', $ResourceId, '--organization-id', $OrganizationId)
if ($Output) { $arguments += @('--output', $Output) }
& $python @arguments
exit $LASTEXITCODE
