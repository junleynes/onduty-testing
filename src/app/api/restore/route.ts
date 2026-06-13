import { NextRequest, NextResponse } from 'next/server';
import { extractApiKey, isValidApiKey } from '@/lib/api-auth';
import fs from 'fs';
import path from 'path';

// 50 MB hard limit — prevents OOM from a weaponised upload
const MAX_BYTES = 50 * 1024 * 1024;

export async function POST(req: NextRequest) {
    // ── Auth ──────────────────────────────────────────────────────────────────
    if (!isValidApiKey(extractApiKey(req))) {
        return NextResponse.json({ success: false, error: 'Unauthorized.' }, { status: 401 });
    }

    // ── Size guard (Content-Length header, fast-fail) ─────────────────────────
    const contentLength = Number(req.headers.get('content-length') ?? '0');
    if (contentLength > MAX_BYTES) {
        return NextResponse.json({ success: false, error: 'Payload too large. Maximum backup size is 50 MB.' }, { status: 413 });
    }

    try {
        const formData = await req.formData();
        const file = formData.get('file') as File | null;
        if (!file) {
            return NextResponse.json({ success: false, error: 'No file provided. Send multipart/form-data with a "file" field.' }, { status: 400 });
        }

        // ── Secondary size check on the actual bytes ──────────────────────────
        if (file.size > MAX_BYTES) {
            return NextResponse.json({ success: false, error: 'File too large. Maximum backup size is 50 MB.' }, { status: 413 });
        }

        const buffer = Buffer.from(await file.arrayBuffer());
        const dbPath = path.join(process.cwd(), 'local.db');

        // Validate magic bytes — must be ZIP (PK\x03\x04) or SQLite3 (\x53\x51\x4C\x69)
        const isZip    = buffer[0] === 0x50 && buffer[1] === 0x4B;
        const isSqlite = buffer.slice(0, 16).toString('utf8') === 'SQLite format 3\x00';
        if (!isZip && !isSqlite) {
            return NextResponse.json({ success: false, error: 'Invalid file type. Upload a .zip backup or a .db SQLite file.' }, { status: 400 });
        }

        // ── Close DB before overwrite ─────────────────────────────────────────
        const dbModule = await import('@/lib/db');
        if ((dbModule as any).dbInstance?.open) (dbModule as any).dbInstance.close();
        (dbModule as any).dbInstance = null;

        if (isZip) {
            const AdmZip = (await import('adm-zip')).default;
            const zip = new AdmZip(buffer);
            const dbEntry = zip.getEntry('local.db');
            if (!dbEntry) return NextResponse.json({ success: false, error: 'No local.db found inside the zip.' }, { status: 400 });

            fs.writeFileSync(dbPath, dbEntry.getData());

            // Restore uploads — only allow paths that stay inside uploads/
            for (const entry of zip.getEntries()) {
                if (entry.isDirectory || !entry.entryName.startsWith('uploads/')) continue;
                const rel  = entry.entryName.slice('uploads/'.length);
                // Reject path traversal attempts
                if (rel.includes('..') || path.isAbsolute(rel)) continue;
                const dest = path.join(process.cwd(), 'uploads', rel);
                fs.mkdirSync(path.dirname(dest), { recursive: true });
                fs.writeFileSync(dest, entry.getData());
            }
        } else {
            fs.writeFileSync(dbPath, buffer);
        }

        // Graceful restart — let the current response flush before exit
        setTimeout(() => process.exit(0), 800);

        return NextResponse.json({ success: true, message: 'Restore complete. Server is restarting.' });
    } catch (error) {
        return NextResponse.json({ success: false, error: (error as Error).message }, { status: 500 });
    }
}
