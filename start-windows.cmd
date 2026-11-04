@echo off
setlocal
cd /d "%~dp0"
title PCS Platform (local)

rem ---- 1. Is this the unzipped folder? (Double-clicking inside the zip runs this file alone.) ----
if not exist "tools\serve.mjs" goto notunzipped
if not exist "package.json" goto notunzipped

rem ---- 2. Node.js (18 or newer runs the app; building it needs 20.19 or newer) ----
where node >nul 2>nul
if errorlevel 1 goto nonode
node -e "process.exit(Number(process.versions.node.split('.')[0])>=18?0:1)"
if errorlevel 1 goto oldnode
for /f "delims=" %%v in ('node -v') do set NODEVER=%%v
echo Node.js %NODEVER% found.

rem ---- 3. The zip comes with the app already built (the "dist" folder): nothing to install. ----
rem      A copy without it (e.g. from GitHub) is built here once.
if exist "dist\index.html" goto start
echo The built app is not in this folder, so it is built once now (needs the internet, a few minutes)...
node -e "const [a,b]=process.versions.node.split('.').map(Number);process.exit(a>22||(a===22&&b>=12)||(a===20&&b>=19)?0:1)"
if errorlevel 1 goto oldnode
call npm install --no-audit --no-fund
if errorlevel 1 goto failed
if not exist "public\gridcraft\index.html" call node tools\fetch-gridcraft.mjs
call npm run build
if errorlevel 1 goto failed

:start
echo.
node tools\serve.mjs
if errorlevel 1 goto servefailed
goto end

:notunzipped
echo This file was started on its own, not from the unzipped folder.
echo.
echo  1. Right-click the zip file and choose "Extract All...".
echo     Extract to a short folder that OneDrive does not sync, for example C:\PCS
echo  2. Open the extracted folder, then the "pcs-app" folder inside it.
echo  3. Double-click start-windows.cmd there.
goto end

:nonode
echo Node.js is not installed, or Windows does not see it yet.
echo.
echo  - Install the LTS version from https://nodejs.org/ (keep the default options).
echo  - If you just installed it: close this window, sign out of Windows or restart the PC,
echo    then double-click this file again.
goto end

:oldnode
for /f "delims=" %%v in ('node -v') do set NODEVER=%%v
echo Node.js %NODEVER% is too old for this (it needs 20.19 or newer; 22 or 24 LTS is best).
echo Install the LTS version from https://nodejs.org/, then double-click this file again.
goto end

:failed
echo.
echo Building the app failed. The lines above say why. Common causes:
echo  - No access to the npm registry (company network or proxy): use the zip from the team, which has the app built in.
echo  - The folder is synced by OneDrive or scanned by antivirus: extract the zip to C:\PCS and try again.
echo  - A previous attempt left a broken install: delete the "node_modules" folder and try again.
echo Take a screenshot of this window if you need help.
goto end

:servefailed
echo.
echo The app could not start. The lines above say why.
echo Take a screenshot of this window if you need help.

:end
pause
