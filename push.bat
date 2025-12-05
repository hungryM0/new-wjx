@echo off
setlocal enabledelayedexpansion

color 07
cls
)

rem --- Enable ANSI escape sequences and define color variables (INFO/ERROR/OK) ---
rem Create ESC variable for ANSI sequences (works on modern Windows 10+ terminals)
for /F "delims=" %%A in ('"prompt $E & for %%B in (1) do rem"') do set "ESC=%%A"
set "C_INFO=%ESC%[34m"    & rem 蓝色 (INFO)
set "C_ERROR=%ESC%[31m"   & rem 红色 (ERROR)
set "C_OK=%ESC%[32m"      & rem 绿色 (OK)
set "C_WARN=%ESC%[33m"    & rem 黄色 (WARN)
set "C_RESET=%ESC%[0m"

rem --- Detect PowerShell executable for reliable colored output when available ---
set "PS_EXE="
if exist "%ProgramFiles%\PowerShell\7\pwsh.exe" set "PS_EXE=%ProgramFiles%\PowerShell\7\pwsh.exe"
if exist "%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe" if not defined PS_EXE set "PS_EXE=%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe"

rem --- Color-print helper labels (use call :print_info "msg") ---
goto :main

:print_info
if defined PS_EXE (
    "%PS_EXE%" -NoProfile -Command "Write-Host '[INFO] ' -NoNewline -ForegroundColor Cyan; Write-Host '%~1' -ForegroundColor Cyan"
) else (
    echo [INFO] %~1
)
exit /b 0

:print_warn
if defined PS_EXE (
    "%PS_EXE%" -NoProfile -Command "Write-Host '[WARN] ' -NoNewline -ForegroundColor Yellow; Write-Host '%~1' -ForegroundColor Yellow"
) else (
    echo [WARN] %~1
)
exit /b 0

:print_error
if defined PS_EXE (
    "%PS_EXE%" -NoProfile -Command "Write-Host '[ERROR] ' -NoNewline -ForegroundColor Red; Write-Host '%~1' -ForegroundColor Red"
) else (
    echo [ERROR] %~1
)
exit /b 1

:print_ok
if defined PS_EXE (
    "%PS_EXE%" -NoProfile -Command "Write-Host '[OK] ' -NoNewline -ForegroundColor Green; Write-Host '%~1' -ForegroundColor Green"
) else (
    echo [OK] %~1
)
exit /b 0

:main

rem Set up git hooks path
set HOOKspath=.githooks

call :print_info "检查 Git 状态..."
echo.
call :print_info "检测远程仓库（跳过缓存）..."
call :ensure_remote
if !ERRORLEVEL! neq 0 (
    call :print_error "无法连接到远端仓库，终止操作"
    pause
    exit /b 1
)
echo.
call :print_info "暂存所有更改..."
git -c color.ui=false add .

if !ERRORLEVEL! neq 0 (
    call :print_error "暂存更改失败"
    pause
    exit /b 1
)

call :print_ok "更改已暂存"
echo.

call :print_info "提交更改..."
git -c color.ui=false commit -m "update"

if !ERRORLEVEL! neq 0 (
    call :print_warn "无可提交的更改或提交失败"
) else (
    call :print_ok "提交成功"
)

set "WORKTREE_STATUS="
for /F "delims=" %%S in ('git status --porcelain') do set "WORKTREE_STATUS=dirty"
if defined WORKTREE_STATUS (
    call :print_warn "检测到未处理的更改，请先手动提交或 stash 后再运行"
    pause
    exit /b 1
)

echo.
set "SSH_URL=git@github.com:hungryM0/new-wjx.git"
set "ORIGIN_URL="
for /F "delims=" %%U in ('git config --get remote.origin.url') do set "ORIGIN_URL=%%U"

rem 尝试非交互方式测试 SSH 认证
ssh -T -o BatchMode=yes git@github.com 2>&1 | findstr /C:"successfully authenticated" >nul 2>&1
if !ERRORLEVEL! EQU 0 (
    call :print_ok "检测到 SSH 可用，尝试将 origin 切换为 SSH 地址: %SSH_URL%"
    git remote set-url origin "%SSH_URL%" 2>nul
    if !ERRORLEVEL! neq 0 (
        call :print_warn "切换 origin 到 SSH 失败，保留现有远程: !ORIGIN_URL!"
    ) else (
        call :print_ok "远程已切换为 SSH: %SSH_URL%"
    )
) else (
    call :print_info "SSH 密钥未或未授权，改用回 HTTPS 模式"
    set "FIXED_URL=https://github.com/hungryM0/new-wjx"
    if defined ORIGIN_URL (
        if /I "!ORIGIN_URL!"=="!FIXED_URL!" (
            call :print_ok "远程已是 HTTPS: !ORIGIN_URL!"
        ) else (
            call :print_info "当前 origin: !ORIGIN_URL!，更新为 HTTPS: !FIXED_URL!"
            git remote set-url origin "!FIXED_URL!" 2>nul
            if !ERRORLEVEL! neq 0 (
                call :print_warn "更新 origin 远程失败，继续保留: !ORIGIN_URL!"
            ) else (
                call :print_ok "远程已切换为 HTTPS"
            )
        )
    ) else (
        call :print_warn "未能读取 origin 远程，跳过 HTTPS 设置"
    )
)
rem --- 拉取重试机制 ---
set "RETRY_COUNT=0"
set "MAX_RETRIES=3"
rem --- 在执行拉取前检测 HTTPS 连接并尝试自动修复 ---
call :print_info "检测远程仓库的 HTTPS 连接..."
set "REMOTE_URL="
for /F "delims=" %%U in ('git config --get remote.origin.url') do set "REMOTE_URL=%%U"
if not defined REMOTE_URL set "REMOTE_URL=https://github.com/hungryM0/new-wjx"

rem 快速检测（短超时）
git -c http.lowSpeedLimit=1000 -c http.lowSpeedTime=20 ls-remote "%REMOTE_URL%" HEAD >nul 2>&1
if !ERRORLEVEL! EQU 0 (
    call :print_ok "HTTPS 连接正常： %REMOTE_URL%"
) else (
    call :print_warn "HTTPS 连接检测失败，尝试设置仓库级 User-Agent 后重试"
    git config --local http.userAgent "Mozilla/5.0 (Windows NT 10.0; Win64; x64)" 2>nul
    if !ERRORLEVEL! neq 0 (
        call :print_warn "无法设置仓库级 User-Agent，跳过自动修复"
    ) else (
        call :print_info "已设置仓库级 User-Agent，重试 HTTPS 检测..."
        git -c http.lowSpeedLimit=1000 -c http.lowSpeedTime=20 ls-remote "%REMOTE_URL%" HEAD >nul 2>&1
        if !ERRORLEVEL! EQU 0 (
            call :print_ok "通过设置 User-Agent 修复了 HTTPS 连接"
        ) else (
            call :print_error "即使设置 User-Agent 也无法连接到远端，请检查网络/代理或改用 SSH"
            pause
            exit /b 1
        )
    )
)
:retry_pull
set /a RETRY_COUNT=!RETRY_COUNT!+1
if !RETRY_COUNT! gtr 1 (
    call :print_warn "重试第 !RETRY_COUNT! 次拉取..."
)

git -c color.ui=false -c http.connectTimeout=10 -c http.lowSpeedLimit=1000 -c http.lowSpeedTime=60 pull --rebase origin main 2>&1

if !ERRORLEVEL! neq 0 (
    if !RETRY_COUNT! lss !MAX_RETRIES! (
        timeout /t 3 /nobreak >nul
        goto retry_pull
    ) else (
        call :print_error "拉取失败，已重试 !MAX_RETRIES! 次，请检查网络或手动解决冲突"
        pause
        exit /b 1
    )
)

call :print_ok "拉取成功"
echo.
call :print_info "推送到远端仓库..."
git -c color.ui=false push origin main

if !ERRORLEVEL! neq 0 (
    call :print_error "推送失败"
    pause
    exit /b 1
)
call :print_ok "推送成功！"
echo.
pause

:ensure_remote
set "CHECK_URL="
for /F "delims=" %%U in ('git config --get remote.origin.url') do set "CHECK_URL=%%U"
if not defined CHECK_URL set "CHECK_URL=https://github.com/hungryM0/new-wjx"
call :print_info "ensure_remote 将使用 URL: %CHECK_URL%"
set "LS_OUT=%TEMP%\git_ls_remote_out.txt"
if exist "%LS_OUT%" del "%LS_OUT%"
git -c http.lowSpeedLimit=1000 -c http.lowSpeedTime=20 ls-remote "%CHECK_URL%" HEAD > "%LS_OUT%" 2>&1
set "LS_EXIT=%ERRORLEVEL%"
if "%LS_EXIT%" NEQ "0" (
    call :print_warn "首次连接失败 (exit=%LS_EXIT%)，尝试备用 HTTPS: https://github.com/hungryM0/new-wjx"
    git -c http.lowSpeedLimit=1000 -c http.lowSpeedTime=20 ls-remote "https://github.com/hungryM0/new-wjx" HEAD >> "%LS_OUT%" 2>&1
    set "LS_EXIT=%ERRORLEVEL%"
    if "%LS_EXIT%" NEQ "0" (
        call :print_error "远端 ls-remote 失败，输出："
        type "%LS_OUT%"
        exit /b 1
    )
)
call :print_ok "远端连接正常 (exit=%LS_EXIT%)"
if exist "%LS_OUT%" del "%LS_OUT%"
exit /b 0