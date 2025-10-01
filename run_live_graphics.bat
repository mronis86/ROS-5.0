@echo off
echo Installing dependencies...
pip install -r requirements.txt

echo Starting Live Graphics Generator...
python live_graphics_generator.py

pause
