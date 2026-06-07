/**
 * rate-limit.ts — Unified server-side login rate limiting.
 *
 * Single source of truth used by both auth.ts (NextAuth authorize)
 * and actions.ts (verifyUser). Previously each had its own Map,
 * allowing attackers to bypass one by hitting the other endpoint.
 */

const attempts = new Map<string, { count: number; lockedUntil: number }>();

export const MAX_ATTEMPTS = 5;
export const LOCKOUT_MS   = 15 * 60 * 1000; // 15 minutes

export function isLocked(key: string): boolean {
    const record = attempts.get(key);
    if (!record) return false;
    if (record.lockedUntil > Date.now()) return true;
    // Lockout expired — clear it
    attempts.delete(key);
    return false;
}

export function trackFailed(key: string): void {
    const now    = Date.now();
    const record = attempts.get(key) || { count: 0, lockedUntil: 0 };
    record.count += 1;
    if (record.count >= MAX_ATTEMPTS) {
        record.lockedUntil = now + LOCKOUT_MS;
        record.count       = 0;
    }
    attempts.set(key, record);
}

export function clearAttempts(key: string): void {
    attempts.delete(key);
}
