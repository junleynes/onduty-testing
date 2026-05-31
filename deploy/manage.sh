#!/bin/bash
# ============================================================
#  OnDuty — Customer Management Script
#  Usage: sudo ./manage.sh <command> [slug]
#  Commands: list | status | start | stop | restart | logs
#            backup | update | remove | info
# ============================================================

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
BLUE='\033[0;34m'; BOLD='\033[1m'; NC='\033[0m'

CUSTOMERS_DIR="/var/www/onduty/customers"
BACKUPS_DIR="/var/backups/onduty"

CMD="${1:-list}"
SLUG="$2"

require_slug() {
    [[ -z "$SLUG" ]] && echo -e "${RED}Error:${NC} Provide customer slug. Example: $0 $CMD acme-corp" && exit 1
    [[ ! -d "$CUSTOMERS_DIR/$SLUG" ]] && echo -e "${RED}Error:${NC} Customer '$SLUG' not found." && exit 1
}

case "$CMD" in

  list)
    echo -e "\n${BOLD}OnDuty Customers${NC}"
    echo "$(printf '─%.0s' {1..60})"
    printf "%-20s %-8s %-25s %-10s\n" "SLUG" "PORT" "DOMAIN" "STATUS"
    echo "$(printf '─%.0s' {1..60})"
    for dir in "$CUSTOMERS_DIR"/*/; do
        slug=$(basename "$dir")
        service="onduty-$slug"
        port=$(grep "^PORT=" "$dir/.env" 2>/dev/null | cut -d= -f2)
        domain=$(grep "^NEXTAUTH_URL=" "$dir/.env" 2>/dev/null | sed 's|.*https\?://||')
        if systemctl is-active --quiet "$service"; then
            status="${GREEN}running${NC}"
        else
            status="${RED}stopped${NC}"
        fi
        printf "%-20s %-8s %-25s " "$slug" "$port" "$domain"
        echo -e "$status"
    done
    echo ""
    ;;

  status)
    require_slug
    systemctl status "onduty-$SLUG"
    ;;

  start)
    require_slug
    systemctl start "onduty-$SLUG"
    echo -e "${GREEN}Started${NC} onduty-$SLUG"
    ;;

  stop)
    require_slug
    systemctl stop "onduty-$SLUG"
    echo -e "${YELLOW}Stopped${NC} onduty-$SLUG"
    ;;

  restart)
    require_slug
    systemctl restart "onduty-$SLUG"
    echo -e "${GREEN}Restarted${NC} onduty-$SLUG"
    ;;

  logs)
    require_slug
    journalctl -u "onduty-$SLUG" -f --no-pager
    ;;

  backup)
    require_slug
    BACKUP_FILE="$BACKUPS_DIR/$SLUG/backup-$(date +%Y%m%d-%H%M%S).db"
    mkdir -p "$BACKUPS_DIR/$SLUG"
    cp "$CUSTOMERS_DIR/$SLUG/local.db" "$BACKUP_FILE"
    # Also backup uploads
    tar -czf "$BACKUPS_DIR/$SLUG/uploads-$(date +%Y%m%d-%H%M%S).tar.gz" \
        -C "$CUSTOMERS_DIR/$SLUG" uploads/ 2>/dev/null || true
    echo -e "${GREEN}Backup created:${NC} $BACKUP_FILE"
    # Keep last 30 days
    find "$BACKUPS_DIR/$SLUG" -name "backup-*.db" -mtime +30 -delete
    find "$BACKUPS_DIR/$SLUG" -name "uploads-*.tar.gz" -mtime +7 -delete
    ;;

  backup-all)
    echo -e "${BOLD}Backing up all customers...${NC}"
    for dir in "$CUSTOMERS_DIR"/*/; do
        slug=$(basename "$dir")
        BACKUP_FILE="$BACKUPS_DIR/$slug/backup-$(date +%Y%m%d-%H%M%S).db"
        mkdir -p "$BACKUPS_DIR/$slug"
        cp "$dir/local.db" "$BACKUP_FILE" 2>/dev/null && \
            echo -e "  ${GREEN}✓${NC} $slug" || \
            echo -e "  ${RED}✗${NC} $slug (no DB yet)"
        find "$BACKUPS_DIR/$slug" -name "backup-*.db" -mtime +30 -delete
    done
    echo -e "${GREEN}Done${NC}"
    ;;

  update)
    require_slug
    echo -e "${BOLD}Updating $SLUG...${NC}"
    # Backup first
    bash "$0" backup "$SLUG"
    # Stop service
    systemctl stop "onduty-$SLUG"
    # Pull latest source
    cd /var/www/onduty/onduty-source && git pull origin main
    # Sync source files (preserve .env, local.db, uploads)
    rsync -av --exclude='.env' --exclude='local.db' --exclude='uploads/' \
        --exclude='node_modules' --exclude='.next' \
        /var/www/onduty/onduty-source/ "$CUSTOMERS_DIR/$SLUG/"
    # Rebuild
    cd "$CUSTOMERS_DIR/$SLUG" && npm run build
    systemctl start "onduty-$SLUG"
    echo -e "${GREEN}Update complete${NC}"
    ;;

  update-all)
    echo -e "${BOLD}Updating all customers...${NC}"
    cd /var/www/onduty/onduty-source && git pull origin main
    for dir in "$CUSTOMERS_DIR"/*/; do
        slug=$(basename "$dir")
        echo -e "\n${BLUE}Updating $slug...${NC}"
        bash "$0" backup "$slug"
        systemctl stop "onduty-$slug"
        rsync -av --exclude='.env' --exclude='local.db' --exclude='uploads/' \
            --exclude='node_modules' --exclude='.next' \
            /var/www/onduty/onduty-source/ "$dir"
        cd "$dir" && npm run build
        systemctl start "onduty-$slug"
        echo -e "${GREEN}✓ $slug updated${NC}"
    done
    ;;

  info)
    require_slug
    DIR="$CUSTOMERS_DIR/$SLUG"
    DB_SIZE=$(du -sh "$DIR/local.db" 2>/dev/null | cut -f1 || echo "N/A")
    UPLOAD_SIZE=$(du -sh "$DIR/uploads/" 2>/dev/null | cut -f1 || echo "N/A")
    echo ""
    echo -e "${BOLD}Customer: $SLUG${NC}"
    echo "$(printf '─%.0s' {1..40})"
    grep "^NEXTAUTH_URL\|^PORT" "$DIR/.env" 2>/dev/null
    echo "DB size:     $DB_SIZE"
    echo "Uploads:     $UPLOAD_SIZE"
    echo "Service:     $(systemctl is-active onduty-$SLUG)"
    echo ""
    ;;

  remove)
    require_slug
    echo -e "${RED}WARNING: This will permanently delete $SLUG${NC}"
    read -p "Type '$SLUG' to confirm: " confirm
    [[ "$confirm" != "$SLUG" ]] && echo "Cancelled." && exit 0
    systemctl stop "onduty-$SLUG" 2>/dev/null || true
    systemctl disable "onduty-$SLUG" 2>/dev/null || true
    rm -f "/etc/systemd/system/onduty-$SLUG.service"
    rm -f "/etc/nginx/sites-enabled/$SLUG"
    rm -f "/etc/nginx/sites-available/$SLUG"
    systemctl daemon-reload
    nginx -t && systemctl reload nginx
    # Keep data in backup before removing
    bash "$0" backup "$SLUG" 2>/dev/null || true
    rm -rf "$CUSTOMERS_DIR/$SLUG"
    echo -e "${GREEN}Removed $SLUG${NC} (data backed up to $BACKUPS_DIR/$SLUG)"
    ;;

  *)
    echo -e "\n${BOLD}OnDuty Management${NC}"
    echo "Usage: $0 <command> [slug]"
    echo ""
    echo "Commands:"
    echo "  list                  — List all customers"
    echo "  status   <slug>       — Show service status"
    echo "  start    <slug>       — Start customer"
    echo "  stop     <slug>       — Stop customer"
    echo "  restart  <slug>       — Restart customer"
    echo "  logs     <slug>       — Follow logs"
    echo "  backup   <slug>       — Backup DB and uploads"
    echo "  backup-all            — Backup all customers"
    echo "  update   <slug>       — Update to latest code"
    echo "  update-all            — Update all customers"
    echo "  info     <slug>       — Show customer info"
    echo "  remove   <slug>       — Remove customer (with backup)"
    echo ""
    ;;
esac
