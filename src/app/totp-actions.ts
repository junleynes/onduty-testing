'use server';

import { authenticator } from 'otplib';
import QRCode from 'qrcode';
import { requireAuth, requireAdmin } from '@/lib/auth-guard';
import { auth } from '@/auth';
import { getDb } from '@/lib/db';

const APP_NAME = 'OnDuty';

/** Admin only — enable and generate TOTP for a specific user, returns QR + secret */
export async function adminSetupTotp(userId: string): Promise<{ success: boolean; secret?: string; qrDataUri?: string; userEmail?: string; error?: string }> {
    try {
        await requireAdmin();
        const db = getDb();
        const user = db.prepare('SELECT id, email, totpEnabled FROM employees WHERE id = ?').get(userId) as any;
        if (!user) return { success: false, error: 'User not found.' };

        const secret = authenticator.generateSecret(20);
        db.prepare('UPDATE employees SET totpSecret = @secret, totpEnabled = 1 WHERE id = @id').run({ secret, id: userId });

        const otpauth = authenticator.keyuri(user.email, APP_NAME, secret);
        const qrDataUri = await QRCode.toDataURL(otpauth);

        return { success: true, secret, qrDataUri, userEmail: user.email };
    } catch (err) {
        return { success: false, error: (err as Error).message };
    }
}

/** Admin only — disable and clear TOTP for a specific user */
export async function adminDisableTotp(userId: string): Promise<{ success: boolean; error?: string }> {
    try {
        await requireAdmin();
        const db = getDb();
        db.prepare('UPDATE employees SET totpEnabled = 0, totpSecret = NULL WHERE id = ?').run(userId);
        return { success: true };
    } catch (err) {
        return { success: false, error: (err as Error).message };
    }
}

/** Admin only — disable 2FA for ALL users at once */
export async function adminDisableAllTotp(): Promise<{ success: boolean; error?: string }> {
    try {
        await requireAdmin();
        const db = getDb();
        db.prepare('UPDATE employees SET totpEnabled = 0, totpSecret = NULL').run();
        return { success: true };
    } catch (err) {
        return { success: false, error: (err as Error).message };
    }
}

/** Get 2FA status for all employees — admin use */
export async function getTotpStatusAll(): Promise<{ success: boolean; statuses?: Record<string, boolean>; error?: string }> {
    try {
        await requireAuth();
        const db = getDb();
        const rows = db.prepare('SELECT id, totpEnabled FROM employees').all() as any[];
        const statuses: Record<string, boolean> = {};
        rows.forEach(r => { statuses[r.id] = !!r.totpEnabled; });
        return { success: true, statuses };
    } catch (err) {
        return { success: false, error: (err as Error).message };
    }
}

/** Check whether a user has 2FA enabled (used at login) */
export async function getTotpStatus(userId: string): Promise<{ enabled: boolean }> {
    try {
        const db = getDb();
        const user = db.prepare('SELECT totpEnabled FROM employees WHERE id = ?').get(userId) as any;
        return { enabled: !!(user?.totpEnabled) };
    } catch {
        return { enabled: false };
    }
}
