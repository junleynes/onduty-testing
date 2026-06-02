/**
 * Main app page — server component wrapper.
 * 
 * Uses next/dynamic with ssr: false to prevent AppClient from rendering
 * on the server. This avoids all SSR-related errors:
 * - useSession() behavior during server render
 * - getData() server action needing a live auth session
 * - Any browser-only APIs in the component tree
 */
import dynamic from 'next/dynamic';

// ssr: false = AppClient only renders in the browser, never on the server
const AppClient = dynamic(
    () => import('@/components/app-client'),
    {
        ssr: false,
        loading: () => (
            <div style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                height: '100vh',
                fontFamily: 'system-ui, sans-serif',
                color: '#6b7280',
                fontSize: '16px',
            }}>
                Loading OnDuty...
            </div>
        ),
    }
);

export default function Page() {
    return <AppClient />;
}
