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
- **Time-off requests** — leave filing with reason templates, approval workflow, PDF generation (ALAF), and automatic flattening for consistent rendering across all PDF viewers
- **Approval workflow** — manager confirmation dialog with optional email notification to employee on approve/reject
- **Superior notifications** — in-app and email notification to the employee's manager/superior when a request is filed (with opt-in checkbox)
- **Work extensions** — overtime and shift extension tracking with PDF output
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
- **API & Integration** — named API key management (create, revoke, view keys for external integrations)
- Permissions editor — control which views each role can access
- **Backup & Restore** — download a full `.zip` backup (database + all uploaded files) or restore from a previous backup; admin-panel-only, no HTTP API
- **Maintenance Mode** — toggle site-wide maintenance with a custom message; only admins can log in while enabled
- Audit Logs — record of login events and admin actions
- Danger zone — purge data by category (shifts, users, templates, tasks, groups, leave types, mobile load)
- FAQ management
- Multi-tenant CLI (`deploy/onduty.sh`) for managing multiple instances on one server

### Security

#### Authentication & Sessions
- **bcrypt password hashing** — auto-upgrades legacy plaintext passwords on first login
- **Two-factor authentication (2FA)** — TOTP-based, compatible with Google Authenticator, Authy, and any RFC 6238 app. Per-user opt-in via the sidebar shield icon
- **JWT sessions** with 8-hour expiry
- **Password reset** via secure, time-limited single-use email tokens
- `AUTH_SECRET` required at startup — app refuses to initialize if not set
- SMTP credentials never sent to the browser — read server-side only at send time

#### Access Control
- **Role-based server action guards** — `requireAdmin`, `requireManager`, `requireAuth` enforced on every mutating and data-reading server action
- **Middleware route protection** — all routes require an authenticated session; unauthenticated requests are redirected to `/login`
- **Per-group isolation** — managers can only manage and view employees in their own group
- **Permissions editor** — admin controls which views each role can access

#### Brute Force & Abuse Protection
- **Login rate limiting** — 5 failed attempts locks the account for 15 minutes (shared across all login paths including API)
- **Global rate limiting** — 600 requests per 60 seconds per IP via middleware (in-memory, nginx-aware via `X-Forwarded-For`)
- **Login endpoint rate limiting** — separate 15 requests per 60 seconds limit on `/api/auth/callback`
- **Bot / scanner blocking** — requests from headless tools (`curl`, `wget`, `sqlmap`, `nikto`, `nuclei`, `dirbuster`, and others) are rejected at the middleware layer before reaching any route handler
- **No-UA blocking** — requests with no `User-Agent` header are rejected

#### API Security
- **Named API keys** — multi-key management with revocable named keys stored in the `api_keys` table; legacy single-key also supported for backwards compatibility
- **API key required** on all external HTTP endpoints (`/api/import-schedule`, `/api/reports/*`)
- **Backup and Restore are admin-panel-only** — no HTTP API endpoint exists for either operation; middleware returns HTTP 410 Gone for any request to `/api/backup` or `/api/restore` as an additional defense-in-depth layer
- **Separate API rate limit** — 100 requests per 60 seconds per IP for API consumers, independent of the global limit

#### Backup & Restore Security
- **Admin session required** — `requireAdmin()` enforced server-side on both `backupDatabase()` and `restoreDatabase()` server actions
- **File type validation** — restore rejects files that are not a valid ZIP (`PK` magic bytes) or SQLite3 database header
- **50 MB size cap** on restore uploads
- **Path traversal protection** — zip entries with `..` or absolute paths are silently skipped during restore
- **Audit logged** — backup downloads and restore operations are recorded in the audit log

#### Maintenance Mode
- **Admin-only toggle** — sets an `httpOnly` cookie checked by middleware on every request
- Non-admin users are redirected to a maintenance page; admins pass through normally
- Custom maintenance message configurable from the Backup & Restore admin section

#### Infrastructure (when deployed behind nginx)
- **HTTPS enforcement** — configure nginx to redirect HTTP → HTTPS and set `Strict-Transport-Security`
- **Real IP extraction** — middleware reads `X-Forwarded-For` set by nginx for accurate per-user rate limiting; direct local access falls back to `127.0.0.1` gracefully
- **Static asset bypass** — all static file extensions excluded from middleware matcher so they are served directly without auth overhead

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

# Optional
GEMINI_API_KEY=your-gemini-api-key
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
# Redirect HTTP → HTTPS
server {
    listen 80;
    server_name your-domain.com;
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl;
    server_name your-domain.com;

    ssl_certificate     /etc/letsencrypt/live/your-domain.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/your-domain.com/privkey.pem;

    # Security headers
    add_header Strict-Transport-Security "max-age=63072000; includeSubDomains" always;
    add_header X-Frame-Options DENY always;
    add_header X-Content-Type-Options nosniff always;
    add_header Referrer-Policy strict-origin-when-cross-origin always;

    # Max upload size — covers report template uploads and backup restores
    client_max_body_size 55M;

    location / {
        proxy_pass http://127.0.0.1:9988;
        proxy_http_version 1.1;

        # Required for Next.js websockets / hot reload
        proxy_set_header Upgrade    $http_upgrade;
        proxy_set_header Connection 'upgrade';

        # Forward real client IP — used by OnDuty middleware for accurate rate limiting.
        # These headers overwrite any client-supplied values, preventing IP spoofing.
        proxy_set_header X-Real-IP         $remote_addr;
        proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header Host              $host;

        proxy_cache_bypass $http_upgrade;
    }
}
```

> **HTTPS certificate:** Use Certbot for a free Let's Encrypt certificate:
> ```bash
> sudo apt install certbot python3-certbot-nginx
> sudo certbot --nginx -d your-domain.com
> ```

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

Back up regularly in production. The recommended way is the **Admin Panel > Backup & Restore** section, which downloads a `.zip` containing both the database and all uploaded files (avatars, signatures, PDFs, report templates). The backup is admin-session-only — no API key can trigger it.

```bash
# Manual database-only backup (no uploads)
cp /var/www/onduty/local.db /var/backups/onduty/local-$(date +%Y%m%d).db

# Or use the CLI
sudo ./deploy/onduty.sh backup <tenant>
```

> **Restore note:** When restoring via the admin panel, the server restarts automatically (handled by PM2 or systemd). The restore validates file type (ZIP or SQLite), enforces a 50 MB size cap, and guards against path traversal in zip entries.

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
| AI | Google Gemini via Genkit |
| Charts | Recharts |
| Forms | React Hook Form + Zod |
