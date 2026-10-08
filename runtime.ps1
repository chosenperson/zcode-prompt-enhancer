# Python discovery/bootstrap. Only the official, pinned embeddable distribution is downloaded.
$ZCodePythonVersion = '3.14.8'
$ZCodePythonUrl = 'https://www.python.org/ftp/python/3.14.8/python-3.14.8-embed-amd64.zip'
$ZCodePythonSha256 = 'a93abe456ab01bd96d7a085b3cdb6566b3063f4241360d114142fbdb07f0a310'

function Test-ZCodePython([string]$Executable, [string[]]$Prefix = @()) {
    try {
        $result = & $Executable @Prefix -I -c 'import sys; print(int(sys.version_info >= (3, 10)))' 2>$null
        return ($LASTEXITCODE -eq 0 -and ($result | Select-Object -Last 1) -eq '1')
    } catch { return $false }
}

function Get-ZCodePython([string]$StateDir, [switch]$PreferEmbedded, [switch]$Offline) {
    if (-not $PreferEmbedded) {
        foreach ($name in @('py.exe', 'python.exe', 'python3.exe')) {
            $command = Get-Command $name -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
            # Do not activate Microsoft's Store installation alias.
            if (-not $command -or $command.Source -like '*\Microsoft\WindowsApps\*') { continue }
            $prefix = @()
            if ($name -eq 'py.exe') { $prefix = @('-3') }
            if (Test-ZCodePython $command.Source $prefix) {
                return @{ Executable = $command.Source; Prefix = $prefix; Downloaded = $false }
            }
        }
    }
    $runtimeRoot = Join-Path $StateDir 'runtime'
    $destination = Join-Path $runtimeRoot ('python-' + $ZCodePythonVersion)
    $pythonExe = Join-Path $destination 'python.exe'
    $receipt = Join-Path $destination 'zcode-runtime.json'
    if ((Test-Path -LiteralPath $pythonExe) -and (Test-Path -LiteralPath $receipt)) {
        $saved = Get-Content -LiteralPath $receipt -Raw | ConvertFrom-Json
        if ($saved.sha256 -eq $ZCodePythonSha256 -and (Test-ZCodePython $pythonExe)) {
            return @{ Executable = $pythonExe; Prefix = @(); Downloaded = $false }
        }
        throw 'Cached Python failed verification. Keep this folder for inspection and select another -StateDir.'
    }
    if (Test-Path -LiteralPath $destination) { throw 'An incomplete runtime folder exists. Select another -StateDir; existing files were preserved.' }
    if ($Offline) { throw 'Python 3.10+ was not found. Install Python, or rerun with network access to download the official portable runtime.' }
    if (-not [Environment]::Is64BitOperatingSystem) { throw 'This installer requires 64-bit Windows.' }
    New-Item -ItemType Directory -Path $runtimeRoot -Force | Out-Null
    $download = Join-Path $runtimeRoot ('python-download-' + [guid]::NewGuid().ToString('N') + '.zip')
    $staging = Join-Path $runtimeRoot ('python-stage-' + [guid]::NewGuid().ToString('N'))
    Write-Host ('Downloading official portable Python ' + $ZCodePythonVersion + ' (about 12 MB)...')
    $oldProgress = $ProgressPreference
    try {
        $ProgressPreference = 'SilentlyContinue'
        [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
        Invoke-WebRequest -Uri $ZCodePythonUrl -OutFile $download -UseBasicParsing -TimeoutSec 60
        $hash = (Get-FileHash -LiteralPath $download -Algorithm SHA256).Hash.ToLowerInvariant()
        if ($hash -ne $ZCodePythonSha256) { throw 'Python download hash mismatch. Nothing was executed.' }
        Expand-Archive -LiteralPath $download -DestinationPath $staging
        if (-not (Test-ZCodePython (Join-Path $staging 'python.exe'))) { throw 'The official Python runtime could not start.' }
        @{ version = $ZCodePythonVersion; sha256 = $hash; url = $ZCodePythonUrl } |
            ConvertTo-Json | Set-Content -LiteralPath (Join-Path $staging 'zcode-runtime.json') -Encoding UTF8
        $resolvedRoot = [IO.Path]::GetFullPath($runtimeRoot).TrimEnd('\') + '\'
        foreach ($checkedPath in @($staging, $destination)) {
            if (-not [IO.Path]::GetFullPath($checkedPath).StartsWith($resolvedRoot, [StringComparison]::OrdinalIgnoreCase)) {
                throw 'Runtime path escaped its own cache directory.'
            }
        }
        Move-Item -LiteralPath $staging -Destination $destination
        return @{ Executable = $pythonExe; Prefix = @(); Downloaded = $true }
    } finally {
        $ProgressPreference = $oldProgress
        if (Test-Path -LiteralPath $download) { Remove-Item -LiteralPath $download }
        # Failed extraction directories are retained; no recursive cleanup or unrelated deletion.
    }
}
