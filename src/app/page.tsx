import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { getMaintenanceMode } from '@/app/actions';
import dynamic from 'next/dynamic';

const AppClient = dynamic(
    () => import('@/components/app-client'),
    {
        ssr: false,
        loading: () => (
            <div style={{ display:'flex', alignItems:'center', justifyContent:'center', height:'100vh', fontFamily:'system-ui,sans-serif', color:'#6b7280', fontSize:'16px' }}>
                Loading OnDuty...
            </div>
        ),
    }
);

export default async function Page() {
    // Maintenance check — runs server-side, can read DB safely
    try {
        const { enabled } = await getMaintenanceMode();
        if (enabled) {
            const session = await auth();
            const role = (session?.user as any)?.role;
            if (role !== 'admin' && role !== 'super_admin') {
                redirect('/maintenance');
            }
        }
    } catch {
        // If check fails (e.g. first boot before DB is ready), allow through
    }

    return <AppClient />;
}
