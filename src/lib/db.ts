
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
    
    // Enable WAL mode for better concurrency
    db.pragma('journal_mode = WAL');

    // Run schema to create tables if they don't exist
    const schemaPath = path.join(process.cwd(), 'src', 'lib', 'schema.sql');
    if (fs.existsSync(schemaPath)) {
        try {
            const schema = fs.readFileSync(schemaPath, 'utf8');
            db.exec(schema);
        } catch(e: any) {
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
