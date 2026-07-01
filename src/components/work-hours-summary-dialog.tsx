'use client';

/**
 * Work Hours Summary Dialog
 *
 * Computes for each Rank-and-File employee (per selected period):
 *  - Total scheduled hours
 *  - Extension (overtime) hours — shifts where approved Work Extension leave exists
 *  - Holiday duty hours — shifts that fall on a declared holiday
 *  - Combined extension + holiday duty hours
 *
 * No AI required — this is pure data computation.
 */

import React, { useState, useMemo } from 'react';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Button } from './ui/button';
import { Label } from './ui/label';
import { Input } from './ui/input';
import { Badge } from './ui/badge';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { Clock, CalendarRange, Download, TrendingUp } from 'lucide-react';
import type { Shift, Leave, Employee, Holiday } from '@/types';
import {
  startOfMonth, endOfMonth, startOfWeek, endOfWeek,
  startOfYear, endOfYear, format, isSameDay, addWeeks,
} from 'date-fns';
import { saveAs } from 'file-saver';
import Papa from 'papaparse';
import { getFullName } from '@/lib/utils';

// ── Types ─────────────────────────────────────────────────────────────────────

type RangePre = 'week' | 'month' | 'year' | 'custom';

type EmployeeSummary = {
  employeeId: string;
  name: string;
  position: string;
  totalHours: number;
  extensionHours: number;    // approved Work Extension shifts
  holidayHours: number;      // shifts on declared holidays
  combinedExtraHours: number; // unique union of extension + holiday duty hours
};

type Props = {
  isOpen: boolean;
  setIsOpen: (v: boolean) => void;
  shifts: Shift[];
  leave: Leave[];
  employees: Employee[];
  holidays: Holiday[];
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function durationHours(start?: string, end?: string): number {
  if (!start || !end) return 0;
  const [sh, sm] = start.split(':').map(Number);
  const [eh, em] = end.split(':').map(Number);
  let s = (sh ?? 0) * 60 + (sm ?? 0);
  let e = (eh ?? 0) * 60 + (em ?? 0);
  if (e <= s) e += 1440; // overnight
  return (e - s) / 60;
}

function roundHalf(n: number): number {
  return Math.round(n * 2) / 2;
}

// ── Component ─────────────────────────────────────────────────────────────────

export function WorkHoursSummaryDialog({
  isOpen, setIsOpen, shifts, leave, employees, holidays,
}: Props) {
  const today = new Date();

  const [range, setRange] = useState<RangePre>('month');
  const [customFrom, setCustomFrom] = useState(format(startOfMonth(today), 'yyyy-MM-dd'));
  const [customTo, setCustomTo] = useState(format(endOfMonth(today), 'yyyy-MM-dd'));
  const [sortKey, setSortKey] = useState<keyof EmployeeSummary>('extensionHours');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');

  const { from, to } = useMemo((): { from: Date; to: Date } => {
    switch (range) {
      case 'week':  return { from: startOfWeek(today, { weekStartsOn: 1 }), to: endOfWeek(today, { weekStartsOn: 1 }) };
      case 'month': return { from: startOfMonth(today), to: endOfMonth(today) };
      case 'year':  return { from: startOfYear(today), to: endOfYear(today) };
      default:      return { from: new Date(customFrom), to: new Date(customTo) };
    }
  }, [range, customFrom, customTo]);

  // Only Rank-and-File employees
  const rankAndFile = useMemo(() =>
    employees.filter(e => e.employeeClassification === 'Rank-and-File' || !e.employeeClassification),
    [employees]
  );

  // Approved Work Extension leave records in range — index by employeeId + date
  const weLeaveSet = useMemo(() => {
    const set = new Set<string>(); // key: `${employeeId}|yyyy-MM-dd`
    for (const l of leave) {
      if (l.type !== 'Work Extension') continue;
      if (l.status !== 'approved') continue;
      const d = new Date(l.startDate);
      if (d < from || d > to) continue;
      set.add(`${l.employeeId}|${format(d, 'yyyy-MM-dd')}`);
    }
    return set;
  }, [leave, from, to]);

  // Holiday dates in range
  const holidayDates = useMemo(() => {
    const set = new Set<string>(); // yyyy-MM-dd
    for (const h of holidays) {
      const d = new Date(h.date);
      if (d >= from && d <= to) set.add(format(d, 'yyyy-MM-dd'));
    }
    return set;
  }, [holidays, from, to]);

  const summaries: EmployeeSummary[] = useMemo(() => {
    return rankAndFile.map(emp => {
      const empShifts = shifts.filter(s => {
        if (s.employeeId !== emp.id) return false;
        if (s.isDayOff || s.isHolidayOff) return false;
        if (!s.startTime || !s.endTime) return false;
        const d = new Date(s.date);
        return d >= from && d <= to;
      });

      let totalHours = 0;
      let extensionHours = 0;
      let holidayHours = 0;
      // Track shift ids counted in both to avoid double-counting in combined
      const extensionShiftIds = new Set<string>();
      const holidayShiftIds = new Set<string>();

      for (const s of empShifts) {
        const h = durationHours(s.startTime, s.endTime);
        totalHours += h;

        const dateKey = format(new Date(s.date), 'yyyy-MM-dd');
        const weKey = `${emp.id}|${dateKey}`;

        if (weLeaveSet.has(weKey)) {
          extensionHours += h;
          extensionShiftIds.add(s.id);
        }
        if (holidayDates.has(dateKey)) {
          holidayHours += h;
          holidayShiftIds.add(s.id);
        }
      }

      // Combined: union of extension + holiday shifts (no double counting)
      const combined = new Set([...extensionShiftIds, ...holidayShiftIds]);
      const combinedExtraHours = empShifts
        .filter(s => combined.has(s.id))
        .reduce((sum, s) => sum + durationHours(s.startTime, s.endTime), 0);

      return {
        employeeId: emp.id,
        name: getFullName(emp),
        position: emp.position ?? '',
        totalHours: roundHalf(totalHours),
        extensionHours: roundHalf(extensionHours),
        holidayHours: roundHalf(holidayHours),
        combinedExtraHours: roundHalf(combinedExtraHours),
      };
    });
  }, [rankAndFile, shifts, from, to, weLeaveSet, holidayDates]);

  const sorted = useMemo(() => {
    return [...summaries].sort((a, b) => {
      const av = a[sortKey] as number | string;
      const bv = b[sortKey] as number | string;
      const cmp = typeof av === 'string' ? av.localeCompare(bv as string) : (av as number) - (bv as number);
      return sortDir === 'asc' ? cmp : -cmp;
    });
  }, [summaries, sortKey, sortDir]);

  const handleSort = (key: keyof EmployeeSummary) => {
    if (sortKey === key) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortKey(key); setSortDir('desc'); }
  };

  const handleExport = () => {
    const rows = sorted.map(s => ({
      'Employee': s.name,
      'Position': s.position,
      'Total Hours': s.totalHours,
      'Extension Hours': s.extensionHours,
      'Holiday Duty Hours': s.holidayHours,
      'Total Extra Hours': s.combinedExtraHours,
      'Period': `${format(from, 'MMM d')} – ${format(to, 'MMM d, yyyy')}`,
    }));
    const csv = Papa.unparse(rows);
    saveAs(new Blob([csv], { type: 'text/csv;charset=utf-8;' }), `work-hours-${format(from, 'yyyy-MM-dd')}.csv`);
  };

  const SortIcon = ({ col }: { col: keyof EmployeeSummary }) =>
    sortKey === col ? (sortDir === 'asc' ? ' ↑' : ' ↓') : null;

  const thClass = 'cursor-pointer select-none hover:bg-muted/60 whitespace-nowrap';

  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      <DialogContent className="sm:max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <TrendingUp className="h-5 w-5 text-primary" />
            Work Hours Summary
          </DialogTitle>
          <DialogDescription>
            Total, extension (OT), and holiday duty hours per Rank-and-File employee. No AI — pure computation from your schedule data.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Period selector */}
          <div className="space-y-2">
            <Label className="flex items-center gap-1.5"><CalendarRange className="h-3.5 w-3.5" />Period</Label>
            <div className="flex gap-2 flex-wrap">
              {(['week', 'month', 'year', 'custom'] as RangePre[]).map(r => (
                <Button key={r} type="button" size="sm"
                  variant={range === r ? 'default' : 'outline'}
                  className="capitalize"
                  onClick={() => setRange(r)}>
                  {r === 'week' ? 'This Week' : r === 'month' ? 'This Month' : r === 'year' ? 'This Year' : 'Custom'}
                </Button>
              ))}
            </div>
            {range === 'custom' && (
              <div className="flex gap-2 pt-1">
                <div className="flex-1 space-y-1">
                  <Label className="text-xs text-muted-foreground">From</Label>
                  <Input type="date" value={customFrom} onChange={e => setCustomFrom(e.target.value)} className="h-8 text-sm" />
                </div>
                <div className="flex-1 space-y-1">
                  <Label className="text-xs text-muted-foreground">To</Label>
                  <Input type="date" value={customTo} onChange={e => setCustomTo(e.target.value)} className="h-8 text-sm" />
                </div>
              </div>
            )}
            <p className="text-xs text-muted-foreground">
              {format(from, 'MMM d, yyyy')} – {format(to, 'MMM d, yyyy')}
              {' · '}{rankAndFile.length} Rank-and-File employee{rankAndFile.length !== 1 ? 's' : ''}
            </p>
          </div>

          {/* Legend */}
          <div className="flex flex-wrap gap-2 text-xs">
            <Badge variant="outline" className="gap-1"><Clock className="h-3 w-3" />Extension = approved Work Extension leave + shift on that day</Badge>
            <Badge variant="outline" className="gap-1"><Clock className="h-3 w-3" />Holiday Duty = shift on a declared holiday</Badge>
            <Badge variant="outline" className="gap-1 text-primary border-primary">Total Extra = union of above (no double-count)</Badge>
          </div>

          {/* Table */}
          <div className="rounded-md border overflow-auto max-h-[420px]">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className={thClass} onClick={() => handleSort('name')}>Employee<SortIcon col="name" /></TableHead>
                  <TableHead className={thClass} onClick={() => handleSort('position')}>Position<SortIcon col="position" /></TableHead>
                  <TableHead className={`${thClass} text-right`} onClick={() => handleSort('totalHours')}>Total Hrs<SortIcon col="totalHours" /></TableHead>
                  <TableHead className={`${thClass} text-right`} onClick={() => handleSort('extensionHours')}>Extension Hrs<SortIcon col="extensionHours" /></TableHead>
                  <TableHead className={`${thClass} text-right`} onClick={() => handleSort('holidayHours')}>Holiday Duty Hrs<SortIcon col="holidayHours" /></TableHead>
                  <TableHead className={`${thClass} text-right font-semibold`} onClick={() => handleSort('combinedExtraHours')}>Total Extra Hrs<SortIcon col="combinedExtraHours" /></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sorted.map(row => (
                  <TableRow key={row.employeeId}>
                    <TableCell className="font-medium">{row.name}</TableCell>
                    <TableCell className="text-muted-foreground text-sm">{row.position}</TableCell>
                    <TableCell className="text-right tabular-nums">{row.totalHours.toFixed(1)}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {row.extensionHours > 0
                        ? <span className="text-amber-600 font-medium">{row.extensionHours.toFixed(1)}</span>
                        : <span className="text-muted-foreground">—</span>}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {row.holidayHours > 0
                        ? <span className="text-blue-600 font-medium">{row.holidayHours.toFixed(1)}</span>
                        : <span className="text-muted-foreground">—</span>}
                    </TableCell>
                    <TableCell className="text-right tabular-nums font-semibold">
                      {row.combinedExtraHours > 0
                        ? <span className="text-primary">{row.combinedExtraHours.toFixed(1)}</span>
                        : <span className="text-muted-foreground">—</span>}
                    </TableCell>
                  </TableRow>
                ))}
                {sorted.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={6} className="text-center text-muted-foreground py-8">
                      No Rank-and-File employees or no shifts found in this period.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </div>

        <DialogFooter className="flex-col sm:flex-row gap-2">
          <Button variant="ghost" onClick={() => setIsOpen(false)} className="sm:mr-auto">Close</Button>
          <Button variant="outline" onClick={handleExport} disabled={sorted.length === 0}>
            <Download className="mr-2 h-4 w-4" />
            Export CSV
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
