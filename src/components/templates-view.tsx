'use client';

import React, { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Upload, FileText, Settings2, CalendarDays } from 'lucide-react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { AlafTemplateUploader } from '@/components/alaf-template-uploader';
import { OffsetTemplateUploader } from '@/components/offset-template-uploader';
import { ReportTemplateUploader } from '@/components/report-template-uploader';
import { AttendanceTemplateUploader } from '@/components/attendance-template-uploader';
import { WfhCertificationTemplateUploader } from '@/components/wfh-certification-template-uploader';
import { WorkExtensionTemplateUploader } from '@/components/work-extension-template-uploader';
import { OvertimeTemplateUploader } from '@/components/overtime-template-uploader';
import { ShiftTemplateManager } from '@/components/shift-template-manager';
import { LeaveTypeEditor } from '@/components/leave-type-editor';
import { LeaveTypeImporter } from '@/components/leave-type-importer';
import { saveTemplate } from '@/app/actions';
import type { LeaveTypeOption } from '@/components/leave-type-editor';
import type { ShiftTemplate } from '@/components/shift-editor';

type TemplatesViewProps = {
  templates: Record<string, string | null>;
  setTemplates: React.Dispatch<React.SetStateAction<Record<string, string | null>>>;
  groups: string[];
  shiftTemplates: ShiftTemplate[];
  setShiftTemplates: React.Dispatch<React.SetStateAction<ShiftTemplate[]>>;
  leaveTypes: LeaveTypeOption[];
  setLeaveTypes: React.Dispatch<React.SetStateAction<LeaveTypeOption[]>>;
};

export default function TemplatesView({ templates, setTemplates, groups, shiftTemplates, setShiftTemplates, leaveTypes, setLeaveTypes }: TemplatesViewProps) {
  // PDF / Report template uploaders
  const [isAlafUploaderOpen, setIsAlafUploaderOpen] = useState(false);
  const [isOffsetUploaderOpen, setIsOffsetUploaderOpen] = useState(false);
  const [isWorkScheduleUploaderOpen, setIsWorkScheduleUploaderOpen] = useState(false);
  const [isAttendanceUploaderOpen, setIsAttendanceUploaderOpen] = useState(false);
  const [isWfhCertUploaderOpen, setIsWfhCertUploaderOpen] = useState(false);
  const [isWorkExtensionUploaderOpen, setIsWorkExtensionUploaderOpen] = useState(false);
  const [isOvertimeUploaderOpen, setIsOvertimeUploaderOpen] = useState(false);

  // Shift templates (group-scoped)
  const [isShiftTemplateManagerOpen, setIsShiftTemplateManagerOpen] = useState(false);
  const [selectedShiftGroup, setSelectedShiftGroup] = useState<string | null>(groups[0] ?? null);

  // Leave types (group-scoped)
  const [isLeaveTypeEditorOpen, setIsLeaveTypeEditorOpen] = useState(false);
  const [isLeaveTypeImporterOpen, setIsLeaveTypeImporterOpen] = useState(false);
  const [selectedLeaveGroup, setSelectedLeaveGroup] = useState<string | null>(groups[0] ?? null);

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
      {/* ── Shift Templates (group-scoped) ──────────────────────────── */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Settings2 className="h-5 w-5" />Shift Templates
          </CardTitle>
          <CardDescription>
            Manage shift templates per group. Select a group to view and edit its templates.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap items-center gap-3">
          <Select value={selectedShiftGroup ?? '__none__'} onValueChange={v => setSelectedShiftGroup(v === '__none__' ? null : v)}>
            <SelectTrigger className="w-[200px]">
              <SelectValue placeholder="Select group…" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__none__">— No group —</SelectItem>
              {groups.map(g => <SelectItem key={g} value={g}>{g}</SelectItem>)}
            </SelectContent>
          </Select>
          <Button variant="outline" onClick={() => setIsShiftTemplateManagerOpen(true)}>
            <Settings2 className="mr-2 h-4 w-4" />
            Manage Templates{selectedShiftGroup ? ` (${selectedShiftGroup})` : ''}
          </Button>
        </CardContent>
      </Card>

      {/* ── Leave Types (group-scoped) ───────────────────────────────── */}
      <Card className="mt-6">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <CalendarDays className="h-5 w-5" />Leave Types
          </CardTitle>
          <CardDescription>
            Configure leave types per group. Select a group to view and edit its leave types.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap items-center gap-3">
          <Select value={selectedLeaveGroup ?? '__none__'} onValueChange={v => setSelectedLeaveGroup(v === '__none__' ? null : v)}>
            <SelectTrigger className="w-[200px]">
              <SelectValue placeholder="Select group…" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__none__">— No group —</SelectItem>
              {groups.map(g => <SelectItem key={g} value={g}>{g}</SelectItem>)}
            </SelectContent>
          </Select>
          <Button variant="outline" onClick={() => setIsLeaveTypeEditorOpen(true)}>
            <CalendarDays className="mr-2 h-4 w-4" />
            Manage Leave Types{selectedLeaveGroup ? ` (${selectedLeaveGroup})` : ''}
          </Button>
        </CardContent>
      </Card>

      {/* ── PDF Leave Templates ─────────────────────────────────────── */}
      <Card className="mt-6">
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
      <ShiftTemplateManager
        isOpen={isShiftTemplateManagerOpen}
        setIsOpen={setIsShiftTemplateManagerOpen}
        shiftTemplates={shiftTemplates}
        setShiftTemplates={setShiftTemplates}
        currentGroup={selectedShiftGroup}
      />
      <LeaveTypeEditor
        isOpen={isLeaveTypeEditorOpen}
        setIsOpen={setIsLeaveTypeEditorOpen}
        leaveTypes={leaveTypes}
        setLeaveTypes={setLeaveTypes}
        onImport={() => setIsLeaveTypeImporterOpen(true)}
        currentGroup={selectedLeaveGroup}
      />
      <LeaveTypeImporter
        isOpen={isLeaveTypeImporterOpen}
        setIsOpen={setIsLeaveTypeImporterOpen}
        onImport={(newTypes) => {
          setLeaveTypes(prev => {
            const existing = new Set(prev.filter(lt => lt.groupName === (selectedLeaveGroup ?? null)).map(lt => lt.type));
            const tagged = newTypes.filter(lt => !existing.has(lt.type)).map(lt => ({ ...lt, groupName: selectedLeaveGroup ?? null }));
            return [...prev, ...tagged];
          });
          setIsLeaveTypeImporterOpen(false);
        }}
      />
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
