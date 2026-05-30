@echo off
REM ===========================================================================
REM  Mansao Fight - inicia um servidor local e abre o jogo no navegador.
REM  Basta dar DUPLO-CLIQUE neste arquivo. Para parar, feche esta janela preta.
REM ===========================================================================

cd /d "%~dp0"

REM Abre o navegador no endereco do jogo (espera 1s para o servidor subir).
start "" cmd /c "timeout /t 1 >nul & start http://localhost:8000/index.html"

echo ===========================================================
echo   MANSAO FIGHT esta rodando!
echo   Jogo: http://localhost:8000/index.html
echo.
echo   Deixe esta janela ABERTA enquanto joga.
echo   Para parar o servidor, FECHE esta janela.
echo ===========================================================
echo.

REM Sobe o servidor. Tenta "python", depois "py" (Windows Python Launcher).
python -m http.server 8000 2>nul || py -m http.server 8000
