'use client';

import React, { useRef, useTransition, useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { useToast } from '@/hooks/use-toast';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from './ui/alert-dialog';
import { backupDatabase, restoreDatabase, getMaintenanceMode, setMaintenanceMode } from '@/app/actions';
import { Loader2, Download, Upload, HardDrive, ShieldCheck, Construction, ToggleLeft, ToggleRight } from 'lucide-react';
import { format } from 'date-fns';

export default function BackupRestoreView() {
    const { toast } = useToast();
    const [isBackingUp,  startBackupTransition]  = useTransition();
    const [isRestoring,  startRestoreTransition]  = useTransition();
    const [isMaintSaving, startMaintTransition]   = useTransition();
    const restoreInputRef = useRef<HTMLInputElement>(null);

    const [lastBackupAt, setLastBackupAt] = useState<Date | null>(() => {
        if (typeof window === 'undefined') return null;
        const s = localStorage.getItem('onduty_last_backup');
        return s ? new Date(s) : null;
    });

    const [maintenanceEnabled, setMaintenanceEnabled] = useState(false);
    const [maintenanceMessage, setMaintenanceMessage] = useState(
        "We're performing scheduled maintenance and will be back shortly."
    );

    // Load maintenance state on mount
    useEffect(() => {
        getMaintenanceMode().then(r => {
            setMaintenanceEnabled(r.enabled);
            if (r.message) setMaintenanceMessage(r.message);
        });
    }, []);

    // ── Backup ────────────────────────────────────────────────────────────────
    const handleBackup = () => {
        startBackupTransition(async () => {
            const result = await backupDatabase();
            if (!result.success || !result.data) {
                toast({ variant: 'destructive', title: 'Backup Failed', description: result.error || 'Could not create backup.' });
                return;
            }
            const chars    = atob(result.data);
            const bytes    = new Uint8Array(chars.length);
            for (let i = 0; i < chars.length; i++) bytes[i] = chars.charCodeAt(i);
            const blob     = new Blob([bytes], { type: 'application/zip' });
            const url      = URL.createObjectURL(blob);
            const filename = result.filename ?? `onduty-backup-${format(new Date(), 'yyyy-MM-dd-HHmm')}.zip`;
            const a        = document.createElement('a');
            a.href = url; a.download = filename;
            document.body.appendChild(a); a.click(); document.body.removeChild(a);
            URL.revokeObjectURL(url);
            const now = new Date();
            setLastBackupAt(now);
            localStorage.setItem('onduty_last_backup', now.toISOString());
            toast({ title: 'Backup Downloaded', description: filename });
        });
    };

    // ── Restore ───────────────────────────────────────────────────────────────
    const handleRestoreFile = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;
        e.target.value = '';
        const reader = new FileReader();
        reader.onload = () => {
            const base64 = (reader.result as string).split(',')[1];
            startRestoreTransition(async () => {
                const result = await restoreDatabase(base64);
                if (result.success) {
                    toast({ title: 'Restore Successful', description: 'Database restored. The page will reload now.' });
                    setTimeout(() => window.location.reload(), 1500);
                } else {
                    toast({ variant: 'destructive', title: 'Restore Failed', description: result.error || 'Could not restore database.' });
                }
            });
        };
        reader.readAsDataURL(file);
    };

    // ── Maintenance toggle ────────────────────────────────────────────────────
    const handleMaintenanceToggle = () => {
        startMaintTransition(async () => {
            const newState = !maintenanceEnabled;
            const result = await setMaintenanceMode(newState, maintenanceMessage);
            if (result.success) {
                setMaintenanceEnabled(newState);
                toast({
                    title: newState ? 'Maintenance Mode ON' : 'Maintenance Mode OFF',
                    description: newState
                        ? 'Only admins can now access the site.'
                        : 'Site is now accessible to all users.',
                });
            } else {
                toast({ variant: 'destructive', title: 'Failed', description: result.error });
            }
        });
    };

    const handleSaveMessage = () => {
        startMaintTransition(async () => {
            await setMaintenanceMode(maintenanceEnabled, maintenanceMessage);
            toast({ title: 'Message Updated' });
        });
    };

    return (
        <div className="max-w-2xl mx-auto space-y-6">

            <div className="flex items-center gap-3">
                <HardDrive className="h-6 w-6 text-primary" />
                <div>
                    <h1 className="text-2xl font-bold">Backup &amp; Restore</h1>
                    <p className="text-sm text-muted-foreground">Manage database backups and site maintenance settings.</p>
                </div>
            </div>

            {/* Backup */}
            <Card>
                <CardHeader>
                    <CardTitle className="flex items-center gap-2"><Download className="h-4 w-4" /> Backup Database</CardTitle>
                    <CardDescription>
                        Downloads a <code className="text-xs bg-muted px-1 rounded">.zip</code> containing <code className="text-xs bg-muted px-1 rounded">local.db</code> and all uploaded files.
                    </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                    {lastBackupAt ? (
                        <p className="text-sm text-green-600 dark:text-green-400 font-medium flex items-center gap-2">
                            <ShieldCheck className="h-4 w-4" />
                            Last backup on this device: {format(lastBackupAt, 'MMM d, yyyy h:mm a')}
                        </p>
                    ) : (
                        <p className="text-sm text-amber-600 dark:text-amber-400 font-medium">
                            ⚠ No backup taken on this device yet. Back up regularly.
                        </p>
                    )}
                    <Button onClick={handleBackup} disabled={isBackingUp}>
                        {isBackingUp ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Download className="mr-2 h-4 w-4" />}
                        Download Backup
                    </Button>
                </CardContent>
            </Card>

            {/* Restore */}
            <Card>
                <CardHeader>
                    <CardTitle className="flex items-center gap-2"><Upload className="h-4 w-4" /> Restore Database</CardTitle>
                    <CardDescription>
                        Replace the current database with a <code className="text-xs bg-muted px-1 rounded">.zip</code> or legacy <code className="text-xs bg-muted px-1 rounded">.db</code> backup. Page reloads automatically after restore.
                    </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                    <p className="text-sm text-destructive font-medium">⚠ This will overwrite all current data. This action cannot be undone.</p>
                    <AlertDialog>
                        <AlertDialogTrigger asChild>
                            <Button variant="outline" disabled={isRestoring}>
                                {isRestoring ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Upload className="mr-2 h-4 w-4" />}
                                Restore from Backup
                            </Button>
                        </AlertDialogTrigger>
                        <AlertDialogContent>
                            <AlertDialogHeader>
                                <AlertDialogTitle>Restore from backup?</AlertDialogTitle>
                                <AlertDialogDescription>
                                    This will overwrite all current data. All unsaved changes will be lost. This action cannot be undone.
                                </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                                <AlertDialogCancel>Cancel</AlertDialogCancel>
                                <AlertDialogAction onClick={() => restoreInputRef.current?.click()}>Yes, choose file</AlertDialogAction>
                            </AlertDialogFooter>
                        </AlertDialogContent>
                    </AlertDialog>
                    <input ref={restoreInputRef} type="file" accept=".zip,.db" className="hidden" onChange={handleRestoreFile} />
                </CardContent>
            </Card>

            {/* Maintenance Mode */}
            <Card>
                <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                        <Construction className="h-4 w-4 text-amber-500" />
                        Maintenance Mode
                    </CardTitle>
                    <CardDescription>
                        When enabled, only admins can access OnDuty. All other users see a maintenance notice page.
                    </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                    <div className="flex items-center justify-between rounded-lg border p-4">
                        <div>
                            <p className="font-medium text-sm">Maintenance Mode</p>
                            <p className="text-sm text-muted-foreground mt-0.5">
                                {maintenanceEnabled
                                    ? <span className="text-amber-600 dark:text-amber-400 font-medium">⚠ Currently ON — site restricted to admins only</span>
                                    : <span className="text-green-600 dark:text-green-400 font-medium">✓ Currently OFF — site accessible to all users</span>
                                }
                            </p>
                        </div>
                        <Button
                            variant={maintenanceEnabled ? 'destructive' : 'outline'}
                            className="gap-2 min-w-[120px]"
                            disabled={isMaintSaving}
                            onClick={handleMaintenanceToggle}
                        >
                            {isMaintSaving
                                ? <Loader2 className="h-4 w-4 animate-spin" />
                                : maintenanceEnabled
                                    ? <ToggleRight className="h-4 w-4" />
                                    : <ToggleLeft className="h-4 w-4" />
                            }
                            {maintenanceEnabled ? 'Turn OFF' : 'Turn ON'}
                        </Button>
                    </div>

                    <div className="space-y-2">
                        <label className="text-sm font-medium">Maintenance Message</label>
                        <textarea
                            className="w-full border rounded-md px-3 py-2 text-sm bg-background resize-none focus:outline-none focus:ring-2 focus:ring-ring"
                            rows={3}
                            value={maintenanceMessage}
                            onChange={e => setMaintenanceMessage(e.target.value)}
                            placeholder="We're performing scheduled maintenance. We'll be back shortly."
                        />
                        <Button size="sm" variant="outline" disabled={isMaintSaving} onClick={handleSaveMessage}>
                            {isMaintSaving ? <Loader2 className="mr-2 h-3 w-3 animate-spin" /> : null}
                            Save Message
                        </Button>
                    </div>
                </CardContent>
            </Card>

        </div>
    );
}
