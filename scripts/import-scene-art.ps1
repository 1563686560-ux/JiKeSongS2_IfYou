param(
  [Parameter(Mandatory=$true)][string]$BgDir,        # ...\01_backgrounds
  [Parameter(Mandatory=$true)][string]$OverlayDir,   # ...\02_overlays
  [Parameter(Mandatory=$true)][string]$GeneratedDir, # ...\05_working\ai_generations
  [string]$ArtDir = ''
)

# One-off importer for the "A / environment" art delivery.
#
# ASCII-only on purpose: Windows PowerShell 5.1 reads .ps1 as the system ANSI
# codepage, so a UTF-8-without-BOM file with CJK comments gets mis-decoded and
# the script breaks in confusing ways. Keep this file ASCII.
#
# What it does: read the delivered PNGs, resample them to the exact baseline in
# content/art.spec.json, and write them into art/ under their AssetId filename.
# Opaque backgrounds become JPEG (a delivered PNG is 1.7-2.5 MB, far over the
# 1.2 MB per-file cap; JPEG q85 of the same frame is ~10x smaller and this art
# needs no alpha). Overlays stay PNG because they MUST keep their alpha channel.

Add-Type -AssemblyName System.Drawing

# src subdir + filename  ->  AssetId (extension added by the encoder choice)
$JOBS = @(
  # --- opaque scene backgrounds: resample + JPEG ---
  @{ src = $GeneratedDir; file = 'bg_playground_d1_running_v1.png'; id = 'map.playground.background'; jpeg = $true }
  @{ src = $BgDir;        file = 'bg_bedroom_base.png';            id = 'map.bedroom.background';    jpeg = $true }
  @{ src = $BgDir;        file = 'bg_bedroom_morning.png';         id = 'map.bedroom.morning';       jpeg = $true }
  @{ src = $BgDir;        file = 'bg_bedroom_night_lit.png';       id = 'map.bedroom.night';         jpeg = $true }
  @{ src = $BgDir;        file = 'bg_bedroom_lights_out.png';      id = 'map.bedroom.lightsOut';     jpeg = $true }
  @{ src = $BgDir;        file = 'bg_classroom_base.png';          id = 'map.classroom.background';  jpeg = $true }
  # --- overlays: keep alpha, stay PNG ---
  @{ src = $OverlayDir;   file = 'overlay_classroom_morning.png';  id = 'overlay.classroom.morning'; jpeg = $false }
  @{ src = $OverlayDir;   file = 'overlay_classroom_night.png';    id = 'overlay.classroom.night';   jpeg = $false }
  @{ src = $OverlayDir;   file = 'overlay_rain.png';               id = 'overlay.rain';              jpeg = $false }
)

$TARGET_W = 1280
$TARGET_H = 720
$JPEG_QUALITY = 85L

if (-not $ArtDir) { $ArtDir = Join-Path (Split-Path $PSScriptRoot -Parent) 'art' }
if (-not (Test-Path -LiteralPath $ArtDir)) { New-Item -ItemType Directory -Path $ArtDir | Out-Null }

$jpegCodec = [System.Drawing.Imaging.ImageCodecInfo]::GetImageEncoders() |
  Where-Object { $_.MimeType -eq 'image/jpeg' }
$jpegParams = [System.Drawing.Imaging.EncoderParameters]::new(1)
$jpegParams.Param[0] = [System.Drawing.Imaging.EncoderParameter]::new(
  [System.Drawing.Imaging.Encoder]::Quality, $JPEG_QUALITY)

function Resample([string]$inPath, [int]$w, [int]$h, [bool]$keepAlpha) {
  $src = [System.Drawing.Bitmap]::FromFile($inPath)
  $fmt = if ($keepAlpha) { [System.Drawing.Imaging.PixelFormat]::Format32bppArgb }
         else            { [System.Drawing.Imaging.PixelFormat]::Format24bppRgb }
  $dst = [System.Drawing.Bitmap]::new($w, $h, $fmt)
  $g = [System.Drawing.Graphics]::FromImage($dst)
  $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $g.PixelOffsetMode   = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
  $g.SmoothingMode     = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
  $g.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
  $g.CompositingMode = [System.Drawing.Drawing2D.CompositingMode]::SourceCopy
  $g.DrawImage($src, [System.Drawing.Rectangle]::new(0, 0, $w, $h))
  $g.Dispose()
  $src.Dispose()
  return $dst
}

$rows = @()
$fail = 0
foreach ($job in $JOBS) {
  $inPath = Join-Path $job.src $job.file
  if (-not (Test-Path -LiteralPath $inPath)) {
    Write-Host "MISSING SOURCE: $inPath"
    $fail++
    continue
  }
  $srcSize = [System.Drawing.Bitmap]::FromFile($inPath)
  $sw = $srcSize.Width; $sh = $srcSize.Height
  $srcSize.Dispose()

  # Report the non-uniform stretch factor: a large difference means we would be
  # distorting the composition, which is exactly what the spec check protects.
  $sx = $TARGET_W / $sw
  $sy = $TARGET_H / $sh
  $skew = [math]::Abs($sx - $sy) / $sy * 100.0

  $bmp = Resample $inPath $TARGET_W $TARGET_H (-not $job.jpeg)
  $ext = if ($job.jpeg) { '.jpg' } else { '.png' }
  $outPath = Join-Path $ArtDir ($job.id + $ext)
  if ($job.jpeg) {
    $bmp.Save($outPath, $jpegCodec, $jpegParams)
  } else {
    $bmp.Save($outPath, [System.Drawing.Imaging.ImageFormat]::Png)
  }
  $bmp.Dispose()

  $bytes = (Get-Item -LiteralPath $outPath).Length
  $rows += [pscustomobject]@{
    AssetId = $job.id
    From    = "$sw x $sh"
    To      = "$TARGET_W x $TARGET_H"
    Skew    = ('{0:N3}%' -f $skew)
    File    = (Split-Path $outPath -Leaf)
    KB      = [math]::Round($bytes / 1KB, 1)
  }
}

$rows | Format-Table -AutoSize | Out-String -Width 200
Write-Host ("done: {0} written, {1} missing" -f $rows.Count, $fail)
if ($fail -gt 0) { exit 1 }
