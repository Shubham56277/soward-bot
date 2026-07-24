Write-Output 'Installing dependencies...'
yarn install --frozen-lockfile

Write-Output 'Building bot...'
yarn workspace bot build

$BOT_DIR = Join-Path $PSScriptRoot "..\apps\bot"

if (Get-Command pm2 -ErrorAction SilentlyContinue) {
  Write-Output 'Starting bot with pm2...'
  $ecosystemPath = Join-Path $BOT_DIR "ecosystem.config.js"
  pm2 startOrReload $ecosystemPath
  pm2 save
} else {
  Write-Output 'pm2 not found, starting directly...'
  $indexPath = Join-Path $BOT_DIR "dist\index.js"
  node $indexPath
}