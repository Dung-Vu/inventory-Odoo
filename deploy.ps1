# Docker Management Scripts

# Build and start
Write-Host "Building and starting Docker container..." -ForegroundColor Green
docker-compose up -d --build

# Wait for container to be healthy
Write-Host "Waiting for container to be healthy..." -ForegroundColor Yellow
Start-Sleep -Seconds 5

# Check status
docker-compose ps

# Show logs
Write-Host "`nShowing recent logs:" -ForegroundColor Green
docker-compose logs --tail=50

Write-Host "`n✅ Deployment complete!" -ForegroundColor Green
Write-Host "Access app at: http://localhost:5003" -ForegroundColor Cyan
Write-Host "Health check: http://localhost:5003/health" -ForegroundColor Cyan
