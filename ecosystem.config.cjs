module.exports = {
  apps: [
    {
      name: 'bountarr',
      cwd: __dirname,
      script: 'build/index.js',
      node_args: '--env-file-if-exists=.env',
      env: {
        NODE_ENV: 'production',
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
