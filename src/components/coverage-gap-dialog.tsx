'use client';

import React, { useState, useMemo } from 'react';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Button } from './ui/button';
import { Label } from './ui/label';
import { Input } from './ui/input';
import { Badge } from './ui/badge';
import {
  AlertTriangle, CalendarRange, CheckCircle2, Clock, ChevronDown, ChevronRight,
} from 'lucide-react';
import type { Shift, Employee } from '@/types';
import {
  startOfWeek, endOfWeek, startOfMonth, endOfMonth,
  startOfYear, endOfYear, eachDayOfInterval, format, isSameDay, addDays,
} from 'date-fns';

// ── Types ────────────────────────────────────────────────────────────────────

type CoverageRange = 'week' | 'month' | 'year' | 'custom';

type GapResult = {
  date: Date;
  gaps: { from: string; to: string }[];
};

type Props = {
  isOpen: boolean;
  setIsOpen: (v: boolean) => void;
  shifts: Shift[];
  employees: Employee[];
};

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Convert "HH:MM" to minutes since midnight. "24:00" → 1440. */
function toMin(t: string): number {
  if (!t) return 0;
  const [h, m] = t.split(':').map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}

function minToStr(m: number): string {
  if (m >= 1440) return '24:00';
  const h = Math.floor(m / 60) % 24;
  const min = m % 60;
  return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
}

/**
 * Find uncovered intervals within [windowStart, windowEnd] minutes.
 * windowEnd can be 1440 for full-day (midnight to midnight).
 */
function findGaps(
  covered: { start: number; end: number }[],
  windowStart: number,
  windowEnd: number,
): { from: string; to: string }[] {
  if (windowEnd <= windowStart) return [];

  if (!covered.length) {
    return [{ from: minToStr(windowStart), to: minToStr(windowEnd) }];
  }

  // Clip intervals to the window, sort, merge
  const clipped = covered
    .map(iv => ({
      start: Math.max(iv.start, windowStart),
      end:   Math.min(iv.end,   windowEnd),
    }))
    .filter(iv => iv.end > iv.start);

  if (!clipped.length) {
    return [{ from: minToStr(windowStart), to: minToStr(windowEnd) }];
  }

  clipped.sort((a, b) => a.start - b.start);

  const merged: { start: number; end: number }[] = [];
  for (const iv of clipped) {
    if (!merged.length || iv.start > merged[merged.length - 1].end) {
      merged.push({ ...iv });
    } else {
      merged[merged.length - 1].end = Math.max(merged[merged.length - 1].end, iv.end);
    }
  }

  const gaps: { from: string; to: string }[] = [];
  let cursor = windowStart;
  for (const iv of merged) {
    if (iv.start > cursor) {
      gaps.push({ from: minToStr(cursor), to: minToStr(iv.start) });
    }
    cursor = Math.max(cursor, iv.end);
    if (cursor >= windowEnd) break;
  }
  if (cursor < windowEnd) {
    gaps.push({ from: minToStr(cursor), to: minToStr(windowEnd) });
  }
  return gaps;
}

function analyzeGaps(
  shifts: Shift[],
  days: Date[],
  coverageStart: number,
  coverageEnd: number,
): GapResult[] {
  const results: GapResult[] = [];

  for (const day of days) {
    // Shifts starting on this day
    const dayShifts = shifts.filter(s =>
      !s.isDayOff &&
      !s.isHolidayOff &&
      s.employeeId !== null &&
      s.startTime &&
      s.endTime &&
      isSameDay(new Date(s.date), day)
    );

    const covered: { start: number; end: number }[] = dayShifts.map(s => {
      let start = toMin(s.startTime!);
      let end   = toMin(s.endTime!);
      // Overnight shift — end wraps past midnight
      if (end <= start) end += 1440;
      return { start, end };
    });

    // ── Key fix: include carryover from overnight shifts that STARTED
    //    the previous day and extend into this day's early hours.
    //    e.g. a 22:00–06:00 shift on Monday covers 00:00–06:00 on Tuesday.
    const prevDay = addDays(day, -1);
    const prevDayShifts = shifts.filter(s =>
      !s.isDayOff &&
      !s.isHolidayOff &&
      s.employeeId !== null &&
      s.startTime &&
      s.endTime &&
      isSameDay(new Date(s.date), prevDay)
    );

    for (const s of prevDayShifts) {
      const start = toMin(s.startTime!);
      const end   = toMin(s.endTime!);
      // Only overnight shifts (end time earlier than start time)
      if (end < start) {
        // This shift carries over into the current day from 00:00 to end
        if (end > 0) {
          covered.push({ start: 0, end });
        }
      }
    }

    const gaps = findGaps(covered, coverageStart, coverageEnd);
    if (gaps.length) results.push({ date: day, gaps });
  }

  return results;
}

// ── Component ────────────────────────────────────────────────────────────────

export function CoverageGapDialog({ isOpen, setIsOpen, shifts, employees }: Props) {
  const today = new Date();

  const [range, setRange] = useState<CoverageRange>('week');
  const [customFrom, setCustomFrom] = useState(format(today, 'yyyy-MM-dd'));
  const [customTo, setCustomTo] = useState(format(addDays(today, 6), 'yyyy-MM-dd'));
  const [is24h, setIs24h] = useState(false);
  const [coverageFrom, setCoverageFrom] = useState('06:00');
  const [coverageTo, setCoverageTo] = useState('22:00');
  const [expandedDays, setExpandedDays] = useState<Set<string>>(new Set());
  const [results, setResults] = useState<GapResult[] | null>(null);
  const [analysed, setAnalysed] = useState(false);

  const days = useMemo(() => {
    let from: Date, to: Date;
    switch (range) {
      case 'week':
        from = startOfWeek(today, { weekStartsOn: 1 });
        to = endOfWeek(today, { weekStartsOn: 1 });
        break;
      case 'month':
        from = startOfMonth(today);
        to = endOfMonth(today);
        break;
      case 'year':
        from = startOfYear(today);
        to = endOfYear(today);
        break;
      default:
        from = customFrom ? new Date(customFrom) : today;
        to = customTo ? new Date(customTo) : addDays(today, 6);
    }
    return eachDayOfInterval({ start: from, end: to });
  }, [range, customFrom, customTo]);

  const handleAnalyze = () => {
    const managerIds = new Set(
      employees
        .filter(e => e.employeeClassification === 'Managerial')
        .map(e => e.id)
    );
    const nonManagerShifts = shifts.filter(s => !managerIds.has(s.employeeId ?? ''));

    // 24h mode uses full 0–1440 window
    const covStart = is24h ? 0    : toMin(coverageFrom || '00:00');
    const covEnd   = is24h ? 1440 : toMin(coverageTo   || '23:59');

    const gaps = analyzeGaps(nonManagerShifts, days, covStart, covEnd);
    setResults(gaps);
    setAnalysed(true);
    setExpandedDays(new Set(gaps.map(g => format(g.date, 'yyyy-MM-dd'))));
  };

  const toggleDay = (key: string) => {
    setExpandedDays(prev => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });
  };

  const totalGaps = results?.reduce((sum, r) => sum + r.gaps.length, 0) ?? 0;
  const windowLabel = is24h ? '00:00 – 24:00 (full day)' : `${coverageFrom} – ${coverageTo}`;

  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-amber-500" />
            Coverage Gap Detector
          </DialogTitle>
          <DialogDescription>
            Find time periods with no one scheduled. Overnight shifts are correctly accounted for.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 py-2">

          {/* Range selector */}
          <div className="space-y-2">
            <Label>Check Period</Label>
            <div className="flex gap-2 flex-wrap">
              {(['week', 'month', 'year', 'custom'] as CoverageRange[]).map(r => (
                <Button
                  key={r}
                  type="button"
                  size="sm"
                  variant={range === r ? 'default' : 'outline'}
                  className="capitalize"
                  onClick={() => { setRange(r); setAnalysed(false); setResults(null); }}
                >
                  {r === 'week' ? 'This Week' : r === 'month' ? 'This Month' : r === 'year' ? 'This Year' : 'Custom'}
                </Button>
              ))}
            </div>

            {range === 'custom' && (
              <div className="flex gap-2 mt-2">
                <div className="flex-1 space-y-1">
                  <Label className="text-xs text-muted-foreground">From</Label>
                  <Input type="date" value={customFrom} onChange={e => { setCustomFrom(e.target.value); setAnalysed(false); }} className="h-8 text-sm" />
                </div>
                <div className="flex-1 space-y-1">
                  <Label className="text-xs text-muted-foreground">To</Label>
                  <Input type="date" value={customTo} onChange={e => { setCustomTo(e.target.value); setAnalysed(false); }} className="h-8 text-sm" />
                </div>
              </div>
            )}

            <p className="text-xs text-muted-foreground">
              Checking <strong>{days.length}</strong> day{days.length !== 1 ? 's' : ''}.
            </p>
          </div>

          {/* Coverage window */}
          <div className="space-y-2">
            <Label className="flex items-center gap-1.5">
              <Clock className="h-3.5 w-3.5" />
              Coverage Window
            </Label>

            {/* 24h toggle */}
            <div className="flex items-center gap-2">
              <input
                id="24h-toggle"
                type="checkbox"
                className="h-4 w-4 rounded border"
                checked={is24h}
                onChange={e => { setIs24h(e.target.checked); setAnalysed(false); }}
              />
              <label htmlFor="24h-toggle" className="text-sm cursor-pointer">
                Full 24 hours (00:00 – 24:00)
              </label>
            </div>

            {!is24h && (
              <div className="flex gap-2">
                <div className="flex-1 space-y-1">
                  <Label className="text-xs text-muted-foreground">Start</Label>
                  <Input
                    type="time"
                    value={coverageFrom}
                    onChange={e => { setCoverageFrom(e.target.value); setAnalysed(false); }}
                    className="h-8 text-sm"
                  />
                </div>
                <div className="flex-1 space-y-1">
                  <Label className="text-xs text-muted-foreground">End</Label>
                  <Input
                    type="time"
                    value={coverageTo}
                    onChange={e => { setCoverageTo(e.target.value); setAnalysed(false); }}
                    className="h-8 text-sm"
                  />
                </div>
              </div>
            )}

            <p className="text-xs text-muted-foreground">
              Window: <strong>{windowLabel}</strong>
            </p>
          </div>

          {/* Results */}
          {analysed && results !== null && (
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <Label>Results</Label>
                {totalGaps === 0
                  ? <Badge variant="outline" className="gap-1 text-green-600 border-green-300 bg-green-50"><CheckCircle2 className="h-3 w-3" /> Fully covered</Badge>
                  : <Badge variant="destructive" className="gap-1">{totalGaps} gap{totalGaps !== 1 ? 's' : ''} across {results.length} day{results.length !== 1 ? 's' : ''}</Badge>
                }
              </div>

              {totalGaps === 0 && (
                <p className="text-sm text-muted-foreground">
                  No uncovered periods found within {windowLabel} for the selected range.
                </p>
              )}

              <div className="space-y-1 max-h-64 overflow-y-auto pr-1">
                {results.map(r => {
                  const key = format(r.date, 'yyyy-MM-dd');
                  const expanded = expandedDays.has(key);
                  return (
                    <div key={key} className="rounded-md border overflow-hidden">
                      <button
                        type="button"
                        className="w-full flex items-center justify-between px-3 py-2 text-sm font-medium hover:bg-muted/50 transition-colors"
                        onClick={() => toggleDay(key)}
                      >
                        <span className="flex items-center gap-2">
                          {expanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                          {format(r.date, 'EEEE, MMM d')}
                        </span>
                        <Badge variant="outline" className="text-amber-600 border-amber-300 text-xs">
                          {r.gaps.length} gap{r.gaps.length !== 1 ? 's' : ''}
                        </Badge>
                      </button>
                      {expanded && (
                        <div className="border-t bg-muted/20 px-3 py-2 space-y-1">
                          {r.gaps.map((g, i) => (
                            <div key={i} className="flex items-center gap-2 text-sm">
                              <span className="h-2 w-2 rounded-full bg-amber-400 shrink-0" />
                              <span className="font-mono">{g.from} – {g.to}</span>
                              <span className="text-muted-foreground text-xs">no coverage</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => setIsOpen(false)}>Close</Button>
          <Button onClick={handleAnalyze}>
            <CalendarRange className="mr-2 h-4 w-4" />
            {analysed ? 'Re-Analyze' : 'Analyze'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

