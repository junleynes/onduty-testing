'use client';
import dynamic from 'next/dynamic';

const ForgotPasswordPage = dynamic(() => import('@/components/forgot-password-page'), { ssr: false });
export default function ForgotPassword() { return <ForgotPasswordPage />; }
