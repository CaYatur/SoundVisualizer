!macro customInstall
  DetailPrint "Registering CAYADEV Visualizer Dynamic Lighting identity..."
  nsExec::ExecToLog 'powershell.exe -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "$INSTDIR\resources\identity\install-identity.ps1" -ExternalLocation "$INSTDIR" -CertificateStore LocalMachine'
  Pop $0
  ${If} $0 != 0
    DetailPrint "Dynamic Lighting identity registration returned code $0. The application will offer repair on first use."
  ${EndIf}
!macroend

!macro customUnInstall
  DetailPrint "Removing CAYADEV Visualizer Dynamic Lighting identity..."
  nsExec::ExecToLog 'powershell.exe -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "$INSTDIR\resources\identity\uninstall-identity.ps1"'
  Pop $0
!macroend
