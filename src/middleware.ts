import { auth } from '@/auth';
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

// ── Rate limiter (in-memory, resets on restart) ───────────────────────────────
const rateLimitMap = new Map<string, { count: number; resetAt: number }>();

function getClientIp(req: NextRequest): string {
    // Behind nginx, the real client IP arrives in X-Forwarded-For (set this in
    // your nginx config: proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;)
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

setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of rateLimitMap) {
        if (now > entry.resetAt) rateLimitMap.delete(key);
    }
}, 5 * 60_000);

// ── Bot blocklist — only blocks clearly automated tools ────────────────────────
const BOT_UA = [/bot/i,/crawl/i,/spider/i,/scrape/i,/curl/i,/wget/i,
    /python-requests/i,/^axios/i,/go-http/i,/java\//i,/httpclient/i,
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

function isMaintenanceOn(req: NextRequest): boolean {
    return req.cookies.get('onduty_maintenance')?.value === '1';
}

export default auth((req) => {
    const { pathname } = req.nextUrl;
    const ip = getClientIp(req);

    // ── 1. Explicitly kill backup/restore API access ──────────────────────────
    // Backup and Restore are admin-panel-only operations (server actions called
    // directly from the UI). These HTTP routes no longer exist in the codebase,
    // but this blanket rule guarantees that even a stray/forgotten route file,
    // a misconfigured nginx location block, or a future regression can never
    // expose them again — they always 403 here before reaching any route handler.
    if (pathname.startsWith('/api/backup') || pathname.startsWith('/api/restore')) {
        return new NextResponse(
            JSON.stringify({ success: false, error: 'This endpoint has been removed. Use Admin Panel > Backup & Restore.' }),
            { status: 410, headers: { 'Content-Type': 'application/json' } }
        );
    }

    // 2. Block obvious bots/scripts — never blocks a normal browser
    if (looksLikeBot(req) && !hasApiKey(req)) {
        return new NextResponse('Forbidden', { status: 403 });
    }

    // 3. Global rate limit — generous ceiling for genuine abuse, not normal use
    if (isRateLimited(`global:${ip}`, 600, 60_000)) {
        return new NextResponse('Too Many Requests', { status: 429, headers: { 'Retry-After': '30' } });
    }

    // 4. Always-allow routes
    const alwaysAllow = ['/maintenance', '/login', '/forgot-password', '/reset-password', '/api/auth'];
    if (alwaysAllow.some(r => pathname.startsWith(r))) {
        if (pathname.startsWith('/api/auth/callback') && req.method === 'POST') {
            if (isRateLimited(`login:${ip}`, 15, 60_000)) {
                return new NextResponse('Too Many Requests', { status: 429, headers: { 'Retry-After': '30' } });
            }
        }
        return NextResponse.next();
    }

    // 5. Remaining external API routes — still require an API key
    //    (backup/restore deliberately excluded — see rule #1 above)
    const externalApis = ['/api/import-schedule', '/api/reports'];
    if (externalApis.some(r => pathname.startsWith(r))) {
        if (!hasApiKey(req)) {
            return new NextResponse(JSON.stringify({ success: false, error: 'Missing API key.' }),
                { status: 401, headers: { 'Content-Type': 'application/json' } });
        }
        if (isRateLimited(`api:${ip}`, 100, 60_000)) {
            return new NextResponse(JSON.stringify({ success: false, error: 'Rate limit exceeded.' }),
                { status: 429, headers: { 'Content-Type': 'application/json', 'Retry-After': '30' } });
        }
        return NextResponse.next();
    }

    // 6. Maintenance mode — only redirects non-admins
    if (isMaintenanceOn(req)) {
        const role = (req.auth?.user as any)?.role;
        if (role !== 'admin' && role !== 'super_admin') {
            return NextResponse.redirect(new URL('/maintenance', req.url));
        }
    }

    // 7. Must be authenticated
    if (!req.auth) {
        const loginUrl = new URL('/login', req.url);
        loginUrl.searchParams.set('callbackUrl', pathname);
        return NextResponse.redirect(loginUrl);
    }

    return NextResponse.next();
});

export const config = {
    matcher: ['/((?!_next/static|_next/image|favicon.ico|public|.*\\.(?:png|jpg|jpeg|gif|svg|ico|webp|woff|woff2|ttf|css|js)$).*)'],
};
