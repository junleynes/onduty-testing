

CREATE TABLE IF NOT EXISTS employees (
    id TEXT PRIMARY KEY,
    employeeNumber TEXT,
    firstName TEXT NOT NULL,
    lastName TEXT NOT NULL,
    middleInitial TEXT,
    email TEXT UNIQUE NOT NULL,
    phone TEXT,
    password TEXT,
    position TEXT,
    role TEXT NOT NULL CHECK(role IN ('admin', 'manager', 'member')),
    "group" TEXT,
    avatar TEXT,
    birthDate TEXT,
    startDate TEXT,
    loadAllocation REAL DEFAULT 0,
    signature TEXT,
    visibility TEXT,
    lastPromotionDate TEXT,
    reportsTo TEXT,
    gender TEXT,
    employeeClassification TEXT,
    personnelNumber TEXT,
    avlAllotted REAL DEFAULT 0,
    avlBeginningBalance REAL DEFAULT 0,
    workScheduleType TEXT DEFAULT '8h-paid',
    defaultShiftTemplateId TEXT,
    totpSecret TEXT,
    totpEnabled INTEGER NOT NULL DEFAULT 0,
    FOREIGN KEY(reportsTo) REFERENCES employees(id) ON DELETE SET NULL,
    FOREIGN KEY("group") REFERENCES groups(name) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS shifts (
    id TEXT PRIMARY KEY,
    employeeId TEXT,
    label TEXT,
    startTime TEXT,
    endTime TEXT,
    date TEXT,
    color TEXT,
    isDayOff INTEGER,
    isHolidayOff INTEGER,
    status TEXT CHECK(status IN ('draft', 'published')),
    breakStartTime TEXT,
    breakEndTime TEXT,
    isUnpaidBreak INTEGER,
    FOREIGN KEY(employeeId) REFERENCES employees(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS leave (
    id TEXT PRIMARY KEY,
    employeeId TEXT NOT NULL,
    type TEXT,
    color TEXT,
    startDate TEXT NOT NULL,
    endDate TEXT NOT NULL,
    isAllDay INTEGER NOT NULL DEFAULT 1,
    startTime TEXT,
    endTime TEXT,
    status TEXT NOT NULL CHECK(status IN ('pending', 'approved', 'rejected')) DEFAULT 'pending',
    reason TEXT,
    requestedAt TEXT,
    managedBy TEXT,
    managedAt TEXT,
    originalShiftDate TEXT,
    originalStartTime TEXT,
    originalEndTime TEXT,
    dateFiled TEXT,
    department TEXT,
    idNumber TEXT,
    contactInfo TEXT,
    employeeSignature TEXT,
    managerSignature TEXT,
    pdfDataUri TEXT,
    workExtensionStatus TEXT,
    claimedWorkExtensionId TEXT,
    isAvlClaimed INTEGER DEFAULT 0,
    halfDaySegment TEXT,
    durationCategory TEXT,
    totalMinutes INTEGER,
    FOREIGN KEY(employeeId) REFERENCES employees(id) ON DELETE CASCADE,
    FOREIGN KEY(managedBy) REFERENCES employees(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS notes (
    id TEXT PRIMARY KEY,
    date TEXT NOT NULL,
    title TEXT NOT NULL,
    description TEXT
);

CREATE TABLE IF NOT EXISTS holidays (
    id TEXT PRIMARY KEY,
    date TEXT NOT NULL UNIQUE,
    title TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS tasks (
    id TEXT PRIMARY KEY,
    shiftId TEXT,
    assigneeId TEXT,
    scope TEXT NOT NULL CHECK(scope IN ('personal', 'global', 'shift')),
    title TEXT NOT NULL,
    description TEXT,
    status TEXT NOT NULL CHECK(status IN ('pending', 'acknowledged', 'completed')),
    acknowledgedAt TEXT,
    completedAt TEXT,
    dueDate TEXT,
    createdBy TEXT NOT NULL,
    FOREIGN KEY(shiftId) REFERENCES shifts(id) ON DELETE CASCADE,
    FOREIGN KEY(assigneeId) REFERENCES employees(id) ON DELETE CASCADE,
    FOREIGN KEY(createdBy) REFERENCES employees(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS communication_allowances (
    id TEXT PRIMARY KEY,
    employeeId TEXT NOT NULL,
    year INTEGER NOT NULL,
    month INTEGER NOT NULL,
    balance REAL,
    asOfDate TEXT,
    screenshot TEXT,
    FOREIGN KEY(employeeId) REFERENCES employees(id) ON DELETE CASCADE,
    UNIQUE(employeeId, year, month)
);

CREATE TABLE IF NOT EXISTS smtp_settings (
    id INTEGER PRIMARY KEY DEFAULT 1,
    host TEXT,
    port INTEGER,
    secure INTEGER,
    user TEXT,
    pass TEXT,
    fromEmail TEXT,
    fromName TEXT
);

CREATE TABLE IF NOT EXISTS groups (
    name TEXT PRIMARY KEY
);

CREATE TABLE IF NOT EXISTS tardy_records (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    employeeId TEXT NOT NULL,
    employeeName TEXT NOT NULL,
    date TEXT NOT NULL,
    schedule TEXT,
    timeIn TEXT,
    timeOut TEXT,
    remarks TEXT,
    FOREIGN KEY(employeeId) REFERENCES employees(id) ON DELETE CASCADE,
    UNIQUE(employeeId, date)
);

CREATE TABLE IF NOT EXISTS key_value_store (
    key TEXT PRIMARY KEY,
    value TEXT
);

CREATE TABLE IF NOT EXISTS shift_templates (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    label TEXT NOT NULL,
    startTime TEXT NOT NULL,
    endTime TEXT NOT NULL,
    color TEXT,
    breakStartTime TEXT,
    breakEndTime TEXT,
    isUnpaidBreak INTEGER
);

CREATE TABLE IF NOT EXISTS leave_types (
    type TEXT PRIMARY KEY,
    color TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS password_reset_tokens (
    token TEXT PRIMARY KEY,
    employeeId TEXT NOT NULL,
    expiresAt TEXT NOT NULL,
    FOREIGN KEY(employeeId) REFERENCES employees(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS permissions (
    role TEXT PRIMARY KEY,
    allowed_views TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS preferred_avl (
    id TEXT PRIMARY KEY,
    employeeId TEXT NOT NULL,
    year INTEGER NOT NULL,
    month INTEGER NOT NULL,
    plottedDays TEXT,
    FOREIGN KEY(employeeId) REFERENCES employees(id) ON DELETE CASCADE,
    UNIQUE(employeeId, year, month)
);

-- Indexes for common query patterns
CREATE INDEX IF NOT EXISTS idx_shifts_date        ON shifts(date);
CREATE INDEX IF NOT EXISTS idx_shifts_employee    ON shifts(employeeId);
CREATE INDEX IF NOT EXISTS idx_shifts_emp_date    ON shifts(employeeId, date);
CREATE INDEX IF NOT EXISTS idx_leave_dates        ON leave(startDate, endDate);
CREATE INDEX IF NOT EXISTS idx_leave_employee     ON leave(employeeId);
CREATE INDEX IF NOT EXISTS idx_leave_status       ON leave(status);
CREATE INDEX IF NOT EXISTS idx_leave_type         ON leave(type);
CREATE INDEX IF NOT EXISTS idx_leave_emp_status   ON leave(employeeId, status);
CREATE INDEX IF NOT EXISTS idx_tasks_assignee     ON tasks(assigneeId);
CREATE INDEX IF NOT EXISTS idx_tasks_shift        ON tasks(shiftId);
CREATE INDEX IF NOT EXISTS idx_tardy_employee     ON tardy_records(employeeId);
CREATE INDEX IF NOT EXISTS idx_tardy_date         ON tardy_records(date);
CREATE INDEX IF NOT EXISTS idx_allowance_emp_ym   ON communication_allowances(employeeId, year, month);
CREATE INDEX IF NOT EXISTS idx_preferred_avl_emp  ON preferred_avl(employeeId, year, month);

-- Default groups (must come before admin employee insert due to FK constraint)
INSERT INTO groups (name) VALUES ('Administration') ON CONFLICT(name) DO NOTHING;

-- Default admin user
INSERT INTO employees (id, employeeNumber, firstName, lastName, email, phone, position, role, "group")
SELECT 'emp-admin-01', '001', 'Super', 'Admin', 'admin@onduty.local', '123-456-7890', 'System Administrator', 'admin', 'Administration'
WHERE NOT EXISTS (SELECT 1 FROM employees WHERE id = 'emp-admin-01');

-- Default permissions
INSERT INTO permissions (role, allowed_views) VALUES
('admin',   '["admin","smtp-settings","permissions","danger-zone","dashboard","my-schedule","my-tasks","schedule","onduty","time-off","allowance","task-manager","team","org-chart","celebrations","holidays","faq","reports","report-work-schedule","report-attendance","report-user-summary","report-tardy","report-wfh","report-work-extension","report-overtime","report-alaf"]'),
('manager', '["dashboard","my-schedule","my-tasks","schedule","onduty","time-off","allowance","task-manager","team","org-chart","celebrations","holidays","faq","reports","report-work-schedule","report-attendance","report-user-summary","report-tardy","report-wfh","report-work-extension","report-overtime"]'),
('member',  '["dashboard","my-schedule","my-tasks","onduty","time-off","allowance","team","org-chart","celebrations","holidays","faq","reports","report-wfh"]')
ON CONFLICT(role) DO NOTHING;

-- External leave recipients (Company/Division admins outside the team)
CREATE TABLE IF NOT EXISTS leave_recipients (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE,
    role TEXT DEFAULT 'Division Admin',
    isDefault INTEGER DEFAULT 0
);
