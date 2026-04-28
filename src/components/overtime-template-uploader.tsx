'use client';

import React, { useState } from 'react';
import { Button } from './ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from './ui/dialog';
import { Input } from './ui/input';
import { useToast } from '@/hooks/use-toast';
import { Label } from './ui/label';
import { Loader2 } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from './ui/alert';

type OvertimeTemplateUploaderProps = {
  isOpen: boolean;
  setIsOpen: (isOpen: boolean) => void;
  onTemplateUpload: (templateData: string) => void;
};

export function OvertimeTemplateUploader({ isOpen, setIsOpen, onTemplateUpload }: OvertimeTemplateUploaderProps) {
  const [file, setFile] = useState<File | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const { toast } = useToast();

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    if (event.target.files) {
      setFile(event.target.files[0]);
    }
  };

  const handleUpload = () => {
    if (!file) {
      toast({ title: 'No file selected', description: 'Please select an XLSX file to upload.', variant: 'destructive' });
      return;
    }
    setIsUploading(true);

    const reader = new FileReader();

    reader.onload = (e) => {
        try {
            const data = e.target?.result as ArrayBuffer;
            if (!data) {
                throw new Error("Failed to read file data.");
            }
            
            // Convert ArrayBuffer to Base64 string for robust storage
            const base64String = btoa(
                new Uint8Array(data).reduce(
                    (data, byte) => data + String.fromCharCode(byte),
                    ''
                )
            );

            onTemplateUpload(base64String);
            toast({ title: 'Template Uploaded', description: 'The new Overtime/ND template has been saved.' });
            setIsOpen(false);
        } catch (error) {
            console.error(error);
            toast({ title: 'Upload Failed', description: (error as Error).message, variant: 'destructive' });
        } finally {
            setIsUploading(false);
            setFile(null);
        }
    };
    
    reader.onerror = (error) => {
        console.error(error);
        toast({ title: 'File Read Error', description: 'Could not read the selected file.', variant: 'destructive' });
    };
    
    reader.readAsArrayBuffer(file);
  };

  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Upload Overtime/ND Template</DialogTitle>
           <DialogDescription>
            Upload your formatted .xlsx file. The system will find and replace placeholders to fill in the data.
          </DialogDescription>
        </DialogHeader>
        <Alert>
            <AlertTitle>Template Instructions</AlertTitle>
            <AlertDescription>
                <ul className="list-disc pl-5 text-xs space-y-1 mt-2">
                    <li><b>Global Placeholders:</b> These can be used anywhere in the sheet for the person generating the report.
                        <ul className="list-disc pl-5">
                            <li>`{{employee_name}}` - The current user's full name.</li>
                            <li>`{{group}}` - The current user's group name.</li>
                            <li>`{{employee_signature}}` - The current user's digital signature image.</li>
                            <li>`{{current_date}}` - The date the report was generated.</li>
                        </ul>
                    </li>
                    <li><b>Row Placeholders:</b> Create one row in your template that contains these placeholders. The system will duplicate this row for each OT or ND entry.
                        <ul className="list-disc pl-5">
                            <li>`{{SURNAME}}`</li>
                            <li>`{{EMPLOYEE NAME}}`</li>
                            <li>`{{TYPE}}` - (OT or ND)</li>
                            <li>`{{PERSONNEL NUMBER}}`</li>
                            <li>`{{TYPE CODE}}`</li>
                            <li>`{{START TIME}}`</li>
                            <li>`{{END TIME}}`</li>
                            <li>`{{START DATE}}`</li>
                            <li>`{{END DATE}}`</li>
                            <li>`{{TOTAL HOURS}}`</li>
                            <li>`{{REASONS/REMARKS}}`</li>
                        </ul>
                    </li>
                </ul>
            </AlertDescription>
        </Alert>

        <div className="grid gap-4 py-4">
            <Label htmlFor="template-file">XLSX Template File</Label>
            <Input id="template-file" type="file" onChange={handleFileChange} accept=".xlsx" />
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => setIsOpen(false)}>Cancel</Button>
          <Button onClick={handleUpload} disabled={isUploading || !file}>
            {isUploading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Upload Template
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
