@echo off
cd /d C:\Users\picha\.openclaw\workspace\ai-news-agent
git add .github\workflows\digest.yml
git commit -m "fix: use dollar-brace secrets.X instead of triple-star placeholder in env vars"
git push origin main
