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
import { Loader2, X, Plus, FileSpreadsheet, Download, Upload } from 'lucide-react';
import { syncScheduleFromGoogleSheet } from '@/app/actions';
import { parseScheduleRows } from './schedule-importer';
import type { Shift, Leave, Employee } from '@/types';
import type { ShiftTemplate } from './shift-editor';
import type { LeaveTypeOption } from './leave-type-editor';
import { saveAs } from 'file-saver';

const DEFAULT_FILTERS = ['1', 'POST PRODUCTION', 'MAMS SUPPORT', 'MEDIA SERVER SUPPORT'];

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
};

export function GoogleSheetSyncDialog({
  isOpen, setIsOpen, onImport, employees, shiftTemplates, leaveTypes,
}: GoogleSheetSyncDialogProps) {
  const { toast } = useToast();

  // Config — kept only in component state, re-entered each time (not saved
  // to admin settings, per the requirement that this lives at manager level).
  const [fileId, setFileId] = useState('');
  const [sheetName, setSheetName] = useState('');
  const [filters, setFilters] = useState<string[]>(DEFAULT_FILTERS);
  const [newFilter, setNewFilter] = useState('');

  const [isSyncing, setIsSyncing] = useState(false);
  const [stage, setStage] = useState<'config' | 'choose'>('config');
  const [cleanedCsv, setCleanedCsv] = useState<string | null>(null);
  const [syncStats, setSyncStats] = useState<{ kept: number; removed: number } | null>(null);

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
    const result = await syncScheduleFromGoogleSheet(fileId.trim(), sheetName.trim(), filters);
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

  const handleDownloadCsv = () => {
    if (!cleanedCsv) return;
    const blob = new Blob([cleanedCsv], { type: 'text/csv;charset=utf-8;' });
    saveAs(blob, `schedule-sync-${sheetName || 'sheet'}.csv`);
    toast({ title: 'Downloaded', description: 'Cleaned CSV saved to your device.' });
    resetAndClose();
  };

  const handleImportDirectly = () => {
    if (!cleanedCsv) return;

    // Reuse the exact same parser as the manual file-upload importer so the
    // result is identical regardless of source.
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
      <DialogContent className="sm:max-w-lg">
        {stage === 'config' ? (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <FileSpreadsheet className="h-5 w-5 text-primary" />
                Sync Schedule from Google Sheets
              </DialogTitle>
              <DialogDescription>
                Pulls the sheet as CSV and removes rows that start with any of the filter prefixes below,
                so the result matches the format expected by Import Schedule.
              </DialogDescription>
            </DialogHeader>

            <div className="grid gap-4 py-2">
              <div className="space-y-2">
                <Label htmlFor="gsheet-file-id">Google Sheets File ID</Label>
                <Input
                  id="gsheet-file-id"
                  placeholder="e.g. 1YDl3DNXALbcw-m1i0Gs4HZLge5M2jITe"
                  value={fileId}
                  onChange={e => setFileId(e.target.value)}
                />
                <p className="text-xs text-muted-foreground">
                  The long ID found between <code>/d/</code> and the next <code>/</code> in the sheet's URL.
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

              <div className="space-y-2">
                <Label>Rows to Filter Out</Label>
                <p className="text-xs text-muted-foreground">
                  Any row whose first cell starts with one of these (case-insensitive) is removed before import.
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

            <DialogFooter>
              <Button variant="ghost" onClick={resetAndClose}>Cancel</Button>
              <Button onClick={handleSync} disabled={isSyncing}>
                {isSyncing && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
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
