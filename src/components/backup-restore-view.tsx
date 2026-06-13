'use client';

import React, { useRef, useTransition, useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from './ui/button';
import { useToast } from '@/hooks/use-toast';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from './ui/alert-dialog';
import { backupDatabase, restoreDatabase } from '@/app/actions';
import { Loader2, Download, Upload, HardDrive, ShieldCheck } from 'lucide-react';
import { format } from 'date-fns';

export default function BackupRestoreView() {
    const { toast } = useToast();
    const [isBackingUp, startBackupTransition] = useTransition();
    const [isRestoring, startRestoreTransition] = useTransition();
    const restoreInputRef = useRef<HTMLInputElement>(null);
    const [lastBackupAt, setLastBackupAt] = useState<Date | null>(() => {
        if (typeof window === 'undefined') return null;
        const stored = localStorage.getItem('onduty_last_backup');
        return stored ? new Date(stored) : null;
    });

    const handleBackup = () => {
        startBackupTransition(async () => {
            const result = await backupDatabase();
            if (!result.success || !result.data) {
                toast({ variant: 'destructive', title: 'Backup Failed', description: result.error || 'Could not read database.' });
                return;
            }
            const binary = atob(result.data);
            const bytes = new Uint8Array(binary.length);
            for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
            const blob = new Blob([bytes], { type: 'application/zip' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = result.filename ?? `onduty-backup-${format(new Date(), 'yyyy-MM-dd-HHmm')}.zip`;
            a.click();
            URL.revokeObjectURL(url);
            const now = new Date();
            setLastBackupAt(now);
            localStorage.setItem('onduty_last_backup', now.toISOString());
            toast({ title: 'Backup Downloaded', description: 'Database + uploads backup saved to your device.' });
        });
    };

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

    return (
        <div className="max-w-2xl mx-auto space-y-6">
            <div className="flex items-center gap-3">
                <HardDrive className="h-6 w-6 text-primary" />
                <div>
                    <h1 className="text-2xl font-bold">Backup & Restore</h1>
                    <p className="text-sm text-muted-foreground">Download a full backup of the database and all uploaded files, or restore from a previous backup.</p>
                </div>
            </div>

            {/* Backup */}
            <Card>
                <CardHeader>
                    <CardTitle className="flex items-center gap-2"><Download className="h-4 w-4" /> Backup Database</CardTitle>
                    <CardDescription>
                        Downloads a <code className="text-xs bg-muted px-1 rounded">.zip</code> archive containing <code className="text-xs bg-muted px-1 rounded">local.db</code> and all uploaded files — avatars, signatures, PDFs, and report templates.
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
                            ⚠ No backup has been taken on this device yet. It is strongly recommended to back up regularly.
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
                        Replace the current database and uploads with a <code className="text-xs bg-muted px-1 rounded">.zip</code> backup or a legacy <code className="text-xs bg-muted px-1 rounded">.db</code> file. The page reloads automatically after a successful restore.
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
                                    This will overwrite all current data with the contents of the backup file. All unsaved changes will be lost. This action cannot be undone.
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
        </div>
    );
}
