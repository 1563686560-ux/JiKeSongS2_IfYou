param([Parameter(Mandatory=$true)][string[]]$ImgPath)

# Pixel probe for the delivered scene art. ASCII-only on purpose:
# Windows PowerShell 5.1 reads .ps1 files as the system ANSI codepage, so a
# UTF-8-without-BOM file containing CJK comments gets mis-decoded and corrupted.
# Keep this file ASCII; the Chinese explanation lives in the markdown docs.

Add-Type -AssemblyName System.Drawing

function Get-ImgStats([string]$imgPath) {
  $src = [System.Drawing.Bitmap]::FromFile($imgPath)
  $w = $src.Width
  $h = $src.Height
  $bmp = [System.Drawing.Bitmap]::new($w, $h, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.CompositingMode = [System.Drawing.Drawing2D.CompositingMode]::SourceCopy
  $g.DrawImage($src, 0, 0, $w, $h)
  $g.Dispose()
  $src.Dispose()

  $rect = [System.Drawing.Rectangle]::new(0, 0, $w, $h)
  $data = $bmp.LockBits($rect, [System.Drawing.Imaging.ImageLockMode]::ReadOnly, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $stride = $data.Stride
  $buf = [byte[]]::new($stride * $h)
  [System.Runtime.InteropServices.Marshal]::Copy($data.Scan0, $buf, 0, $buf.Length)
  $bmp.UnlockBits($data)
  $bmp.Dispose()

  $sumA = 0.0; $sumR = 0.0; $sumG = 0.0; $sumB = 0.0
  $minA = 255; $maxA = 0; $opaque = 0; $clear = 0
  $hist = [int[]]::new(8)
  $n = 0
  for ($y = 0; $y -lt $h; $y++) {
    $rowOff = $y * $stride
    for ($x = 0; $x -lt $w; $x++) {
      $i = $rowOff + $x * 4
      $bb = $buf[$i]; $gg = $buf[$i + 1]; $rr = $buf[$i + 2]; $aa = $buf[$i + 3]
      $sumA += $aa; $sumR += $rr; $sumG += $gg; $sumB += $bb
      if ($aa -lt $minA) { $minA = $aa }
      if ($aa -gt $maxA) { $maxA = $aa }
      if ($aa -ge 250) { $opaque++ }
      if ($aa -le 5) { $clear++ }
      # [math]::Floor, NOT [int]: PowerShell's [int] cast ROUNDS (banker's rounding),
      # so [int](255/32) = [int]7.97 = 8 -> index out of range on exactly the images
      # this tool is meant for (any image with alpha >= 240).
      $hist[[math]::Floor($aa / 32)]++
      $n++
    }
  }
  $r = [ordered]@{}
  $r['File']    = Split-Path $imgPath -Leaf
  $r['Size']    = "$w x $h"
  $r['MeanA']   = [math]::Round($sumA / $n, 1)
  $r['MinA']    = $minA
  $r['MaxA']    = $maxA
  $r['Opaque']  = '{0:N1}%' -f (100.0 * $opaque / $n)
  $r['Clear']   = '{0:N1}%' -f (100.0 * $clear / $n)
  $r['A_hist']  = $hist -join '/'
  $r['MeanRGB'] = "$([math]::Round($sumR / $n, 0)),$([math]::Round($sumG / $n, 0)),$([math]::Round($sumB / $n, 0))"
  [pscustomobject]$r
}

$ImgPath | ForEach-Object { Get-ImgStats $_ } | Format-List | Out-String -Width 220
