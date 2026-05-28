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
import type { Employee, UserRole } from '@/types';

type MemberImporterProps = {
  isOpen: boolean;
  setIsOpen: (isOpen: boolean) => void;
  onImport: (newMembers: Partial<Employee>[]) => Promise<void>;
  employees: Employee[];
};

export function MemberImporter({ isOpen, setIsOpen, onImport, employees }: MemberImporterProps) {
  const [file, setFile] = useState<File | null>(null);
  const [isImporting, setIsImporting] = useState(false);
  const { toast } = useToast();

  const handleClose = () => {
    if (isImporting) return;
    setFile(null);
    setIsOpen(false);
  };

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    if (event.target.files) setFile(event.target.files[0]);
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
      complete: async (results) => {
        try {
          if (results.errors.length) {
            throw new Error(`Error parsing CSV on row ${results.errors[0].row}: ${results.errors[0].message}`);
          }

          const requiredHeaders = ['First Name', 'Last Name', 'Email'];
          const headers = results.meta.fields || [];
          const missingHeaders = requiredHeaders.filter(h => !headers.includes(h));
          if (missingHeaders.length > 0) {
            throw new Error(`Missing required columns: ${missingHeaders.join(', ')}`);
          }

          const newMembers: Partial<Employee>[] = results.data.map((row: any) => {
            const parseDate = (dateStr: string) => {
              if (!dateStr) return undefined;
              const date = new Date(dateStr);
              return isNaN(date.getTime()) ? undefined : date;
            };
            const role = (row['Role']?.toLowerCase() || 'member') as UserRole;
            const loadAllocationValue = parseFloat(row['Load Allocation']);
            return {
              firstName: row['First Name'] || '',
              lastName: row['Last Name'] || '',
              middleInitial: row['M.I.'] || '',
              position: row['Position'] || '',
              birthDate: parseDate(row['Birth Date']),
              startDate: parseDate(row['Start Date']),
              lastPromotionDate: parseDate(row['Last Promotion Date']),
              group: row['Group'] || '',
              email: row['Email'] || '',
              phone: row['Phone'] || '',
              employeeNumber: row['ID Number'] || '',
              personnelNumber: row['Employee Number'] || '',
              // Password optional — addEmployee generates a secure random one if omitted
              password: row['Password'] || undefined,
              role: ['admin', 'manager', 'member'].includes(role) ? role : 'member',
              loadAllocation: !isNaN(loadAllocationValue) ? loadAllocationValue : 0,
              visibility: {
                schedule: (row['Show in Schedule'] || 'true').toLowerCase() === 'true',
                onDuty: (row['Show in On Duty'] || 'true').toLowerCase() === 'true',
                orgChart: (row['Show in Org Chart'] || 'true').toLowerCase() === 'true',
                mobileLoad: (row['Show in Mobile Load'] || 'true').toLowerCase() === 'true',
              },
              reportsTo: row['Reports To'] || null,
              gender: row['Gender'] as 'Male' | 'Female' | undefined,
              employeeClassification: row['Employee Classification'] as 'Rank-and-File' | 'Confidential' | 'Managerial' | undefined,
            };
          });

          // Await so dialog only closes after all employees are processed
          await onImport(newMembers);
          setFile(null);
          setIsOpen(false);

        } catch (error) {
          toast({ title: 'Import Failed', description: (error as Error).message, variant: 'destructive' });
        } finally {
          setIsImporting(false);
        }
      },
      error: (error) => {
        toast({ title: 'Import Failed', description: error.message, variant: 'destructive' });
        setIsImporting(false);
      },
    });
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => { if (!open) handleClose(); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Import Members from CSV</DialogTitle>
          <DialogDescription>
            Required columns: First Name, Last Name, Email. Password is optional — a secure random password is assigned if omitted (employee resets via Forgot Password).
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 py-4">
          <Label htmlFor="member-file">CSV File</Label>
          <Input id="member-file" type="file" onChange={handleFileChange} accept=".csv" disabled={isImporting} />
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={handleClose} disabled={isImporting}>
            Cancel
          </Button>
          <Button onClick={handleImport} disabled={isImporting || !file}>
            {isImporting ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Importing...</> : 'Import Members'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
