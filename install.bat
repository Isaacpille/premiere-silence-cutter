@echo off
setlocal
set "DEST=%APPDATA%\Adobe\CEP\extensions\SilenceCutter"

echo Installation de Silence Cutter dans :
echo   %DEST%
echo.

if exist "%DEST%" rmdir /s /q "%DEST%"
xcopy "%~dp0SilenceCutter" "%DEST%\" /E /I /Y /Q >nul
if errorlevel 1 (
  echo ERREUR pendant la copie des fichiers.
  pause
  exit /b 1
)

REM Autorise les extensions non signees (obligatoire pour un panneau fait maison)
for %%v in (9 10 11 12 13 14) do (
  reg add "HKCU\Software\Adobe\CSXS.%%v" /v PlayerDebugMode /t REG_SZ /d 1 /f >nul
)

echo.
echo OK ! Ferme completement Premiere Pro, relance-le, puis :
echo   Fenetre ^> Extensions ^> Silence Cutter
echo.
pause
