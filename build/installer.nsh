; Custom NSIS finish page.
; The default "Run" action on the finish page launches the app via the
; Start Menu shortcut ($launchLink). On Windows 11 (build 26200) shell
; resolution of that shortcut can intermittently fail for per-user
; installations in a custom (cross-drive) directory, producing a spurious
; "Windows cannot find ...X-SSH.lnk" dialog even though the shortcut is
; valid and the app is installed correctly.
;
; To keep the "Run" feature while tracking the real install directory, we
; relaunch the installed executable directly ($appExe / $INSTDIR) instead of
; going through the shortcut.
!macro customFinishPage
  Function StartApp
    ${if} ${isUpdated}
      StrCpy $1 "--updated"
    ${else}
      StrCpy $1 ""
    ${endif}
    ${StdUtils.ExecShellAsUser} $0 "$appExe" "open" "$1"
  FunctionEnd

  !define MUI_FINISHPAGE_RUN
  !define MUI_FINISHPAGE_RUN_FUNCTION "StartApp"
  !insertmacro MUI_PAGE_FINISH
!macroend
