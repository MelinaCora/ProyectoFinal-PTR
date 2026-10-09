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

function Read-WavPcm16([string]$path) {
  $bytes = [System.IO.File]::ReadAllBytes($path)
  if ([System.Text.Encoding]::ASCII.GetString($bytes, 0, 4) -ne "RIFF") {
    throw "not a RIFF file: $path"
  }
  $channels = 0
  $rate = 0
  $bits = 0
  $pcm = New-Object System.Collections.Generic.List[double]
  $i = 12
  while ($i + 8 -le $bytes.Length) {
    $id = [System.Text.Encoding]::ASCII.GetString($bytes, $i, 4)
    $size = [BitConverter]::ToInt32($bytes, $i + 4)
    $body = $i + 8
    if ($id -eq "fmt ") {
      $format = [BitConverter]::ToInt16($bytes, $body)
      $channels = [BitConverter]::ToInt16($bytes, $body + 2)
      $rate = [BitConverter]::ToInt32($bytes, $body + 4)
      $bits = [BitConverter]::ToInt16($bytes, $body + 14)
      if ($format -ne 1) { throw "WAV is not PCM" }
    } elseif ($id -eq "data") {
      $count = [int]($size / 2)
      for ($s = 0; $s -lt $count; $s++) {
        $pcm.Add([double][BitConverter]::ToInt16($bytes, $body + (2 * $s)))
      }
    }
    $i = $body + $size
    if (($size % 2) -ne 0) { $i++ }
  }
  return @{ Samples = $pcm.ToArray(); Channels = $channels; Rate = $rate; Bits = $bits }
}

$wavPath = Join-Path (Split-Path $PSScriptRoot -Parent) "sirena.wav"
$wav = Read-WavPcm16 $wavPath
Expect-True "siren wav is PCM 16-bit mono at 8000 Hz" (
  ($wav.Channels -eq 1) -and ($wav.Rate -eq 8000) -and ($wav.Bits -eq 16) -and ($wav.Samples.Length -gt $n))

# WaveGen: mid 2.5 V, semi amplitude 2 V. ADC span is 0-5 V = 0-1023.
$adcScale = (2.0 / 5.0) * 1023.0 / 32767.0

function Get-MaxConsecutive([int]$fromSample, [int]$toSample) {
  $consecutive = 0
  $maxConsecutive = 0
  $start = $fromSample
  while (($start + $script:n) -le $toSample) {
    $window = New-Object double[] $script:n
    $mean = 0.0
    for ($j = 0; $j -lt $script:n; $j++) {
      $window[$j] = $wav.Samples[$start + $j] * $adcScale
      $mean += $window[$j]
    }
    $mean /= $script:n
    for ($j = 0; $j -lt $script:n; $j++) { $window[$j] -= $mean }
    if (Test-SirenDetected $window) {
      $consecutive++
      if ($consecutive -gt $maxConsecutive) { $maxConsecutive = $consecutive }
    } else {
      $consecutive = 0
    }
    $start += $script:n
  }
  return $maxConsecutive
}

$farSamples = 4 * 8000
$peakStart = 8 * 8000
$peakEnd = 12 * 8000
$leaveStart = 16 * 8000
Expect-True "distant siren is not detected" ((Get-MaxConsecutive 0 $farSamples) -eq 0)
Expect-True "siren at peak is detected for 2 consecutive windows" ((Get-MaxConsecutive $peakStart $peakEnd) -ge 2)
Expect-True "departing siren is not detected" ((Get-MaxConsecutive $leaveStart $wav.Samples.Length) -eq 0)

if ($failed -gt 0) {
  Write-Host "$failed test(s) failed"
  exit 1
}
Write-Host "all tests passed"
exit 0
