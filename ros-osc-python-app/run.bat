@echo off
cd /d "%~dp0"
python -c "import tkinter; import requests; import socketio" 2>nul || (
  echo Installing dependencies...
  pip install -r requirements.txt
)
python app.py
pause
