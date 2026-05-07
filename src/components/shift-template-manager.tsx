
'use client';

import React, { useState, useMemo } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/card';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Checkbox } from '@/components/ui/checkbox';
import { 
    Search, Upload, Download, Pencil, 
    Copy, Trash2, FileText, Settings2 
} from 'lucide-react';
import type { ShiftTemplate } from './shift-editor';
import type { Employee, Shift, Leave } from '@/types';
import { useToast } from '@/hooks/use-toast';
import { v4 as uuidv4 } from 'uuid';
import { format } from 'date-fns';
import Papa from 'papaparse';
import { saveAs } from 'file-saver';
import { TemplateImporter } from './template-importer';

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
};

export function ShiftTemplateManager({ 
  isOpen, 
  setIsOpen, 
  shiftTemplates, 
  setShiftTemplates
}: ShiftTemplateManagerProps) {
  const { toast } = useToast();
  const [search, setSearch] = useState('');
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [isTemplateImporterOpen, setIsTemplateImporterOpen] = useState(false);

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
    setSelectedIds(prev => prev.filter(selectedId => selectedId !== id));
    toast({ title: 'Template Deleted', variant: 'destructive' });
  };

  const handleDeleteSelected = () => {
    setShiftTemplates(prev => prev.filter(t => !selectedIds.includes(t.id)));
    toast({ title: `${selectedIds.length} Templates Deleted`, variant: 'destructive' });
    setSelectedIds([]);
  };

  const toggleSelect = (id: string) => {
    setSelectedIds(prev => prev.includes(id) ? prev.filter(i => i !== id) : [...prev, id]);
  };

  const toggleSelectAll = (checked: boolean) => {
    if (checked) {
        setSelectedIds(filteredTemplates.map(t => t.id));
    } else {
        setSelectedIds([]);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      <DialogContent className="max-w-4xl max-h-[90vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Settings2 className="h-5 w-5" />
            Manage Shift Templates
          </DialogTitle>
          <DialogDescription>
            Manage reusable shift definitions. Search, import, export, or bulk delete templates.
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-hidden flex flex-col space-y-4 pt-2">
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
                    {selectedIds.length > 0 && (
                        <Button variant="destructive" size="sm" onClick={handleDeleteSelected}>
                            <Trash2 className="h-4 w-4 mr-2" /> Delete ({selectedIds.length})
                        </Button>
                    )}
                    <Button variant="outline" size="sm" onClick={() => setIsTemplateImporterOpen(true)}>
                        <Upload className="h-4 w-4 mr-2" /> Import
                    </Button>
                    <Button variant="outline" size="sm" onClick={handleExportTemplates}>
                        <Download className="h-4 w-4 mr-2" /> Export
                    </Button>
                </div>
            </div>

            <div className="flex items-center gap-2 px-1 text-sm font-medium">
                <Checkbox 
                    id="select-all"
                    checked={filteredTemplates.length > 0 && selectedIds.length === filteredTemplates.length}
                    onCheckedChange={(checked) => toggleSelectAll(!!checked)}
                />
                <label htmlFor="select-all" className="cursor-pointer">Select All Visible</label>
            </div>

            <ScrollArea className="flex-1 border rounded-md p-4">
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {filteredTemplates.map(tpl => (
                    <Card key={tpl.id} className="relative group overflow-hidden">
                    <div className="absolute top-0 left-0 w-1 h-full" style={{ backgroundColor: tpl.color === 'default' ? 'hsl(var(--primary))' : tpl.color }} />
                    <CardContent className="p-4">
                        <div className="flex justify-between items-start mb-2">
                        <div className="flex items-start gap-2">
                            <Checkbox 
                                checked={selectedIds.includes(tpl.id)}
                                onCheckedChange={() => toggleSelect(tpl.id)}
                                className="mt-1"
                            />
                            <div>
                                <h4 className="font-bold text-sm leading-none mb-1">{tpl.label}</h4>
                                <p className="text-xs text-muted-foreground">{tpl.startTime} - {tpl.endTime}</p>
                            </div>
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
                        <div className="flex items-center gap-2 mt-4 ml-6">
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
        </div>
      </DialogContent>

      <TemplateImporter 
        isOpen={isTemplateImporterOpen}
        setIsOpen={setIsTemplateImporterOpen}
        onImport={(tpls) => {
          setShiftTemplates(prev => [...prev, ...tpls]);
          setIsTemplateImporterOpen(false);
        }}
      />
    </Dialog>
  );
}
