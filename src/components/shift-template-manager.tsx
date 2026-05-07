
'use client';

import React, { useState, useMemo } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/card';
import { ScrollArea } from '@/components/ui/scroll-area';
import { 
    Search, PlusCircle, Upload, Download, Pencil, 
    Copy, Trash2, FileText, Settings2, CalendarCheck 
} from 'lucide-react';
import type { ShiftTemplate } from './shift-editor';
import type { Employee, Shift, Leave } from '@/types';
import { useToast } from '@/hooks/use-toast';
import { v4 as uuidv4 } from 'uuid';
import { format } from 'date-fns';
import Papa from 'papaparse';
import { saveAs } from 'file-saver';
import { TemplateImporter } from './template-importer';
import { ScheduleImporter } from './schedule-importer';

// Reverse map for export
const colorToName: { [key: string]: string } = {
  'default': 'Default',
  'hsl(var(--chart-4))': 'Orange',
  'hsl(var(--chart-1))': 'Red',
  '#3498db': 'Blue',
  'hsl(var(--chart-2))': 'Green',
  '#9b59b6': 'Purple',
  '#e91e63': 'Pink',
  '#ffffff': 'White',
  '#f1c40f': 'Yellow',
  '#6b7280': 'Dark Grayish Blue',
};

type ShiftTemplateManagerProps = {
  isOpen: boolean;
  setIsOpen: (open: boolean) => void;
  shiftTemplates: ShiftTemplate[];
  setShiftTemplates: React.Dispatch<React.SetStateAction<ShiftTemplate[]>>;
  employees: Employee[];
  shifts: Shift[];
  setShifts: React.Dispatch<React.SetStateAction<Shift[]>>;
  leave: Leave[];
  setLeave: React.Dispatch<React.SetStateAction<Leave[]>>;
  leaveTypes: any[];
  setMonthlyEmployeeOrder: React.Dispatch<React.SetStateAction<Record<string, string[]>>>;
};

export function ShiftTemplateManager({ 
  isOpen, 
  setIsOpen, 
  shiftTemplates, 
  setShiftTemplates,
  employees,
  shifts,
  setShifts,
  leave,
  setLeave,
  leaveTypes,
  setMonthlyEmployeeOrder
}: ShiftTemplateManagerProps) {
  const { toast } = useToast();
  const [activeTab, setActiveTab] = useState('templates');
  const [search, setSearch] = useState('');
  const [isTemplateImporterOpen, setIsTemplateImporterOpen] = useState(false);
  const [isScheduleImporterOpen, setIsScheduleImporterOpen] = useState(false);

  const filteredTemplates = useMemo(() => {
    return shiftTemplates.filter(t => 
      t.name.toLowerCase().includes(search.toLowerCase()) || 
      t.label.toLowerCase().includes(search.toLowerCase())
    );
  }, [shiftTemplates, search]);

  const handleExportTemplates = () => {
    const csvData = shiftTemplates.map(t => ({
      'Shift Label': t.label,
      'Start Time': t.startTime,
      'End Time': t.endTime,
      'Shift Color': colorToName[t.color] || t.color || 'Default',
      'Break Start': t.breakStartTime || '',
      'Break End': t.breakEndTime || '',
      'Is Unpaid Break': t.isUnpaidBreak ? 'true' : 'false'
    }));

    const csv = Papa.unparse(csvData);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    saveAs(blob, `Shift_Templates_${format(new Date(), 'yyyy-MM-dd')}.csv`);
    toast({ title: 'Export Successful' });
  };

  const handleDuplicate = (tpl: ShiftTemplate) => {
    const newTpl = { ...tpl, id: uuidv4(), name: `${tpl.name} (Copy)` };
    setShiftTemplates(prev => [...prev, newTpl]);
    toast({ title: 'Template Duplicated' });
  };

  const handleDelete = (id: string) => {
    setShiftTemplates(prev => prev.filter(t => t.id !== id));
    toast({ title: 'Template Deleted', variant: 'destructive' });
  };

  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      <DialogContent className="max-w-4xl max-h-[90vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Settings2 className="h-5 w-5" />
            Manage Shifts
          </DialogTitle>
          <DialogDescription>
            Manage reusable shift templates and import bulk schedule assignments.
          </DialogDescription>
        </DialogHeader>

        <Tabs value={activeTab} onValueChange={setActiveTab} className="flex-1 overflow-hidden flex flex-col">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="templates">Templates</TabsTrigger>
            <TabsTrigger value="assignments">Import Assignments</TabsTrigger>
          </TabsList>

          <TabsContent value="templates" className="flex-1 overflow-hidden flex flex-col space-y-4 pt-4">
            <div className="flex flex-col sm:flex-row gap-2 justify-between">
              <div className="relative flex-1">
                <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Search templates..."
                  className="pl-8"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </div>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" onClick={() => setIsTemplateImporterOpen(true)}>
                  <Upload className="h-4 w-4 mr-2" /> Import
                </Button>
                <Button variant="outline" size="sm" onClick={handleExportTemplates}>
                  <Download className="h-4 w-4 mr-2" /> Export
                </Button>
                <Button size="sm" onClick={() => toast({ title: "Feature coming soon", description: "Use the shift editor to create new definitions." })}>
                  <PlusCircle className="h-4 w-4 mr-2" /> New
                </Button>
              </div>
            </div>

            <ScrollArea className="flex-1 border rounded-md p-4">
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {filteredTemplates.map(tpl => (
                  <Card key={tpl.id} className="relative group overflow-hidden">
                    <div className="absolute top-0 left-0 w-1 h-full" style={{ backgroundColor: tpl.color === 'default' ? 'hsl(var(--primary))' : tpl.color }} />
                    <CardContent className="p-4">
                      <div className="flex justify-between items-start mb-2">
                        <div>
                          <h4 className="font-bold text-sm leading-none mb-1">{tpl.label}</h4>
                          <p className="text-xs text-muted-foreground">{tpl.startTime} - {tpl.endTime}</p>
                        </div>
                        <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => handleDuplicate(tpl)}>
                            <Copy className="h-3.5 w-3.5" />
                          </Button>
                          <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" onClick={() => handleDelete(tpl.id)}>
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      </div>
                      <div className="flex items-center gap-2 mt-4">
                        <div className="w-3 h-3 rounded-full border" style={{ backgroundColor: tpl.color === 'default' ? 'hsl(var(--primary))' : tpl.color }} />
                        <span className="text-[10px] uppercase font-bold tracking-tighter opacity-50">
                          {colorToName[tpl.color] || 'Custom'}
                        </span>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
              {filteredTemplates.length === 0 && (
                <div className="text-center py-20 text-muted-foreground">
                  <FileText className="h-10 w-10 mx-auto opacity-20 mb-2" />
                  <p>No shift templates found.</p>
                </div>
              )}
            </ScrollArea>
          </TabsContent>

          <TabsContent value="assignments" className="flex-1 overflow-hidden pt-4">
            <Card className="h-full border-dashed flex flex-col items-center justify-center text-center p-8">
              <CalendarCheck className="h-16 w-16 text-primary opacity-20 mb-4" />
              <h3 className="text-lg font-bold mb-2">Bulk Schedule Import</h3>
              <p className="text-sm text-muted-foreground max-w-sm mb-6">
                Upload a matrix CSV to assign shifts and leave to multiple employees at once.
              </p>
              <Button size="lg" onClick={() => setIsScheduleImporterOpen(true)}>
                <Upload className="h-5 w-5 mr-2" />
                Select Schedule File
              </Button>
            </Card>
          </TabsContent>
        </Tabs>
      </DialogContent>

      <TemplateImporter 
        isOpen={isTemplateImporterOpen}
        setIsOpen={setIsTemplateImporterOpen}
        onImport={(tpls) => {
          setShiftTemplates(prev => [...prev, ...tpls]);
          setIsTemplateImporterOpen(false);
        }}
      />

      <ScheduleImporter
        isOpen={isScheduleImporterOpen}
        setIsOpen={setIsScheduleImporterOpen}
        employees={employees}
        shiftTemplates={shiftTemplates}
        leaveTypes={leaveTypes}
        onImport={(data) => {
          const { shifts: importedShifts, leave: importedLeave, monthlyOrders, overwrittenCells } = data;
          
          const cellsToOverwrite = new Set(
            overwrittenCells.map(cell => `${cell.employeeId}-${format(cell.date, 'yyyy-MM-dd')}`)
          );

          setShifts(prev => [
            ...prev.filter(s => !s.employeeId || !cellsToOverwrite.has(`${s.employeeId}-${format(new Date(s.date), 'yyyy-MM-dd')}`)),
            ...importedShifts
          ]);

          setLeave(prev => [
            ...prev.filter(l => !l.employeeId || !cellsToOverwrite.has(`${l.employeeId}-${format(new Date(l.startDate), 'yyyy-MM-dd')}`)),
            ...importedLeave
          ]);

          setMonthlyEmployeeOrder(prev => ({ ...prev, ...monthlyOrders }));
          setIsScheduleImporterOpen(false);
          toast({ title: "Import Successful" });
        }}
      />
    </Dialog>
  );
}
