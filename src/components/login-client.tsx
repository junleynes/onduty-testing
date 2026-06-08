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
import { verifyUser } from '@/app/actions';
import { getTotpStatus } from '@/app/totp-actions';

type Step = 'credentials' | 'totp';

export default function LoginPage() {
  const router = useRouter();
  const { toast } = useToast();

  const [step, setStep]           = useState<Step>('credentials');
  const [email, setEmail]         = useState('');
  const [password, setPassword]   = useState('');
  const [totpCode, setTotpCode]   = useState('');
  const [isLoading, setIsLoading] = useState(false);
  // Store verified userId between steps so we don't re-verify password on step 2
  const [verifiedUserId, setVerifiedUserId] = useState<string | null>(null);

  // ── Step 1: verify credentials via server action ──────────────────────────
  const handleCredentials = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);

    const result = await verifyUser(email.toLowerCase().trim(), password);
    setIsLoading(false);

    if (!result.success || !result.user) {
      toast({ variant: 'destructive', title: 'Login Failed', description: result.error || 'Invalid email or password.' });
      return;
    }

    // Check if this user has 2FA enabled
    const totpStatus = await getTotpStatus(result.user.id);
    if (totpStatus.enabled) {
      setVerifiedUserId(result.user.id);
      setStep('totp');
      setTotpCode('');
      return;
    }

    // No 2FA — sign in directly
    await completeSignIn();
  };

  // ── Step 2: verify TOTP then sign in ──────────────────────────────────────
  const handleTotp = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!verifiedUserId || totpCode.length !== 6) return;
    setIsLoading(true);

    // Import server action dynamically to verify TOTP
    const { verifyTotpAtLogin } = await import('@/app/totp-actions');
    const valid = await verifyTotpAtLogin(verifiedUserId, totpCode.trim());
    setIsLoading(false);

    if (!valid) {
      toast({ variant: 'destructive', title: '2FA Failed', description: 'Invalid authenticator code. Please try again.' });
      setTotpCode('');
      return;
    }

    await completeSignIn();
  };

  // ── Final sign-in (after all checks pass) ─────────────────────────────────
  const completeSignIn = async () => {
    setIsLoading(true);
    const result = await signIn('credentials', {
      email: email.toLowerCase().trim(),
      password,
      redirect: false,
    });
    setIsLoading(false);

    if (result?.ok) {
      router.push('/');
      router.refresh();
    } else {
      toast({ variant: 'destructive', title: 'Login Failed', description: 'Something went wrong. Please try again.' });
    }
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

        <form onSubmit={step === 'credentials' ? handleCredentials : handleTotp}>
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
            <Button type="submit" className="w-full" disabled={isLoading || (step === 'totp' && totpCode.length !== 6)}>
              {isLoading
                ? (step === 'totp' ? 'Verifying...' : 'Signing in...')
                : (step === 'totp' ? 'Verify Code' : 'Sign in')}
            </Button>
            {step === 'totp' && (
              <Button type="button" variant="ghost" className="w-full text-sm"
                onClick={() => { setStep('credentials'); setTotpCode(''); setVerifiedUserId(null); }}>
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
