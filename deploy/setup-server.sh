#!/bin/bash
# ============================================================
#  OnDuty — One-time Server Setup Script
#  Run this ONCE on a fresh server before deploying customers
#  Usage: sudo ./setup-server.sh
# ============================================================

set -e
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
BLUE='\033[0;34m'; BOLD='\033[1m'; NC='\033[0m'

[[ $EUID -ne 0 ]] && echo -e "${RED}Run as root: sudo $0${NC}" && exit 1

header() { echo -e "\n${BOLD}$1${NC}\n$(printf '=%.0s' {1..50})"; }
success() { echo -e "${GREEN}[OK]${NC}   $1"; }
info()    { echo -e "${BLUE}[INFO]${NC} $1"; }

header "OnDuty Server Setup"

# ── 1. Update system ─────────────────────────────────────────
header "[1/6] Updating system"
apt-get update -qq && apt-get upgrade -y -qq
success "System updated"

# ── 2. Install Node.js 20 LTS ────────────────────────────────
header "[2/6] Installing Node.js 20 LTS"
if ! command -v node &>/dev/null || [[ $(node -v | cut -d. -f1 | tr -d 'v') -lt 20 ]]; then
    curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
    apt-get install -y nodejs
fi
node -v && npm -v
success "Node.js installed: $(node -v)"

# ── 3. Install Nginx & Certbot ────────────────────────────────
header "[3/6] Installing Nginx & Certbot"
apt-get install -y nginx certbot python3-certbot-nginx
systemctl enable nginx
systemctl start nginx
success "Nginx installed"

# ── 4. Install build tools (for better-sqlite3) ───────────────
header "[4/6] Installing build tools"
apt-get install -y build-essential python3 git
success "Build tools installed"

# ── 5. Create directory structure ────────────────────────────
header "[5/6] Creating directory structure"
mkdir -p /var/www/onduty/customers
mkdir -p /var/backups/onduty
mkdir -p /var/log/onduty
chown -R www-data:www-data /var/www/onduty
chown -R www-data:www-data /var/backups/onduty
chown -R www-data:www-data /var/log/onduty
success "Directories created"

# ── 6. Clone source repository ────────────────────────────────
header "[6/6] Cloning OnDuty source"
if [[ ! -d "/var/www/onduty/onduty-source" ]]; then
    git clone https://github.com/junleynes/onduty-testing.git /var/www/onduty/onduty-source
    cd /var/www/onduty/onduty-source && npm install
    success "Source cloned and dependencies installed"
else
    info "Source already exists, pulling latest..."
    cd /var/www/onduty/onduty-source && git pull
fi

# ── 7. Install deploy scripts ─────────────────────────────────
cp /var/www/onduty/onduty-source/deploy/*.sh /var/www/onduty/
chmod +x /var/www/onduty/*.sh

# ── 8. Set up backup cron ─────────────────────────────────────
(crontab -l 2>/dev/null | grep -v backup-cron; echo "0 2 * * * /var/www/onduty/backup-cron.sh") | crontab -
success "Daily backup cron installed (runs at 2am)"

# ── Done ──────────────────────────────────────────────────────
echo ""
echo -e "${BOLD}${GREEN}Server setup complete!${NC}"
echo ""
echo -e "To deploy a new customer:"
echo -e "  ${BOLD}sudo /var/www/onduty/new-customer.sh <slug> <port> <domain>${NC}"
echo -e "  Example: sudo /var/www/onduty/new-customer.sh acme-corp 9001 acme.onduty.ph"
echo ""
echo -e "To manage customers:"
echo -e "  ${BOLD}sudo /var/www/onduty/manage.sh list${NC}"
echo ""
