import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/session';
import { existsSync, writeFileSync, mkdirSync, copyFileSync, rmSync } from 'fs';
import path from 'path';
import AdmZip from 'adm-zip';
import * as db from '@/lib/server-db';
import type { BrandingConfig, SystemConfig, SmtpConfig, AiConfig } from '@/lib/types';

const ROOT = process.cwd();
const DB_PATH = path.join(ROOT, 'data.db');
const UPLOADS_PATH = path.join(ROOT, 'uploads');
const SQLITE_MAGIC = Buffer.from('SQLite format 3\0', 'utf8');

// Replaces the live data.db on disk. Unlinks the old path before writing
// rather than truncating it in place — the running process still has the
// old file open via better-sqlite3, and truncating that same inode out
// from under an active connection risks corrupting whatever it's mid-read
// or mid-write on. Deleting first leaves the running connection's open
// handle fully isolated (Linux keeps unlinked-but-open inodes alive) until
// the process restarts and reopens the path fresh.
function replaceDatabaseFile(newDbBuffer: Buffer) {
  if (existsSync(DB_PATH)) {
    const safetyCopyPath = path.join(ROOT, `data.db.before-restore-${Date.now()}.bak`);
    copyFileSync(DB_PATH, safetyCopyPath);
    rmSync(DB_PATH);
  }
  writeFileSync(DB_PATH, newDbBuffer);

  // Clear out any WAL/SHM sidecar files left over from before the restore,
  // so a restarted process starts clean against the restored data.db
  // instead of replaying stale pages from the old database's WAL.
  for (const suffix of ['-wal', '-shm']) {
    const sidecar = `${DB_PATH}${suffix}`;
    if (existsSync(sidecar)) {
      try { rmSync(sidecar); } catch { /* best effort */ }
    }
  }
}

function restoreUploadsFromZip(zip: AdmZip): number {
  const uploadEntries = zip.getEntries().filter(e => !e.isDirectory && e.entryName.startsWith('uploads/'));
  const uploadsRoot = path.resolve(UPLOADS_PATH);
  let restoredCount = 0;
  for (const entry of uploadEntries) {
    const relativePath = entry.entryName.replace(/^uploads\//, '');
    if (!relativePath) continue;
    const destPath = path.resolve(uploadsRoot, relativePath);
    // Guard against zip-slip: a crafted entry name like
    // "uploads/../../../etc/cron.d/evil" would otherwise resolve outside
    // the uploads directory entirely. Skip anything that doesn't stay
    // within it instead of trusting the zip's internal paths.
    if (destPath !== uploadsRoot && !destPath.startsWith(uploadsRoot + path.sep)) {
      console.warn(`Skipping unsafe zip entry during restore: ${entry.entryName}`);
      continue;
    }
    mkdirSync(path.dirname(destPath), { recursive: true });
    writeFileSync(destPath, entry.getData());
    restoredCount++;
  }
  return restoredCount;
}

// Applies a settings.json export (branding/systemConfig/smtp/aiConfig) to
// the live database via the normal save functions — these go through the
// already-open connection and take effect immediately, no restart needed.
// Secrets (SMTP password, AI API key) are redacted in every export this
// app produces, so an incoming '[REDACTED]' or blank value is treated as
// "leave the current secret alone" rather than overwriting it.
async function restoreSettingsFromJson(parsed: any): Promise<string[]> {
  const restored: string[] = [];

  if (parsed.branding) {
    await db.saveBranding(parsed.branding as BrandingConfig);
    restored.push('branding');
  }
  if (parsed.systemConfig) {
    await db.saveSystemConfig(parsed.systemConfig as SystemConfig);
    restored.push('system constraints');
  }
  if (parsed.smtp) {
    const existing = await db.getSmtpConfig();
    const incoming = parsed.smtp as SmtpConfig;
    const pass = (!incoming.pass || incoming.pass === '[REDACTED]') ? (existing?.pass || '') : incoming.pass;
    await db.saveSmtpConfig({ ...incoming, pass });
    restored.push('SMTP settings');
  }
  if (parsed.aiConfig) {
    const existing = await db.getAiConfig();
    const incoming = parsed.aiConfig as AiConfig;
    const apiKey = (!incoming.apiKey || incoming.apiKey === '[REDACTED]') ? (existing?.apiKey || '') : incoming.apiKey;
    await db.saveAiConfig({ ...incoming, apiKey });
    restored.push('AI integration settings');
  }

  return restored;
}

export async function POST(req: NextRequest) {
  try {
    await requireAdmin();
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const formData = await req.formData();
    const file = formData.get('file');

    if (!file || !(file instanceof Blob)) {
      return NextResponse.json({ error: 'No backup file was uploaded.' }, { status: 400 });
    }

    const filename = (file as File).name || '';
    const ext = path.extname(filename).toLowerCase();
    const buffer = Buffer.from(await file.arrayBuffer());

    // --- .db: a raw SQLite database file ---
    if (ext === '.db') {
      if (!buffer.subarray(0, 16).equals(SQLITE_MAGIC)) {
        return NextResponse.json({ error: "That file doesn't look like a valid SQLite database." }, { status: 400 });
      }
      replaceDatabaseFile(buffer);
      return NextResponse.json({ success: true, kind: 'database', databaseRestored: true });
    }

    // --- .json: a settings-only export ---
    if (ext === '.json') {
      let parsed: any;
      try {
        parsed = JSON.parse(buffer.toString('utf8'));
      } catch {
        return NextResponse.json({ error: 'That file is not valid JSON.' }, { status: 400 });
      }
      const hasRecognizedKey = ['branding', 'systemConfig', 'smtp', 'aiConfig'].some(k => parsed?.[k]);
      if (!hasRecognizedKey) {
        return NextResponse.json({ error: "This doesn't look like a R.I.M.S settings export." }, { status: 400 });
      }
      const settingsRestored = await restoreSettingsFromJson(parsed);
      return NextResponse.json({ success: true, kind: 'settings', settingsRestored, databaseRestored: false });
    }

    // --- .zip: the full backup (database + uploads + settings) ---
    if (ext === '.zip') {
      let zip: AdmZip;
      try {
        zip = new AdmZip(buffer);
      } catch {
        return NextResponse.json({ error: 'That file is not a valid zip archive.' }, { status: 400 });
      }

      const dbEntry = zip.getEntry('data.db');
      const settingsEntry = zip.getEntry('settings.json');

      if (!dbEntry && !settingsEntry) {
        return NextResponse.json(
          { error: "This doesn't look like a R.I.M.S backup — no data.db or settings.json found inside the zip." },
          { status: 400 }
        );
      }

      let uploadsRestored = 0;
      let settingsRestored: string[] = [];

      if (dbEntry) {
        // data.db already contains branding/system/SMTP/AI settings as
        // tables (with real, non-redacted secrets) — restoring it makes
        // settings.json inside the same zip redundant, so it's
        // intentionally not also applied here.
        replaceDatabaseFile(dbEntry.getData());
        uploadsRestored = restoreUploadsFromZip(zip);
      } else if (settingsEntry) {
        const parsed = JSON.parse(settingsEntry.getData().toString('utf8'));
        settingsRestored = await restoreSettingsFromJson(parsed);
      }

      return NextResponse.json({
        success: true,
        kind: 'zip',
        uploadsRestored,
        settingsRestored,
        databaseRestored: !!dbEntry,
      });
    }

    return NextResponse.json(
      { error: 'Unsupported file type. Upload a .zip, .json, or .db backup file.' },
      { status: 400 }
    );
  } catch (err: any) {
    console.error('Restore error:', err);
    return NextResponse.json({ error: `Restore failed: ${err.message}` }, { status: 500 });
  }
}
