@echo off
title TeamHoursTracker - Dev locale

:: Sposta nella cartella del bat
cd /d "%~dp0"

:: Verifica Node.js
where node >nul 2>&1
if %errorlevel% neq 0 (
    echo.
    echo [ERRORE] Node.js non trovato nel PATH.
    echo Scaricalo da: https://nodejs.org
    echo.
    pause
    exit /b 1
)

:: Verifica .env
if not exist ".env" (
    echo.
    echo [ATTENZIONE] File .env non trovato.
    echo.
    echo Crea il file ".env" nella cartella del progetto con:
    echo.
    echo DATABASE_URL=postgresql://...
    echo.
    echo Copia la connection string dal pannello Neon:
    echo dashboard.neon.tech - il tuo progetto - Connection string
    echo.
    pause
    exit /b 1
)

:: Installa dipendenze se il pacchetto Neon manca
if not exist "node_modules\@neondatabase\serverless" (
    echo.
    echo Installazione dipendenze npm...
    npm install
    if %errorlevel% neq 0 (
        echo.
        echo [ERRORE] npm install fallito.
        pause
        exit /b 1
    )
)

:: Avvia il server
echo.
echo Avvio TeamHoursTracker in locale...
echo.
node server.mjs

echo.
echo Il server si e' fermato.
pause
