/**
 * auth-guard.ts
 * 
 * Server-side authorization helpers for server actions.
 * Every sensitive server action must call one of these before doing anything.
 */

import { auth } from '@/auth';

export type AuthSession = {
    id:    string;
    email: string;
    role:  string;
    name:  string;
};

/** Throws if not authenticated. Returns the session user. */
export async function requireAuth(): Promise<AuthSession> {
    const session = await auth();
    if (!session?.user?.id) {
        throw new Error('Unauthorized: you must be logged in.');
    }
    return session.user as AuthSession;
}

/** Throws if not admin. Returns the session user. */
export async function requireAdmin(): Promise<AuthSession> {
    const user = await requireAuth();
    if (user.role !== 'admin') {
        throw new Error('Forbidden: admin access required.');
    }
    return user;
}

/** Throws if not admin or manager. Returns the session user. */
export async function requireManager(): Promise<AuthSession> {
    const user = await requireAuth();
    if (user.role !== 'admin' && user.role !== 'manager') {
        throw new Error('Forbidden: manager or admin access required.');
    }
    return user;
}

/** Returns null if not authenticated (non-throwing version). */
export async function getSession(): Promise<AuthSession | null> {
    const session = await auth();
    if (!session?.user?.id) return null;
    return session.user as AuthSession;
}
