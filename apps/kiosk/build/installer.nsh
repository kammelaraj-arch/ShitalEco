; Custom NSIS hooks for Shital Kiosk
; Force-kill the running app (and any leftover Electron child processes)
; before files are written, so the "cannot be closed" lock error never fires.

!macro customInit
  ; Try to close the app gracefully first, then force-kill if it's still up.
  ; Both names are guarded with /SILENT so the user doesn't see the kill dialog.
  nsExec::ExecToStack 'taskkill /F /IM "Shital Kiosk.exe" /T'
  Pop $0
  nsExec::ExecToStack 'taskkill /F /IM "electron.exe" /T'
  Pop $0
  Sleep 800   ; let file handles release before NSIS starts copying
!macroend

!macro customUnInit
  nsExec::ExecToStack 'taskkill /F /IM "Shital Kiosk.exe" /T'
  Pop $0
!macroend
