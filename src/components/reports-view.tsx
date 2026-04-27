
'use client';

import React from 'react';
import type { Employee, Shift, Leave, Holiday, TardyRecord, RolePermissions, SmtpSettings } from '@/types';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from './ui/button';
import { Download, Upload, Calendar as CalendarIcon, Eye, Settings, Send, Loader2 } from 'lucide-react';
import { DateRange } from 'react-day-picker';
import { Popover, PopoverContent, PopoverTrigger } from './ui/popover';
import { Calendar } from './ui/calendar';
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
import { AlafTemplateUploader } from './alaf-template-uploader';
import { OffsetTemplateUploader } from './offset-template-uploader';
import { sendEmail } from '@/app/actions';
import { Textarea } from './ui/textarea';


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

type ReportType = 'workSchedule' | 'attendance' | 'userSummary' | 'tardy' | 'wfh' | 'workExtension' | 'overtime' | 'alaf' | 'offset';

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
    total_hours_extended: string;
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
    'TOTAL HOURS': string;
    'REASONS/REMARKS': string;
}


const ALL_CLASSIFICATIONS = ['Rank-and-File', 'Confidential', 'Managerial'];

export default function ReportsView({ employees, shifts, leave, holidays, currentUser, tardyRecords, setTardyRecords, templates, setTemplates, shiftTemplates, leaveTypes, permissions, smtpSettings }: ReportsViewProps) {
    const { toast } = useToast();
    const [selectedReportType, setSelectedReportType] = React.useState<ReportType>('workSchedule');
    
    // Date states
    const [workScheduleDateRange, setWorkScheduleDateRange] = React.useState<DateRange | undefined>();
    const [attendanceWeek, setAttendanceWeek] = React.useState<Date | undefined>();
    const [summaryDateRange, setSummaryDateRange] = React.useState<DateRange | undefined>();
    const [tardyDateRange, setTardyDateRange] = React.useState<DateRange | undefined>();
    const [wfhCertMonth, setWfhCertMonth] = React.useState<Date | undefined>();
    const [workExtensionWeek, setWorkExtensionWeek] = React.useState<Date | undefined>();
    const [workExtensionRange, setWorkExtensionRange] = React.useState<DateRange | undefined>();
    const [workExtensionSelectionMode, setWorkExtensionSelectionMode] = React.useState<'week' | 'range'>('week');
    const [overtimeDateRange, setOvertimeDateRange] = React.useState<DateRange | undefined>();

    // Settings states
    const [ndStartTime, setNdStartTime] = React.useState<string>(() => getInitialState('ndStartTime', '20:00'));
    const [ndEndTime, setNdEndTime] = React.useState<string>(() => getInitialState('ndEndTime', '06:00'));
    const [ndClassifications, setNdClassifications] = React.useState<string[]>(() => getInitialState('ndClassifications', ['Rank-and-File']));
    const [otTypeCode, setOtTypeCode] = React.useState<string>(() => getInitialState('otTypeCode', '801'));
    const [ndTypeCode, setNdTypeCode] = React.useState<string>(() => getInitialState('ndTypeCode', '803'));


    // Dialog states
    const [isWorkScheduleUploaderOpen, setIsWorkScheduleUploaderOpen] = React.useState(false);
    const [isAttendanceUploaderOpen, setIsAttendanceUploaderOpen] = React.useState(false);
    const [isWfhCertUploaderOpen, setIsWfhCertUploaderOpen] = React.useState(false);
    const [isTardyImporterOpen, setIsTardyImporterOpen] = React.useState(false);
    const [isWorkExtensionUploaderOpen, setIsWorkExtensionUploaderOpen] = React.useState(false);
    const [isOvertimeUploaderOpen, setIsOvertimeUploaderOpen] = React.useState(false);
    const [isOvertimeSettingsOpen, setIsOvertimeSettingsOpen] = React.useState(false);
    const [isPreviewOpen, setIsPreviewOpen] = React.useState(false);
    const [isAlafUploaderOpen, setIsAlafUploaderOpen] = React.useState(false);
    const [isOffsetUploaderOpen, setIsOffsetUploaderOpen] = React.useState(false);
    const [isEmailDialogOpen, setIsEmailDialogOpen] = React.useState(false);
    
    // Preview states
    const [previewData, setPreviewData] = React.useState<ReportData | null>(null);
    const [reportGenerator, setReportGenerator] = React.useState<(() => Promise<void>) | null>(null);
    const [reportTitle, setReportTitle] = React.useState('');
    const [emailGenerator, setEmailGenerator] = React.useState<(() => Promise<Buffer | null>) | null>(null);


    const userPermissions = permissions[currentUser.role] || [];


    const attendanceDateRange = React.useMemo(() => {
        if (!attendanceWeek) return undefined;
        const start = startOfWeek(attendanceWeek, { weekStartsOn: 1 });
        const end = endOfWeek(attendanceWeek, { weekStartsOn: 1 });
        return { from: start, to: end };
    }, [attendanceWeek]);

    const workExtensionDateRange = React.useMemo(() => {
        if (workExtensionSelectionMode === 'week') {
            if (!workExtensionWeek) return undefined;
            const start = startOfWeek(workExtensionWeek, { weekStartsOn: 1 });
            const end = endOfWeek(workExtensionWeek, { weekStartsOn: 1 });
            return { from: start, to: end };
        }
        return workExtensionRange;
    }, [workExtensionWeek, workExtensionRange, workExtensionSelectionMode]);

    const wfhCertDateRange = React.useMemo(() => {
        if (!wfhCertMonth) return undefined;
        const start = startOfMonth(wfhCertMonth);
        const end = endOfMonth(wfhCertMonth);
        return { from: start, to: end };
    }, [wfhCertMonth]);

    // --- Data Generation Functions ---
    
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
        // 1. Calculate the employee's common shift duration
        const empShifts = shifts.filter(s => s.employeeId === employee.id && !s.isDayOff && !s.isHolidayOff);
        let commonDuration = 0;
        
        if (empShifts.length > 0) {
            const durations = empShifts.map(s => {
                const start = parse(s.startTime, 'HH:mm', new Date());
                let end = parse(s.endTime, 'HH:mm', new Date());
                if (end < start) end = addDays(end, 1);
                return (end.getTime() - start.getTime()) / (1000 * 60 * 60);
            });
            
            const counts = durations.reduce((acc, d) => {
                acc[d] = (acc[d] || 0) + 1;
                return acc;
            }, {} as Record<number, number>);
            
            commonDuration = Number(Object.keys(counts).reduce((a, b) => counts[Number(a)] > counts[Number(b)] ? a : b));
        }

        // 2. Apply specific duration-based rules
        let preferred: ShiftTemplate | undefined;
        if (commonDuration === 11) {
            preferred = shiftTemplates.find(t => t.name.toLowerCase().includes("10hour manager shift1"));
        } else if (commonDuration === 10) {
            preferred = shiftTemplates.find(t => t.name.toLowerCase().includes("10hour mid shift"));
        }

        if (preferred) return preferred;

        // 3. Fallback to existing role-based search
        const isMgr = employee.role === 'manager' || employee.role === 'admin';
        const preferredName = isMgr ? "manager shift" : "mid shift";
        preferred = shiftTemplates.find(t => t.name.toLowerCase().includes(preferredName));
        
        return preferred || shiftTemplates[0];
    };

    const findDataForDay = (day: Date, employee: Employee) => {
        const normalizedDay = startOfDay(day);
        
        // Priority 1: Holiday
        const holidayOnDay = holidays.find(h => isSameDay(new Date(h.date), normalizedDay));
        if (holidayOnDay) {
            return { status: 'HOL OFF', shift: null, leave: null };
        }

        // Priority 2: Specific Shift Statuses (Day Off, Holiday Off)
        const shiftOnDay = shifts.find(s => s.employeeId === employee.id && isSameDay(new Date(s.date), normalizedDay));
        if (shiftOnDay?.isHolidayOff) {
            return { status: 'HOL OFF', shift: shiftOnDay, leave: null };
        }
        if (shiftOnDay?.isDayOff) {
            return { status: 'FREE', shift: shiftOnDay, leave: null };
        }

        // Priority 3: Any Leave Request
        const leaveOnDay = leave.find(l => {
            if (l.employeeId !== employee.id) return false;
            if (l.status !== 'approved') return false;
            const leaveStart = l.startDate ? startOfDay(new Date(l.startDate)) : null;
            const leaveEnd = l.endDate ? startOfDay(new Date(l.endDate)) : null;
            if (!leaveStart || !leaveEnd) return false;
            return isWithinInterval(normalizedDay, { start: leaveStart, end: leaveEnd });
        });
        if (leaveOnDay) {
            return { status: leaveOnDay.type.toUpperCase(), shift: shiftOnDay, leave: leaveOnDay };
        }

        // Priority 4: Regular Shift
        if (shiftOnDay) {
            const shiftLabel = shiftOnDay.label?.trim().toUpperCase();
            if (shiftLabel === 'WORK FROM HOME' || shiftLabel === 'WFH') {
                 return { status: 'WFH', shift: shiftOnDay, leave: null };
            }
            if (shiftLabel?.includes('10H')) {
                return { status: 'SKE-10', shift: shiftOnDay, leave: null };
            }
            return { status: 'SKE', shift: shiftOnDay, leave: null };
        }

        // Default: If no activity found, it's a FREE day
        return { status: 'FREE', shift: null, leave: null };
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

                if (dayData.status === 'FREE') {
                    day_status = 'FREE';
                    // Times remain empty as initialized
                } else {
                    // It's a working day or "other timeoff" (Leave, HOL OFF)
                    day_status = ''; // Hidden per requirement for leaves and holidays

                    if (dayData.shift && (dayData.status === 'SKE' || dayData.status === 'WFH' || dayData.status === 'SKE-10')) {
                        // Actual scheduled working shift
                        schedule_start = dayData.shift.startTime;
                        schedule_end = dayData.shift.endTime;
                        unpaidbreak_start = dayData.shift.isUnpaidBreak ? dayData.shift.breakStartTime || '' : '';
                        unpaidbreak_end = dayData.shift.isUnpaidBreak ? dayData.shift.breakEndTime || '' : '';
                        paidbreak_start = !dayData.shift.isUnpaidBreak ? dayData.shift.breakStartTime || '' : '';
                        paidbreak_end = !dayData.shift.isUnpaidBreak ? dayData.shift.breakEndTime || '' : '';
                    } else {
                        // "Other timeoff" (Leave or HOL OFF) -> show default duration but no label
                        schedule_start = templateSched.schedule_start;
                        schedule_end = templateSched.schedule_end;
                        unpaidbreak_start = templateSched.unpaidbreak_start;
                        unpaidbreak_end = templateSched.unpaidbreak_end;
                        paidbreak_start = templateSched.paidbreak_start;
                        paidbreak_end = templateSched.paidbreak_end;
                    }
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
            const buffer = Buffer.from(workScheduleTemplate, 'binary');
            await workbook.xlsx.load(buffer);
            const worksheet = workbook.worksheets[0];
            if (!worksheet) throw new Error("Template worksheet not found.");

            // Find and replace global placeholders
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

            // Find the template row
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

            // Insert new rows and populate them
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
                    
                    newCell.value = templateValue;
                    newCell.style = templateStyles.get(colNumber) || {};
                });
            });
            
            // Remove the original template row
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
    
    // --- Attendance Sheet Functions ---

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
                let scheduleCode = dayData.status || '';
                if (scheduleCode === 'HOL OFF') {
                    scheduleCode = 'HOL OFF';
                }
                // For Attendance Sheet, map 'FREE' to 'OFF'
                if (scheduleCode === 'FREE') {
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
            const buffer = Buffer.from(attendanceTemplate, 'binary');
            await workbook.xlsx.load(buffer);

            const worksheet = workbook.worksheets[0];
            if (!worksheet) throw new Error("Template worksheet not found.");

            const displayedDays = eachDayOfInterval({ start: attendanceDateRange.from, end: attendanceDateRange.to });

            // Find and replace header placeholders
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
                                cell.value = cellText.replace(`{{day_${i + 1}}}`, String(getDate(displayedDays[i])));
                            }
                        }
                    }
                });
            });

            // Find and replace employee data placeholders
            for (let i = 0; i < data.rows.length; i++) {
                const employeeDataRow = data.rows[i]; // [Name, Group, Position, Day1, Day2, ...]
                const employeeIndex = i + 1; // 1-based index for placeholders

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
                                    cell.value = cellText.replace(`{{schedule_${employeeIndex}_${dayIndex + 1}}}`, scheduleCode);
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
            toast({ variant: 'destructive', title: 'Template Error', description: (error as Error).message, duration: 8000 });
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
    
    // --- User Summary Functions ---

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
                l.status === 'approved' &&
                l.startDate && l.endDate &&
                isWithinInterval(new Date(l.startDate), { start: summaryDateRange.from!, end: summaryDateRange.to! })
            );

            const totalHours = shiftsInRange.reduce((acc, shift) => {
                if (!shift.startTime || !shift.endTime) return acc;
                const start = parse(shift.startTime, 'HH:mm', new Date());
                const end = parse(shift.endTime, 'HH:mm', new Date());
                let diff = (end.getTime() - start.getTime()) / (1000 * 60 * 60);
                if (diff < 0) diff += 24;

                let breakHours = 0;
                if (shift.isUnpaidBreak && shift.breakStartTime && shift.breakEndTime) {
                    const breakStart = parse(shift.breakStartTime, 'HH:mm', new Date());
                    const breakEnd = parse(shift.breakEndTime, 'HH:mm', new Date());
                    if (!isNaN(breakStart.getTime()) || !isNaN(breakEnd.getTime())) {
                      let breakDiff = (breakEnd.getTime() - breakStart.getTime()) / (1000 * 60 * 60);
                      if (breakDiff < 0) breakDiff += 24;
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
                totalHours.toFixed(2),
                ...leaveCounts
            ]);
        });

        // Calculate Totals
        const totals = new Array(headers.length - 1).fill(0);
        rows.forEach(row => {
            for (let i = 1; i < row.length; i++) {
                totals[i - 1] += Number(row[i]) || 0;
            }
        });

        const totalRow: (string | number)[] = ['TOTAL', ...totals.map((t, i) => i === 1 ? t.toFixed(2) : t)];
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
        
        worksheet.addRows(data.rows);
        
        const headerRow = worksheet.getRow(1);
        headerRow.font = { bold: true };

        // Bold the last row (TOTAL)
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

    // --- Cumulative Tardy Report ---
    const generateTardyReportData = (): ReportData | null => {
        if (!tardyDateRange || !tardyDateRange.from || !tardyDateRange.to) {
             toast({ variant: 'destructive', title: 'No Date Range', description: 'Please select a covered period for the summary.' });
            return null;
        }

        // 1. Get TARDY leave requests
        const tardyLeave = leave
            .filter(l => l.type === 'TARDY' && l.status === 'approved' && l.startDate && isWithinInterval(new Date(l.startDate), {start: tardyDateRange.from!, end: tardyDateRange.to!}))
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
        
        // 2. Filter imported records by date
        const filteredImportedRecords = tardyRecords.filter(r => 
            isWithinInterval(new Date(r.date), {start: tardyDateRange.from!, end: tardyDateRange.to!})
        );
        
        // 3. Combine and de-duplicate (imported takes precedence)
        const combinedRecords = [...filteredImportedRecords];
        const importedKeys = new Set(filteredImportedRecords.map(r => `${r.employeeId}-${format(new Date(r.date), 'yyyy-MM-dd')}`));
        
        tardyLeave.forEach(l => {
            if (!l.employeeId) return;
            const key = `${l.employeeId}-${format(new Date(l.date), 'yyyy-MM-dd')}`;
            if (!importedKeys.has(key)) {
                combinedRecords.push(l);
            }
        });

        // 4. Sort and format for the table
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
        
        worksheet.addRows(data.rows);
        
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
    
    // --- WFH Certification Functions ---
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
                     const start = parse(dayData.shift.startTime, 'HH:mm', new Date());
                    const end = parse(dayData.shift.endTime, 'HH:mm', new Date());
                    let diff = (end.getTime() - start.getTime()) / (1000 * 60 * 60);
                    if (diff < 0) diff += 24;

                    let breakHours = 0;
                    if (dayData.shift.isUnpaidBreak && dayData.shift.breakStartTime && dayData.shift.breakEndTime) {
                        const breakStart = parse(dayData.shift.breakStartTime, 'HH:mm', new Date());
                        const breakEnd = parse(dayData.shift.breakEndTime, 'HH:mm', new Date());
                        if (!isNaN(breakStart.getTime()) || !isNaN(breakEnd.getTime())) {
                           let breakDiff = (breakEnd.getTime() - breakStart.getTime()) / (1000 * 60 * 60);
                            if (breakDiff < 0) breakDiff += 24;
                            breakHours = breakDiff; 
                        }
                    }
                    totalHrs = (diff - breakHours).toFixed(2);
                }
            } else {
                includeRow = false; // Ignore days with no activity
            }
            
            if (dayData.status === 'FREE' || dayData.status === 'HOL OFF') {
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
            const buffer = Buffer.from(wfhCertTemplate, 'binary');
            await workbook.xlsx.load(buffer);
            const worksheet = workbook.worksheets[0];
            if (!worksheet) throw new Error("Template worksheet not found.");
    
            const manager = employees.find(e => e.id === currentUser.reportsTo);
    
            // Global placeholders
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
                        cell.value = replacePlaceholders(cell.value);
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
            
            // Insert and populate data rows
            data.forEach((rowData, index) => {
                const newRow = worksheet.insertRow(templateRowNumber + index + 1, {});
                 templateRow!.eachCell({ includeEmpty: true }, (templateCell, colNumber) => {
                    const newCell = newRow.getCell(colNumber);
                    newCell.style = { ...templateCell.style };
                });

                for (const key in placeholderMap) {
                    const dataKey = key as keyof WfhCertRowData;
                    const col = placeholderMap[dataKey];
                    newRow.getCell(col).value = rowData[dataKey];
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
    
    // --- Work Extension Functions ---
    const generateWorkExtensionData = (): WorkExtensionRowData[] | null => {
         if (!workExtensionDateRange || !workExtensionDateRange.from || !workExtensionDateRange.to) {
            toast({ variant: 'destructive', title: 'No Date Range', description: 'Please select a covered period for the report.' });
            return null;
        }

        const extensionRequests = leave.filter(l => 
            l.type === 'Work Extension' &&
            l.status === 'approved' &&
            l.originalShiftDate &&
            isWithinInterval(new Date(l.originalShiftDate), { start: workExtensionDateRange.from!, end: workExtensionDateRange.to! })
        );
        
        const data: WorkExtensionRowData[] = extensionRequests.map(req => {
            const employee = employees.find(e => e.id === req.employeeId);
            
            let totalHours = '';
            if (req.startTime && req.endTime) {
                 const start = parse(req.startTime, 'HH:mm', new Date());
                 const end = parse(req.endTime, 'HH:mm', new Date());
                 let diff = (end.getTime() - start.getTime()) / (1000 * 60 * 60);
                 if (diff < 0) diff += 24;
                 totalHours = diff.toFixed(2);
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
            const buffer = Buffer.from(workExtensionTemplate, 'binary');
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
                const row = worksheet.getRow(templateRowNumber + index);
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
                            .replace('{{total_hours_extended}}', rowData.total_hours_extended)
                            .replace('{{reason}}', rowData.reason);
                    }
                    const cell = row.getCell(colNumber);
                    cell.value = finalValue;
                    cell.style = templateCellStyles.get(colNumber) || {};
                });
            });
            
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
    
    // --- Overtime/ND Functions ---
    const generateOvertimeData = (): OvertimeRowData[] | null => {
        if (!overtimeDateRange || !overtimeDateRange.from || !overtimeDateRange.to) {
            toast({ variant: 'destructive', title: 'No Date Range', description: 'Please select a covered period for the report.' });
            return null;
        }
    
        const applicableEmployees = employees.filter(e => ndClassifications.includes(e.employeeClassification || ''));
        const data: OvertimeRowData[] = [];
        const daysInInterval = eachDayOfInterval({ start: overtimeDateRange.from, end: overtimeDateRange.to });
    
        applicableEmployees.forEach(employee => {
            daysInInterval.forEach(day => {
                // OT Calculations
                const workExtensionsOnDay = leave.filter(l =>
                    l.employeeId === employee.id &&
                    l.type === 'Work Extension' &&
                    l.status === 'approved' &&
                    l.startDate &&
                    isSameDay(new Date(l.startDate), day)
                );
    
                workExtensionsOnDay.forEach(ext => {
                    if (ext.startTime && ext.endTime && ext.startDate) {
                        const start = parse(ext.startTime, 'HH:mm', new Date(ext.startDate));
                        const end = parse(ext.endTime, 'HH:mm', new Date(ext.startDate));
                        if(end < start) end.setDate(end.getDate() + 1);
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
                                'TOTAL HOURS': (otMinutes / 60).toFixed(2),
                                'REASONS/REMARKS': ext.reason || ''
                            });
                        }
                    }
                });
    
                // ND Calculations
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
    
                    // Overlap with today's ND period (e.g., 22:00 to 23:59)
                    const overlapStart1 = Math.max(shiftStart.getTime(), ndPeriodStartToday.getTime());
                    const overlapEnd1 = Math.min(shiftEnd.getTime(), ndPeriodEndToday.getTime());
                    if (overlapEnd1 > overlapStart1) {
                        totalNdMinutes += (overlapEnd1 - overlapStart1) / (1000 * 60);
                    }
    
                    // Overlap with tomorrow's ND period (e.g., 00:00 to 06:00)
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
                           'TOTAL HOURS': (totalNdMinutes / 60).toFixed(2),
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
            const buffer = Buffer.from(overtimeTemplate, 'binary');
            await workbook.xlsx.load(buffer);
            const worksheet = workbook.worksheets[0];
            if (!worksheet) throw new Error("Template worksheet not found.");

            // Handle global placeholders
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
                        cell.value = replacePlaceholders(cell.value);
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
                            templateValue = templateValue.replace(new RegExp(placeholder.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&'), 'g'), rowData[placeholderMap[placeholder as keyof typeof placeholderMap]]);
                        }
                    }
                    newCell.value = templateValue;
                    newCell.style = templateStyles.get(colNumber) || {};
                });
            });

            worksheet.spliceRows(templateRowNumber, 1);
            
            // Handle signature
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


    // --- Event Handlers ---
    
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
                    rows: rawData.map(d => headers.map(h => d[h]))
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
        } else { // second-half
            from = new Date(year, month, 16);
            to = endOfMonth(targetMonth);
        }
        
        setWorkScheduleDateRange({ from, to });
    };

    const reportConfig: Record<ReportType, {
        label: string;
        description: string;
        dateComponent: React.ReactNode;
        templateKey?: keyof typeof templates;
        openUploader?: () => void;
        permissionKey: `report-${ReportType}`;
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
        },
        alaf: {
            label: "ALAF (Leave Form) Template",
            description: "Upload and manage the PDF template for the Application for Leave of Absence Form.",
            permissionKey: 'report-alaf',
            isDateRequired: false,
            dateComponent: <></>,
            templateKey: 'alafTemplate',
            openUploader: () => setIsAlafUploaderOpen(true),
        },
        offset: {
            label: "Offset Request Template",
            description: "Upload and manage the PDF template for Offset Requests.",
            permissionKey: 'report-offset',
            isDateRequired: false,
            dateComponent: <></>,
            templateKey: 'offsetTemplate',
            openUploader: () => setIsOffsetUploaderOpen(true),
        }
    };
    
    const availableReports = Object.entries(reportConfig)
        .filter(([, config]) => userPermissions.includes(config.permissionKey) || (config.permissionKey as string) === 'report-alaf' || (config.permissionKey as string) === 'report-offset') 
        .map(([key]) => key as ReportType);

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
    
    const isDownloadDisabled = (currentReport.templateKey && !templates[currentReport.templateKey]) || (currentReport.isDateRequired && !isDateFilled());
    
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
                        {selectedReportType !== 'alaf' && selectedReportType !== 'offset' && (
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
                        )}
                    </Card>
                </CardContent>
            </Card>
            <ReportTemplateUploader
                isOpen={isWorkScheduleUploaderOpen}
                setIsOpen={setIsWorkScheduleUploaderOpen}
                onTemplateUpload={(data) => setTemplates(prev => ({...prev, workScheduleTemplate: data}))}
            />
            <AttendanceTemplateUploader
                isOpen={isAttendanceUploaderOpen}
                setIsOpen={setIsAttendanceUploaderOpen}
                onTemplateUpload={(data) => setTemplates(prev => ({...prev, attendanceSheetTemplate: data}))}
            />
             <WorkExtensionTemplateUploader
                isOpen={isWorkExtensionUploaderOpen}
                setIsOpen={setIsWorkExtensionUploaderOpen}
                onTemplateUpload={(data) => setTemplates(prev => ({...prev, workExtensionTemplate: data}))}
            />
            <WfhCertificationTemplateUploader
                isOpen={isWfhCertUploaderOpen}
                setIsOpen={setIsWfhCertUploaderOpen}
                onTemplateUpload={(data) => setTemplates(prev => ({...prev, wfhCertificationTemplate: data}))}
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
                onTemplateUpload={(data) => setTemplates(prev => ({...prev, overtimeTemplate: data}))}
            />
             <AlafTemplateUploader 
                isOpen={isAlafUploaderOpen}
                setIsOpen={setIsAlafUploaderOpen}
                onTemplateUpload={(data) => setTemplates(prev => ({...prev, alafTemplate: data}))}
            />
            <OffsetTemplateUploader
                isOpen={isOffsetUploaderOpen}
                setIsOpen={setIsOffsetUploaderOpen}
                onTemplateUpload={(data) => setTemplates(prev => ({...prev, offsetTemplate: data}))}
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
