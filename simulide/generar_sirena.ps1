# Genera sirena.wav (PCM 16 bit, mono, 8 kHz) junto a Citcuito1.sim1.
# El wail sigue en 650–1300 Hz. La amplitud es la distancia: lejos, pico, lejos.
# El firmware no cambia; entra y sale de ambulancia según la energía en A0.

$ErrorActionPreference = "Stop"

$fs = 8000
$duration = 20.0
$wailPeriod = 2.0
$peak = 0.9 * 32767.0
$sampleCount = [int]($fs * $duration)

function Get-DistanceEnvelope([double]$t) {
  $far = 0.02
  if ($t -lt 4.0) { return $far }
  if ($t -lt 8.0) { return $far + (1.0 - $far) * (($t - 4.0) / 4.0) }
  if ($t -lt 12.0) { return 1.0 }
  if ($t -lt 16.0) { return 1.0 - (1.0 - $far) * (($t - 12.0) / 4.0) }
  return $far
}

$samples = New-Object System.Int16[] $sampleCount
$phase = 0.0
for ($i = 0; $i -lt $sampleCount; $i++) {
  $t = $i / $fs
  $freq = 650.0 + 650.0 * (0.5 - 0.5 * [math]::Cos(2.0 * [math]::PI * $t / $wailPeriod))
  $phase += 2.0 * [math]::PI * $freq / $fs
  $envelope = Get-DistanceEnvelope $t
  $samples[$i] = [int16]([math]::Round($peak * $envelope * [math]::Sin($phase)))
}

$dataSize = $sampleCount * 2
$riffSize = 36 + $dataSize
$byteRate = $fs * 2

$stream = New-Object System.IO.MemoryStream
$writer = New-Object System.IO.BinaryWriter $stream
$ascii = [System.Text.Encoding]::ASCII

$writer.Write($ascii.GetBytes("RIFF"))
$writer.Write([int32]$riffSize)
$writer.Write($ascii.GetBytes("WAVE"))
$writer.Write($ascii.GetBytes("fmt "))
$writer.Write([int32]16)
$writer.Write([int16]1)
$writer.Write([int16]1)
$writer.Write([int32]$fs)
$writer.Write([int32]$byteRate)
$writer.Write([int16]2)
$writer.Write([int16]16)
$writer.Write($ascii.GetBytes("data"))
$writer.Write([int32]$dataSize)
$pcm = New-Object byte[] ($sampleCount * 2)
[System.Buffer]::BlockCopy($samples, 0, $pcm, 0, $pcm.Length)
$writer.Write($pcm)
$writer.Flush()

$outPath = Join-Path (Split-Path $PSScriptRoot -Parent) "sirena.wav"
[System.IO.File]::WriteAllBytes($outPath, $stream.ToArray())
Write-Host "Wrote $outPath ($sampleCount samples)"
