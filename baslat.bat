@echo off
chcp 65001 >nul
cd /d "%~dp0"
title Ortak Roman
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js bulunamadi. Node.js 20 veya ustunu kurup tekrar deneyin.
  pause
  exit /b 1
)
if not exist .env (
  echo .env dosyasi bulunamadi.
  echo Once .env.example dosyasini .env olarak kopyalayip Supabase bilgilerini ekleyin.
  pause
  exit /b 1
)
if not exist node_modules (
  echo Ilk kurulum yapiliyor...
  call npm install
  if errorlevel 1 pause & exit /b 1
)
call npm run dev
pause