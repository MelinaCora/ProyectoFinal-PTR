# Goertzel host checks (PowerShell)
# Mirrors src/goertzel.h so we can run without g++.

$ErrorActionPreference = "Stop"
$n = 64
$fs = 8000.0
$threshold = 5000000.0
$failed = 0

function Get-GoertzelPower([double[]]$samples, [double]$freq, [double]$fs) {
  $len = $samples.Length
  $k = [math]::Round($len * $freq / $fs)
  $w = 2 * [math]::PI * $k / $len
  $coeff = 2 * [math]::Cos($w)
  $s0 = 0.0; $s1 = 0.0; $s2 = 0.0
  foreach ($x in $samples) {
    $s0 = $x + $coeff * $s1 - $s2
    $s2 = $s1
    $s1 = $s0
  }
  return ($s1 * $s1 + $s2 * $s2 - $coeff * $s1 * $s2)
}

function Test-SirenDetected([double[]]$samples) {
  foreach ($f in @(750.0, 1000.0, 1250.0)) {
    if ((Get-GoertzelPower $samples $f $fs) -ge $threshold) { return $true }
  }
  return $false
}

function New-Sine([double]$freq, [double]$amp) {
  $buf = New-Object double[] $n
  for ($i = 0; $i -lt $n; $i++) {
    $buf[$i] = $amp * [math]::Sin(2 * [math]::PI * $freq * $i / $fs)
  }
  return $buf
}

function Expect-True([string]$name, [bool]$cond) {
  if (-not $cond) {
    Write-Host "FAIL: $name"
    $script:failed++
  } else {
    Write-Host "PASS: $name"
  }
}

$s1000 = New-Sine 1000 400
$p1000 = Get-GoertzelPower $s1000 1000 $fs
$p200 = Get-GoertzelPower $s1000 200 $fs
Expect-True "1000 Hz sine has much more power at 1000 Hz than at 200 Hz" ($p1000 -gt ($p200 * 10))
Expect-True "1000 Hz sine is detected as siren" (Test-SirenDetected $s1000)
Expect-True "200 Hz sine is not a siren" (-not (Test-SirenDetected (New-Sine 200 400)))
Expect-True "silence is not a siren" (-not (Test-SirenDetected (New-Object double[] $n)))

if ($failed -gt 0) {
  Write-Host "$failed test(s) failed"
  exit 1
}
Write-Host "all tests passed"
exit 0
