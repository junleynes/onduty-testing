'use client';

import React, { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Upload, FileText } from 'lucide-react';
import { AlafTemplateUploader } from '@/components/alaf-template-uploader';
import { OffsetTemplateUploader } from '@/components/offset-template-uploader';
import { ReportTemplateUploader } from '@/components/report-template-uploader';
import { AttendanceTemplateUploader } from '@/components/attendance-template-uploader';
import { WfhCertificationTemplateUploader } from '@/components/wfh-certification-template-uploader';
import { WorkExtensionTemplateUploader } from '@/components/work-extension-template-uploader';
import { OvertimeTemplateUploader } from '@/components/overtime-template-uploader';
import { saveTemplate } from '@/app/actions';

type TemplatesViewProps = {
  templates: Record<string, string | null>;
  setTemplates: React.Dispatch<React.SetStateAction<Record<string, string | null>>>;
};

export default function TemplatesView({ templates, setTemplates }: TemplatesViewProps) {
  const [isAlafUploaderOpen, setIsAlafUploaderOpen] = useState(false);
  const [isOffsetUploaderOpen, setIsOffsetUploaderOpen] = useState(false);
  const [isWorkScheduleUploaderOpen, setIsWorkScheduleUploaderOpen] = useState(false);
  const [isAttendanceUploaderOpen, setIsAttendanceUploaderOpen] = useState(false);
  const [isWfhCertUploaderOpen, setIsWfhCertUploaderOpen] = useState(false);
  const [isWorkExtensionUploaderOpen, setIsWorkExtensionUploaderOpen] = useState(false);
  const [isOvertimeUploaderOpen, setIsOvertimeUploaderOpen] = useState(false);

  const handleSave = (key: string, data: string) => {
    setTemplates(prev => ({ ...prev, [key]: data }));
    saveTemplate(key, data).catch(() => {});
  };

  const templateStatus = (key: string) =>
    templates[key] ? (
      <span className="text-xs text-green-600 font-medium ml-2">✓ Uploaded</span>
    ) : (
      <span className="text-xs text-muted-foreground ml-2">Not set</span>
    );

  return (
    <>
      {/* ── PDF Leave Templates ─────────────────────────────────────── */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FileText className="h-5 w-5" />PDF Leave Templates
          </CardTitle>
          <CardDescription>
            Upload the PDF templates used for leave (ALAF) and offset/work-extension forms.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-3">
          <div className="flex items-center">
            <Button variant="outline" onClick={() => setIsAlafUploaderOpen(true)}>
              <Upload className="mr-2 h-4 w-4" />ALAF / Leave Template
            </Button>
            {templateStatus('alafTemplate')}
          </div>
          <div className="flex items-center">
            <Button variant="outline" onClick={() => setIsOffsetUploaderOpen(true)}>
              <Upload className="mr-2 h-4 w-4" />Offset / WE Template
            </Button>
            {templateStatus('offsetTemplate')}
          </div>
        </CardContent>
      </Card>

      {/* ── Report Templates ────────────────────────────────────────── */}
      <Card className="mt-6">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FileText className="h-5 w-5" />Report Templates
          </CardTitle>
          <CardDescription>
            Upload the Excel templates used for generating reports.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-3">
          <div className="flex items-center">
            <Button variant="outline" onClick={() => setIsWorkScheduleUploaderOpen(true)}>
              <Upload className="mr-2 h-4 w-4" />Work Schedule
            </Button>
            {templateStatus('workScheduleTemplate')}
          </div>
          <div className="flex items-center">
            <Button variant="outline" onClick={() => setIsAttendanceUploaderOpen(true)}>
              <Upload className="mr-2 h-4 w-4" />Attendance Sheet
            </Button>
            {templateStatus('attendanceSheetTemplate')}
          </div>
          <div className="flex items-center">
            <Button variant="outline" onClick={() => setIsWorkExtensionUploaderOpen(true)}>
              <Upload className="mr-2 h-4 w-4" />Work Extension
            </Button>
            {templateStatus('workExtensionTemplate')}
          </div>
          <div className="flex items-center">
            <Button variant="outline" onClick={() => setIsWfhCertUploaderOpen(true)}>
              <Upload className="mr-2 h-4 w-4" />WFH Certification
            </Button>
            {templateStatus('wfhCertificationTemplate')}
          </div>
          <div className="flex items-center">
            <Button variant="outline" onClick={() => setIsOvertimeUploaderOpen(true)}>
              <Upload className="mr-2 h-4 w-4" />Overtime
            </Button>
            {templateStatus('overtimeTemplate')}
          </div>
        </CardContent>
      </Card>

      {/* ── Dialogs ──────────────────────────────────────────────────── */}
      <AlafTemplateUploader
        isOpen={isAlafUploaderOpen}
        setIsOpen={setIsAlafUploaderOpen}
        onTemplateUpload={(data) => handleSave('alafTemplate', data)}
      />
      <OffsetTemplateUploader
        isOpen={isOffsetUploaderOpen}
        setIsOpen={setIsOffsetUploaderOpen}
        onTemplateUpload={(data) => handleSave('offsetTemplate', data)}
      />
      <ReportTemplateUploader
        isOpen={isWorkScheduleUploaderOpen}
        setIsOpen={setIsWorkScheduleUploaderOpen}
        onTemplateUpload={(data) => handleSave('workScheduleTemplate', data)}
      />
      <AttendanceTemplateUploader
        isOpen={isAttendanceUploaderOpen}
        setIsOpen={setIsAttendanceUploaderOpen}
        onTemplateUpload={(data) => handleSave('attendanceSheetTemplate', data)}
      />
      <WorkExtensionTemplateUploader
        isOpen={isWorkExtensionUploaderOpen}
        setIsOpen={setIsWorkExtensionUploaderOpen}
        onTemplateUpload={(data) => handleSave('workExtensionTemplate', data)}
      />
      <WfhCertificationTemplateUploader
        isOpen={isWfhCertUploaderOpen}
        setIsOpen={setIsWfhCertUploaderOpen}
        onTemplateUpload={(data) => handleSave('wfhCertificationTemplate', data)}
      />
      <OvertimeTemplateUploader
        isOpen={isOvertimeUploaderOpen}
        setIsOpen={setIsOvertimeUploaderOpen}
        onTemplateUpload={(data) => handleSave('overtimeTemplate', data)}
      />
    </>
  );
}
