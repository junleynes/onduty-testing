import type { Metadata } from 'next';
import './globals.css';
import { Toaster } from "@/components/ui/toaster";
import { SessionProvider } from 'next-auth/react';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { getMaintenanceMode } from '@/app/actions';

export const metadata: Metadata = {
  title: 'OnDuty',
  description: 'Modern Duty Scheduling',
  manifest: '/manifest.json',
  icons: { icon: '/favicon.ico' },
};

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const headersList = await headers();
  const pathname = headersList.get('x-invoke-path') || '';

  // Skip maintenance check for the maintenance page itself, login, and API routes
  const isExempt = pathname.startsWith('/maintenance') ||
                   pathname.startsWith('/login') ||
                   pathname.startsWith('/api/') ||
                   pathname.startsWith('/forgot-password') ||
                   pathname.startsWith('/reset-password');

  if (!isExempt) {
    const { enabled } = await getMaintenanceMode();
    if (enabled) {
      const session = await auth();
      const role = (session?.user as any)?.role;
      // Only admins can bypass maintenance mode
      if (role !== 'admin' && role !== 'super_admin') {
        redirect('/maintenance');
      }
    }
  }

  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet" />
        <meta name="theme-color" content="#ffffff" />
      </head>
      <body className="font-body antialiased">
        <SessionProvider>
          {children}
          <Toaster />
        </SessionProvider>
      </body>
    </html>
  );
}
