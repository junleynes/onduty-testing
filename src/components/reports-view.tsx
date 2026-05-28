'use client';

import React, { useEffect, useState, useMemo, useTransition } from 'react';
import type { Employee, Shift, Leave, Holiday, TardyRecord, RolePermissions, SmtpSettings, NavItemKey } from '@/types';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from './ui/button';
import { Download, Upload, Calendar as CalendarIcon, Eye, Settings, Send, Loader2 } from 'lucide-react';
import { DateRange } from 'react-day-picker';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Calendar } from '@/components/ui/calendar';
import { cn, getFullName, getInitialState } from '@/lib/utils';
import { format, eachDayOfInterval, isSameDay, getDate, startOfWeek, endOfWeek, parse, isWithinInterval, startOfMonth, endOfMonth, addMonths, getMonth, startOfDay, differenceInMinutes, set, addDays, endOfDay } from 'date-fns';
import { ReportTemplateUploader } from './report-template-uploader';
import { AttendanceTemplateUploader } from './attendance-template-uploader';
import { WfhCertificationTemplateUploader } from './wfh-certification-template-uploader';
import * as ExcelJS from 'exceljs';
import { saveAs } from 'file-saver';
import { useToast } from '@/hooks/use-toast';
import type { ShiftTemplate } from './shift-editor';
import { ReportPreviewDialog } from './report-preview-dialog';
import { TardyImporter } from './tardy-importer';
import { WorkExtensionTemplateUploader } from './work-extension-template-uploader';
import type { LeaveTypeOption } from './leave-type-editor';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';
import { Dialog, DialogHeader, DialogTitle, DialogDescription, DialogFooter, DialogContent } from './ui/dialog';
import { Label } from './ui/label';
import { Input } from './ui/input';
import { Checkbox } from './ui/checkbox';
import { OvertimeTemplateUploader } from './overtime-template-uploader';
import { sendEmail, saveTemplate } from '@/app/actions';
import { Textarea } from './ui/textarea';

const tryParseExcelNumber = (val: any) => {
    if (typeof val !== 'string') return val;
    const trimmed = val.trim();
    if (trimmed === '') return val;
    if (/^-?\d*\.?\d+$/.test(trimmed)) {
        const num = Number(trimmed);
        if (!isNaN(num)) return num;
    }
    return val;
};

type ReportsViewProps = {
    employees: Employee[];
    shifts: Shift[];
    leave: Leave[];
    holidays: Holiday[];
    currentUser: Employee;
    tardyRecords: TardyRecord[];
    setTardyRecords: React.Dispatch<React.SetStateAction<TardyRecord[]>>;
    templates: Record<string, string | null>;
    setTemplates: React.Dispatch<React.SetStateAction<Record<string, string | null>>>;
    shiftTemplates: ShiftTemplate[];
    leaveTypes: LeaveTypeOption[];
    permissions: RolePermissions;
    smtpSettings: SmtpSettings;
}

type ReportType = 'workSchedule' | 'attendance' | 'userSummary' | 'tardy' | 'wfh' | 'workExtension' | 'overtime';

type ReportData = {
    headers: string[];
    rows: (string | number)[][];
};

type WorkScheduleRowData = {
    employee_name: string;
    date: string;
    day_status: string;
    schedule_start: string;
    schedule_end: string;
    unpaidbreak_start: string;
    unpaidbreak_end: string;
    paidbreak_start: string;
    paidbreak_end: string;
};

type WfhCertRowData = {
    DATE: string;
    ATTENDANCE_RENDERED: string;
    TOTAL_HRS_SPENT: string | number;
    REMARKS: string;
}

type WorkExtensionRowData = {
    employee_name: string;
    work_sched_date: string;
    start_time: string;
    end_time: string;
    date_of_work_extended: string;
    extended_start_time: string;
    extended_end_time: string;
    total_hours_extended: string | number;
    reason: string;
};

type OvertimeRowData = {
    SURNAME: string;
    'EMPLOYEE NAME': string;
    TYPE: 'OT' | 'ND';
    'PERSONNEL NUMBER': string;
    'TYPE CODE': string;
    'START TIME': string;
    'END TIME': string;
    'START DATE': string;
    'END DATE': string;
    'TOTAL HOURS': string | number;
    'REASONS/REMARKS': string;
}


const ALL_CLASSIFICATIONS = ['Rank-and-File', 'Confidential', 'Managerial'];

export default function ReportsView({ employees, shifts, leave, holidays, currentUser, tardyRecords, setTardyRecords, templates, setTemplates, shiftTemplates, leaveTypes, permissions, smtpSettings }: ReportsViewProps) {
    const { toast } = useToast();
    const [selectedReportType, setSelectedReportType] = useState<ReportType>('workSchedule');
    
    const [workScheduleDateRange, setWorkScheduleDateRange] = useState<DateRange | undefined>();
    const [attendanceWeek, setAttendanceWeek] = useState<Date | undefined>();
    const [summaryDateRange, setSummaryDateRange] = useState<DateRange | undefined>();
    const [tardyDateRange, setTardyDateRange] = useState<DateRange | undefined>();
    const [wfhCertMonth, setWfhCertMonth] = useState<Date | undefined>();
    const [workExtensionWeek, setWorkExtensionWeek] = useState<Date | undefined>();
    const [workExtensionRange, setWorkExtensionRange] = useState<DateRange | undefined>();
    const [workExtensionSelectionMode, setWorkExtensionSelectionMode] = useState<'week' | 'range'>('week');
    const [overtimeDateRange, setOvertimeDateRange] = useState<DateRange | undefined>();

    const [ndStartTime, setNdStartTime] = useState<string>('20:00');
    const [ndEndTime, setNdEndTime] = useState<string>('06:00');
    const [ndClassifications, setNdClassifications] = useState<string[]>(['Rank-and-File']);
    const [otTypeCode, setOtTypeCode] = useState<string>('801');
    const [ndTypeCode, setNdTypeCode] = useState<string>('803');

    useEffect(() => {
      setNdStartTime(getInitialState('ndStartTime', '20:00'));
      setNdEndTime(getInitialState('ndEndTime', '06:00'));
      setNdClassifications(getInitialState('ndClassifications', ['Rank-and-File']));
      setOtTypeCode(getInitialState('otTypeCode', '801'));
      setNdTypeCode(getInitialState('ndTypeCode', '803'));
    }, []);

    const [isWorkScheduleUploaderOpen, setIsWorkScheduleUploaderOpen] = useState(false);
    const [isAttendanceUploaderOpen, setIsAttendanceUploaderOpen] = useState(false);
    const [isWfhCertUploaderOpen, setIsWfhCertUploaderOpen] = useState(false);
    const [isTardyImporterOpen, setIsTardyImporterOpen] = useState(false);
    const [isWorkExtensionUploaderOpen, setIsWorkExtensionUploaderOpen] = useState(false);
    const [isOvertimeUploaderOpen, setIsOvertimeUploaderOpen] = useState(false);
    const [isOvertimeSettingsOpen, setIsOvertimeSettingsOpen] = useState(false);
    const [isPreviewOpen, setIsPreviewOpen] = useState(false);
    const [isEmailDialogOpen, setIsEmailDialogOpen] = useState(false);
    
    const [previewData, setPreviewData] = useState<ReportData | null>(null);
    const [reportGenerator, setReportGenerator] = useState<(() => Promise<void>) | null>(null);
    const [reportTitle, setReportTitle] = useState('');
    const [emailGenerator, setEmailGenerator] = useState<(() => Promise<Buffer | null>) | null>(null);


    const userPermissions = permissions[currentUser.role] || [];


    const attendanceDateRange = useMemo(() => {
        if (!attendanceWeek) return undefined;
        const start = startOfWeek(attendanceWeek, { weekStartsOn: 1 });
        const end = endOfWeek(attendanceWeek, { weekStartsOn: 1 });
        return { from: start, to: end };
    }, [attendanceWeek]);

    const workExtensionDateRange = useMemo(() => {
        if (workExtensionSelectionMode === 'week') {
            if (!workExtensionWeek) return undefined;
            const start = startOfWeek(workExtensionWeek, { weekStartsOn: 1 });
            const end = endOfWeek(workExtensionWeek, { weekStartsOn: 1 });
            return { from: start, to: end };
        }
        return workExtensionRange;
    }, [workExtensionWeek, workExtensionRange, workExtensionSelectionMode]);

    const wfhCertDateRange = useMemo(() => {
        if (!wfhCertMonth) return undefined;
        const start = startOfMonth(wfhCertMonth);
        const end = endOfMonth(wfhCertMonth);
        return { from: start, to: end };
    }, [wfhCertMonth]);

    const getScheduleFromTemplate = (template: ShiftTemplate | undefined) => {
        if (!template) {
             return { schedule_start: '', schedule_end: '', unpaidbreak_start: '', unpaidbreak_end: '', paidbreak_start: '', paidbreak_end: '' };
        }
        return {
            schedule_start: template.startTime,
            schedule_end: template.endTime,
            unpaidbreak_start: template.isUnpaidBreak ? template.breakStartTime || '' : '',
            unpaidbreak_end: template.isUnpaidBreak ? template.breakEndTime || '' : '',
            paidbreak_start: !template.isUnpaidBreak ? template.breakStartTime || '' : '',
            paidbreak_end: !template.isUnpaidBreak ? template.breakEndTime || '' : '',
        };
    };
    
    const getDefaultShiftTemplate = (employee: Employee): ShiftTemplate | undefined => {
        const empShifts = shifts.filter(s => s.employeeId === employee.id && !s.isDayOff && !s.isHolidayOff);
        
        if (empShifts.length > 0) {
            // Find the most frequent shift pattern used by this employee
            const counts = empShifts.reduce((acc, s) => {
                const key = `${s.startTime}-${s.endTime}`;
                acc[key] = (acc[key] || 0) + 1;
                return acc;
            }, {} as Record<string, number>);
            
            const mostFrequentKey = Object.keys(counts).reduce((a, b) => counts[a] > counts[b] ? a : b);
            const [start, end] = mostFrequentKey.split('-');
            
            // Try to find a template that matches these times
            const matchedTemplate = shiftTemplates.find(t => t.startTime === start && t.endTime === end);
            if (matchedTemplate) return matchedTemplate;
        }

        // Fallback: Use position-based guessing if no shifts found
        const isMgr = employee.role === 'manager' || employee.role === 'admin';
        const preferredName = isMgr ? "manager shift" : "mid shift";
        const preferred = shiftTemplates.find(t => t.name.toLowerCase().includes(preferredName));
        
        return preferred || shiftTemplates[0];
    };

    const findDataForDay = (day: Date, employee: Employee) => {
        const normalizedDay = startOfDay(day);
        const shiftOnDay = shifts.find(s => s.employeeId === employee.id && isSameDay(new Date(s.date), normalizedDay));
        const holidayOnDay = holidays.find(h => isSameDay(new Date(h.date), normalizedDay));
        const leaveOnDay = leave.find(l => {
            if (l.employeeId !== employee.id) return false;
            if (l.status !== 'approved' && l.status !== 'processed') return false;
            if (l.type === 'Work Extension') return false; 
            const leaveStart = l.startDate ? startOfDay(new Date(l.startDate)) : null;
            const leaveEnd = l.endDate ? startOfDay(new Date(l.endDate)) : null;
            if (!leaveStart || !leaveEnd) return false;
            return isWithinInterval(normalizedDay, { start: leaveStart, end: leaveEnd });
        });

        return { shift: shiftOnDay, leave: leaveOnDay, holiday: holidayOnDay };
    };


    const generateWorkScheduleData = (): WorkScheduleRowData[] | null => {
         if (!workScheduleDateRange || !workScheduleDateRange.from || !workScheduleDateRange.to) {
            toast({ variant: 'destructive', title: 'No Date Range', description: 'Please select a covered period for the report.' });
            return null;
        }
        const groupEmployees = employees
            .filter(e => e.group === currentUser.group)
            .sort((a, b) => {
                const lastNameComp = a.lastName.localeCompare(b.lastName);
                if (lastNameComp !== 0) return lastNameComp;
                return a.firstName.localeCompare(b.firstName);
            });

        const daysInInterval = eachDayOfInterval({ start: workScheduleDateRange.from, end: workScheduleDateRange.to });

        const rows: WorkScheduleRowData[] = [];

        groupEmployees.forEach((employee) => {
            daysInInterval.forEach(day => {
                const dayData = findDataForDay(day, employee);
                const defaultTemplate = getDefaultShiftTemplate(employee);
                const templateSched = getScheduleFromTemplate(defaultTemplate);

                let schedule_start = '';
                let schedule_end = '';
                let unpaidbreak_start = '';
                let unpaidbreak_end = '';
                let paidbreak_start = '';
                let paidbreak_end = '';
                let day_status = '';

                if (dayData.shift && !dayData.shift.isDayOff && !dayData.shift.isHolidayOff) {
                    const label = dayData.shift.label?.toUpperCase() || '';
                    if (label === 'WFH' || label === 'WORK FROM HOME') {
                        day_status = 'WFH';
                    }
                    schedule_start = dayData.shift.startTime;
                    schedule_end = dayData.shift.endTime;
                    unpaidbreak_start = dayData.shift.isUnpaidBreak ? dayData.shift.breakStartTime || '' : '';
                    unpaidbreak_end = dayData.shift.isUnpaidBreak ? dayData.shift.breakEndTime || '' : '';
                    paidbreak_start = !dayData.shift.isUnpaidBreak ? dayData.shift.breakStartTime || '' : '';
                    paidbreak_end = !dayData.shift.isUnpaidBreak ? dayData.shift.breakEndTime || '' : '';
                } else if (dayData.holiday || dayData.shift?.isHolidayOff) {
                    day_status = ''; // Blank for holidays
                    schedule_start = templateSched.schedule_start;
                    schedule_end = templateSched.schedule_end;
                    unpaidbreak_start = templateSched.unpaidbreak_start;
                    unpaidbreak_end = templateSched.unpaidbreak_end;
                    paidbreak_start = templateSched.paidbreak_start;
                    paidbreak_end = templateSched.paidbreak_end;
                } else if (dayData.leave) {
                    day_status = ''; 
                    schedule_start = templateSched.schedule_start;
                    schedule_end = templateSched.schedule_end;
                    unpaidbreak_start = templateSched.unpaidbreak_start;
                    unpaidbreak_end = templateSched.unpaidbreak_end;
                    paidbreak_start = templateSched.paidbreak_start;
                    paidbreak_end = templateSched.paidbreak_end;
                } else {
                    day_status = 'FREE';
                    schedule_start = '';
                    schedule_end = '';
                    unpaidbreak_start = '';
                    unpaidbreak_end = '';
                    paidbreak_start = '';
                    paidbreak_end = '';
                }

                rows.push({
                    employee_name: `${employee.lastName}, ${employee.firstName} ${employee.middleInitial || ''}`.toUpperCase(),
                    date: format(day, 'MM/dd/yyyy'),
                    day_status,
                    schedule_start,
                    schedule_end,
                    unpaidbreak_start,
                    unpaidbreak_end,
                    paidbreak_start,
                    paidbreak_end
                });
            });
        });
        
        return rows;
    };
    
    const generateWorkSchedulePreviewData = (data: WorkScheduleRowData[] | null): ReportData | null => {
        if (!data) return null;
        const headers = ['Employee Name', 'Date', 'Day Status', 'Schedule Start', 'Schedule End', 'Unpaid Break Start', 'Unpaid Break End', 'Paid Break Start', 'Paid Break End'];
        const rows = data.map(d => [
            d.employee_name,
            d.date,
            d.day_status,
            d.schedule_start,
            d.schedule_end,
            d.unpaidbreak_start,
            d.unpaidbreak_end,
            d.paidbreak_start,
            d.paidbreak_end,
        ]);
        return { headers, rows };
    }
    
    const generateWorkScheduleBuffer = async (data: WorkScheduleRowData[] | null): Promise<Buffer | null> => {
        if (!data) {
            toast({ variant: 'destructive', title: 'Data Missing', description: 'Could not generate data for the report.' });
            return null;
        }
        const workScheduleTemplate = templates.workScheduleTemplate;
        if (!workScheduleTemplate) {
            toast({ variant: 'destructive', title: 'No Template', description: 'Please upload a work schedule template first.' });
            return null;
        }
        if (!workScheduleDateRange || !workScheduleDateRange.from || !workScheduleDateRange.to) {
            toast({ variant: 'destructive', title: 'No Date Range', description: 'Please select a covered period for the report.' });
            return null;
        }
        
        try {
            const workbook = new ExcelJS.Workbook();
            const buffer = Buffer.from(workScheduleTemplate, 'base64');
            await workbook.xlsx.load(buffer);
            const worksheet = workbook.worksheets[0];
            if (!worksheet) throw new Error("Template worksheet not found.");

            worksheet.eachRow({ includeEmpty: true }, (row) => {
                row.eachCell({ includeEmpty: true }, (cell) => {
                    if (cell.value && typeof cell.value === 'string') {
                        let cellText = cell.value;
                        cellText = cellText.replace(/{{start_date}}/g, format(workScheduleDateRange.from!, 'MM/dd/yyyy'));
                        cellText = cellText.replace(/{{end_date}}/g, format(workScheduleDateRange.to!, 'MM/dd/yyyy'));
                        cell.value = cellText;
                    }
                });
            });

            let templateRowNumber = -1;
            worksheet.eachRow({ includeEmpty: true }, (row, rowNum) => {
                 row.eachCell({ includeEmpty: true }, (cell) => {
                    if (typeof cell.value === 'string' && cell.value.includes('{{employee_name}}')) {
                       templateRowNumber = rowNum;
                    }
                 });
            });
            
            if (templateRowNumber === -1) {
                throw new Error("No template row with `{{employee_name}}` placeholder found in the template.");
            }
            
            const templateRow = worksheet.getRow(templateRowNumber);
            const templateStyles = new Map<number, Partial<ExcelJS.Style>>();
            templateRow.eachCell({ includeEmpty: true }, (cell, colNumber) => {
                templateStyles.set(colNumber, { ...cell.style });
            });
            
            const placeholderMap: { [key: string]: keyof WorkScheduleRowData } = {
                '{{employee_name}}': 'employee_name',
                '{{date}}': 'date',
                '{{day_status}}': 'day_status',
                '{{schedule_start}}': 'schedule_start',
                '{{schedule_end}}': 'schedule_end',
                '{{unpaidbreak_start}}': 'unpaidbreak_start',
                '{{unpaidbreak_end}}': 'unpaidbreak_end',
                '{{paidbreak_start}}': 'paidbreak_start',
                '{{paidbreak_end}}': 'paidbreak_end',
            };
            
            const sortedData = [...data].sort((a,b) => {
                const nameComp = a.employee_name.localeCompare(b.employee_name);
                if (nameComp !== 0) return nameComp;
                return new Date(a.date).getTime() - new Date(b.date).getTime();
            });

            sortedData.forEach((rowData, index) => {
                const newRow = worksheet.insertRow(templateRowNumber + index + 1, {});
                templateRow.eachCell({ includeEmpty: true }, (templateCell, colNumber) => {
                    const newCell = newRow.getCell(colNumber);
                    let templateValue = templateCell.text;

                    for (const placeholder in placeholderMap) {
                        if (templateValue.includes(placeholder)) {
                            templateValue = templateValue.replace(placeholder, rowData[placeholderMap[placeholder as keyof typeof placeholderMap]]);
                        }
                    }
                    
                    newCell.value = tryParseExcelNumber(templateValue);
                    newCell.style = templateStyles.get(colNumber) || {};
                });
            });
            
            worksheet.spliceRows(templateRowNumber, 1);

            const fileBuffer = await workbook.xlsx.writeBuffer();
            return Buffer.from(fileBuffer);

        } catch (error) {
            console.error("Error generating report:", error);
            toast({ variant: 'destructive', title: 'Report Generation Failed', description: (error as Error).message });
            return null;
        }
    };
    
    const handleDownloadWorkSchedule = async () => {
        const buffer = await generateWorkScheduleBuffer(generateWorkScheduleData());
        if (buffer) {
            const blob = new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
            saveAs(blob, `Regular Work Schedule - ${format(workScheduleDateRange!.from!, 'MM-dd-yyyy')} to ${format(workScheduleDateRange!.to!, 'MM-dd-yyyy')}.xlsx`);
        }
    }
    
    const generateAttendanceSheetData = (): ReportData | null => {
        if (!attendanceDateRange || !attendanceDateRange.from || !attendanceDateRange.to) {
            toast({ variant: 'destructive', title: 'No Date Range', description: 'Please select a week for the attendance sheet.' });
            return null;
        }

        const groupEmployees = employees.filter(e => e.group === currentUser.group);
        const displayedDays = eachDayOfInterval({ start: attendanceDateRange.from, end: attendanceDateRange.to });

        const headers = ['Employee Name', 'Group', 'Position', ...displayedDays.map(d => format(d, 'EEE, MMM d'))];
        const rows: (string|number)[][] = [];

        groupEmployees.forEach(employee => {
            const row: (string|number)[] = [
                `${employee.lastName}, ${employee.firstName} ${employee.middleInitial || ''}`.toUpperCase(),
                employee.group || '',
                employee.position || ''
            ];
            
            displayedDays.forEach(day => {
                const dayData = findDataForDay(day, employee);
                let scheduleCode = '';

                // Hierarchy: Leave (includes VL, SL, SL-D, OFFSET) > Working Shifts (SKE, SKE-10, WFH) > Holidays > OFF
                if (dayData.leave) {
                    scheduleCode = dayData.leave.type.toUpperCase();
                } else if (dayData.shift && !dayData.shift.isDayOff && !dayData.shift.isHolidayOff) {
                    const label = dayData.shift.label?.toUpperCase() || '';
                    if (label === 'WFH' || label === 'WORK FROM HOME') {
                        scheduleCode = 'WFH';
                    } else if (label.includes('10H')) {
                        scheduleCode = 'SKE-10';
                    } else {
                        scheduleCode = 'SKE';
                    }
                } else if (dayData.holiday || dayData.shift?.isHolidayOff) {
                    scheduleCode = 'HOL OFF';
                } else {
                    scheduleCode = 'OFF';
                }
                
                row.push(scheduleCode);
            });
            rows.push(row);
        });
        
        return { headers, rows };
    };
    
    const generateAttendanceSheetBuffer = async(data: ReportData | null): Promise<Buffer | null> => {
        if (!data) {
            toast({ variant: 'destructive', title: 'Data Missing', description: 'Could not generate data for the report.' });
            return null;
        }
        const attendanceTemplate = templates.attendanceSheetTemplate;
        if (!attendanceTemplate) {
            toast({ variant: 'destructive', title: 'No Template', description: 'Please upload an attendance sheet template first.' });
            return null;
        }
         if (!attendanceDateRange || !attendanceDateRange.from || !attendanceDateRange.to) {
            toast({ variant: 'destructive', title: 'No Date Range', description: 'Please select a date range for the attendance sheet.' });
            return null;
        }
        
        try {
            const workbook = new ExcelJS.Workbook();
            const buffer = Buffer.from(attendanceTemplate, 'base64');
            await workbook.xlsx.load(buffer);

            const worksheet = workbook.worksheets[0];
            if (!worksheet) throw new Error("Template worksheet not found.");

            const displayedDays = eachDayOfInterval({ start: attendanceDateRange.from, end: attendanceDateRange.to });

            worksheet.eachRow((row) => {
                row.eachCell((cell) => {
                    if (cell.value && typeof cell.value === 'string') {
                        let cellText = cell.value;
                        if (cellText.includes('{{month}}')) {
                            cell.value = cellText.replace('{{month}}', format(attendanceDateRange.from!, 'MMMM').toUpperCase());
                        }
                        if (cellText.includes('{{group}}')) {
                            cell.value = cellText.replace('{{group}}', currentUser.group || '');
                        }
                        for (let i = 0; i < 7 && i < displayedDays.length; i++) {
                            if (cellText.includes(`{{day_${i + 1}}}`) && displayedDays[i]) {
                                cell.value = tryParseExcelNumber(cellText.replace(`{{day_${i + 1}}}`, String(getDate(displayedDays[i]))));
                            }
                        }
                    }
                });
            });

            for (let i = 0; i < data.rows.length; i++) {
                const employeeDataRow = data.rows[i]; 
                const employeeIndex = i + 1; 

                worksheet.eachRow((row) => {
                    row.eachCell((cell) => {
                        if (cell.value && typeof cell.value === 'string') {
                            let cellText = cell.value;

                            if (cellText.includes(`{{employee_${employeeIndex}}}`)) {
                                cell.value = cellText.replace(`{{employee_${employeeIndex}}}`, String(employeeDataRow[0]));
                            }
                             if (cellText.includes(`{{group_${employeeIndex}}}`)) {
                                cell.value = cellText.replace(`{{group_${employeeIndex}}}`, String(employeeDataRow[1]));
                            }
                            if (cellText.includes(`{{position_${employeeIndex}}}`)) {
                                cell.value = cellText.replace(`{{position_${employeeIndex}}}`, String(employeeDataRow[2]));
                            }

                            for (let dayIndex = 0; dayIndex < 7; dayIndex++) {
                                if (cellText.includes(`{{schedule_${employeeIndex}_${dayIndex + 1}}}`)) {
                                    const scheduleCode = String(employeeDataRow[3 + dayIndex]);
                                    cell.value = tryParseExcelNumber(cellText.replace(`{{schedule_${employeeIndex}_${dayIndex + 1}}}`, scheduleCode));
                                }
                            }
                        }
                    });
                });
            }

            const fileBuffer = await workbook.xlsx.writeBuffer();
            return Buffer.from(fileBuffer);

        } catch (error) {
            console.error("Error generating Excel from template:", error);
            toast({ variant: 'destructive', title: 'Template Error', description: (error as Error).message });
            return null;
        }
    }

    const handleDownloadAttendanceSheet = async () => {
        const buffer = await generateAttendanceSheetBuffer(generateAttendanceSheetData());
        if (buffer) {
            const blob = new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
            saveAs(blob, `${currentUser?.group} Attendance Sheet - ${format(attendanceDateRange!.from!, 'yyyy-MM-dd')} to ${format(attendanceDateRange!.to!, 'yyyy-MM-dd')}.xlsx`);
        }
    };
    
    const generateUserSummaryData = (): ReportData | null => {
        if (!summaryDateRange || !summaryDateRange.from || !summaryDateRange.to) {
            toast({ variant: 'destructive', title: 'No Date Range', description: 'Please select a covered period for the summary.' });
            return null;
        }

        const groupEmployees = employees.filter(e => e.group === currentUser.group);
        const leaveTypeStrings = leaveTypes.map(lt => lt.type);
        const headers = ['Employee Name', 'Total Shifts', 'Total Hours', ...leaveTypeStrings];
        const rows: (string | number)[][] = [];
        
        const daysInInterval = eachDayOfInterval({ start: summaryDateRange.from, end: summaryDateRange.to });

        groupEmployees.forEach(employee => {
            const shiftsInRange = shifts.filter(s => 
                s.employeeId === employee.id &&
                !s.isDayOff && 
                !s.isHolidayOff &&
                daysInInterval.some(day => isSameDay(day, new Date(s.date)))
            );
            
            const leaveInRange = leave.filter(l => 
                l.employeeId === employee.id &&
                (l.status === 'approved' || l.status === 'processed') &&
                l.startDate && l.endDate &&
                isWithinInterval(startOfDay(new Date(l.startDate)), { start: summaryDateRange.from!, end: summaryDateRange.to! })
            );

            const totalHours = shiftsInRange.reduce((acc, shift) => {
                if (!shift.startTime || !shift.endTime) return acc;
                const shiftDate = new Date(shift.date);
                const start = parse(shift.startTime, 'HH:mm', shiftDate);
                let end = parse(shift.endTime, 'HH:mm', shiftDate);
                if (end < start) end = addDays(end, 1);
                let diff = (end.getTime() - start.getTime()) / (1000 * 60 * 60);

                let breakHours = 0;
                if (shift.isUnpaidBreak && shift.breakStartTime && shift.breakEndTime) {
                    const breakStart = parse(shift.breakStartTime, 'HH:mm', shiftDate);
                    let breakEnd = parse(shift.breakEndTime, 'HH:mm', shiftDate);
                    if (!isNaN(breakStart.getTime()) && !isNaN(breakEnd.getTime())) {
                      if (breakEnd < breakStart) breakEnd = addDays(breakEnd, 1);
                      let breakDiff = (breakEnd.getTime() - breakStart.getTime()) / (1000 * 60 * 60);
                      breakHours = breakDiff;
                    }
                }
                
                return acc + (diff - breakHours);
            }, 0);
            
            const leaveCounts = leaveTypeStrings.map(type => 
                leaveInRange.filter(l => l.type === type).length
            );
            
            rows.push([
                `${employee.lastName}, ${employee.firstName} ${employee.middleInitial || ''}`.toUpperCase(),
                shiftsInRange.length,
                Number(totalHours.toFixed(2)),
                ...leaveCounts
            ]);
        });

        const totals = new Array(headers.length - 1).fill(0);
        rows.forEach(row => {
            for (let i = 1; i < row.length; i++) {
                totals[i - 1] += Number(row[i]) || 0;
            }
        });

        const totalRow: (string | number)[] = ['TOTAL', ...totals.map((t, i) => i === 1 ? Number(t.toFixed(2)) : t)];
        rows.push(totalRow);
        
        return { headers, rows };
    };
    
    const generateUserSummaryBuffer = async(data: ReportData | null): Promise<Buffer | null> => {
        if (!data) return null;

        const workbook = new ExcelJS.Workbook();
        const worksheet = workbook.addWorksheet('User Summary');

        worksheet.columns = data.headers.map(header => ({
            header: header,
            key: header.toLowerCase().replace(/ /g, '_'),
            width: header === 'Employee Name' ? 30 : 15
        }));
        
        worksheet.addRows(data.rows.map(row => row.map(cell => tryParseExcelNumber(cell))));
        
        const headerRow = worksheet.getRow(1);
        headerRow.font = { bold: true };

        const lastRow = worksheet.getRow(data.rows.length + 1);
        lastRow.font = { bold: true };

        const fileBuffer = await workbook.xlsx.writeBuffer();
        return Buffer.from(fileBuffer);
    }

    const handleDownloadUserSummary = async () => {
        const buffer = await generateUserSummaryBuffer(generateUserSummaryData());
        if(buffer) {
            const blob = new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
            saveAs(blob, `User Summary - ${format(summaryDateRange!.from!, 'yyyy-MM-dd')} to ${format(summaryDateRange!.to!, 'yyyy-MM-dd')}.xlsx`);
        }
    };

    const generateTardyReportData = (): ReportData | null => {
        if (!tardyDateRange || !tardyDateRange.from || !tardyDateRange.to) {
             toast({ variant: 'destructive', title: 'No Date Range', description: 'Please select a covered period for the summary.' });
            return null;
        }

        const tardyLeave = leave
            .filter(l => l.type === 'TARDY' && (l.status === 'approved' || l.status === 'processed') && l.startDate && isWithinInterval(startOfDay(new Date(l.startDate)), {start: tardyDateRange.from!, end: tardyDateRange.to!}))
            .map(l => {
                const employee = employees.find(e => e.id === l.employeeId);
                const shift = shifts.find(s => s.employeeId === l.employeeId && l.startDate && isSameDay(new Date(s.date), new Date(l.startDate)));
                return {
                    employeeId: l.employeeId,
                    employeeName: employee ? getFullName(employee) : 'Unknown',
                    date: new Date(l.startDate!),
                    schedule: shift ? `${shift.startTime}-${shift.endTime}` : 'N/A',
                    timeIn: l.startTime || '',
                    timeOut: l.endTime || '',
                    remarks: l.reason || 'Applied via App'
                };
            });
        
        const filteredImportedRecords = tardyRecords.filter(r => 
            isWithinInterval(startOfDay(new Date(r.date)), {start: tardyDateRange.from!, end: tardyDateRange.to!})
        );
        
        const combinedRecords = [...filteredImportedRecords];
        const importedKeys = new Set(filteredImportedRecords.map(r => `${r.employeeId}-${format(new Date(r.date), 'yyyy-MM-dd')}`));
        
        tardyLeave.forEach(l => {
            if (!l.employeeId) return;
            const key = `${l.employeeId}-${format(new Date(l.date), 'yyyy-MM-dd')}`;
            if (!importedKeys.has(key)) {
                combinedRecords.push(l);
            }
        });

        combinedRecords.sort((a,b) => new Date(a.date).getTime() - new Date(b.date).getTime() || a.employeeName.localeCompare(b.employeeName));

        const headers = ['Employee', 'Date', 'Schedule', 'In/Out', 'Remarks'];
        const rows = combinedRecords.map(r => [
            r.employeeName,
            format(new Date(r.date), 'MM/dd/yyyy'),
            r.schedule,
            r.timeIn && r.timeOut ? `${r.timeIn}-${r.timeOut}` : '',
            r.remarks
        ]);

        return { headers, rows };
    };
    
    const generateTardyReportBuffer = async (data: ReportData | null): Promise<Buffer | null> => {
        if (!data) return null;
        const workbook = new ExcelJS.Workbook();
        const worksheet = workbook.addWorksheet('Cumulative Tardy Report');

        worksheet.columns = data.headers.map(header => ({
            header: header,
            key: header.toLowerCase().replace(/ /g, '_'),
            width: header === 'Employee' ? 30 : header === 'Remarks' ? 40 : 20,
        }));
        
        worksheet.addRows(data.rows.map(row => row.map(cell => tryParseExcelNumber(cell))));
        
        const headerRow = worksheet.getRow(1);
        headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' } };
        headerRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF000000' } };


        const fileBuffer = await workbook.xlsx.writeBuffer();
        return Buffer.from(fileBuffer);
    };

    const handleDownloadTardyReport = async () => {
        const buffer = await generateTardyReportBuffer(generateTardyReportData());
        if(buffer) {
            const blob = new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
            saveAs(blob, `Cumulative Tardy Report - ${format(tardyDateRange!.from!, 'yyyy-MM-dd')} to ${format(tardyDateRange!.to!, 'yyyy-MM-dd')}.xlsx`);
        }
    };
    
    const generateWfhCertificationData = (): WfhCertRowData[] | null => {
        if (!wfhCertDateRange || !wfhCertDateRange.from || !wfhCertDateRange.to) {
            toast({ variant: 'destructive', title: 'No Date Range', description: 'Please select a month for the report.' });
            return null;
        }

        const daysInInterval = eachDayOfInterval({ start: wfhCertDateRange.from, end: wfhCertDateRange.to })
            .filter(day => getMonth(day) === getMonth(wfhCertDateRange.from!));
            
        const rows: WfhCertRowData[] = [];
    
        daysInInterval.forEach(day => {
            const dayData = findDataForDay(day, currentUser);
    
            let attendanceRendered = '';
            let totalHrs: string | number = '';
            let remarks = '';
            let includeRow = true;
    
            if (dayData.leave) {
                attendanceRendered = 'ON LEAVE';
                remarks = dayData.leave.type.toUpperCase();
            } else if (dayData.shift) {
                const shiftLabel = dayData.shift.label?.trim().toUpperCase();
                attendanceRendered = (shiftLabel === 'WORK FROM HOME' || shiftLabel === 'WFH') ? 'WFH' : 'OFFICE-BASED';
                
                if (dayData.shift.startTime && dayData.shift.endTime) {
                     const start = parse(dayData.shift.startTime, 'HH:mm', day);
                    let end = parse(dayData.shift.endTime, 'HH:mm', day);
                    if (end < start) end = addDays(end, 1);
                    let diff = (end.getTime() - start.getTime()) / (1000 * 60 * 60);

                    let breakHours = 0;
                    if (dayData.shift.isUnpaidBreak && dayData.shift.breakStartTime && dayData.shift.breakEndTime) {
                        const breakStart = parse(dayData.shift.breakStartTime, 'HH:mm', day);
                        let breakEnd = parse(dayData.shift.breakEndTime, 'HH:mm', day);
                        if (!isNaN(breakStart.getTime()) && !isNaN(breakEnd.getTime())) {
                            if (breakEnd < breakStart) breakEnd = addDays(breakEnd, 1);
                            let breakDiff = (breakEnd.getTime() - breakStart.getTime()) / (1000 * 60 * 60);
                            breakHours = breakDiff; 
                        }
                    }
                    totalHrs = Number((diff - breakHours).toFixed(2));
                }
            } else {
                includeRow = false; 
            }
            
            // Exclude non-working days (FREE or HOL OFF) from WFH certification listing
            if (dayData.shift?.isDayOff || dayData.shift?.isHolidayOff || dayData.holiday) {
                includeRow = false;
            }

            if (includeRow) {
                rows.push({
                    DATE: format(day, 'MMMM d, yyyy'),
                    ATTENDANCE_RENDERED: attendanceRendered,
                    TOTAL_HRS_SPENT: totalHrs,
                    REMARKS: remarks
                });
            }
        });
        
        return rows.sort((a, b) => new Date(a.DATE).getTime() - new Date(b.DATE).getTime());
    };
    
    const generateWfhCertificationBuffer = async (data: WfhCertRowData[] | null): Promise<Buffer | null> => {
         if (!data) return null;
        const wfhCertTemplate = templates.wfhCertificationTemplate;
        if (!wfhCertTemplate) {
            toast({ variant: 'destructive', title: 'No Template', description: 'Please upload a WFH Certification template first.' });
            return null;
        }
        if (!wfhCertDateRange || !wfhCertDateRange.from) {
            toast({ variant: 'destructive', title: 'No Date Range', description: 'Please select a month.' });
            return null;
        }
    
        try {
            const workbook = new ExcelJS.Workbook();
            const buffer = Buffer.from(wfhCertTemplate, 'base64');
            await workbook.xlsx.load(buffer);
            const worksheet = workbook.worksheets[0];
            if (!worksheet) throw new Error("Template worksheet not found.");
    
            const manager = employees.find(e => e.id === currentUser.reportsTo);
    
            worksheet.eachRow({ includeEmpty: true }, (row) => {
                row.eachCell({ includeEmpty: true }, (cell) => {
                    const replacePlaceholders = (text: string) => {
                        if (!text) return text;
                        let newText = text;
                        newText = newText.replace(/{{first_day_of_month}}/g, format(startOfMonth(wfhCertDateRange.from!), 'MMMM d, yyyy'));
                        newText = newText.replace(/{{last_day_of_month}}/g, format(endOfMonth(wfhCertDateRange.from!), 'MMMM d, yyyy'));
                        newText = newText.replace(/{{employee_name}}/g, getFullName(currentUser));
                        newText = newText.replace(/{{reports_to_manager}}/g, manager ? getFullName(manager) : 'N/A');
                        return newText;
                    }
                    if (cell.value && typeof cell.value === 'string') {
                        cell.value = tryParseExcelNumber(replacePlaceholders(cell.value));
                    } else if (cell.value && typeof cell.value === 'object' && 'richText' in cell.value) {
                        const richText = cell.value as ExcelJS.RichText;
                        richText.richText = richText.richText.map(rt => ({...rt, text: replacePlaceholders(rt.text)}));
                        cell.value = richText;
                    }
                });
            });
    
            let templateRowNumber = -1;
            let templateRow;
            worksheet.eachRow((row, rowNum) => {
                if (templateRowNumber !== -1) return;
                row.eachCell((cell) => {
                     const checkCell = (v: any) => {
                        if (v && typeof v === 'object' && v.richText) {
                            return v.richText.some((rt: any) => typeof rt.text === 'string' && rt.text.includes('{{DATE}}'));
                        }
                        if (v && typeof v === 'string') {
                            return v.includes('{{DATE}}');
                        }
                        return false;
                    }

                    if (checkCell(cell.value)) {
                        templateRowNumber = rowNum;
                        templateRow = row;
                    }
                });
            });

            if (templateRowNumber === -1 || !templateRow) {
                throw new Error("Template row with placeholder `{{DATE}}` not found.");
            }
            
            const placeholderMap: { [key: string]: number } = {};
            templateRow.eachCell({ includeEmpty: true }, (cell, colNumber) => {
                const cellText = cell.text;
                if (cellText.includes('{{DATE}}')) placeholderMap['DATE'] = colNumber;
                if (cellText.includes('{{ATTENDANCE_RENDERED}}')) placeholderMap['ATTENDANCE_RENDERED'] = colNumber;
                if (cellText.includes('{{TOTAL_HRS_SPENT}}')) placeholderMap['TOTAL_HRS_SPENT'] = colNumber;
                if (cellText.includes('{{REMARKS}}')) placeholderMap['REMARKS'] = colNumber;
            });
            
            data.forEach((rowData, index) => {
                const newRow = worksheet.insertRow(templateRowNumber + index + 1, {});
                 templateRow!.eachCell({ includeEmpty: true }, (templateCell, colNumber) => {
                    const newCell = newRow.getCell(colNumber);
                    newCell.style = { ...templateCell.style };
                });

                for (const key in placeholderMap) {
                    const dataKey = key as keyof WfhCertRowData;
                    const col = placeholderMap[dataKey];
                    newRow.getCell(col).value = tryParseExcelNumber(rowData[dataKey]);
                }
            });

            worksheet.spliceRows(templateRowNumber, 1);

            let sigRowNumber = -1;
            let sigColNumber = -1;
            worksheet.eachRow({ includeEmpty: true }, (row, rowNumber) => {
                row.eachCell((cell, colNumber) => {
                    const findAndClearPlaceholder = (text: string) => {
                        if (typeof text === 'string' && text.includes('{{employee_signature}}')) {
                            sigRowNumber = rowNumber;
                            sigColNumber = colNumber;
                            return text.replace('{{employee_signature}}', '');
                        }
                        return text;
                    }

                    if (typeof cell.value === 'string') {
                       cell.value = findAndClearPlaceholder(cell.value);
                    } else if (cell.value && typeof cell.value === 'object' && 'richText' in cell.value) {
                         const richText = cell.value as ExcelJS.RichText;
                         richText.richText = richText.richText.map(rt => ({...rt, text: findAndClearPlaceholder(rt.text)}));
                         cell.value = richText;
                    }
                });
            });
            
            const finalSigRow = sigRowNumber > -1 ? sigRowNumber - 1 : worksheet.lastRow ? worksheet.lastRow.number + 2 : data.length + 10;
            const finalSigCol = sigColNumber > -1 ? sigColNumber - 1 : 1;

            if (currentUser.signature) {
                const signatureImageId = workbook.addImage({
                    base64: currentUser.signature.split(',')[1],
                    extension: 'png',
                });
                worksheet.addImage(signatureImageId, {
                    tl: { col: finalSigCol, row: finalSigRow },
                    ext: { width: 100, height: 40 }
                });
            }
    
            const fileBuffer = await workbook.xlsx.writeBuffer();
            return Buffer.from(fileBuffer);
    
        } catch(error: any) {
            console.error("Error generating WFH cert:", error);
            toast({ variant: 'destructive', title: 'Report Generation Failed', description: error.message || "An unknown error occurred." });
            return null;
        }
    }

    const handleDownloadWfhCertification = async () => {
        const buffer = await generateWfhCertificationBuffer(generateWfhCertificationData());
        if(buffer) {
            const fileName = `${currentUser.lastName}, ${currentUser.firstName}${currentUser.middleInitial ? ` ${currentUser.middleInitial}` : ''}_${format(wfhCertDateRange!.from!, 'MMMM')}.xlsx`;
            const blob = new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
            saveAs(blob, fileName);
        }
    };
    
    const generateWorkExtensionData = (): WorkExtensionRowData[] | null => {
         if (!workExtensionDateRange || !workExtensionDateRange.from || !workExtensionDateRange.to) {
            toast({ variant: 'destructive', title: 'No Date Range', description: 'Please select a covered period for the report.' });
            return null;
        }

        const extensionRequests = leave.filter(l => 
            l.type === 'Work Extension' &&
            (l.status === 'approved' || l.status === 'processed') &&
            l.originalShiftDate &&
            isWithinInterval(startOfDay(new Date(l.originalShiftDate)), { start: workExtensionDateRange.from!, end: workExtensionDateRange.to! })
        );
        
        const data: WorkExtensionRowData[] = extensionRequests.map(req => {
            const employee = employees.find(e => e.id === req.employeeId);
            
            let totalHours: string | number = '0.00';
            if (req.startTime && req.endTime) {
                 const start = parse(req.startTime, 'HH:mm', new Date(req.startDate));
                 let end = parse(req.endTime, 'HH:mm', new Date(req.startDate));
                 if (end < start) {
                     end = addDays(end, 1);
                 }
                 let diff = (end.getTime() - start.getTime()) / (1000 * 60 * 60);
                 totalHours = Number(diff.toFixed(2));
            }

            return {
                employee_name: employee ? getFullName(employee) : 'Unknown',
                work_sched_date: req.originalShiftDate ? format(new Date(req.originalShiftDate), 'MM/dd/yyyy') : '',
                start_time: req.originalStartTime || '',
                end_time: req.originalEndTime || '',
                date_of_work_extended: req.startDate ? format(new Date(req.startDate), 'MM/dd/yyyy') : '',
                extended_start_time: req.startTime || '',
                extended_end_time: req.endTime || '',
                total_hours_extended: totalHours,
                reason: req.reason || ''
            };
        });

        return data.sort((a,b) => new Date(a.work_sched_date).getTime() - new Date(b.work_sched_date).getTime());
    }
    
    const generateWorkExtensionBuffer = async (data: WorkExtensionRowData[] | null): Promise<Buffer | null> => {
        if (!data) return null;
        const workExtensionTemplate = templates.workExtensionTemplate;
        if (!workExtensionTemplate) {
            toast({ variant: 'destructive', title: 'No Template', description: 'Please upload a Work Extension template first.' });
            return null;
        }

        try {
            const workbook = new ExcelJS.Workbook();
            const buffer = Buffer.from(workExtensionTemplate, 'base64');
            await workbook.xlsx.load(buffer);
            const worksheet = workbook.worksheets[0];
            if (!worksheet) throw new Error("Template worksheet not found.");
    
            let templateRowNumber = -1;
            worksheet.eachRow((row, rowNumber) => {
                if (templateRowNumber !== -1) return;
                row.eachCell((cell) => {
                    if (typeof cell.value === 'string' && cell.value.includes('{{employee_name}}')) {
                        templateRowNumber = rowNumber;
                    }
                });
            });
    
            if (templateRowNumber === -1) {
                throw new Error("Template row with `{{employee_name}}` found.");
            }
            
            const templateRow = worksheet.getRow(templateRowNumber);
            const templateCellValues = new Map<number, any>();
            const templateCellStyles = new Map<number, Partial<ExcelJS.Style>>();
            templateRow.eachCell({ includeEmpty: true }, (cell, colNumber) => {
                templateCellValues.set(colNumber, cell.value);
                templateCellStyles.set(colNumber, { ...cell.style });
            });
    
            data.forEach((rowData, index) => {
                const newRow = worksheet.insertRow(templateRowNumber + index + 1, {});
                templateCellValues.forEach((templateValue, colNumber) => {
                    let finalValue = templateValue;
                    if (typeof templateValue === 'string') {
                        finalValue = templateValue
                            .replace('{{employee_name}}', rowData.employee_name)
                            .replace('{{work_sched_date}}', rowData.work_sched_date)
                            .replace('{{start_time}}', rowData.start_time)
                            .replace('{{end_time}}', rowData.end_time)
                            .replace('{{date_of_work_extended}}', rowData.date_of_work_extended)
                            .replace('{{extended_start_time}}', rowData.extended_start_time)
                            .replace('{{extended_end_time}}', rowData.extended_end_time)
                            .replace('{{total_hours_extended}}', String(rowData.total_hours_extended))
                            .replace('{{reason}}', rowData.reason);
                    }
                    const cell = newRow.getCell(colNumber);
                    cell.value = tryParseExcelNumber(finalValue);
                    cell.style = templateCellStyles.get(colNumber) || {};
                });
            });

            worksheet.spliceRows(templateRowNumber, 1);
            
            const fileBuffer = await workbook.xlsx.writeBuffer();
            return Buffer.from(fileBuffer);

        } catch (error) {
            console.error("Error generating work extension report:", error);
            toast({ variant: 'destructive', title: 'Report Generation Failed', description: (error as Error).message });
            return null;
        }
    };

    const handleDownloadWorkExtension = async () => {
        const buffer = await generateWorkExtensionBuffer(generateWorkExtensionData());
        if(buffer) {
             const blob = new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
            saveAs(blob, `Work Extension Summary - ${format(workExtensionDateRange!.from!, 'yyyy-MM-dd')} to ${format(workExtensionDateRange!.to!, 'yyyy-MM-dd')}.xlsx`);
        }
    }
    
    const generateOvertimeData = (): OvertimeRowData[] | null => {
        if (!overtimeDateRange || !overtimeDateRange.from || !overtimeDateRange.to) {
            toast({ variant: 'destructive', title: 'No Date Range', description: 'Please select a covered period for the report.' });
            return null;
        }    const applicableEmployees = employees.filter(e => ndClassifications.includes(e.employeeClassification || ''));
        const data: OvertimeRowData[] = [];
        const daysInInterval = eachDayOfInterval({ start: overtimeDateRange.from, end: overtimeDateRange.to });
    
        applicableEmployees.forEach(employee => {
            daysInInterval.forEach(day => {
                const workExtensionsOnDay = leave.filter(l =>
                    l.employeeId === employee.id &&
                    l.type === 'Work Extension' &&
                    (l.status === 'approved' || l.status === 'processed') &&
                    l.startDate &&
                    isSameDay(new Date(l.startDate), day)
                );
    
                workExtensionsOnDay.forEach(ext => {
                    if (ext.startTime && ext.endTime && ext.startDate) {
                        const start = parse(ext.startTime, 'HH:mm', new Date(ext.startDate));
                        let end = parse(ext.endTime, 'HH:mm', new Date(ext.startDate));
                        if(end < start) end = addDays(end, 1);
                        const otMinutes = differenceInMinutes(end, start);
    
                        if (otMinutes > 0) {
                            data.push({
                                'SURNAME': employee.lastName.toUpperCase(),
                                'EMPLOYEE NAME': `${employee.lastName}, ${employee.firstName} ${employee.middleInitial || ''}`.toUpperCase(),
                                'TYPE': 'OT',
                                'PERSONNEL NUMBER': employee.personnelNumber || '',
                                'TYPE CODE': otTypeCode,
                                'START DATE': format(start, 'yyyy-MM-dd'),
                                'END DATE': format(end, 'yyyy-MM-dd'),
                                'START TIME': format(start, 'HH:mm'),
                                'END TIME': format(end, 'HH:mm'),
                                'TOTAL HOURS': Number((otMinutes / 60).toFixed(2)),
                                'REASONS/REMARKS': ext.reason || ''
                            });
                        }
                    }
                });
    
                const shiftOnDay = shifts.find(s =>
                    s.employeeId === employee.id &&
                    isSameDay(new Date(s.date), day) &&
                    !s.isDayOff &&
                    !s.isHolidayOff
                );
    
                if (shiftOnDay && shiftOnDay.startTime && shiftOnDay.endTime) {
                    const shiftStart = parse(shiftOnDay.startTime, 'HH:mm', day);
                    let shiftEnd = parse(shiftOnDay.endTime, 'HH:mm', day);
                    if (shiftEnd <= shiftStart) {
                        shiftEnd = addDays(shiftEnd, 1);
                    }
    
                    const [ndStartHour, ndStartMinute] = ndStartTime.split(':').map(Number);
                    const [ndEndHour, ndEndMinute] = ndEndTime.split(':').map(Number);
    
                    let ndPeriodStartToday = set(day, { hours: ndStartHour, minutes: ndStartMinute, seconds: 0, milliseconds: 0 });
                    let ndPeriodEndToday = endOfDay(day);
    
                    let ndPeriodStartTomorrow = startOfDay(addDays(day, 1));
                    let ndPeriodEndTomorrow = set(addDays(day, 1), { hours: ndEndHour, minutes: ndEndMinute, seconds: 0, milliseconds: 0 });
    
                    let totalNdMinutes = 0;
    
                    const overlapStart1 = Math.max(shiftStart.getTime(), ndPeriodStartToday.getTime());
                    const overlapEnd1 = Math.min(shiftEnd.getTime(), ndPeriodEndToday.getTime());
                    if (overlapEnd1 > overlapStart1) {
                        totalNdMinutes += (overlapEnd1 - overlapStart1) / (1000 * 60);
                    }
    
                    const overlapStart2 = Math.max(shiftStart.getTime(), ndPeriodStartTomorrow.getTime());
                    const overlapEnd2 = Math.min(shiftEnd.getTime(), ndPeriodEndTomorrow.getTime());
                    if (overlapEnd2 > overlapStart2) {
                        totalNdMinutes += (overlapEnd2 - overlapStart2) / (1000 * 60);
                    }
    
                    if (totalNdMinutes > 0) {
                        data.push({
                           'SURNAME': employee.lastName.toUpperCase(),
                           'EMPLOYEE NAME': `${employee.lastName}, ${employee.firstName} ${employee.middleInitial || ''}`.toUpperCase(),
                           'TYPE': 'ND',
                           'PERSONNEL NUMBER': employee.personnelNumber || '',
                           'TYPE CODE': ndTypeCode,
                           'START DATE': format(shiftStart, 'yyyy-MM-dd'),
                           'END DATE': format(shiftEnd, 'yyyy-MM-dd'),
                           'START TIME': format(shiftStart, 'HH:mm'),
                           'END TIME': format(shiftEnd, 'HH:mm'),
                           'TOTAL HOURS': Number((totalNdMinutes / 60).toFixed(2)),
                           'REASONS/REMARKS': ''
                        });
                    }
                }
            });
        });
    
        return data;
    }

    const generateOvertimeBuffer = async(data: OvertimeRowData[] | null): Promise<Buffer | null> => {
        if (!data) return null;
        const overtimeTemplate = templates.overtimeTemplate;
        if (!overtimeTemplate) {
            toast({ variant: 'destructive', title: 'No Template', description: 'Please upload an Overtime/ND template first.' });
            return null;
        }

        try {
            const workbook = new ExcelJS.Workbook();
            const buffer = Buffer.from(overtimeTemplate, 'base64');
            await workbook.xlsx.load(buffer);
            const worksheet = workbook.worksheets[0];
            if (!worksheet) throw new Error("Template worksheet not found.");

            worksheet.eachRow({ includeEmpty: true }, (row) => {
                row.eachCell({ includeEmpty: true }, (cell) => {
                    const replacePlaceholders = (text: string) => {
                        if (!text) return text;
                        let newText = text;
                        newText = newText.replace(/{{employee_name}}/g, getFullName(currentUser));
                        newText = newText.replace(/{{group}}/g, currentUser.group || '');
                        newText = newText.replace(/{{current_date}}/g, format(new Date(), 'MM/dd/yyyy'));
                        return newText;
                    }
                    if (cell.value && typeof cell.value === 'string') {
                        cell.value = tryParseExcelNumber(replacePlaceholders(cell.value));
                    }
                });
            });

            let templateRowNumber = -1;
            worksheet.eachRow((row, rowNumber) => {
                 row.eachCell((cell) => {
                    if (typeof cell.value === 'string' && cell.value.includes('{{SURNAME}}')) {
                       templateRowNumber = rowNumber;
                    }
                 });
            });
            if (templateRowNumber === -1) throw new Error("Template row with `{{SURNAME}}` not found.");

            const templateRow = worksheet.getRow(templateRowNumber);
            const templateStyles = new Map<number, Partial<ExcelJS.Style>>();
            templateRow.eachCell({ includeEmpty: true }, (cell, colNumber) => {
                templateStyles.set(colNumber, { ...cell.style });
            });

             const placeholderMap: { [key: string]: keyof OvertimeRowData } = {
                '{{SURNAME}}': 'SURNAME',
                '{{EMPLOYEE NAME}}': 'EMPLOYEE NAME',
                '{{TYPE}}': 'TYPE',
                '{{PERSONNEL NUMBER}}': 'PERSONNEL NUMBER',
                '{{TYPE CODE}}': 'TYPE CODE',
                '{{START TIME}}': 'START TIME',
                '{{END TIME}}': 'END TIME',
                '{{START DATE}}': 'START DATE',
                '{{END DATE}}': 'END DATE',
                '{{TOTAL HOURS}}': 'TOTAL HOURS',
                '{{REASONS/REMARKS}}': 'REASONS/REMARKS',
            };

            data.forEach((rowData, index) => {
                const newRow = worksheet.insertRow(templateRowNumber + index + 1, {});
                 templateRow.eachCell({ includeEmpty: true }, (templateCell, colNumber) => {
                    const newCell = newRow.getCell(colNumber);
                    let templateValue = templateCell.text;
                    for (const placeholder in placeholderMap) {
                        if (templateValue.includes(placeholder)) {
                            templateValue = templateValue.replace(new RegExp(placeholder.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&'), 'g'), String(rowData[placeholderMap[placeholder as keyof typeof placeholderMap]]));
                        }
                    }
                    newCell.value = tryParseExcelNumber(templateValue);
                    newCell.style = templateStyles.get(colNumber) || {};
                });
            });

            worksheet.spliceRows(templateRowNumber, 1);
            
            let sigRowNumber = -1;
            let sigColNumber = -1;
            worksheet.eachRow({ includeEmpty: true }, (row, rowNumber) => {
                row.eachCell((cell, colNumber) => {
                    if (typeof cell.value === 'string' && cell.value.includes('{{employee_signature}}')) {
                        sigRowNumber = rowNumber;
                        sigColNumber = colNumber;
                        cell.value = cell.value.replace('{{employee_signature}}', '');
                    }
                });
            });

            if (currentUser.signature && sigRowNumber > -1) {
                const signatureImageId = workbook.addImage({
                    base64: currentUser.signature.split(',')[1],
                    extension: 'png',
                });
                worksheet.addImage(signatureImageId, {
                    tl: { col: sigColNumber - 1, row: sigRowNumber - 1 },
                    ext: { width: 100, height: 40 }
                });
            }

            const fileBuffer = await workbook.xlsx.writeBuffer();
            return Buffer.from(fileBuffer);
        } catch (error) {
            console.error("Error generating Overtime/ND report:", error);
            toast({ variant: 'destructive', title: 'Report Generation Failed', description: (error as Error).message });
            return null;
        }
    };

    const handleDownloadOvertime = async () => {
        const buffer = await generateOvertimeBuffer(generateOvertimeData());
        if(buffer) {
            const blob = new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
            saveAs(blob, `Overtime and Night Differential Report - ${format(overtimeDateRange!.from!, 'yyyy-MM-dd')} to ${format(overtimeDateRange!.to!, 'yyyy-MM-dd')}.xlsx`);
        }
    }


    const handleViewReport = (type: ReportType) => {
        let data: ReportData | null = null;
        let title = '';
        let generator: (() => Promise<void>) | null = null;
        let emailGen: (() => Promise<Buffer | null>) | null = null;

        if (type === 'workSchedule') {
            const rawData = generateWorkScheduleData();
            data = generateWorkSchedulePreviewData(rawData);
            if (data && workScheduleDateRange?.from && workScheduleDateRange?.to) {
                title = `Regular Work Schedule (${format(workScheduleDateRange!.from!, 'MM/dd/yyyy')} - ${format(workScheduleDateRange!.to!, 'MM/dd/yyyy')})`;
                generator = () => handleDownloadWorkSchedule();
                emailGen = () => generateWorkScheduleBuffer(rawData);
            }
        } else if (type === 'attendance') {
            const rawData = generateAttendanceSheetData();
            data = rawData;
            if (data && attendanceDateRange?.from && attendanceDateRange?.to) {
                title = `Attendance Sheet (${format(attendanceDateRange!.from!, 'LLL d')} - ${format(attendanceDateRange!.to!, 'LLL d, y')})`;
                generator = () => handleDownloadAttendanceSheet();
                emailGen = () => generateAttendanceSheetBuffer(rawData);
            }
        } else if (type === 'userSummary') {
            const rawData = generateUserSummaryData();
            data = rawData;
            if (data && summaryDateRange?.from && summaryDateRange?.to) {
                title = `User Summary (${format(summaryDateRange!.from!, 'LLL d')} - ${format(summaryDateRange!.to!, 'LLL d, y')})`;
                generator = () => handleDownloadUserSummary();
                emailGen = () => generateUserSummaryBuffer(rawData);
            }
        } else if (type === 'tardy') {
            const rawData = generateTardyReportData();
            data = rawData;
            if (data && tardyDateRange?.from && tardyDateRange?.to) {
                title = `Cumulative Tardy Report (${format(tardyDateRange!.from!, 'LLL d')} - ${format(tardyDateRange!.to!, 'LLL d, y')})`;
                generator = () => handleDownloadTardyReport();
                emailGen = () => generateTardyReportBuffer(rawData);
            }
        } else if (type === 'wfh') {
            const rawData = generateWfhCertificationData();
            if (rawData && wfhCertDateRange?.from) {
                const previewRows = rawData.map(d => [d.DATE, d.ATTENDANCE_RENDERED, d.TOTAL_HRS_SPENT, d.REMARKS]);
                data = {
                    headers: ['DATE', 'ATTENDANCE_RENDERED', 'TOTAL_HRS_SPENT', 'REMARKS'],
                    rows: previewRows,
                }
                title = `WFH Certification - ${getFullName(currentUser)} (${format(wfhCertDateRange!.from!, 'MMMM yyyy')})`;
                generator = () => handleDownloadWfhCertification();
                emailGen = () => generateWfhCertificationBuffer(rawData);
            }
        } else if (type === 'workExtension') {
            const rawData = generateWorkExtensionData();
            if (rawData && workExtensionDateRange?.from && workExtensionDateRange?.to) {
                data = {
                    headers: ['Employee', 'Work Date', 'Sched Start', 'Sched End', 'Ext Date', 'Ext Start', 'Ext End', 'Total Hours', 'Reason'],
                    rows: rawData.map(d => Object.values(d))
                };
                title = `Work Extension Summary (${format(workExtensionDateRange!.from!, 'LLL d')} - ${format(workExtensionDateRange!.to!, 'LLL d, y')})`;
                generator = () => handleDownloadWorkExtension();
                emailGen = () => generateWorkExtensionBuffer(rawData);
            }
        } else if (type === 'overtime') {
            const rawData = generateOvertimeData();
             if (rawData && overtimeDateRange?.from && overtimeDateRange?.to) {
                const headers: (keyof OvertimeRowData)[] = ['SURNAME', 'EMPLOYEE NAME', 'TYPE', 'PERSONNEL NUMBER', 'TYPE CODE', 'START TIME', 'END TIME', 'START DATE', 'END DATE', 'TOTAL HOURS', 'REASONS/REMARKS'];
                data = {
                    headers: headers,
                    rows: rawData.map(d => headers.map(h => d[h as keyof OvertimeRowData]))
                };
                title = `Overtime & Night Differential (${format(overtimeDateRange!.from!, 'LLL d')} - ${format(overtimeDateRange!.to!, 'LLL d, y')})`;
                generator = () => handleDownloadOvertime();
                emailGen = () => generateOvertimeBuffer(rawData);
            }
        }
        
        if (data) {
            setPreviewData(data);
            setReportTitle(title);
            setReportGenerator(() => generator);
            setEmailGenerator(() => emailGen);
            setIsPreviewOpen(true);
        }
    }
    
    const setSemiMonthlyRange = (period: 'first-half' | 'second-half', monthOffset: 0 | -1) => {
        const today = new Date();
        const targetMonth = addMonths(today, monthOffset);
        const year = targetMonth.getFullYear();
        const month = targetMonth.getMonth();
        
        let from: Date;
        let to: Date;
        
        if (period === 'first-half') {
            from = new Date(year, month, 1);
            to = new Date(year, month, 15);
        } else { 
            from = new Date(year, month, 16);
            to = endOfMonth(targetMonth);
        }
        
        setWorkScheduleDateRange({ from, to });
    };

    const reportConfig = useMemo(() => {
      const config: Record<ReportType, {
          label: string;
          description: string;
          dateComponent: React.ReactNode;
          templateKey?: keyof typeof templates;
          openUploader?: () => void;
          permissionKey: NavItemKey;
          isDateRequired: boolean;
          settingsComponent?: React.ReactNode;
      }> = {
          workSchedule: {
              label: "Regular Work Schedule",
              description: "Generate a report of employee work schedules for a specific period.",
              permissionKey: 'report-work-schedule',
              isDateRequired: true,
              dateComponent: (
                   <Popover>
                      <PopoverTrigger asChild>
                      <Button
                          id="date"
                          variant={"outline"}
                          className={cn(
                          "w-full sm:w-[300px] justify-start text-left font-normal",
                          !workScheduleDateRange && "text-muted-foreground"
                          )}
                      >
                          <CalendarIcon className="mr-2 h-4 w-4" />
                          {workScheduleDateRange?.from ? (
                          workScheduleDateRange.to ? (
                              <>
                              {format(workScheduleDateRange.from, "MM/dd/yyyy")} -{" "}
                              {format(workScheduleDateRange.to, "MM/dd/yyyy")}
                              </>
                          ) : (
                              format(workScheduleDateRange.from, "MM/dd/yyyy")
                          )
                          ) : (
                          <span>Pick a date range</span>
                          )}
                      </Button>
                      </PopoverTrigger>
                      <PopoverContent className="w-auto p-0 flex" align="start">
                          <div className="flex flex-col space-y-2 p-4 border-r">
                              <h4 className="font-medium text-sm">Presets</h4>
                              <Button variant="ghost" className="justify-start" onClick={() => setSemiMonthlyRange('first-half', 0)}>This Month (1-15)</Button>
                              <Button variant="ghost" className="justify-start" onClick={() => setSemiMonthlyRange('second-half', 0)}>This Month (16-EOM)</Button>
                              <Button variant="ghost" className="justify-start" onClick={() => setSemiMonthlyRange('first-half', -1)}>Last Month (1-15)</Button>
                              <Button variant="ghost" className="justify-start" onClick={() => setSemiMonthlyRange('second-half', -1)}>Last Month (16-EOM)</Button>
                          </div>
                          <Calendar
                              initialFocus
                              mode="range"
                              defaultMonth={workScheduleDateRange?.from}
                              selected={workScheduleDateRange}
                              onSelect={setWorkScheduleDateRange}
                              numberOfMonths={2}
                          />
                      </PopoverContent>
                  </Popover>
              ),
              templateKey: 'workScheduleTemplate',
              openUploader: () => setIsWorkScheduleUploaderOpen(true),
          },
          attendance: {
              label: 'Attendance Sheet',
              description: 'Generate a weekly attendance sheet (Mon-Sun) based on a template.',
              permissionKey: 'report-attendance',
              isDateRequired: true,
              dateComponent: (
                  <Popover>
                      <PopoverTrigger asChild>
                      <Button
                          id="attendance-date"
                          variant={"outline"}
                          className={cn(
                          "w-full sm:w-[300px] justify-start text-left font-normal",
                          !attendanceDateRange && "text-muted-foreground"
                          )}
                      >
                          <CalendarIcon className="mr-2 h-4 w-4" />
                          {attendanceDateRange?.from ? (
                              <>
                              {format(attendanceDateRange.from, "LLL dd, y")} -{" "}
                              {format(attendanceDateRange.to, "LLL dd, y")}
                              </>
                          ) : (
                          <span>Pick a week</span>
                          )}
                      </Button>
                      </PopoverTrigger>
                      <PopoverContent className="w-auto p-0" align="start">
                      <Calendar
                          initialFocus
                          mode="single"
                          selected={attendanceWeek}
                          onSelect={setAttendanceWeek}
                      />
                      </PopoverContent>
                  </Popover>
              ),
              templateKey: 'attendanceSheetTemplate',
              openUploader: () => setIsAttendanceUploaderOpen(true),
          },
          workExtension: {
              label: "Work Extension Summary",
              description: "Generate a summary of work extensions for the selected week or date range.",
              permissionKey: 'report-work-extension',
              isDateRequired: true,
              dateComponent: (
                  <div className="flex flex-col gap-2">
                      <Select value={workExtensionSelectionMode} onValueChange={(v) => setWorkExtensionSelectionMode(v as 'week' | 'range')}>
                          <SelectTrigger className="w-[150px]">
                              <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                              <SelectItem value="week">Weekly</SelectItem>
                              <SelectItem value="range">Custom Range</SelectItem>
                          </SelectContent>
                      </Select>
                      <Popover>
                          <PopoverTrigger asChild>
                          <Button
                              id="work-extension-date"
                              variant={"outline"}
                              className={cn(
                              "w-full sm:w-[300px] justify-start text-left font-normal",
                              !workExtensionDateRange && "text-muted-foreground"
                              )}
                          >
                              <CalendarIcon className="mr-2 h-4 w-4" />
                              {workExtensionDateRange?.from ? (
                                  <>
                                  {format(workExtensionDateRange.from, "LLL dd, y")}
                                  {workExtensionDateRange.to && ` - ${format(workExtensionDateRange.to, "LLL dd, y")}`}
                                  </>
                              ) : (
                              <span>{workExtensionSelectionMode === 'week' ? 'Pick a week' : 'Pick a range'}</span>
                              )}
                          </Button>
                          </PopoverTrigger>
                          <PopoverContent className="w-auto p-0" align="start">
                          {workExtensionSelectionMode === 'week' ? (
                              <Calendar
                                  initialFocus
                                  mode="single"
                                  selected={workExtensionWeek}
                                  onSelect={setWorkExtensionWeek}
                              />
                          ) : (
                              <Calendar
                                  initialFocus
                                  mode="range"
                                  selected={workExtensionRange}
                                  onSelect={setWorkExtensionRange}
                                  numberOfMonths={2}
                              />
                          )}
                          </PopoverContent>
                      </Popover>
                  </div>
              ),
              templateKey: 'workExtensionTemplate',
              openUploader: () => setIsWorkExtensionUploaderOpen(true),
          },
          overtime: {
              label: "Overtime and Night Differential",
              description: "Generates reports based on employee overtime and night differential.",
              permissionKey: 'report-overtime',
              isDateRequired: true,
              dateComponent: (
                  <Popover>
                      <PopoverTrigger asChild>
                      <Button
                          id="overtime-date"
                          variant={"outline"}
                          className={cn(
                          "w-full sm:w-[300px] justify-start text-left font-normal",
                          !overtimeDateRange && "text-muted-foreground"
                          )}
                      >
                          <CalendarIcon className="mr-2 h-4 w-4" />
                          {overtimeDateRange?.from ? (
                          overtimeDateRange.to ? (
                              <>
                              {format(overtimeDateRange.from, "LLL dd, y")} -{" "}
                              {format(overtimeDateRange.to, "LLL dd, y")}
                              </>
                          ) : (
                              format(overtimeDateRange.from, "LLL dd, y")
                          )
                          ) : (
                          <span>Pick a date range</span>
                          )}
                      </Button>
                      </PopoverTrigger>
                      <PopoverContent className="w-auto p-0" align="start">
                      <Calendar
                          initialFocus
                          mode="range"
                          defaultMonth={overtimeDateRange?.from}
                          selected={overtimeDateRange}
                          onSelect={setOvertimeDateRange}
                          numberOfMonths={2}
                      />
                      </PopoverContent>
                  </Popover>
              ),
               templateKey: 'overtimeTemplate',
               openUploader: () => setIsOvertimeUploaderOpen(true),
               settingsComponent: (
                   <Button variant="outline" size="icon" onClick={() => setIsOvertimeSettingsOpen(true)}>
                      <Settings className="h-4 w-4" />
                  </Button>
               )
          },
          userSummary: {
              label: 'Summary Per User',
              description: 'Generate an individual summary of shifts, hours, and leave for each employee.',
              permissionKey: 'report-user-summary',
              isDateRequired: true,
              dateComponent: (
                  <Popover>
                      <PopoverTrigger asChild>
                      <Button
                          id="summary-date"
                          variant={"outline"}
                          className={cn(
                          "w-full sm:w-[300px] justify-start text-left font-normal",
                          !summaryDateRange && "text-muted-foreground"
                          )}
                      >
                          <CalendarIcon className="mr-2 h-4 w-4" />
                          {summaryDateRange?.from ? (
                          summaryDateRange.to ? (
                              <>
                              {format(summaryDateRange.from, "LLL dd, y")} -{" "}
                              {format(summaryDateRange.to, "LLL dd, y")}
                              </>
                          ) : (
                              format(summaryDateRange.from, "LLL dd, y")
                          )
                          ) : (
                          <span>Pick a date range</span>
                          )}
                      </Button>
                      </PopoverTrigger>
                      <PopoverContent className="w-auto p-0" align="start">
                      <Calendar
                          initialFocus
                          mode="range"
                          defaultMonth={summaryDateRange?.from}
                          selected={summaryDateRange}
                          onSelect={setSummaryDateRange}
                          numberOfMonths={2}
                      />
                      </PopoverContent>
                  </Popover>
              ),
          },
          tardy: {
              label: "Cumulative Tardy Report",
              description: "Combines tardiness data from leave requests and manual CSV uploads.",
              permissionKey: 'report-tardy',
              isDateRequired: true,
              dateComponent: (
                  <Popover>
                      <PopoverTrigger asChild>
                      <Button
                          id="tardy-date"
                          variant={"outline"}
                          className={cn(
                          "w-full sm:w-[300px] justify-start text-left font-normal",
                          !tardyDateRange && "text-muted-foreground"
                          )}
                      >
                          <CalendarIcon className="mr-2 h-4 w-4" />
                          {tardyDateRange?.from ? (
                          tardyDateRange.to ? (
                              <>
                              {format(tardyDateRange.from, "LLL dd, y")} -{" "}
                              {format(tardyDateRange.to, "LLL dd, y")}
                              </>
                          ) : (
                              format(tardyDateRange.from, "LLL dd, y")
                          )
                          ) : (
                          <span>Pick a date range</span>
                          )}
                      </Button>
                      </PopoverTrigger>
                      <PopoverContent className="w-auto p-0" align="start">
                      <Calendar
                          initialFocus
                          mode="range"
                          defaultMonth={tardyDateRange?.from}
                          selected={tardyDateRange}
                          onSelect={setTardyDateRange}
                          numberOfMonths={2}
                      />
                      </PopoverContent>
                  </Popover>
              ),
              openUploader: () => setIsTardyImporterOpen(true),
          },
          wfh: {
              label: "Work From Home Certification",
              description: "Generate a WFH certification for the current user for a specific month.",
              permissionKey: 'report-wfh',
              isDateRequired: true,
              dateComponent: (
                  <Popover>
                      <PopoverTrigger asChild>
                      <Button
                          id="wfh-cert-date"
                          variant={"outline"}
                          className={cn(
                          "w-full sm:w-[300px] justify-start text-left font-normal",
                          !wfhCertMonth && "text-muted-foreground"
                          )}
                      >
                          <CalendarIcon className="mr-2 h-4 w-4" />
                          {wfhCertMonth ? format(wfhCertMonth, "MMMM yyyy") : <span>Pick a month</span>}
                      </Button>
                      </PopoverTrigger>
                      <PopoverContent className="w-auto p-0" align="start">
                      <Calendar
                          initialFocus
                          mode="single"
                          selected={wfhCertMonth}
                          onSelect={setWfhCertMonth}
                          captionLayout="dropdown-buttons"
                          fromYear={2020}
                          toYear={new Date().getFullYear() + 1}
                      />
                      </PopoverContent>
                  </Popover>
              ),
              templateKey: 'wfhCertificationTemplate',
              openUploader: () => setIsWfhCertUploaderOpen(true),
          }
      };
      return config;
    }, [workScheduleDateRange, attendanceDateRange, attendanceWeek, summaryDateRange, tardyDateRange, wfhCertMonth, workExtensionWeek, workExtensionRange, workExtensionSelectionMode, overtimeDateRange, templates]);
    
    const availableReports = useMemo(() => {
        return Object.entries(reportConfig)
            .filter(([key, config]) => currentUser.role === 'admin' || userPermissions.includes(config.permissionKey)) 
            .map(([key]) => key as ReportType);
    }, [reportConfig, currentUser.role, userPermissions]);

    const currentReport = reportConfig[selectedReportType];
    
    const isDateFilled = () => {
        switch(selectedReportType) {
            case 'workSchedule': return !!workScheduleDateRange;
            case 'attendance': return !!attendanceDateRange;
            case 'userSummary': return !!summaryDateRange;
            case 'tardy': return !!tardyDateRange;
            case 'wfh': return !!wfhCertMonth;
            case 'workExtension': return !!workExtensionDateRange;
            case 'overtime': return !!overtimeDateRange;
            default: return false;
        }
    }
    
    const isDownloadDisabled = useMemo(() => {
      if (!currentReport) return true;
      return (currentReport.templateKey && !templates[currentReport.templateKey]) || (currentReport.isDateRequired && !isDateFilled());
    }, [currentReport, templates, selectedReportType, workScheduleDateRange, attendanceDateRange, summaryDateRange, tardyDateRange, wfhCertMonth, workExtensionDateRange, overtimeDateRange]);
    
    const handleSaveOvertimeSettings = () => {
        localStorage.setItem('ndStartTime', ndStartTime);
        localStorage.setItem('ndEndTime', ndEndTime);
        localStorage.setItem('ndClassifications', JSON.stringify(ndClassifications));
        localStorage.setItem('otTypeCode', otTypeCode);
        localStorage.setItem('ndTypeCode', ndTypeCode);
        toast({ title: 'Overtime settings saved.' });
        setIsOvertimeSettingsOpen(false);
    }
    
    const handleEmailReport = () => {
        let generator: (() => Promise<Buffer | null>) | null = null;
        let title = '';
        
        switch (selectedReportType) {
            case 'workSchedule':
                generator = () => generateWorkScheduleBuffer(generateWorkScheduleData());
                title = `Regular Work Schedule - ${format(workScheduleDateRange!.from!, 'MM-dd-yyyy')} to ${format(workScheduleDateRange!.to!, 'MM-dd-yyyy')}`;
                break;
            case 'attendance':
                generator = () => generateAttendanceSheetBuffer(generateAttendanceSheetData());
                title = `Attendance Sheet - ${format(attendanceDateRange!.from!, 'yyyy-MM-dd')} to ${format(attendanceDateRange!.to!, 'yyyy-MM-dd')}`;
                break;
            case 'userSummary':
                generator = () => generateUserSummaryBuffer(generateUserSummaryData());
                title = `User Summary - ${format(summaryDateRange!.from!, 'yyyy-MM-dd')} to ${format(summaryDateRange!.to!, 'yyyy-MM-dd')}`;
                break;
            case 'tardy':
                generator = () => generateTardyReportBuffer(generateTardyReportData());
                title = `Cumulative Tardy Report - ${format(tardyDateRange!.from!, 'yyyy-MM-dd')} to ${format(tardyDateRange!.to!, 'yyyy-MM-dd')}`;
                break;
            case 'wfh':
                generator = () => generateWfhCertificationBuffer(generateWfhCertificationData());
                title = `WFH Certification - ${getFullName(currentUser)}`;
                break;
            case 'workExtension':
                generator = () => generateWorkExtensionBuffer(generateWorkExtensionData());
                title = `Work Extension Summary - ${format(workExtensionDateRange!.from!, 'yyyy-MM-dd')} to ${format(workExtensionDateRange!.to!, 'yyyy-MM-dd')}`;
                break;
            case 'overtime':
                generator = () => generateOvertimeBuffer(generateOvertimeData());
                title = `Overtime & ND Report - ${format(overtimeDateRange!.from!, 'yyyy-MM-dd')} to ${format(overtimeDateRange!.to!, 'yyyy-MM-dd')}`;
                break;
        }

        if (generator) {
            setEmailGenerator(() => generator);
            setReportTitle(title);
            setIsEmailDialogOpen(true);
        }
    };


    return (
        <>
            <Card>
                <CardHeader>
                    <CardTitle>Generate Reports</CardTitle>
                    <CardDescription>
                        Create and download reports based on your schedule data. Select a report type to begin.
                    </CardDescription>
                </CardHeader>
                <CardContent className="space-y-6">
                    {availableReports.length > 0 ? (
                      <>
                        <div className="space-y-2">
                            <label className="text-sm font-medium">Report Type</label>
                            <Select value={selectedReportType} onValueChange={(v) => setSelectedReportType(v as ReportType)}>
                                <SelectTrigger>
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    {availableReports.map(key => (
                                        <SelectItem key={key} value={key}>{reportConfig[key].label}</SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>

                        {currentReport && (
                          <Card className="p-6 bg-muted/50">
                              <h3 className="font-semibold text-lg mb-2">{currentReport.label}</h3>
                              <p className="text-sm text-muted-foreground mb-4">
                                  {currentReport.description}
                              </p>
                              <div className="flex flex-col sm:flex-row gap-4">
                                 {currentReport.dateComponent}
                                  <div className="flex items-center gap-2">
                                      {currentReport.openUploader && (
                                          <Button variant="outline" onClick={currentReport.openUploader}>
                                              <Upload className="mr-2 h-4 w-4" />
                                              {selectedReportType === 'tardy' ? 'Import Tardy Data' : 'Upload Template'}
                                          </Button>
                                      )}
                                      {currentReport.settingsComponent}
                                  </div>
                              </div>
                              <div className="pt-6 flex flex-wrap gap-2">
                                  <Button onClick={() => handleViewReport(selectedReportType)} disabled={currentReport.isDateRequired && !isDateFilled()}>
                                      <Eye className="mr-2 h-4 w-4" />
                                      View Report
                                  </Button>
                                  <Button onClick={() => handleEmailReport()} disabled={isDownloadDisabled}>
                                      <Send className="mr-2 h-4 w-4" />
                                      Send Email
                                  </Button>
                                  <Button onClick={() => reportGenerator && reportGenerator()} disabled={isDownloadDisabled}>
                                      <Download className="mr-2 h-4 w-4" />
                                      Generate & Download
                                  </Button>
                              </div>
                          </Card>
                        )}
                      </>
                    ) : (
                      <div className="p-12 text-center border-2 border-dashed rounded-lg">
                          <p className="text-muted-foreground">You do not have access to any reports. Please contact an administrator.</p>
                      </div>
                    )}
                </CardContent>
            </Card>
            <ReportTemplateUploader
                isOpen={isWorkScheduleUploaderOpen}
                setIsOpen={setIsWorkScheduleUploaderOpen}
                onTemplateUpload={(data) => { setTemplates(prev => ({...prev, workScheduleTemplate: data})); saveTemplate('workScheduleTemplate', data).catch(() => {}); }}
            />
            <AttendanceTemplateUploader
                isOpen={isAttendanceUploaderOpen}
                setIsOpen={setIsAttendanceUploaderOpen}
                onTemplateUpload={(data) => { setTemplates(prev => ({...prev, attendanceSheetTemplate: data})); saveTemplate('attendanceSheetTemplate', data).catch(() => {}); }}
            />
             <WorkExtensionTemplateUploader
                isOpen={isWorkExtensionUploaderOpen}
                setIsOpen={setIsWorkExtensionUploaderOpen}
                onTemplateUpload={(data) => { setTemplates(prev => ({...prev, workExtensionTemplate: data})); saveTemplate('workExtensionTemplate', data).catch(() => {}); }}
            />
            <WfhCertificationTemplateUploader
                isOpen={isWfhCertUploaderOpen}
                setIsOpen={setIsWfhCertUploaderOpen}
                onTemplateUpload={(data) => { setTemplates(prev => ({...prev, wfhCertificationTemplate: data})); saveTemplate('wfhCertificationTemplate', data).catch(() => {}); }}
            />
             <TardyImporter
                isOpen={isTardyImporterOpen}
                setIsOpen={setIsTardyImporterOpen}
                onImport={setTardyRecords}
                employees={employees}
            />
            <OvertimeTemplateUploader
                isOpen={isOvertimeUploaderOpen}
                setIsOpen={setIsOvertimeUploaderOpen}
                onTemplateUpload={(data) => { setTemplates(prev => ({...prev, overtimeTemplate: data})); saveTemplate('overtimeTemplate', data).catch(() => {}); }}
            />
            <Dialog open={isOvertimeSettingsOpen} onOpenChange={setIsOvertimeSettingsOpen}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>Overtime & Night Differential Settings</DialogTitle>
                        <DialogDescription>Configure the rules and codes for OT and ND calculation.</DialogDescription>
                    </DialogHeader>
                    <div className="space-y-4 py-4">
                        <div className="grid grid-cols-2 gap-4">
                            <div className="space-y-2">
                                <Label htmlFor="nd-start">ND Start Time</Label>
                                <Input id="nd-start" type="time" value={ndStartTime} onChange={e => setNdStartTime(e.target.value)} />
                            </div>
                             <div className="space-y-2">
                                <Label htmlFor="nd-end">ND End Time</Label>
                                <Input id="nd-end" type="time" value={ndEndTime} onChange={e => setNdEndTime(e.target.value)} />
                            </div>
                        </div>
                        <div className="grid grid-cols-2 gap-4">
                            <div className="space-y-2">
                                <Label htmlFor="ot-code">OT Type Code</Label>
                                <Input id="ot-code" value={otTypeCode} onChange={e => setOtTypeCode(e.target.value)} />
                            </div>
                             <div className="space-y-2">
                                <Label htmlFor="nd-code">ND Type Code</Label>
                                <Input id="nd-code" value={ndTypeCode} onChange={e => setNdTypeCode(e.target.value)} />
                            </div>
                        </div>
                        <div className="space-y-2">
                            <Label>Applicable Employee Classifications for ND</Label>
                            <div className="space-y-1">
                            {ALL_CLASSIFICATIONS.map(classification => (
                                <div key={classification} className="flex items-center space-x-2">
                                    <Checkbox
                                        id={`class-${classification}`}
                                        checked={ndClassifications.includes(classification)}
                                        onCheckedChange={(checked) => {
                                            setNdClassifications(prev => 
                                                checked ? [...prev, classification] : prev.filter(c => c !== classification)
                                            );
                                        }}
                                    />
                                    <label htmlFor={`class-${classification}`} className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70">
                                        {classification}
                                    </label>
                                </div>
                            ))}
                            </div>
                        </div>
                    </div>
                    <DialogFooter>
                        <Button variant="ghost" onClick={() => setIsOvertimeSettingsOpen(false)}>Cancel</Button>
                        <Button onClick={handleSaveOvertimeSettings}>Save Settings</Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
            <ReportPreviewDialog 
                isOpen={isPreviewOpen}
                setIsOpen={setIsPreviewOpen}
                title={reportTitle}
                data={previewData}
                onDownload={reportGenerator}
            />
            {isEmailDialogOpen && (
                <EmailDialog
                    isOpen={isEmailDialogOpen}
                    setIsOpen={setIsEmailDialogOpen}
                    defaultSubject={reportTitle}
                    smtpSettings={smtpSettings}
                    generateExcelData={emailGenerator!}
                    fileName={`${reportTitle}.xlsx`}
                />
            )}
        </>
    );
}


type EmailDialogProps = {
    isOpen: boolean;
    setIsOpen: (isOpen: boolean) => void;
    defaultSubject: string;
    smtpSettings: SmtpSettings;
    generateExcelData: () => Promise<Buffer | null>;
    fileName: string;
};

function EmailDialog({ 
    isOpen, 
    setIsOpen, 
    defaultSubject, 
    smtpSettings,
    generateExcelData,
    fileName,
}: EmailDialogProps) {
    const [to, setTo] = React.useState('');
    const [subject, setSubject] = React.useState(defaultSubject);
    const [body, setBody] = React.useState('Please find the report attached.');
    const [isSending, startTransition] = React.useTransition();
    const { toast } = useToast();

    React.useEffect(() => {
        if (isOpen) {
            setSubject(defaultSubject);
            setBody('Please find the report attached.');
            setTo('');
        }
    }, [isOpen, defaultSubject]);
    
    const handleSend = async () => {
        if (!to) {
            toast({ variant: 'destructive', title: 'Recipient required', description: 'Please enter an email address.' });
            return;
        }

        startTransition(async () => {
            try {
                toast({ title: 'Generating report...', description: 'Please wait while the file is being prepared.'});
                const excelBuffer = await generateExcelData();
                 if (!excelBuffer) {
                    toast({ variant: 'destructive', title: 'Cannot Send', description: 'The report could not be generated.' });
                    return;
                }

                const attachments = [{
                    filename: fileName,
                    content: excelBuffer.toString('base64'),
                }];
                
                toast({ title: 'Sending email...', description: `Sending report to ${to}.`});
                const result = await sendEmail({ to, subject, htmlBody: body.replace(/\n/g, '<br>'), attachments }, smtpSettings);

                if (result?.success) {
                    toast({ title: 'Email Sent', description: `Report sent to ${to}.` });
                    setIsOpen(false);
                } else {
                    toast({ variant: 'destructive', title: 'Email Failed', description: result?.error || 'An unknown error occurred.' });
                }
            } catch(e: any) {
                toast({ variant: 'destructive', title: 'Failed to generate report', description: e.message });
            }
        });
    };

    return (
        <Dialog open={isOpen} onOpenChange={setIsOpen}>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>Send Report via Email</DialogTitle>
                    <DialogDescription>The report will be generated and sent as an Excel attachment.</DialogDescription>
                </DialogHeader>
                <div className="space-y-4 py-4">
                    <div className="space-y-2">
                        <Label htmlFor="recipientEmail">Recipient Email</Label>
                        <Input id="recipientEmail" type="email" value={to} onChange={(e) => setTo(e.target.value)} placeholder="recipient@example.com" />
                    </div>
                     <div className="space-y-2">
                        <Label>Subject</Label>
                        <Input value={subject} onChange={(e) => setSubject(e.target.value)} />
                    </div>
                    <div className="space-y-2">
                        <Label>Body</Label>
                        <Textarea value={body} onChange={(e) => setBody(e.target.value)} rows={4} />
                    </div>
                </div>
                <DialogFooter>
                    <Button variant="ghost" onClick={() => setIsOpen(false)}>Cancel</Button>
                    <Button onClick={handleSend} disabled={isSending}>
                        {isSending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                        Send
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
