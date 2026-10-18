; Ledge Desktop now carries the notch: the old « Ledge » app (per-user install under %LOCALAPPDATA%\Ledge) is stopped
; and uninstalled first, so a single notch and a single launch-at-login entry remain. Its own uninstaller removes its
; Run entry. With `_?=` the uninstaller runs in place, so ExecWait really waits for it, but it cannot delete itself:
; the hook removes it and the folder afterwards.
!macro NSIS_HOOK_PREINSTALL
  IfFileExists "$LOCALAPPDATA\Ledge\uninstall.exe" 0 ledge_old_app_done
    ; nsExec leaves its exit code on the stack: take it without clobbering $0, which the installer may hold.
    Push $0
    nsExec::Exec 'taskkill /F /IM ledge-overlay.exe'
    Pop $0
    Pop $0
    ExecWait '"$LOCALAPPDATA\Ledge\uninstall.exe" /S _?=$LOCALAPPDATA\Ledge'
    Delete "$LOCALAPPDATA\Ledge\uninstall.exe"
    RMDir "$LOCALAPPDATA\Ledge"
  ledge_old_app_done:
!macroend

; Uninstalling Ledge also removes its launch at login: the Run entry tauri-plugin-autostart writes under the product
; name, the Task Manager's on/off flag beside it, and the marker that says the default was applied, so a later install
; starts with launch at login on again.
!macro NSIS_HOOK_POSTUNINSTALL
  DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "${PRODUCTNAME}"
  DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\Run" "${PRODUCTNAME}"
  Delete "$APPDATA\${BUNDLEID}\autostart-default"
  RMDir "$APPDATA\${BUNDLEID}"
!macroend
