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


const shiftColorMap: { [key: string]: string } = {
  default: 'default',
  orange: 'hsl(var(--chart-4))',
  red: 'hsl(var(--chart-1))',
  blue: '#3498db',
  green: 'hsl(var(--chart-2))',
  purple: '#9b59b6',
  pink: '#e91e63',
  white: '#ffffff',
  yellow: '#f1c40f',
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
      toast({ title: 'No file selected', description: 'Please select a CSV file to import.', variant: 'destructive' });
      return;
    }
    setIsImporting(true);

    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      complete: (results) => {
        try {
          if (results.errors.length) {
            console.error("CSV parsing errors:", results.errors);
            throw new Error(`Error parsing CSV on row ${results.errors[0].row}: ${results.errors[0].message}`);
          }
          
          const requiredHeaders = ['Shift Label', 'Start Time', 'End Time', 'Shift Color'];
          const headers = results.meta.fields || [];
          const missingHeaders = requiredHeaders.filter(h => !headers.includes(h));

          if (missingHeaders.length > 0) {
            throw new Error(`Missing required columns in CSV: ${missingHeaders.join(', ')}`);
          }

          const newTemplates: ShiftTemplate[] = results.data.map((row: any) => {
            const rawColor = (row['Shift Color'] || '').trim();
            const lowerColor = rawColor.toLowerCase();
            
            // Logic to handle colors:
            // 1. If it starts with # or hsl, use it as is (raw value)
            // 2. If it's a known color name (e.g., "red"), use the map
            // 3. Fallback to default
            let colorValue = shiftColorMap['default'];
            
            if (rawColor.startsWith('#') || rawColor.startsWith('hsl')) {
                colorValue = rawColor;
            } else if (shiftColorMap[lowerColor]) {
                colorValue = shiftColorMap[lowerColor];
            }

            const isUnpaidValue = (row['Is Unpaid Break'] || 'false').toLowerCase();
            const isUnpaidBreak = ['true', '1'].includes(isUnpaidValue);

            return {
              id: row['id'] || `tpl-${Math.random().toString(36).substr(2, 9)}`,
              label: row['Shift Label'] || '',
              startTime: row['Start Time'] || '',
              endTime: row['End Time'] || '',
              color: colorValue,
              name: row['name'] || `${row['Shift Label']} (${row['Start Time']}-${row['End Time']})`,
              breakStartTime: row['Break Start'] || '',
              breakEndTime: row['Break End'] || '',
              isUnpaidBreak: isUnpaidBreak,
            };
          });

          onImport(newTemplates);
          toast({ title: 'Import Successful', description: `${newTemplates.length} templates imported.`})
          setIsOpen(false);

        } catch (error) {
          console.error("Import failed:", error);
          toast({ title: 'Import Failed', description: (error as Error).message, variant: 'destructive' });
        } finally {
          setIsImporting(false);
          setFile(null);
        }
      },
      error: (error) => {
        toast({ title: 'Import Failed', description: error.message, variant: 'destructive' });
        setIsImporting(false);
      }
    });
  };

  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Import Shift Templates from CSV</DialogTitle>
          <DialogDescription>
            Upload a CSV file with template data. Required headers: Shift Label, Start Time, End Time, Shift Color. Optional headers: Break Start, Break End, Is Unpaid Break.
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
