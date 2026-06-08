
import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';

// This will create the database file in the root of your project.
// The .gitignore file will prevent it from being committed.
const DB_PATH = path.join(process.cwd(), 'local.db');

export let dbInstance: Database.Database | null = null;

function initializeDatabase() {
    // Check if the directory is writable
    const dir = path.dirname(DB_PATH);
    try {
        fs.accessSync(dir, fs.constants.W_OK);
    } catch (e) {
        console.error(`CRITICAL: The directory ${dir} is not writable. SQLite requires write access to the directory to create journal files.`);
    }

    const db = new Database(DB_PATH);
    
    // WAL mode: allows concurrent reads during writes
    db.pragma('journal_mode = WAL');
    // Flush WAL to main DB every 1000 pages instead of default 1000
    db.pragma('wal_autocheckpoint = 100');
    // Relaxed durability: fsync only on DB close, not every write — safe for app data, much faster
    db.pragma('synchronous = NORMAL');
    // 64MB page cache in memory — reduces disk reads significantly
    db.pragma('cache_size = -65536');
    // Store temp tables in memory instead of disk
    db.pragma('temp_store = MEMORY');
    // Enable memory-mapped I/O for 256MB — dramatically speeds up reads
    db.pragma('mmap_size = 268435456');
    // Enforce foreign key constraints
    db.pragma('foreign_keys = ON');

    // Run schema to create tables if they don't exist
    const schemaPath = path.join(process.cwd(), 'src', 'lib', 'schema.sql');
    if (fs.existsSync(schemaPath)) {
        try {
            const schema = fs.readFileSync(schemaPath, 'utf8');
            // Temporarily disable FK constraints during schema init so seed
            // insert order doesn't matter (groups must exist before employees FK fires)
            db.pragma('foreign_keys = OFF');
            db.exec(schema);
            db.pragma('foreign_keys = ON');
        } catch(e: any) {
            db.pragma('foreign_keys = ON'); // always re-enable
            if (e.code === 'SQLITE_READONLY') {
                console.error('CRITICAL: Database is read-only. Ensure the app has write permissions to local.db and its parent directory.');
            }
            console.error('Failed to initialize database from schema:', e);
            throw e;
        }
    } else {
            console.error(`CRITICAL: Schema file not found at ${schemaPath}. Cannot initialize database.`);
            throw new Error(`Schema file not found at ${schemaPath}`);
    }

    // Run migrations to add new columns if they don't exist
    const runMigration = (query: string, description: string) => {
        try {
            db.exec(query);
            console.log(`Migration successful: ${description}`);
        } catch (e: any) {
            if (!e.message.includes('duplicate column name') && !e.message.includes('already exists')) {
                console.error(`Error running migration (${description}):`, e.message);
            }
        }
    };

    runMigration("ALTER TABLE employees ADD COLUMN gender TEXT;", "Added 'gender' to 'employees'");
    runMigration("ALTER TABLE employees ADD COLUMN employeeClassification TEXT;", "Added 'employeeClassification' to 'employees'");
    runMigration("ALTER TABLE employees ADD COLUMN personnelNumber TEXT;", "Added 'personnelNumber' to 'employees'");
    runMigration("ALTER TABLE employees ADD COLUMN avlAllotted REAL DEFAULT 0;", "Added 'avlAllotted' to 'employees'");
    runMigration("ALTER TABLE employees ADD COLUMN avlBeginningBalance REAL DEFAULT 0;", "Added 'avlBeginningBalance' to 'employees'");
    runMigration("ALTER TABLE employees ADD COLUMN workScheduleType TEXT DEFAULT '8h-paid';", "Added 'workScheduleType' to 'employees'");
    runMigration("ALTER TABLE employees ADD COLUMN defaultShiftTemplateId TEXT;", "Added 'defaultShiftTemplateId' to 'employees'");
    runMigration("ALTER TABLE employees ADD COLUMN totpSecret TEXT;", "Added 'totpSecret' to 'employees'");
    runMigration("ALTER TABLE employees ADD COLUMN totpEnabled INTEGER NOT NULL DEFAULT 0;", "Added 'totpEnabled' to 'employees'");

    // Make password nullable — SQLite cannot ALTER COLUMN, so we recreate the table
    // using the proper pattern: create new with correct definition, copy, drop, rename.
    try {
        const col = db.prepare("PRAGMA table_info(employees)").all().find((c: any) => c.name === 'password') as any;
        if (col && col.notnull === 1) {
            db.exec(`
                PRAGMA foreign_keys = OFF;
                CREATE TABLE IF NOT EXISTS employees_new (
                    id TEXT PRIMARY KEY,
                    employeeNumber TEXT,
                    firstName TEXT NOT NULL,
                    lastName TEXT NOT NULL,
                    middleInitial TEXT,
                    email TEXT UNIQUE NOT NULL,
                    phone TEXT,
                    password TEXT,
                    position TEXT,
                    role TEXT NOT NULL DEFAULT 'member',
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
                    avlBeginningBalance REAL DEFAULT 0
                );
                INSERT INTO employees_new SELECT
                    id, employeeNumber, firstName, lastName, middleInitial, email, phone,
                    password, position, role, "group", avatar, birthDate, startDate,
                    loadAllocation, signature, visibility, lastPromotionDate, reportsTo,
                    gender, employeeClassification, personnelNumber, avlAllotted, avlBeginningBalance
                FROM employees;
                DROP TABLE employees;
                ALTER TABLE employees_new RENAME TO employees;
                PRAGMA foreign_keys = ON;
            `);
            console.log('Migration: made employees.password nullable');
        }
    } catch (e: any) {
        console.error('Migration warning (password nullable):', e.message);
    }
    
    const leaveColumns = [
        { name: 'dateFiled', type: 'TEXT' },
        { name: 'department', type: 'TEXT' },
        { name: 'idNumber', type: 'TEXT' },
        { name: 'contactInfo', type: 'TEXT' },
        { name: 'employeeSignature', type: 'TEXT' },
        { name: 'managerSignature', type: 'TEXT' },
        { name: 'pdfDataUri', type: 'TEXT' },
        { name: 'workExtensionStatus', type: 'TEXT' },
        { name: 'claimedWorkExtensionId', type: 'TEXT' },
        { name: 'isAvlClaimed', type: 'INTEGER DEFAULT 0' },
        { name: 'halfDaySegment', type: 'TEXT' },
        { name: 'durationCategory', type: 'TEXT' },
        { name: 'totalMinutes', type: 'INTEGER' },
    ];
    
    leaveColumns.forEach(col => {
        runMigration(`ALTER TABLE leave ADD COLUMN ${col.name} ${col.type};`, `Added '${col.name}' to 'leave'`);
    });

    runMigration("ALTER TABLE tasks ADD COLUMN acknowledgedAt TEXT;", "Added 'acknowledgedAt' to 'tasks'");

    // Preferred AVL Table Migration
    runMigration(`
      CREATE TABLE IF NOT EXISTS preferred_avl (
        id TEXT PRIMARY KEY,
        employeeId TEXT,
        year INTEGER,
        month INTEGER,
        plottedDays TEXT,
        FOREIGN KEY (employeeId) REFERENCES employees(id) ON DELETE CASCADE
      );
    `, "Created 'preferred_avl' table");

    runMigration("ALTER TABLE preferred_avl ADD COLUMN plottedDays TEXT;", "Added 'plottedDays' column to 'preferred_avl'");

    // Add UNIQUE constraint to preferred_avl (recreate if missing)
    runMigration(`CREATE UNIQUE INDEX IF NOT EXISTS idx_preferred_avl_unique ON preferred_avl(employeeId, year, month);`, "Added unique index to 'preferred_avl'");

    // Add UNIQUE constraint to tardy_records to prevent duplicates
    runMigration(`CREATE UNIQUE INDEX IF NOT EXISTS idx_tardy_unique ON tardy_records(employeeId, date);`, "Added unique index to 'tardy_records'");

    // Performance indexes
    runMigration(`CREATE INDEX IF NOT EXISTS idx_shifts_date     ON shifts(date);`,                         "idx_shifts_date");
    runMigration(`CREATE INDEX IF NOT EXISTS idx_shifts_employee ON shifts(employeeId);`,                   "idx_shifts_employee");
    runMigration(`CREATE INDEX IF NOT EXISTS idx_shifts_emp_date ON shifts(employeeId, date);`,             "idx_shifts_emp_date");
    runMigration(`CREATE INDEX IF NOT EXISTS idx_leave_dates     ON leave(startDate, endDate);`,            "idx_leave_dates");
    runMigration(`CREATE INDEX IF NOT EXISTS idx_leave_employee  ON leave(employeeId);`,                    "idx_leave_employee");
    runMigration(`CREATE INDEX IF NOT EXISTS idx_leave_status    ON leave(status);`,                        "idx_leave_status");
    runMigration(`CREATE INDEX IF NOT EXISTS idx_leave_type      ON leave(type);`,                          "idx_leave_type");
    runMigration(`CREATE INDEX IF NOT EXISTS idx_leave_emp_status ON leave(employeeId, status);`,           "idx_leave_emp_status");
    runMigration(`CREATE INDEX IF NOT EXISTS idx_tasks_assignee  ON tasks(assigneeId);`,                    "idx_tasks_assignee");
    runMigration(`CREATE INDEX IF NOT EXISTS idx_tasks_shift     ON tasks(shiftId);`,                       "idx_tasks_shift");
    runMigration(`CREATE INDEX IF NOT EXISTS idx_tardy_employee  ON tardy_records(employeeId);`,            "idx_tardy_employee");
    runMigration(`CREATE INDEX IF NOT EXISTS idx_tardy_date      ON tardy_records(date);`,                  "idx_tardy_date");
    runMigration(`CREATE INDEX IF NOT EXISTS idx_allowance_emp   ON communication_allowances(employeeId);`, "idx_allowance_emp");

    runMigration(`
        CREATE TABLE IF NOT EXISTS leave_recipients (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            email TEXT NOT NULL UNIQUE,
            role TEXT DEFAULT 'Division Admin',
            isDefault INTEGER DEFAULT 0
        );
    `, "Created 'leave_recipients' table");

    // Ensure the super-admin account always exists in DB.
    try {
        const admin = db.prepare("SELECT id FROM employees WHERE id = 'emp-admin-01'").get();
        if (!admin) {
            db.prepare(`
                INSERT INTO employees (id, employeeNumber, firstName, lastName, email, phone, position, role, "group")
                VALUES ('emp-admin-01', '001', 'Super', 'Admin', 'admin@onduty.local', '123-456-7890', 'System Administrator', 'admin', 'Administration')
            `).run();
            console.log('Migration: inserted missing super-admin account into employees table');
        }
    } catch (e: any) {
        console.error('Migration warning (admin insert):', e.message);
    }

    // Migrate existing base64 blobs from DB columns to disk files (runs once)
    try { migrateBase64ToFiles(db); } catch (e: any) { console.error('Migration warning (base64->files):', e.message); }

    return db;
}

export function getDb() {
  if (!dbInstance || !dbInstance.open) {
    if (dbInstance && !dbInstance.open) {
        console.log('Database connection was closed. Re-initializing.');
    }
      
    console.log(`Connecting to database at ${DB_PATH}`);
    try {
        dbInstance = initializeDatabase();
    } catch(error: any) {
        if (error.code === 'SQLITE_CORRUPT' || error.message.includes('malformed') || error.message.includes('not a database')) {
            console.error(`Database file at ${DB_PATH} is corrupted. Deleting and re-initializing.`, error);
            if (dbInstance && dbInstance.open) {
                dbInstance.close();
            }
            try {
                fs.unlinkSync(DB_PATH);
                const shmPath = `${DB_PATH}-shm`;
                if (fs.existsSync(shmPath)) fs.unlinkSync(shmPath);
                const walPath = `${DB_PATH}-wal`;
                if (fs.existsSync(walPath)) fs.unlinkSync(walPath);
                console.log('Corrupted database file deleted.');
            } catch (unlinkError) {
                console.error('Failed to delete corrupted database file:', unlinkError);
                throw unlinkError; 
            }
            dbInstance = initializeDatabase();
        } else {
            throw error;
        }
    }

    process.on('exit', () => {
        if (dbInstance && dbInstance.open) {
            console.log('Closing database connection.');
            dbInstance.close();
        }
    });
    process.on('SIGHUP', () => process.exit(128 + 1));
    process.on('SIGINT', () => process.exit(128 + 2));
    process.on('SIGTERM', () => process.exit(128 + 15));

  }
  return dbInstance;
}

export const db = getDb();

// ── Migrate existing base64 data from DB to disk ──────────────────────────────
// Run once: moves existing avatar/signature/template blobs from SQLite to disk.
// Safe to run on every start — skips records that are already file references.
function migrateBase64ToFiles(db: any) {
    const { saveAvatar, saveSignature, saveTemplate: saveTemplateFile, savePdf, saveScreenshot, ensureUploadDirs } = require('./file-storage');
    ensureUploadDirs();

    // Employees — avatar and signature
    const emps = db.prepare("SELECT id, avatar, signature FROM employees").all() as any[];
    for (const e of emps) {
        if (e.avatar && e.avatar.startsWith('data:')) {
            const path = saveAvatar(e.id, e.avatar);
            db.prepare("UPDATE employees SET avatar = ? WHERE id = ?").run(path, e.id);
        }
        if (e.signature && e.signature.startsWith('data:')) {
            const path = saveSignature(e.id, e.signature);
            db.prepare("UPDATE employees SET signature = ? WHERE id = ?").run(path, e.id);
        }
    }

    // Leave — pdfDataUri, employeeSignature, managerSignature
    const leaves = db.prepare("SELECT id, pdfDataUri, employeeSignature, managerSignature FROM leave").all() as any[];
    for (const l of leaves) {
        if (l.pdfDataUri && l.pdfDataUri.startsWith('data:')) {
            savePdf(l.id, l.pdfDataUri);
            db.prepare("UPDATE leave SET pdfDataUri = ? WHERE id = ?").run(`file:${l.id}.pdf`, l.id);
        }
        if (l.employeeSignature && l.employeeSignature.startsWith('data:')) {
            saveSignature(`leave_emp_${l.id}`, l.employeeSignature);
            db.prepare("UPDATE leave SET employeeSignature = ? WHERE id = ?").run(`file:leave_emp_${l.id}`, l.id);
        }
        if (l.managerSignature && l.managerSignature.startsWith('data:')) {
            saveSignature(`leave_mgr_${l.id}`, l.managerSignature);
            db.prepare("UPDATE leave SET managerSignature = ? WHERE id = ?").run(`file:leave_mgr_${l.id}`, l.id);
        }
    }

    // Templates in key_value_store
    const templates = db.prepare("SELECT key, value FROM key_value_store WHERE key LIKE '%Template%'").all() as any[];
    for (const t of templates) {
        if (t.value && !t.value.startsWith('file:') && t.value.length > 1000) {
            saveTemplateFile(t.key, t.value);
            db.prepare("UPDATE key_value_store SET value = ? WHERE key = ?").run(`file:${t.key}.pdf`, t.key);
        }
    }

    // Allowance screenshots
    const allowances = db.prepare("SELECT id, screenshot FROM communication_allowances WHERE screenshot IS NOT NULL").all() as any[];
    for (const a of allowances) {
        if (a.screenshot && a.screenshot.startsWith('data:')) {
            saveScreenshot(a.id, a.screenshot);
            db.prepare("UPDATE communication_allowances SET screenshot = ? WHERE id = ?").run(`file:${a.id}`, a.id);
        }
    }
}
