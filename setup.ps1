param(
    [ValidateSet('Install', 'Check', 'Rollback', 'Launch')][string]$Action = 'Install',
    [string]$ZCodePath,
    [string]$StateDir,
    [switch]$NoShortcut,
    [switch]$Offline,
    [switch]$PreferEmbedded
)
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
. (Join-Path $PSScriptRoot 'runtime.ps1')

try {
    if (-not $StateDir) { $StateDir = Join-Path $env:LOCALAPPDATA 'ZCodePromptEnhancer' }
    $StateDir = [IO.Path]::GetFullPath($StateDir)
    $registration = Join-Path $StateDir 'installation.json'
    if (-not $ZCodePath -and (Test-Path -LiteralPath $registration)) {
        $ZCodePath = (Get-Content -LiteralPath $registration -Raw | ConvertFrom-Json).zcodePath
    }
    if (-not $ZCodePath) { $ZCodePath = Join-Path $env:LOCALAPPDATA 'Programs\ZCode' }
    if ([IO.Path]::GetFileName($ZCodePath) -ieq 'ZCode.exe') { $ZCodePath = Split-Path -Parent $ZCodePath }
    $ZCodePath = [IO.Path]::GetFullPath($ZCodePath)
    $exe = Join-Path $ZCodePath 'ZCode.exe'
    $target = Join-Path $ZCodePath 'resources\app.asar'
    if (-not (Test-Path -LiteralPath $exe) -or -not (Test-Path -LiteralPath $target)) {
        throw 'ZCode was not found. Run setup.ps1 -ZCodePath "D:\your\ZCode" with its installation folder.'
    }
    if ($Action -in @('Install', 'Rollback') -and (Get-Process -Name ZCode -ErrorAction SilentlyContinue)) {
        throw 'Save your drafts and fully exit ZCode first. This installer never kills running tasks.'
    }
    $python = Get-ZCodePython -StateDir $StateDir -PreferEmbedded:$PreferEmbedded -Offline:$Offline
    # Embeddable Python isolates sys.path; add only this toolkit before executing inject.py.
    $bootstrap = "import os,runpy,sys; root=sys.argv.pop(1); sys.path.insert(0,root); runpy.run_path(os.path.join(root,'inject.py'),run_name='__main__')"
    $arguments = @($python.Prefix) + @('-I', '-X', 'utf8', '-c', $bootstrap, $PSScriptRoot,
        '--target', $target, '--data-dir', (Join-Path $StateDir 'packages'))
    if ($Action -eq 'Rollback') { $arguments += '--rollback' }
    elseif ($Action -ne 'Check') { $arguments += '--apply' }
    Write-Host 'Checking the ZCode build and verifying the backup/patch...'
    & $python.Executable @arguments
    if ($LASTEXITCODE -ne 0) { throw 'Patch verification failed. Read the message above; ZCode was not launched.' }

    if ($Action -eq 'Install') {
        $toolkit = Join-Path $StateDir 'toolkit'
        New-Item -ItemType Directory -Path $toolkit -Force | Out-Null
        foreach ($name in @('setup.ps1', 'runtime.ps1', 'inject.py', 'build.py', 'enhancer.mjs', 'templates.mjs')) {
            $source = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot $name))
            $destination = [IO.Path]::GetFullPath((Join-Path $toolkit $name))
            if ($source -ine $destination) { Copy-Item -LiteralPath $source -Destination $destination -Force }
        }
        @{ zcodePath = $ZCodePath } | ConvertTo-Json | Set-Content -LiteralPath $registration -Encoding UTF8
        if (-not $NoShortcut) {
            $desktop = [Environment]::GetFolderPath('Desktop')
            $shortcutPath = Join-Path $desktop 'ZCode Prompt Enhancer.lnk'
            $shell = New-Object -ComObject WScript.Shell
            $shortcut = $shell.CreateShortcut($shortcutPath)
            $powershell = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
            $launchArguments = '-NoProfile -ExecutionPolicy Bypass -File "' + (Join-Path $toolkit 'setup.ps1') + '" -Action Launch -StateDir "' + $StateDir + '"'
            if ((Test-Path -LiteralPath $shortcutPath) -and ($shortcut.TargetPath -ine $powershell -or $shortcut.Arguments -ne $launchArguments)) {
                Write-Warning 'A different desktop shortcut already uses this name; it was preserved.'
            } else {
                $shortcut.TargetPath = $powershell
                $shortcut.Arguments = $launchArguments
                $shortcut.WorkingDirectory = $toolkit
                $shortcut.IconLocation = $exe + ',0'
                $shortcut.Description = 'Validate the supported ZCode build, restore the enhancement patch, and launch ZCode.'
                $shortcut.Save()
            }
        }
        Write-Host 'Installed. Use ZCode normally, or the desktop ZCode Prompt Enhancer shortcut.'
    }
    # Launch is an explicit interactive action from the user's desktop shortcut.
    if ($Action -eq 'Launch') { Start-Process -FilePath $exe -WindowStyle Normal }
    if ($Action -eq 'Rollback') { Write-Host 'Official app restored. Keep backups; use the normal ZCode shortcut until you choose to install again.' }
} catch {
    Write-Host ('Stopped: ' + $_.Exception.Message) -ForegroundColor Red
    exit 1
}
