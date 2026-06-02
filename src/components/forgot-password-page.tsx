
'use client';

import React, { useState, useTransition } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/hooks/use-toast';
import { LayoutGrid, Mail, CheckCircle } from 'lucide-react';
import { sendPasswordResetLink } from '@/app/actions';
import Link from 'next/link';
import { getData } from '@/lib/db-actions';

export default function ForgotPasswordPage() {
  const { toast } = useToast();
  const [email, setEmail] = useState('');
  const [isPending, startTransition] = useTransition();
  const [emailSent, setEmailSent] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    startTransition(async () => {
        const {data} = await getData(); // We need SMTP settings
        if (!data?.smtpSettings) {
            toast({
                variant: 'destructive',
                title: 'Action Failed',
                description: 'SMTP settings are not configured. Cannot send email.',
            });
            return;
        }

        const origin = window.location.origin;
        const result = await sendPasswordResetLink(email, origin, data.smtpSettings);

        if (result.success) {
            setEmailSent(true);
        } else {
            toast({
                variant: 'destructive',
                title: 'Failed to Send Email',
                description: result.error || 'An unknown error occurred.',
            });
        }
    });
  };

  return (
    <div className="flex items-center justify-center min-h-screen bg-background">
      <Card className="w-full max-w-sm">
        <CardHeader className="text-center">
          <div className="flex justify-center items-center gap-2 mb-4">
            <LayoutGrid className="h-8 w-8 text-primary" />
            <h1 className="text-3xl font-bold text-primary tracking-tight">OnDuty</h1>
          </div>
          <CardTitle className="text-2xl">Forgot Password</CardTitle>
          <CardDescription>
            {emailSent
              ? 'Check your email for a link to reset your password.'
              : 'Enter your email and we will send you a link to reset your password.'}
          </CardDescription>
        </CardHeader>
        {emailSent ? (
          <CardContent className="text-center">
            <CheckCircle className="h-16 w-16 text-green-500 mx-auto mb-4" />
            <p>If an account exists for {email}, you will receive an email with instructions.</p>
            <Button asChild variant="link" className="mt-4">
                <Link href="/login">Back to Login</Link>
            </Button>
          </CardContent>
        ) : (
          <form onSubmit={handleSubmit}>
            <CardContent className="grid gap-4">
              <div className="grid gap-2">
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  type="email"
                  placeholder="m@example.com"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </div>
            </CardContent>
            <CardFooter className="flex flex-col gap-4">
              <Button type="submit" className="w-full" disabled={isPending}>
                {isPending ? 'Sending...' : 'Send Reset Link'}
              </Button>
               <Button asChild variant="link" className="w-full">
                <Link href="/login">Back to Login</Link>
              </Button>
            </CardFooter>
          </form>
        )}
      </Card>
    </div>
  );
}
