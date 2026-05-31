#!/bin/bash
# ============================================================
#  OnDuty — New Customer Deployment Script
#  Usage: sudo ./new-customer.sh <company-slug> <port> <domain>
#  Example: sudo ./new-customer.sh acme-corp 9001 acme.onduty.ph
# ============================================================

set -e

# ── Colors ───────────────────────────────────────────────────
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
BLUE='\033[0;34m'; BOLD='\033[1m'; NC='\033[0m'

info()    { echo -e "${BLUE}[INFO]${NC} $1"; }
success() { echo -e "${GREEN}[OK]${NC}   $1"; }
warn()    { echo -e "${YELLOW}[WARN]${NC} $1"; }
error()   { echo -e "${RED}[ERROR]${NC} $1"; exit 1; }
header()  { echo -e "\n${BOLD}$1${NC}\n$(printf '=%.0s' {1..50})"; }

# ── Validate inputs ──────────────────────────────────────────
[[ $EUID -ne 0 ]] && error "Run as root: sudo $0 $*"
[[ -z "$1" ]] && error "Usage: $0 <company-slug> <port> <domain>\n  Example: $0 acme-corp 9001 acme.onduty.ph"
[[ -z "$2" ]] && error "Port required. Example: $0 acme-corp 9001 acme.onduty.ph"
[[ -z "$3" ]] && error "Domain required. Example: $0 acme-corp 9001 acme.onduty.ph"

SLUG="$1"        # e.g. acme-corp
PORT="$2"        # e.g. 9001
DOMAIN="$3"      # e.g. acme.onduty.ph

# Validate slug (lowercase letters, numbers, hyphens only)
[[ ! "$SLUG" =~ ^[a-z0-9-]+$ ]] && error "Slug must be lowercase letters, numbers, hyphens only"
# Validate port range
[[ "$PORT" -lt 3000 || "$PORT" -gt 65535 ]] && error "Port must be between 3000 and 65535"

# ── Directories ───────────────────────────────────────────────
ONDUTY_HOME="/var/www/onduty"
REPO_DIR="$ONDUTY_HOME/onduty-source"      # Shared source code
CUSTOMER_DIR="$ONDUTY_HOME/customers/$SLUG" # Per-customer deployment
BACKUP_DIR="/var/backups/onduty/$SLUG"
LOG_DIR="/var/log/onduty/$SLUG"
SERVICE_NAME="onduty-$SLUG"

header "🚀 OnDuty — Deploying: $SLUG"
info "Domain : $DOMAIN"
info "Port   : $PORT"
info "Dir    : $CUSTOMER_DIR"

# ── Check port availability ───────────────────────────────────
if ss -tlnp | grep -q ":$PORT "; then
    error "Port $PORT is already in use. Choose a different port."
fi

# ── Check slug not already deployed ──────────────────────────
[[ -d "$CUSTOMER_DIR" ]] && error "Customer '$SLUG' already exists at $CUSTOMER_DIR"

# ── Ensure source repo exists ─────────────────────────────────
header "[1/7] Checking source code"
if [[ ! -d "$REPO_DIR" ]]; then
    info "Cloning OnDuty repository..."
    mkdir -p "$ONDUTY_HOME"
    git clone https://github.com/junleynes/onduty-testing.git "$REPO_DIR"
    success "Repository cloned"
else
    info "Pulling latest source..."
    cd "$REPO_DIR" && git pull origin main
    success "Source up to date"
fi

# ── Create customer directory ─────────────────────────────────
header "[2/7] Setting up customer directory"
mkdir -p "$CUSTOMER_DIR"
mkdir -p "$BACKUP_DIR"
mkdir -p "$LOG_DIR"
mkdir -p "$CUSTOMER_DIR/uploads/avatars"
mkdir -p "$CUSTOMER_DIR/uploads/signatures"
mkdir -p "$CUSTOMER_DIR/uploads/templates"
mkdir -p "$CUSTOMER_DIR/uploads/pdfs"
mkdir -p "$CUSTOMER_DIR/uploads/screenshots"

# Copy source (symlink node_modules and .next from source to save disk)
cp -r "$REPO_DIR/src"              "$CUSTOMER_DIR/"
cp -r "$REPO_DIR/public"           "$CUSTOMER_DIR/"
cp    "$REPO_DIR/package.json"     "$CUSTOMER_DIR/"
cp    "$REPO_DIR/package-lock.json" "$CUSTOMER_DIR/" 2>/dev/null || true
cp    "$REPO_DIR/next.config.ts"   "$CUSTOMER_DIR/"
cp    "$REPO_DIR/tsconfig.json"    "$CUSTOMER_DIR/"
cp    "$REPO_DIR/tailwind.config.ts" "$CUSTOMER_DIR/"
cp    "$REPO_DIR/postcss.config.mjs" "$CUSTOMER_DIR/"
cp    "$REPO_DIR/components.json"  "$CUSTOMER_DIR/"
success "Customer directory created"

# ── Generate unique secrets ───────────────────────────────────
header "[3/7] Generating security credentials"
NEXTAUTH_SECRET=$(openssl rand -base64 32)
ADMIN_PASSWORD=$(openssl rand -base64 12 | tr -d '=/+' | head -c 16)
API_KEY=$(openssl rand -hex 16)

# Create .env file
cat > "$CUSTOMER_DIR/.env" << ENV
# OnDuty — $SLUG
# Generated: $(date)
NEXTAUTH_SECRET=$NEXTAUTH_SECRET
NEXTAUTH_URL=https://$DOMAIN
UPLOAD_DIR=$CUSTOMER_DIR/uploads
DB_PATH=$CUSTOMER_DIR/local.db
ONDUTY_ADMIN_PASSWORD=$ADMIN_PASSWORD
PORT=$PORT
NODE_ENV=production
ENV

success "Security credentials generated"
info "Admin password: $ADMIN_PASSWORD (save this!)"
info "API key: $API_KEY"

# ── Install dependencies & build ──────────────────────────────
header "[4/7] Installing dependencies & building"
cd "$CUSTOMER_DIR"

# Share node_modules from source if same version (saves disk space & time)
if [[ -d "$REPO_DIR/node_modules" ]]; then
    ln -s "$REPO_DIR/node_modules" "$CUSTOMER_DIR/node_modules"
    info "Using shared node_modules"
else
    npm install --production 2>&1 | tail -5
fi

# Build with customer-specific env
PORT=$PORT npm run build 2>&1 | tail -10
success "Build complete"

# ── Initialize database ───────────────────────────────────────
header "[5/7] Initializing database"
# The app initializes the DB on first run via initializeDatabase()
# We just set the correct DB path via env
info "Database will be initialized on first start at: $CUSTOMER_DIR/local.db"

# Update admin password in DB after first start (done via post-start script)
cat > "$CUSTOMER_DIR/set-admin-password.js" << NODEEOF
// Run once after first start to set the admin password
const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');
const path = require('path');

const dbPath = process.env.DB_PATH || path.join(process.cwd(), 'local.db');
const password = process.env.ONDUTY_ADMIN_PASSWORD || 'P@ssw0rd';

setTimeout(async () => {
    try {
        const db = new Database(dbPath);
        const hashed = await bcrypt.hash(password, 12);
        // Set for both email variants
        db.prepare("UPDATE employees SET password = ? WHERE email = 'admin@onduty.local'").run(hashed);
        // Also store the API key
        const apiKey = process.env.ONDUTY_API_KEY || 'onduty_secret_key';
        db.prepare("INSERT INTO key_value_store (key, value) VALUES ('import_api_key', ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(apiKey);
        console.log('Admin password and API key set successfully');
        db.close();
    } catch (e) {
        console.error('Failed to set admin password:', e.message);
    }
}, 5000); // Wait 5s for DB to initialize
NODEEOF
success "Database setup ready"

# ── Create systemd service ────────────────────────────────────
header "[6/7] Creating systemd service"
cat > "/etc/systemd/system/$SERVICE_NAME.service" << SYSTEMD
[Unit]
Description=OnDuty — $SLUG ($DOMAIN)
After=network.target

[Service]
Type=simple
User=www-data
WorkingDirectory=$CUSTOMER_DIR
EnvironmentFile=$CUSTOMER_DIR/.env
ExecStart=/usr/bin/node node_modules/.bin/next start -p $PORT
ExecStartPost=/usr/bin/node $CUSTOMER_DIR/set-admin-password.js
Restart=always
RestartSec=10
StandardOutput=append:$LOG_DIR/app.log
StandardError=append:$LOG_DIR/error.log

# Security hardening
NoNewPrivileges=true
ProtectSystem=strict
ReadWritePaths=$CUSTOMER_DIR $BACKUP_DIR $LOG_DIR

[Install]
WantedBy=multi-user.target
SYSTEMD

systemctl daemon-reload
systemctl enable "$SERVICE_NAME"
systemctl start "$SERVICE_NAME"
success "Service $SERVICE_NAME started"

# ── Configure Nginx ───────────────────────────────────────────
header "[7/7] Configuring Nginx"
cat > "/etc/nginx/sites-available/$SLUG" << NGINX
# OnDuty — $SLUG ($DOMAIN)
server {
    listen 80;
    server_name $DOMAIN;

    # Redirect HTTP to HTTPS
    return 301 https://\$host\$request_uri;
}

server {
    listen 443 ssl;
    server_name $DOMAIN;

    # SSL — update these paths after running certbot
    # ssl_certificate     /etc/letsencrypt/live/$DOMAIN/fullchain.pem;
    # ssl_certificate_key /etc/letsencrypt/live/$DOMAIN/privkey.pem;
    # include             /etc/letsencrypt/options-ssl-nginx.conf;

    # Proxy to Next.js
    location / {
        proxy_pass         http://127.0.0.1:$PORT;
        proxy_http_version 1.1;
        proxy_set_header   Upgrade \$http_upgrade;
        proxy_set_header   Connection 'upgrade';
        proxy_set_header   Host \$host;
        proxy_set_header   X-Real-IP \$remote_addr;
        proxy_set_header   X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header   X-Forwarded-Proto \$scheme;
        proxy_cache_bypass \$http_upgrade;
        proxy_read_timeout 60s;
        client_max_body_size 25M;
    }

    # Cache static assets
    location /_next/static {
        proxy_pass http://127.0.0.1:$PORT;
        add_header Cache-Control "public, max-age=31536000, immutable";
    }

    # Security headers
    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header Referrer-Policy "strict-origin-when-cross-origin" always;
}
NGINX

ln -sf "/etc/nginx/sites-available/$SLUG" "/etc/nginx/sites-enabled/$SLUG"
nginx -t && systemctl reload nginx
success "Nginx configured for $DOMAIN"

# ── Done! ─────────────────────────────────────────────────────
header "✅ Deployment Complete!"
echo ""
echo -e "${BOLD}Customer:${NC}       $SLUG"
echo -e "${BOLD}Domain:${NC}         https://$DOMAIN"
echo -e "${BOLD}Port:${NC}           $PORT"
echo -e "${BOLD}Directory:${NC}      $CUSTOMER_DIR"
echo -e "${BOLD}Logs:${NC}           $LOG_DIR"
echo -e "${BOLD}DB:${NC}             $CUSTOMER_DIR/local.db"
echo -e "${BOLD}Uploads:${NC}        $CUSTOMER_DIR/uploads/"
echo ""
echo -e "${BOLD}Login credentials:${NC}"
echo -e "  Email:    admin@onduty.local"
echo -e "  Password: ${GREEN}$ADMIN_PASSWORD${NC}  ← SAVE THIS!"
echo -e "  API Key:  ${GREEN}$API_KEY${NC}"
echo ""
echo -e "${YELLOW}Next steps:${NC}"
echo -e "  1. Set up SSL:  sudo certbot --nginx -d $DOMAIN"
echo -e "  2. Test login:  https://$DOMAIN/login"
echo -e "  3. View logs:   sudo journalctl -u $SERVICE_NAME -f"
echo ""
