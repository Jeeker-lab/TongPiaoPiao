@echo off
chcp 65001 >nul
where node >nul 2>nul
if errorlevel 1 (
  echo 未检测到 Node.js，请先安装 Node.js 20 或更高版本。
  pause
  exit /b 1
)
if not exist node_modules (
  if exist "%USERPROFILE%\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\node_modules" (
    mklink /J node_modules "%USERPROFILE%\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\node_modules" >nul
  )
)
if not exist node_modules\@oai\artifact-tool (
  echo 未检测到 Excel 生成组件，请在 Codex 工作区中运行本软件。
  pause
  exit /b 1
)
start "统票票" http://127.0.0.1:4173
node server.mjs
pause
