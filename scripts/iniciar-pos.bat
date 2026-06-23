@echo off
setlocal

rem Arranca el servidor local del punto de venta y abre la pantalla en modo
rem kiosko (pantalla completa, sin barra de navegador, impresion silenciosa
rem a la impresora termica predeterminada de Windows).
rem
rem Sugerencia: crea un acceso directo a este archivo en la carpeta de Inicio
rem de Windows (Win+R, escribe "shell:startup", Enter) para que la terminal
rem quede lista sola al encender la maquina.

cd /d "%~dp0\.."

start "Kaan Luum - servidor" /min cmd /c "node server.js"

rem Espera a que el servidor levante antes de abrir el navegador.
timeout /t 3 /nobreak >nul

set CHROME="%ProgramFiles%\Google\Chrome\Application\chrome.exe"
set CHROME_X86="%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe"
set EDGE="%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe"

if exist %CHROME% (
  start "" %CHROME% --kiosk --kiosk-printing --disable-pinch --overscroll-history-navigation=0 "http://localhost:3000"
) else if exist %CHROME_X86% (
  start "" %CHROME_X86% --kiosk --kiosk-printing --disable-pinch --overscroll-history-navigation=0 "http://localhost:3000"
) else if exist %EDGE% (
  start "" %EDGE% --kiosk --kiosk-printing --disable-pinch --overscroll-history-navigation=0 "http://localhost:3000"
) else (
  echo No se encontro Chrome ni Edge en las rutas esperadas.
  echo Abre manualmente http://localhost:3000 en modo kiosko.
  pause
)

endlocal
