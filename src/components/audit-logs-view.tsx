'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';
import { getAuditLogs } from '@/app/actions';
import type { AuditLogEntry } from '@/app/actions';
import { format, parseISO } from 'date-fns';
import { ShieldAlert, ChevronLeft, ChevronRight, Search, RefreshCw, Download } from 'lucide-react';

const PAGE_SIZE = 50;

// Map action strings to badge color + label
function ActionBadge({ action }: { action: string }) {
    const colorMap: Record<string, string> = {
        'purge':           'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300',
        'backup':          'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300',
        'restore':         'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300',
        'password':        'bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-300',
        'leave':           'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300',
        'login':           'bg-slate-100 text-slate-800 dark:bg-slate-900/30 dark:text-slate-300',
        'employee':        'bg-teal-100 text-teal-800 dark:bg-teal-900/30 dark:text-teal-300',
    };
    const prefix = action.split('.')[0];
    const color = colorMap[prefix] ?? 'bg-muted text-muted-foreground';
    return <span className={`inline-block font-mono text-xs px-2 py-0.5 rounded font-medium ${color}`}>{action}</span>;
}

export default function AuditLogsView() {
    const [logs, setLogs] = useState<AuditLogEntry[]>([]);
    const [total, setTotal] = useState(0);
    const [page, setPage] = useState(0);
    const [loading, setLoading] = useState(true);
    const [actionFilter, setActionFilter] = useState('');
    const [searchInput, setSearchInput] = useState('');

    const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

    const load = useCallback(async (p: number, action: string) => {
        setLoading(true);
        const result = await getAuditLogs({ limit: PAGE_SIZE, offset: p * PAGE_SIZE, action: action || undefined });
        if (result.success) {
            setLogs(result.data ?? []);
            setTotal(result.total ?? 0);
        }
        setLoading(false);
    }, []);

    useEffect(() => { load(page, actionFilter); }, [page, actionFilter, load]);

    const handleSearch = () => {
        setPage(0);
        setActionFilter(searchInput.trim());
    };

    const handleClearFilter = () => {
        setSearchInput('');
        setActionFilter('');
        setPage(0);
    };

    const exportCsv = () => {
        if (logs.length === 0) return;
        const headers = ['id', 'timestamp', 'actor', 'action', 'target_type', 'target_name', 'detail', 'ip'];
        const rows = logs.map(l => [
            l.id,
            l.ts,
            l.actor_name ?? l.actor_id ?? '',
            l.action,
            l.target_type ?? '',
            l.target_name ?? '',
            l.detail ?? '',
            l.ip ?? '',
        ]);
        const csv = [headers, ...rows].map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n');
        const blob = new Blob([csv], { type: 'text/csv' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `onduty-audit-logs-${format(new Date(), 'yyyy-MM-dd')}.csv`;
        a.click();
    };

    const formatTs = (ts: string) => {
        try { return format(parseISO(ts), 'MMM d, yyyy HH:mm:ss'); } catch { return ts; }
    };

    return (
        <div className="max-w-6xl mx-auto space-y-4">
            <div className="flex items-center gap-3">
                <ShieldAlert className="h-6 w-6 text-primary" />
                <div>
                    <h1 className="text-2xl font-bold">Audit Logs</h1>
                    <p className="text-sm text-muted-foreground">Track all administrative and security-relevant actions across the system.</p>
                </div>
            </div>

            <Card>
                <CardHeader className="pb-3">
                    <div className="flex flex-col sm:flex-row sm:items-center gap-3">
                        <div className="flex items-center gap-2 flex-1">
                            <div className="relative flex-1 max-w-xs">
                                <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
                                <Input
                                    className="pl-8 h-8 text-sm"
                                    placeholder="Filter by action…"
                                    value={searchInput}
                                    onChange={e => setSearchInput(e.target.value)}
                                    onKeyDown={e => e.key === 'Enter' && handleSearch()}
                                />
                            </div>
                            <Button size="sm" variant="outline" onClick={handleSearch} className="h-8">Search</Button>
                            {actionFilter && <Button size="sm" variant="ghost" onClick={handleClearFilter} className="h-8 text-xs">Clear</Button>}
                        </div>
                        <div className="flex items-center gap-2 ml-auto">
                            <span className="text-xs text-muted-foreground">{total.toLocaleString()} entries</span>
                            <Button size="sm" variant="outline" onClick={() => load(page, actionFilter)} disabled={loading} className="h-8">
                                <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
                            </Button>
                            <Button size="sm" variant="outline" onClick={exportCsv} disabled={logs.length === 0} className="h-8">
                                <Download className="h-3.5 w-3.5 mr-1" /> CSV
                            </Button>
                        </div>
                    </div>
                </CardHeader>
                <CardContent className="p-0">
                    <div className="overflow-x-auto">
                        <Table>
                            <TableHeader>
                                <TableRow>
                                    <TableHead className="w-36">Timestamp</TableHead>
                                    <TableHead className="w-40">Actor</TableHead>
                                    <TableHead className="w-52">Action</TableHead>
                                    <TableHead className="w-28">Target Type</TableHead>
                                    <TableHead className="w-40">Target</TableHead>
                                    <TableHead>Detail</TableHead>
                                    <TableHead className="w-28">IP</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {loading ? (
                                    <TableRow>
                                        <TableCell colSpan={7} className="text-center py-12 text-muted-foreground">
                                            <RefreshCw className="h-4 w-4 animate-spin mx-auto mb-2" />
                                            Loading…
                                        </TableCell>
                                    </TableRow>
                                ) : logs.length === 0 ? (
                                    <TableRow>
                                        <TableCell colSpan={7} className="text-center py-12 text-muted-foreground">
                                            No audit log entries found.
                                        </TableCell>
                                    </TableRow>
                                ) : logs.map(log => (
                                    <TableRow key={log.id}>
                                        <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                                            {formatTs(log.ts)}
                                        </TableCell>
                                        <TableCell className="text-sm">
                                            {log.actor_name
                                                ? <span className="font-medium">{log.actor_name}</span>
                                                : log.actor_id
                                                    ? <span className="font-mono text-xs text-muted-foreground">{log.actor_id}</span>
                                                    : <span className="text-muted-foreground text-xs italic">system</span>
                                            }
                                        </TableCell>
                                        <TableCell><ActionBadge action={log.action} /></TableCell>
                                        <TableCell className="text-xs text-muted-foreground">{log.target_type ?? '—'}</TableCell>
                                        <TableCell className="text-sm max-w-[160px] truncate" title={log.target_name ?? ''}>
                                            {log.target_name ?? '—'}
                                        </TableCell>
                                        <TableCell className="text-xs text-muted-foreground max-w-[240px] truncate" title={log.detail ?? ''}>
                                            {log.detail ?? '—'}
                                        </TableCell>
                                        <TableCell className="text-xs font-mono text-muted-foreground">
                                            {log.ip ?? '—'}
                                        </TableCell>
                                    </TableRow>
                                ))}
                            </TableBody>
                        </Table>
                    </div>
                    {/* Pagination */}
                    {totalPages > 1 && (
                        <div className="flex items-center justify-between px-4 py-3 border-t">
                            <span className="text-xs text-muted-foreground">
                                Page {page + 1} of {totalPages}
                            </span>
                            <div className="flex gap-1">
                                <Button size="sm" variant="outline" onClick={() => setPage(p => Math.max(0, p - 1))} disabled={page === 0 || loading} className="h-7 w-7 p-0">
                                    <ChevronLeft className="h-3.5 w-3.5" />
                                </Button>
                                <Button size="sm" variant="outline" onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))} disabled={page >= totalPages - 1 || loading} className="h-7 w-7 p-0">
                                    <ChevronRight className="h-3.5 w-3.5" />
                                </Button>
                            </div>
                        </div>
                    )}
                </CardContent>
            </Card>
        </div>
    );
}
