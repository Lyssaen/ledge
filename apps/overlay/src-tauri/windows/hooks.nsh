; Uninstalling Ledge also removes its launch at login: the Run entry tauri-plugin-autostart writes under the product
; name, the Task Manager's on/off flag beside it, and the marker that says the default was applied, so a later install
; starts with launch at login on again.
!macro NSIS_HOOK_POSTUNINSTALL
  DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "${PRODUCTNAME}"
  DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\Run" "${PRODUCTNAME}"
  Delete "$APPDATA\${BUNDLEID}\autostart-default"
  RMDir "$APPDATA\${BUNDLEID}"
!macroend
