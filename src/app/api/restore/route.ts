import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import fs from 'fs';
import path from 'path';

/**
 * POST /api/restore
 *
 * Restores the database and uploads folder from a backup zip (or legacy .db).
 * The server will need a restart after restore — this endpoint triggers a process exit.
 *
 * Authentication: Bearer token using the import_api_key stored in key_value_store.
 *
 * Body: multipart/form-data with a field named "file" containing the .zip or .db backup.
 *
 * Example:
 *   curl -X POST \
 *     -H "Authorization: Bearer YOUR_API_KEY" \
 *     -F "file=@onduty-backup-2026-06-11-1200.zip" \
 *     https://your-onduty.com/api/restore
 */
export async function POST(req: NextRequest) {
    const db = getDb();

    // Auth check
    const { extractApiKey, isValidApiKey } = await import('@/lib/api-auth');
    const apiKey = extractApiKey(req);
    if (!isValidApiKey(apiKey)) {
        return NextResponse.json({ success: false, error: 'Unauthorized.' }, { status: 401 });
    }

    try {
        const formData = await req.formData();
        const file = formData.get('file') as File | null;
        if (!file) {
            return NextResponse.json({ success: false, error: 'No file provided. Send a multipart/form-data body with a "file" field.' }, { status: 400 });
        }

        const arrayBuffer = await file.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);
        const dbPath = path.join(process.cwd(), 'local.db');

        const isZip = buffer[0] === 0x50 && buffer[1] === 0x4B;

        const { dbInstance } = await import('@/lib/db');
        if (dbInstance) dbInstance.close();

        if (isZip) {
            const AdmZip = (await import('adm-zip')).default;
            const zip = new AdmZip(buffer);
            for (const entry of zip.getEntries()) {
                if (entry.isDirectory) continue;
                const entryName = entry.entryName;
                if (entryName === 'local.db') {
                    fs.writeFileSync(dbPath, entry.getData());
                } else if (entryName.startsWith('uploads/')) {
                    const destPath = path.join(process.cwd(), entryName);
                    fs.mkdirSync(path.dirname(destPath), { recursive: true });
                    fs.writeFileSync(destPath, entry.getData());
                }
            }
        } else {
            fs.writeFileSync(dbPath, buffer);
        }

        // Schedule process restart to reinitialize the DB connection
        setTimeout(() => process.exit(0), 500);

        return NextResponse.json({ success: true, message: 'Restore complete. Server is restarting.' });
    } catch (error) {
        return NextResponse.json({ success: false, error: (error as Error).message }, { status: 500 });
    }
}
