param(
    [Parameter(Mandatory = $true)]
    [string]$InputFile,

    [Parameter(Mandatory = $true)]
    [string]$OutputFile,

    [Parameter(Mandatory = $true)]
    [int]$MaxSide,

    [Parameter(Mandatory = $true)]
    [ValidateRange(1, 100)]
    [int]$JpegQuality
)

Add-Type -AssemblyName System.Drawing

$source = $null
$canvas = $null
$graphics = $null
$encoderParameters = $null

try {
    $source = [System.Drawing.Image]::FromFile($InputFile)
    $scale = [Math]::Min(1.0, $MaxSide / [double][Math]::Max($source.Width, $source.Height))
    $width = [Math]::Max(1, [int][Math]::Round($source.Width * $scale))
    $height = [Math]::Max(1, [int][Math]::Round($source.Height * $scale))

    $canvas = New-Object System.Drawing.Bitmap($width, $height)
    $graphics = [System.Drawing.Graphics]::FromImage($canvas)
    $graphics.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
    $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
    $graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
    $graphics.DrawImage($source, 0, 0, $width, $height)

    if ([System.IO.Path]::GetExtension($OutputFile).ToLowerInvariant() -eq ".png") {
        $canvas.Save($OutputFile, [System.Drawing.Imaging.ImageFormat]::Png)
    }
    else {
        $jpegCodec = [System.Drawing.Imaging.ImageCodecInfo]::GetImageEncoders() |
            Where-Object { $_.MimeType -eq "image/jpeg" } |
            Select-Object -First 1
        $encoderParameters = [System.Drawing.Imaging.EncoderParameters]::new(1)
        $encoderParameters.Param[0] = [System.Drawing.Imaging.EncoderParameter]::new(
            [System.Drawing.Imaging.Encoder]::Quality,
            [long]$JpegQuality
        )
        $canvas.Save($OutputFile, $jpegCodec, $encoderParameters)
    }
}
finally {
    if ($null -ne $encoderParameters) { $encoderParameters.Dispose() }
    if ($null -ne $graphics) { $graphics.Dispose() }
    if ($null -ne $canvas) { $canvas.Dispose() }
    if ($null -ne $source) { $source.Dispose() }
}
