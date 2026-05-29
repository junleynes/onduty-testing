/**
 * file-storage.ts
 * 
 * Stores all binary files (avatars, signatures, screenshots, PDF templates,
 * generated PDFs) on local disk instead of as base64 blobs in SQLite.
 * 
 * Directory structure:
 *   {UPLOAD_DIR}/avatars/{employeeId}.{ext}
 *   {UPLOAD_DIR}/signatures/{employeeId}.{ext}
 *   {UPLOAD_DIR}/templates/{key}.pdf
 *   {UPLOAD_DIR}/pdfs/{leaveId}.pdf
 *   {UPLOAD_DIR}/screenshots/{allowanceId}.{ext}
 */

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

// Upload directory — outside .next and src so it survives rebuilds and deploys
const UPLOAD_DIR = process.env.UPLOAD_DIR || path.join(process.cwd(), 'uploads');

const DIRS = {
    avatars:     path.join(UPLOAD_DIR, 'avatars'),
    signatures:  path.join(UPLOAD_DIR, 'signatures'),
    templates:   path.join(UPLOAD_DIR, 'templates'),
    pdfs:        path.join(UPLOAD_DIR, 'pdfs'),
    screenshots: path.join(UPLOAD_DIR, 'screenshots'),
};

// Ensure all upload directories exist
export function ensureUploadDirs() {
    Object.values(DIRS).forEach(dir => {
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    });
}

/**
 * Saves a base64 data URI to disk and returns the file path.
 * If a file already exists for the given key, it is replaced.
 */
function saveBase64(base64DataUri: string, dir: string, filename: string): string {
    ensureUploadDirs();
    
    // Parse data URI: data:{mime};base64,{data}
    const match = base64DataUri.match(/^data:([^;]+);base64,(.+)$/);
    if (!match) {
        // Plain base64 without data URI prefix (e.g. PDF template stored raw)
        const buffer = Buffer.from(base64DataUri, 'base64');
        const filePath = path.join(dir, filename);
        fs.writeFileSync(filePath, buffer);
        return filePath;
    }
    
    const buffer = Buffer.from(match[2], 'base64');
    const filePath = path.join(dir, filename);
    fs.writeFileSync(filePath, buffer);
    return filePath;
}

/**
 * Reads a file from disk and returns it as a base64 data URI.
 * Returns null if the file doesn't exist.
 */
function readAsBase64(filePath: string, mimeType: string): string | null {
    if (!filePath || !fs.existsSync(filePath)) return null;
    const buffer = fs.readFileSync(filePath);
    return `data:${mimeType};base64,${buffer.toString('base64')}`;
}

/**
 * Reads a file from disk and returns it as a raw base64 string (no data URI prefix).
 * Used for PDF templates which are stored/used as raw base64.
 */
function readAsRawBase64(filePath: string): string | null {
    if (!filePath || !fs.existsSync(filePath)) return null;
    return fs.readFileSync(filePath).toString('base64');
}

function deleteFile(filePath: string) {
    if (filePath && fs.existsSync(filePath)) {
        try { fs.unlinkSync(filePath); } catch (_) {}
    }
}

function getExtFromDataUri(dataUri: string): string {
    const match = dataUri.match(/^data:([^;]+);base64,/);
    if (!match) return 'bin';
    const mime = match[1];
    const map: Record<string, string> = {
        'image/jpeg': 'jpg', 'image/jpg': 'jpg', 'image/png': 'png',
        'image/gif': 'gif', 'image/webp': 'webp', 'image/svg+xml': 'svg',
        'application/pdf': 'pdf',
    };
    return map[mime] || 'bin';
}

// ── Avatar ────────────────────────────────────────────────────────────────────

export function saveAvatar(employeeId: string, dataUri: string): string {
    const ext = getExtFromDataUri(dataUri);
    // Remove any old avatar files for this employee
    ['jpg','jpeg','png','gif','webp','svg'].forEach(e => {
        const old = path.join(DIRS.avatars, `${employeeId}.${e}`);
        deleteFile(old);
    });
    const filename = `${employeeId}.${ext}`;
    saveBase64(dataUri, DIRS.avatars, filename);
    return `/uploads/avatars/${filename}`;
}

export function readAvatar(employeeId: string): string | null {
    for (const ext of ['jpg','jpeg','png','gif','webp','svg']) {
        const filePath = path.join(DIRS.avatars, `${employeeId}.${ext}`);
        if (fs.existsSync(filePath)) {
            return readAsBase64(filePath, `image/${ext === 'jpg' ? 'jpeg' : ext}`);
        }
    }
    return null;
}

export function deleteAvatar(employeeId: string) {
    ['jpg','jpeg','png','gif','webp','svg'].forEach(ext => {
        deleteFile(path.join(DIRS.avatars, `${employeeId}.${ext}`));
    });
}

// ── Signature ─────────────────────────────────────────────────────────────────

export function saveSignature(employeeId: string, dataUri: string): string {
    const ext = getExtFromDataUri(dataUri);
    ['jpg','jpeg','png','gif','webp','svg'].forEach(e => {
        deleteFile(path.join(DIRS.signatures, `${employeeId}.${e}`));
    });
    const filename = `${employeeId}.${ext}`;
    saveBase64(dataUri, DIRS.signatures, filename);
    return `/uploads/signatures/${filename}`;
}

export function readSignature(employeeId: string): string | null {
    for (const ext of ['jpg','jpeg','png','gif','webp','svg']) {
        const filePath = path.join(DIRS.signatures, `${employeeId}.${ext}`);
        if (fs.existsSync(filePath)) {
            return readAsBase64(filePath, `image/${ext === 'jpg' ? 'jpeg' : ext}`);
        }
    }
    return null;
}

export function deleteSignature(employeeId: string) {
    ['jpg','jpeg','png','gif','webp','svg'].forEach(ext => {
        deleteFile(path.join(DIRS.signatures, `${employeeId}.${ext}`));
    });
}

// ── PDF Template ──────────────────────────────────────────────────────────────

export function saveTemplate(key: string, base64: string): string {
    // Templates may be raw base64 or data URIs
    const filename = `${key}.pdf`;
    const filePath = path.join(DIRS.templates, filename);
    const match = base64.match(/^data:[^;]+;base64,(.+)$/);
    const rawBase64 = match ? match[1] : base64;
    fs.writeFileSync(filePath, Buffer.from(rawBase64, 'base64'));
    return filePath;
}

export function readTemplate(key: string): string | null {
    const filePath = path.join(DIRS.templates, `${key}.pdf`);
    return readAsRawBase64(filePath);
}

export function templateExists(key: string): boolean {
    return fs.existsSync(path.join(DIRS.templates, `${key}.pdf`));
}

// ── Generated PDF (leave forms) ───────────────────────────────────────────────

export function savePdf(leaveId: string, dataUri: string): string {
    const filename = `${leaveId}.pdf`;
    saveBase64(dataUri, DIRS.pdfs, filename);
    return path.join(DIRS.pdfs, filename);
}

export function readPdf(leaveId: string): string | null {
    const filePath = path.join(DIRS.pdfs, `${leaveId}.pdf`);
    return readAsBase64(filePath, 'application/pdf');
}

export function pdfExists(leaveId: string): boolean {
    return fs.existsSync(path.join(DIRS.pdfs, `${leaveId}.pdf`));
}

export function deletePdf(leaveId: string) {
    deleteFile(path.join(DIRS.pdfs, `${leaveId}.pdf`));
}

// ── Allowance Screenshot ──────────────────────────────────────────────────────

export function saveScreenshot(allowanceId: string, dataUri: string): string {
    const ext = getExtFromDataUri(dataUri);
    ['jpg','jpeg','png','gif','webp'].forEach(e => {
        deleteFile(path.join(DIRS.screenshots, `${allowanceId}.${e}`));
    });
    const filename = `${allowanceId}.${ext}`;
    saveBase64(dataUri, DIRS.screenshots, filename);
    return `/uploads/screenshots/${filename}`;
}

export function readScreenshot(allowanceId: string): string | null {
    for (const ext of ['jpg','jpeg','png','gif','webp']) {
        const filePath = path.join(DIRS.screenshots, `${allowanceId}.${ext}`);
        if (fs.existsSync(filePath)) {
            return readAsBase64(filePath, `image/${ext === 'jpg' ? 'jpeg' : ext}`);
        }
    }
    return null;
}

export function deleteScreenshot(allowanceId: string) {
    ['jpg','jpeg','png','gif','webp'].forEach(ext => {
        deleteFile(path.join(DIRS.screenshots, `${allowanceId}.${ext}`));
    });
}
