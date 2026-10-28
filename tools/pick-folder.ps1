Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)

$owner = New-Object System.Windows.Forms.Form
$owner.Text = 'Index'
$owner.ShowInTaskbar = $false
$owner.FormBorderStyle = [System.Windows.Forms.FormBorderStyle]::None
$owner.StartPosition = [System.Windows.Forms.FormStartPosition]::Manual
$owner.Location = New-Object System.Drawing.Point(-2000, -2000)
$owner.Size = New-Object System.Drawing.Size(1, 1)
$owner.TopMost = $true
$owner.Show()

$dialog = New-Object System.Windows.Forms.FolderBrowserDialog
$dialog.Description = 'Select a local media folder for Index'
$dialog.ShowNewFolderButton = $true

$result = $dialog.ShowDialog($owner)
if ($result -eq [System.Windows.Forms.DialogResult]::OK) {
    [Console]::Out.Write($dialog.SelectedPath)
}

$dialog.Dispose()
$owner.Close()
$owner.Dispose()
