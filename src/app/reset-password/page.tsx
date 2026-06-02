'use client';
import dynamic from 'next/dynamic';

const ResetPasswordPage = dynamic(() => import('@/components/reset-password-page'), { ssr: false });
export default function ResetPassword() { return <ResetPasswordPage />; }
