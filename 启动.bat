@echo off
chcp 65001 >nul
cd /d "%~dp0"
where python >nul 2>nul
if errorlevel 1 (
  echo 需要 Python 3。请先安装并勾选 Add to PATH。
  pause
  exit /b 1
)
python -m pip install -r requirements.txt
if errorlevel 1 (
  echo 依赖安装失败，请检查网络后重试。
  pause
  exit /b 1
)
python tools\build_kinds.py
python server.py
pause
