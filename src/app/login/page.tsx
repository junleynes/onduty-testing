
'use client';

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/hooks/use-toast';
import { LayoutGrid } from 'lucide-react';
import { verifyUser } from '@/app/actions';
import Link from 'next/link';


export default function LoginPage() {
  const router = useRouter();
  const { toast } = useToast();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);

    const result = await verifyUser(email, password);

    if (result.success && result.user) {
        toast({
          title: 'Login Successful',
          description: `Welcome back, ${result.user.firstName}!`,
        });
        // FIX #2: strip password before storing in localStorage — server action
        // already strips it, but guard here too in case type changes
        const { password: _pw, ...safeUser } = result.user as any;
        localStorage.setItem('currentUser', JSON.stringify(safeUser));
        router.push('/');
      } else {
        toast({
          variant: 'destructive',
          title: 'Login Failed',
          description: result.error || 'Invalid email or password. Please try again.',
        });
        setIsLoading(false);
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
          <CardTitle className="text-2xl">Login</CardTitle>
          <CardDescription>Enter your email below to login to your account.</CardDescription>
        </CardHeader>
        <form onSubmit={handleLogin}>
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
            <div className="grid gap-2">
                <Label htmlFor="password">Password</Label>
                <Input 
                 id="password" 
                 type="password" 
                 required
                 value={password}
                 onChange={(e) => setPassword(e.target.value)}
                />
            </div>
            </CardContent>
            <CardFooter className="flex flex-col gap-4">
              <Button type="submit" className="w-full" disabled={isLoading}>
                  {isLoading ? 'Signing in...' : 'Sign in'}
              </Button>
              <Link
                  href="/forgot-password"
                  className="text-sm underline"
              >
                  Forgot your password?
              </Link>
            </CardFooter>
        </form>
      </Card>
    </div>
  );
}
