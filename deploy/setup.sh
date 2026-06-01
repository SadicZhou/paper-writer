#!/bin/bash
# Paper Writer — 服务器部署脚本
# 在 Ubuntu/Debian 服务器上以 root 执行: bash deploy/setup.sh

set -e

APP_DIR="/opt/paper-writer"
DOMAIN="${1:-your-domain.com}"

echo "========================================="
echo "  Paper Writer 部署脚本"
echo "  Domain: $DOMAIN"
echo "========================================="

# ── 1. 基础依赖 ──
echo "[1/7] 安装系统依赖..."
apt-get update -qq
apt-get install -y -qq curl git nginx certbot python3-certbot-nginx mysql-server redis-server

# ── 2. Node.js 20+ ──
echo "[2/7] 安装 Node.js..."
if ! command -v node &>/dev/null; then
    curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
    apt-get install -y -qq nodejs
fi
echo "  Node: $(node -v)"
echo "  npm:  $(npm -v)"

# ── 3. pnpm ──
echo "[3/7] 安装 pnpm..."
npm install -g pnpm pm2
echo "  pnpm: $(pnpm -v)"

# ── 4. MySQL 数据库 ──
echo "[4/7] 配置 MySQL..."
systemctl enable mysql && systemctl start mysql

MYSQL_ROOT_PASS=$(openssl rand -base64 16)
mysql -u root <<SQL
ALTER USER 'root'@'localhost' IDENTIFIED WITH mysql_native_password BY '${MYSQL_ROOT_PASS}';
CREATE DATABASE IF NOT EXISTS paper_writer CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER IF NOT EXISTS 'paper_writer'@'localhost' IDENTIFIED BY '$(openssl rand -base64 16)';
GRANT ALL PRIVILEGES ON paper_writer.* TO 'paper_writer'@'localhost';
FLUSH PRIVILEGES;
SQL
echo "  MySQL root password: $MYSQL_ROOT_PASS (请保存!)"
echo "  数据库 paper_writer 已创建"

# ── 5. 应用部署 ──
echo "[5/7] 部署应用代码..."
mkdir -p "$APP_DIR" /var/log/paper-writer
cd "$APP_DIR"

# 从 Git 拉取 (或手动上传后跳过)
if [ -d ".git" ]; then
    git pull origin main
else
    echo "  ⚠ 请将项目代码上传至 $APP_DIR，然后重新运行构建步骤"
fi

# ── 6. 构建 ──
echo "[6/7] 安装依赖并构建..."
pnpm install
pnpm build

# 创建 server .env
cat > packages/server/.env <<ENV
NODE_ENV=production
PORT=3000
DB_HOST=127.0.0.1
DB_PORT=3306
DB_USER=paper_writer
DB_PASS=$(grep "paper_writer" <<<"" 2>/dev/null || echo "请填写数据库密码")
DB_NAME=paper_writer
REDIS_URL=redis://127.0.0.1:6379
JWT_SECRET=$(openssl rand -base64 32)
JWT_EXPIRES=7200
INKOS_PROJECT_ROOT=$APP_DIR
ENV

# ── 7. Nginx + PM2 ──
echo "[7/7] 配置 Nginx 和 PM2..."

# Nginx
cp deploy/nginx.conf /etc/nginx/sites-available/paper-writer
sed -i "s/your-domain.com/$DOMAIN/g" /etc/nginx/sites-available/paper-writer
ln -sf /etc/nginx/sites-available/paper-writer /etc/nginx/sites-enabled/
rm -f /etc/nginx/sites-enabled/default
nginx -t && systemctl reload nginx

# SSL 证书 (可选)
# certbot --nginx -d $DOMAIN --non-interactive --agree-tos -m admin@$DOMAIN

# PM2
pm2 start deploy/ecosystem.config.cjs
pm2 save
pm2 startup systemd -u root --hp /root

echo ""
echo "========================================="
echo "  部署完成!"
echo "========================================="
echo "  前台:    https://$DOMAIN/"
echo "  后台:    https://$DOMAIN/admin/"
echo "  API文档: https://$DOMAIN/api-docs/"
echo ""
echo "  初始管理员:"
echo "    POST https://$DOMAIN/api/auth/setup"
echo "    Body: {\"username\":\"admin\",\"password\":\"your-password\"}"
echo ""
echo "  管理命令:"
echo "    pm2 status              # 查看进程"
echo "    pm2 logs paper-writer   # 查看日志"
echo "    pm2 restart all         # 重启"
echo "    nginx -s reload         # 重载 Nginx"
echo "========================================="
