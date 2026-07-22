module.exports = {
    apps: [
        {
            name: "bot",
            cwd: __dirname,
            script: "dist/index.js",
            exec_mode: "fork",
            instances: 1,
            autorestart: true,
            watch: false,
            max_memory_restart: "7G",
            env: {
                NODE_ENV: "production",
            },
            env_production: {
                NODE_ENV: "production",
            },
        },
    ],
};
  
