---
name: deployment
description: Deployment setup — Docker, Nginx, PM2, environment variables
metadata:
  type: reference
---

# 部署配置

## 文件清单
- `docker-compose.yml` — 4 容器（mysql, redis, api, nginx）
- `Dockerfile.api` — NestJS 镜像
- `Dockerfile.nginx` — Nginx + 前端静态文件
- `deploy/nginx.conf` — 传统部署 Nginx 配置
- `deploy/nginx-docker.conf` — Docker Nginx 配置
- `deploy/ecosystem.config.cjs` — PM2 配置
- `deploy/setup.sh` — Ubuntu 一键部署脚本
- `deploy/init.sql` — MySQL 初始化
- `.env.docker` — Docker 环境变量模板
- `DEPLOY.md` — 完整部署文档

## Docker 架构
```
docker compose up -d
  ├── nginx :80     — /→Studio, /admin→Admin Panel, /api→NestJS
  ├── api :3000     — NestJS（内网，不暴露端口）
  ├── mysql :3306   — 数据卷 mysql_data
  └── redis :6379   — 数据卷 redis_data
```

## 关键环境变量
```
DB_HOST, DB_PORT, DB_USER, DB_PASS, DB_NAME
REDIS_URL
JWT_SECRET (至少 32 字符随机字符串)
JWT_EXPIRES (默认 14400 = 4h)
INKOS_PROJECT_ROOT (论文文件存储路径)
```

## 当前开发环境
- NestJS: `http://localhost:3000`（PM2 管理）
- Studio: `http://localhost:4567`（Vite dev）
- Admin Panel: `http://localhost:5173`（Vite dev）
- MySQL: `localhost:3306`，root 密码 `rootzjh@`
- Redis: `localhost:6379`

## 启动命令
```bash
# NestJS
cd packages/server && node dist/main.js

# Studio
pnpm --filter @actalk/inkos-studio dev

# Admin Panel
pnpm --filter @actalk/inkos-admin dev
```
