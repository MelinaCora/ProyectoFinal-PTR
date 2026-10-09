# Genera sirena.wav (PCM 16 bit, mono, 8 kHz) junto a Citcuito1.sim1.
# Wail de fase continua entre 650 y 1300 Hz para cruzar 750, 1000 y 1250 Hz.

$ErrorActionPreference = "Stop"

$fs = 8000
$duration = 2.0
$sampleCount = [int]($fs * $duration)
$amplitude = 0.9 * 32767.0

$samples = New-Object System.Int16[] $sampleCount
$phase = 0.0
for ($i = 0; $i -lt $sampleCount; $i++) {
  $t = $i / $fs
  $freq = 650.0 + 650.0 * (0.5 - 0.5 * [math]::Cos(2.0 * [math]::PI * $t / $duration))
  $phase += 2.0 * [math]::PI * $freq / $fs
  $samples[$i] = [int16]([math]::Round($amplitude * [math]::Sin($phase)))
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
foreach ($sample in $samples) {
  $writer.Write([int16]$sample)
}
$writer.Flush()

$outPath = Join-Path (Split-Path $PSScriptRoot -Parent) "sirena.wav"
[System.IO.File]::WriteAllBytes($outPath, $stream.ToArray())
Write-Host "Wrote $outPath ($sampleCount samples)"
