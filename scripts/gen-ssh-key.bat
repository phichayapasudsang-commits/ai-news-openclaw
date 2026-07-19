@echo off
REM Generate ed25519 SSH keypair for GitHub (no passphrase).
mkdir "%USERPROFILE%\.ssh" 2>nul
ssh-keygen -t ed25519 -C "phichayapa.sudsang@gmail.com" -f "%USERPROFILE%\.ssh\id_ed25519" -N ""
echo.
echo === public key ===
type "%USERPROFILE%\.ssh\id_ed25519.pub"
echo === end ===
