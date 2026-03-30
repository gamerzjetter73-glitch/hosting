// ── PM2 Ecosystem Config ──
// Install PM2:  npm install -g pm2
// Start:        pm2 start ecosystem.config.js
// Auto-restart on reboot: pm2 startup && pm2 save
// Logs:         pm2 logs legitclub
// Monitor:      pm2 monit

module.exports = {
  apps: [
    {
      name:             'legitclub',
      script:           'server.js',
      instances:        1,           // increase to 'max' if using a multi-core VPS (requires sticky sessions)
      exec_mode:        'fork',      // use 'cluster' only if you add Redis for Socket.io shared state
      watch:            false,
      max_memory_restart: '512M',

      // Restart strategy
      restart_delay:    3000,        // wait 3s before restart
      max_restarts:     10,
      min_uptime:       '10s',

      // Logging
      out_file:   './logs/pm2-out.log',
      error_file: './logs/pm2-err.log',
      merge_logs: true,
      log_date_format: 'YYYY-MM-DD HH:mm:ss',

      // Environment
      env: {
        NODE_ENV: 'development',
      },
      env_production: {
        NODE_ENV: 'production',
      },
    },
  ],
};
