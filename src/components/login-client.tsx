'use client';

import React, { useState } from 'react';
import { signIn } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/hooks/use-toast';
import { LayoutGrid, ShieldCheck } from 'lucide-react';
import Link from 'next/link';

type Step = 'credentials' | 'totp';

export default function LoginPage() {
  const router = useRouter();
  const { toast } = useToast();

  const [step, setStep]         = useState<Step>('credentials');
  const [email, setEmail]       = useState('');
  const [password, setPassword] = useState('');
  const [totpCode, setTotpCode] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);

    const result = await signIn('credentials', {
      email: email.toLowerCase().trim(),
      password,
      totpCode: step === 'totp' ? totpCode.trim() : '',
      redirect: false,
    });

    setIsLoading(false);

    if (result?.ok && !result?.error) {
      toast({ title: 'Login Successful', description: 'Welcome back!' });
      router.push('/');
      router.refresh();
      return;
    }

    const errCode = result?.error ?? '';

    if (errCode.includes('TOTP_REQUIRED')) {
      // Password was correct — now need the authenticator code
      setStep('totp');
      setTotpCode('');
      return;
    }

    if (errCode.includes('TOTP_INVALID')) {
      toast({ variant: 'destructive', title: '2FA Failed', description: 'Invalid authenticator code. Please try again.' });
      setTotpCode('');
      return;
    }

    const msg = errCode.includes('TOO_MANY_ATTEMPTS')
      ? 'Too many failed attempts. Please try again in 15 minutes.'
      : 'Invalid email or password.';
    toast({ variant: 'destructive', title: 'Login Failed', description: msg });
  };

  return (
    <div className="flex items-center justify-center min-h-screen bg-background">
      <Card className="w-full max-w-sm">
        <CardHeader className="text-center">
          <div className="flex justify-center items-center gap-2 mb-4">
            <LayoutGrid className="h-8 w-8 text-primary" />
            <h1 className="text-3xl font-bold text-primary tracking-tight">OnDuty</h1>
          </div>
          {step === 'credentials' ? (
            <>
              <CardTitle className="text-2xl">Login</CardTitle>
              <CardDescription>Enter your email below to login to your account.</CardDescription>
            </>
          ) : (
            <>
              <div className="flex justify-center mb-2">
                <ShieldCheck className="h-10 w-10 text-primary" />
              </div>
              <CardTitle className="text-2xl">Two-Factor Auth</CardTitle>
              <CardDescription>
                Open your authenticator app and enter the 6-digit code for <strong>OnDuty</strong>.
              </CardDescription>
            </>
          )}
        </CardHeader>

        <form onSubmit={handleLogin}>
          <CardContent className="grid gap-4">
            {step === 'credentials' ? (
              <>
                <div className="grid gap-2">
                  <Label htmlFor="email">Email</Label>
                  <Input id="email" type="email" placeholder="m@example.com" required
                    value={email} onChange={e => setEmail(e.target.value)} />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="password">Password</Label>
                  <Input id="password" type="password" required
                    value={password} onChange={e => setPassword(e.target.value)} />
                </div>
              </>
            ) : (
              <div className="grid gap-2">
                <Label htmlFor="totp">Authenticator Code</Label>
                <Input
                  id="totp"
                  type="text"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  maxLength={6}
                  placeholder="000000"
                  required
                  className="text-center text-2xl tracking-widest font-mono"
                  value={totpCode}
                  onChange={e => setTotpCode(e.target.value.replace(/\D/g, ''))}
                  autoFocus
                />
              </div>
            )}
          </CardContent>

          <CardFooter className="flex flex-col gap-3">
            <Button type="submit" className="w-full" disabled={isLoading}>
              {isLoading
                ? (step === 'totp' ? 'Verifying...' : 'Signing in...')
                : (step === 'totp' ? 'Verify Code' : 'Sign in')}
            </Button>
            {step === 'totp' && (
              <Button type="button" variant="ghost" className="w-full text-sm"
                onClick={() => { setStep('credentials'); setTotpCode(''); }}>
                ← Back to login
              </Button>
            )}
            {step === 'credentials' && (
              <Link href="/forgot-password" className="text-sm underline text-center">
                Forgot your password?
              </Link>
            )}
          </CardFooter>
        </form>
      </Card>
    </div>
  );
}
