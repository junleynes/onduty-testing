#!/bin/bash
# ============================================================
#  OnDuty — Tenant Management CLI
#  Usage:
#    sudo ./onduty.sh new       — provision a new tenant
#    sudo ./onduty.sh list      — list all tenants
#    sudo ./onduty.sh status    — show running status
#    sudo ./onduty.sh stop      <tenant>  — stop a tenant
#    sudo ./onduty.sh start     <tenant>  — start a tenant
#    sudo ./onduty.sh restart   <tenant>  — restart a tenant
#    sudo ./onduty.sh backup    <tenant>  — backup tenant DB
#    sudo ./onduty.sh backupall           — backup all tenants
#    sudo ./onduty.sh update    <tenant>  — pull latest code & rebuild
#    sudo ./onduty.sh updateall           — update all tenants
#    sudo ./onduty.sh remove    <tenant>  — remove a tenant (DANGER)
#    sudo ./onduty.sh logs      <tenant>  — tail service logs
# ============================================================

set -e

# ── Config ────────────────────────────────────────────────────────────────────
ONDUTY_ROOT="/var/www/onduty"           # root dir for all tenants
REPO_URL="https://github.com/junleynes/onduty-testing.git"
BACKUP_DIR="/var/backups/onduty"
NGINX_DIR="/etc/nginx/sites-available"
NGINX_ENABLED="/etc/nginx/sites-enabled"
NODE_BIN="/usr/bin/node"
NPM_BIN="/usr/bin/npm"
BASE_PORT=9100                          # tenants get ports 9100, 9101, 9102 ...
LOG_DIR="/var/log/onduty"

# Colors
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; BLUE='\033[0;34m'; NC='\033[0m'

info()    { echo -e "${BLUE}[INFO]${NC} $1"; }
success() { echo -e "${GREEN}[OK]${NC} $1"; }
warn()    { echo -e "${YELLOW}[WARN]${NC} $1"; }
error()   { echo -e "${RED}[ERROR]${NC} $1"; exit 1; }
header()  { echo -e "\n${GREEN}========================================${NC}"; echo -e "${GREEN} $1${NC}"; echo -e "${GREEN}========================================${NC}"; }

# ── Helpers ───────────────────────────────────────────────────────────────────

require_root() {
    [[ $EUID -ne 0 ]] && error "Run as root: sudo ./onduty.sh $*"
}

tenant_exists() {
    [[ -d "$ONDUTY_ROOT/$1" ]]
}

get_all_tenants() {
    ls "$ONDUTY_ROOT" 2>/dev/null | grep -v '^$' || true
}

get_port() {
    local tenant=$1
    cat "$ONDUTY_ROOT/$tenant/.port" 2>/dev/null || echo "unknown"
}

next_available_port() {
    local port=$BASE_PORT
    while true; do
        local used=false
        for t in $(get_all_tenants); do
            [[ "$(get_port $t)" == "$port" ]] && used=true && break
        done
        $used || { echo $port; return; }
        ((port++))
    done
}

service_name() { echo "onduty-$1"; }

# ── Commands ──────────────────────────────────────────────────────────────────

cmd_new() {
    header "Provision New OnDuty Tenant"
    
    # Gather info
    read -p "  Tenant slug (e.g. companyname, no spaces): " TENANT
    TENANT=$(echo "$TENANT" | tr '[:upper:]' '[:lower:]' | tr ' ' '-' | tr -cd 'a-z0-9-')
    [[ -z "$TENANT" ]] && error "Tenant name cannot be empty."
    tenant_exists "$TENANT" && error "Tenant '$TENANT' already exists."
    
    read -p "  Company display name: " COMPANY_NAME
    read -p "  Domain or subdomain (e.g. companyname.yourdomain.com): " DOMAIN
    read -p "  Admin email: " ADMIN_EMAIL
    read -p "  Admin initial password (min 8 chars): " ADMIN_PASS
    [[ ${#ADMIN_PASS} -lt 8 ]] && error "Password must be at least 8 characters."
    
    local PORT=$(next_available_port)
    local TENANT_DIR="$ONDUTY_ROOT/$TENANT"
    local SVC=$(service_name $TENANT)
    local SECRET=$(openssl rand -base64 32)
    local API_KEY=$(openssl rand -hex 16)
    
    info "Provisioning '$TENANT' on port $PORT..."
    
    # 1. Create directory and clone
    mkdir -p "$TENANT_DIR" "$LOG_DIR" "$BACKUP_DIR"
    info "Cloning repository..."
    git clone --quiet "$REPO_URL" "$TENANT_DIR"
    
    # 2. Install dependencies
    info "Installing dependencies..."
    cd "$TENANT_DIR"
    npm install --production --quiet 2>&1 | tail -3
    
    # 3. Write .env
    cat > "$TENANT_DIR/.env" << ENV
NEXTAUTH_SECRET=$SECRET
NEXTAUTH_URL=https://$DOMAIN
UPLOAD_DIR=$TENANT_DIR/uploads
NODE_ENV=production
ENV
    
    # 4. Write port file
    echo "$PORT" > "$TENANT_DIR/.port"
    
    # 5. Update package.json start port
    python3 -c "
import json
with open('$TENANT_DIR/package.json') as f: p = json.load(f)
p['scripts']['start'] = 'next start -p $PORT'
with open('$TENANT_DIR/package.json', 'w') as f: json.dump(p, f, indent=2)
"
    
    # 6. Build
    info "Building application..."
    cd "$TENANT_DIR" && npm run build 2>&1 | tail -5
    
    # 7. Initialize DB with admin user
    info "Initializing database..."
    node -e "
const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');
const path = require('path');

const db = new Database('$TENANT_DIR/local.db');
db.pragma('journal_mode = WAL');

// Run schema
const fs = require('fs');
const schema = fs.readFileSync('$TENANT_DIR/src/lib/schema.sql', 'utf8');
db.exec(schema);

// Set admin password
const hash = bcrypt.hashSync('$ADMIN_PASS', 12);
db.prepare(\`
    UPDATE employees SET
        email = ?,
        password = ?,
        firstName = 'Admin',
        lastName = '$COMPANY_NAME'
    WHERE id = 'emp-admin-01'
\`).run('$ADMIN_EMAIL', hash);

// Set API key
db.prepare(\`
    INSERT INTO key_value_store (key, value) VALUES ('import_api_key', ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
\`).run('$API_KEY');

db.close();
console.log('Database initialized.');
" 2>&1
    
    # 8. Create systemd service
    cat > "/etc/systemd/system/$SVC.service" << SVCFILE
[Unit]
Description=OnDuty - $COMPANY_NAME
After=network.target

[Service]
Type=simple
User=www-data
WorkingDirectory=$TENANT_DIR
ExecStart=$NPM_BIN start
Restart=on-failure
RestartSec=10
StandardOutput=append:$LOG_DIR/$TENANT.log
StandardError=append:$LOG_DIR/$TENANT-error.log
Environment=NODE_ENV=production
EnvironmentFile=$TENANT_DIR/.env

[Install]
WantedBy=multi-user.target
SVCFILE

    chown -R www-data:www-data "$TENANT_DIR"
    systemctl daemon-reload
    systemctl enable "$SVC" --quiet
    systemctl start "$SVC"
    
    # 9. Nginx config
    cat > "$NGINX_DIR/onduty-$TENANT" << NGINXCONF
server {
    listen 80;
    server_name $DOMAIN;

    # Redirect HTTP to HTTPS (uncomment after setting up SSL)
    # return 301 https://\$host\$request_uri;

    location / {
        proxy_pass http://127.0.0.1:$PORT;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_cache_bypass \$http_upgrade;
        proxy_read_timeout 60s;
        client_max_body_size 25M;
    }
}

# SSL config (auto-added by certbot)
# server {
#     listen 443 ssl;
#     server_name $DOMAIN;
#     ssl_certificate /etc/letsencrypt/live/$DOMAIN/fullchain.pem;
#     ssl_certificate_key /etc/letsencrypt/live/$DOMAIN/privkey.pem;
#     ...
# }
NGINXCONF

    ln -sf "$NGINX_DIR/onduty-$TENANT" "$NGINX_ENABLED/onduty-$TENANT"
    nginx -t && systemctl reload nginx
    
    # 10. Setup SSL (optional)
    read -p "  Set up SSL with Let's Encrypt now? (y/N): " DO_SSL
    if [[ "$DO_SSL" == "y" || "$DO_SSL" == "Y" ]]; then
        which certbot > /dev/null 2>&1 || apt-get install -y certbot python3-certbot-nginx -qq
        certbot --nginx -d "$DOMAIN" --non-interactive --agree-tos --email "$ADMIN_EMAIL" || warn "SSL setup failed — run manually: certbot --nginx -d $DOMAIN"
    fi
    
    # 11. Setup daily backup cron
    local CRON_FILE="/etc/cron.d/onduty-$TENANT"
    cat > "$CRON_FILE" << CRON
# OnDuty daily backup for $TENANT
0 2 * * * root cp $TENANT_DIR/local.db $BACKUP_DIR/${TENANT}-\$(date +\%Y\%m\%d).db 2>/dev/null
15 2 * * * root find $BACKUP_DIR -name "${TENANT}-*.db" -mtime +30 -delete 2>/dev/null
CRON
    
    header "✅ Tenant '$TENANT' Provisioned Successfully!"
    echo ""
    echo -e "  ${GREEN}Company:${NC}     $COMPANY_NAME"
    echo -e "  ${GREEN}URL:${NC}         http://$DOMAIN"
    echo -e "  ${GREEN}Admin email:${NC} $ADMIN_EMAIL"
    echo -e "  ${GREEN}Port:${NC}        $PORT"
    echo -e "  ${GREEN}API Key:${NC}     $API_KEY"
    echo -e "  ${GREEN}Directory:${NC}   $TENANT_DIR"
    echo -e "  ${GREEN}Service:${NC}     $SVC"
    echo ""
    echo -e "  ${YELLOW}Next steps:${NC}"
    echo "  1. Point DNS: $DOMAIN → this server's IP"
    [[ "$DO_SSL" != "y" ]] && echo "  2. Run SSL: certbot --nginx -d $DOMAIN"
    echo "  3. Login at http://$DOMAIN with $ADMIN_EMAIL"
    echo ""
}

cmd_list() {
    header "OnDuty Tenants"
    local tenants=$(get_all_tenants)
    [[ -z "$tenants" ]] && { echo "  No tenants found."; return; }
    
    printf "  %-20s %-8s %-12s %s\n" "TENANT" "PORT" "STATUS" "DOMAIN"
    printf "  %-20s %-8s %-12s %s\n" "------" "----" "------" "------"
    for t in $tenants; do
        local port=$(get_port $t)
        local svc=$(service_name $t)
        local status="stopped"
        systemctl is-active --quiet "$svc" 2>/dev/null && status="${GREEN}running${NC}"
        local domain=$(grep "server_name" "$NGINX_DIR/onduty-$t" 2>/dev/null | awk '{print $2}' | tr -d ';' || echo "—")
        printf "  %-20s %-8s " "$t" "$port"
        echo -e "${status}       $domain"
    done
    echo ""
}

cmd_status() {
    for t in $(get_all_tenants); do
        systemctl status "$(service_name $t)" --no-pager -l 2>/dev/null | head -5
        echo ""
    done
}

cmd_start()   { require_tenant "$1"; systemctl start   "$(service_name $1)"; success "Started $1"; }
cmd_stop()    { require_tenant "$1"; systemctl stop    "$(service_name $1)"; success "Stopped $1"; }
cmd_restart() { require_tenant "$1"; systemctl restart "$(service_name $1)"; success "Restarted $1"; }
cmd_logs()    { require_tenant "$1"; journalctl -u "$(service_name $1)" -f --no-pager; }

cmd_backup() {
    require_tenant "$1"
    local TENANT=$1
    local STAMP=$(date +%Y%m%d_%H%M%S)
    local FILE="$BACKUP_DIR/${TENANT}-${STAMP}.db"
    mkdir -p "$BACKUP_DIR"
    cp "$ONDUTY_ROOT/$TENANT/local.db" "$FILE"
    success "Backup saved: $FILE"
}

cmd_backupall() {
    for t in $(get_all_tenants); do cmd_backup "$t"; done
}

cmd_update() {
    require_tenant "$1"
    local TENANT=$1
    local TENANT_DIR="$ONDUTY_ROOT/$TENANT"
    local SVC=$(service_name $TENANT)
    
    header "Updating $TENANT"
    cmd_backup "$TENANT"
    info "Pulling latest code..."
    cd "$TENANT_DIR" && git pull --quiet
    info "Installing dependencies..."
    npm install --production --quiet 2>&1 | tail -3
    info "Building..."
    npm run build 2>&1 | tail -5
    chown -R www-data:www-data "$TENANT_DIR"
    systemctl restart "$SVC"
    success "Updated and restarted $TENANT"
}

cmd_updateall() {
    for t in $(get_all_tenants); do cmd_update "$t"; done
}

cmd_remove() {
    require_tenant "$1"
    local TENANT=$1
    warn "This will PERMANENTLY DELETE $TENANT and ALL its data."
    read -p "  Type '$TENANT' to confirm: " CONFIRM
    [[ "$CONFIRM" != "$TENANT" ]] && { info "Cancelled."; exit 0; }
    
    cmd_backup "$TENANT"
    systemctl stop "$(service_name $TENANT)" 2>/dev/null || true
    systemctl disable "$(service_name $TENANT)" 2>/dev/null || true
    rm -f "/etc/systemd/system/$(service_name $TENANT).service"
    rm -f "$NGINX_DIR/onduty-$TENANT" "$NGINX_ENABLED/onduty-$TENANT"
    rm -f "/etc/cron.d/onduty-$TENANT"
    rm -rf "$ONDUTY_ROOT/$TENANT"
    systemctl daemon-reload
    nginx -t && systemctl reload nginx
    success "Tenant $TENANT removed. Backup kept in $BACKUP_DIR."
}

require_tenant() {
    [[ -z "$1" ]] && error "Tenant name required."
    tenant_exists "$1" || error "Tenant '$1' not found. Run: sudo ./onduty.sh list"
}

# ── Entry point ───────────────────────────────────────────────────────────────
require_root "$@"
mkdir -p "$ONDUTY_ROOT" "$BACKUP_DIR" "$LOG_DIR"

case "${1:-help}" in
    new)       cmd_new ;;
    list)      cmd_list ;;
    status)    cmd_status ;;
    start)     cmd_start "$2" ;;
    stop)      cmd_stop "$2" ;;
    restart)   cmd_restart "$2" ;;
    backup)    cmd_backup "$2" ;;
    backupall) cmd_backupall ;;
    update)    cmd_update "$2" ;;
    updateall) cmd_updateall ;;
    remove)    cmd_remove "$2" ;;
    logs)      cmd_logs "$2" ;;
    *)
        echo ""
        echo -e "  ${GREEN}OnDuty Tenant Manager${NC}"
        echo ""
        echo "  Usage: sudo ./onduty.sh <command> [tenant]"
        echo ""
        echo "  Commands:"
        echo "    new              — provision a new tenant (interactive)"
        echo "    list             — list all tenants with status"
        echo "    status           — show systemd status for all"
        echo "    start   <tenant> — start tenant service"
        echo "    stop    <tenant> — stop tenant service"
        echo "    restart <tenant> — restart tenant service"
        echo "    logs    <tenant> — tail service logs"
        echo "    backup  <tenant> — backup tenant database"
        echo "    backupall        — backup all tenants"
        echo "    update  <tenant> — pull latest code and rebuild"
        echo "    updateall        — update all tenants"
        echo "    remove  <tenant> — permanently remove a tenant"
        echo ""
        ;;
esac
