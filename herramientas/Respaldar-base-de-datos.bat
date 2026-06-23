@echo off
chcp 65001 >nul
title Respaldar base de datos - Kaan Luum POS
REM ============================================================================
REM  Copia la base de datos de ventas a una carpeta de respaldos en el Escritorio.
REM  Solo da doble clic en este archivo. No necesitas saber de tecnologia.
REM ============================================================================

set "ORIGEN=%APPDATA%\kaan-luum-control"
set "DESTINO=%USERPROFILE%\Desktop\Respaldos Kaan Luum"

if not exist "%ORIGEN%\kaan_luum.db" (
  echo.
  echo  No se encontro la base de datos en:
  echo    %ORIGEN%
  echo.
  echo  Asegurate de haber abierto el sistema al menos una vez.
  echo.
  pause
  exit /b 1
)

if not exist "%DESTINO%" mkdir "%DESTINO%"

REM Fecha y hora para el nombre del respaldo (formato AAAA-MM-DD_HH-MM)
for /f %%I in ('powershell -NoProfile -Command "Get-Date -Format yyyy-MM-dd_HH-mm"') do set "SELLO=%%I"

set "ARCHIVO=%DESTINO%\kaan_luum-%SELLO%.db"

copy /Y "%ORIGEN%\kaan_luum.db" "%ARCHIVO%" >nul
if exist "%ORIGEN%\kaan_luum.db-wal" copy /Y "%ORIGEN%\kaan_luum.db-wal" "%ARCHIVO%-wal" >nul
if exist "%ORIGEN%\kaan_luum.db-shm" copy /Y "%ORIGEN%\kaan_luum.db-shm" "%ARCHIVO%-shm" >nul

echo.
echo  Respaldo creado correctamente:
echo.
echo    %ARCHIVO%
echo.
echo  Guarda una copia en una USB o en la nube por seguridad.
echo.
pause
