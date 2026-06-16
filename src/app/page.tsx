'use client';
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

export default function Page() { return <AppClient />; }
