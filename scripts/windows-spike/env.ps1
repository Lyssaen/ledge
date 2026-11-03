# Dot-source before any spike command: the spike's Ledge home and port, and a PATH where agents see PortableGit and the
# spike's Codex, never the system's Git for Windows (the PO's PC will not have it).
$S = Join-Path $env:TEMP 'ledge-spike'
$env:LEDGE_HOME = Join-Path $S 'home'
$env:LEDGE_PORT = '47832'
$env:CLAUDE_CODE_GIT_BASH_PATH = Join-Path $S 'git\bin\bash.exe'
$sys = ([Environment]::GetEnvironmentVariable('Path', 'Machine') + ';' + [Environment]::GetEnvironmentVariable('Path', 'User')) -split ';' |
  Where-Object { $_ -and $_ -notmatch '\\Program Files\\Git\\' }
$codex = Get-ChildItem -Recurse -Filter codex.exe (Join-Path $S 'codex') -ErrorAction SilentlyContinue | Select-Object -First 1
$env:Path = (@((Join-Path $S 'git\cmd'), (Join-Path $S 'git\usr\bin')) + @($(if ($codex) { $codex.DirectoryName })) + $sys) -join ';'
