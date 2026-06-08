/**
 * rate-limit.ts — DB-backed login rate limiting.
 *
 * Uses the login_attempts table in SQLite so lockouts persist
 * across server restarts and Next.js worker process boundaries.
 * A pure in-memory Map does NOT work in production Next.js because
 * server actions run in isolated module instances per request.
 *
 * Uses synchronous better-sqlite3 calls — safe because this only
 * runs server-side in server actions / authorize(), never in Edge Runtime.
 */
import { getDb } from '@/lib/db';

export const MAX_ATTEMPTS = 5;
export const LOCKOUT_MS   = 15 * 60 * 1000; // 15 minutes

export function isLocked(email: string): boolean {
    try {
        const db  = getDb();
        const key = email.toLowerCase().trim();
        const row = db.prepare(
            'SELECT count, locked_until FROM login_attempts WHERE email = ?'
        ).get(key) as { count: number; locked_until: number } | undefined;

        if (!row) return false;

        if (row.locked_until > Date.now()) return true;

        // Lockout expired — clean up
        if (row.locked_until > 0) {
            db.prepare('DELETE FROM login_attempts WHERE email = ?').run(key);
        }
        return false;
    } catch {
        return false; // fail open — never block login on DB error
    }
}

export function trackFailed(email: string): void {
    try {
        const db    = getDb();
        const key   = email.toLowerCase().trim();
        const row   = db.prepare(
            'SELECT count FROM login_attempts WHERE email = ?'
        ).get(key) as { count: number } | undefined;
        const count = (row?.count ?? 0) + 1;

        if (count >= MAX_ATTEMPTS) {
            // Lock the account
            db.prepare(`
                INSERT INTO login_attempts (email, count, locked_until)
                VALUES (?, 0, ?)
                ON CONFLICT(email) DO UPDATE SET count = 0, locked_until = excluded.locked_until
            `).run(key, Date.now() + LOCKOUT_MS);
        } else {
            // Increment counter
            db.prepare(`
                INSERT INTO login_attempts (email, count, locked_until)
                VALUES (?, ?, 0)
                ON CONFLICT(email) DO UPDATE SET count = excluded.count, locked_until = 0
            `).run(key, count);
        }
    } catch {
        // fail silently — rate limiting is best-effort
    }
}

export function clearAttempts(email: string): void {
    try {
        const db = getDb();
        db.prepare('DELETE FROM login_attempts WHERE email = ?').run(email.toLowerCase().trim());
    } catch {
        // fail silently
    }
}
