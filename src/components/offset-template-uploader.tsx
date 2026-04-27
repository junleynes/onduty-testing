
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
import { Loader2, Info } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from './ui/alert';

type OffsetTemplateUploaderProps = {
  isOpen: boolean;
  setIsOpen: (isOpen: boolean) => void;
  onTemplateUpload: (templateData: string) => void;
};

export function OffsetTemplateUploader({ isOpen, setIsOpen, onTemplateUpload }: OffsetTemplateUploaderProps) {
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
      toast({ title: 'No file selected', description: 'Please select a PDF file to upload.', variant: 'destructive' });
      return;
    }
    setIsUploading(true);

    const reader = new FileReader();

    reader.onload = (e) => {
        try {
            const data = e.target?.result as ArrayBuffer;
            if (!data) throw new Error("Failed to read file data.");
            
            const base64String = btoa(new Uint8Array(data).reduce((data, byte) => data + String.fromCharCode(byte), ''));

            onTemplateUpload(base64String);
            toast({ title: 'Template Uploaded', description: 'The new Offset template has been saved.' });
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
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>Upload Offset Request Template</DialogTitle>
           <DialogDescription>
            Upload your Offset Request Form in PDF format.
          </DialogDescription>
        </DialogHeader>
        <Alert variant="destructive" className="bg-destructive/10">
            <Info className="h-4 w-4" />
            <AlertTitle className="font-bold">Digital Signature Requirement</AlertTitle>
            <AlertDescription>
                <p className="text-xs mt-2">To display digital signatures, your PDF <b>MUST</b> use <b>Button fields</b> (Push Buttons) as placeholders. Standard "Signature" fields will not work.</p>
                <p className="text-xs mt-2 font-semibold underline">Required Field Names (Fuzzy matched):</p>
                <ul className="list-disc pl-5 text-xs space-y-1 mt-2">
                    <li><b>Signatures (Buttons):</b> <code>employee_signature</code>, <code>manager_signature</code></li>
                    <li><b>Basic Details:</b> <code>employee_name</code>, <code>date_filed</code>, <code>department</code></li>
                    <li><b>Request Details:</b> <code>offset_dates</code>, <code>total_days</code>, <code>reason</code></li>
                    <li><b>Claimed Work Ext:</b> <code>work_extension_date</code>, <code>work_extension_hours</code></li>
                </ul>
            </AlertDescription>
        </Alert>

        <div className="grid gap-4 py-4">
            <Label htmlFor="offset-template-file">PDF Template File</Label>
            <Input id="offset-template-file" type="file" onChange={handleFileChange} accept=".pdf" />
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
