
'use client';

import React, { useState, useEffect, useTransition, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/hooks/use-toast';
import { LayoutGrid, AlertTriangle, CheckCircle, Loader2 } from 'lucide-react';
import { verifyPasswordResetToken, resetPasswordWithToken } from '@/app/actions';
import Link from 'next/link';
import { validatePassword, passwordStrength, PASSWORD_RULES } from '@/lib/password-rules';

function ResetPasswordContent() {
    const router = useRouter();
    const searchParams = useSearchParams();
    const { toast } = useToast();
    
    const [password, setPassword] = useState('');
    const [confirmPassword, setConfirmPassword] = useState('');
    const [isPending, startTransition] = useTransition();
    const [verificationState, setVerificationState] = useState<'verifying' | 'valid' | 'invalid'>('verifying');
    const [error, setError] = useState<string | null>(null);
    const [success, setSuccess] = useState(false);
    
    const token = searchParams.get('token');

    useEffect(() => {
        if (!token) {
            setVerificationState('invalid');
            setError('No reset token provided. The link may be incomplete.');
            return;
        }

        async function verifyToken() {
            const result = await verifyPasswordResetToken(token!);
            if (result.success) {
                setVerificationState('valid');
            } else {
                setVerificationState('invalid');
                setError(result.error || 'The link is invalid or has expired.');
            }
        }
        verifyToken();
    }, [token]);


    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (password !== confirmPassword) {
            toast({ variant: 'destructive', title: 'Passwords do not match.' });
            return;
        }
        const { valid, errors } = validatePassword(password);
        if (!valid) {
            toast({ variant: 'destructive', title: 'Password too weak', description: errors[0] });
            return;
        }

        startTransition(async () => {
            const result = await resetPasswordWithToken(token!, password);
            if (result.success) {
                setSuccess(true);
                toast({ title: 'Password Reset Successfully', description: 'You can now log in with your new password.' });
            } else {
                setError(result.error || 'Failed to reset password.');
                setVerificationState('invalid'); // The token might have just expired
            }
        });
    };

    const renderContent = () => {
        if (verificationState === 'verifying') {
            return (
                <CardContent className="flex justify-center items-center h-24">
                    <Loader2 className="h-8 w-8 animate-spin text-primary" />
                </CardContent>
            );
        }

        if (success) {
            return (
                 <CardContent className="text-center">
                    <CheckCircle className="h-16 w-16 text-green-500 mx-auto mb-4" />
                    <p>Your password has been updated successfully.</p>
                    <Button asChild variant="default" className="mt-4">
                        <Link href="/login">Proceed to Login</Link>
                    </Button>
                </CardContent>
            )
        }

        if (verificationState === 'invalid' || !token) {
            return (
                 <CardContent className="text-center">
                    <AlertTriangle className="h-16 w-16 text-destructive mx-auto mb-4" />
                    <p className="text-destructive">{error || 'This link is invalid or has expired.'}</p>
                     <Button asChild variant="link" className="mt-4">
                        <Link href="/forgot-password">Request a new link</Link>
                    </Button>
                </CardContent>
            )
        }

        return (
             <form onSubmit={handleSubmit}>
                <CardContent className="grid gap-4">
                    <div className="grid gap-2">
                        <Label htmlFor="password">New Password</Label>
                        <Input
                            id="password"
                            type="password"
                            required
                            value={password}
                            onChange={(e) => setPassword(e.target.value)}
                        />
                    </div>
                    {password && (
                        <div className="space-y-1.5">
                            <div className="flex gap-1">
                                {(['weak','fair','strong'] as const).map(level => {
                                    const s = passwordStrength(password);
                                    const active = level === 'weak' ? true : level === 'fair' ? s !== 'weak' : s === 'strong';
                                    const color = s === 'weak' ? 'bg-red-500' : s === 'fair' ? 'bg-amber-500' : 'bg-green-500';
                                    return <div key={level} className={`h-1.5 flex-1 rounded-full ${active ? color : 'bg-muted'}`} />;
                                })}
                            </div>
                            <ul className="space-y-0.5">
                                {PASSWORD_RULES.map(rule => (
                                    <li key={rule.message} className={`text-xs flex items-center gap-1.5 ${rule.test(password) ? 'text-green-600' : 'text-muted-foreground'}`}>
                                        <span>{rule.test(password) ? '✓' : '○'}</span>{rule.message}
                                    </li>
                                ))}
                            </ul>
                        </div>
                    )}
                     <div className="grid gap-2">
                        <Label htmlFor="confirmPassword">Confirm New Password</Label>
                        <Input
                            id="confirmPassword"
                            type="password"
                            required
                            value={confirmPassword}
                            onChange={(e) => setConfirmPassword(e.target.value)}
                        />
                        {confirmPassword && (
                            <p className={`text-xs ${password === confirmPassword ? 'text-green-600' : 'text-destructive'}`}>
                                {password === confirmPassword ? '✓ Passwords match' : '○ Passwords do not match'}
                            </p>
                        )}
                    </div>
                </CardContent>
                <CardFooter>
                    <Button type="submit" className="w-full" disabled={isPending}>
                        {isPending ? 'Resetting...' : 'Reset Password'}
                    </Button>
                </CardFooter>
            </form>
        )
    };

  return (
    <div className="flex items-center justify-center min-h-screen bg-background">
      <Card className="w-full max-w-sm">
        <CardHeader className="text-center">
          <div className="flex justify-center items-center gap-2 mb-4">
            <LayoutGrid className="h-8 w-8 text-primary" />
            <h1 className="text-3xl font-bold text-primary tracking-tight">OnDuty</h1>
          </div>
          <CardTitle className="text-2xl">Reset Your Password</CardTitle>
          <CardDescription>
            Enter and confirm your new password below.
          </CardDescription>
        </CardHeader>
        {renderContent()}
      </Card>
    </div>
  );
}

export default function ResetPasswordPage() {
    return (
        <Suspense fallback={<div>Loading...</div>}>
            <ResetPasswordContent />
        </Suspense>
    )
}
