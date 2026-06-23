@echo off
REM ── Kaan Luum POS – Arranque automático ──────────────────────────────────────
REM Pon un acceso directo a este .bat en shell:startup para que corra al encender.
REM Si instalaste el .exe generado por electron-builder, usa el acceso directo
REM que el instalador pone en el Escritorio en su lugar.

cd /d "%~dp0.."
start "" "Kaan Luum POS.exe"
