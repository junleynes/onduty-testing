import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import fs from 'fs';
import path from 'path';

/**
 * GET /api/backup
 *
 * Downloads a full backup zip (database + uploads folder).
 *
 * Authentication: Bearer token using the import_api_key stored in key_value_store.
 *
 * Response: application/zip stream with Content-Disposition: attachment
 *
 * Example:
 *   curl -H "Authorization: Bearer YOUR_API_KEY" https://your-onduty.com/api/backup -o backup.zip
 */
export async function GET(req: NextRequest) {
    const db = getDb();

    // Auth check
    const authHeader = req.headers.get('authorization') ?? '';
    const apiKey = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : req.headers.get('x-api-key');
    const storedRow = db.prepare("SELECT value FROM key_value_store WHERE key = 'import_api_key'").get() as { value: string } | undefined;
    if (!storedRow?.value || apiKey !== storedRow.value) {
        return NextResponse.json({ success: false, error: 'Unauthorized.' }, { status: 401 });
    }

    try {
        const dbPath = path.join(process.cwd(), 'local.db');
        const uploadsDir = path.join(process.cwd(), 'uploads');

        db.pragma('wal_checkpoint(FULL)');

        const AdmZip = (await import('adm-zip')).default;
        const zip = new AdmZip();
        zip.addLocalFile(dbPath, '', 'local.db');

        if (fs.existsSync(uploadsDir)) {
            const addDir = (dir: string, zipPath: string) => {
                const entries = fs.readdirSync(dir, { withFileTypes: true });
                for (const entry of entries) {
                    const fullPath = path.join(dir, entry.name);
                    if (entry.isDirectory()) {
                        addDir(fullPath, zipPath ? `${zipPath}/${entry.name}` : entry.name);
                    } else {
                        zip.addLocalFile(fullPath, zipPath, entry.name);
                    }
                }
            };
            addDir(uploadsDir, 'uploads');
        }

        const buffer = zip.toBuffer();
        const { format } = await import('date-fns');
        const filename = `onduty-backup-${format(new Date(), 'yyyy-MM-dd-HHmm')}.zip`;

        // Audit
        try {
            const { logAudit } = await import('@/app/actions');
            await logAudit({ action: 'backup.api_download', detail: 'Backup downloaded via API', ip: req.headers.get('x-forwarded-for') ?? undefined });
        } catch { /* */ }

        return new NextResponse(buffer, {
            status: 200,
            headers: {
                'Content-Type': 'application/zip',
                'Content-Disposition': `attachment; filename="${filename}"`,
                'Content-Length': String(buffer.length),
            },
        });
    } catch (error) {
        return NextResponse.json({ success: false, error: (error as Error).message }, { status: 500 });
    }
}
