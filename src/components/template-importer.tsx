
'use client';

import React, { useState } from 'react';
import Papa from 'papaparse';
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
import { useToast } from '@/hooks/use-toast';
import { Label } from './ui/label';
import { Loader2 } from 'lucide-react';
import type { ShiftTemplate } from '@/components/shift-editor';

const normalizeTime = (t: string): string => {
  if (!t) return '';
  const [h, m] = t.split(':').map(Number);
  return `${String(h).padStart(2, '0')}:${String(isNaN(m) ? 0 : m).padStart(2, '0')}`;
};

const shiftColorMap: { [key: string]: string } = {
  'default': 'default',
  'orange': 'hsl(var(--chart-4))',
  'red': 'hsl(var(--chart-1))',
  'blue': '#3498db',
  'green': 'hsl(var(--chart-2))',
  'purple': '#9b59b6',
  'pink': '#e91e63',
  'white': '#ffffff',
  'yellow': '#f1c40f',
  'dark grayish blue': '#6b7280',
};

type TemplateImporterProps = {
  isOpen: boolean;
  setIsOpen: (isOpen: boolean) => void;
  onImport: (newTemplates: ShiftTemplate[]) => void;
};

export function TemplateImporter({ isOpen, setIsOpen, onImport }: TemplateImporterProps) {
  const [file, setFile] = useState<File | null>(null);
  const [isImporting, setIsImporting] = useState(false);
  const { toast } = useToast();

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    if (event.target.files) {
      setFile(event.target.files[0]);
    }
  };

  const handleImport = () => {
    if (!file) {
      toast({ title: 'No file selected', variant: 'destructive' });
      return;
    }
    setIsImporting(true);

    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      complete: (results) => {
        try {
          if (results.errors.length) {
            throw new Error(`Error parsing CSV: ${results.errors[0].message}`);
          }
          
          const requiredHeaders = ['Shift Label', 'Start Time', 'End Time', 'Shift Color'];
          const headers = results.meta.fields || [];
          const missingHeaders = requiredHeaders.filter(h => !headers.includes(h));

          if (missingHeaders.length > 0) {
            throw new Error(`Missing required columns: ${missingHeaders.join(', ')}`);
          }

          const newTemplates: ShiftTemplate[] = results.data.map((row: any) => {
            const rawColor = (row['Shift Color'] || '').trim().toLowerCase();
            let colorValue = shiftColorMap['default'];
            
            if (rawColor.startsWith('#') || rawColor.startsWith('hsl')) {
                colorValue = (row['Shift Color'] || '').trim();
            } else if (shiftColorMap[rawColor]) {
                colorValue = shiftColorMap[rawColor];
            }

            const isUnpaidValue = (row['Is Unpaid Break'] || 'false').toLowerCase();
            const isUnpaidBreak = ['true', '1'].includes(isUnpaidValue);

            // Use group from CSV if present, otherwise fall back to null
            // (handles CSVs exported before Group Name column was added)
            const groupName = row['Group Name']?.trim() || null;

            return {
              id: uuidv4(),
              label: row['Shift Label'] || '',
              startTime: normalizeTime(row['Start Time'] || ''),
              endTime: normalizeTime(row['End Time'] || ''),
              color: colorValue,
              name: `${row['Shift Label']} (${row['Start Time']}-${row['End Time']})`,
              breakStartTime: normalizeTime(row['Break Start'] || ''),
              breakEndTime: normalizeTime(row['Break End'] || ''),
              isUnpaidBreak: isUnpaidBreak,
              groupName,
            };
          });

          onImport(newTemplates);
          toast({ title: 'Import Successful', description: `${newTemplates.length} templates imported.`})
          setIsOpen(false);
        } catch (error: any) {
          toast({ title: 'Import Failed', description: error.message, variant: 'destructive' });
        } finally {
          setIsImporting(false);
          setFile(null);
        }
      }
    });
  };

  const uuidv4 = () => 'tpl-' + Math.random().toString(36).substr(2, 9);

  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Import Shift Templates</DialogTitle>
          <DialogDescription>
            Upload a CSV with headers: Shift Label, Start Time, End Time, Shift Color, Break Start, Break End, Is Unpaid Break.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 py-4">
            <Label htmlFor="template-file">CSV File</Label>
            <Input id="template-file" type="file" onChange={handleFileChange} accept=".csv" />
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => setIsOpen(false)}>Cancel</Button>
          <Button onClick={handleImport} disabled={isImporting || !file}>
            {isImporting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Import Templates
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
