#!/bin/bash
# ============================================================
#  OnDuty — Automated Daily Backup (run via cron)
#  Install: sudo crontab -e
#  Add:     0 2 * * * /var/www/onduty/deploy/backup-cron.sh
# ============================================================

MANAGE="/var/www/onduty/deploy/manage.sh"
LOG="/var/log/onduty/backup.log"

echo "[$(date)] Starting automated backup..." >> "$LOG"
bash "$MANAGE" backup-all >> "$LOG" 2>&1
echo "[$(date)] Backup complete." >> "$LOG"
