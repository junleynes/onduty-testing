'use client';

import React, { useState, useMemo, useEffect, useTransition } from 'react';
import { addDays, format, eachDayOfInterval, isSameDay, startOfWeek, endOfWeek, subDays, startOfMonth, endOfMonth, getDay, addMonths, isToday, getISOWeek, eachWeekOfInterval, lastDayOfMonth, getDate, parse, isWithinInterval, startOfDay, startOfYear, endOfYear, eachMonthOfInterval, endOfDay } from 'date-fns';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import type { Employee, Shift, Leave, Notification, Note, Holiday, Task, SmtpSettings } from '@/types';
import { Avatar, AvatarFallback, AvatarImage } from './ui/avatar';
import { Button } from './ui/button';
import { PlusCircle, ChevronLeft, ChevronRight, Calendar as CalendarIcon, Copy, CircleSlash, UserX, Download, Upload, Settings, Save, Send, MoreVertical, ChevronsUpDown, Users, Clock, Briefcase, GripVertical, StickyNote, PartyPopper, Mail, Loader2, Trash2, FileSpreadsheet } from 'lucide-react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Calendar } from './ui/calendar';
import { cn, getInitials, getBackgroundColor, getFullName } from '@/lib/utils';
import { ShiftEditor, type ShiftTemplate, type ShiftWithRepeat } from './shift-editor';
import { LeaveEditor } from './leave-editor';
import { Progress } from './ui/progress';
import { ShiftBlock } from './shift-block';
import { DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from './ui/dropdown-menu';
import { useToast } from '@/hooks/use-toast';
import { ScheduleImporter } from './schedule-importer';
import { TemplateImporter } from './template-importer';
import { LeaveTypeEditor, type LeaveTypeOption } from './leave-type-editor';
import { LeaveTypeImporter } from './leave-type-importer';
import { Tooltip, TooltipProvider, TooltipContent, TooltipTrigger } from './ui/tooltip';
import * as ExcelJS from 'exceljs';
import { saveAs } from 'file-saver';
import { sendEmail } from '@/app/actions';
import { Dialog, DialogHeader, DialogTitle, DialogDescription, DialogFooter, DialogContent } from './ui/dialog';
import { Label } from './ui/label';
import { Input } from './ui/input';
import { v4 as uuidv4 } from 'uuid';

type ViewMode = 'day' | 'week' | 'month';

type ScheduleViewProps = {
  employees: Employee[];
  setEmployees: React.Dispatch<React.SetStateAction<Employee[]>>;
  shifts: Shift[];
  setShifts: React.Dispatch<React.SetStateAction<Shift[]>>;
  leave: Leave[];
  setLeave: React.Dispatch<React.SetStateAction<Leave[]>>;
  notes: Note[];
  setNotes: React.Dispatch<React.SetStateAction<Note[]>>;
  holidays: Holiday[];
  setHolidays: React.Dispatch<React.SetStateAction<Holiday[]>>;
  tasks: Task[];
  setTasks: React.Dispatch<React.SetStateAction<Task[]>>;
  currentUser: Employee;
  onPublish: () => void;
  addNotification: (notification: Omit<Notification, 'id' | 'timestamp' | 'isRead'>) => void;
  onViewNote: (note: Note | Holiday | Partial<Note>) => void;
  onEditNote: (note: Partial<Note>) => void;
  onManageHolidays: () => void;
  smtpSettings: SmtpSettings;
  shiftTemplates: ShiftTemplate[];
  setShiftTemplates: React.Dispatch<React.SetStateAction<ShiftTemplate[]>>;
  leaveTypes: LeaveTypeOption[];
  setLeaveTypes: React.Dispatch<React.SetStateAction<LeaveTypeOption[]>>;
  monthlyEmployeeOrder: Record<string, string[]>;
  setMonthlyEmployeeOrder: React.Dispatch<React.SetStateAction<Record<string, string[]>>>;
}

export default function ScheduleView({ employees, setEmployees, shifts, setShifts, leave, setLeave, notes, setNotes, holidays, setTasks, tasks, setHolidays, currentUser, onPublish, addNotification, onViewNote, onEditNote, onManageHolidays, smtpSettings, shiftTemplates, setShiftTemplates, leaveTypes, setLeaveTypes, monthlyEmployeeOrder, setMonthlyEmployeeOrder }: ScheduleViewProps) {
  const isReadOnly = currentUser?.role === 'member';
  
  const visibleEmployees = useMemo(() => employees.filter(e => e.visibility?.schedule !== false), [employees]);

  const [currentDate, setCurrentDate] = useState(new Date());
  const [viewMode, setViewMode] = useState<ViewMode>('week');
  const [isShiftEditorOpen, setIsShiftEditorOpen] = useState(false);
  const [editingShift, setEditingShift] = useState<Shift | Partial<Shift> | null>(null);
  
  const [viewEmployeeOrder, setViewEmployeeOrder] = useState<string[] | null>(null);

  useEffect(() => {
    const monthKey = format(currentDate, 'yyyy-MM');
    if (monthlyEmployeeOrder[monthKey]) {
        setViewEmployeeOrder(monthlyEmployeeOrder[monthKey]);
    } else {
        setViewEmployeeOrder(null);
    }
  }, [currentDate, monthlyEmployeeOrder]);

  const [isLeaveEditorOpen, setIsLeaveEditorOpen] = useState(false);
  const [editingLeave, setEditingLeave] = useState<Partial<Leave> | null>(null);
  
  const [isLeaveTypeEditorOpen, setIsLeaveTypeEditorOpen] = useState(false);
  const [isLeaveTypeImporterOpen, setIsLeaveTypeImporterOpen] = useState(false);

  const [isImporterOpen, setIsImporterOpen] = useState(false);
  const [isTemplateImporterOpen, setIsTemplateImporterOpen] = useState(false);
  const [isExportDialogOpen, setIsExportDialogOpen] = useState(false);
  
  const [weekTemplate, setWeekTemplate] = useState<Omit<Shift, 'id' | 'date'>[] | null>(null);
  const { toast } = useToast();

  const dateRange = useMemo(() => {
    switch (viewMode) {
        case 'day':
            return { from: currentDate, to: currentDate };
        case 'week':
            return { from: startOfWeek(currentDate, { weekStartsOn: 1 }), to: endOfWeek(currentDate, { weekStartsOn: 1 }) };
        case 'month':
            return { from: startOfMonth(currentDate), to: endOfMonth(currentDate) };
        default:
            return { from: startOfWeek(currentDate, { weekStartsOn: 1 }), to: endOfWeek(currentDate, { weekStartsOn: 1 }) };
    }
  }, [currentDate, viewMode]);
  
  const displayedDays = useMemo(() => {
    if (dateRange?.from && dateRange.to && viewMode !== 'month') {
      try {
        return eachDayOfInterval({ start: dateRange.from, end: dateRange.to });
      } catch (e) {
        return [];
      }
    }
    return [];
  }, [dateRange, viewMode]);

  const firstHalfDays = useMemo(() => {
    if (viewMode !== 'month') return [];
    try {
        const monthStart = startOfMonth(currentDate);
        const day15 = addDays(monthStart, 14);
        return eachDayOfInterval({ start: monthStart, end: day15 });
    } catch (e) {
        return [];
    }
  }, [currentDate, viewMode]);

  const secondHalfDays = useMemo(() => {
    if (viewMode !== 'month') return [];
    try {
        const day16 = addDays(startOfMonth(currentDate), 15);
        const monthEnd = endOfMonth(currentDate);
        if (day16 > monthEnd) return [];
        return eachDayOfInterval({ start: day16, end: monthEnd });
    } catch (e) {
        return [];
    }
  }, [currentDate, viewMode]);
  
  const orderedEmployees = useMemo(() => {
    const employeeMap = new Map(visibleEmployees.map(e => [e.id, e]));
    let baseEmployees = [...visibleEmployees].sort((a,b) => a.lastName.localeCompare(b.lastName));

    if (viewEmployeeOrder) {
      const orderedSet = new Set(viewEmployeeOrder);
      const ordered = viewEmployeeOrder.map(id => employeeMap.get(id)).filter((e): e is Employee => !!e);
      const unordered = baseEmployees.filter(e => !orderedSet.has(e.id));
      baseEmployees = [...ordered, ...unordered];
    }
      
    return [
      { id: 'unassigned', firstName: 'Unassigned Shifts', lastName: '', role: 'member', position: 'Special', avatar: '' } as Employee,
      ...baseEmployees
    ];
  }, [visibleEmployees, viewEmployeeOrder]);
  

  const handleAddShiftClick = () => {
    if (isReadOnly) return;
    setEditingShift({});
    setIsShiftEditorOpen(true);
  };
  
  const handleAddLeaveClick = () => {
    if (isReadOnly) return;
    setEditingLeave({ type: 'VL', isAllDay: true, startDate: new Date(), endDate: new Date() });
    setIsLeaveEditorOpen(true);
  };

  const handleEmptyCellClick = (employeeId: string | null, date: Date) => {
    if (isReadOnly) return;
    setEditingShift({ employeeId, date, status: 'draft' });
    setIsShiftEditorOpen(true);
  };
  
  const handleNoteCellClick = (date: Date) => {
    const existingNote = notes.find(n => isSameDay(new Date(n.date), date));
    const holiday = holidays.find(h => isSameDay(new Date(h.date), date));

    if (existingNote) {
        onViewNote(existingNote);
    } else if (holiday) {
        onViewNote(holiday);
    } else if (!isReadOnly) {
        onEditNote({ date });
    }
  };


  const handleEditItemClick = (item: Shift | Leave) => {
    if (isReadOnly) return;
    if ('label' in item) {
        setEditingShift(item);
        setIsShiftEditorOpen(true);
    } else {
        setEditingLeave(item);
        setIsLeaveEditorOpen(true);
    }
  };

  const handleSaveShift = (savedShift: ShiftWithRepeat) => {
    if (isReadOnly) return;
    const isEditing = !!savedShift.id;
    const employee = employees.find(e => e.id === savedShift.employeeId);
    const employeeName = employee ? getFullName(employee) : 'Unassigned';

    if (isEditing) {
        setShifts(shifts.map(s => s.id === savedShift.id ? { ...s, ...savedShift, status: 'draft' } as Shift : s));
        addNotification({ message: `Shift for ${employeeName} on ${format(savedShift.date, 'MMM d')} was updated.` });
    } else {
        const newShifts: Shift[] = [];
        const baseShift: Omit<Shift, 'id' | 'date'> = {
            employeeId: savedShift.employeeId,
            label: savedShift.label!,
            startTime: savedShift.startTime!,
            endTime: savedShift.endTime!,
            color: savedShift.color,
            isDayOff: savedShift.isDayOff,
            isHolidayOff: savedShift.isHolidayOff,
            status: 'draft',
            breakStartTime: savedShift.breakStartTime,
            breakEndTime: savedShift.breakEndTime,
            isUnpaidBreak: savedShift.isUnpaidBreak,
        };

        if (savedShift.repeat) {
            if (savedShift.repeatType === 'occurrences' && savedShift.repeatOccurrences) {
                for (let i = 0; i < savedShift.repeatOccurrences; i++) {
                    const shiftDate = addDays(savedShift.date, i);
                    newShifts.push({ ...baseShift, id: uuidv4(), date: shiftDate });
                }
            } else if (savedShift.repeatType === 'untilDate' && savedShift.repeatUntil) {
                let currentDate = savedShift.date;
                while (currentDate <= savedShift.repeatUntil) {
                    newShifts.push({ ...baseShift, id: uuidv4(), date: currentDate });
                    currentDate = addDays(currentDate, 1);
                }
            }
        } else {
            newShifts.push({ ...baseShift, id: uuidv4(), date: savedShift.date });
        }
        
        if (newShifts.length > 0) {
            setShifts(prev => [...prev, ...newShifts]);
            const notificationMessage = newShifts.length > 1 
                ? `${newShifts.length} shifts created for ${employeeName}.`
                : `New shift created for ${employeeName} on ${format(savedShift.date, 'MMM d')}.`;
            addNotification({ message: notificationMessage });
        }
    }
    setIsShiftEditorOpen(false);
    setEditingShift(null);
  };
  
  const handleDeleteShift = (shiftId: string) => {
    if (isReadOnly) return;
    const deletedShift = shifts.find(s => s.id === shiftId);
    if(deletedShift) {
      const employee = employees.find(e => e.id === deletedShift.employeeId);
      const employeeName = employee ? getFullName(employee) : 'Unassigned';
      addNotification({ message: `Shift for ${employeeName} on ${format(deletedShift.date!, 'MMM d')} was deleted.` });
    }
    setShifts(shifts.filter(s => s.id !== shiftId));
    setTasks(tasks.filter(t => t.shiftId !== shiftId));
    setIsShiftEditorOpen(false);
    setEditingShift(null);
    toast({ title: "Shift Deleted", variant: "destructive" });
  };


  const handleSaveLeave = (savedLeave: Leave | Partial<Leave>) => {
    if (isReadOnly) return;
    const employeeName = getFullName(employees.find(e => e.id === savedLeave.employeeId)!);
    if (savedLeave.id) {
        setLeave(leave.map(l => l.id === savedLeave.id ? savedLeave as Leave : l));
        addNotification({ message: `Time off for ${employeeName} on ${format(savedLeave.startDate!, 'MMM d')} was updated.` });
        toast({ title: "Leave Updated" });
    } else {
        const newLeaveWithId = { ...savedLeave, id: uuidv4() } as Leave;
        setLeave(prevLeave => [...prevLeave, newLeaveWithId]);
        addNotification({ message: `Time off for ${employeeName} on ${format(savedLeave.startDate!, 'MMM d')}.` });
        toast({ title: "Time Off Added" });
    }
    setIsLeaveEditorOpen(false);
    setEditingLeave(null);
  };
  
  const handleDeleteLeave = (leaveId: string) => {
    if (isReadOnly) return;
    const deletedLeave = leave.find(l => l.id === leaveId);
     if(deletedLeave) {
      const employeeName = getFullName(employees.find(e => e.id === deletedLeave.employeeId)!);
      addNotification({ message: `Time off for ${employeeName} on ${format(deletedLeave.startDate!, 'MMM d')} was deleted.` });
    }
    setLeave(leave.filter(l => l.id !== leaveId));
    setIsLeaveEditorOpen(false);
    setEditingLeave(null);
    toast({ title: "Leave Deleted", variant: "destructive" });
  };

  const navigateDate = (direction: 'prev' | 'next') => {
      let daysToAdd = 0;
      if (viewMode === 'week') daysToAdd = 7;
      if (viewMode === 'day') daysToAdd = 1;
      
      let newDate;
      if (viewMode === 'month') {
        newDate = addMonths(currentDate, direction === 'prev' ? -1 : 1);
      } else {
        newDate = addDays(currentDate, direction === 'prev' ? -daysToAdd : daysToAdd);
      }
      setCurrentDate(newDate);
  }
  
  const handleClearWeek = () => {
    if (isReadOnly) return;
    const shiftIdsInView = new Set(shifts.filter(shift => displayedDays.some(day => isSameDay(new Date(shift.date), day))).map(s => s.id));
    
    setShifts(shifts.filter(shift => !displayedDays.some(day => isSameDay(new Date(shift.date), day))));
    setLeave(leave.filter(l => {
        const startDate = new Date(l.startDate);
        const endDate = new Date(l.endDate || l.startDate);
        return !displayedDays.some(day => isWithinInterval(startOfDay(day), { start: startOfDay(startDate), end: startOfDay(endDate) }));
    }));
    setTasks(tasks.filter(t => !t.shiftId || !shiftIdsInView.has(t.shiftId)));
    
    toast({ title: "Week Cleared", description: "All shifts, tasks, and time off for the current week have been removed." });
  };
  
  const handleClearMonth = () => {
    if (isReadOnly) return;
    const monthStart = startOfMonth(currentDate);
    const monthEnd = endOfMonth(currentDate);
    
    const shiftIdsInMonth = new Set(shifts.filter(shift => new Date(shift.date) >= monthStart && new Date(shift.date) <= monthEnd).map(s => s.id));
    
    setShifts(shifts.filter(shift => new Date(shift.date) < monthStart || new Date(shift.date) > monthEnd));
    setLeave(leave.filter(l => !l.endDate || new Date(l.endDate) < monthStart || new Date(l.startDate) > monthEnd));
    setTasks(tasks.filter(t => !t.shiftId || !shiftIdsInMonth.has(t.shiftId)));

    toast({ title: "Month Cleared", description: "All shifts, tasks, and time off for the current month have been removed." });
  };

  const handleClearYear = () => {
    if (isReadOnly) return;
    const currentYear = currentDate.getFullYear();
    const shiftIdsInYear = new Set(shifts.filter(shift => new Date(shift.date).getFullYear() === currentYear).map(s => s.id));

    setShifts(shifts.filter(shift => new Date(shift.date).getFullYear() !== currentYear));
    setLeave(leave.filter(l => new Date(l.startDate).getFullYear() !== currentYear));
    setTasks(tasks.filter(t => !t.shiftId || !shiftIdsInYear.has(t.shiftId)));

    toast({ title: "Year Cleared", description: `All shifts, tasks, and time off for ${currentYear} have been removed.` });
  };

  const handleClearDraft = () => {
    if (isReadOnly) return;
    const draftShiftIds = new Set(shifts.filter(shift => shift.status === 'draft').map(s => s.id));
    setShifts(shifts.filter(shift => shift.status !== 'draft'));
    setTasks(tasks.filter(t => !t.shiftId || !draftShiftIds.has(t.shiftId)));
    toast({ title: "Drafts Cleared", description: "All unpublished shifts and their tasks have been removed." });
  };


  const handleUnassignWeek = () => {
    if (isReadOnly) return;
    setShifts(currentShifts => currentShifts.map(shift => 
      displayedDays.some(day => isSameDay(new Date(shift.date), day)) 
        ? { ...shift, employeeId: null } 
        : shift
    ));
    toast({ title: "Week Unassigned", description: "All shifts for the current week have been moved to unassigned." });
  };

  const handleUnassignMonth = () => {
    if (isReadOnly) return;
    const monthStart = startOfMonth(currentDate);
    const monthEnd = endOfMonth(currentDate);
    setShifts(currentShifts => currentShifts.map(shift => 
      new Date(shift.date) >= monthStart && new Date(shift.date) <= monthEnd
        ? { ...shift, employeeId: null } 
        : shift
    ));
    toast({ title: "Month Unassigned", description: "All shifts for the current month have been moved to unassigned." });
  };

  const handleCopyPreviousWeek = () => {
    if (isReadOnly) return;
    const prevWeekStart = subDays(dateRange.from, 7);
    const prevWeekEnd = subDays(dateRange.to, 7);
    const prevWeekShifts = shifts.filter(shift => new Date(shift.date) >= prevWeekStart && new Date(shift.date) <= prevWeekEnd);

    const newShifts = prevWeekShifts.map(shift => ({
      ...shift,
      id: uuidv4(),
      date: addDays(new Date(shift.date), 7),
      status: 'draft' as const,
    }));

    setShifts(currentShifts => [...currentShifts, ...newShifts]);
    toast({ title: "Previous Week Copied", description: "Shifts from the previous week have been copied over." });
  };

  const handleSaveTemplate = () => {
    if (isReadOnly) return;
    const shiftsInView = shifts.filter(shift => displayedDays.some(day => isSameDay(new Date(shift.date), day)));
    const template = shiftsInView.map(({ id, date, ...rest }) => ({
      ...rest,
      dayOfWeek: new Date(date).getDay(),
    }));
    setWeekTemplate(template as any);
    toast({ title: "Template Saved", description: "Current week's layout has been saved as a template." });
  };

  const handleLoadTemplate = () => {
    if (isReadOnly) return;
    if (!weekTemplate) {
      toast({ variant: 'destructive', title: "No Template Saved", description: "Save a week as a template first." });
      return;
    }
    
    const shiftsOutsideCurrentWeek = shifts.filter(shift => !displayedDays.some(day => isSameDay(new Date(shift.date), day)));
    
    const newShifts = weekTemplate.map((templateShift: any) => {
        const targetDay = displayedDays.find(d => d.getDay() === templateShift.dayOfWeek);
        if (!targetDay) return null;
        
        const { dayOfWeek, ...rest } = templateShift;
        return {
            ...rest,
            id: uuidv4(),
            date: targetDay,
            status: 'draft',
        };
    }).filter(Boolean);

    setShifts([...shiftsOutsideCurrentWeek, ...newShifts as Shift[]]);
    toast({ title: "Template Loaded", description: "The saved template has been applied to the current week." });
  };

  const handleImportedData = (importedData: {
    shifts: Shift[];
    leave: Leave[];
    monthlyOrders: Record<string, string[]>;
    overwrittenCells: { employeeId: string; date: Date }[];
    monthKeys: string[];
  }) => {
    const { shifts: importedShifts, leave: importedLeave, monthlyOrders, overwrittenCells, monthKeys } = importedData;
  
    const cellsToOverwrite = new Set(
      overwrittenCells.map(cell => `${cell.employeeId}-${format(cell.date, 'yyyy-MM-dd')}`)
    );
  
    const shiftIdsBeingOverwritten = new Set(shifts.filter(s => 
        s.employeeId && cellsToOverwrite.has(`${s.employeeId}-${format(new Date(s.date), 'yyyy-MM-dd')}`)
    ).map(s => s.id));

    const remainingShifts = shifts.filter(s => 
        !s.employeeId || !cellsToOverwrite.has(`${s.employeeId}-${format(new Date(s.date), 'yyyy-MM-dd')}`)
    );
    
    const remainingLeave = leave.filter(l => {
        if (!l.employeeId || !l.startDate || !l.endDate) return true;
        
        const start = new Date(l.startDate);
        const end = new Date(l.endDate);
        
        if (isNaN(start.getTime()) || isNaN(end.getTime())) return true;
        
        try {
            const daysOfLeave = eachDayOfInterval({ start, end });
            const isOverwritten = daysOfLeave.some(day => cellsToOverwrite.has(`${l.employeeId}-${format(day, 'yyyy-MM-dd')}`));
            return !isOverwritten;
        } catch (e) {
            return true;
        }
    });

    const shiftsWithStatus = importedShifts.map(s => ({ ...s, status: 'draft' as const }));

    setShifts([...remainingShifts, ...shiftsWithStatus]);
    setLeave([...remainingLeave, ...importedLeave]);
    setTasks(tasks.filter(t => !t.shiftId || !shiftIdsBeingOverwritten.has(t.shiftId)));
    
    setMonthlyEmployeeOrder(prev => ({
        ...prev,
        ...monthlyOrders,
    }));

    const currentMonthKey = format(currentDate, 'yyyy-MM');
    if (monthKeys && monthKeys.includes(currentMonthKey)) {
        setViewEmployeeOrder(monthlyOrders[currentMonthKey]);
    }
  };
  
  const handleImportTemplates = (importedTemplates: ShiftTemplate[]) => {
      setShiftTemplates(prev => [...prev, ...importedTemplates]);
  };

  const handleImportLeaveTypes = (importedLeaveTypes: LeaveTypeOption[]) => {
    setLeaveTypes(currentTypes => {
        const typeMap = new Map(currentTypes.map(t => [t.type, t]));
        importedLeaveTypes.forEach(t => typeMap.set(t.type, t));
        return Array.from(typeMap.values());
    });
    toast({ title: 'Import Successful', description: `${importedLeaveTypes.length} leave types imported or updated.`})
  };

  const handleSaveDraft = () => {
    toast({ title: "Draft Saved", description: "Your schedule changes have been saved." });
  };

  const handleShiftDragStart = (e: React.DragEvent<HTMLDivElement>, item: Shift | Leave) => {
    if (isReadOnly) return;
    e.dataTransfer.setData("itemId", item.id);
    const itemType = 'label' in item ? 'shift' : 'leave';
    e.dataTransfer.setData("itemType", itemType);
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleShiftDrop = (e: React.DragEvent<HTMLDivElement>, targetEmployeeId: string | null, targetDate: Date) => {
    if (isReadOnly) return;
    e.preventDefault();
    const itemId = e.dataTransfer.getData("itemId");
    const itemType = e.dataTransfer.getData("itemType");
    
    if (itemType === 'shift') {
      setShifts(prevShifts => 
        prevShifts.map(shift =>
          shift.id === itemId
            ? { ...shift, employeeId: targetEmployeeId, date: targetDate, status: 'draft' }
            : shift
        )
      );
    } else if (itemType === 'leave') {
       setLeave(prevLeave => 
        prevLeave.map(l =>
          l.id === itemId
            ? { ...l, employeeId: targetEmployeeId!, startDate: targetDate, endDate: targetDate }
            : l
        )
      );
    }
  };
  
  const handleEmployeeDragStart = (e: React.DragEvent<HTMLDivElement>, employeeId: string) => {
    if (isReadOnly) return;
    e.dataTransfer.setData('draggedEmployeeId', employeeId);
    e.dataTransfer.effectAllowed = 'move';
  };
  
  const handleEmployeeDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    if (isReadOnly) return;
    e.preventDefault();
    const draggedEmployeeId = e.dataTransfer.getData('draggedEmployeeId');
    if (!draggedEmployeeId) return;
    e.dataTransfer.dropEffect = 'move';
  };
  
  const handleEmployeeDrop = (e: React.DragEvent<HTMLDivElement>, targetEmployeeId: string) => {
    if (isReadOnly) return;
    e.preventDefault();
    const draggedEmployeeId = e.dataTransfer.getData('draggedEmployeeId');
    if (!draggedEmployeeId || draggedEmployeeId === targetEmployeeId) return;

    const currentOrder = viewEmployeeOrder || visibleEmployees.map(e => e.id);
    const draggedIndex = currentOrder.indexOf(draggedEmployeeId);
    const targetIndex = currentOrder.indexOf(targetEmployeeId);

    if (draggedIndex === -1 || targetIndex === -1) return;

    const newOrder = [...currentOrder];
    const [draggedItem] = newOrder.splice(draggedIndex, 1);
    newOrder.splice(targetIndex, 0, draggedItem);
    
    const monthKey = format(currentDate, 'yyyy-MM');
    setMonthlyEmployeeOrder(prev => ({
        ...prev,
        [monthKey]: newOrder
    }));
    setViewEmployeeOrder(newOrder);
  };


  const formatRange = (start: Date, end: Date) => {
      if (viewMode === 'month') {
        return format(start, 'MMMM yyyy');
      }
      if (isSameDay(start, end)) {
          return format(start, 'MMM d, yyyy');
      }
      if (start.getFullYear() !== end.getFullYear()) {
          return `${format(start, 'MMM d, yyyy')} - ${format(end, 'MMM d, yyyy')}`;
      }
      if (start.getMonth() !== end.getMonth()) {
          return `${format(start, 'MMM d')} - ${format(end, 'MMM d, yyyy')}`;
      }
      return `${format(start, 'MMM d')} - ${format(end, 'd, yyyy')}`;
  }

  const renderGridHeader = (days: Date[]) => (
     <div className="contents">
        <div className={cn("sticky top-0 left-0 z-30 p-2 bg-card border-b border-r flex items-center justify-center")}>
            <p className="font-semibold text-sm">Employees</p>
        </div>
        {days.map((day) => {
            const shiftsForDay = shifts.filter(shift => isSameDay(new Date(shift.date), day) && !shift.isDayOff && !shift.isHolidayOff);
            const totalShifts = shiftsForDay.length;
            const onDutyEmployees = new Set(shiftsForDay.filter(s => s.employeeId).map(shift => shift.employeeId)).size;
            
            const totalHours = shiftsForDay.reduce((acc, shift) => {
                if (!shift.startTime || !shift.endTime) return acc;
                
                try {
                    const start = parse(shift.startTime, 'HH:mm', new Date());
                    const end = parse(shift.endTime, 'HH:mm', new Date());
                    if (isNaN(start.getTime()) || isNaN(end.getTime())) return acc;

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
                } catch (e) {
                    console.error("Error parsing shift times", e);
                    return acc;
                }
            }, 0);
            
            return (
                <div key={day.toISOString()} className={cn("sticky top-0 z-10 col-start-auto p-2 text-center font-semibold bg-card border-b border-l")}>
                    <div className="text-lg whitespace-nowrap">{format(day, 'E M/d')}</div>
                    <div className="text-xs text-muted-foreground font-normal flex justify-center gap-3 mt-1">
                        <TooltipProvider>
                            <Tooltip>
                                <TooltipTrigger asChild>
                                    <div className="flex items-center gap-1">
                                        <Briefcase className="h-3 w-3" />
                                        <span>{totalShifts}</span>
                                    </div>
                                </TooltipTrigger>
                                <TooltipContent>
                                    <p>{totalShifts} shifts</p>
                                </TooltipContent>
                            </Tooltip>
                            <Tooltip>
                                <TooltipTrigger asChild>
                                    <div className="flex items-center gap-1">
                                        <Users className="h-3 w-3" />
                                        <span>{onDutyEmployees}</span>
                                    </div>
                                </TooltipTrigger>
                                <TooltipContent>
                                    <p>{onDutyEmployees} employees on duty</p>
                                </TooltipContent>
                            </Tooltip>
                            <Tooltip>
                                <TooltipTrigger asChild>
                                    <div className="flex items-center gap-1">
                                        <Clock className="h-3 w-3" />
                                        <span>{totalHours.toFixed(1)}h</span>
                                    </div>
                                </TooltipTrigger>
                                <TooltipContent>
                                    <p>{totalHours.toFixed(1)} scheduled hours</p>
                                </TooltipContent>
                            </Tooltip>
                        </TooltipProvider>
                    </div>
                </div>
            );
        })}
     </div>
  );
  
  const renderNotesRow = (days: Date[]) => (
    <div className="contents">
        <div className="sticky left-0 z-20 p-2 bg-card border-b border-r flex items-center justify-center">
            <p className="font-semibold text-sm">Notes</p>
        </div>
        {days.map(day => {
            const note = notes.find(n => isSameDay(new Date(n.date), day));
            const holiday = holidays.find(h => isSameDay(new Date(h.date), day));

            return (
                <div 
                    key={`note-${day.toISOString()}`}
                    className={cn("group/cell col-start-auto p-1 border-b border-l min-h-[40px] bg-background/30 relative text-xs flex flex-col items-center justify-center cursor-pointer hover:bg-accent")}
                    onClick={() => handleNoteCellClick(day)}
                >
                    {holiday && (
                        <div className="w-full text-center p-1 rounded-sm bg-red-500 text-white">
                            <p className="font-bold truncate">{holiday.title}</p>
                        </div>
                    )}
                    {note && (
                        <div className="cursor-pointer text-center mt-1">
                            <p className="font-bold truncate">{note.title}</p>
                        </div>
                    )}
                    {!note && !holiday && !isReadOnly && (
                        <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover/cell:opacity-100 transition-opacity">
                            <PlusCircle className="h-5 w-5 text-muted-foreground" />
                        </div>
                    )}
                </div>
            )
        })}
    </div>
  )

  const renderEmployeeRow = (employee: Employee, days: Date[]) => {
    const getItemsForDay = (day: Date): (Shift | Leave)[] => {
        const shiftsForDay = shifts.filter(
            (s) => (s.employeeId === employee.id || (employee.id === 'unassigned' && s.employeeId === null)) && isSameDay(new Date(s.date), day)
        );
        
        const leaveForDay = leave.filter(l => {
            if (l.employeeId !== employee.id) return false;
            if (l.type === 'Work Extension') return false; 
            if (!l.startDate || !l.endDate) return false;
            const checkDay = startOfDay(day);
            const leaveStart = startOfDay(new Date(l.startDate));
            const leaveEnd = startOfDay(new Date(l.endDate));
            if (isNaN(leaveStart.getTime()) || isNaN(leaveEnd.getTime())) return false;
            
            return isWithinInterval(checkDay, { start: leaveStart, end: leaveEnd });
        }).map(l => {
            const leaveType = leaveTypes.find(lt => lt.type === l.type);
            return { ...l, color: leaveType?.color || l.color };
        });

        return [...shiftsForDay, ...leaveForDay];
    }
    
    return (
    <div 
        className="contents" 
        key={employee.id} 
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => handleEmployeeDrop(e, employee.id)}
        >
        <div className={cn("sticky left-0 z-20 py-1 px-2 border-b border-r flex items-center gap-3 min-h-[52px] bg-card group")}>
            {!isReadOnly && employee.id !== 'unassigned' && (
              <div draggable onDragStart={(e) => handleEmployeeDragStart(e, employee.id)} className="cursor-grab">
                <GripVertical className="h-5 w-5 text-muted-foreground group-hover:opacity-100 opacity-0 transition-opacity" />
              </div>
            )}
            <div className="flex items-center gap-3">
                 {employee.id !== 'unassigned' ? (
                    <Avatar className="h-9 w-9">
                        <AvatarImage src={employee.avatar} data-ai-hint="profile avatar" />
                        <AvatarFallback style={{ backgroundColor: getBackgroundColor(getFullName(employee)) }}>
                        {getInitials(getFullName(employee))}
                        </AvatarFallback>
                    </Avatar>
                ) : (
                    <div className="w-9 h-9 flex items-center justify-center">
                        <Users className="h-6 w-6 text-muted-foreground" />
                    </div>
                )}
                <div>
                    <p className="font-semibold text-sm">{getFullName(employee)}</p>
                </div>
            </div>
        </div>

        {days.map((day) => {
        const itemsForDay = getItemsForDay(day);
        return (
            <div
            key={`${employee.id}-${day.toISOString()}`}
            className={cn("group/cell col-start-auto p-1 border-b border-l min-h-[52px] space-y-1 bg-background/30 relative",
             viewMode === 'month' && day.getMonth() !== currentDate.getMonth() && 'bg-muted/50',
            )}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => handleShiftDrop(e, employee.id === 'unassigned' ? null : employee.id, day)}
            >
            {itemsForDay.map((item) => (
                <div key={item.id} draggable={!isReadOnly} onDragStart={(e) => handleShiftDragStart(e, item)} className="h-full">
                    <ShiftBlock
                    item={item}
                    onClick={() => !isReadOnly && handleEditItemClick(item)}
                    context="week"
                    />
                </div>
            ))}
            {itemsForDay.length === 0 && !isReadOnly && (
                <Button variant="ghost" className="absolute inset-0 w-full h-full flex items-center justify-center opacity-0 group-hover/cell:opacity-100 transition-opacity" onClick={() => handleEmptyCellClick(employee.id === 'unassigned' ? null : employee.id, day)}>
                <PlusCircle className="h-5 w-5 text-muted-foreground" />
                </Button>
            )}
            </div>
        );
        })}
    </div>
  )};
  
  const renderGridComponent = (days: Date[], title?: string) => (
    <div className="space-y-2">
        {title && <h3 className="font-semibold text-lg px-4 pt-4">{title}</h3>}
        <div className="overflow-auto">
            <div className="grid min-w-max" style={{ gridTemplateColumns: `minmax(180px, 1.5fr) repeat(${days.length}, minmax(140px, 1fr))` }}>
                {renderGridHeader(days)}
                {renderNotesRow(days)}
                {orderedEmployees.map((employee) => renderEmployeeRow(employee, days))}
            </div>
        </div>
    </div>
  );

  return (
    <Card className="h-full flex flex-col">
       <CardHeader>
        <div className="flex flex-col md:flex-row items-start justify-between gap-4">
            <div>
                <CardTitle>Schedule</CardTitle>
                <CardDescription>Drag and drop shifts, manage time off, and publish the schedule for your team.</CardDescription>
            </div>
             {!isReadOnly && (
            <div className="flex items-center gap-2">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button>
                    <PlusCircle className="mr-2 h-4 w-4" />
                    Add
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent>
                  <DropdownMenuItem onClick={handleAddShiftClick}>Add Shift</DropdownMenuItem>
                  <DropdownMenuItem onClick={handleAddLeaveClick}>Add Time Off</DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
                <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                        <Button variant="outline">
                            Actions
                            <ChevronsUpDown className="ml-2 h-4 w-4" />
                        </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                        <DropdownMenuGroup>
                           <DropdownMenuItem onClick={handleSaveDraft}>
                                <Save className="mr-2 h-4 w-4" />
                                <span>Save Draft</span>
                           </DropdownMenuItem>
                           <DropdownMenuItem onClick={onPublish}>
                                <Send className="mr-2 h-4 w-4" />
                                <span>Publish</span>
                           </DropdownMenuItem>
                        </DropdownMenuGroup>
                        <DropdownMenuSeparator />
                        <DropdownMenuGroup>
                            <DropdownMenuItem onClick={() => setIsImporterOpen(true)}>
                                <Upload className="mr-2 h-4 w-4" />
                                <span>Import Schedule</span>
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => setIsTemplateImporterOpen(true)}>
                                <Upload className="mr-2 h-4 w-4" />
                                <span>Import Templates</span>
                            </DropdownMenuItem>
                        </DropdownMenuGroup>
                        <DropdownMenuSeparator />
                         <DropdownMenuGroup>
                            <DropdownMenuItem onClick={handleCopyPreviousWeek} disabled={viewMode !== 'week'}>
                                <Copy className="mr-2 h-4 w-4" />
                                <span>Copy Previous Week</span>
                            </DropdownMenuItem>
                             <DropdownMenuItem onClick={handleSaveTemplate} disabled={viewMode !== 'week'}>
                                <Download className="mr-2 h-4 w-4" />
                                <span>Save as Template</span>
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={handleLoadTemplate} disabled={!weekTemplate || viewMode !== 'week'}>
                                <Upload className="mr-2 h-4 w-4" />
                                <span>Load Template</span>
                            </DropdownMenuItem>
                        </DropdownMenuGroup>
                        <DropdownMenuSeparator />
                         <DropdownMenuGroup>
                             <DropdownMenuItem onClick={() => setIsLeaveTypeEditorOpen(true)}>
                                <Settings className="mr-2 h-4 w-4" />
                                <span>Manage Leave Types</span>
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={onManageHolidays}>
                                <PartyPopper className="mr-2 h-4 w-4" />
                                <span>Manage Holidays</span>
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => setIsExportDialogOpen(true)}>
                                <FileSpreadsheet className="mr-2 h-4 w-4" />
                                <span>Export Semi-Monthly Excel</span>
                            </DropdownMenuItem>
                        </DropdownMenuGroup>
                         <DropdownMenuSeparator />
                         <DropdownMenuGroup>
                            <DropdownMenuItem className="text-red-600 focus:text-red-600" onClick={handleClearWeek}>
                                <CircleSlash className="mr-2 h-4 w-4" />
                                <span>Clear Week</span>
                            </DropdownMenuItem>
                            <DropdownMenuItem className="text-red-600 focus:text-red-600" onClick={handleClearMonth}>
                                <CircleSlash className="mr-2 h-4 w-4" />
                                <span>Clear Month</span>
                            </DropdownMenuItem>
                            <DropdownMenuItem className="text-red-600 focus:text-red-600" onClick={handleClearYear}>
                                <CircleSlash className="mr-2 h-4 w-4" />
                                <span>Clear Year</span>
                            </DropdownMenuItem>
                            <DropdownMenuItem className="text-red-600 focus:text-red-600" onClick={handleClearDraft}>
                                <Trash2 className="mr-2 h-4 w-4" />
                                <span>Clear All Drafts</span>
                            </DropdownMenuItem>
                        </DropdownMenuGroup>
                        <DropdownMenuSeparator />
                        <DropdownMenuGroup>
                             <DropdownMenuItem className="text-red-600 focus:text-red-600" onClick={viewMode === 'month' ? handleUnassignMonth : handleUnassignWeek}>
                                <UserX className="mr-2 h-4 w-4" />
                                <span>Unassign {viewMode === 'month' ? 'Month' : 'Week'}</span>
                            </DropdownMenuItem>
                        </DropdownMenuGroup>
                    </DropdownMenuContent>
                </DropdownMenu>
            </div>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2 w-full justify-end mt-4">
           <Select value={viewMode} onValueChange={(value: ViewMode) => setViewMode(value)}>
            <SelectTrigger className="w-full sm:w-[120px]">
              <SelectValue placeholder="View" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="day">Day</SelectItem>
              <SelectItem value="week">Week</SelectItem>
              <SelectItem value="month">Month</SelectItem>
            </SelectContent>
          </Select>
           <Popover>
              <PopoverTrigger asChild>
              <Button
                  id="date"
                  variant={'outline'}
                  className={cn('w-full md:w-[260px] justify-start text-left font-normal text-sm')}
              >
                  <CalendarIcon className="mr-2 h-4 w-4" />
                  {dateRange?.from ? (
                  formatRange(dateRange.from, dateRange.to)
                  ) : (
                  <span>Pick a date</span>
                  )}
              </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0" align="start">
              <Calendar
                  initialFocus
                  mode="single"
                  selected={currentDate}
                  onSelect={(date) => date && setCurrentDate(date)}
              />
              </PopoverContent>
          </Popover>
          <div className="flex items-center gap-1 rounded-md border bg-card p-1">
              <Button variant="ghost" size="icon" onClick={() => navigateDate('prev')}>
              <ChevronLeft className="h-4 w-4" />
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setCurrentDate(new Date())}>Today</Button>
              <Button variant="ghost" size="icon" onClick={() => navigateDate('next')}>
              <ChevronRight className="h-4 w-4" />
              </Button>
          </div>
        </div>
      </CardHeader>
    
      <CardContent className="flex-1 p-0 overflow-auto">
        <div className="relative h-full">
            {viewMode === 'month' ? (
                <div className="space-y-6">
                    {renderGridComponent(firstHalfDays, "Days 1-15")}
                    {secondHalfDays.length > 0 && renderGridComponent(secondHalfDays, `Days 16-${getDate(endOfMonth(currentDate))}`)}
                </div>
            ) : (
                renderGridComponent(displayedDays)
            )}
        </div>
      </CardContent>

      <ShiftEditor
        isOpen={isShiftEditorOpen}
        setIsOpen={setIsShiftEditorOpen}
        shift={editingShift}
        onSave={handleSaveShift}
        onDelete={handleDeleteShift}
        employees={employees}
        shiftTemplates={shiftTemplates}
        setShiftTemplates={setShiftTemplates}
        tasks={tasks}
        setTasks={setTasks}
        currentUser={currentUser}
      />
      <LeaveEditor
        isOpen={isLeaveEditorOpen}
        setIsOpen={setIsLeaveEditorOpen}
        leave={editingLeave}
        onSave={handleSaveLeave}
        onDelete={handleDeleteLeave}
        employees={employees}
        leaveTypes={leaveTypes}
      />
       <LeaveTypeEditor
        isOpen={isLeaveTypeEditorOpen}
        setIsOpen={setIsLeaveTypeEditorOpen}
        leaveTypes={leaveTypes}
        setLeaveTypes={setLeaveTypes}
        onImport={() => setIsLeaveTypeImporterOpen(true)}
      />
      <LeaveTypeImporter
        isOpen={isLeaveTypeImporterOpen}
        setIsOpen={setIsLeaveTypeImporterOpen}
        onImport={handleImportLeaveTypes}
      />
      <ScheduleImporter
        isOpen={isImporterOpen}
        setIsOpen={setIsImporterOpen}
        onImport={handleImportedData}
        employees={employees}
        shiftTemplates={shiftTemplates}
        leaveTypes={leaveTypes}
      />
       <TemplateImporter 
        isOpen={isTemplateImporterOpen}
        setIsOpen={setIsTemplateImporterOpen}
        onImport={handleImportTemplates}
      />
      <ScheduleExportDialog
        isOpen={isExportDialogOpen}
        setIsOpen={setIsExportDialogOpen}
        employees={employees}
        shifts={shifts}
        leave={leave}
        holidays={holidays}
        monthlyEmployeeOrder={monthlyEmployeeOrder}
        leaveTypes={leaveTypes}
      />
    </Card>
  );
}

type ScheduleExportDialogProps = {
    isOpen: boolean;
    setIsOpen: (open: boolean) => void;
    employees: Employee[];
    shifts: Shift[];
    leave: Leave[];
    holidays: Holiday[];
    monthlyEmployeeOrder: Record<string, string[]>;
    leaveTypes: LeaveTypeOption[];
};

function ScheduleExportDialog({ isOpen, setIsOpen, employees, shifts, leave, holidays, monthlyEmployeeOrder, leaveTypes }: ScheduleExportDialogProps) {
    const [startMonth, setStartMonth] = useState<Date>(startOfMonth(new Date()));
    const [endMonth, setEndMonth] = useState<Date>(startOfMonth(new Date()));
    const [isExporting, setIsExporting] = useState(false);
    const { toast } = useToast();

    const handleExport = async () => {
        setIsExporting(true);
        try {
            const workbook = new ExcelJS.Workbook();
            const months = eachMonthOfInterval({ start: startMonth, end: endMonth });

            for (const month of months) {
                const monthKey = format(month, 'yyyy-MM');
                const sheetName = format(month, 'MMMM yyyy');
                const worksheet = workbook.addWorksheet(sheetName);

                const visibleEmployees = employees.filter(e => e.visibility?.schedule !== false);
                const employeeMap = new Map(visibleEmployees.map(e => [e.id, e]));
                let orderedEmps = [...visibleEmployees].sort((a,b) => a.lastName.localeCompare(b.lastName));
                
                if (monthlyEmployeeOrder[monthKey]) {
                    const orderedSet = new Set(monthlyEmployeeOrder[monthKey]);
                    const ordered = monthlyEmployeeOrder[monthKey].map(id => employeeMap.get(id)).filter((e): e is Employee => !!e);
                    const unordered = orderedEmps.filter(e => !orderedSet.has(e.id));
                    orderedEmps = [...ordered, ...unordered];
                }

                const findDataForDay = (day: Date, employee: Employee) => {
                    const normalizedDay = startOfDay(day);
                    const holidayOnDay = holidays.find(h => isSameDay(new Date(h.date), normalizedDay));
                    if (holidayOnDay) return { text: 'HOL OFF', color: '#ef4444', textColor: '#ffffff' };

                    const shiftOnDay = shifts.find(s => s.employeeId === employee.id && isSameDay(new Date(s.date), normalizedDay));
                    if (shiftOnDay?.isHolidayOff) return { text: 'HOL OFF', color: '#6b7280', textColor: '#ffffff' };
                    if (shiftOnDay?.isDayOff) return { text: 'OFF', color: '#6b7280', textColor: '#ffffff' };

                    const leaveOnDay = leave.find(l => {
                        if (l.employeeId !== employee.id || l.status !== 'approved' || !l.startDate || !l.endDate) return false;
                        if (l.type === 'Work Extension') return false; 
                        return isWithinInterval(normalizedDay, { start: startOfDay(new Date(l.startDate)), end: startOfDay(new Date(l.endDate)) });
                    });
                    if (leaveOnDay) {
                        const leaveTypeDetails = leaveTypes.find(lt => lt.type === leaveOnDay.type);
                        return { 
                            text: leaveOnDay.type.toUpperCase(), 
                            color: leaveTypeDetails?.color || leaveOnDay.color || '#f39c12',
                            textColor: '#ffffff'
                        };
                    }

                    if (shiftOnDay) {
                        return { 
                            text: `${shiftOnDay.startTime}-${shiftOnDay.endTime}`, 
                            color: shiftOnDay.color || '#3b82f6',
                            textColor: shiftOnDay.color === '#ffffff' ? '#000000' : '#ffffff'
                        };
                    }

                    return { text: '', color: null, textColor: null };
                };

                const renderTable = (startRow: number, days: Date[], title: string) => {
                    worksheet.mergeCells(startRow, 1, startRow, days.length + 2);
                    const titleCell = worksheet.getCell(startRow, 1);
                    titleCell.value = title;
                    titleCell.font = { bold: true, size: 14 };
                    titleCell.alignment = { horizontal: 'center' };

                    const headerRow = worksheet.getRow(startRow + 1);
                    headerRow.getCell(1).value = 'Employee Name';
                    headerRow.getCell(2).value = 'Position';
                    days.forEach((day, i) => {
                        const cell = headerRow.getCell(i + 3);
                        cell.value = format(day, 'EEE d');
                        cell.alignment = { horizontal: 'center' };
                    });
                    headerRow.font = { bold: true };
                    headerRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE0E0E0' } };

                    orderedEmps.forEach((emp, empIdx) => {
                        const row = worksheet.getRow(startRow + 2 + empIdx);
                        row.getCell(1).value = getFullName(emp).toUpperCase();
                        row.getCell(2).value = emp.position;
                        days.forEach((day, dayIdx) => {
                            const data = findDataForDay(day, emp);
                            const cell = row.getCell(dayIdx + 3);
                            cell.value = data.text;
                            cell.alignment = { horizontal: 'center', vertical: 'middle' };
                            
                            if (data.color) {
                                cell.fill = {
                                    type: 'pattern',
                                    pattern: 'solid',
                                    fgColor: { argb: data.color.replace('#', 'FF').toUpperCase() }
                                };
                                cell.font = {
                                    color: { argb: (data.textColor || '#ffffff').replace('#', 'FF').toUpperCase() },
                                    bold: true,
                                    size: 9
                                };
                            } else {
                                if (data.text === 'HOL OFF' || data.text === 'OFF') {
                                    cell.font = { color: { argb: 'FF808080' } };
                                }
                            }
                        });
                    });

                    worksheet.columns[0].width = 30;
                    worksheet.columns[1].width = 20;
                    for(let i = 0; i < days.length; i++) {
                        worksheet.getColumn(i + 3).width = 12;
                    }

                    return startRow + orderedEmps.length + 4; 
                };

                const monthStart = startOfMonth(month);
                const day15 = addDays(monthStart, 14);
                const firstHalfDays = eachDayOfInterval({ start: monthStart, end: day15 });

                const day16 = addDays(monthStart, 15);
                const monthEnd = endOfMonth(month);
                const secondHalfDays = eachDayOfInterval({ start: day16, end: monthEnd });

                let nextRow = renderTable(1, firstHalfDays, `Semi-Monthly Schedule: ${sheetName} (1-15)`);
                renderTable(nextRow, secondHalfDays, `Semi-Monthly Schedule: ${sheetName} (16-${getDate(monthEnd)})`);
            }

            const buffer = await workbook.xlsx.writeBuffer();
            const blob = new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
            saveAs(blob, `Semi-Monthly Schedule Export - ${format(startMonth, 'MMM yyyy')} to ${format(endMonth, 'MMM yyyy')}.xlsx`);

            toast({ title: 'Export Successful', description: 'Your schedule has been exported to Excel.' });
            setIsOpen(false);
        } catch (error) {
            console.error(error);
            toast({ variant: 'destructive', title: 'Export Failed', description: (error as Error).message });
        } finally {
            setIsExporting(false);
        }
    };

    return (
        <Dialog open={isOpen} onOpenChange={setIsOpen}>
            <DialogContent className="sm:max-w-md">
                <DialogHeader>
                    <DialogTitle>Export Schedule to Excel</DialogTitle>
                    <DialogDescription>
                        Generate a grid-view semi-monthly Excel report for the selected months.
                    </DialogDescription>
                </DialogHeader>
                <div className="space-y-4 py-4">
                    <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-2">
                            <Label>Start Month</Label>
                            <Select 
                                value={format(startMonth, 'yyyy-MM')} 
                                onValueChange={(v) => setStartMonth(parse(v, 'yyyy-MM', new Date()))}
                            >
                                <SelectTrigger>
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    {eachMonthOfInterval({ 
                                        start: subDays(new Date(), 365), 
                                        end: addDays(new Date(), 365) 
                                    }).map(m => (
                                        <SelectItem key={format(m, 'yyyy-MM')} value={format(m, 'yyyy-MM')}>
                                            {format(m, 'MMMM yyyy')}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>
                        <div className="space-y-2">
                            <Label>End Month</Label>
                            <Select 
                                value={format(endMonth, 'yyyy-MM')} 
                                onValueChange={(v) => setEndMonth(parse(v, 'yyyy-MM', new Date()))}
                            >
                                <SelectTrigger>
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    {eachMonthOfInterval({ 
                                        start: startMonth, 
                                        end: addDays(startMonth, 730) 
                                    }).map(m => (
                                        <SelectItem key={format(m, 'yyyy-MM')} value={format(m, 'yyyy-MM')}>
                                            {format(m, 'MMMM yyyy')}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>
                    </div>
                    <div className="flex gap-2">
                        <Button variant="outline" className="flex-1" onClick={() => {
                            setStartMonth(startOfYear(new Date()));
                            setEndMonth(endOfYear(new Date()));
                        }}>Current Year</Button>
                         <Button variant="outline" className="flex-1" onClick={() => {
                            setStartMonth(startOfMonth(new Date()));
                            setEndMonth(startOfMonth(new Date()));
                        }}>Current Month</Button>
                    </div>
                </div>
                <DialogFooter>
                    <Button variant="ghost" onClick={() => setIsOpen(false)}>Cancel</Button>
                    <Button onClick={handleExport} disabled={isExporting}>
                        {isExporting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <FileSpreadsheet className="mr-2 h-4 w-4" />}
                        Export to Excel
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
