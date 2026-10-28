param(
    [string]$Root = (Split-Path -Parent $PSScriptRoot)
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

$assets = Join-Path $Root 'assets'
$temp = Join-Path $env:TEMP ("index-icons-" + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Force -Path $assets, $temp | Out-Null

$sizes = @(16, 24, 32, 48, 64, 128, 256)

function New-RoundedIcon {
    param(
        [int]$Size,
        [System.Drawing.Color]$Accent,
        [string]$Path
    )

    $bitmap = New-Object System.Drawing.Bitmap(
        $Size,
        $Size,
        [System.Drawing.Imaging.PixelFormat]::Format32bppArgb
    )
    $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
    $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $graphics.Clear([System.Drawing.Color]::Transparent)

    $radius = [Math]::Max(2.0, [double]$Size * 0.22)
    $diameter = $radius * 2.0
    $max = [double]($Size - 1)
    $shape = New-Object System.Drawing.Drawing2D.GraphicsPath
    $shape.AddArc(0, 0, $diameter, $diameter, 180, 90)
    $shape.AddArc($max - $diameter, 0, $diameter, $diameter, 270, 90)
    $shape.AddArc($max - $diameter, $max - $diameter, $diameter, $diameter, 0, 90)
    $shape.AddArc(0, $max - $diameter, $diameter, $diameter, 90, 90)
    $shape.CloseFigure()

    $background = New-Object System.Drawing.SolidBrush(
        [System.Drawing.Color]::FromArgb(255, 13, 17, 23)
    )
    $graphics.FillPath($background, $shape)

    $border = New-Object System.Drawing.Pen(
        [System.Drawing.Color]::FromArgb(65, 255, 255, 255),
        [Math]::Max(1.0, [double]$Size / 48.0)
    )
    $graphics.DrawPath($border, $shape)

    $triangle = [System.Drawing.PointF[]]@(
        [System.Drawing.PointF]::new([double]$Size * 0.36, [double]$Size * 0.27),
        [System.Drawing.PointF]::new([double]$Size * 0.36, [double]$Size * 0.73),
        [System.Drawing.PointF]::new([double]$Size * 0.75, [double]$Size * 0.5)
    )
    $accentBrush = New-Object System.Drawing.SolidBrush($Accent)
    $graphics.FillPolygon($accentBrush, $triangle)

    $bitmap.Save($Path, [System.Drawing.Imaging.ImageFormat]::Png)

    $accentBrush.Dispose()
    $border.Dispose()
    $background.Dispose()
    $shape.Dispose()
    $graphics.Dispose()
    $bitmap.Dispose()
}

function Write-Ico {
    param(
        [string[]]$PngFiles,
        [string]$Output
    )

    $images = @()
    foreach ($file in $PngFiles) {
        $images += ,([System.IO.File]::ReadAllBytes($file))
    }

    $stream = New-Object System.IO.MemoryStream
    $writer = New-Object System.IO.BinaryWriter($stream)
    $writer.Write([UInt16]0)
    $writer.Write([UInt16]1)
    $writer.Write([UInt16]$images.Count)

    $offset = 6 + (16 * $images.Count)
    for ($i = 0; $i -lt $images.Count; $i++) {
        $size = $sizes[$i]
        $dimension = if ($size -ge 256) { 0 } else { $size }
        $writer.Write([byte]$dimension)
        $writer.Write([byte]$dimension)
        $writer.Write([byte]0)
        $writer.Write([byte]0)
        $writer.Write([UInt16]1)
        $writer.Write([UInt16]32)
        $writer.Write([UInt32]$images[$i].Length)
        $writer.Write([UInt32]$offset)
        $offset += $images[$i].Length
    }

    foreach ($image in $images) {
        $writer.Write($image)
    }

    $writer.Flush()
    [System.IO.File]::WriteAllBytes($Output, $stream.ToArray())
    $writer.Dispose()
    $stream.Dispose()
}

foreach ($state in @(
    @{ Name = 'index'; Accent = [System.Drawing.Color]::FromArgb(255, 79, 157, 255) },
    @{ Name = 'index-stopped'; Accent = [System.Drawing.Color]::FromArgb(255, 139, 148, 158) }
)) {
    $pngs = @()
    foreach ($size in $sizes) {
        $png = Join-Path $temp ("{0}-{1}.png" -f $state.Name, $size)
        New-RoundedIcon -Size $size -Accent $state.Accent -Path $png
        $pngs += $png
    }
    $ico = Join-Path $assets ($state.Name + '.ico')
    Write-Ico -PngFiles $pngs -Output $ico
    $icon = New-Object System.Drawing.Icon($ico)
    Write-Output ("{0}: {1}x{2}" -f $ico, $icon.Width, $icon.Height)
    $icon.Dispose()
}

Remove-Item -LiteralPath $temp -Recurse -Force -ErrorAction SilentlyContinue
