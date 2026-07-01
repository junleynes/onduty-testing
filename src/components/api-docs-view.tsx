'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { Copy, Check, Terminal, Lock, Download, Upload, FileSpreadsheet, BarChart3, BookOpen, Plus, Trash2, Eye, EyeOff, Loader2, Sparkles } from 'lucide-react';
import { getApiKeys, createApiKey, deleteApiKey, getAiConfig, saveAiConfig } from '@/app/actions';
import type { ApiKeyRecord, AiConfig, AiProvider } from '@/app/actions';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';

// ── Clipboard helper (works on http + https) ──────────────────────────────────
async function copyToClipboard(text: string): Promise<boolean> {
    try {
        if (navigator.clipboard && window.isSecureContext) {
            await navigator.clipboard.writeText(text);
            return true;
        }
        // Fallback for non-HTTPS (e.g. local network IP access)
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.style.cssText = 'position:fixed;left:-9999px;top:-9999px;opacity:0';
        document.body.appendChild(ta);
        ta.focus();
        ta.select();
        const ok = document.execCommand('copy');
        document.body.removeChild(ta);
        return ok;
    } catch {
        return false;
    }
}

// ── Small code block component ────────────────────────────────────────────────
function CodeBlock({ children, language = 'bash' }: { children: string; language?: string }) {
    const { toast } = useToast();
    const [copied, setCopied] = useState(false);
    const copy = async () => {
        const ok = await copyToClipboard(children.trim());
        if (ok) {
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
        } else {
            toast({ variant: 'destructive', title: 'Copy failed', description: 'Please select and copy the text manually.' });
        }
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

// ── Single API key row ────────────────────────────────────────────────────────
function ApiKeyRow({ record, onDelete }: { record: ApiKeyRecord; onDelete: (id: string) => void }) {
    const { toast } = useToast();
    const [visible, setVisible] = useState(false);
    const [copied, setCopied] = useState(false);
    const [deleting, setDeleting] = useState(false);

    const masked = record.key_value.slice(0, 8) + '•'.repeat(Math.max(0, record.key_value.length - 12)) + record.key_value.slice(-4);

    const handleCopy = async () => {
        const ok = await copyToClipboard(record.key_value);
        if (ok) {
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
        } else {
            toast({ variant: 'destructive', title: 'Copy failed', description: 'Please select and copy the key manually.' });
        }
    };

    const handleDelete = async () => {
        setDeleting(true);
        const result = await deleteApiKey(record.id);
        if (result.success) {
            onDelete(record.id);
            toast({ title: 'Key Deleted', description: `"${record.name}" has been revoked.` });
        } else {
            toast({ variant: 'destructive', title: 'Failed', description: result.error });
            setDeleting(false);
        }
    };

    return (
        <div className="flex flex-col gap-2 p-3 border rounded-lg">
            <div className="flex items-center justify-between gap-2">
                <div>
                    <p className="text-sm font-medium">{record.name}</p>
                    <p className="text-xs text-muted-foreground">Created {new Date(record.created_at).toLocaleDateString()}</p>
                </div>
                <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive hover:text-destructive" onClick={handleDelete} disabled={deleting} title="Revoke key">
                    {deleting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                </Button>
            </div>
            <div className="flex items-center gap-2">
                <code className="flex-1 font-mono text-xs bg-muted px-3 py-1.5 rounded border overflow-x-auto">
                    {visible ? record.key_value : masked}
                </code>
                <Button variant="outline" size="icon" className="h-8 w-8 shrink-0" onClick={() => setVisible(v => !v)} title={visible ? 'Hide' : 'Reveal'}>
                    {visible ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                </Button>
                <Button variant="outline" size="icon" className="h-8 w-8 shrink-0" onClick={handleCopy} title="Copy to clipboard">
                    {copied ? <Check className="h-3.5 w-3.5 text-green-500" /> : <Copy className="h-3.5 w-3.5" />}
                </Button>
            </div>
        </div>
    );
}

// ── Main component ────────────────────────────────────────────────────────────
export default function ApiDocsView() {
    const { toast } = useToast();
    const [keys, setKeys] = useState<ApiKeyRecord[]>([]);
    const [loading, setLoading] = useState(true);
    const [newKeyName, setNewKeyName] = useState('');
    const [creating, setCreating] = useState(false);
    const [newlyCreated, setNewlyCreated] = useState<ApiKeyRecord | null>(null);

    // AI Config state
    const [aiConfig, setAiConfig] = useState<AiConfig>({ provider: 'anthropic', enabled: false });
    const [aiConfigLoaded, setAiConfigLoaded] = useState(false);
    const [isLoadingAi, setIsLoadingAi] = useState(false);
    const [isSavingAi, setIsSavingAi] = useState(false);

    const origin = typeof window !== 'undefined' ? window.location.origin : 'https://your-onduty.com';
    // Use the first key value in examples, if any
    const exampleKey = keys[0]?.key_value ?? 'YOUR_API_KEY';

    const load = useCallback(async () => {
        setLoading(true);
        const result = await getApiKeys();
        if (result.success) setKeys(result.keys ?? []);
        setLoading(false);
    }, []);

    useEffect(() => { load(); }, [load]);

    const handleLoadAiConfig = async () => {
        setIsLoadingAi(true);
        const res = await getAiConfig();
        setIsLoadingAi(false);
        if (res.success && res.config) {
            setAiConfig(res.config);
            setAiConfigLoaded(true);
        } else {
            toast({ variant: 'destructive', title: 'Failed to load AI config', description: res.error });
        }
    };

    const handleSaveAiConfig = async () => {
        setIsSavingAi(true);
        const res = await saveAiConfig(aiConfig);
        setIsSavingAi(false);
        if (res.success) {
            toast({ title: 'AI Config Saved' });
        } else {
            toast({ variant: 'destructive', title: 'Failed to save AI config', description: res.error });
        }
    };

    // Auto-load AI config when view mounts
    useEffect(() => { handleLoadAiConfig(); }, []);

    const handleCreate = async () => {
        if (!newKeyName.trim()) {
            toast({ variant: 'destructive', title: 'Name required', description: 'Enter a name for this API key before generating.' });
            return;
        }
        setCreating(true);
        const result = await createApiKey(newKeyName.trim());
        if (result.success && result.key) {
            setKeys(prev => [...prev, result.key!]);
            setNewlyCreated(result.key!);
            setNewKeyName('');
            toast({ title: 'API Key Created', description: `Key "${result.key.name}" is ready. Copy it now — it won't be shown again.` });
        } else {
            toast({ variant: 'destructive', title: 'Failed', description: result.error });
        }
        setCreating(false);
    };

    const handleDelete = (id: string) => {
        setKeys(prev => prev.filter(k => k.id !== id));
        if (newlyCreated?.id === id) setNewlyCreated(null);
    };

    return (
        <div className="max-w-4xl mx-auto space-y-6">
            {/* Header */}
            <div className="flex items-center gap-3">
                <BookOpen className="h-6 w-6 text-primary" />
                <div>
                    <h1 className="text-2xl font-bold">API &amp; Integrations</h1>
                    <p className="text-sm text-muted-foreground">Manage API keys and integrate OnDuty data with external systems.</p>
                </div>
            </div>

            {/* ── AI Configuration ── */}
            <Card>
                <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                        <Sparkles className="h-5 w-5 text-primary" />
                        AI Configuration
                    </CardTitle>
                    <CardDescription>
                        Configure the AI provider for Smart Scheduling. Supports Anthropic, OpenRouter, and local Ollama.
                    </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                    {isLoadingAi && !aiConfigLoaded && (
                        <div className="flex items-center gap-2 text-sm text-muted-foreground">
                            <Loader2 className="h-4 w-4 animate-spin" /> Loading AI config…
                        </div>
                    )}
                    {aiConfigLoaded && (
                        <>
                            {/* Enable toggle */}
                            <div className="flex items-center gap-3">
                                <input
                                    id="ai-enabled"
                                    type="checkbox"
                                    className="h-4 w-4 rounded border"
                                    checked={aiConfig.enabled}
                                    onChange={e => setAiConfig(c => ({ ...c, enabled: e.target.checked }))}
                                />
                                <label htmlFor="ai-enabled" className="text-sm font-medium cursor-pointer">Enable AI features</label>
                            </div>

                            {/* Provider */}
                            <div className="space-y-1.5">
                                <label className="text-sm font-medium">Provider</label>
                                <Select
                                    value={aiConfig.provider}
                                    onValueChange={v => setAiConfig(c => ({ ...c, provider: v as AiProvider, baseUrl: undefined, model: undefined }))}
                                >
                                    <SelectTrigger className="w-52">
                                        <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="anthropic">Anthropic (Claude)</SelectItem>
                                        <SelectItem value="openrouter">OpenRouter</SelectItem>
                                        <SelectItem value="ollama">Ollama (local)</SelectItem>
                                    </SelectContent>
                                </Select>
                            </div>

                            {/* Base URL — openrouter and ollama only */}
                            {(aiConfig.provider === 'openrouter' || aiConfig.provider === 'ollama') && (
                                <div className="space-y-1.5">
                                    <label className="text-sm font-medium">Base URL</label>
                                    <Input
                                        placeholder={aiConfig.provider === 'ollama' ? 'http://localhost:11434' : 'https://openrouter.ai/api/v1'}
                                        value={aiConfig.baseUrl ?? ''}
                                        onChange={e => setAiConfig(c => ({ ...c, baseUrl: e.target.value }))}
                                    />
                                </div>
                            )}

                            {/* API Key — not needed for Ollama */}
                            {aiConfig.provider !== 'ollama' && (
                                <div className="space-y-1.5">
                                    <label className="text-sm font-medium">API Key</label>
                                    <Input
                                        type="password"
                                        placeholder={aiConfig.provider === 'anthropic' ? 'sk-ant-…' : 'sk-or-…'}
                                        value={aiConfig.apiKey ?? ''}
                                        onChange={e => setAiConfig(c => ({ ...c, apiKey: e.target.value }))}
                                    />
                                </div>
                            )}

                            {/* Model */}
                            <div className="space-y-1.5">
                                <label className="text-sm font-medium">
                                    Model <span className="text-xs text-muted-foreground font-normal">(leave blank for default)</span>
                                </label>
                                <Input
                                    placeholder={
                                        aiConfig.provider === 'anthropic'  ? 'claude-sonnet-4-6' :
                                        aiConfig.provider === 'openrouter' ? 'openai/gpt-4o' :
                                        'llama3'
                                    }
                                    value={aiConfig.model ?? ''}
                                    onChange={e => setAiConfig(c => ({ ...c, model: e.target.value || undefined }))}
                                />
                            </div>

                            <div className="flex justify-end pt-2">
                                <Button onClick={handleSaveAiConfig} disabled={isSavingAi}>
                                    {isSavingAi ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Saving…</> : 'Save AI Config'}
                                </Button>
                            </div>
                        </>
                    )}
                </CardContent>
            </Card>

            {/* API Key Management */}
            <Card>
                <CardHeader>
                    <CardTitle className="flex items-center gap-2"><Lock className="h-4 w-4" /> API Keys</CardTitle>
                    <CardDescription>
                        All API endpoints require a valid key. Pass it as <code className="text-xs bg-muted px-1 py-0.5 rounded">Authorization: Bearer &lt;key&gt;</code> or <code className="text-xs bg-muted px-1 py-0.5 rounded">x-api-key</code> header.
                        Multiple keys can be active simultaneously — each integration should have its own key.
                    </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                    {loading ? (
                        <p className="text-sm text-muted-foreground flex items-center gap-2"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</p>
                    ) : keys.length === 0 ? (
                        <p className="text-sm text-amber-600 dark:text-amber-400">No API keys yet. Generate one below to enable the API.</p>
                    ) : (
                        <div className="space-y-2">
                            {keys.map(k => (
                                <ApiKeyRow key={k.id} record={k} onDelete={handleDelete} />
                            ))}
                        </div>
                    )}

                    {/* New key form */}
                    <div className="pt-2 border-t space-y-3">
                        <p className="text-sm font-medium">Generate a new key</p>
                        <div className="flex gap-2">
                            <div className="flex-1 space-y-1">
                                <Label htmlFor="newKeyName" className="text-xs text-muted-foreground">Key name (e.g. "Power Automate", "External Dashboard")</Label>
                                <Input
                                    id="newKeyName"
                                    placeholder="My Integration"
                                    value={newKeyName}
                                    onChange={e => setNewKeyName(e.target.value)}
                                    onKeyDown={e => e.key === 'Enter' && handleCreate()}
                                    maxLength={80}
                                />
                            </div>
                            <div className="flex items-end">
                                <Button onClick={handleCreate} disabled={creating}>
                                    {creating ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Plus className="mr-2 h-4 w-4" />}
                                    Generate
                                </Button>
                            </div>
                        </div>
                        <p className="text-xs text-muted-foreground">Copy the key immediately after generating — it will be masked afterwards. Deleting a key immediately revokes access for any integration using it.</p>
                    </div>
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
                    <h2 className="text-lg font-semibold">Backup &amp; Restore</h2>
                </div>
                <div className="space-y-3">
                    <Endpoint
                        method="GET"
                        path="/api/backup"
                        summary="Download full backup (DB + uploads)"
                        description="Returns a .zip archive containing the SQLite database (local.db) and the entire uploads/ folder (avatars, signatures, PDFs, templates). Compatible with the Restore endpoint and the in-app Restore function."
                        exampleCurl={`curl -H "Authorization: Bearer ${exampleKey}" \\
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
  -H "Authorization: Bearer ${exampleKey}" \\
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
  -H "x-api-key: ${exampleKey}" \\
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
curl -H "Authorization: Bearer ${exampleKey}" \\
  "${origin}/api/reports/work-schedule?from=2026-06-01&to=2026-06-30&group=Administration"

# CSV download
curl -H "Authorization: Bearer ${exampleKey}" \\
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
curl -H "Authorization: Bearer ${exampleKey}" \\
  "${origin}/api/reports/attendance-sheet?from=2026-06-02&to=2026-06-08"

# CSV download
curl -H "Authorization: Bearer ${exampleKey}" \\
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
