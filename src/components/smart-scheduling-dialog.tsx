'use client';

import React, { useState, useMemo } from 'react';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Button } from './ui/button';
import { Label } from './ui/label';
import { Badge } from './ui/badge';
import { useToast } from '@/hooks/use-toast';
import {
  Loader2, Sparkles, CheckCircle2, AlertTriangle, User, Clock,
  CalendarRange, ChevronDown, ChevronRight, Info,
} from 'lucide-react';
import type { Shift, Employee } from '@/types';
import type { ShiftTemplate } from './shift-editor';
import type { AiConfig } from '@/app/actions';
import {
  startOfWeek, endOfWeek, addWeeks, subMonths, eachDayOfInterval,
  format, isSameDay, differenceInMonths, getDay, parseISO,
} from 'date-fns';
import { v4 as uuidv4 } from 'uuid';

// ── Types ─────────────────────────────────────────────────────────────────────

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
  date: string;       // yyyy-MM-dd
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
  if (e <= s) e += 1440; // overnight
  return (e - s) / 60;
}

function isProbationary(emp: Employee): boolean {
  if (!emp.startDate) return false;
  return differenceInMonths(new Date(), new Date(emp.startDate)) < 6;
}

function weeklyHours(empShifts: Shift[], weekStart: Date, weekEnd: Date): number {
  return empShifts
    .filter(s =>
      !s.isDayOff && !s.isHolidayOff && s.startTime && s.endTime &&
      new Date(s.date) >= weekStart && new Date(s.date) <= weekEnd
    )
    .reduce((sum, s) => sum + shiftDurationHours(s.startTime!, s.endTime!), 0);
}

/** Build a compact pattern summary of the last month for one employee */
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
    .map(([d, slots]) => {
      const unique = [...new Set(slots)];
      return `${dayNames[Number(d)]}: ${unique.join(', ')}`;
    })
    .join(' | ');
}

// ── Component ─────────────────────────────────────────────────────────────────

export function SmartSchedulingDialog({
  isOpen, setIsOpen, shifts, employees, shiftTemplates, onAccept, aiConfig,
}: Props) {
  const { toast } = useToast();
  const today = new Date();

  // Target week (default: next week)
  const [targetWeekStart, setTargetWeekStart] = useState(
    startOfWeek(addWeeks(today, 1), { weekStartsOn: 1 })
  );
  const targetWeekEnd = endOfWeek(targetWeekStart, { weekStartsOn: 1 });
  const targetDays = eachDayOfInterval({ start: targetWeekStart, end: targetWeekEnd });

  const [isGenerating, setIsGenerating] = useState(false);
  const [suggestions, setSuggestions] = useState<SuggestedShift[] | null>(null);
  const [warnings, setWarnings] = useState<ConstraintWarning[]>([]);
  const [expandedEmp, setExpandedEmp] = useState<Set<string>>(new Set());
  const [checkedShifts, setCheckedShifts] = useState<Set<number>>(new Set());

  // Past 1 month of shifts for pattern analysis
  const pastShifts = useMemo(() => {
    const from = subMonths(today, 1);
    return shifts.filter(s => new Date(s.date) >= from && new Date(s.date) < today);
  }, [shifts]);

  // Only non-manager employees
  const eligibleEmployees = useMemo(() =>
    employees.filter(e => e.employeeClassification !== 'Managerial'),
    [employees]
  );

  const handleGenerate = async () => {
    setIsGenerating(true);
    setSuggestions(null);
    setWarnings([]);

    // Build context for the AI
    const empContext = eligibleEmployees.map(emp => ({
      id: emp.id,
      name: `${emp.firstName} ${emp.lastName}`,
      position: emp.position,
      isProbationary: isProbationary(emp),
      maxWeeklyHours: isProbationary(emp) ? 48 : 40,
      pattern: buildPatternSummary(emp, pastShifts),
      defaultTemplateId: emp.defaultShiftTemplateId ?? null,
    }));

    const templateContext = shiftTemplates.map(t => ({
      id: t.id,
      name: t.name,
      label: t.label,
      startTime: t.startTime,
      endTime: t.endTime,
      color: t.color,
    }));

    const weekLabel = `${format(targetWeekStart, 'MMM d')}–${format(targetWeekEnd, 'MMM d, yyyy')}`;
    const daysStr = targetDays.map(d => format(d, 'yyyy-MM-dd (EEEE)')).join(', ');

    const prompt = `You are a workforce scheduling assistant. Generate a schedule for the week of ${weekLabel}.

DAYS TO SCHEDULE: ${daysStr}

CONSTRAINTS (strictly enforce all):
- Max 40 hours/week per regular employee
- Max 48 hours/week for probationary employees (< 6 months tenure)
- Max 14 hours per single shift
- Do not schedule employees on their historical rest days unless needed for coverage
- Respect each employee's typical shift pattern from their history

EMPLOYEES:
${JSON.stringify(empContext, null, 2)}

AVAILABLE SHIFT TEMPLATES:
${JSON.stringify(templateContext, null, 2)}

INSTRUCTIONS:
1. Analyze each employee's pattern to determine their typical days/times
2. Generate a realistic schedule matching their patterns
3. Assign the closest matching template (by start/end time) and include its id as templateId
4. Flag any constraint violation with a "warning" field on that shift
5. Do not give any employee more than 14h in a single shift
6. Include only working shifts (no OFF days needed)

Respond ONLY with a valid JSON array (no markdown, no explanation):
[
  {
    "employeeId": "...",
    "employeeName": "...",
    "date": "yyyy-MM-dd",
    "startTime": "HH:MM",
    "endTime": "HH:MM",
    "label": "shift label",
    "templateId": "template id or null",
    "color": "hex or hsl or null",
    "warning": "constraint issue or null"
  }
]`;

    try {
      // ── Build provider-aware API call ───────────────────────────────────────
      const provider  = aiConfig?.provider ?? 'anthropic';
      const model     = aiConfig?.model
        ?? (provider === 'anthropic'   ? 'claude-sonnet-4-6'
          : provider === 'openrouter'  ? 'openai/gpt-4o'
          :                             'llama3'); // ollama default
      const apiKey    = aiConfig?.apiKey ?? '';

      let url: string;
      let headers: Record<string, string>;
      let body: object;

      if (provider === 'ollama') {
        // Ollama uses OpenAI-compatible /api/chat or /v1/chat/completions
        const base = (aiConfig?.baseUrl ?? 'http://localhost:11434').replace(/\/$/, '');
        url = `${base}/api/chat`;
        headers = { 'Content-Type': 'application/json' };
        body = {
          model,
          stream: false,
          messages: [{ role: 'user', content: prompt }],
        };
      } else if (provider === 'openrouter') {
        const base = (aiConfig?.baseUrl ?? 'https://openrouter.ai/api/v1').replace(/\/$/, '');
        url = `${base}/chat/completions`;
        headers = {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
          'HTTP-Referer': 'https://onduty.app',
          'X-Title': 'Onduty Smart Scheduling',
        };
        body = {
          model,
          messages: [{ role: 'user', content: prompt }],
        };
      } else {
        // Anthropic (default)
        const base = (aiConfig?.baseUrl ?? 'https://api.anthropic.com').replace(/\/$/, '');
        url = `${base}/v1/messages`;
        headers = { 'Content-Type': 'application/json' };
        body = {
          model,
          max_tokens: 8000,
          messages: [{ role: 'user', content: prompt }],
        };
      }

      const res = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body) });
      const data = await res.json();

      // ── Normalize response across providers ────────────────────────────────
      let raw = '';
      if (provider === 'ollama') {
        raw = data?.message?.content ?? data?.choices?.[0]?.message?.content ?? '';
      } else if (provider === 'openrouter') {
        raw = data?.choices?.[0]?.message?.content ?? '';
      } else {
        raw = (data.content ?? [])
          .filter((b: { type: string }) => b.type === 'text')
          .map((b: { text: string }) => b.text)
          .join('');
      }

      const cleaned = raw.replace(/```json|```/g, '').trim();
      const parsed: SuggestedShift[] = JSON.parse(cleaned);

      // Client-side constraint validation pass
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
        const maxHours = isProbationary(emp) ? 48 : 40;

        // Check weekly total
        const total = empShifts.reduce((sum, s) => sum + shiftDurationHours(s.startTime, s.endTime), 0);
        if (total > maxHours) {
          constraintWarnings.push({
            employeeId: empId,
            employeeName: name,
            message: `${total.toFixed(1)}h scheduled — exceeds ${maxHours}h weekly limit`,
            type: 'hours',
          });
        }

        // Check individual shift duration
        for (const s of empShifts) {
          const dur = shiftDurationHours(s.startTime, s.endTime);
          if (dur > 14) {
            constraintWarnings.push({
              employeeId: empId,
              employeeName: name,
              message: `${format(parseISO(s.date), 'EEE MMM d')}: ${dur.toFixed(1)}h shift exceeds 14h max`,
              type: 'duration',
            });
          }
        }
      }

      setSuggestions(parsed);
      setWarnings(constraintWarnings);
      setCheckedShifts(new Set(parsed.map((_, i) => i)));
      setExpandedEmp(new Set(parsed.map(s => s.employeeId)));

    } catch (err) {
      toast({ variant: 'destructive', title: 'Generation Failed', description: String(err) });
    } finally {
      setIsGenerating(false);
    }
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

  // Group suggestions by employee for display
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

  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-primary" />
            Smart Scheduling
          </DialogTitle>
          <DialogDescription>
            AI-suggested schedule based on the past month's patterns, respecting hour limits and shift constraints.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 py-2">

          {/* Target week */}
          <div className="space-y-2">
            <Label className="flex items-center gap-1.5">
              <CalendarRange className="h-3.5 w-3.5" />
              Target Week
            </Label>
            <div className="flex items-center gap-2">
              <Button
                type="button" variant="outline" size="sm"
                onClick={() => { setTargetWeekStart(s => addWeeks(s, -1)); setSuggestions(null); }}
              >←</Button>
              <span className="text-sm font-medium min-w-[200px] text-center">
                {format(targetWeekStart, 'MMM d')} – {format(targetWeekEnd, 'MMM d, yyyy')}
              </span>
              <Button
                type="button" variant="outline" size="sm"
                onClick={() => { setTargetWeekStart(s => addWeeks(s, 1)); setSuggestions(null); }}
              >→</Button>
            </div>
          </div>

          {/* Constraint summary */}
          <div className="rounded-md border bg-muted/30 p-3 space-y-1.5">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Applied Constraints</p>
            <div className="flex flex-wrap gap-2">
              <Badge variant="outline" className="gap-1 text-xs"><Clock className="h-3 w-3" />40h/week (regular)</Badge>
              <Badge variant="outline" className="gap-1 text-xs"><Clock className="h-3 w-3" />48h/week (probationary)</Badge>
              <Badge variant="outline" className="gap-1 text-xs"><Clock className="h-3 w-3" />14h max per shift</Badge>
              <Badge variant="outline" className="gap-1 text-xs"><Info className="h-3 w-3" />1 month pattern analysis</Badge>
              <Badge variant="outline" className="gap-1 text-xs"><User className="h-3 w-3" />Excludes managers</Badge>
            </div>
          </div>

          {/* Warnings */}
          {warnings.length > 0 && (
            <div className="rounded-md border border-amber-300 bg-amber-50 p-3 space-y-1">
              <p className="text-xs font-semibold text-amber-700 flex items-center gap-1.5">
                <AlertTriangle className="h-3.5 w-3.5" />
                Constraint Warnings ({warnings.length})
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
                    onClick={() => setCheckedShifts(new Set(suggestions.map((_, i) => i)))}>
                    All
                  </Button>
                  <Button type="button" variant="ghost" size="sm" className="h-6 text-xs"
                    onClick={() => setCheckedShifts(new Set())}>
                    None
                  </Button>
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
                      <button
                        type="button"
                        className="w-full flex items-center justify-between px-3 py-2 text-sm font-medium hover:bg-muted/50 transition-colors"
                        onClick={() => toggleEmp(emp.id)}
                      >
                        <span className="flex items-center gap-2">
                          {expanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                          {emp.name}
                          {proby && <Badge variant="secondary" className="text-xs h-4 px-1">Probationary</Badge>}
                          {empWarning && <AlertTriangle className="h-3.5 w-3.5 text-amber-500" />}
                        </span>
                        <Badge variant="outline" className="text-xs">
                          {empChecked}/{emp.shifts.length} shifts
                        </Badge>
                      </button>
                      {expanded && (
                        <div className="border-t bg-muted/10 divide-y">
                          {emp.shifts.map(({ shift: s, idx }) => (
                            <label
                              key={idx}
                              className="flex items-center gap-3 px-4 py-2 cursor-pointer hover:bg-muted/30 text-sm"
                            >
                              <input
                                type="checkbox"
                                className="h-4 w-4 rounded border"
                                checked={checkedShifts.has(idx)}
                                onChange={() => toggleShift(idx)}
                              />
                              <span className="font-mono text-xs w-24 shrink-0">
                                {format(parseISO(s.date), 'EEE, MMM d')}
                              </span>
                              <span className="font-mono text-xs text-muted-foreground w-24 shrink-0">
                                {s.startTime}–{s.endTime}
                              </span>
                              <span className="truncate flex-1">{s.label}</span>
                              {s.warning && (
                                <span title={s.warning}>
                                  <AlertTriangle className="h-3.5 w-3.5 text-amber-500 shrink-0" />
                                </span>
                              )}
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
            {isGenerating
              ? <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              : <Sparkles className="mr-2 h-4 w-4" />
            }
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
