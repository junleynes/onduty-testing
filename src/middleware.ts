import { auth } from '@/auth';
import { NextResponse } from 'next/server';

export default auth((req) => {
    const { pathname } = req.nextUrl;

    // Public routes — no auth required
    const publicRoutes = ['/login', '/forgot-password', '/reset-password', '/api/auth'];
    const isPublic = publicRoutes.some(r => pathname.startsWith(r));
    if (isPublic) return NextResponse.next();

    // API import route uses its own API key auth
    if (pathname.startsWith('/api/import-schedule')) return NextResponse.next();

    // Not authenticated — redirect to login
    if (!req.auth) {
        const loginUrl = new URL('/login', req.url);
        loginUrl.searchParams.set('callbackUrl', pathname);
        return NextResponse.redirect(loginUrl);
    }

    return NextResponse.next();
});

export const config = {
    matcher: ['/((?!_next/static|_next/image|favicon.ico|public).*)'],
};
