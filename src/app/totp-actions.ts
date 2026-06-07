'use server';

import { authenticator } from 'otplib';
import QRCode from 'qrcode';
import { requireAuth } from '@/lib/auth-guard';
import { auth } from '@/auth';

const APP_NAME = 'OnDuty';

/** Generate a new TOTP secret + QR code data URI for the current user. */
export async function setupTotp(): Promise<{ success: boolean; secret?: string; qrDataUri?: string; error?: string }> {
    try {
        await requireAuth();
        const session = await auth();
        if (!session?.user?.id) return { success: false, error: 'Not authenticated' };

        const { getDb } = await import('@/lib/db');
        const db = getDb();

        // Generate fresh secret
        const secret = authenticator.generateSecret(20);

        // Store as pending (not yet verified/enabled)
        db.prepare('UPDATE employees SET totpSecret = @secret, totpEnabled = 0 WHERE id = @id')
          .run({ secret, id: session.user.id });

        const otpauth = authenticator.keyuri(session.user.email!, APP_NAME, secret);
        const qrDataUri = await QRCode.toDataURL(otpauth);

        return { success: true, secret, qrDataUri };
    } catch (err) {
        return { success: false, error: (err as Error).message };
    }
}

/** Verify the 6-digit code and enable 2FA for the current user. */
export async function enableTotp(code: string): Promise<{ success: boolean; error?: string }> {
    try {
        await requireAuth();
        const session = await auth();
        if (!session?.user?.id) return { success: false, error: 'Not authenticated' };

        const { getDb } = await import('@/lib/db');
        const db = getDb();

        const user = db.prepare('SELECT totpSecret FROM employees WHERE id = ?').get(session.user.id) as any;
        if (!user?.totpSecret) return { success: false, error: 'No TOTP setup found. Please scan the QR code first.' };

        const isValid = authenticator.verify({ token: code.trim(), secret: user.totpSecret });
        if (!isValid) return { success: false, error: 'Invalid code. Please try again.' };

        db.prepare('UPDATE employees SET totpEnabled = 1 WHERE id = ?').run(session.user.id);
        return { success: true };
    } catch (err) {
        return { success: false, error: (err as Error).message };
    }
}

/** Disable 2FA for the current user (requires current password confirmation). */
export async function disableTotp(password: string): Promise<{ success: boolean; error?: string }> {
    try {
        await requireAuth();
        const session = await auth();
        if (!session?.user?.id) return { success: false, error: 'Not authenticated' };

        const { getDb } = await import('@/lib/db');
        const bcrypt    = await import('bcryptjs');
        const db        = getDb();

        const user = db.prepare('SELECT password FROM employees WHERE id = ?').get(session.user.id) as any;
        const ok   = await bcrypt.compare(password, user.password || '');
        if (!ok) return { success: false, error: 'Incorrect password.' };

        db.prepare('UPDATE employees SET totpEnabled = 0, totpSecret = NULL WHERE id = ?').run(session.user.id);
        return { success: true };
    } catch (err) {
        return { success: false, error: (err as Error).message };
    }
}

/** Verify TOTP code at login (called after password passes). */
export async function verifyTotpCode(userId: string, code: string): Promise<{ success: boolean; error?: string }> {
    try {
        const { getDb } = await import('@/lib/db');
        const db = getDb();

        const user = db.prepare('SELECT totpSecret, totpEnabled FROM employees WHERE id = ?').get(userId) as any;
        if (!user?.totpEnabled || !user?.totpSecret) return { success: true }; // 2FA not enabled — pass through

        const isValid = authenticator.verify({ token: code.trim(), secret: user.totpSecret });
        if (!isValid) return { success: false, error: 'Invalid authenticator code.' };

        return { success: true };
    } catch (err) {
        return { success: false, error: (err as Error).message };
    }
}

/** Check whether a user has 2FA enabled (used by login page to show TOTP field). */
export async function getTotpStatus(userId: string): Promise<{ enabled: boolean }> {
    try {
        const { getDb } = await import('@/lib/db');
        const db   = getDb();
        const user = db.prepare('SELECT totpEnabled FROM employees WHERE id = ?').get(userId) as any;
        return { enabled: !!(user?.totpEnabled) };
    } catch {
        return { enabled: false };
    }
}
