import NextAuth from 'next-auth';
import Credentials from 'next-auth/providers/credentials';
import { getDb } from '@/lib/db';
import bcrypt from 'bcryptjs';
import type { Employee } from '@/types';

// Login attempt tracking (mirrors actions.ts rate limiter)
const loginAttempts = new Map<string, { count: number; lockedUntil: number }>();
const MAX_ATTEMPTS = 5;
const LOCKOUT_MS = 15 * 60 * 1000;

export const { handlers, signIn, signOut, auth } = NextAuth({
    providers: [
        Credentials({
            name: 'credentials',
            credentials: {
                email:    { label: 'Email',    type: 'email'    },
                password: { label: 'Password', type: 'password' },
            },
            async authorize(credentials) {
                const email    = (credentials?.email    as string || '').toLowerCase().trim();
                const password =  credentials?.password as string || '';

                if (!email || !password) return null;

                // Rate limiting
                const now = Date.now();
                const record = loginAttempts.get(email);
                if (record && record.lockedUntil > now) return null;

                try {
                    const db = getDb();
                    const user = db.prepare('SELECT * FROM employees WHERE email = ?').get(email) as Employee & { password?: string } | undefined;

                    if (!user) {
                        trackFailedAttempt(email, now);
                        return null;
                    }

                    let isMatch = false;
                    if (user.password?.startsWith('$2')) {
                        isMatch = await bcrypt.compare(password, user.password);
                    } else if (user.password) {
                        // Plaintext legacy — compare then upgrade to bcrypt
                        isMatch = user.password === password;
                        if (isMatch) {
                            const hashed = await bcrypt.hash(password, 12);
                            db.prepare('UPDATE employees SET password = ? WHERE id = ?').run(hashed, user.id);
                        }
                    }

                    if (!isMatch) {
                        trackFailedAttempt(email, now);
                        return null;
                    }

                    loginAttempts.delete(email);

                    // Return user object for session (no password)
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
                } catch (e) {
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
        signIn:  '/login',
        error:   '/login',
    },

    session: {
        strategy: 'jwt',
        maxAge:   8 * 60 * 60, // 8 hours
    },

    secret: process.env.NEXTAUTH_SECRET || 'onduty-fallback-secret-change-in-production',
});

function trackFailedAttempt(email: string, now: number) {
    const attempts = loginAttempts.get(email) || { count: 0, lockedUntil: 0 };
    attempts.count += 1;
    if (attempts.count >= MAX_ATTEMPTS) {
        attempts.lockedUntil = now + LOCKOUT_MS;
        attempts.count = 0;
    }
    loginAttempts.set(email, attempts);
}
