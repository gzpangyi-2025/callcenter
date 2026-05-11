@echo off
chcp 65001 >nul
setlocal enabledelayedexpansion

echo =================================================
echo      AI 助手网络连通性诊断工具开始运行 (Windows版)
echo =================================================
echo.

:: ==========================================================
:: 【代理配置说明】
:: 如果您本地使用了代理客户端（例如 Clash, Surge, V2Ray），
:: 且在终端中默认无法连接海外网络，请删除下方两行的 '::' 注释符号，
:: 并将 7890 修改为您的实际代理端口。
:: ==========================================================
:: set https_proxy=http://127.0.0.1:7890
:: set http_proxy=http://127.0.0.1:7890

:: 1. 检查本地网关
echo [1/3] 正在检查本地局域网连通性...
set "GATEWAY="
for /f "tokens=3" %%a in ('route print ^| findstr "\<0.0.0.0\>"') do (
    if not defined GATEWAY set "GATEWAY=%%a"
)

if "%GATEWAY%"=="" (
    echo   -^> ⚠️ 警告：无法自动获取本地网关 IP。
) else (
    ping -n 1 -w 2000 %GATEWAY% >nul 2>nul
    if !errorlevel! equ 0 (
        echo   -^> ✅ 正常：成功连接到本地网关 ^(%GATEWAY%^)。
    ) else (
        echo   -^> ❌ 异常：无法连接本地网关，请检查您的 Wi-Fi 或网线！
        echo      ^(局域网诊断结束，后续网络可能均无法连通^)
    )
)
echo.

:: 2. 检查公网
echo [2/3] 正在检查公网连通性 ^(8.8.8.8^)...
ping -n 1 -w 2000 8.8.8.8 >nul 2>nul
if !errorlevel! equ 0 (
    echo   -^> ✅ 正常：公网连接正常。
) else (
    echo   -^> ❌ 异常：无法连接公网，请检查您的宽带或光猫状态！
    echo      ^(公网诊断结束，后续 API 可能无法连通^)
)
echo.

:: 3. 检查 API 并分析耗时与状态码
echo [3/3] 正在诊断 API 服务端状态...
curl.exe -V >nul 2>nul
if !errorlevel! neq 0 (
    echo   -^> ❌ 异常：您的系统未安装 curl，请使用 Windows 10 ^(1803+^) 或安装 curl 后重试。
    echo -------------------------------------------------
    pause
    exit /b
)

if not "%https_proxy%"=="" (
    echo   ^(检测到您开启了终端代理变量: %https_proxy%^)
)

call :test_api "OpenAI (Codex)" "https://api.openai.com/"
call :test_api "Google Gemini (Antigravity)" "https://generativelanguage.googleapis.com/"
call :test_api "Anthropic Claude (Antigravity)" "https://api.anthropic.com/"

echo -------------------------------------------------
echo 诊断完成！按任意键退出...
echo =================================================
pause >nul
exit /b

:test_api
set "name=%~1"
set "url=%~2"
echo -------------------------------------------------
echo   ^>^> 测试目标: %name%
echo      %url%

:: 使用 curl 获取状态码和时间指标
set "result="
for /f "delims=" %%i in ('curl.exe -s -L -o nul -m 10 -w "%%{http_code}:%%{time_starttransfer}:%%{time_total}" "%url%" 2^>nul') do (
    set "result=%%i"
)

if "%result%"=="" (
    echo   -^> ❌ 异常：请求超时 ^(10s^) 或无法连接到服务器网络。
    goto :eof
)

for /f "tokens=1,2,3 delims=:" %%a in ("%result%") do (
    set "http_code=%%a"
    set "time_ttfb=%%b"
    set "time_total=%%c"
)

if "%http_code%"=="000" (
    echo   -^> ❌ 异常：无法建立连接。可能原因：网络被墙、代理配置失效、或者对方服务器彻底宕机。
    goto :eof
)

:: 利用 PowerShell 处理计算逻辑并彩色输出
powershell -NoProfile -Command "$ttfb=[math]::Round(%time_ttfb% * 1000); $total=[math]::Round(%time_total% * 1000); if ('%http_code%' -eq '429') { Write-Host '  -> ⚠️ 诊断：状态码 %http_code% (Too Many Requests)。' -ForegroundColor Yellow; Write-Host '     原因：对方服务器判定您【请求过频】，开启了限流封控。请停止使用一段时间后再试。' -ForegroundColor Yellow } elseif ('%http_code%'.StartsWith('5')) { Write-Host '  -> ⚠️ 诊断：状态码 %http_code% (Server Error)。' -ForegroundColor Yellow; Write-Host '     原因：服务可达，但对方【服务器内部故障或宕机】，请等待官方修复。' -ForegroundColor Yellow; Write-Host '     耗时指标：首字节响应 '$ttfb'ms，总耗时 '$total'ms。' -ForegroundColor Yellow } elseif ('%http_code%'.StartsWith('2') -or '%http_code%'.StartsWith('3') -or '%http_code%'.StartsWith('4')) { if ($ttfb -gt 3000) { Write-Host '  -> ⚠️ 诊断：状态码 %http_code%，连接成功但【响应极慢】。' -ForegroundColor Yellow; Write-Host '     原因：对方【服务器极其繁忙】，或者您的代理节点严重拥堵。' -ForegroundColor Yellow; Write-Host '     耗时指标：首字节响应 '$ttfb'ms，总耗时 '$total'ms。' -ForegroundColor Yellow } else { Write-Host '  -> ✅ 诊断：状态码 %http_code%，服务【连接正常】。' -ForegroundColor Green; Write-Host '     耗时指标：首字节响应 '$ttfb'ms，总耗时 '$total'ms。' -ForegroundColor Green } } else { Write-Host '  -> ℹ️ 提示：状态码 %http_code%，服务连通。首字节响应 '$ttfb'ms。' -ForegroundColor Cyan }"
goto :eof
