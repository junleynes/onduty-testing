/**
 * auth.ts — NextAuth configuration
 *
 * IMPORTANT: This file is imported by middleware which runs in Edge Runtime.
 * It must NOT import anything that uses Node.js APIs (fs, path, better-sqlite3).
 * DB access happens only in the authorize() callback which runs server-side only.
 *
 * Rate limiting is handled by src/lib/rate-limit.ts (single shared Map).
 */
import NextAuth from 'next-auth';
import Credentials from 'next-auth/providers/credentials';
import { isLocked, trackFailed, clearAttempts } from '@/lib/rate-limit';

if (!process.env.NEXTAUTH_SECRET) {
    throw new Error(
        'NEXTAUTH_SECRET environment variable is not set. ' +
        'Generate one with: openssl rand -base64 32'
    );
}

export const { handlers, signIn, signOut, auth } = NextAuth({
    providers: [
        Credentials({
            name: 'credentials',
            credentials: {
                email:    { label: 'Email',    type: 'email'    },
                password: { label: 'Password', type: 'password' },
                totpCode: { label: '2FA Code', type: 'text'     },
            },
            async authorize(credentials) {
                const email    = (credentials?.email    as string || '').toLowerCase().trim();
                const password =  credentials?.password as string || '';
                const totpCode =  credentials?.totpCode as string || '';

                if (!email || !password) return null;

                // Unified rate limiting
                if (isLocked(email)) return null;

                try {
                    const { getDb } = await import('@/lib/db');
                    const bcrypt    = await import('bcryptjs');

                    const db   = getDb();
                    const user = db.prepare('SELECT * FROM employees WHERE email = ?').get(email) as any;

                    if (!user) { trackFailed(email); return null; }

                    // Password check — auto-upgrade plaintext to bcrypt
                    let isMatch = false;
                    if (user.password?.startsWith('$2')) {
                        isMatch = await bcrypt.compare(password, user.password);
                    } else if (user.password) {
                        isMatch = user.password === password;
                        if (isMatch) {
                            const hashed = await bcrypt.hash(password, 12);
                            db.prepare('UPDATE employees SET password = ? WHERE id = ?').run(hashed, user.id);
                        }
                    }

                    if (!isMatch) { trackFailed(email); return null; }

                    // 2FA check — skipped when login-client has already verified via verifyTotpAtLogin()
                    if (user.totpEnabled && user.totpSecret && totpCode !== '__SKIP__') {
                        if (!totpCode) throw new Error('TOTP_REQUIRED');
                        const { verifySync } = await import('otplib');
                        const result = verifySync({ token: totpCode.trim(), secret: user.totpSecret, type: 'totp' });
                        if (!result.valid) { trackFailed(email); return null; }
                    }

                    clearAttempts(email);

                    return {
                        id:             user.id,
                        email:          user.email,
                        name:           `${user.firstName} ${user.lastName}`.trim(),
                        firstName:      user.firstName,
                        lastName:       user.lastName,
                        role:           user.role,
                        group:          user.group,
                        employeeNumber: user.employeeNumber,
                        position:       user.position,
                        phone:          user.phone,
                    } as any;
                } catch (err) {
                    // Re-throw known signals so login-client can handle them
                    const msg = (err as Error).message;
                    if (msg === 'TOTP_REQUIRED' || msg === 'TOTP_INVALID') throw err;
                    return null;
                }
            },
        }),
    ],

    callbacks: {
        async jwt({ token, user }) {
            if (user) {
                token.id             = (user as any).id;
                token.role           = (user as any).role;
                token.firstName      = (user as any).firstName;
                token.lastName       = (user as any).lastName;
                token.group          = (user as any).group;
                token.employeeNumber = (user as any).employeeNumber;
                token.position       = (user as any).position;
                token.phone          = (user as any).phone;
            }
            return token;
        },
        async session({ session, token }) {
            session.user.id             = token.id             as string;
            session.user.role           = token.role           as string;
            session.user.firstName      = token.firstName      as string;
            session.user.lastName       = token.lastName       as string;
            session.user.group          = token.group          as string;
            session.user.employeeNumber = token.employeeNumber as string;
            session.user.position       = token.position       as string;
            session.user.phone          = token.phone          as string;
            return session;
        },
    },

    pages: {
        signIn: '/login',
        error:  '/login',
    },

    session: {
        strategy: 'jwt',
        maxAge:   8 * 60 * 60, // 8 hours
    },

    trustHost: true,
    secret: process.env.NEXTAUTH_SECRET,
});
