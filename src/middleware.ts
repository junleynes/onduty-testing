export const runtime = 'nodejs';  // allows fs, path, better-sqlite3 in middleware

import { auth } from '@/auth';
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import fs from 'fs';
import path from 'path';

// ── Rate limiter ──────────────────────────────────────────────────────────────
const rateLimitMap = new Map<string, { count: number; resetAt: number }>();

function getClientIp(req: NextRequest): string {
    return req.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
        ?? req.headers.get('x-real-ip') ?? '127.0.0.1';
}

function isRateLimited(key: string, limit: number, windowMs: number): boolean {
    const now = Date.now();
    const entry = rateLimitMap.get(key);
    if (!entry || now > entry.resetAt) {
        rateLimitMap.set(key, { count: 1, resetAt: now + windowMs });
        return false;
    }
    entry.count++;
    return entry.count > limit;
}

// ── Bot blocklist ─────────────────────────────────────────────────────────────
const BOT_UA = [/bot/i,/crawl/i,/spider/i,/scrape/i,/curl/i,/wget/i,
    /python-requests/i,/axios/i,/go-http/i,/java\//i,/httpclient/i,
    /libwww/i,/zgrab/i,/masscan/i,/nmap/i,/nuclei/i,/sqlmap/i,/nikto/i,
    /dirbuster/i,/wfuzz/i];

function looksLikeBot(req: NextRequest): boolean {
    const ua = req.headers.get('user-agent') ?? '';
    if (!ua) return true;
    return BOT_UA.some(p => p.test(ua));
}

function hasApiKey(req: NextRequest): boolean {
    const a = req.headers.get('authorization') ?? '';
    return a.startsWith('Bearer ') || !!req.headers.get('x-api-key');
}

// ── Maintenance flag — read from .maintenance file in project root ────────────
function isMaintenanceOn(): boolean {
    try {
        const flagFile = path.join(process.cwd(), '.maintenance');
        return fs.existsSync(flagFile);
    } catch { return false; }
}

export default auth((req) => {
    const { pathname } = req.nextUrl;
    const ip = getClientIp(req);

    // 1. Block bots
    if (looksLikeBot(req)) {
        return new NextResponse('Forbidden', { status: 403 });
    }

    // 2. Global rate limit: 120/60s per IP
    if (isRateLimited(ip, 120, 60_000)) {
        return new NextResponse('Too Many Requests', { status: 429, headers: { 'Retry-After': '60' } });
    }

    // 3. Always allow these routes
    const alwaysAllow = ['/maintenance', '/login', '/forgot-password', '/reset-password', '/api/auth'];
    if (alwaysAllow.some(r => pathname.startsWith(r))) {
        if (pathname.startsWith('/login') || pathname.startsWith('/api/auth/callback')) {
            if (isRateLimited(`login:${ip}`, 10, 60_000)) {
                return new NextResponse('Too Many Requests', { status: 429, headers: { 'Retry-After': '60' } });
            }
        }
        return NextResponse.next();
    }

    // 4. External API routes — require API key
    const externalApis = ['/api/import-schedule', '/api/backup', '/api/restore', '/api/reports'];
    if (externalApis.some(r => pathname.startsWith(r))) {
        if (!hasApiKey(req)) {
            return new NextResponse(JSON.stringify({ success: false, error: 'Missing API key.' }),
                { status: 401, headers: { 'Content-Type': 'application/json' } });
        }
        if (isRateLimited(`api:${ip}`, 60, 60_000)) {
            return new NextResponse(JSON.stringify({ success: false, error: 'Rate limit exceeded.' }),
                { status: 429, headers: { 'Content-Type': 'application/json', 'Retry-After': '60' } });
        }
        return NextResponse.next();
    }

    // 5. Maintenance mode check — read flag file written by setMaintenanceMode action
    if (isMaintenanceOn()) {
        const role = (req.auth?.user as any)?.role;
        if (role !== 'admin' && role !== 'super_admin') {
            return NextResponse.redirect(new URL('/maintenance', req.url));
        }
    }

    // 6. Must be authenticated
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
