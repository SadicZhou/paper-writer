// PM2 Process Manager 配置文件
// 使用: pm2 start ecosystem.config.cjs

module.exports = {
  apps: [
    {
      name: "paper-writer-api",
      script: "packages/server/dist/main.js",
      cwd: "/opt/paper-writer",
      instances: 1, // 或 "max" 使用所有 CPU
      exec_mode: "fork",
      env: {
        NODE_ENV: "production",
        PORT: 3000,
        DB_HOST: "127.0.0.1",
        DB_PORT: 3306,
        DB_USER: "paper_writer",
        DB_PASS: "your-db-password",
        DB_NAME: "paper_writer",
        REDIS_URL: "redis://127.0.0.1:6379",
        JWT_SECRET: "change-me-to-a-random-string-at-least-32-chars",
        JWT_EXPIRES: "7200",
        INKOS_PROJECT_ROOT: "/opt/paper-writer",
      },
      // 日志
      log_date_format: "YYYY-MM-DD HH:mm:ss",
      error_file: "/var/log/paper-writer/error.log",
      out_file: "/var/log/paper-writer/access.log",
      merge_logs: true,
      // 自动重启
      max_restarts: 10,
      restart_delay: 5000,
      max_memory_restart: "500M",
    },
  ],
};
