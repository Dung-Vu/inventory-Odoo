# Stop and remove containers
Write-Host "Stopping Docker containers..." -ForegroundColor Yellow
docker-compose down

Write-Host "✅ Containers stopped" -ForegroundColor Green
