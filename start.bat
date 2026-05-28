@echo off
echo Installing dependencies...
call npm install
echo.
echo Starting Game Night server...
start http://localhost:3000/host
node server.js
pause
