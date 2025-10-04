@echo off
REM Safety Backup Script for ROS-5.0 (Windows)
REM Run this before making major changes

echo 🛡️ Creating safety backup...

REM Create timestamped backup branch
for /f "tokens=2 delims==" %%a in ('wmic OS Get localdatetime /value') do set "dt=%%a"
set "YY=%dt:~2,2%" & set "YYYY=%dt:~0,4%" & set "MM=%dt:~4,2%" & set "DD=%dt:~6,2%"
set "HH=%dt:~8,2%" & set "Min=%dt:~10,2%" & set "Sec=%dt:~12,2%"
set "timestamp=%YYYY%%MM%%DD%_%HH%%Min%%Sec%"

set "BACKUP_BRANCH=backup-%timestamp%"

REM Create and push backup branch
git checkout -b "%BACKUP_BRANCH%"
git push origin "%BACKUP_BRANCH%"

echo ✅ Safety backup created: %BACKUP_BRANCH%
echo 📍 Current working state saved to: https://github.com/mronis86/ROS-5.0/tree/%BACKUP_BRANCH%

REM Return to master
git checkout master

echo 🔄 Returned to master branch
echo 💡 To restore this backup later: git checkout %BACKUP_BRANCH%
pause
