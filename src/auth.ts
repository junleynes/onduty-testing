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
            },
            async authorize(credentials) {
                const email    = (credentials?.email    as string || '').toLowerCase().trim();
                const password =  credentials?.password as string || '';

                if (!email || !password) return null;

                try {
                    // All Node.js-dependent imports are dynamic so they never
                    // get bundled into the Edge Runtime middleware
                    const { getDb }                         = await import('@/lib/db');
                    const bcrypt                            = await import('bcryptjs');
                    const { isLocked, trackFailed, clearAttempts } = await import('@/lib/rate-limit');

                    if (isLocked(email)) return null;

                    const db   = getDb();
                    const user = db.prepare('SELECT * FROM employees WHERE email = ?').get(email) as any;

                    if (!user) {
                        trackFailed(email);
                        // Audit: unknown email
                        try {
                            db.prepare(`INSERT INTO audit_logs (action, detail) VALUES ('login.failed', ?)`).run(`Failed login attempt for unknown email: ${email}`);
                        } catch { /* */ }
                        return null;
                    }

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

                    if (!isMatch) {
                        trackFailed(email);
                        try {
                            db.prepare(`INSERT INTO audit_logs (actor_id, actor_name, action, detail) VALUES (?, ?, 'login.failed', ?)`).run(user.id, `${user.firstName} ${user.lastName}`, `Wrong password for ${email}`);
                        } catch { /* */ }
                        return null;
                    }

                    clearAttempts(email);

                    // Audit: successful login
                    try {
                        const db2 = getDb();
                        db2.prepare(`
                            INSERT INTO audit_logs (actor_id, actor_name, action, detail)
                            VALUES (?, ?, 'login.success', ?)
                        `).run(user.id, `${user.firstName} ${user.lastName}`, `Login from ${user.email}`);
                    } catch { /* never block login */ }

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
                } catch {
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
