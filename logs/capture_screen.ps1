Add-Type -AssemblyName System.Windows.Forms,System.Drawing
$out = 'C:\Users\Giuli\Projects\LeakSnipe\logs\hud_tune_verify.png'
$b = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
$bmp = New-Object System.Drawing.Bitmap($b.Width, $b.Height)
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.CopyFromScreen($b.Location, $b.Location, $b.Size)
$bmp.Save($out)
$g.Dispose()
$bmp.Dispose()
Write-Output $out