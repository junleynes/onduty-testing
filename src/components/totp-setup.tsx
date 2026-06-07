'use client';

import React, { useState } from 'react';
import { setupTotp, enableTotp, disableTotp } from '@/app/totp-actions';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useToast } from '@/hooks/use-toast';
import { ShieldCheck, ShieldOff, ShieldAlert } from 'lucide-react';
import Image from 'next/image';

type TotpSetupProps = {
  totpEnabled: boolean;
  onStatusChange: (enabled: boolean) => void;
};

export default function TotpSetup({ totpEnabled, onStatusChange }: TotpSetupProps) {
  const { toast } = useToast();
  const [isSetupOpen, setIsSetupOpen]       = useState(false);
  const [isDisableOpen, setIsDisableOpen]   = useState(false);
  const [qrDataUri, setQrDataUri]           = useState('');
  const [secret, setSecret]                 = useState('');
  const [code, setCode]                     = useState('');
  const [password, setPassword]             = useState('');
  const [isLoading, setIsLoading]           = useState(false);

  const handleStartSetup = async () => {
    setIsLoading(true);
    const result = await setupTotp();
    setIsLoading(false);
    if (!result.success) {
      toast({ variant: 'destructive', title: 'Setup Failed', description: result.error });
      return;
    }
    setQrDataUri(result.qrDataUri!);
    setSecret(result.secret!);
    setCode('');
    setIsSetupOpen(true);
  };

  const handleEnable = async () => {
    if (code.length !== 6) {
      toast({ variant: 'destructive', title: 'Invalid Code', description: 'Enter the 6-digit code from your authenticator app.' });
      return;
    }
    setIsLoading(true);
    const result = await enableTotp(code);
    setIsLoading(false);
    if (!result.success) {
      toast({ variant: 'destructive', title: 'Verification Failed', description: result.error });
      setCode('');
      return;
    }
    toast({ title: '2FA Enabled', description: 'Two-factor authentication is now active on your account.' });
    setIsSetupOpen(false);
    onStatusChange(true);
  };

  const handleDisable = async () => {
    setIsLoading(true);
    const result = await disableTotp(password);
    setIsLoading(false);
    if (!result.success) {
      toast({ variant: 'destructive', title: 'Failed', description: result.error });
      return;
    }
    toast({ title: '2FA Disabled', description: 'Two-factor authentication has been removed from your account.' });
    setIsDisableOpen(false);
    setPassword('');
    onStatusChange(false);
  };

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            {totpEnabled
              ? <><ShieldCheck className="h-5 w-5 text-green-500" /> Two-Factor Authentication</>
              : <><ShieldAlert className="h-5 w-5 text-amber-500" /> Two-Factor Authentication</>
            }
          </CardTitle>
          <CardDescription>
            {totpEnabled
              ? 'Your account is protected with an authenticator app (Google Authenticator, Authy, etc.).'
              : 'Add an extra layer of security. You\'ll need your authenticator app each time you sign in.'}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {totpEnabled ? (
            <Button variant="destructive" onClick={() => setIsDisableOpen(true)}>
              <ShieldOff className="h-4 w-4 mr-2" /> Disable 2FA
            </Button>
          ) : (
            <Button onClick={handleStartSetup} disabled={isLoading}>
              <ShieldCheck className="h-4 w-4 mr-2" />
              {isLoading ? 'Generating...' : 'Set Up 2FA'}
            </Button>
          )}
        </CardContent>
      </Card>

      {/* Setup Dialog */}
      <Dialog open={isSetupOpen} onOpenChange={setIsSetupOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Set Up Two-Factor Authentication</DialogTitle>
            <DialogDescription>
              Scan the QR code with your authenticator app, then enter the 6-digit code to confirm.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-5 py-2">
            <div className="flex flex-col items-center gap-3">
              {qrDataUri && (
                <div className="border-2 border-border rounded-lg p-3 bg-white">
                  <img src={qrDataUri} alt="QR Code" width={200} height={200} />
                </div>
              )}
              <p className="text-xs text-muted-foreground text-center">
                Can't scan? Enter this key manually:
              </p>
              <code className="text-xs font-mono bg-muted px-3 py-1.5 rounded-md tracking-widest select-all">
                {secret.match(/.{1,4}/g)?.join(' ')}
              </code>
            </div>
            <div className="space-y-2">
              <Label htmlFor="totp-code">Verification Code</Label>
              <Input
                id="totp-code"
                type="text"
                inputMode="numeric"
                maxLength={6}
                placeholder="000000"
                className="text-center text-xl tracking-widest font-mono"
                value={code}
                onChange={e => setCode(e.target.value.replace(/\D/g, ''))}
                autoFocus
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setIsSetupOpen(false)}>Cancel</Button>
            <Button onClick={handleEnable} disabled={isLoading || code.length !== 6}>
              {isLoading ? 'Verifying...' : 'Enable 2FA'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Disable Dialog */}
      <Dialog open={isDisableOpen} onOpenChange={setIsDisableOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Disable Two-Factor Authentication</DialogTitle>
            <DialogDescription>
              Enter your password to confirm. Your account will no longer require an authenticator code.
            </DialogDescription>
          </DialogHeader>
          <div className="py-2 space-y-2">
            <Label htmlFor="confirm-password">Current Password</Label>
            <Input
              id="confirm-password"
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              autoFocus
            />
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => { setIsDisableOpen(false); setPassword(''); }}>Cancel</Button>
            <Button variant="destructive" onClick={handleDisable} disabled={isLoading || !password}>
              {isLoading ? 'Disabling...' : 'Disable 2FA'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
