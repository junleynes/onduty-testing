'use client';

import React, { useState, useMemo } from 'react';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Button } from './ui/button';
import { Label } from './ui/label';
import { Input } from './ui/input';
import { Badge } from './ui/badge';
import { useToast } from '@/hooks/use-toast';
import {
  Loader2, Sparkles, CheckCircle2, AlertTriangle, User, Clock,
  CalendarRange, ChevronDown, ChevronRight, Info,
} from 'lucide-react';import type { Shift, Employee } from '@/types';
import type { ShiftTemplate } from './shift-editor';
import type { AiConfig } from '@/app/actions';
import { generateAiSchedule } from '@/app/actions';
import {
  startOfWeek, endOfWeek, startOfMonth, endOfMonth,
  addWeeks, addMonths, subMonths, eachDayOfInterval,
  format, differenceInMonths, getDay, parseISO,
} from 'date-fns';
import { v4 as uuidv4 } from 'uuid';

// ── Types ─────────────────────────────────────────────────────────────────────

type TargetRange = '1w' | '2w' | '1m' | '2m' | '3m' | 'custom';

type Props = {
  isOpen: boolean;
  setIsOpen: (v: boolean) => void;
  shifts: Shift[];
  employees: Employee[];
  shiftTemplates: ShiftTemplate[];
  onAccept: (newShifts: Shift[]) => void;
  aiConfig?: AiConfig;
};

type SuggestedShift = {
  employeeId: string;
  employeeName: string;
  date: string;
  startTime: string;
  endTime: string;
  label: string;
  templateId?: string;
  color?: string;
  warning?: string;
};

type ConstraintWarning = {
  employeeId: string;
  employeeName: string;
  message: string;
  type: 'hours' | 'duration' | 'pattern';
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function toMinutes(t: string): number {
  const [h, m] = t.split(':').map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}

function shiftDurationHours(start: string, end: string): number {
  let s = toMinutes(start);
  let e = toMinutes(end);
  if (e <= s) e += 1440;
  return (e - s) / 60;
}

function isProbationary(emp: Employee): boolean {
  if (!emp.startDate) return false;
  return differenceInMonths(new Date(), new Date(emp.startDate)) < 6;
}

function buildPatternSummary(emp: Employee, pastShifts: Shift[]): string {
  const empShifts = pastShifts.filter(
    s => s.employeeId === emp.id && !s.isDayOff && !s.isHolidayOff && s.startTime && s.endTime
  );
  if (!empShifts.length) return 'No shifts in past month.';

  const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const byDay: Record<number, string[]> = {};
  for (const s of empShifts) {
    const d = getDay(new Date(s.date));
    if (!byDay[d]) byDay[d] = [];
    byDay[d].push(`${s.startTime}–${s.endTime}`);
  }
  return Object.entries(byDay)
    .map(([d, slots]) => `${dayNames[Number(d)]}: ${[...new Set(slots)].join(', ')}`)
    .join(' | ');
}

const DEFAULT_BASE_URLS: Record<string, string> = {
  anthropic:   'https://api.anthropic.com',
  openrouter:  'https://openrouter.ai/api/v1',
  ollama:      'http://localhost:11434',
};

// ── Component ─────────────────────────────────────────────────────────────────

export function SmartSchedulingDialog({
  isOpen, setIsOpen, shifts, employees, shiftTemplates, onAccept, aiConfig,
}: Props) {
  const { toast } = useToast();
  const today = new Date();

  // ── Target range ──
  const [targetRange, setTargetRange] = useState<TargetRange>('1w');
  const [customFrom, setCustomFrom] = useState(format(today, 'yyyy-MM-dd'));
  const [customTo, setCustomTo] = useState(format(addWeeks(today, 1), 'yyyy-MM-dd'));

  const { rangeStart, rangeEnd } = useMemo(() => {
    const weekStart = startOfWeek(today, { weekStartsOn: 1 });
    switch (targetRange) {
      case '1w': return { rangeStart: weekStart, rangeEnd: endOfWeek(weekStart, { weekStartsOn: 1 }) };
      case '2w': return { rangeStart: weekStart, rangeEnd: endOfWeek(addWeeks(weekStart, 1), { weekStartsOn: 1 }) };
      case '1m': return { rangeStart: startOfMonth(today), rangeEnd: endOfMonth(today) };
      case '2m': return { rangeStart: startOfMonth(today), rangeEnd: endOfMonth(addMonths(today, 1)) };
      case '3m': return { rangeStart: startOfMonth(today), rangeEnd: endOfMonth(addMonths(today, 2)) };
      default:   return { rangeStart: new Date(customFrom), rangeEnd: new Date(customTo) };
    }
  }, [targetRange, customFrom, customTo]);

  const targetDays = useMemo(() =>
    eachDayOfInterval({ start: rangeStart, end: rangeEnd }),
    [rangeStart, rangeEnd]
  );

  // ── AI Config override (in case user wants to change for this session) ──
  const effectiveConfig: AiConfig = useMemo(() => ({
    provider: 'openrouter',
    baseUrl: DEFAULT_BASE_URLS['openrouter'],
    ...aiConfig,
    // Auto-fill base URL if not set
    baseUrl: aiConfig?.baseUrl || DEFAULT_BASE_URLS[aiConfig?.provider ?? 'openrouter'],
  }), [aiConfig]);

  const [isGenerating, setIsGenerating] = useState(false);
  const [suggestions, setSuggestions] = useState<SuggestedShift[] | null>(null);
  const [warnings, setWarnings] = useState<ConstraintWarning[]>([]);
  const [expandedEmp, setExpandedEmp] = useState<Set<string>>(new Set());
  const [checkedShifts, setCheckedShifts] = useState<Set<number>>(new Set());

  // ── Toggleable constraints ──
  const [constraintWeeklyHours, setConstraintWeeklyHours] = useState(true);
  const [constraintProbyHours, setConstraintProbyHours] = useState(true);
  const [constraintMaxShift, setConstraintMaxShift] = useState(true);
  const [constraintPattern, setConstraintPattern] = useState(true);
  const [constraintExcludeManagers, setConstraintExcludeManagers] = useState(true);

  const pastShifts = useMemo(() => {
    const from = subMonths(today, 1);
    return shifts.filter(s => new Date(s.date) >= from && new Date(s.date) < today);
  }, [shifts]);

  const eligibleEmployees = useMemo(() =>
    constraintExcludeManagers
      ? employees.filter(e => e.employeeClassification !== 'Managerial')
      : employees,
    [employees, constraintExcludeManagers]
  );

  const handleGenerate = async () => {
    if (!effectiveConfig.apiKey && effectiveConfig.provider !== 'ollama') {
      toast({ variant: 'destructive', title: 'No API Key', description: 'Please set your API key in API & Integrations → AI Configuration.' });
      return;
    }

    setIsGenerating(true);
    setSuggestions(null);
    setWarnings([]);

    // Compact employee context — only include pattern if constraint is on
    const empContext = eligibleEmployees.map(emp => ({
      id: emp.id,
      name: `${emp.firstName} ${emp.lastName}`,
      position: emp.position,
      proby: isProbationary(emp),
      maxHrs: constraintProbyHours && isProbationary(emp) ? 48
            : constraintWeeklyHours ? 40
            : null,
      pattern: constraintPattern ? buildPatternSummary(emp, pastShifts) : undefined,
    }));

    // Deduplicate templates by label+startTime+endTime to reduce tokens
    const seen = new Set<string>();
    const templateContext = shiftTemplates
      .filter(t => {
        const key = `${t.label}|${t.startTime}|${t.endTime}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .map(t => ({ id: t.id, label: t.label, start: t.startTime, end: t.endTime }));

    const rangeLabel = `${format(rangeStart, 'MMM d')} – ${format(rangeEnd, 'MMM d, yyyy')}`;

    // For ranges > 2 weeks, just specify the date range — don't list every day
    // (listing 90 dates blows up the token count)
    const daysNote = targetDays.length <= 14
      ? `Dates: ${targetDays.map(d => format(d, 'yyyy-MM-dd (EEE)')).join(', ')}`
      : `Date range: ${format(rangeStart, 'yyyy-MM-dd')} to ${format(rangeEnd, 'yyyy-MM-dd')} (${targetDays.length} days). Generate for ALL days in this range, respecting each employee's typical rest days.`;

    const activeRules = [
      constraintWeeklyHours && 'Max 40h/week per regular employee',
      constraintProbyHours  && 'Max 48h/week for probationary employees',
      constraintMaxShift    && 'Max 14h per single shift',
      constraintPattern     && 'Follow each employee\'s historical shift pattern and rest days',
      constraintExcludeManagers && 'Do not schedule managerial staff',
    ].filter(Boolean).join('. ');

    const prompt = `You are a workforce scheduler. Generate a schedule for ${rangeLabel}.

${daysNote}

RULES: ${activeRules || 'No constraints — schedule freely.'}

EMPLOYEES: ${JSON.stringify(empContext)}

TEMPLATES: ${JSON.stringify(templateContext)}

Reply ONLY with a JSON array, no markdown:
[{"employeeId":"","employeeName":"","date":"yyyy-MM-dd","startTime":"HH:MM","endTime":"HH:MM","label":"","templateId":"or null","color":"or null","warning":"or null"}]`;

    const result = await generateAiSchedule(prompt, effectiveConfig);
    setIsGenerating(false);

    if (!result.success || !result.result) {
      let desc = result.error ?? 'Unknown error';
      if (desc.includes('429')) {
        desc += '\n\nThis usually means: (1) rate limit hit — wait a moment and retry, (2) prompt too large — try a shorter range like 1 or 2 weeks, or (3) insufficient API credits on your account.';
      }
      toast({ variant: 'destructive', title: 'Generation Failed', description: desc, duration: 15000 });
      return;
    }

    let parsed: SuggestedShift[];
    try {
      const cleaned = result.result.replace(/```json|```/g, '').trim();
      parsed = JSON.parse(cleaned);
      if (!Array.isArray(parsed) || parsed.length === 0) throw new Error('Empty result');
    } catch {
      toast({ variant: 'destructive', title: 'Parse Failed', description: `Could not read AI response. Raw: ${result.result.slice(0, 200)}`, duration: 10000 });
      return;
    }

    // Constraint validation (only check what's enabled)
    const constraintWarnings: ConstraintWarning[] = [];
    const grouped: Record<string, SuggestedShift[]> = {};
    for (const s of parsed) {
      if (!grouped[s.employeeId]) grouped[s.employeeId] = [];
      grouped[s.employeeId].push(s);
    }

    for (const [empId, empShifts] of Object.entries(grouped)) {
      const emp = eligibleEmployees.find(e => e.id === empId);
      if (!emp) continue;
      const name = `${emp.firstName} ${emp.lastName}`;

      if (constraintWeeklyHours || constraintProbyHours) {
        const maxHours = (constraintProbyHours && isProbationary(emp)) ? 48
                       : constraintWeeklyHours ? 40
                       : Infinity;
        const total = empShifts.reduce((sum, s) => sum + shiftDurationHours(s.startTime, s.endTime), 0);
        if (total > maxHours) {
          constraintWarnings.push({ employeeId: empId, employeeName: name, message: `${total.toFixed(1)}h — exceeds ${maxHours}h weekly limit`, type: 'hours' });
        }
      }

      if (constraintMaxShift) {
        for (const s of empShifts) {
          const dur = shiftDurationHours(s.startTime, s.endTime);
          if (dur > 14) {
            constraintWarnings.push({ employeeId: empId, employeeName: name, message: `${format(parseISO(s.date), 'EEE MMM d')}: ${dur.toFixed(1)}h shift exceeds 14h`, type: 'duration' });
          }
        }
      }
    }

    setSuggestions(parsed);
    setWarnings(constraintWarnings);
    setCheckedShifts(new Set(parsed.map((_, i) => i)));
    setExpandedEmp(new Set(parsed.map(s => s.employeeId)));
  };

  const handleAccept = () => {
    if (!suggestions) return;
    const selected = suggestions.filter((_, i) => checkedShifts.has(i));
    const newShifts: Shift[] = selected.map(s => {
      const tpl = shiftTemplates.find(t => t.id === s.templateId);
      return {
        id: uuidv4(),
        employeeId: s.employeeId,
        label: s.label,
        startTime: s.startTime,
        endTime: s.endTime,
        date: parseISO(s.date),
        color: s.color ?? tpl?.color ?? undefined,
        status: 'draft' as const,
        isDayOff: false,
        isHolidayOff: false,
      };
    });
    onAccept(newShifts);
    toast({ title: 'Schedule Applied', description: `${newShifts.length} shift(s) added as drafts.` });
    setIsOpen(false);
  };

  const grouped = useMemo(() => {
    if (!suggestions) return [];
    const map = new Map<string, { name: string; shifts: { shift: SuggestedShift; idx: number }[] }>();
    suggestions.forEach((s, i) => {
      if (!map.has(s.employeeId)) map.set(s.employeeId, { name: s.employeeName, shifts: [] });
      map.get(s.employeeId)!.shifts.push({ shift: s, idx: i });
    });
    return [...map.entries()].map(([id, v]) => ({ id, ...v }));
  }, [suggestions]);

  const toggleEmp = (id: string) =>
    setExpandedEmp(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });

  const toggleShift = (idx: number) =>
    setCheckedShifts(prev => { const n = new Set(prev); n.has(idx) ? n.delete(idx) : n.add(idx); return n; });

  const selectedCount = checkedShifts.size;
  const providerLabel = effectiveConfig.provider === 'openrouter' ? 'OpenRouter' : effectiveConfig.provider === 'anthropic' ? 'Anthropic' : 'Ollama';

  const RANGE_OPTIONS: { value: TargetRange; label: string }[] = [
    { value: '1w', label: '1 Week' },
    { value: '2w', label: '2 Weeks' },
    { value: '1m', label: '1 Month' },
    { value: '2m', label: '2 Months' },
    { value: '3m', label: '3 Months' },
    { value: 'custom', label: 'Custom' },
  ];

  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-primary" />
            Smart Scheduling
          </DialogTitle>
          <DialogDescription>
            AI-suggested schedule based on the past month's patterns. Using <strong>{providerLabel}</strong>.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 py-2">

          {/* Target range */}
          <div className="space-y-2">
            <Label className="flex items-center gap-1.5">
              <CalendarRange className="h-3.5 w-3.5" />
              Schedule Range
            </Label>
            <div className="flex gap-2 flex-wrap">
              {RANGE_OPTIONS.map(o => (
                <Button
                  key={o.value} type="button" size="sm"
                  variant={targetRange === o.value ? 'default' : 'outline'}
                  onClick={() => setTargetRange(o.value)}
                >
                  {o.label}
                </Button>
              ))}
            </div>

            {targetRange === 'custom' && (
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
              {format(rangeStart, 'MMM d')} – {format(rangeEnd, 'MMM d, yyyy')} · {targetDays.length} day{targetDays.length !== 1 ? 's' : ''}
            </p>
          </div>

          {/* Constraints */}
          <div className="rounded-md border bg-muted/30 p-3 space-y-2">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Applied Constraints</p>
            <div className="grid grid-cols-1 gap-1.5">
              {[
                { id: 'weekly-hours', label: '40h/week max (regular)', icon: <Clock className="h-3 w-3" />, state: constraintWeeklyHours, set: setConstraintWeeklyHours },
                { id: 'proby-hours',  label: '48h/week max (probationary)', icon: <Clock className="h-3 w-3" />, state: constraintProbyHours, set: setConstraintProbyHours },
                { id: 'max-shift',    label: '14h max per shift', icon: <Clock className="h-3 w-3" />, state: constraintMaxShift, set: setConstraintMaxShift },
                { id: 'pattern',      label: 'Follow 1-month shift pattern', icon: <Info className="h-3 w-3" />, state: constraintPattern, set: setConstraintPattern },
                { id: 'excl-mgr',     label: 'Exclude managers', icon: <User className="h-3 w-3" />, state: constraintExcludeManagers, set: setConstraintExcludeManagers },
              ].map(c => (
                <label key={c.id} className="flex items-center gap-2 cursor-pointer text-xs">
                  <input
                    type="checkbox"
                    className="h-3.5 w-3.5 rounded border"
                    checked={c.state}
                    onChange={e => c.set(e.target.checked)}
                  />
                  <span className="flex items-center gap-1 text-muted-foreground">
                    {c.icon}{c.label}
                  </span>
                </label>
              ))}
            </div>
          </div>

          {/* Warnings */}
          {warnings.length > 0 && (
            <div className="rounded-md border border-amber-300 bg-amber-50 p-3 space-y-1">
              <p className="text-xs font-semibold text-amber-700 flex items-center gap-1.5">
                <AlertTriangle className="h-3.5 w-3.5" /> Constraint Warnings ({warnings.length})
              </p>
              {warnings.map((w, i) => (
                <p key={i} className="text-xs text-amber-800">• <strong>{w.employeeName}:</strong> {w.message}</p>
              ))}
            </div>
          )}

          {/* Results */}
          {suggestions && (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label>Suggested Shifts</Label>
                <div className="flex gap-2">
                  <Button type="button" variant="ghost" size="sm" className="h-6 text-xs"
                    onClick={() => setCheckedShifts(new Set(suggestions.map((_, i) => i)))}>All</Button>
                  <Button type="button" variant="ghost" size="sm" className="h-6 text-xs"
                    onClick={() => setCheckedShifts(new Set())}>None</Button>
                </div>
              </div>
              <div className="space-y-1 max-h-80 overflow-y-auto pr-1">
                {grouped.map(emp => {
                  const expanded = expandedEmp.has(emp.id);
                  const empChecked = emp.shifts.filter(({ idx }) => checkedShifts.has(idx)).length;
                  const empWarning = warnings.find(w => w.employeeId === emp.id);
                  const empObj = eligibleEmployees.find(e => e.id === emp.id);
                  const proby = empObj ? isProbationary(empObj) : false;
                  return (
                    <div key={emp.id} className="rounded-md border overflow-hidden">
                      <button type="button"
                        className="w-full flex items-center justify-between px-3 py-2 text-sm font-medium hover:bg-muted/50 transition-colors"
                        onClick={() => toggleEmp(emp.id)}
                      >
                        <span className="flex items-center gap-2">
                          {expanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                          {emp.name}
                          {proby && <Badge variant="secondary" className="text-xs h-4 px-1">Probationary</Badge>}
                          {empWarning && <AlertTriangle className="h-3.5 w-3.5 text-amber-500" />}
                        </span>
                        <Badge variant="outline" className="text-xs">{empChecked}/{emp.shifts.length} shifts</Badge>
                      </button>
                      {expanded && (
                        <div className="border-t bg-muted/10 divide-y">
                          {emp.shifts.map(({ shift: s, idx }) => (
                            <label key={idx} className="flex items-center gap-3 px-4 py-2 cursor-pointer hover:bg-muted/30 text-sm">
                              <input type="checkbox" className="h-4 w-4 rounded border"
                                checked={checkedShifts.has(idx)} onChange={() => toggleShift(idx)} />
                              <span className="font-mono text-xs w-28 shrink-0">{format(parseISO(s.date), 'EEE, MMM d')}</span>
                              <span className="font-mono text-xs text-muted-foreground w-24 shrink-0">{s.startTime}–{s.endTime}</span>
                              <span className="truncate flex-1">{s.label}</span>
                              {s.warning && <span title={s.warning}><AlertTriangle className="h-3.5 w-3.5 text-amber-500 shrink-0" /></span>}
                            </label>
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

        <DialogFooter className="flex-col sm:flex-row gap-2">
          <Button variant="ghost" onClick={() => setIsOpen(false)} className="sm:mr-auto">Close</Button>
          <Button variant="outline" onClick={handleGenerate} disabled={isGenerating}>
            {isGenerating ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Sparkles className="mr-2 h-4 w-4" />}
            {suggestions ? 'Regenerate' : 'Generate Schedule'}
          </Button>
          {suggestions && (
            <Button onClick={handleAccept} disabled={selectedCount === 0}>
              <CheckCircle2 className="mr-2 h-4 w-4" />
              Apply {selectedCount} Shift{selectedCount !== 1 ? 's' : ''} as Draft
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
