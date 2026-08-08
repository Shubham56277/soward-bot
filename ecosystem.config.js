// Soward Bot — PM2 Production Configuration
// Usage: pm2 start ecosystem.config.js
module.exports = {
  apps: [
    {
      name: "soward-bot",
      cwd: "./apps/bot",
      script: "dist/index.js",
      exec_mode: "fork",
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: "4G",
      restart_delay: 5000,
      max_restarts: 10,
      min_uptime: "10s",
      kill_timeout: 8000,
      listen_timeout: 10000,
      env: {
        NODE_ENV: "production",
      },
      output: "./logs/bot-out.log",
      error: "./logs/bot-err.log",
      log_date_format: "YYYY-MM-DD HH:mm:ss Z",
      merge_logs: true,
    },
  ],
};
