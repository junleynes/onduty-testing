
'use client';

import React, { useState, useMemo } from 'react';
import type { Employee, PreferredAvl } from '@/types';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { useToast } from '@/hooks/use-toast';
import { getFullName } from '@/lib/utils';
import { Save, Calendar, Check, X, Pencil, MoreVertical } from 'lucide-react';
import { v4 as uuidv4 } from 'uuid';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from './ui/dialog';
import { Label } from './ui/label';
import { Checkbox } from './ui/checkbox';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from './ui/dropdown-menu';

type AvlManagementViewProps = {
  currentUser: Employee;
  employees: Employee[];
  setEmployees: React.Dispatch<React.SetStateAction<Employee[]>>;
  preferredAvl: PreferredAvl[];
  setPreferredAvl: React.Dispatch<React.SetStateAction<PreferredAvl[]>>;
};

const MONTHS = [
  'JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 
  'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'
];

export default function AvlManagementView({ currentUser, employees, setEmployees, preferredAvl, setPreferredAvl }: AvlManagementViewProps) {
  const { toast } = useToast();
  const [selectedYear, setSelectedYear] = useState(new Date().getFullYear());
  const [isPlotDialogOpen, setIsPlotDialogOpen] = useState(false);
  const [editingCell, setEditingCell] = useState<{ employeeId: string; month: number } | null>(null);
  const [plotDays, setPlotPlotDays] = useState<string>('');
  const [plotIsClaimed, setPlotIsClaimed] = useState(false);

  const isManager = currentUser.role === 'manager' || currentUser.role === 'admin';

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
      .reduce((sum, p) => sum + p.dayNumbers.length, 0);
  };

  const handleOpenPlot = (employeeId: string, month: number) => {
    if (!isManager && employeeId !== currentUser.id) return;
    
    const existing = getCellData(employeeId, month);
    setEditingCell({ employeeId, month });
    setPlotPlotDays(existing ? existing.dayNumbers.join(', ') : '');
    setPlotIsClaimed(existing ? existing.isClaimed : false);
    setIsPlotDialogOpen(true);
  };

  const handleSavePlot = () => {
    if (!editingCell) return;

    const days = plotDays.split(',')
      .map(d => parseInt(d.trim()))
      .filter(d => !isNaN(d) && d >= 1 && d <= 31);

    const existing = getCellData(editingCell.employeeId, editingCell.month);

    if (existing) {
      setPreferredAvl(prev => prev.map(p => p.id === existing.id ? { ...p, dayNumbers: days, isClaimed: plotIsClaimed } : p));
    } else {
      const newAvl: PreferredAvl = {
        id: uuidv4(),
        employeeId: editingCell.employeeId,
        year: selectedYear,
        month: editingCell.month,
        dayNumbers: days,
        isClaimed: plotIsClaimed
      };
      setPreferredAvl(prev => [...prev, newAvl]);
    }

    setIsPlotDialogOpen(false);
    toast({ title: "Plot Updated" });
  };

  const handleUpdateEmployee = (id: string, field: 'avlBeginningBalance' | 'avlAllotted', value: string) => {
    const num = parseFloat(value) || 0;
    setEmployees(prev => prev.map(e => e.id === id ? { ...e, [field]: num } : e));
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">Preferred AVL Management</h2>
          <p className="text-muted-foreground">Annual preferred vacation leave planning grid.</p>
        </div>
        <div className="flex items-center gap-2">
           <Label className="text-sm font-bold">YEAR:</Label>
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
              {groupEmployees.map(emp => (
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
                    const canEdit = isManager || emp.id === currentUser.id;
                    return (
                      <TableCell 
                        key={mIdx} 
                        className={cn(
                          "border border-border text-center p-1 cursor-pointer transition-colors",
                          canEdit && "hover:bg-primary/10",
                          data?.isClaimed && "bg-green-50 text-green-700 font-bold"
                        )}
                        onClick={() => handleOpenPlot(emp.id, mIdx)}
                      >
                        {data?.dayNumbers.join(', ')}
                      </TableCell>
                    );
                  })}
                  <TableCell className="border border-border text-center font-bold text-lg bg-primary/5">
                    {calculateTotalScheduled(emp.id)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </Card>

      <Dialog open={isPlotDialogOpen} onOpenChange={setIsPlotDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Plot Preferred Dates</DialogTitle>
            <DialogDescription>
              Enter day numbers separated by commas for {editingCell ? MONTHS[editingCell.month] : ''} {selectedYear}.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="days">Days (e.g. 8, 9, 10)</Label>
              <Input 
                id="days" 
                value={plotDays} 
                onChange={e => setPlotPlotDays(e.target.value)}
                placeholder="1, 15, 20"
              />
            </div>
            {isManager && (
              <div className="flex items-center space-x-2 border p-3 rounded-md">
                <Checkbox 
                  id="claimed" 
                  checked={plotIsClaimed} 
                  onCheckedChange={(v) => setPlotIsClaimed(!!v)}
                />
                <div className="grid gap-1.5 leading-none">
                  <label htmlFor="claimed" className="text-sm font-medium">Mark as Claimed</label>
                  <p className="text-xs text-muted-foreground">Claimed dates will be highlighted in green.</p>
                </div>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setIsPlotDialogOpen(false)}>Cancel</Button>
            <Button onClick={handleSavePlot}>Save Dates</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
