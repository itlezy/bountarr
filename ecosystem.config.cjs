module.exports = {
  apps: [
    {
      name: 'bountarr',
      script: 'build/index.js',
      env: {
        NODE_ENV: 'production',
        PORT: 3000,
        ORIGIN: 'http://localhost:3000',
      },
      instances: 1,
      exec_mode: 'fork',
      restart_delay: 5000,
      max_restarts: 10,
      kill_timeout: 5000,
      time: true,
    },
  ],
};
