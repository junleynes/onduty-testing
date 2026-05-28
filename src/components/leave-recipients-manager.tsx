'use client';

import React, { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from './ui/dialog';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { Badge } from './ui/badge';
import { Trash2, Plus, Star, StarOff } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { getLeaveRecipients, saveLeaveRecipient, deleteLeaveRecipient } from '@/app/actions';
import type { LeaveRecipient } from '@/app/actions';
import { v4 as uuidv4 } from 'uuid';

type Props = {
    isOpen: boolean;
    setIsOpen: (open: boolean) => void;
};

export function LeaveRecipientsManager({ isOpen, setIsOpen }: Props) {
    const [recipients, setRecipients] = useState<LeaveRecipient[]>([]);
    const [newName, setNewName] = useState('');
    const [newEmail, setNewEmail] = useState('');
    const [newRole, setNewRole] = useState('Division Admin');
    const [isLoading, setIsLoading] = useState(false);
    const { toast } = useToast();

    useEffect(() => {
        if (isOpen) {
            getLeaveRecipients().then(r => {
                if (r.success) setRecipients(r.recipients || []);
            });
        }
    }, [isOpen]);

    const handleAdd = async () => {
        if (!newName.trim() || !newEmail.trim()) {
            toast({ variant: 'destructive', title: 'Required', description: 'Name and email are required.' });
            return;
        }
        setIsLoading(true);
        const recipient: LeaveRecipient = {
            id: uuidv4(),
            name: newName.trim(),
            email: newEmail.trim().toLowerCase(),
            role: newRole.trim() || 'Division Admin',
            isDefault: recipients.length === 0, // first one becomes default
        };
        const result = await saveLeaveRecipient(recipient);
        if (result.success) {
            setRecipients(prev => [...prev, recipient]);
            setNewName(''); setNewEmail(''); setNewRole('Division Admin');
            toast({ title: 'Recipient added' });
        } else {
            toast({ variant: 'destructive', title: 'Failed', description: result.error });
        }
        setIsLoading(false);
    };

    const handleDelete = async (id: string) => {
        const result = await deleteLeaveRecipient(id);
        if (result.success) {
            setRecipients(prev => prev.filter(r => r.id !== id));
        } else {
            toast({ variant: 'destructive', title: 'Failed', description: result.error });
        }
    };

    const handleToggleDefault = async (id: string) => {
        const updated = recipients.map(r => ({ ...r, isDefault: r.id === id }));
        setRecipients(updated);
        const target = updated.find(r => r.id === id)!;
        await saveLeaveRecipient(target);
        // Clear default from others
        for (const r of updated.filter(r => r.id !== id && r.isDefault === false)) {
            await saveLeaveRecipient(r);
        }
        toast({ title: 'Default recipient updated' });
    };

    return (
        <Dialog open={isOpen} onOpenChange={setIsOpen}>
            <DialogContent className="sm:max-w-lg">
                <DialogHeader>
                    <DialogTitle>Manage Leave Recipients</DialogTitle>
                    <DialogDescription>
                        Add Company or Division Admin email addresses that receive leave forms.
                        These are external recipients outside your team.
                    </DialogDescription>
                </DialogHeader>

                <div className="space-y-4 py-2">
                    {/* Existing recipients */}
                    <div className="space-y-2 max-h-48 overflow-y-auto">
                        {recipients.length === 0 && (
                            <p className="text-sm text-muted-foreground text-center py-4">No recipients added yet.</p>
                        )}
                        {recipients.map(r => (
                            <div key={r.id} className="flex items-center justify-between rounded-md border px-3 py-2 gap-2">
                                <div className="min-w-0 flex-1">
                                    <div className="flex items-center gap-2">
                                        <span className="font-medium text-sm truncate">{r.name}</span>
                                        <Badge variant="secondary" className="text-xs shrink-0">{r.role}</Badge>
                                        {r.isDefault && <Badge className="text-xs shrink-0">Default</Badge>}
                                    </div>
                                    <p className="text-xs text-muted-foreground truncate">{r.email}</p>
                                </div>
                                <div className="flex gap-1 shrink-0">
                                    <Button variant="ghost" size="icon" className="h-7 w-7"
                                        onClick={() => handleToggleDefault(r.id)}
                                        title={r.isDefault ? 'Default recipient' : 'Set as default'}>
                                        {r.isDefault ? <Star className="h-4 w-4 text-yellow-500 fill-yellow-500" /> : <StarOff className="h-4 w-4" />}
                                    </Button>
                                    <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive"
                                        onClick={() => handleDelete(r.id)}>
                                        <Trash2 className="h-4 w-4" />
                                    </Button>
                                </div>
                            </div>
                        ))}
                    </div>

                    {/* Add new */}
                    <div className="rounded-md border p-3 space-y-3">
                        <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Add Recipient</p>
                        <div className="grid grid-cols-2 gap-2">
                            <div className="space-y-1">
                                <Label className="text-xs">Name</Label>
                                <Input placeholder="e.g. ERMD Admin" value={newName} onChange={e => setNewName(e.target.value)} />
                            </div>
                            <div className="space-y-1">
                                <Label className="text-xs">Role</Label>
                                <Input placeholder="Division Admin" value={newRole} onChange={e => setNewRole(e.target.value)} />
                            </div>
                        </div>
                        <div className="space-y-1">
                            <Label className="text-xs">Email</Label>
                            <Input type="email" placeholder="admin@company.com" value={newEmail} onChange={e => setNewEmail(e.target.value)} />
                        </div>
                        <Button size="sm" onClick={handleAdd} disabled={isLoading} className="w-full">
                            <Plus className="h-4 w-4 mr-2" />Add Recipient
                        </Button>
                    </div>
                </div>

                <DialogFooter>
                    <Button variant="ghost" onClick={() => setIsOpen(false)}>Done</Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
