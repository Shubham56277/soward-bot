// Soward Bot — PM2 Config (use root ecosystem.config.js instead)
// This file is kept for backward compatibility.
module.exports = {
    apps: [
        {
            name: "soward-bot",
            cwd: __dirname,
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
            env: {
                NODE_ENV: "production",
            },
        },
    ],
};
  
