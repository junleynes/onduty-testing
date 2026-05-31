# OnDuty — Deployment Guide

## First Time Server Setup

Run **once** on a fresh Ubuntu 22.04 server:

```bash
sudo ./setup-server.sh
```

This installs: Node.js 20, Nginx, Certbot, build tools, and clones the source.

---

## Deploy a New Customer

```bash
sudo ./new-customer.sh <slug> <port> <domain>
```

**Example:**
```bash
sudo ./new-customer.sh acme-corp 9001 acme.onduty.ph
sudo ./new-customer.sh beta-studio 9002 beta.onduty.ph
sudo ./new-customer.sh gamma-media 9003 gamma.onduty.ph
```

**Rules:**
- `slug` — lowercase letters, numbers, hyphens only (e.g. `acme-corp`)
- `port` — unique per customer, range 9001–9999
- `domain` — DNS A record must point to your server IP first

**After deployment**, set up SSL:
```bash
sudo certbot --nginx -d acme.onduty.ph
```

---

## Manage Customers

```bash
# List all customers and their status
sudo ./manage.sh list

# View customer info (DB size, uploads, port)
sudo ./manage.sh info acme-corp

# Start / stop / restart
sudo ./manage.sh start   acme-corp
sudo ./manage.sh stop    acme-corp
sudo ./manage.sh restart acme-corp

# View live logs
sudo ./manage.sh logs acme-corp

# Backup one customer
sudo ./manage.sh backup acme-corp

# Backup ALL customers at once
sudo ./manage.sh backup-all

# Update one customer to latest code
sudo ./manage.sh update acme-corp

# Update ALL customers at once
sudo ./manage.sh update-all

# Remove a customer (creates backup first)
sudo ./manage.sh remove acme-corp
```

---

## Directory Structure

```
/var/www/onduty/
  onduty-source/          ← Shared source code (git repo)
  customers/
    acme-corp/
      src/                ← App source (copied from source)
      .env                ← Customer-specific secrets & config
      local.db            ← Customer database (KEEP THIS SAFE)
      uploads/            ← Avatars, signatures, PDFs, templates
        avatars/
        signatures/
        templates/
        pdfs/
        screenshots/
    beta-studio/
      ...

/var/backups/onduty/
  acme-corp/
    backup-20260101-020000.db
    uploads-20260101-020000.tar.gz

/var/log/onduty/
  acme-corp/
    app.log
    error.log
  backup.log
```

---

## Port Allocation

Keep a record of used ports:

| Customer | Port | Domain |
|---|---|---|
| your-company | 9988 | your-domain.ph |
| acme-corp | 9001 | acme.onduty.ph |
| beta-studio | 9002 | beta.onduty.ph |
| gamma-media | 9003 | gamma.onduty.ph |

---

## Automated Backups

Backups run automatically every day at 2am via cron.
- DB backups kept for **30 days**
- Upload backups kept for **7 days**

Manual backup anytime:
```bash
sudo ./manage.sh backup-all
```

---

## Updating All Customers

When you release a new version:

```bash
# Update source repo and rebuild all customers
sudo ./manage.sh update-all
```

Each customer gets a backup before updating. Zero data loss.

---

## Customer Login

Default credentials (given to customer on delivery):
- **URL:** https://domain.onduty.ph/login
- **Email:** admin@onduty.local
- **Password:** *(generated uniquely per customer — shown at deployment)*

**Remind customers to change their password after first login.**

---

## Pricing Guide (Philippines)

| Plan | Employees | Monthly |
|---|---|---|
| Starter | up to 20 | ₱3,000 |
| Standard | up to 50 | ₱6,000 |
| Growth | up to 100 | ₱10,000 |
| Setup fee | — | ₱5,000 one-time |
