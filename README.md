# OnDuty

A self-hosted workforce scheduling and HR management application for broadcast and media teams. Built with Next.js 15, React 18, SQLite, and NextAuth.

---

## Features

### Schedule Management
- **Visual schedule grid** with day, week, and semi-monthly views
- Shift templates with configurable start/end times, colors, and break settings
- Drag-and-drop shift assignment with repeat options (daily, weekly, monthly)
- Holiday calendar with automatic holiday-off flagging
- Export schedule to Excel (`.xlsx`) with custom date range presets
- Import schedule from CSV (matrix format) via UI or API

### Time & Attendance
- **Time-off requests** — leave filing, approval workflow, and PDF generation (ALAF)
- **Work extensions** — overtime and shift extension tracking
- **Tardy management** — manual entry and CSV import of tardiness records
- **WFH (Work From Home)** certification with automated PDF output
- Leave type configuration (custom types, colors, and policies)

### AVL (Annual Vacation Leave) Management
- Annual preferred leave planning grid per group
- Per-employee VL beginning balance and scheduled days tracking
- Group conflict prevention — blocks duplicate dates within the same group
- Import and export AVL data via CSV
- Manager lock/unlock grid per year

### Reports (Excel export)
- Work Schedule report — shows each employee's daily shift, with default schedule shown on leave/holiday days
- Attendance Sheet report
- User Summary report — shifts, hours, leave counts, and tardy count per employee
- Cumulative Tardy report — combined from imported records and leave entries
- WFH Certificate report
- Work Extension report
- Overtime report
- Custom report templates (upload your own `.xlsx` template with named fields)
- Email report directly from the app

### Team & People Management
- **Role-based access control** — Admin, Manager, Member
- Per-group management — managers control only their group
- Employee profiles — photo, signature, position, classification, work schedule type, default shift
- Work schedule type per employee — 8-hour/paid break, 8-hour/unpaid break, 10-hour/paid break, 10-hour/unpaid break
- Default schedule per employee — used in reports when on leave or holiday
- Org chart view
- Birthdays and work anniversaries (Celebrations)
- Team CSV import/export
- Mobile load (allowance) tracking

### Administration
- SMTP email configuration (for leave notifications, password resets, activation links)
- Permissions editor — control which views each role can access
- Danger zone — purge data by category or full factory reset
- FAQ management
- Multi-tenant CLI (`deploy/onduty.sh`) for managing multiple instances on one server

### Security
- bcrypt password hashing (auto-upgrades legacy plaintext passwords on first login)
- **Two-factor authentication (2FA)** — TOTP-based, compatible with Google Authenticator, Authy, and any RFC 6238 app. Per-user opt-in via the sidebar shield icon
- JWT sessions with 8-hour expiry
- Unified rate limiting — 5 failed login attempts triggers 15-minute lockout (shared across all login paths)
- Per-role server action guards (`requireAdmin`, `requireManager`, `requireAuth`) on all mutating and file-reading actions
- Middleware protection on all routes except public auth pages
- SMTP password never sent to the browser — read server-side only at send time
- Security headers — `X-Frame-Options`, `X-Content-Type-Options`, `Content-Security-Policy`
- Password reset via secure time-limited email tokens
- `NEXTAUTH_SECRET` required at startup — app refuses to start if not set

---

## Requirements

| Requirement | Version |
|---|---|
| Node.js | 18 or higher |
| npm | 9 or higher (bundled with Node) |
| Operating System | Linux (Ubuntu 22.04+ recommended), macOS, or Windows |
| Disk space | ~500 MB (app + dependencies) |

> **Optional:** An SMTP mail server or service (Gmail, Mailgun, etc.) for email notifications and password resets.

---

## Installation

### Development

```bash
# 1. Clone the repository
git clone <repository-url>
cd onduty

# 2. Install dependencies
npm install

# 3. Set up environment variables
cp .env.example .env
```

Edit `.env` and fill in your values:

```env
# Required — generate with: openssl rand -base64 32
NEXTAUTH_SECRET=your-secret-here

# Optional — set if accessing via a specific domain
NEXTAUTH_URL=http://localhost:9002
```

```bash
# 4. Start the development server
npm run dev
```

The app will be available at `http://localhost:9002`.

---

### Production (Linux / systemd)

#### 1. Install Node.js

```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs
```

#### 2. Create the app user and directory

```bash
sudo useradd -r -s /bin/false onduty
sudo mkdir -p /var/www/onduty
sudo chown onduty:onduty /var/www/onduty
```

#### 3. Deploy the app

```bash
cd /var/www/onduty
sudo -u onduty git clone <repository-url> .
sudo -u onduty npm install
sudo -u onduty npm run build
```

#### 4. Set up environment variables

```bash
sudo nano /var/www/onduty/.env
```

```env
NODE_ENV=production

# Required — generate with: openssl rand -base64 32
NEXTAUTH_SECRET=your-strong-secret-here

# Required — must match the URL users access the app from
NEXTAUTH_URL=http://your-server-ip:9988

```

#### 5. Create the systemd service

```bash
sudo nano /etc/systemd/system/onduty.service
```

```ini
[Unit]
Description=OnDuty Node App
After=network.target

[Service]
Type=simple
WorkingDirectory=/var/www/onduty
ExecStart=/usr/bin/node /var/www/onduty/node_modules/.bin/next start -p 9988
Restart=always
RestartSec=5
User=onduty
Environment=NODE_ENV=production
Environment=PATH=/usr/bin:/usr/local/bin:/bin
EnvironmentFile=/var/www/onduty/.env

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable onduty
sudo systemctl start onduty
sudo systemctl status onduty
```

#### 6. (Optional) Nginx reverse proxy

```bash
sudo apt install nginx -y
sudo nano /etc/nginx/sites-available/onduty
```

```nginx
server {
    listen 80;
    server_name your-domain.com;

    client_max_body_size 20M;

    location / {
        proxy_pass http://127.0.0.1:9988;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
    }
}
```

```bash
sudo ln -s /etc/nginx/sites-available/onduty /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl reload nginx
```

---

### Multi-Tenant Setup

For managing multiple team instances on one server, use the included CLI:

```bash
sudo chmod +x deploy/onduty.sh

sudo ./onduty.sh new          # provision a new tenant
sudo ./onduty.sh list         # list all tenants
sudo ./onduty.sh status       # show running status
sudo ./onduty.sh backup <tenant>    # backup tenant database
sudo ./onduty.sh backupall          # backup all tenants
sudo ./onduty.sh update <tenant>    # pull latest code & rebuild
sudo ./onduty.sh restart <tenant>   # restart a tenant
sudo ./onduty.sh logs <tenant>      # tail service logs
sudo ./onduty.sh remove <tenant>    # remove a tenant (irreversible)
```

---

## Default Login

Use these credentials on first launch to set up your team:

| Field | Value |
|---|---|
| Email | `admin@onduty.local` |
| Password | `P@ssw0rd` |

> **Change the admin password immediately after first login.**

---

## Available Scripts

| Command | Description |
|---|---|
| `npm run dev` | Start development server on port 9002 (Turbopack) |
| `npm run build` | Build for production |
| `npm run start` | Start production server on port 9988 |
| `npm run lint` | Run ESLint |
| `npm run typecheck` | Run TypeScript type checking |

---

## Database

OnDuty uses SQLite (`local.db`) in the project root. The database is created and migrated automatically on first start — no manual setup required.

Back up regularly in production:

```bash
# Manual backup
cp /var/www/onduty/local.db /var/backups/onduty/local-$(date +%Y%m%d).db

# Or use the CLI
sudo ./deploy/onduty.sh backup <tenant>
```

---

## Tech Stack

| Layer | Technology |
|---|---|
| Framework | Next.js 15 (App Router) |
| UI | React 18, Tailwind CSS, shadcn/ui, Radix UI |
| Database | SQLite via better-sqlite3 |
| Auth | NextAuth v5 (JWT, Credentials) |
| PDF | pdf-lib |
| Excel | ExcelJS |
| CSV | PapaParse |
| Email | Nodemailer |
| Charts | Recharts |
| Forms | React Hook Form + Zod |
