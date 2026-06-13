import type { NextRequest } from 'next/server';
import { getDb } from '@/lib/db';

/** Extract API key from Authorization: Bearer <key> or x-api-key header */
export function extractApiKey(req: NextRequest): string | null {
    const auth = req.headers.get('authorization') ?? '';
    return auth.startsWith('Bearer ') ? auth.slice(7).trim() : (req.headers.get('x-api-key') ?? null);
}

/** Validate key against api_keys table (new) with fallback to legacy key_value_store entry */
export function isValidApiKey(key: string | null): boolean {
    if (!key || key.length < 8) return false;
    try {
        const db = getDb();
        // New: named api_keys table
        try {
            const row = db.prepare('SELECT id FROM api_keys WHERE key_value = ?').get(key) as { id: string } | undefined;
            if (row) return true;
        } catch { /* table may not exist on older installs */ }
        // Legacy: single key in key_value_store
        const legacy = db.prepare("SELECT value FROM key_value_store WHERE key = 'import_api_key'").get() as { value: string } | undefined;
        return !!legacy?.value && key === legacy.value;
    } catch {
        return false;
    }
}

/** Validate date range: both must be valid ISO dates, range ≤ maxDays */
export function validateDateRange(
    fromStr: string | null,
    toStr: string | null,
    maxDays = 366
): { ok: true; from: string; to: string } | { ok: false; error: string } {
    if (!fromStr || !toStr) return { ok: false, error: 'Missing required query params: from, to (ISO date, e.g. 2026-06-01).' };
    const from = new Date(fromStr);
    const to   = new Date(toStr);
    if (isNaN(from.getTime()) || isNaN(to.getTime())) return { ok: false, error: 'Invalid date format. Use ISO 8601, e.g. 2026-06-01.' };
    if (from > to) return { ok: false, error: '`from` must be before or equal to `to`.' };
    const days = Math.ceil((to.getTime() - from.getTime()) / 86_400_000) + 1;
    if (days > maxDays) return { ok: false, error: `Date range too large. Maximum is ${maxDays} days.` };
    // Re-normalise to YYYY-MM-DD to prevent injection via exotic date strings
    return {
        ok: true,
        from: from.toISOString().slice(0, 10),
        to:   to.toISOString().slice(0, 10),
    };
}
