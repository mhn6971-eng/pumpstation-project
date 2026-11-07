Option Explicit

Dim sh, fso, installRoot, ps1, powershell, processEnv, command, exitCode
Set sh = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
installRoot = fso.GetParentFolderName(WScript.ScriptFullName)
ps1 = fso.BuildPath(installRoot, "launch-pumpstation.ps1")
powershell = sh.ExpandEnvironmentStrings("%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe")

If Not fso.FileExists(ps1) Then
  MsgBox "Pumpstation launcher was not found. Run the installer again." & vbCrLf & ps1, vbCritical, "Pumpstation"
  WScript.Quit 1
End If
If Not fso.FileExists(powershell) Then
  MsgBox "Windows PowerShell was not found on this computer.", vbCritical, "Pumpstation"
  WScript.Quit 1
End If

Set processEnv = sh.Environment("PROCESS")
processEnv("PUMPSTATION_LAUNCHER_HIDDEN") = "1"
command = Quote(powershell) & " -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File " & Quote(ps1)
On Error Resume Next
exitCode = sh.Run(command, 0, True)
If Err.Number <> 0 Then
  MsgBox "Windows could not start the hidden Pumpstation launcher." & vbCrLf & Err.Description, vbCritical, "Pumpstation"
  WScript.Quit 1
End If
On Error GoTo 0
WScript.Quit exitCode

Function Quote(value)
  Quote = Chr(34) & value & Chr(34)
End Function
