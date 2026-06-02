import dynamic from 'next/dynamic';

const LoginClient = dynamic(
    () => import('@/components/login-client'),
    { ssr: false }
);

export default function LoginPage() {
    return <LoginClient />;
}
