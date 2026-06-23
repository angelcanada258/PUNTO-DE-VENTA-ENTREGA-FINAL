Add-Type -AssemblyName System.Drawing

$projectRoot = Split-Path -Parent $PSScriptRoot
$outputDirectory = Join-Path $projectRoot 'public\icons'
New-Item -ItemType Directory -Path $outputDirectory -Force | Out-Null

function New-KaanLuumIcon {
  param(
    [int]$Size,
    [string]$FileName,
    [bool]$Maskable = $false
  )

  $bitmap = New-Object System.Drawing.Bitmap $Size, $Size
  $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
  $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $graphics.Clear([System.Drawing.Color]::FromArgb(15, 110, 86))

  $padding = if ($Maskable) { [int]($Size * 0.20) } else { [int]($Size * 0.11) }
  $diameter = $Size - ($padding * 2)
  $lagoon = New-Object System.Drawing.Rectangle $padding, $padding, $diameter, $diameter

  $lagoonBrush = New-Object System.Drawing.Drawing2D.LinearGradientBrush(
    $lagoon,
    [System.Drawing.Color]::FromArgb(67, 205, 173),
    [System.Drawing.Color]::FromArgb(188, 233, 220),
    90
  )
  $graphics.FillEllipse($lagoonBrush, $lagoon)

  $ringPen = New-Object System.Drawing.Pen(
    [System.Drawing.Color]::FromArgb(185, 255, 255, 255),
    [Math]::Max(2, [int]($Size * 0.018))
  )
  foreach ($scale in @(0.72, 0.46, 0.22)) {
    $ringSize = [int]($diameter * $scale)
    $ringOffset = [int](($Size - $ringSize) / 2)
    $graphics.DrawEllipse($ringPen, $ringOffset, $ringOffset, $ringSize, $ringSize)
  }

  $centerSize = [int]($Size * 0.24)
  $centerOffset = [int](($Size - $centerSize) / 2)
  $centerBrush = New-Object System.Drawing.SolidBrush(
    [System.Drawing.Color]::FromArgb(255, 15, 110, 86)
  )
  $graphics.FillEllipse($centerBrush, $centerOffset, $centerOffset, $centerSize, $centerSize)

  $fontSize = [Math]::Max(12, [int]($Size * 0.078))
  $font = New-Object System.Drawing.Font 'Georgia', $fontSize, ([System.Drawing.FontStyle]::Bold)
  $textBrush = New-Object System.Drawing.SolidBrush(
    [System.Drawing.Color]::FromArgb(245, 255, 255, 255)
  )
  $format = New-Object System.Drawing.StringFormat
  $format.Alignment = [System.Drawing.StringAlignment]::Center
  $format.LineAlignment = [System.Drawing.StringAlignment]::Center
  $textBounds = New-Object System.Drawing.RectangleF(
    $centerOffset,
    $centerOffset,
    $centerSize,
    $centerSize
  )
  $graphics.DrawString('KL', $font, $textBrush, $textBounds, $format)

  $target = Join-Path $outputDirectory $FileName
  $bitmap.Save($target, [System.Drawing.Imaging.ImageFormat]::Png)

  $format.Dispose()
  $textBrush.Dispose()
  $font.Dispose()
  $centerBrush.Dispose()
  $ringPen.Dispose()
  $lagoonBrush.Dispose()
  $graphics.Dispose()
  $bitmap.Dispose()
}

New-KaanLuumIcon -Size 180 -FileName 'apple-touch-icon.png'
New-KaanLuumIcon -Size 192 -FileName 'icon-192.png'
New-KaanLuumIcon -Size 512 -FileName 'icon-512.png'
New-KaanLuumIcon -Size 512 -FileName 'icon-maskable-512.png' -Maskable $true
