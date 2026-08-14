param(
    [Parameter(Mandatory = $true)]
    [string]$OutFile
)

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

$image = $null
for ($attempt = 1; $attempt -le 3; $attempt++) {
    try {
        $image = [System.Windows.Forms.Clipboard]::GetImage()
        if ($null -ne $image) {
            break
        }
    }
    catch {
        if ($attempt -eq 3) {
            Write-Error "failed to read clipboard image: $($_.Exception.Message)"
            exit 1
        }
    }

    if ($attempt -lt 3) {
        Start-Sleep -Milliseconds 150
    }
}

if ($null -eq $image) {
    Write-Error "no image found in clipboard"
    exit 1
}

try {
    $image.Save($OutFile, [System.Drawing.Imaging.ImageFormat]::Png)
}
finally {
    $image.Dispose()
}
