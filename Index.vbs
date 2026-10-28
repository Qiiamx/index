Option Explicit

Dim fso, shell, root, trayScript, logDir, consoleLog, command
Set fso = CreateObject("Scripting.FileSystemObject")
Set shell = CreateObject("WScript.Shell")

root = fso.GetParentFolderName(WScript.ScriptFullName)
trayScript = root & "\tray\IndexTray.ps1"

If Not fso.FileExists(trayScript) Then
    MsgBox "tray\IndexTray.ps1 is missing. Keep the repository intact.", 16, "Index"
    WScript.Quit 1
End If

' Redirect the tray's stdio so launching from a shell does not keep the
' caller's pipe open for the whole tray lifetime.
If Not fso.FolderExists(root & "\data") Then fso.CreateFolder root & "\data"
logDir = root & "\data\logs"
If Not fso.FolderExists(logDir) Then fso.CreateFolder logDir
consoleLog = logDir & "\tray-console.log"

shell.CurrentDirectory = root
command = "cmd.exe /c powershell.exe -NoProfile -ExecutionPolicy Bypass -Sta -WindowStyle Hidden -File """ & trayScript & """ >> """ & consoleLog & """ 2>&1"
shell.Run command, 0, False
