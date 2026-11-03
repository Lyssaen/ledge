# One-time setup of the spike on the Windows PC: build the clone, PortableGit, Codex, the work folder.
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$S = Join-Path $env:TEMP 'ledge-spike'
$clone = Join-Path $env:TEMP 'ledge-wintest'
New-Item -ItemType Directory -Force (Join-Path $S 'home'), (Join-Path $S 'work'), (Join-Path $S 'out'), (Join-Path $S 'dl') | Out-Null
Push-Location $clone; cmd /c 'pnpm --filter @paradow/ledge build >NUL 2>&1'; if ($LASTEXITCODE) { throw 'build failed' }; Pop-Location
$git = 'https://github.com/git-for-windows/git/releases/download/v2.56.0.windows.4/PortableGit-2.56.0.4-64-bit.7z.exe'
$codex = 'https://github.com/openai/codex/releases/download/rust-v0.166.0/codex-package-x86_64-pc-windows-msvc.tar.gz'
if (-not (Test-Path (Join-Path $S 'git\cmd\git.exe'))) {
  $f = Join-Path $S 'dl\PortableGit.7z.exe'; Invoke-WebRequest $git -OutFile $f
  Start-Process -Wait -FilePath $f -ArgumentList '-y', "-o$(Join-Path $S 'git')"
}
if (-not (Get-ChildItem -Recurse -Filter codex.exe (Join-Path $S 'codex') -ErrorAction SilentlyContinue)) {
  New-Item -ItemType Directory -Force (Join-Path $S 'codex') | Out-Null
  $f = Join-Path $S 'dl\codex.tar.gz'; Invoke-WebRequest $codex -OutFile $f
  tar -xzf $f -C (Join-Path $S 'codex')
}
