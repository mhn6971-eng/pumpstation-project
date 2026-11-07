Option Explicit

Dim sh, fso, procEnv, scriptDir, appDir, drive, dataRoot, logDir, logFile
Dim appVersion, baseUrl, rosterPath, command, result, i

Set sh = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
Set procEnv = sh.Environment("PROCESS")
appVersion = "1.4.13"
baseUrl = "http://127.0.0.1:3000"
scriptDir = fso.GetParentFolderName(WScript.ScriptFullName)
appDir = fso.BuildPath(scriptDir, "pumpstation-v1.2")

If UCase(fso.GetDriveName(scriptDir)) = "C:" Then
  MsgBox "Extract the ZIP to a local folder on D: and double-click Pumpstation-OneClick.vbs there.", vbExclamation, "Pumpstation"
  WScript.Quit 1
End If
If IsCloudPath(scriptDir) Then
  MsgBox "This folder appears to be cloud-synced. Extract the ZIP to a local folder on D: instead.", vbExclamation, "Pumpstation"
  WScript.Quit 1
End If
If Not fso.FileExists(fso.BuildPath(appDir, "package.json")) Then
  MsgBox "The app files were not found. Extract the complete ZIP, then double-click Pumpstation-OneClick.vbs in its top folder.", vbCritical, "Pumpstation"
  WScript.Quit 1
End If

' Preserve an existing local test database in this extracted app folder; otherwise create stable data on the same non-C drive.
dataRoot = fso.GetDriveName(scriptDir) & "\Pumpstation-Data"
If fso.FolderExists(fso.BuildPath(appDir, ".data\pglite")) Then dataRoot = fso.BuildPath(appDir, ".data")
logDir = fso.BuildPath(dataRoot, "logs")
EnsureFolder dataRoot
EnsureFolder logDir
logFile = fso.BuildPath(logDir, "one-click-start.log")
ResetLog

If Not CommandOk("where.exe node.exe >nul 2>&1") Then Fail "Node.js was not found. Install Node.js 22 or later once, then double-click this icon again."
If Not CommandOk("where.exe npm.cmd >nul 2>&1") Then Fail "npm.cmd was not found. Repair the Node.js installation with npm enabled, then retry."
If Not CommandOk("node.exe -e " & Quote("process.exit(Number(process.versions.node.split('.')[0]) >= 22 ? 0 : 1)") & " >nul 2>&1") Then Fail "Node.js 22 or later is required."

procEnv("NODE_ENV") = "development"
procEnv("DATABASE_URL") = ""
procEnv("PORT") = "3000"
procEnv("PGLITE_DATA_DIR") = fso.BuildPath(dataRoot, "pglite")
procEnv("BACKUP_DIR") = fso.BuildPath(dataRoot, "backups")
procEnv("CATALOG_DIR") = fso.BuildPath(dataRoot, "catalog")
procEnv("ARCHIVE_DIR") = fso.BuildPath(dataRoot, "archive")
procEnv("MIRROR_DIR") = fso.BuildPath(dataRoot, "mirror")
procEnv("PGDUMP_DIR") = fso.BuildPath(dataRoot, "pgdump")
procEnv("PROCESS_REPORT_DIR") = fso.BuildPath(dataRoot, "process-report")
procEnv("PM_REPORT_DIR") = fso.BuildPath(dataRoot, "pm-report")
procEnv("SESSION_SECRET_DIR") = fso.BuildPath(dataRoot, "session-secret")
procEnv("MIRROR_TOKEN_FILE") = fso.BuildPath(dataRoot, "mirror-token")
procEnv("NEXT_TELEMETRY_DISABLED") = "1"
rosterPath = fso.BuildPath(appDir, "data\roster.sample.json")
If fso.FileExists(fso.BuildPath(appDir, "data\roster.local.json")) Then rosterPath = fso.BuildPath(appDir, "data\roster.local.json")
procEnv("ROSTER_FILE") = rosterPath

If IsHealthy() Then
  sh.Run baseUrl, 1, False
  WScript.Quit 0
End If
If IsHttpPortOpen() Then Fail "Port 3000 is already used by another program. Close that program, then click Pumpstation-OneClick.vbs again."

EnsureFolder procEnv("PGLITE_DATA_DIR")
EnsureFolder procEnv("BACKUP_DIR")
EnsureFolder procEnv("CATALOG_DIR")
EnsureFolder procEnv("ARCHIVE_DIR")
EnsureFolder procEnv("MIRROR_DIR")
EnsureFolder procEnv("PGDUMP_DIR")
EnsureFolder procEnv("PROCESS_REPORT_DIR")
EnsureFolder procEnv("PM_REPORT_DIR")
EnsureFolder procEnv("SESSION_SECRET_DIR")
LogLine "Starting Pumpstation one-click test " & appVersion
LogLine "App folder: " & appDir
LogLine "Data folder: " & dataRoot

sh.CurrentDirectory = appDir
If Not fso.FileExists(fso.BuildPath(appDir, "node_modules\next\package.json")) Then
  sh.Popup "First-time setup is running automatically. It may take several minutes; please wait for the browser.", 6, "Pumpstation", vbInformation
  command = "npm.cmd ci --no-audit --no-fund >> " & Quote(logFile) & " 2>&1"
  result = RunHiddenWait(command)
  If result <> 0 Then Fail "Automatic dependency setup failed. The previous data was not removed. See the log shown next."
End If

command = "node.exe scripts\init-db.mjs >> " & Quote(logFile) & " 2>&1"
result = RunHiddenWait(command)
If result <> 0 Then Fail "Database preparation failed. Existing data was not deleted. See the log shown next."

command = "node.exe scripts\serve.mjs dev >> " & Quote(logFile) & " 2>&1"
result = RunHidden(command)
If result <> 0 Then Fail "Could not start the app process. See the log shown next."

For i = 1 To 75
  WScript.Sleep 1000
  If IsHealthy() Then
    LogLine "App ready at " & baseUrl
    sh.Run baseUrl, 1, False
    WScript.Quit 0
  End If
Next
Fail "The app did not become ready within 75 seconds. See the log shown next."

Function RunHiddenWait(cmd)
  On Error Resume Next
  RunHiddenWait = sh.Run("cmd.exe /d /c " & cmd, 0, True)
  If Err.Number <> 0 Then RunHiddenWait = 1
  Err.Clear
  On Error GoTo 0
End Function

Function RunHidden(cmd)
  On Error Resume Next
  RunHidden = sh.Run("cmd.exe /d /c " & cmd, 0, False)
  If Err.Number <> 0 Then RunHidden = 1
  Err.Clear
  On Error GoTo 0
End Function

Function CommandOk(cmd)
  CommandOk = (RunHiddenWait(cmd) = 0)
End Function

Function IsHealthy()
  Dim req, token
  IsHealthy = False
  On Error Resume Next
  Set req = CreateObject("WinHttp.WinHttpRequest.5.1")
  req.SetProxy 1
  req.SetTimeouts 500, 500, 1500, 1500
  req.Open "GET", baseUrl & "/api/health", False
  req.Send
  token = Chr(34) & "version" & Chr(34) & ":" & Chr(34) & appVersion & Chr(34)
  If Err.Number = 0 Then
    If req.Status = 200 And req.ResponseText <> "" Then
      If InStr(1, req.ResponseText, token, vbTextCompare) > 0 Then IsHealthy = True
    End If
  End If
  Err.Clear
  Set req = Nothing
  On Error GoTo 0
End Function

Function IsHttpPortOpen()
  Dim req
  IsHttpPortOpen = False
  On Error Resume Next
  Set req = CreateObject("WinHttp.WinHttpRequest.5.1")
  req.SetProxy 1
  req.SetTimeouts 300, 300, 500, 500
  req.Open "GET", baseUrl & "/api/health", False
  req.Send
  If Err.Number = 0 Then IsHttpPortOpen = True
  Err.Clear
  Set req = Nothing
  On Error GoTo 0
End Function

Function IsCloudPath(path)
  Dim lowerPath
  lowerPath = LCase(path)
  IsCloudPath = (InStr(lowerPath, "onedrive") > 0 Or InStr(lowerPath, "dropbox") > 0 Or InStr(lowerPath, "google drive") > 0 Or InStr(lowerPath, "icloud") > 0)
End Function

Sub EnsureFolder(path)
  If Not fso.FolderExists(path) Then fso.CreateFolder path
End Sub

Sub ResetLog()
  Dim file
  Set file = fso.CreateTextFile(logFile, True, False)
  file.WriteLine "Pumpstation one-click launcher " & appVersion & " - " & Now
  file.Close
End Sub

Sub LogLine(text)
  Dim file
  Set file = fso.OpenTextFile(logFile, 8, True, 0)
  file.WriteLine Now & "  " & text
  file.Close
End Sub

Sub Fail(message)
  LogLine "ERROR: " & message
  MsgBox message & vbCrLf & vbCrLf & "Diagnostic log: " & logFile, vbCritical, "Pumpstation"
  WScript.Quit 1
End Sub

Function Quote(text)
  Quote = Chr(34) & text & Chr(34)
End Function
