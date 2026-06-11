import type { NextRequest } from 'next/server';
import { getDb } from '@/lib/db';

/**
 * Extracts the API key from Authorization: Bearer <key> or x-api-key header.
 */
export function extractApiKey(req: NextRequest): string | null {
    const auth = req.headers.get('authorization') ?? '';
    return auth.startsWith('Bearer ') ? auth.slice(7) : req.headers.get('x-api-key');
}

/**
 * Returns true if the provided key matches any key in the api_keys table,
 * or (for backward compat) matches the legacy import_api_key in key_value_store.
 */
export function isValidApiKey(key: string | null): boolean {
    if (!key) return false;
    const db = getDb();

    // Check named api_keys table (new)
    try {
        db.exec(`CREATE TABLE IF NOT EXISTS api_keys (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            key_value TEXT NOT NULL UNIQUE,
            created_at TEXT NOT NULL DEFAULT (datetime('now'))
        )`);
        const row = db.prepare('SELECT id FROM api_keys WHERE key_value = ?').get(key) as { id: string } | undefined;
        if (row) return true;
    } catch (_) {
        // table may not exist on older DBs — fall through to legacy check
    }

    // Backward compat: check legacy key_value_store entry
    const legacy = db.prepare("SELECT value FROM key_value_store WHERE key = 'import_api_key'").get() as { value: string } | undefined;
    return !!legacy?.value && key === legacy.value;
}
