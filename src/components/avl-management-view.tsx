'use client';

import React, { useState, useMemo, useRef } from 'react';
import type { Employee, PreferredAvl, PreferredAvlDay } from '@/types';
import { Card } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { useToast } from '@/hooks/use-toast';
import { cn, getFullName } from '@/lib/utils';
import { Lock, Unlock, Trash2, Download, Upload, AlertTriangle } from 'lucide-react';
import { v4 as uuidv4 } from 'uuid';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from './ui/dialog';
import { Label } from './ui/label';
import { Checkbox } from './ui/checkbox';
import { Badge } from './ui/badge';
import { Separator } from './ui/separator';
import { ScrollArea } from './ui/scroll-area';
import { Switch } from './ui/switch';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import Papa from 'papaparse';
import { saveAs } from 'file-saver';

type AvlManagementViewProps = {
  currentUser: Employee;
  employees: Employee[];
  setEmployees: React.Dispatch<React.SetStateAction<Employee[]>>;
  preferredAvl: PreferredAvl[];
  setPreferredAvl: React.Dispatch<React.SetStateAction<PreferredAvl[]>>;
  avlLocks: Record<string, boolean>;
  setAvlLocks: React.Dispatch<React.SetStateAction<Record<string, boolean>>>;
};

const MONTHS = [
  'JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 
  'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'
];

export default function AvlManagementView({ currentUser, employees, setEmployees, preferredAvl, setPreferredAvl, avlLocks, setAvlLocks }: AvlManagementViewProps) {
  const { toast } = useToast();
  const [selectedYear, setSelectedYear] = useState(new Date().getFullYear());
  const [isPlotDialogOpen, setIsPlotDialogOpen] = useState(false);
  const [editingCell, setEditingCell] = useState<{ employeeId: string; month: number } | null>(null);
  const [tempPlottedDays, setTempPlottedDays] = useState<PreferredAvlDay[]>([]);
  const importInputRef = useRef<HTMLInputElement>(null);

  const isManager = currentUser.role === 'manager' || currentUser.role === 'admin';
  const lockKey = `${currentUser.group}-${selectedYear}`;
  const conflictKey = `preventConflicts-${currentUser.group}`;
  const isLocked = !!avlLocks[lockKey];
  const preventConflicts = !!avlLocks[conflictKey];
  const setPreventConflicts = (val: boolean | ((prev: boolean) => boolean)) => {
    setAvlLocks(prev => {
      const next = typeof val === 'function' ? val(!!prev[conflictKey]) : val;
      return { ...prev, [conflictKey]: next };
    });
  };

  const groupEmployees = useMemo(() => 
    employees
      .filter(e => e.group === currentUser.group)
      .sort((a,b) => a.lastName.localeCompare(b.lastName)),
    [employees, currentUser.group]
  );

  const getCellData = (employeeId: string, month: number) => {
    return preferredAvl.find(p => p.employeeId === employeeId && p.year === selectedYear && p.month === month);
  };

  const calculateTotalScheduled = (employeeId: string) => {
    return preferredAvl
      .filter(p => p.employeeId === employeeId && p.year === selectedYear)
      .reduce((sum, p) => sum + p.plottedDays.length, 0);
  };

  /**
   * Returns the set of day-numbers that are already taken by OTHER employees
   * in the same group for the given month/year.
   */
  const getConflictingDays = useMemo(() => {
    return (forEmployeeId: string, month: number): Set<number> => {
      if (!preventConflicts) return new Set();
      const taken = new Set<number>();
      for (const p of preferredAvl) {
        if (p.employeeId === forEmployeeId) continue;
        if (p.year !== selectedYear || p.month !== month) continue;
        const emp = employees.find(e => e.id === p.employeeId);
        if (!emp || emp.group !== currentUser.group) continue;
        for (const d of p.plottedDays) taken.add(d.day);
      }
      return taken;
    };
  }, [preventConflicts, preferredAvl, selectedYear, employees, currentUser.group]);

  const handleOpenPlot = (employeeId: string, month: number) => {
    if (isLocked && !isManager) {
        toast({ variant: 'destructive', title: 'Editing Locked', description: 'This year has been locked for editing by a manager.' });
        return;
    }
    if (!isManager && employeeId !== currentUser.id) return;
    
    const existing = getCellData(employeeId, month);
    setEditingCell({ employeeId, month });
    setTempPlottedDays(existing ? [...existing.plottedDays] : []);
    setIsPlotDialogOpen(true);
  };

  const toggleDaySelection = (day: number, conflictDays: Set<number>) => {
    const isSelected = !!tempPlottedDays.find(d => d.day === day);
    if (!isSelected && conflictDays.has(day)) {
      toast({ variant: 'destructive', title: 'Date Conflict', description: `Day ${day} is already taken by another member in your group.` });
      return;
    }
    setTempPlottedDays(prev => {
        const exists = prev.find(d => d.day === day);
        if (exists) return prev.filter(d => d.day !== day);
        return [...prev, { day, isClaimed: false }];
    });
  };

  const toggleDayClaimed = (day: number) => {
    if (!isManager) return;
    setTempPlottedDays(prev => prev.map(d => 
        d.day === day ? { ...d, isClaimed: !d.isClaimed } : d
    ));
  };

  const currentAnnualTotal = useMemo(() => {
    if (!editingCell) return 0;
    const otherMonthsTotal = preferredAvl
        .filter(p => p.employeeId === editingCell.employeeId && p.year === selectedYear && p.month !== editingCell.month)
        .reduce((sum, p) => sum + p.plottedDays.length, 0);
    return otherMonthsTotal + tempPlottedDays.length;
  }, [editingCell, preferredAvl, selectedYear, tempPlottedDays]);

  const targetEmployee = useMemo(() => 
    editingCell ? groupEmployees.find(e => e.id === editingCell.employeeId) : null,
  [editingCell, groupEmployees]);

  const conflictDaysForEdit = useMemo(() => {
    if (!editingCell) return new Set<number>();
    return getConflictingDays(editingCell.employeeId, editingCell.month);
  }, [editingCell, getConflictingDays]);

  const handleSavePlot = () => {
    if (!editingCell || !targetEmployee) return;
    const allotted = targetEmployee.avlAllotted || 0;
    if (currentAnnualTotal > allotted) {
        toast({ 
            variant: 'destructive', 
            title: 'Limit Exceeded', 
            description: `Your limit is ${allotted} days, but you are trying to schedule ${currentAnnualTotal} days total for the year.` 
        });
        return;
    }

    // Double-check conflict on save (in case preventConflicts was toggled mid-edit)
    if (preventConflicts) {
      const conflicts = tempPlottedDays.filter(d => conflictDaysForEdit.has(d.day));
      if (conflicts.length > 0) {
        toast({
          variant: 'destructive',
          title: 'Conflict Detected',
          description: `Day(s) ${conflicts.map(d => d.day).join(', ')} conflict with another group member. Please deselect them first.`,
        });
        return;
      }
    }

    const existing = getCellData(editingCell.employeeId, editingCell.month);
    if (existing) {
      setPreferredAvl(prev => prev.map(p => p.id === existing.id ? { ...p, plottedDays: tempPlottedDays } : p));
    } else {
      const newAvl: PreferredAvl = {
        id: uuidv4(),
        employeeId: editingCell.employeeId,
        year: selectedYear,
        month: editingCell.month,
        plottedDays: tempPlottedDays
      };
      setPreferredAvl(prev => [...prev, newAvl]);
    }
    setIsPlotDialogOpen(false);
    toast({ title: "Plot Updated" });
  };

  const handleUpdateEmployee = (id: string, field: 'avlBeginningBalance' | 'avlAllotted', value: string) => {
    const num = parseFloat(value) || 0;
    setEmployees(prev => prev.map(e => {
        if (e.id === id) {
            const updated = { ...e, [field]: num };
            if (field === 'avlBeginningBalance') {
                updated.avlAllotted = Math.floor(num / 2);
            }
            return updated;
        }
        return e;
    }));
  };

  const toggleLock = () => {
    setAvlLocks(prev => ({ ...prev, [lockKey]: !isLocked }));
    toast({ 
        title: isLocked ? "Grid Unlocked" : "Grid Locked", 
        description: isLocked ? "Users can now edit their preferred dates." : "Regular users are now restricted from editing."
    });
  };

  const handleClearAll = () => {
    const groupEmployeeIds = new Set(groupEmployees.map(e => e.id));
    setPreferredAvl(prev => prev.filter(p => !(p.year === selectedYear && groupEmployeeIds.has(p.employeeId))));
    setEmployees(prev => prev.map(e => {
      if (groupEmployeeIds.has(e.id)) return { ...e, avlBeginningBalance: 0, avlAllotted: 0 };
      return e;
    }));
    toast({ title: "Grid & Balances Cleared", description: `All plotted dates and AVL balances for your group in ${selectedYear} have been removed.` });
  };

  // ── CSV Export ────────────────────────────────────────────────────────────
  const handleExportCsv = () => {
    const rows: Record<string, string | number>[] = [];
    for (const emp of groupEmployees) {
      const row: Record<string, string | number> = {
        'EMPLOYEE_ID': emp.id,
        'EMPLOYEE': getFullName(emp),
        'GROUP': emp.group || '',
        'YEAR': selectedYear,
        'VL_BEGINNING_BALANCE': emp.avlBeginningBalance ?? 0,
        'AVL_TO_BE_SCHEDULED': emp.avlAllotted ?? 0,
      };
      for (let m = 0; m < 12; m++) {
        const data = getCellData(emp.id, m);
        row[MONTHS[m]] = data
          ? data.plottedDays
              .sort((a, b) => a.day - b.day)
              .map(d => d.isClaimed ? `${d.day}*` : String(d.day))
              .join(',')
          : '';
      }
      rows.push(row);
    }
    const csv = Papa.unparse(rows);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    saveAs(blob, `PreferredAVL_${currentUser.group || 'group'}_${selectedYear}.csv`);
    toast({ title: 'Export Successful', description: 'Preferred AVL data exported to CSV.' });
  };

  // ── CSV Import ────────────────────────────────────────────────────────────
  const handleImportCsv = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    // Reset file input so same file can be re-imported
    e.target.value = '';

    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      complete: (results) => {
        try {
          const requiredHeaders = ['EMPLOYEE', 'YEAR'];
          const headers = results.meta.fields?.map(h => h.toUpperCase()) || [];
          const missing = requiredHeaders.filter(h => !headers.includes(h));
          if (missing.length > 0) throw new Error(`Missing columns: ${missing.join(', ')}`);

          const newPreferredAvl: PreferredAvl[] = [];
          const updatedEmployees: { id: string; avlBeginningBalance: number; avlAllotted: number }[] = [];
          const skipped: string[] = [];

          for (const row of results.data as Record<string, string>[]) {
            const rawName = row['EMPLOYEE'] || '';
            const rowYear = parseInt(row['YEAR'] || String(selectedYear));

            // Match employee by ID first, then by name
            let emp = row['EMPLOYEE_ID']
              ? groupEmployees.find(e => e.id === row['EMPLOYEE_ID'])
              : undefined;
            if (!emp) {
              const normalName = rawName.trim().toLowerCase();
              emp = groupEmployees.find(e =>
                getFullName(e).toLowerCase() === normalName
              );
            }
            if (!emp) { skipped.push(rawName || row['EMPLOYEE_ID'] || '?'); continue; }

            // Balance columns
            const beginBal = parseFloat(row['VL_BEGINNING_BALANCE'] || '') || emp.avlBeginningBalance || 0;
            const allotted = parseFloat(row['AVL_TO_BE_SCHEDULED'] || '') || emp.avlAllotted || 0;
            updatedEmployees.push({ id: emp.id, avlBeginningBalance: beginBal, avlAllotted: allotted });

            // Month columns
            for (let m = 0; m < 12; m++) {
              const monthKey = MONTHS[m];
              const raw = (row[monthKey] || '').trim();
              if (!raw) continue;
              const days: PreferredAvlDay[] = raw.split(',')
                .map(s => s.trim())
                .filter(Boolean)
                .map(s => {
                  const isClaimed = s.endsWith('*');
                  const day = parseInt(s.replace('*', ''));
                  return isNaN(day) ? null : { day, isClaimed };
                })
                .filter((d): d is PreferredAvlDay => d !== null);
              if (days.length === 0) continue;

              // Find existing or create new record
              const existingIdx = newPreferredAvl.findIndex(
                p => p.employeeId === emp!.id && p.year === rowYear && p.month === m
              );
              const record: PreferredAvl = {
                id: uuidv4(),
                employeeId: emp.id,
                year: rowYear,
                month: m,
                plottedDays: days,
              };
              if (existingIdx >= 0) newPreferredAvl[existingIdx] = record;
              else newPreferredAvl.push(record);
            }
          }

          // Merge imported data: replace same employee+year+month records, keep others
          const groupEmpIds = new Set(groupEmployees.map(e => e.id));
          const importedKeys = new Set(newPreferredAvl.map(p => `${p.employeeId}-${p.year}-${p.month}`));
          setPreferredAvl(prev => [
            ...prev.filter(p => {
              if (!groupEmpIds.has(p.employeeId)) return true; // keep other groups
              return !importedKeys.has(`${p.employeeId}-${p.year}-${p.month}`);
            }),
            ...newPreferredAvl,
          ]);

          // Update employee balances
          if (updatedEmployees.length > 0) {
            const balMap = new Map(updatedEmployees.map(u => [u.id, u]));
            setEmployees(prev => prev.map(e => {
              const update = balMap.get(e.id);
              if (!update) return e;
              return { ...e, avlBeginningBalance: update.avlBeginningBalance, avlAllotted: update.avlAllotted };
            }));
          }

          const msg = skipped.length > 0
            ? `${newPreferredAvl.length} records imported. Skipped (not found): ${skipped.join(', ')}.`
            : `${newPreferredAvl.length} records imported successfully.`;
          toast({ title: 'Import Successful', description: msg });
        } catch (err) {
          toast({ variant: 'destructive', title: 'Import Failed', description: (err as Error).message });
        }
      },
      error: (err) => toast({ variant: 'destructive', title: 'CSV Error', description: err.message }),
    });
  };

  const calendarDays = useMemo(() => {
    if (!editingCell) return [];
    const daysInMonth = new Date(selectedYear, editingCell.month + 1, 0).getDate();
    return Array.from({ length: daysInMonth }, (_, i) => i + 1);
  }, [editingCell, selectedYear]);

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div>
            <h2 className="text-2xl font-bold tracking-tight">Preferred AVL Management</h2>
            <p className="text-muted-foreground">Annual preferred vacation leave planning grid.</p>
          </div>
          {isLocked && (
            <Badge variant="destructive" className="flex items-center gap-1">
                <Lock className="h-3 w-3" /> Locked
            </Badge>
          )}
        </div>
        <div className="flex items-center gap-2 flex-wrap justify-end">
           {isManager && (
              <>
                {/* Conflict prevention toggle */}
                <div className="flex items-center gap-2 border rounded-md px-3 py-2 bg-muted/30">
                  <AlertTriangle className="h-4 w-4 text-amber-500" />
                  <Label htmlFor="conflict-toggle" className="text-xs font-medium cursor-pointer whitespace-nowrap">
                    Block group conflicts
                  </Label>
                  <Switch
                    id="conflict-toggle"
                    checked={preventConflicts}
                    onCheckedChange={setPreventConflicts}
                  />
                </div>

                {/* Import CSV */}
                <input
                  ref={importInputRef}
                  type="file"
                  accept=".csv"
                  className="hidden"
                  onChange={handleImportCsv}
                />
                <Button variant="outline" onClick={() => importInputRef.current?.click()}>
                  <Upload className="h-4 w-4 mr-2" /> Import CSV
                </Button>

                {/* Export CSV */}
                <Button variant="outline" onClick={handleExportCsv}>
                  <Download className="h-4 w-4 mr-2" /> Export CSV
                </Button>

                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button variant="destructive">
                      <Trash2 className="h-4 w-4 mr-2" /> Clear All
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>Clear All Plotted Dates & Balances?</AlertDialogTitle>
                      <AlertDialogDescription>
                        This will permanently delete ALL plotted preferred leave dates AND reset everyone's VL balances to zero for the year {selectedYear} in your group. This action cannot be undone.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Cancel</AlertDialogCancel>
                      <AlertDialogAction onClick={handleClearAll} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
                        Clear Grid & Balances
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>

                <Button variant={isLocked ? "outline" : "secondary"} onClick={toggleLock}>
                  {isLocked ? <><Unlock className="h-4 w-4 mr-2" /> Unlock</> : <><Lock className="h-4 w-4 mr-2" /> Lock for Members</>}
                </Button>
              </>
           )}
           <Label className="text-sm font-bold ml-2">YEAR:</Label>
           <Select value={String(selectedYear)} onValueChange={v => setSelectedYear(parseInt(v))}>
              <SelectTrigger className="w-32">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {[2024, 2025, 2026, 2027].map(y => (
                  <SelectItem key={y} value={String(y)}>{y}</SelectItem>
                ))}
              </SelectContent>
           </Select>

        </div>
      </div>

      {/* Conflict mode notice */}
      {preventConflicts && (
        <div className="flex items-center gap-2 rounded-md border border-amber-300 bg-amber-50 dark:bg-amber-950/30 px-4 py-2 text-sm text-amber-700 dark:text-amber-400">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          <span>
            <strong>Group conflict prevention is ON.</strong> Dates already taken by another member in this group are highlighted and blocked.
          </span>
        </div>
      )}

      <Card className="overflow-hidden border-2 border-primary/20">
        <div className="overflow-x-auto">
          <Table className="border-collapse text-[11px] leading-tight">
            <TableHeader className="bg-primary/5">
              <TableRow className="hover:bg-transparent">
                <TableHead className="border border-border text-center font-bold px-1 w-20">VL BEGINNING BALANCE</TableHead>
                <TableHead className="border border-border text-center font-bold px-1 w-20">NO. OF AVL TO BE SCHEDULED</TableHead>
                <TableHead className="border border-border font-bold w-48">NAME</TableHead>
                {MONTHS.map(m => (
                  <TableHead key={m} className="border border-border text-center font-bold px-1 w-16">{m}</TableHead>
                ))}
                <TableHead className="border border-border text-center font-bold px-1 w-24">TOTAL SCHEDULED AVL</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {groupEmployees.map(emp => {
                const totalScheduled = calculateTotalScheduled(emp.id);
                const isOverLimit = totalScheduled > (emp.avlAllotted || 0);
                return (
                  <TableRow key={emp.id} className="h-10">
                    <TableCell className="border border-border p-0">
                      <Input 
                        type="number" 
                        step="0.1"
                        className="border-0 h-full rounded-none text-center text-xs focus-visible:ring-1" 
                        value={emp.avlBeginningBalance || 0}
                        readOnly={!isManager}
                        onChange={e => handleUpdateEmployee(emp.id, 'avlBeginningBalance', e.target.value)}
                      />
                    </TableCell>
                    <TableCell className="border border-border p-0">
                      <Input 
                        type="number" 
                        step="0.1"
                        className="border-0 h-full rounded-none text-center text-xs focus-visible:ring-1" 
                        value={emp.avlAllotted || 0}
                        readOnly={!isManager}
                        onChange={e => handleUpdateEmployee(emp.id, 'avlAllotted', e.target.value)}
                      />
                    </TableCell>
                    <TableCell className="border border-border font-bold bg-muted/20 px-2">
                      {getFullName(emp)}
                    </TableCell>
                    {MONTHS.map((_, mIdx) => {
                      const data = getCellData(emp.id, mIdx);
                      const conflictDays = getConflictingDays(emp.id, mIdx);
                      const hasConflict = data && preventConflicts && data.plottedDays.some(d => conflictDays.has(d.day));
                      const isClickable = isManager || (emp.id === currentUser.id && !isLocked);
                      return (
                        <TableCell 
                          key={mIdx} 
                          className={cn(
                            "border border-border text-center p-1 transition-colors",
                            isClickable ? "cursor-pointer hover:bg-primary/10" : "cursor-not-allowed bg-muted/5",
                            hasConflict && "bg-amber-50 dark:bg-amber-950/20",
                          )}
                          onClick={() => handleOpenPlot(emp.id, mIdx)}
                        >
                          <div className="flex flex-wrap justify-center gap-0.5">
                            {data?.plottedDays.sort((a,b) => a.day - b.day).map((pd, i) => {
                              const isConflicted = preventConflicts && conflictDays.has(pd.day);
                              return (
                                <span key={pd.day} className={cn(
                                  pd.isClaimed && "text-green-600 font-bold underline",
                                  isConflicted && "text-amber-600 font-bold",
                                )}>
                                  {pd.day}{i < (data?.plottedDays.length ?? 0) - 1 ? ',' : ''}
                                </span>
                              );
                            })}
                          </div>
                        </TableCell>
                      );
                    })}
                    <TableCell className={cn(
                        "border border-border text-center font-bold text-lg",
                        isOverLimit ? "bg-destructive/10 text-destructive" : "bg-primary/5"
                    )}>
                      {totalScheduled}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      </Card>

      <Dialog open={isPlotDialogOpen} onOpenChange={setIsPlotDialogOpen}>
        <DialogContent className="sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>Plot Preferred Dates</DialogTitle>
            <DialogDescription>
              Select dates for {editingCell ? MONTHS[editingCell.month] : ''} {selectedYear}.
              {preventConflicts && conflictDaysForEdit.size > 0 && (
                <span className="block mt-1 text-amber-600 font-medium text-xs">
                  ⚠ Days already taken by your group: {[...conflictDaysForEdit].sort((a,b)=>a-b).join(', ')}
                </span>
              )}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-6 py-4">
            <div className="flex items-center justify-between px-1">
                <span className="text-sm font-medium">Monthly Selection</span>
                <Badge variant={currentAnnualTotal > (targetEmployee?.avlAllotted || 0) ? "destructive" : "secondary"}>
                    Total Scheduled: {currentAnnualTotal} / {targetEmployee?.avlAllotted || 0} days
                </Badge>
            </div>

            <div className="grid grid-cols-7 gap-2">
                {calendarDays.map(day => {
                    const isSelected = !!tempPlottedDays.find(d => d.day === day);
                    const isClaimed = !!tempPlottedDays.find(d => d.day === day && d.isClaimed);
                    const isConflicted = conflictDaysForEdit.has(day) && !isSelected;
                    return (
                        <Button
                            key={day}
                            variant={isSelected ? "default" : "outline"}
                            className={cn(
                                "h-10 w-full p-0 relative",
                                isClaimed && "bg-green-600 hover:bg-green-700 text-white border-green-800",
                                isConflicted && "border-amber-400 bg-amber-50 dark:bg-amber-950/30 text-amber-700 cursor-not-allowed opacity-70",
                            )}
                            onClick={() => toggleDaySelection(day, conflictDaysForEdit)}
                            title={isConflicted ? "Taken by another group member" : undefined}
                        >
                            {day}
                            {isConflicted && (
                              <span className="absolute -top-1 -right-1 text-[8px] leading-none bg-amber-500 text-white rounded-full w-3 h-3 flex items-center justify-center">!</span>
                            )}
                        </Button>
                    );
                })}
            </div>
            
            <Separator />
            
            <div className="space-y-3">
                <Label className="text-sm font-bold">Selected Dates & Status</Label>
                <ScrollArea className="h-40 border rounded-md p-3">
                    {tempPlottedDays.length > 0 ? (
                        <div className="space-y-2">
                            {tempPlottedDays.sort((a,b) => a.day - b.day).map(pd => (
                                <div key={pd.day} className="flex items-center justify-between p-2 border rounded-sm bg-muted/30">
                                    <span className="font-bold text-sm">Day {pd.day}</span>
                                    <div className="flex items-center gap-4">
                                        <div className="flex items-center gap-2">
                                            <Checkbox 
                                                id={`claimed-${pd.day}`} 
                                                checked={pd.isClaimed}
                                                disabled={!isManager}
                                                onCheckedChange={() => toggleDayClaimed(pd.day)}
                                            />
                                            <Label htmlFor={`claimed-${pd.day}`} className="text-xs cursor-pointer">Claimed</Label>
                                        </div>
                                        <Button variant="ghost" size="icon" className="h-6 w-6 text-destructive" onClick={() => toggleDaySelection(pd.day, new Set())}>
                                            <Trash2 className="h-4 w-4" />
                                        </Button>
                                    </div>
                                </div>
                            ))}
                        </div>
                    ) : (
                        <p className="text-center text-muted-foreground text-xs py-8 italic">No dates selected yet. Click the numbers above to plot.</p>
                    )}
                </ScrollArea>
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setIsPlotDialogOpen(false)}>Cancel</Button>
            <Button 
                onClick={handleSavePlot}
                disabled={currentAnnualTotal > (targetEmployee?.avlAllotted || 0)}
            >
                Save Changes
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
