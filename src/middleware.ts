import { auth } from '@/auth';
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

// ── Rate limiter (in-memory, resets on restart) ───────────────────────────────
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

// Periodically clean up old entries so the map doesn't grow forever
setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of rateLimitMap) {
        if (now > entry.resetAt) rateLimitMap.delete(key);
    }
}, 5 * 60_000);

// ── Bot blocklist — only blocks clearly automated tools, not browsers ─────────
const BOT_UA = [/bot/i,/crawl/i,/spider/i,/scrape/i,/curl/i,/wget/i,
    /python-requests/i,/^axios/i,/go-http/i,/java\//i,/httpclient/i,
    /libwww/i,/zgrab/i,/masscan/i,/nmap/i,/nuclei/i,/sqlmap/i,/nikto/i,
    /dirbuster/i,/wfuzz/i];

function looksLikeBot(req: NextRequest): boolean {
    const ua = req.headers.get('user-agent') ?? '';
    if (!ua) return true; // no UA at all = almost certainly a script
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

    // 1. Block obvious bots/scripts only — never blocks a normal browser
    if (looksLikeBot(req) && !hasApiKey(req)) {
        return new NextResponse('Forbidden', { status: 403 });
    }

    // 2. Global rate limit — generous, this is a normal logged-in app with many
    //    asset/data requests per page. 600 requests / 60s per IP is the ceiling
    //    for genuine abuse, not normal browsing.
    if (isRateLimited(`global:${ip}`, 600, 60_000)) {
        return new NextResponse('Too Many Requests', {
            status: 429, headers: { 'Retry-After': '30' },
        });
    }

    // 3. Always-allow routes
    const alwaysAllow = ['/maintenance', '/login', '/forgot-password', '/reset-password', '/api/auth'];
    if (alwaysAllow.some(r => pathname.startsWith(r))) {
        // Tighter limit only on actual login POSTs — prevents brute force,
        // doesn't affect normal page loads/refreshes of the login screen
        if (pathname.startsWith('/api/auth/callback') && req.method === 'POST') {
            if (isRateLimited(`login:${ip}`, 15, 60_000)) {
                return new NextResponse('Too Many Requests', { status: 429, headers: { 'Retry-After': '30' } });
            }
        }
        return NextResponse.next();
    }

    // 4. External API routes — require API key, separate rate bucket
    const externalApis = ['/api/import-schedule', '/api/backup', '/api/restore', '/api/reports'];
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

    // 5. Maintenance mode — only redirects non-admins
    if (isMaintenanceOn(req)) {
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
    matcher: ['/((?!_next/static|_next/image|favicon.ico|public|.*\\.(?:png|jpg|jpeg|gif|svg|ico|webp|woff|woff2|ttf|css|js)$).*)'],
};
