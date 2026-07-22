module.exports = {
    apps: [
        {
            name: "api",
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
        },
    ],
};
  