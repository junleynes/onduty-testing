'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { useToast } from '@/hooks/use-toast';
import { Plus, Trash2, CalendarClock, Loader2, Mail, Clock } from 'lucide-react';
import { getReportSchedules, saveReportSchedule, updateReportSchedule, deleteReportSchedule } from '@/app/actions';
import type { ReportSchedule } from '@/app/actions';
import type { Employee } from '@/types';

const REPORT_TYPES = [
    { value: 'workSchedule',   label: 'Regular Work Schedule' },
    { value: 'attendance',     label: 'Attendance Sheet' },
    { value: 'userSummary',    label: 'User Summary' },
    { value: 'tardy',          label: 'Cumulative Tardy Report' },
    { value: 'workExtension',  label: 'Work Extension Summary' },
] as const;

const FREQUENCY_OPTIONS = [
    { value: 'daily',   label: 'Daily' },
    { value: 'weekly',  label: 'Weekly' },
    { value: 'monthly', label: 'Monthly' },
    { value: 'once',    label: 'Once (specific date)' },
];

const DATE_RANGE_OPTIONS = [
    { value: 'current-week',    label: 'Current week (Mon–Sun)' },
    { value: 'previous-week',   label: 'Previous week (Mon–Sun)' },
    { value: 'current-month',   label: 'Current month' },
    { value: 'previous-month',  label: 'Previous month' },
    { value: 'semi-monthly',    label: 'Semi-monthly (1–15 or 16–end)' },
];

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

type Props = {
    isOpen: boolean;
    setIsOpen: (v: boolean) => void;
    currentUser: Employee;
    groups: string[];
};

type FormState = {
    name: string;
    report_type: string;
    frequency: string;
    day_of_week: string;
    day_of_month: string;
    scheduled_date: string;
    recipient_emails: string;   // comma-separated in form
    subject_template: string;
    body_template: string;
    date_range_type: string;
    group_filter: string;
};

const EMPTY_FORM: FormState = {
    name: '',
    report_type: 'attendance',
    frequency: 'weekly',
    day_of_week: '1',
    day_of_month: '1',
    scheduled_date: '',
    recipient_emails: '',
    subject_template: 'Automated Report: {{report_name}} ({{date_range}})',
    body_template: 'Please find the automated report attached.\n\nReport: {{report_name}}\nPeriod: {{date_range}}\n\nThis report was sent automatically by OnDuty.',
    date_range_type: 'previous-week',
    group_filter: '__all__',
};

export function ReportScheduleManager({ isOpen, setIsOpen, currentUser, groups }: Props) {
    const { toast } = useToast();
    const [schedules, setSchedules] = useState<ReportSchedule[]>([]);
    const [loading, setLoading] = useState(true);
    const [showForm, setShowForm] = useState(false);
    const [form, setForm] = useState<FormState>(EMPTY_FORM);
    const [saving, setSaving] = useState(false);
    const [deletingId, setDeletingId] = useState<string | null>(null);

    const load = useCallback(async () => {
        setLoading(true);
        const r = await getReportSchedules();
        if (r.success) setSchedules(r.schedules ?? []);
        setLoading(false);
    }, []);

    useEffect(() => { if (isOpen) load(); }, [isOpen, load]);

    const set = (k: keyof FormState, v: string) => setForm(f => ({ ...f, [k]: v }));

    const handleSave = async () => {
        if (!form.name.trim()) { toast({ variant: 'destructive', title: 'Name required' }); return; }
        const emails = form.recipient_emails.split(/[,;\n]+/).map(e => e.trim()).filter(Boolean);
        if (!emails.length) { toast({ variant: 'destructive', title: 'At least one recipient email required' }); return; }
        if (form.frequency === 'once' && !form.scheduled_date) { toast({ variant: 'destructive', title: 'Date required for one-time schedule' }); return; }

        setSaving(true);
        const payload = {
            name: form.name.trim(),
            report_type: form.report_type,
            frequency: form.frequency,
            day_of_week: form.frequency === 'weekly' ? parseInt(form.day_of_week) : null,
            day_of_month: form.frequency === 'monthly' ? parseInt(form.day_of_month) : null,
            scheduled_date: form.frequency === 'once' ? form.scheduled_date : null,
            recipient_emails: JSON.stringify(emails),
            subject_template: form.subject_template,
            body_template: form.body_template,
            date_range_type: form.date_range_type,
            group_filter: form.group_filter === '__all__' ? null : form.group_filter,
            created_by: currentUser.id,
            is_active: 1,
        };
        const r = await saveReportSchedule(payload);
        setSaving(false);
        if (r.success) {
            toast({ title: 'Schedule Saved', description: `"${form.name}" will run automatically.` });
            setForm(EMPTY_FORM);
            setShowForm(false);
            load();
        } else {
            toast({ variant: 'destructive', title: 'Failed', description: r.error });
        }
    };

    const handleToggle = async (id: string, current: number) => {
        const r = await updateReportSchedule(id, { is_active: current ? 0 : 1 });
        if (r.success) {
            setSchedules(s => s.map(x => x.id === id ? { ...x, is_active: current ? 0 : 1 } : x));
        }
    };

    const handleDelete = async (id: string) => {
        setDeletingId(id);
        const r = await deleteReportSchedule(id);
        if (r.success) {
            setSchedules(s => s.filter(x => x.id !== id));
            toast({ title: 'Deleted' });
        } else {
            toast({ variant: 'destructive', title: 'Failed', description: r.error });
        }
        setDeletingId(null);
    };

    const frequencyLabel = (s: ReportSchedule) => {
        if (s.frequency === 'daily') return 'Every day';
        if (s.frequency === 'weekly') return `Every ${DAY_NAMES[s.day_of_week ?? 1]}`;
        if (s.frequency === 'monthly') return `Monthly on the ${s.day_of_month}${['st','nd','rd'][((s.day_of_month ?? 1) % 10) - 1] ?? 'th'}`;
        if (s.frequency === 'once') return `Once on ${s.scheduled_date}`;
        return s.frequency;
    };

    return (
        <Dialog open={isOpen} onOpenChange={setIsOpen}>
            <DialogContent className="sm:max-w-2xl max-h-[90vh] flex flex-col">
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2"><CalendarClock className="h-5 w-5" />Automated Report Schedules</DialogTitle>
                    <DialogDescription>Configure reports to be generated and emailed automatically on a schedule.</DialogDescription>
                </DialogHeader>

                <div className="flex-1 overflow-y-auto space-y-4 pr-1">
                    {loading ? (
                        <div className="flex items-center justify-center h-20"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
                    ) : schedules.length === 0 && !showForm ? (
                        <div className="text-center py-8 text-muted-foreground">
                            <CalendarClock className="h-10 w-10 mx-auto mb-3 opacity-30" />
                            <p className="text-sm">No automated schedules yet.</p>
                            <p className="text-xs mt-1">Add one below to start sending reports automatically.</p>
                        </div>
                    ) : (
                        <div className="space-y-2">
                            {schedules.map(s => {
                                const emails: string[] = JSON.parse(s.recipient_emails || '[]');
                                const rLabel = REPORT_TYPES.find(r => r.value === s.report_type)?.label ?? s.report_type;
                                return (
                                    <div key={s.id} className="border rounded-lg p-3 flex items-start gap-3">
                                        <Switch checked={!!s.is_active} onCheckedChange={() => handleToggle(s.id, s.is_active)} className="mt-0.5 shrink-0" />
                                        <div className="flex-1 min-w-0">
                                            <div className="flex items-center gap-2 flex-wrap">
                                                <p className="font-medium text-sm truncate">{s.name}</p>
                                                <Badge variant={s.is_active ? 'default' : 'secondary'} className="text-xs">{s.is_active ? 'Active' : 'Paused'}</Badge>
                                            </div>
                                            <p className="text-xs text-muted-foreground mt-0.5">{rLabel} · {frequencyLabel(s)}</p>
                                            <div className="flex items-center gap-1 mt-1 flex-wrap">
                                                <Mail className="h-3 w-3 text-muted-foreground" />
                                                {emails.map(e => <span key={e} className="text-xs bg-muted px-1.5 py-0.5 rounded">{e}</span>)}
                                            </div>
                                            {s.last_sent_at && <p className="text-xs text-muted-foreground mt-1 flex items-center gap-1"><Clock className="h-3 w-3" />Last sent {new Date(s.last_sent_at).toLocaleDateString()}</p>}
                                        </div>
                                        <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive hover:text-destructive shrink-0" disabled={deletingId === s.id} onClick={() => handleDelete(s.id)}>
                                            {deletingId === s.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                                        </Button>
                                    </div>
                                );
                            })}
                        </div>
                    )}

                    {showForm && (
                        <>
                            {schedules.length > 0 && <Separator />}
                            <div className="space-y-4 border rounded-lg p-4 bg-muted/20">
                                <p className="text-sm font-semibold">New Automated Schedule</p>

                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                    <div className="space-y-1 sm:col-span-2">
                                        <Label className="text-xs">Schedule Name</Label>
                                        <Input placeholder="e.g. Weekly Attendance for Admin" value={form.name} onChange={e => set('name', e.target.value)} />
                                    </div>

                                    <div className="space-y-1">
                                        <Label className="text-xs">Report Type</Label>
                                        <Select value={form.report_type} onValueChange={v => set('report_type', v)}>
                                            <SelectTrigger><SelectValue /></SelectTrigger>
                                            <SelectContent>{REPORT_TYPES.map(r => <SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>)}</SelectContent>
                                        </Select>
                                    </div>

                                    <div className="space-y-1">
                                        <Label className="text-xs">Group / Department</Label>
                                        <Select value={form.group_filter} onValueChange={v => set('group_filter', v)}>
                                            <SelectTrigger><SelectValue /></SelectTrigger>
                                            <SelectContent>
                                                <SelectItem value="__all__">All groups</SelectItem>
                                                {groups.map(g => <SelectItem key={g} value={g}>{g}</SelectItem>)}
                                            </SelectContent>
                                        </Select>
                                    </div>

                                    <div className="space-y-1">
                                        <Label className="text-xs">Frequency</Label>
                                        <Select value={form.frequency} onValueChange={v => set('frequency', v)}>
                                            <SelectTrigger><SelectValue /></SelectTrigger>
                                            <SelectContent>{FREQUENCY_OPTIONS.map(o => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}</SelectContent>
                                        </Select>
                                    </div>

                                    {form.frequency === 'weekly' && (
                                        <div className="space-y-1">
                                            <Label className="text-xs">Send on day</Label>
                                            <Select value={form.day_of_week} onValueChange={v => set('day_of_week', v)}>
                                                <SelectTrigger><SelectValue /></SelectTrigger>
                                                <SelectContent>{DAY_NAMES.map((d, i) => <SelectItem key={i} value={String(i)}>{d}</SelectItem>)}</SelectContent>
                                            </Select>
                                        </div>
                                    )}

                                    {form.frequency === 'monthly' && (
                                        <div className="space-y-1">
                                            <Label className="text-xs">Day of month (1–28)</Label>
                                            <Input type="number" min={1} max={28} value={form.day_of_month} onChange={e => set('day_of_month', e.target.value)} />
                                        </div>
                                    )}

                                    {form.frequency === 'once' && (
                                        <div className="space-y-1">
                                            <Label className="text-xs">Send on date</Label>
                                            <Input type="date" value={form.scheduled_date} onChange={e => set('scheduled_date', e.target.value)} />
                                        </div>
                                    )}

                                    <div className="space-y-1">
                                        <Label className="text-xs">Report data range</Label>
                                        <Select value={form.date_range_type} onValueChange={v => set('date_range_type', v)}>
                                            <SelectTrigger><SelectValue /></SelectTrigger>
                                            <SelectContent>{DATE_RANGE_OPTIONS.map(o => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}</SelectContent>
                                        </Select>
                                    </div>

                                    <div className="space-y-1 sm:col-span-2">
                                        <Label className="text-xs">Recipient Emails <span className="text-muted-foreground">(comma or line separated)</span></Label>
                                        <Textarea placeholder="manager@company.com, hr@company.com" value={form.recipient_emails} onChange={e => set('recipient_emails', e.target.value)} rows={2} />
                                    </div>

                                    <div className="space-y-1 sm:col-span-2">
                                        <Label className="text-xs">Email Subject <span className="text-muted-foreground">(use &#123;&#123;report_name&#125;&#125;, &#123;&#123;date_range&#125;&#125;)</span></Label>
                                        <Input value={form.subject_template} onChange={e => set('subject_template', e.target.value)} />
                                    </div>

                                    <div className="space-y-1 sm:col-span-2">
                                        <Label className="text-xs">Email Body</Label>
                                        <Textarea value={form.body_template} onChange={e => set('body_template', e.target.value)} rows={4} />
                                    </div>
                                </div>

                                <div className="flex justify-end gap-2 pt-1">
                                    <Button variant="ghost" size="sm" onClick={() => { setShowForm(false); setForm(EMPTY_FORM); }}>Cancel</Button>
                                    <Button size="sm" onClick={handleSave} disabled={saving}>
                                        {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                                        Save Schedule
                                    </Button>
                                </div>
                            </div>
                        </>
                    )}
                </div>

                <DialogFooter className="border-t pt-3 mt-2">
                    {!showForm && (
                        <Button onClick={() => setShowForm(true)} className="gap-2">
                            <Plus className="h-4 w-4" /> Add Schedule
                        </Button>
                    )}
                    <Button variant="ghost" onClick={() => setIsOpen(false)}>Close</Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
