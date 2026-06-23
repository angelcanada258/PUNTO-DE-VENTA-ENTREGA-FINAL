; installer.nsh — Personalización del instalador NSIS de Kaan Luum POS
; Crea accesos directos a las herramientas de respaldo/restauración en el
; Escritorio y en el Menú Inicio, para que el personal no técnico las use con
; un doble clic.

!macro customInstall
  ; Carpeta de herramientas (se incluye vía extraResources -> resources\herramientas)
  CreateShortCut "$DESKTOP\Kaan Luum - Respaldar datos.lnk" "$INSTDIR\resources\herramientas\Respaldar-base-de-datos.bat" "" "$INSTDIR\${APP_EXECUTABLE_FILENAME}" 0
  CreateDirectory "$SMPROGRAMS\Kaan Luum POS"
  CreateShortCut "$SMPROGRAMS\Kaan Luum POS\Respaldar base de datos.lnk" "$INSTDIR\resources\herramientas\Respaldar-base-de-datos.bat"
  CreateShortCut "$SMPROGRAMS\Kaan Luum POS\Restaurar base de datos.lnk" "$INSTDIR\resources\herramientas\Restaurar-base-de-datos.bat"
!macroend

!macro customUnInstall
  Delete "$DESKTOP\Kaan Luum - Respaldar datos.lnk"
  Delete "$SMPROGRAMS\Kaan Luum POS\Respaldar base de datos.lnk"
  Delete "$SMPROGRAMS\Kaan Luum POS\Restaurar base de datos.lnk"
  RMDir "$SMPROGRAMS\Kaan Luum POS"
!macroend
