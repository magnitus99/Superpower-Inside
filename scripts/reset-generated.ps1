[CmdletBinding(SupportsShouldProcess = $true, ConfirmImpact = 'High')]
param()

$ErrorActionPreference = 'Stop'
$repoRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path

# 승인된 생성물만 지웁니다. 모델·삭제 표식·플러그인 설정·테스트 볼트는 포함하지 않습니다.
$generatedFiles = @(
  'bm25-worker-source.ts', 'vector-search-worker-source.ts', 'xlsx-worker-source.ts',
  'ternlight-worker-source.ts', 'embeddinggemma-assets.ts', 'pdf-worker-assets.ts'
)
$pluginFiles = @(
  'main.js', 'embeddinggemma-worker.js', 'pdf-worker.js', 'pdf-ocr-worker.js',
  'embeddinggemma-runtime.mjs', 'embeddinggemma-runtime.wasm', 'tern_engine_bg.wasm'
)
$targets = @('target', '.local/cache/rust', '.local/cache/bindgen', 'src/rag/rag-wasm-bytes.ts')
foreach ($file in $generatedFiles) {
  $targets += "generated/$file"
  $targets += ".local/generated/$file"
}
foreach ($file in @('rag_wasm.js', 'rag_wasm.d.ts')) {
  $targets += "generated/rag-wasm/$file"
  $targets += ".local/generated/rag-wasm/$file"
}
$targets += '.local/generated/rag-wasm-bytes.ts'
foreach ($file in $pluginFiles) {
  $targets += $file
  $targets += ".local/plugin/$file"
}
foreach ($file in @('manifest.json', 'styles.css', 'THIRD_PARTY_NOTICES.md')) {
  $targets += ".local/plugin/$file"
}

# 삭제 전에 전체 대상을 검사하여 링크를 따라 다른 위치를 지우지 않습니다.
foreach ($relative in $targets) {
  $full = Join-Path $repoRoot $relative
  $ancestor = $full
  while ($ancestor -ne $repoRoot) {
    if (Test-Path -LiteralPath $ancestor) {
      $item = Get-Item -LiteralPath $ancestor -Force
      if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
        throw "생성물 경로에 링크가 있어 중단합니다: $relative"
      }
    }
    $ancestor = Split-Path -Parent $ancestor
  }
  if ((Test-Path -LiteralPath $full -PathType Container) -and
      (Get-ChildItem -LiteralPath $full -Recurse -Force | Where-Object {
        ($_.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0
      } | Select-Object -First 1)) {
    throw "생성물 내부에 링크가 있어 중단합니다: $relative"
  }
}
foreach ($relative in $targets) {
  $full = Join-Path $repoRoot $relative
  if ((Test-Path -LiteralPath $full) -and $PSCmdlet.ShouldProcess($relative, '생성물 삭제')) {
    Remove-Item -LiteralPath $full -Recurse -Force
    Write-Host "삭제: $relative"
  }
}
# 알려진 이전 출력 디렉터리는 빈 경우에만 제거합니다.
foreach ($relative in @('generated/rag-wasm', 'generated', 'simulations')) {
  $full = Join-Path $repoRoot $relative
  if ((Test-Path -LiteralPath $full -PathType Container) -and
      -not (Get-ChildItem -LiteralPath $full -Force | Select-Object -First 1) -and
      $PSCmdlet.ShouldProcess($relative, '빈 이전 출력 폴더 삭제')) {
    Remove-Item -LiteralPath $full
  }
}
