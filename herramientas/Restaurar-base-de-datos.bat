@echo off
chcp 65001 >nul
title Restaurar base de datos - Kaan Luum POS
REM ============================================================================
REM  Restaura una copia de respaldo de la base de datos de ventas.
REM  IMPORTANTE: cierra el sistema Kaan Luum POS antes de continuar.
REM ============================================================================

set "DESTINO=%APPDATA%\kaan-luum-control"
set "RESPALDOS=%USERPROFILE%\Desktop\Respaldos Kaan Luum"

echo.
echo  ============================================================
echo   RESTAURAR BASE DE DATOS - Kaan Luum POS
echo  ============================================================
echo.
echo   ATENCION: esto reemplazara los datos actuales por los de un
echo   respaldo. Primero CIERRA el sistema (boton Salir).
echo.

REM Cerrar la app si esta abierta, para no corromper el archivo.
taskkill /IM "Kaan Luum POS.exe" /F >nul 2>&1

if not exist "%RESPALDOS%" (
  echo  No existe la carpeta de respaldos:
  echo    %RESPALDOS%
  echo.
  pause
  exit /b 1
)

echo  Respaldos disponibles:
echo.
dir /b "%RESPALDOS%\kaan_luum-*.db"
echo.
set /p "NOMBRE=Escribe el nombre EXACTO del respaldo a restaurar (incluye .db): "

if not exist "%RESPALDOS%\%NOMBRE%" (
  echo.
  echo  No se encontro ese archivo. Cancelado.
  echo.
  pause
  exit /b 1
)

REM Borrar la BD actual y sus archivos WAL antes de restaurar.
if exist "%DESTINO%\kaan_luum.db"     del /F /Q "%DESTINO%\kaan_luum.db"
if exist "%DESTINO%\kaan_luum.db-wal" del /F /Q "%DESTINO%\kaan_luum.db-wal"
if exist "%DESTINO%\kaan_luum.db-shm" del /F /Q "%DESTINO%\kaan_luum.db-shm"

copy /Y "%RESPALDOS%\%NOMBRE%" "%DESTINO%\kaan_luum.db" >nul
if exist "%RESPALDOS%\%NOMBRE%-wal" copy /Y "%RESPALDOS%\%NOMBRE%-wal" "%DESTINO%\kaan_luum.db-wal" >nul
if exist "%RESPALDOS%\%NOMBRE%-shm" copy /Y "%RESPALDOS%\%NOMBRE%-shm" "%DESTINO%\kaan_luum.db-shm" >nul

echo.
echo  Base de datos restaurada. Ya puedes volver a abrir Kaan Luum POS.
echo.
pause
