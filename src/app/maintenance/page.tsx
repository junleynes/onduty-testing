import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { getDb } from '@/lib/db';

async function getMaintenanceMessage(): Promise<string> {
    try {
        const db = getDb();
        const row = db.prepare("SELECT value FROM key_value_store WHERE key = 'maintenance_message'").get() as { value: string } | undefined;
        return row?.value || "We're performing scheduled maintenance and will be back shortly. Thank you for your patience.";
    } catch {
        return "We're performing scheduled maintenance and will be back shortly.";
    }
}

export default async function MaintenancePage() {
    // If maintenance cookie is not set, the mode was turned off — go home
    const cookieStore = await cookies();
    const isOn = cookieStore.get('onduty_maintenance')?.value === '1';
    if (!isOn) redirect('/');

    const message = await getMaintenanceMessage();

    return (
        <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 dark:from-slate-900 dark:to-slate-800 flex items-center justify-center p-4">
            <div className="max-w-md w-full text-center space-y-6">

                {/* Icon */}
                <div className="flex justify-center">
                    <div className="h-20 w-20 rounded-2xl bg-orange-100 dark:bg-orange-900/30 flex items-center justify-center">
                        <svg className="h-10 w-10 text-orange-500" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M11.42 15.17L17.25 21A2.652 2.652 0 0021 17.25l-5.877-5.877M11.42 15.17l2.496-3.03c.317-.384.74-.626 1.208-.766M11.42 15.17l-4.655 5.653a2.548 2.548 0 11-3.586-3.586l6.837-5.63m5.108-.233c.55-.164 1.163-.188 1.743-.14a4.5 4.5 0 004.486-6.336l-3.276 3.277a3.004 3.004 0 01-2.25-2.25l3.276-3.276a4.5 4.5 0 00-6.336 4.486c.091 1.076-.071 2.264-.904 2.95l-.102.085m-1.745 1.437L5.909 7.5H4.5L2.25 3.75l1.5-1.5L7.5 4.5v1.409l4.26 4.26m-1.745 1.437l1.745-1.437m6.615 8.206L15.75 15.75M4.867 19.125h.008v.008h-.008v-.008z" />
                        </svg>
                    </div>
                </div>

                {/* Brand */}
                <div>
                    <h1 className="text-3xl font-bold text-slate-900 dark:text-slate-100">OnDuty</h1>
                </div>

                {/* Card */}
                <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-sm border border-slate-200 dark:border-slate-700 p-8 space-y-3">
                    <div className="inline-flex items-center gap-2 bg-orange-50 dark:bg-orange-900/20 text-orange-600 dark:text-orange-400 text-xs font-semibold px-3 py-1 rounded-full">
                        <span className="h-1.5 w-1.5 rounded-full bg-orange-500 animate-pulse" />
                        Under Maintenance
                    </div>
                    <h2 className="text-xl font-semibold text-slate-800 dark:text-slate-100">We&apos;ll be back soon</h2>
                    <p className="text-slate-500 dark:text-slate-400 leading-relaxed text-sm">{message}</p>
                </div>

                {/* Admin link */}
                <p className="text-xs text-slate-400">
                    Are you an admin?{' '}
                    <a href="/login" className="underline text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200">
                        Log in here
                    </a>
                </p>
            </div>
        </div>
    );
}
