# Paper Writer 部署文档

## 部署文件清单

```text
paper-writer/
├── docker-compose.yml              # Docker 编排 (MySQL + Redis + API + Nginx)
├── Dockerfile.api                  # NestJS API 镜像
├── Dockerfile.nginx                # Nginx + 前端静态文件镜像
├── .env.docker                     # Docker 环境变量模板
├── .dockerignore                   # Docker 构建排除
├── deploy/
│   ├── nginx.conf                  # 传统部署 Nginx 配置
│   ├── nginx-docker.conf           # Docker Nginx 配置
│   ├── ecosystem.config.cjs        # PM2 进程管理配置
│   ├── setup.sh                    # Ubuntu 一键部署脚本
│   └── init.sql                    # MySQL 初始化脚本
└── DEPLOY.md                       # 本文档
```

## 方式一：Docker 部署 (推荐)

### 前置条件

- Docker Engine 24+ / Docker Desktop
- 服务器内存 >= 2GB

### 架构

```
docker compose up -d
        │
        ├── nginx       :80      ← 用户访问入口
        ├── api          :3000    ← NestJS (仅内网)
        ├── mysql        :3306    ← 数据持久化
        └── redis        :6379    ← JWT 会话

Nginx 路由规则：
  /            → Studio 前台 (论文写作)
  /admin/      → Admin Panel 后台
  /api/*       → NestJS API (反向代理)
  /api-docs    → Swagger 文档
```

### 部署命令

```bash
# 1. 克隆代码
cd /opt
git clone <your-repo-url> paper-writer
cd paper-writer

# 2. 配置环境变量
cp .env.docker .env
# 编辑 .env，修改 MYSQL_PASSWORD 和 JWT_SECRET
vim .env

# 3. 构建并启动
docker compose up -d --build

# 4. 查看启动日志
docker compose logs -f

# 5. 验证服务
curl http://localhost/api/v1/auth/login

# 6. 创建管理员
curl -X POST http://localhost/api/v1/auth/setup \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"your-password"}'
```

### 常用管理命令

```bash
# 查看状态
docker compose ps

# 查看日志
docker compose logs -f api       # API 日志
docker compose logs -f nginx     # 访问日志

# 重启服务
docker compose restart api       # 重启 API
docker compose restart nginx     # 重启 Nginx

# 更新代码后重新部署
git pull
docker compose up -d --build     # 重新构建镜像

# 停止服务
docker compose down              # 停止并删除容器

# 停止并删除数据 (危险!)
docker compose down -v           # 删除容器 + 数据卷
```

### 数据备份

```bash
# 备份 MySQL
docker exec paper-writer-mysql mysqldump -u paper_writer -p paper_writer > backup_$(date +%Y%m%d).sql

# 备份论文文件
tar -czf papers_backup_$(date +%Y%m%d).tar.gz papers/
```

### 端口映射

| 容器 | 内部端口 | 外部映射 | 说明 |
|------|---------|---------|------|
| nginx | 80 | `80:80` | 公网入口 |
| api | 3000 | - | 仅容器间通信 |
| mysql | 3306 | `127.0.0.1:3306` | 仅本地调试 |
| redis | 6379 | - | 仅容器间通信 |

---

## 方式二：传统部署 (Ubuntu/Debian)

### 前置条件

- Ubuntu 20.04+ / Debian 11+
- Node.js 22+
- pnpm 9+
- MySQL 8.0+
- Redis 7+
- Nginx 1.18+

### 架构

```
用户 → Nginx (:80/:443)
        ├── /           → packages/studio/dist (静态文件)
        ├── /admin/     → packages/admin-panel/dist (静态文件)
        ├── /api/*      → NestJS :3000 (PM2 管理)
        └── /api-docs   → Swagger 文档

NestJS → MySQL :3306 + Redis :6379
```

### 一键部署

```bash
# 1. 上传代码
git clone <repo> /opt/paper-writer
cd /opt/paper-writer

# 2. 一键部署 (替换 your-domain.com)
bash deploy/setup.sh your-domain.com

# 3. 创建管理员
curl -X POST https://your-domain.com/api/v1/auth/setup \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"your-password"}'
```

### 手动部署

#### 1. 构建

```bash
cd /opt/paper-writer
pnpm install
pnpm build
```

构建产物：
| 包 | 输出目录 | 类型 |
|----|---------|------|
| `packages/studio` | `dist/` | 静态文件 |
| `packages/admin-panel` | `dist/` | 静态文件 |
| `packages/server` | `dist/` | Node.js |

#### 2. MySQL

```sql
CREATE DATABASE paper_writer CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER 'paper_writer'@'localhost' IDENTIFIED BY 'your-password';
GRANT ALL ON paper_writer.* TO 'paper_writer'@'localhost';
FLUSH PRIVILEGES;
```

#### 3. 环境变量

```bash
cp packages/server/.env.example packages/server/.env
```

```env
NODE_ENV=production
PORT=3000
DB_HOST=127.0.0.1
DB_USER=paper_writer
DB_PASS=your-password
DB_NAME=paper_writer
REDIS_URL=redis://127.0.0.1:6379
JWT_SECRET=$(openssl rand -base64 32)
JWT_EXPIRES=7200
INKOS_PROJECT_ROOT=/opt/paper-writer
```

#### 4. Nginx

```bash
cp deploy/nginx.conf /etc/nginx/sites-available/paper-writer
sed -i 's/your-domain.com/实际域名/g' /etc/nginx/sites-available/paper-writer
sed -i 's|/opt/paper-writer|实际路径|g' /etc/nginx/sites-available/paper-writer
ln -sf /etc/nginx/sites-available/paper-writer /etc/nginx/sites-enabled/
rm -f /etc/nginx/sites-enabled/default
nginx -t && systemctl reload nginx
```

#### 5. PM2

```bash
npm install -g pm2
pm2 start deploy/ecosystem.config.cjs
pm2 save
pm2 startup
```

#### 6. SSL (推荐)

```bash
apt install certbot python3-certbot-nginx
certbot --nginx -d your-domain.com
```

### 常用管理命令

```bash
pm2 status                       # 查看进程
pm2 logs paper-writer-api        # 实时日志
pm2 restart paper-writer-api     # 重启
systemctl reload nginx           # 重载 Nginx

# 更新部署
cd /opt/paper-writer && git pull
pnpm install && pnpm build
pm2 restart paper-writer-api
```

---

## 安全清单

- [ ] `JWT_SECRET` 已改为随机字符串
- [ ] 数据库使用专用用户 (非 root)
- [ ] MySQL 端口仅监听 127.0.0.1
- [ ] Redis 设置密码 (生产环境)
- [ ] 防火墙仅开放 80/443
- [ ] 已申请 SSL 证书 (Let's Encrypt)
- [ ] Nginx 配置请求频率限制
- [ ] 定期备份 MySQL + papers/ 目录
