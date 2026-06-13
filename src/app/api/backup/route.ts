import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { extractApiKey, isValidApiKey } from '@/lib/api-auth';
import fs from 'fs';
import path from 'path';

export async function GET(req: NextRequest) {
    // ── Auth ──────────────────────────────────────────────────────────────────
    if (!isValidApiKey(extractApiKey(req))) {
        return NextResponse.json({ success: false, error: 'Unauthorized.' }, { status: 401 });
    }

    try {
        const db = getDb();
        const dbPath = path.join(process.cwd(), 'local.db');
        const uploadsDir = path.join(process.cwd(), 'uploads');

        db.pragma('wal_checkpoint(FULL)');

        const AdmZip = (await import('adm-zip')).default;
        const zip = new AdmZip();
        zip.addLocalFile(dbPath, '', 'local.db');

        if (fs.existsSync(uploadsDir)) {
            const addDir = (dir: string, zipPath: string) => {
                for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
                    const full = path.join(dir, entry.name);
                    if (entry.isDirectory()) addDir(full, zipPath ? `${zipPath}/${entry.name}` : entry.name);
                    else zip.addLocalFile(full, zipPath, entry.name);
                }
            };
            addDir(uploadsDir, 'uploads');
        }

        const buffer = zip.toBuffer();
        const { format } = await import('date-fns');
        const filename = `onduty-backup-${format(new Date(), 'yyyy-MM-dd-HHmm')}.zip`;

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
