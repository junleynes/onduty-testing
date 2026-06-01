/**
 * Server component wrapper for the main app page.
 * 
 * 'use client' components cannot use export const dynamic = 'force-dynamic'.
 * This server wrapper sets dynamic rendering so Next.js never tries to
 * statically prerender the page at build time (which would fail because
 * getData() requires a live DB and auth session).
 */
export const dynamic = 'force-dynamic';

import AppClient from '@/components/app-client';

export default function Page() {
    return <AppClient />;
}
