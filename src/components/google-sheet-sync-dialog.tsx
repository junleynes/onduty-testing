'use client';

import React, { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { Badge } from './ui/badge';
import { useToast } from '@/hooks/use-toast';
import { Loader2, X, Plus, FileSpreadsheet, Download, Upload, RefreshCw, KeyRound, CalendarRange, Save, FolderOpen } from 'lucide-react';
import { syncScheduleFromGoogleSheet, updateGoogleSheet } from '@/app/actions';
import { parseScheduleRows } from './schedule-importer';
import type { Shift, Leave, Employee } from '@/types';
import type { ShiftTemplate } from './shift-editor';
import type { LeaveTypeOption } from './leave-type-editor';
import { saveAs } from 'file-saver';
import { format, addDays, startOfWeek, endOfWeek } from 'date-fns';

const DEFAULT_FILTERS = ['1', 'POST PRODUCTION', 'MAMS SUPPORT', 'MEDIA SERVER SUPPORT','1YDl3DNXALbcw-m1i0Gs4HZLge5M2jITe'];

const STORAGE_KEY = 'onduty_gsheet_configs';

type GSheetConfig = {
  id: string;
  name: string;
  fileId: string;
  sheetName: string;
  apiKey: string;
  filters: string[];
};

function loadConfigs(): GSheetConfig[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}

function saveConfigs(configs: GSheetConfig[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(configs));
}

type GoogleSheetSyncDialogProps = {
  isOpen: boolean;
  setIsOpen: (isOpen: boolean) => void;
  onImport: (importedData: {
    shifts: Shift[],
    leave: Leave[],
    monthlyOrders: Record<string, string[]>,
    overwrittenCells: { employeeId: string, date: Date }[],
    monthKeys: string[],
  }) => void;
  employees: Employee[];
  shiftTemplates: ShiftTemplate[];
  leaveTypes: LeaveTypeOption[];
  shifts?: Shift[];
};

export function GoogleSheetSyncDialog({
  isOpen, setIsOpen, onImport, employees, shiftTemplates, leaveTypes, shifts = [],
}: GoogleSheetSyncDialogProps) {
  const { toast } = useToast();

  const [fileId, setFileId] = useState('');
  const [sheetName, setSheetName] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [filters, setFilters] = useState<string[]>(DEFAULT_FILTERS);
  const [newFilter, setNewFilter] = useState('');

  // Date range
  const today = new Date();
  const [dateRangeEnabled, setDateRangeEnabled] = useState(false);
  const [dateFrom, setDateFrom] = useState(format(startOfWeek(today, { weekStartsOn: 1 }), 'yyyy-MM-dd'));
  const [dateTo, setDateTo] = useState(format(endOfWeek(today, { weekStartsOn: 1 }), 'yyyy-MM-dd'));

  // Saved config
  const [configs, setConfigs] = useState<GSheetConfig[]>(loadConfigs);
  const [configName, setConfigName] = useState('');
  const [showConfigPanel, setShowConfigPanel] = useState(false);

  const [isSyncing, setIsSyncing] = useState(false);
  const [isUpdating, setIsUpdating] = useState(false);
  const [stage, setStage] = useState<'config' | 'choose'>('config');
  const [cleanedCsv, setCleanedCsv] = useState<string | null>(null);
  const [syncStats, setSyncStats] = useState<{ kept: number; removed: number } | null>(null);

  const canUseApi = !!apiKey.trim();
  const hasFileId = !!fileId.trim();

  const resetAndClose = () => {
    setStage('config');
    setCleanedCsv(null);
    setSyncStats(null);
    setIsOpen(false);
  };

  const handleAddFilter = () => {
    const trimmed = newFilter.trim();
    if (!trimmed) return;
    if (filters.some(f => f.toLowerCase() === trimmed.toLowerCase())) {
      toast({ variant: 'destructive', title: 'Already in list', description: `"${trimmed}" is already a filter.` });
      return;
    }
    setFilters(prev => [...prev, trimmed]);
    setNewFilter('');
  };

  const handleRemoveFilter = (filter: string) => {
    setFilters(prev => prev.filter(f => f !== filter));
  };

  const handleSaveConfig = () => {
    const name = configName.trim();
    if (!name) {
      toast({ variant: 'destructive', title: 'Name required', description: 'Enter a name for this configuration.' });
      return;
    }
    const newConfig: GSheetConfig = {
      id: Date.now().toString(),
      name,
      fileId,
      sheetName,
      apiKey,
      filters,
    };
    const updated = [...configs.filter(c => c.name !== name), newConfig];
    saveConfigs(updated);
    setConfigs(updated);
    setConfigName('');
    toast({ title: 'Config saved', description: `"${name}" saved for future use.` });
  };

  const handleLoadConfig = (config: GSheetConfig) => {
    setFileId(config.fileId);
    setSheetName(config.sheetName);
    setApiKey(config.apiKey);
    setFilters(config.filters);
    setShowConfigPanel(false);
    toast({ title: 'Config loaded', description: `"${config.name}" loaded.` });
  };

  const handleDeleteConfig = (id: string) => {
    const updated = configs.filter(c => c.id !== id);
    saveConfigs(updated);
    setConfigs(updated);
  };

  const handleSync = async () => {
    if (!fileId.trim()) {
      toast({ variant: 'destructive', title: 'File ID required', description: 'Paste the Google Sheets File ID.' });
      return;
    }
    if (!sheetName.trim()) {
      toast({ variant: 'destructive', title: 'Sheet name required', description: 'Enter the tab/sheet name to read, e.g. "2026".' });
      return;
    }

    setIsSyncing(true);
    const result = await syncScheduleFromGoogleSheet(
      fileId.trim(),
      sheetName.trim(),
      filters,
      dateRangeEnabled ? { from: dateFrom, to: dateTo } : undefined,
    );
    setIsSyncing(false);

    if (!result.success || !result.csv) {
      toast({ variant: 'destructive', title: 'Sync Failed', description: result.error || 'Could not fetch the sheet.', duration: 8000 });
      return;
    }

    setCleanedCsv(result.csv);
    setSyncStats({ kept: result.rowsKept ?? 0, removed: result.rowsRemoved ?? 0 });
    setStage('choose');
    toast({ title: 'Sheet Synced', description: `${result.rowsKept} row(s) kept, ${result.rowsRemoved} filtered out.` });
  };

  const handleUpdateGSheet = async () => {
    if (!canUseApi) return;
    if (!fileId.trim() || !sheetName.trim()) {
      toast({ variant: 'destructive', title: 'Config incomplete', description: 'File ID and Sheet Name are required.' });
      return;
    }

    setIsUpdating(true);
    const result = await updateGoogleSheet(
      fileId.trim(),
      sheetName.trim(),
      apiKey.trim(),
      shifts,
      employees,
      dateRangeEnabled ? { from: dateFrom, to: dateTo } : undefined,
    );
    setIsUpdating(false);

    if (!result.success) {
      toast({ variant: 'destructive', title: 'Update Failed', description: result.error || 'Could not update the sheet.', duration: 8000 });
      return;
    }

    toast({ title: 'Sheet Updated', description: result.message ?? 'Google Sheet updated successfully.' });
  };

  const handleDownloadCsv = () => {
    if (!cleanedCsv) return;
    const blob = new Blob([cleanedCsv], { type: 'text/csv;charset=utf-8;' });
    saveAs(blob, `schedule-sync-${sheetName || 'sheet'}.csv`);
    toast({ title: 'Downloaded', description: 'Cleaned CSV saved to your device.' });
    resetAndClose();
  };

  const handleImportDirectly = () => {
    if (!cleanedCsv) return;

    const rows = cleanedCsv.split('\n').map(line => {
      const cells: string[] = [];
      let cur = '';
      let inQuotes = false;
      for (let i = 0; i < line.length; i++) {
        const ch = line[i];
        if (ch === '"') {
          if (inQuotes && line[i + 1] === '"') { cur += '"'; i++; }
          else inQuotes = !inQuotes;
        } else if (ch === ',' && !inQuotes) {
          cells.push(cur); cur = '';
        } else {
          cur += ch;
        }
      }
      cells.push(cur);
      return cells;
    });

    const result = parseScheduleRows(rows, employees, shiftTemplates, leaveTypes);

    if ('error' in result) {
      toast({ variant: 'destructive', title: 'Import Failed', description: result.error, duration: 8000 });
      return;
    }

    onImport(result);
    toast({ title: 'Import Successful', description: `${result.shifts.length} shifts and ${result.leave.length} leave entries imported.` });
    resetAndClose();
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => { if (!open) resetAndClose(); else setIsOpen(true); }}>
      <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
        {stage === 'config' ? (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <FileSpreadsheet className="h-5 w-5 text-primary" />
                Google Sheets Sync
              </DialogTitle>
              <DialogDescription>
                Pull from or push to your Google Sheet. Use a date range to limit which columns are affected.
              </DialogDescription>
            </DialogHeader>

            <div className="grid gap-4 py-2">

              {/* ── Saved Configs ── */}
              <div className="flex items-center justify-between">
                <Label className="text-sm font-medium">Saved Configurations</Label>
                <Button
                  type="button" variant="ghost" size="sm"
                  className="h-7 gap-1 text-xs"
                  onClick={() => setShowConfigPanel(v => !v)}
                >
                  <FolderOpen className="h-3.5 w-3.5" />
                  {showConfigPanel ? 'Hide' : `Load (${configs.length})`}
                </Button>
              </div>

              {showConfigPanel && (
                <div className="rounded-md border p-3 space-y-2 bg-muted/40">
                  {configs.length === 0 && (
                    <p className="text-xs text-muted-foreground italic">No saved configurations yet.</p>
                  )}
                  {configs.map(c => (
                    <div key={c.id} className="flex items-center justify-between gap-2">
                      <span className="text-sm truncate flex-1">{c.name}</span>
                      <div className="flex gap-1">
                        <Button type="button" size="sm" variant="outline" className="h-6 text-xs px-2" onClick={() => handleLoadConfig(c)}>Load</Button>
                        <Button type="button" size="sm" variant="ghost" className="h-6 text-xs px-1 text-destructive" onClick={() => handleDeleteConfig(c.id)}>
                          <X className="h-3 w-3" />
                        </Button>
                      </div>
                    </div>
                  ))}
                  <div className="flex gap-2 pt-1 border-t">
                    <Input
                      placeholder="Config name to save as..."
                      value={configName}
                      className="h-7 text-xs"
                      onChange={e => setConfigName(e.target.value)}
                      onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); handleSaveConfig(); } }}
                    />
                    <Button type="button" size="sm" variant="outline" className="h-7 gap-1 text-xs shrink-0" onClick={handleSaveConfig}>
                      <Save className="h-3 w-3" /> Save
                    </Button>
                  </div>
                </div>
              )}

              {/* ── Connection ── */}
              <div className="space-y-2">
                <Label htmlFor="gsheet-file-id">Google Sheets File ID</Label>
                <Input
                  id="gsheet-file-id"
                  placeholder="e.g. 1YDl3DNXALbcw-m1i0Gs4HZLge5M2jITe"
                  value={fileId}
                  onChange={e => setFileId(e.target.value)}
                />
                <p className="text-xs text-muted-foreground">
                  The long ID between <code>/d/</code> and the next <code>/</code> in the sheet URL.
                </p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="gsheet-sheet-name">Sheet Name (tab)</Label>
                <Input
                  id="gsheet-sheet-name"
                  placeholder="e.g. 2026"
                  value={sheetName}
                  onChange={e => setSheetName(e.target.value)}
                />
              </div>

              {/* ── API Key ── */}
              <div className="space-y-2">
                <Label htmlFor="gsheet-api-key" className="flex items-center gap-1.5">
                  <KeyRound className="h-3.5 w-3.5" />
                  Google Sheets API Key
                  <span className="text-xs text-muted-foreground font-normal ml-1">(required for Update Sheet)</span>
                </Label>
                <Input
                  id="gsheet-api-key"
                  type="password"
                  placeholder="AIza..."
                  value={apiKey}
                  onChange={e => setApiKey(e.target.value)}
                />
                <p className="text-xs text-muted-foreground">
                  Only needed to push changes back to Google Sheets. Sync (read) works without it.
                </p>
              </div>

              {/* ── Date Range ── */}
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <input
                    id="date-range-toggle"
                    type="checkbox"
                    className="h-4 w-4 rounded border"
                    checked={dateRangeEnabled}
                    onChange={e => setDateRangeEnabled(e.target.checked)}
                  />
                  <Label htmlFor="date-range-toggle" className="flex items-center gap-1.5 cursor-pointer">
                    <CalendarRange className="h-3.5 w-3.5" />
                    Limit to date range
                  </Label>
                </div>

                {dateRangeEnabled && (
                  <div className="flex gap-2 pl-6">
                    <div className="flex-1 space-y-1">
                      <Label className="text-xs text-muted-foreground">From</Label>
                      <Input
                        type="date"
                        value={dateFrom}
                        onChange={e => setDateFrom(e.target.value)}
                        className="h-8 text-sm"
                      />
                    </div>
                    <div className="flex-1 space-y-1">
                      <Label className="text-xs text-muted-foreground">To</Label>
                      <Input
                        type="date"
                        value={dateTo}
                        onChange={e => setDateTo(e.target.value)}
                        className="h-8 text-sm"
                      />
                    </div>
                  </div>
                )}
              </div>

              {/* ── Filters ── */}
              <div className="space-y-2">
                <Label>Rows to Filter Out</Label>
                <p className="text-xs text-muted-foreground">
                  Rows whose first cell starts with any of these (case-insensitive) are removed before import.
                </p>
                <div className="flex flex-wrap gap-1.5 min-h-[2rem]">
                  {filters.map(f => (
                    <Badge key={f} variant="secondary" className="gap-1 pr-1">
                      {f}
                      <button
                        type="button"
                        onClick={() => handleRemoveFilter(f)}
                        className="ml-1 rounded-full hover:bg-muted-foreground/20 p-0.5"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </Badge>
                  ))}
                  {filters.length === 0 && (
                    <span className="text-xs text-muted-foreground italic">No filters — every row will be kept.</span>
                  )}
                </div>
                <div className="flex gap-2">
                  <Input
                    placeholder="Add a prefix to filter, e.g. POST PRODUCTION"
                    value={newFilter}
                    onChange={e => setNewFilter(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); handleAddFilter(); } }}
                  />
                  <Button type="button" variant="outline" onClick={handleAddFilter}>
                    <Plus className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            </div>

            <DialogFooter className="flex-col sm:flex-row gap-2">
              <Button variant="ghost" onClick={resetAndClose} className="sm:mr-auto">Cancel</Button>
              <Button
                variant="outline"
                onClick={handleUpdateGSheet}
                disabled={isUpdating || !hasFileId || !canUseApi}
                title={!canUseApi ? 'API Key is required to update the sheet' : undefined}
              >
                {isUpdating
                  ? <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  : <Upload className="mr-2 h-4 w-4" />
                }
                Update Sheet
              </Button>
              <Button onClick={handleSync} disabled={isSyncing || !hasFileId}>
                {isSyncing
                  ? <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  : <RefreshCw className="mr-2 h-4 w-4" />
                }
                Sync Now
              </Button>
            </DialogFooter>
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>Sync Complete</DialogTitle>
              <DialogDescription>
                {syncStats && (
                  <>Kept <strong>{syncStats.kept}</strong> row(s), filtered out <strong>{syncStats.removed}</strong> row(s).</>
                )}
                {' '}What would you like to do with the result?
              </DialogDescription>
            </DialogHeader>

            <div className="grid grid-cols-2 gap-4 py-4">
              <Button variant="outline" className="h-auto flex-col gap-2 py-6" onClick={handleDownloadCsv}>
                <Download className="h-6 w-6" />
                <span>Download as CSV</span>
              </Button>
              <Button className="h-auto flex-col gap-2 py-6" onClick={handleImportDirectly}>
                <Upload className="h-6 w-6" />
                <span>Import Schedule</span>
              </Button>
            </div>

            <DialogFooter>
              <Button variant="ghost" onClick={() => setStage('config')}>Back</Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
