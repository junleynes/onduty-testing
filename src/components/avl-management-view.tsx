
'use client';

import React, { useState, useMemo } from 'react';
import type { Employee, PreferredAvl, PreferredAvlDay } from '@/types';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { useToast } from '@/hooks/use-toast';
import { cn, getFullName } from '@/lib/utils';
import { Save, Lock, Unlock, Check, Trash2 } from 'lucide-react';
import { v4 as uuidv4 } from 'uuid';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from './ui/dialog';
import { Label } from './ui/label';
import { Checkbox } from './ui/checkbox';
import { Badge } from './ui/badge';
import { Separator } from './ui/separator';
import { ScrollArea } from './ui/scroll-area';

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

const CALENDAR_DAYS = Array.from({ length: 31 }, (_, i) => i + 1);

export default function AvlManagementView({ currentUser, employees, setEmployees, preferredAvl, setPreferredAvl, avlLocks, setAvlLocks }: AvlManagementViewProps) {
  const { toast } = useToast();
  const [selectedYear, setSelectedYear] = useState(new Date().getFullYear());
  const [isPlotDialogOpen, setIsPlotDialogOpen] = useState(false);
  const [editingCell, setEditingCell] = useState<{ employeeId: string; month: number } | null>(null);
  const [tempPlottedDays, setTempPlottedDays] = useState<PreferredAvlDay[]>([]);

  const isManager = currentUser.role === 'manager' || currentUser.role === 'admin';
  const lockKey = `${currentUser.group}-${selectedYear}`;
  const isLocked = !!avlLocks[lockKey];

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

  const toggleDaySelection = (day: number) => {
    setTempPlottedDays(prev => {
        const exists = prev.find(d => d.day === day);
        if (exists) {
            return prev.filter(d => d.day !== day);
        }
        return [...prev, { day, isClaimed: false }];
    });
  };

  const toggleDayClaimed = (day: number) => {
    if (!isManager) return;
    setTempPlottedDays(prev => prev.map(d => 
        d.day === day ? { ...d, isClaimed: !d.isClaimed } : d
    ));
  };

  const handleSavePlot = () => {
    if (!editingCell) return;

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
            // Auto-calculate "to be scheduled" as 50% of beginning balance
            if (field === 'avlBeginningBalance') {
                updated.avlAllotted = num / 2;
            }
            return updated;
        }
        return e;
    }));
  };

  const toggleLock = () => {
    setAvlLocks(prev => ({
        ...prev,
        [lockKey]: !isLocked
    }));
    toast({ 
        title: isLocked ? "Grid Unlocked" : "Grid Locked", 
        description: isLocked ? "Users can now edit their preferred dates." : "Regular users are now restricted from editing."
    });
  };

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
        <div className="flex items-center gap-2">
           {isManager && (
              <Button variant={isLocked ? "outline" : "secondary"} onClick={toggleLock}>
                {isLocked ? <><Unlock className="h-4 w-4 mr-2" /> Unlock</> : <><Lock className="h-4 w-4 mr-2" /> Lock for Members</>}
              </Button>
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
           {isManager && (
             <Button onClick={() => toast({ title: "Preferences Saved Successfully" })}>
                <Save className="h-4 w-4 mr-2" /> Save All
             </Button>
           )}
        </div>
      </div>

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
                      {getFullName(emp).toUpperCase()}
                    </TableCell>
                    {MONTHS.map((_, mIdx) => {
                      const data = getCellData(emp.id, mIdx);
                      const isClickable = isManager || (emp.id === currentUser.id && !isLocked);
                      return (
                        <TableCell 
                          key={mIdx} 
                          className={cn(
                            "border border-border text-center p-1 transition-colors",
                            isClickable ? "cursor-pointer hover:bg-primary/10" : "cursor-not-allowed bg-muted/5",
                          )}
                          onClick={() => handleOpenPlot(emp.id, mIdx)}
                        >
                          <div className="flex flex-wrap justify-center gap-0.5">
                            {data?.plottedDays.sort((a,b) => a.day - b.day).map((pd, i) => (
                                <span key={pd.day} className={cn(pd.isClaimed && "text-green-600 font-bold underline")}>
                                    {pd.day}{i < data.plottedDays.length - 1 ? ',' : ''}
                                </span>
                            ))}
                          </div>
                        </TableCell>
                      );
                    })}
                    <TableCell className="border border-border text-center font-bold text-lg bg-primary/5">
                      {calculateTotalScheduled(emp.id)}
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
              Select dates for {editingCell ? MONTHS[editingCell.month] : ''} {selectedYear}. {isManager && "Toggle 'Claimed' status for individual days below."}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-6 py-4">
            <div className="grid grid-cols-7 gap-2">
                {CALENDAR_DAYS.map(day => {
                    const isSelected = !!tempPlottedDays.find(d => d.day === day);
                    const isClaimed = !!tempPlottedDays.find(d => d.day === day && d.isClaimed);
                    return (
                        <Button
                            key={day}
                            variant={isSelected ? "default" : "outline"}
                            className={cn(
                                "h-10 w-full p-0",
                                isClaimed && "bg-green-600 hover:bg-green-700 text-white border-green-800"
                            )}
                            onClick={() => toggleDaySelection(day)}
                        >
                            {day}
                        </Button>
                    )
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
                                        <Button variant="ghost" size="icon" className="h-6 w-6 text-destructive" onClick={() => toggleDaySelection(pd.day)}>
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
            <Button onClick={handleSavePlot}>Save Changes</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
