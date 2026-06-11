'use client';

import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { Copy, Check, Terminal, Lock, Download, Upload, FileSpreadsheet, BarChart3, BookOpen, RefreshCw } from 'lucide-react';
import { getApiKey, regenerateApiKey } from '@/app/actions';
import { useToast } from '@/hooks/use-toast';

// ── Small code block component ────────────────────────────────────────────────
function CodeBlock({ children, language = 'bash' }: { children: string; language?: string }) {
    const [copied, setCopied] = useState(false);
    const copy = () => {
        navigator.clipboard.writeText(children.trim());
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    };
    return (
        <div className="relative group rounded-md border bg-muted/60 text-sm overflow-x-auto">
            <pre className="p-4 pr-12 font-mono text-xs leading-relaxed whitespace-pre-wrap break-all">
                {children.trim()}
            </pre>
            <Button size="icon" variant="ghost" className="absolute top-2 right-2 h-7 w-7 opacity-0 group-hover:opacity-100 transition-opacity" onClick={copy}>
                {copied ? <Check className="h-3.5 w-3.5 text-green-500" /> : <Copy className="h-3.5 w-3.5" />}
            </Button>
        </div>
    );
}

// ── Method badge ─────────────────────────────────────────────────────────────
function Method({ method }: { method: 'GET' | 'POST' | 'PUT' | 'DELETE' }) {
    const colors: Record<string, string> = {
        GET: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300',
        POST: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300',
        PUT: 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300',
        DELETE: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300',
    };
    return <span className={`inline-block font-mono font-bold text-xs px-2 py-0.5 rounded ${colors[method]}`}>{method}</span>;
}

// ── Endpoint block ────────────────────────────────────────────────────────────
function Endpoint({
    method, path, summary, description, params, responseExample, exampleCurl,
}: {
    method: 'GET' | 'POST' | 'PUT' | 'DELETE';
    path: string;
    summary: string;
    description: string;
    params?: { name: string; required: boolean; type: string; description: string }[];
    responseExample?: string;
    exampleCurl: string;
}) {
    const [open, setOpen] = useState(false);
    return (
        <div className="border rounded-lg overflow-hidden">
            <button
                className="w-full flex items-center gap-3 p-4 text-left hover:bg-muted/40 transition-colors"
                onClick={() => setOpen(o => !o)}
            >
                <Method method={method} />
                <code className="font-mono text-sm font-medium flex-1">{path}</code>
                <span className="text-sm text-muted-foreground hidden sm:block">{summary}</span>
                <span className="text-muted-foreground ml-auto">{open ? '▲' : '▼'}</span>
            </button>
            {open && (
                <div className="border-t p-4 space-y-4 bg-background">
                    <p className="text-sm text-muted-foreground">{description}</p>

                    {params && params.length > 0 && (
                        <div>
                            <h4 className="text-sm font-semibold mb-2">Parameters</h4>
                            <div className="rounded-md border overflow-hidden">
                                <table className="w-full text-xs">
                                    <thead className="bg-muted/50">
                                        <tr>
                                            <th className="text-left px-3 py-2 font-medium">Name</th>
                                            <th className="text-left px-3 py-2 font-medium">Type</th>
                                            <th className="text-left px-3 py-2 font-medium">Required</th>
                                            <th className="text-left px-3 py-2 font-medium">Description</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {params.map((p, i) => (
                                            <tr key={p.name} className={i % 2 === 0 ? '' : 'bg-muted/20'}>
                                                <td className="px-3 py-2 font-mono font-medium">{p.name}</td>
                                                <td className="px-3 py-2 text-muted-foreground">{p.type}</td>
                                                <td className="px-3 py-2">
                                                    {p.required
                                                        ? <span className="text-destructive font-medium">required</span>
                                                        : <span className="text-muted-foreground">optional</span>}
                                                </td>
                                                <td className="px-3 py-2 text-muted-foreground">{p.description}</td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    )}

                    <div>
                        <h4 className="text-sm font-semibold mb-2">Example Request</h4>
                        <CodeBlock>{exampleCurl}</CodeBlock>
                    </div>

                    {responseExample && (
                        <div>
                            <h4 className="text-sm font-semibold mb-2">Example Response</h4>
                            <CodeBlock language="json">{responseExample}</CodeBlock>
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}

// ── Main component ────────────────────────────────────────────────────────────
export default function ApiDocsView() {
    const { toast } = useToast();
    const [apiKey, setApiKey] = useState<string | null>(null);
    const [loading, setLoading] = useState(true);
    const [regenerating, setRegenerating] = useState(false);
    const [keyVisible, setKeyVisible] = useState(false);
    const [copied, setCopied] = useState(false);

    const origin = typeof window !== 'undefined' ? window.location.origin : 'https://your-onduty.com';

    useEffect(() => {
        getApiKey().then(r => {
            if (r.success) setApiKey(r.key ?? null);
            setLoading(false);
        });
    }, []);

    const handleRegenerate = async () => {
        setRegenerating(true);
        const result = await regenerateApiKey();
        if (result.success) {
            setApiKey(result.key ?? null);
            setKeyVisible(true);
            toast({ title: 'API Key Regenerated', description: 'Your old key is now invalid. Update any integrations.' });
        } else {
            toast({ variant: 'destructive', title: 'Failed', description: result.error });
        }
        setRegenerating(false);
    };

    const copyKey = () => {
        if (!apiKey) return;
        navigator.clipboard.writeText(apiKey);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    };

    const maskedKey = apiKey ? apiKey.slice(0, 8) + '•'.repeat(Math.max(0, apiKey.length - 12)) + apiKey.slice(-4) : '';

    return (
        <div className="max-w-4xl mx-auto space-y-6">
            {/* Header */}
            <div className="flex items-center gap-3">
                <BookOpen className="h-6 w-6 text-primary" />
                <div>
                    <h1 className="text-2xl font-bold">API Documentation</h1>
                    <p className="text-sm text-muted-foreground">Integrate OnDuty data with external systems using these REST endpoints.</p>
                </div>
            </div>

            {/* API Key Management */}
            <Card>
                <CardHeader>
                    <CardTitle className="flex items-center gap-2"><Lock className="h-4 w-4" /> API Key</CardTitle>
                    <CardDescription>All API endpoints require this key. Pass it as <code>Authorization: Bearer &lt;key&gt;</code> or <code>x-api-key</code> header.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                    {loading ? (
                        <p className="text-sm text-muted-foreground">Loading…</p>
                    ) : apiKey ? (
                        <div className="flex items-center gap-2">
                            <code className="flex-1 font-mono text-sm bg-muted px-3 py-2 rounded-md border overflow-x-auto">
                                {keyVisible ? apiKey : maskedKey}
                            </code>
                            <Button variant="outline" size="sm" onClick={() => setKeyVisible(v => !v)}>
                                {keyVisible ? 'Hide' : 'Show'}
                            </Button>
                            <Button variant="outline" size="sm" onClick={copyKey}>
                                {copied ? <Check className="h-3.5 w-3.5 text-green-500" /> : <Copy className="h-3.5 w-3.5" />}
                            </Button>
                        </div>
                    ) : (
                        <p className="text-sm text-amber-600 dark:text-amber-400">No API key configured. Generate one below to enable the API.</p>
                    )}
                    <Button variant="outline" size="sm" onClick={handleRegenerate} disabled={regenerating}>
                        <RefreshCw className={`mr-2 h-3.5 w-3.5 ${regenerating ? 'animate-spin' : ''}`} />
                        {apiKey ? 'Regenerate Key' : 'Generate Key'}
                    </Button>
                    <p className="text-xs text-muted-foreground">Regenerating invalidates the current key immediately. All integrations using the old key must be updated.</p>
                </CardContent>
            </Card>

            {/* Base URL */}
            <Card>
                <CardHeader>
                    <CardTitle className="flex items-center gap-2"><Terminal className="h-4 w-4" /> Base URL</CardTitle>
                </CardHeader>
                <CardContent>
                    <CodeBlock>{origin}</CodeBlock>
                    <p className="text-xs text-muted-foreground mt-2">All endpoints are relative to this base URL. Include your API key in every request.</p>
                </CardContent>
            </Card>

            {/* Backup & Restore */}
            <div>
                <div className="flex items-center gap-2 mb-3">
                    <Download className="h-4 w-4 text-primary" />
                    <h2 className="text-lg font-semibold">Backup & Restore</h2>
                </div>
                <div className="space-y-3">
                    <Endpoint
                        method="GET"
                        path="/api/backup"
                        summary="Download full backup (DB + uploads)"
                        description="Returns a .zip archive containing the SQLite database (local.db) and the entire uploads/ folder (avatars, signatures, PDFs, templates). Compatible with the Restore endpoint and the in-app Restore function."
                        exampleCurl={`curl -H "Authorization: Bearer ${apiKey ?? 'YOUR_API_KEY'}" \\
  ${origin}/api/backup \\
  -o onduty-backup.zip`}
                    />
                    <Endpoint
                        method="POST"
                        path="/api/restore"
                        summary="Restore from backup zip"
                        description="Accepts a .zip (new format) or legacy .db file and restores the database and uploads folder. The server restarts automatically after a successful restore. All current data is overwritten — use with caution."
                        params={[
                            { name: 'file', required: true, type: 'File (multipart)', description: 'Backup file (.zip or .db). Send as multipart/form-data.' },
                        ]}
                        responseExample={`{ "success": true, "message": "Restore complete. Server is restarting." }`}
                        exampleCurl={`curl -X POST \\
  -H "Authorization: Bearer ${apiKey ?? 'YOUR_API_KEY'}" \\
  -F "file=@onduty-backup.zip" \\
  ${origin}/api/restore`}
                    />
                </div>
            </div>

            <Separator />

            {/* Schedule Import */}
            <div>
                <div className="flex items-center gap-2 mb-3">
                    <Upload className="h-4 w-4 text-primary" />
                    <h2 className="text-lg font-semibold">Schedule Import</h2>
                </div>
                <div className="space-y-3">
                    <Endpoint
                        method="POST"
                        path="/api/import-schedule"
                        summary="Import shifts from CSV (matrix format)"
                        description="Imports a schedule from a CSV in matrix format matching the UI's export format. The first column is 'Employee' and subsequent columns are dates (YYYY-MM-DD). Each cell contains a shift label (e.g. '08:00-17:00') or is blank for no change."
                        params={[
                            { name: 'body', required: true, type: 'text/csv', description: 'CSV body in matrix format. First row is header: Employee, 2026-06-01, 2026-06-02, ...' },
                            { name: 'x-api-key', required: true, type: 'Header', description: 'Your API key.' },
                        ]}
                        responseExample={`{
  "success": true,
  "imported": 42,
  "skipped": 3,
  "errors": []
}`}
                        exampleCurl={`curl -X POST \\
  -H "x-api-key: ${apiKey ?? 'YOUR_API_KEY'}" \\
  -H "Content-Type: text/csv" \\
  --data-binary @schedule.csv \\
  ${origin}/api/import-schedule`}
                    />
                </div>
            </div>

            <Separator />

            {/* Reports */}
            <div>
                <div className="flex items-center gap-2 mb-3">
                    <BarChart3 className="h-4 w-4 text-primary" />
                    <h2 className="text-lg font-semibold">Reports</h2>
                </div>
                <div className="space-y-3">
                    <Endpoint
                        method="GET"
                        path="/api/reports/work-schedule"
                        summary="Work schedule report data"
                        description="Returns a flat array of per-employee per-day schedule rows. Includes schedule times, break info, WFH/holiday/leave status, and default template fallback. Supports JSON and CSV output."
                        params={[
                            { name: 'from', required: true, type: 'string', description: 'Start date (ISO 8601), e.g. 2026-06-01' },
                            { name: 'to', required: true, type: 'string', description: 'End date (ISO 8601), e.g. 2026-06-30' },
                            { name: 'group', required: false, type: 'string', description: 'Filter by group name. Omit for all groups.' },
                            { name: 'format', required: false, type: '"json" | "csv"', description: 'Response format. Default: json' },
                        ]}
                        responseExample={`{
  "success": true,
  "period": { "from": "2026-06-01", "to": "2026-06-30" },
  "group": "Administration",
  "count": 150,
  "data": [
    {
      "employee_name": "DELA CRUZ, JUAN A.",
      "group": "Administration",
      "date": "06/01/2026",
      "day_status": "",
      "schedule_start": "08:00",
      "schedule_end": "17:00",
      "unpaidbreak_start": "12:00",
      "unpaidbreak_end": "13:00",
      "paidbreak_start": "",
      "paidbreak_end": ""
    }
  ]
}`}
                        exampleCurl={`# JSON
curl -H "Authorization: Bearer ${apiKey ?? 'YOUR_API_KEY'}" \\
  "${origin}/api/reports/work-schedule?from=2026-06-01&to=2026-06-30&group=Administration"

# CSV download
curl -H "Authorization: Bearer ${apiKey ?? 'YOUR_API_KEY'}" \\
  "${origin}/api/reports/work-schedule?from=2026-06-01&to=2026-06-30&format=csv" \\
  -o work-schedule.csv`}
                    />
                    <Endpoint
                        method="GET"
                        path="/api/reports/attendance-sheet"
                        summary="Attendance sheet report data"
                        description="Returns one row per employee with their attendance code for each day in the range. Codes: SKE (standard shift), SKE-10 (10h shift), WFH (work from home), HOL OFF (holiday), OFF (day off), or the leave type code (VL, SL, etc.). Supports JSON and CSV."
                        params={[
                            { name: 'from', required: true, type: 'string', description: 'Start date (ISO 8601). Typically start of week (Monday).' },
                            { name: 'to', required: true, type: 'string', description: 'End date (ISO 8601). Typically end of week (Sunday).' },
                            { name: 'group', required: false, type: 'string', description: 'Filter by group name. Omit for all groups.' },
                            { name: 'format', required: false, type: '"json" | "csv"', description: 'Response format. Default: json' },
                        ]}
                        responseExample={`{
  "success": true,
  "period": { "from": "2026-06-02", "to": "2026-06-08" },
  "group": "all",
  "days": ["Mon, Jun 2", "Tue, Jun 3", "Wed, Jun 4", "Thu, Jun 5", "Fri, Jun 6", "Sat, Jun 7", "Sun, Jun 8"],
  "count": 5,
  "data": [
    {
      "employee_name": "DELA CRUZ, JUAN A.",
      "group": "Administration",
      "position": "Senior Developer",
      "schedule": {
        "Mon, Jun 2": "SKE",
        "Tue, Jun 3": "WFH",
        "Wed, Jun 4": "VL",
        "Thu, Jun 5": "SKE",
        "Fri, Jun 6": "SKE",
        "Sat, Jun 7": "OFF",
        "Sun, Jun 8": "OFF"
      }
    }
  ]
}`}
                        exampleCurl={`# JSON
curl -H "Authorization: Bearer ${apiKey ?? 'YOUR_API_KEY'}" \\
  "${origin}/api/reports/attendance-sheet?from=2026-06-02&to=2026-06-08"

# CSV download
curl -H "Authorization: Bearer ${apiKey ?? 'YOUR_API_KEY'}" \\
  "${origin}/api/reports/attendance-sheet?from=2026-06-02&to=2026-06-08&format=csv" \\
  -o attendance.csv`}
                    />
                </div>
            </div>

            <Separator />

            {/* Error reference */}
            <Card>
                <CardHeader>
                    <CardTitle>Error Responses</CardTitle>
                    <CardDescription>All endpoints return JSON errors in a consistent format.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                    <div className="rounded-md border overflow-hidden">
                        <table className="w-full text-xs">
                            <thead className="bg-muted/50">
                                <tr>
                                    <th className="text-left px-3 py-2 font-medium">Status</th>
                                    <th className="text-left px-3 py-2 font-medium">Meaning</th>
                                    <th className="text-left px-3 py-2 font-medium">Example</th>
                                </tr>
                            </thead>
                            <tbody>
                                {[
                                    ['401', 'Unauthorized — missing or invalid API key', '{ "success": false, "error": "Unauthorized." }'],
                                    ['400', 'Bad request — missing or invalid parameters', '{ "success": false, "error": "Missing required query parameters: from, to." }'],
                                    ['503', 'API not configured — no API key has been set up', '{ "success": false, "error": "API key not configured." }'],
                                    ['500', 'Internal server error', '{ "success": false, "error": "..." }'],
                                ].map(([status, meaning, example], i) => (
                                    <tr key={status} className={i % 2 === 0 ? '' : 'bg-muted/20'}>
                                        <td className="px-3 py-2 font-mono font-bold">{status}</td>
                                        <td className="px-3 py-2 text-muted-foreground">{meaning}</td>
                                        <td className="px-3 py-2 font-mono text-xs text-muted-foreground">{example}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </CardContent>
            </Card>
        </div>
    );
}
