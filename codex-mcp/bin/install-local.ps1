param(
    [Parameter(Mandatory = $true)]
    [string]$Workspace,
    [string]$WorkerPath = ""
)

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
$Workspace = (Resolve-Path -LiteralPath $Workspace).Path
if (-not $WorkerPath) {
    $WorkerPath = Join-Path (Split-Path -Parent $Root) "native\target\release\dsh-ops-worker.exe"
}
$WorkerPath = (Resolve-Path -LiteralPath $WorkerPath).Path
$ConfigRoot = Join-Path $HOME ".dsh-ops-codex"
$ConfigFile = Join-Path $ConfigRoot "config.json"
New-Item -ItemType Directory -Force -Path $ConfigRoot | Out-Null
$Json = [ordered]@{
    workspace = $Workspace
    workerPath = $WorkerPath
} | ConvertTo-Json
$Utf8WithoutBom = [System.Text.UTF8Encoding]::new($false)
[System.IO.File]::WriteAllText(
    $ConfigFile,
    $Json + [Environment]::NewLine,
    $Utf8WithoutBom
)
$Codex = (Get-Command codex -ErrorAction Stop).Source
$Node = (Get-Command node -ErrorAction Stop).Source
$Launcher = Join-Path $Root "bin\launcher.mjs"
& $Codex mcp get dsh_ops_codex *> $null
if ($LASTEXITCODE -eq 0) {
    & $Codex mcp remove dsh_ops_codex | Out-Null
    if ($LASTEXITCODE -ne 0) {
        throw "Failed to replace MCP server dsh_ops_codex"
    }
}
& $Codex mcp add dsh_ops_codex `
    --env "DSH_OPS_WORKSPACE=$Workspace" `
    --env "DSH_OPS_WORKER_PATH=$WorkerPath" `
    -- $Node $Launcher | Out-Null
if ($LASTEXITCODE -ne 0) {
    throw "Failed to register MCP server dsh_ops_codex"
}
Write-Output "Wrote $ConfigFile"
Write-Output "Registered MCP server dsh_ops_codex"
