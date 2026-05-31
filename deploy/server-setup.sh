#!/bin/bash
# ============================================================
#  OnDuty Server Setup
#  Run ONCE on a fresh Ubuntu 22.04 / 24.04 server
#  Usage: sudo ./server-setup.sh
# ============================================================

set -e

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; BLUE='\033[0;34m'; NC='\033[0m'
info()    { echo -e "${BLUE}[INFO]${NC} $1"; }
success() { echo -e "${GREEN}[OK]${NC} $1"; }

[[ $EUID -ne 0 ]] && echo "Run as root: sudo ./server-setup.sh" && exit 1

echo -e "${GREEN}"
echo "  ╔═══════════════════════════════════════╗"
echo "  ║     OnDuty Server Setup Script        ║"
echo "  ╚═══════════════════════════════════════╝"
echo -e "${NC}"

# ── 1. System update ──────────────────────────────────────────────────────────
info "Updating system packages..."
apt-get update -qq && apt-get upgrade -y -qq
success "System updated"

# ── 2. Install Node.js 20 LTS ─────────────────────────────────────────────────
info "Installing Node.js 20 LTS..."
if ! command -v node &>/dev/null || [[ "$(node -v | cut -d. -f1 | tr -d 'v')" -lt 20 ]]; then
    curl -fsSL https://deb.nodesource.com/setup_20.x | bash - -qq
    apt-get install -y nodejs -qq
fi
success "Node.js $(node -v) installed"

# ── 3. Install system dependencies ────────────────────────────────────────────
info "Installing system dependencies..."
apt-get install -y -qq \
    nginx \
    certbot \
    python3-certbot-nginx \
    git \
    curl \
    wget \
    unzip \
    build-essential \
    python3 \
    sqlite3 \
    ufw \
    fail2ban
success "Dependencies installed"

# ── 4. Configure firewall ─────────────────────────────────────────────────────
info "Configuring firewall..."
ufw --force reset -qq
ufw default deny incoming -qq
ufw default allow outgoing -qq
ufw allow ssh -qq
ufw allow 80/tcp -qq
ufw allow 443/tcp -qq
ufw --force enable -qq
success "Firewall configured (SSH, HTTP, HTTPS only)"

# ── 5. Configure fail2ban ─────────────────────────────────────────────────────
info "Configuring fail2ban..."
cat > /etc/fail2ban/jail.local << 'F2B'
[DEFAULT]
bantime = 3600
findtime = 600
maxretry = 5

[sshd]
enabled = true
port = ssh
logpath = %(sshd_log)s
backend = %(syslog_backend)s

[nginx-http-auth]
enabled = true
F2B
systemctl enable fail2ban -qq
systemctl restart fail2ban
success "fail2ban configured"

# ── 6. Create directory structure ─────────────────────────────────────────────
info "Creating OnDuty directories..."
mkdir -p /var/www/onduty
mkdir -p /var/backups/onduty
mkdir -p /var/log/onduty
chown -R www-data:www-data /var/www/onduty /var/log/onduty
chmod 755 /var/www/onduty
success "Directories created"

# ── 7. Configure Nginx base ───────────────────────────────────────────────────
info "Configuring Nginx..."
# Remove default site
rm -f /etc/nginx/sites-enabled/default

# Nginx security config
cat > /etc/nginx/conf.d/security.conf << 'NGINX_SEC'
# Hide nginx version
server_tokens off;

# Security headers (applied globally)
add_header X-Frame-Options SAMEORIGIN always;
add_header X-Content-Type-Options nosniff always;
add_header X-XSS-Protection "1; mode=block" always;
add_header Referrer-Policy "strict-origin-when-cross-origin" always;

# Increase upload size for PDF templates and signatures
client_max_body_size 25M;

# Gzip compression
gzip on;
gzip_vary on;
gzip_min_length 1024;
gzip_types text/plain text/css application/json application/javascript text/xml application/xml;
NGINX_SEC

nginx -t && systemctl reload nginx
success "Nginx configured"

# ── 8. Configure automatic security updates ───────────────────────────────────
info "Enabling automatic security updates..."
apt-get install -y -qq unattended-upgrades
cat > /etc/apt/apt.conf.d/20auto-upgrades << 'AUTO'
APT::Periodic::Update-Package-Lists "1";
APT::Periodic::Unattended-Upgrade "1";
APT::Periodic::AutocleanInterval "7";
AUTO
success "Automatic security updates enabled"

# ── 9. Install the onduty.sh CLI ──────────────────────────────────────────────
info "Installing OnDuty CLI..."
cp "$(dirname "$0")/onduty.sh" /usr/local/bin/onduty
chmod +x /usr/local/bin/onduty
success "OnDuty CLI installed → run: sudo onduty new"

# ── 10. Show server info ──────────────────────────────────────────────────────
SERVER_IP=$(curl -s ifconfig.me 2>/dev/null || hostname -I | awk '{print $1}')

echo ""
echo -e "${GREEN}╔═══════════════════════════════════════════════════╗${NC}"
echo -e "${GREEN}║           Server Setup Complete! ✅               ║${NC}"
echo -e "${GREEN}╚═══════════════════════════════════════════════════╝${NC}"
echo ""
echo -e "  Server IP:   ${YELLOW}$SERVER_IP${NC}"
echo ""
echo -e "  ${GREEN}To add your first customer:${NC}"
echo "  sudo onduty new"
echo ""
echo -e "  ${GREEN}Other commands:${NC}"
echo "  sudo onduty list       — list all tenants"
echo "  sudo onduty backup     — backup a tenant"
echo "  sudo onduty updateall  — update all tenants"
echo ""
