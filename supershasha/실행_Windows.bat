@echo off
chcp 65001 >nul
cd /d %~dp0
where node >nul 2>nul || (echo [!] Node.js를 먼저 설치하세요: https://nodejs.org 에서 LTS 다운로드 후 다시 실행 & pause & exit)
echo === 설치 중 (처음 1회만 시간이 걸립니다) ===
call npm install
echo === 서버 시작! 잠시 후 브라우저가 열립니다 ===
start "" http://localhost:3000
call npm start
