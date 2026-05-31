@echo off
REM ===========================================================================
REM  Mansao Fight - inicia um servidor local e abre o jogo no navegador.
REM  Basta dar DUPLO-CLIQUE neste arquivo. Para parar, feche esta janela preta.
REM ===========================================================================

cd /d "%~dp0"

echo ===========================================================
echo   MANSAO FIGHT - Iniciando servidor...
echo ===========================================================
echo.

REM --- Tenta Python ---
python --version >nul 2>&1
if %errorlevel% == 0 (
    echo Usando Python para o servidor...
    start "" cmd /c "timeout /t 1 >nul & start http://localhost:8000/index.html"
    echo Jogo: http://localhost:8000/index.html
    echo Deixe esta janela ABERTA enquanto joga.
    echo Para parar o servidor, FECHE esta janela.
    echo.
    python -m http.server 8000
    goto :fim
)

py --version >nul 2>&1
if %errorlevel% == 0 (
    echo Usando Python (py) para o servidor...
    start "" cmd /c "timeout /t 1 >nul & start http://localhost:8000/index.html"
    echo Jogo: http://localhost:8000/index.html
    echo Deixe esta janela ABERTA enquanto joga.
    echo Para parar o servidor, FECHE esta janela.
    echo.
    py -m http.server 8000
    goto :fim
)

REM --- Tenta Node.js (npx serve) ---
node --version >nul 2>&1
if %errorlevel% == 0 (
    echo Usando Node.js para o servidor...
    start "" cmd /c "timeout /t 2 >nul & start http://localhost:8000/index.html"
    echo Jogo: http://localhost:8000/index.html
    echo Deixe esta janela ABERTA enquanto joga.
    echo Para parar o servidor, FECHE esta janela.
    echo.
    npx --yes serve -p 8000 -s .
    goto :fim
)

REM --- Tenta PowerShell como ultimo recurso ---
echo Usando PowerShell para o servidor...
start "" cmd /c "timeout /t 2 >nul & start http://localhost:8000/index.html"
echo Jogo: http://localhost:8000/index.html
echo Deixe esta janela ABERTA enquanto joga.
echo Para parar o servidor, FECHE esta janela.
echo.
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$listener = New-Object System.Net.HttpListener; $listener.Prefixes.Add('http://localhost:8000/'); $listener.Start(); Write-Host 'Servidor rodando em http://localhost:8000/'; while ($listener.IsListening) { $ctx = $listener.GetContext(); $req = $ctx.Request; $res = $ctx.Response; $path = $req.Url.LocalPath.TrimStart('/'); if ($path -eq '' -or $path -eq '/') { $path = 'index.html' }; $file = Join-Path (Get-Location) $path; if (Test-Path $file -PathType Leaf) { $bytes = [System.IO.File]::ReadAllBytes($file); $res.ContentLength64 = $bytes.Length; $ext = [System.IO.Path]::GetExtension($file); $mime = @{'.html'='text/html';'.js'='application/javascript';'.css'='text/css';'.png'='image/png';'.jpg'='image/jpeg';'.gif'='image/gif';'.wav'='audio/wav';'.mp3'='audio/mpeg';'.json'='application/json'}.Item($ext); if ($mime) { $res.ContentType = $mime }; $res.OutputStream.Write($bytes, 0, $bytes.Length) } else { $res.StatusCode = 404 }; $res.OutputStream.Close() }"
if %errorlevel% neq 0 goto :erro
goto :fim

:erro
echo.
echo ===========================================================
echo   ERRO: Nenhuma forma de iniciar o servidor foi encontrada!
echo.
echo   Instale uma das opcoes abaixo e tente novamente:
echo.
echo   1. Python (recomendado):
echo      https://www.python.org/downloads/
echo      Marque "Add Python to PATH" durante a instalacao!
echo.
echo   2. Node.js:
echo      https://nodejs.org/
echo ===========================================================
echo.
pause
goto :fim

:fim
