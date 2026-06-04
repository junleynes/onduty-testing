
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
import type { Employee, TardyRecord } from '@/types';
import { findEmployeeByName, getFullName } from '@/lib/utils';
import { isDate } from 'date-fns';

type TardyImporterProps = {
  isOpen: boolean;
  setIsOpen: (isOpen: boolean) => void;
  onImport: (importedData: TardyRecord[]) => void;
  employees: Employee[];
};

export function TardyImporter({ isOpen, setIsOpen, onImport, employees }: TardyImporterProps) {
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
          
          const requiredHeaders = ['EMPLOYEE', 'DATE', 'SCHEDULE', 'IN/OUT', 'REMARKS'];
          const headers = results.meta.fields?.map(h => h.toUpperCase()) || [];
          const missingHeaders = requiredHeaders.filter(h => !headers.includes(h));

          if (missingHeaders.length > 0) {
            throw new Error(`Missing required columns in CSV: ${missingHeaders.join(', ')}`);
          }

          const importedData: TardyRecord[] = [];
          
          results.data.forEach((row: any) => {
            const employeeName = row['EMPLOYEE'] || row['employee'];
            const employee = findEmployeeByName(employeeName, employees);
            if (!employee) {
                console.warn(`Employee "${employeeName}" not found. Skipping row.`);
                return;
            }
            
            const dateValue = new Date(row['DATE'] || row['date']);
            if (!isDate(dateValue)) {
                 console.warn(`Invalid date for employee "${employeeName}". Skipping row.`);
                return;
            }

            const inOut = (row['IN/OUT'] || row['in/out'] || '').split('-');
            
            importedData.push({
                employeeId: employee.id,
                employeeName: getFullName(employee),
                date: dateValue,
                schedule: row['SCHEDULE'] || row['schedule'] || '',
                timeIn: inOut[0]?.trim() || '',
                timeOut: inOut[1]?.trim() || '',
                remarks: row['REMARKS'] || row['remarks'] || '',
            });
          });
          
          if (importedData.length === 0) {
              throw new Error("No valid data could be parsed. Check employee names and date formats.");
          }

          onImport(importedData);
          toast({ title: "Import Successful", description: `${importedData.length} tardy records imported.` });
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
          <DialogTitle>Import Tardy Data from CSV</DialogTitle>
          <DialogDescription>
            Upload a CSV with headers: EMPLOYEE, DATE, SCHEDULE, IN/OUT, REMARKS.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 py-4">
            <Label htmlFor="tardy-file">CSV File</Label>
            <Input id="tardy-file" type="file" onChange={handleFileChange} accept=".csv" />
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => setIsOpen(false)}>Cancel</Button>
          <Button onClick={handleImport} disabled={isImporting || !file}>
            {isImporting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Import Data
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
