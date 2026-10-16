# Goertzel host checks (PowerShell)
# Mirrors src/goertzel.h: pico tonal + barrido grave/agudo.

$ErrorActionPreference = "Stop"
$n = 64
$fs = 8000.0
$threshold = 5000000.0
$peakRatio = 2.0
$bands = @(650.0, 800.0, 950.0, 1100.0, 1250.0)
$lowHz = 850.0
$highHz = 1100.0
$sweepMs = 2000
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

function Get-SirenTone([double[]]$samples) {
  $best = 0.0
  $second = 0.0
  $bestHz = 0.0
  foreach ($f in $bands) {
    $p = Get-GoertzelPower $samples $f $fs
    if ($p -gt $best) {
      $second = $best
      $best = $p
      $bestHz = $f
    } elseif ($p -gt $second) {
      $second = $p
    }
  }
  if (($best -ge $threshold) -and ($best -ge ($second * $peakRatio))) {
    return @{ Present = $true; FreqHz = $bestHz }
  }
  return @{ Present = $false; FreqHz = 0.0 }
}

function New-SirenEar {
  return @{ LastLowMs = 0; LastHighMs = 0 }
}

function Reset-SirenEar($ear) {
  $ear.LastLowMs = 0
  $ear.LastHighMs = 0
}

function Feed-SirenEar($ear, $tone, [uint32]$nowMs) {
  if (($ear.LastLowMs -ne 0) -and (($nowMs - $ear.LastLowMs) -gt $sweepMs)) {
    $ear.LastLowMs = 0
  }
  if (($ear.LastHighMs -ne 0) -and (($nowMs - $ear.LastHighMs) -gt $sweepMs)) {
    $ear.LastHighMs = 0
  }
  if (-not $tone.Present) { return $false }
  if ($tone.FreqHz -lt $lowHz) { $ear.LastLowMs = $nowMs }
  if ($tone.FreqHz -gt $highHz) { $ear.LastHighMs = $nowMs }
  return (($ear.LastLowMs -ne 0) -and ($ear.LastHighMs -ne 0))
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
$p1000 = Get-GoertzelPower $s1000 950 $fs
$p200 = Get-GoertzelPower $s1000 650 $fs
Expect-True "1000 Hz sine has much more power near 950 Hz than at 650 Hz" ($p1000 -gt ($p200 * 10))

$earFixed = New-SirenEar
$confirmedFixed = $false
for ($w = 0; $w -lt 40; $w++) {
  $tone = Get-SirenTone (New-Sine 1000 400)
  if (Feed-SirenEar $earFixed $tone ([uint32]($w * 8))) { $confirmedFixed = $true }
}
Expect-True "1000 Hz sine is not a siren pattern" (-not $confirmedFixed)

$ear200 = New-SirenEar
$confirmed200 = $false
for ($w = 0; $w -lt 40; $w++) {
  $tone = Get-SirenTone (New-Sine 200 400)
  if (Feed-SirenEar $ear200 $tone ([uint32]($w * 8))) { $confirmed200 = $true }
}
Expect-True "200 Hz sine is not a siren pattern" (-not $confirmed200)

$earSilence = New-SirenEar
$confirmedSilence = Feed-SirenEar $earSilence (Get-SirenTone (New-Object double[] $n)) 0
Expect-True "silence is not a siren pattern" (-not $confirmedSilence)

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

function Test-WavRange([int]$fromSample, [int]$toSample) {
  $ear = New-SirenEar
  $confirmedAt = -1
  $nowMs = 0
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
    $tone = Get-SirenTone $window
    if (Feed-SirenEar $ear $tone ([uint32]$nowMs)) {
      if ($confirmedAt -lt 0) { $confirmedAt = $start }
    }
    $nowMs += [int](1000.0 * $script:n / $fs)
    $start += $script:n
  }
  return $confirmedAt
}

$farSamples = 4 * 8000
$peakStart = 8 * 8000
$peakEnd = 12 * 8000
$leaveStart = 16 * 8000
Expect-True "distant siren does not confirm pattern" ((Test-WavRange 0 $farSamples) -lt 0)
$peakConfirm = Test-WavRange $peakStart $peakEnd
Expect-True "siren at peak confirms pattern" ($peakConfirm -ge 0)
Expect-True "peak confirmation happens after the distant stretch" ($peakConfirm -ge $farSamples)
Expect-True "departing siren does not confirm pattern" ((Test-WavRange $leaveStart $wav.Samples.Length) -lt 0)

if ($failed -gt 0) {
  Write-Host "$failed test(s) failed"
  exit 1
}
Write-Host "all tests passed"
exit 0
