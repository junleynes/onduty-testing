'use client';

import React, { useState, useMemo, useEffect } from 'react';
import { addDays, format, eachDayOfInterval, isSameDay, startOfWeek, endOfWeek, subDays, startOfMonth, endOfMonth, getDate, parse, isWithinInterval, startOfDay, startOfYear, endOfYear, eachMonthOfInterval, addMonths } from 'date-fns';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import type { Employee, Shift, Leave, Notification, Note, Holiday, Task, SmtpSettings } from '@/types';
import { Avatar, AvatarFallback, AvatarImage } from './ui/avatar';
import { Button } from './ui/button';
import { PlusCircle, ChevronLeft, ChevronRight, Calendar as CalendarIcon, Copy, CircleSlash, UserX, Download, Settings, Save, Send, ChevronsUpDown, Users, Clock, Briefcase, GripVertical, Trash2, FileSpreadsheet, Settings2, Upload, AlertTriangle, Palmtree } from 'lucide-react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Calendar } from '@/components/ui/calendar';
import { cn, getInitials, getBackgroundColor, getFullName } from '@/lib/utils';
import { ShiftEditor, type ShiftTemplate, type ShiftWithRepeat } from './shift-editor';
import { LeaveEditor } from './leave-editor';
import { ShiftBlock } from './shift-block';
import { DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger, DropdownMenuLabel } from './ui/dropdown-menu';
import { useToast } from '@/hooks/use-toast';
import { LeaveTypeEditor, type LeaveTypeOption } from './leave-type-editor';
import { LeaveTypeImporter } from './leave-type-importer';
import { Tooltip, TooltipProvider, TooltipContent, TooltipTrigger } from './ui/tooltip';
import * as ExcelJS from 'exceljs';
import { saveAs } from 'file-saver';
import { v4 as uuidv4 } from 'uuid';
import { ShiftTemplateManager } from './shift-template-manager';
import { ScheduleImporter } from './schedule-importer';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from './ui/alert-dialog';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from './ui/dialog';
import { DatePicker } from './ui/date-picker';
import { Label } from './ui/label';

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

export default function ScheduleView({ employees, shifts, setShifts, leave, setLeave, notes, holidays, tasks, setTasks, currentUser, onPublish, addNotification, onViewNote, onEditNote, onManageHolidays, shiftTemplates, setShiftTemplates, leaveTypes, setLeaveTypes, monthlyEmployeeOrder, setMonthlyEmployeeOrder }: ScheduleViewProps) {
  const isReadOnly = currentUser?.role === 'member';
  
  const visibleEmployees = useMemo(() => employees.filter(e => e.visibility?.schedule !== false), [employees]);

  const [currentDate, setCurrentDate] = useState(new Date());
  const [viewMode, setViewMode] = useState<ViewMode>('week');
  const [isShiftEditorOpen, setIsShiftEditorOpen] = useState(false);
  const [editingShift, setEditingShift] = useState<Shift | Partial<Shift> | null>(null);
  const [isManageShiftsOpen, setIsManageShiftsOpen] = useState(false);
  const [isScheduleImporterOpen, setIsScheduleImporterOpen] = useState(false);
  const [isExportDialogOpen, setIsExportDialogOpen] = useState(false);
  const [exportPreset, setExportPreset] = useState<'current-view' | 'this-week' | 'this-month' | 'custom'>('current-view');
  const [exportFrom, setExportFrom] = useState<Date>(new Date());
  const [exportTo, setExportTo] = useState<Date>(new Date());
  
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
  const [isClearConfirmOpen, setIsClearConfirmOpen] = useState(false);
  const [clearType, setClearType] = useState<'week' | 'month' | 'year' | 'drafts' | 'unassign-week' | null>(null);
  
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
        const start = startOfDay(dateRange.from);
        const end = startOfDay(dateRange.to);
        if (start > end) return [];
        return eachDayOfInterval({ start, end });
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
                let currentDate = startOfDay(savedShift.date);
                const limit = startOfDay(savedShift.repeatUntil);
                while (currentDate <= limit) {
                    newShifts.push({ ...baseShift, id: uuidv4(), date: new Date(currentDate) });
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
    setShifts(shifts.filter(s => s.id !== shiftId));
    setTasks(tasks.filter(t => t.shiftId !== shiftId));
    setIsShiftEditorOpen(false);
    setEditingShift(null);
    toast({ title: "Shift Deleted", variant: "destructive" });
  };

  const handleSaveLeave = (savedLeave: Leave | Partial<Leave>) => {
    if (isReadOnly) return;
    if (savedLeave.id) {
        setLeave(leave.map(l => l.id === savedLeave.id ? savedLeave as Leave : l));
        toast({ title: "Leave Updated" });
    } else {
        const newLeaveWithId = { ...savedLeave, id: uuidv4() } as Leave;
        setLeave(prevLeave => [...prevLeave, newLeaveWithId]);
        toast({ title: "Time Off Added" });
    }
    setIsLeaveEditorOpen(false);
    setEditingLeave(null);
  };
  
  const handleDeleteLeave = (leaveId: string) => {
    if (isReadOnly) return;
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
  
  const formatRange = (start: Date, end: Date) => {
      if (viewMode === 'month') return format(start, 'MMMM yyyy');
      if (isSameDay(start, end)) return format(start, 'MMM d, yyyy');
      return `${format(start, 'MMM d')} - ${format(end, 'd, yyyy')}`;
  }

  const handleClearWeek = () => {
    const start = startOfWeek(currentDate, { weekStartsOn: 1 });
    const end = endOfWeek(currentDate, { weekStartsOn: 1 });
    setShifts(prev => prev.filter(s => !isWithinInterval(new Date(s.date), { start, end })));
    toast({ title: "Week Cleared", description: "All shifts for the current week have been removed." });
  };

  const handleClearMonth = () => {
    const start = startOfMonth(currentDate);
    const end = endOfMonth(currentDate);
    setShifts(prev => prev.filter(s => !isWithinInterval(new Date(s.date), { start, end })));
    toast({ title: "Month Cleared", description: "All shifts for the current month have been removed." });
  };

  const handleClearYear = () => {
    const start = startOfYear(currentDate);
    const end = endOfYear(currentDate);
    setShifts(prev => prev.filter(s => !isWithinInterval(new Date(s.date), { start, end })));
    toast({ title: "Year Cleared", description: "All shifts for the current year have been removed." });
  };

  const handleClearDrafts = () => {
    setShifts(prev => prev.filter(s => s.status !== 'draft'));
    toast({ title: "Drafts Cleared", description: "All draft shifts have been permanently removed." });
  };

  const handleUnassignWeek = () => {
    const start = startOfWeek(currentDate, { weekStartsOn: 1 });
    const end = endOfWeek(currentDate, { weekStartsOn: 1 });
    setShifts(prev => prev.map(s => 
      isWithinInterval(new Date(s.date), { start, end }) 
        ? { ...s, employeeId: null, status: 'draft' as const } 
        : s
    ));
    toast({ title: "Week Unassigned", description: "All shifts for the current week have been moved to unassigned." });
  };

  const confirmClear = (type: 'week' | 'month' | 'year' | 'drafts' | 'unassign-week') => {
    setClearType(type);
    setIsClearConfirmOpen(true);
  };

  const handleExecuteClear = () => {
    if (clearType === 'week') handleClearWeek();
    else if (clearType === 'month') handleClearMonth();
    else if (clearType === 'year') handleClearYear();
    else if (clearType === 'drafts') handleClearDrafts();
    else if (clearType === 'unassign-week') handleUnassignWeek();
    setIsClearConfirmOpen(false);
    setClearType(null);
  };

  const renderGridHeader = (days: Date[]) => (
     <div className="contents">
        <div className="sticky top-0 left-0 z-30 p-2 bg-card border-b border-r flex items-center justify-center">
            <p className="font-semibold text-sm">Employees</p>
        </div>
        {days.map((day) => {
            const shiftsForDay = shifts.filter(shift => isSameDay(new Date(shift.date), day) && !shift.isDayOff && !shift.isHolidayOff);
            return (
                <div key={day.toISOString()} className="sticky top-0 z-10 col-start-auto p-2 text-center font-semibold bg-card border-b border-l">
                    <div className="text-lg whitespace-nowrap">{format(day, 'E M/d')}</div>
                    <div className="text-xs text-muted-foreground font-normal flex justify-center gap-3 mt-1">
                        <TooltipProvider>
                            <Tooltip>
                                <TooltipTrigger asChild><div className="flex items-center gap-1"><Briefcase className="h-3 w-3" /><span>{shiftsForDay.length}</span></div></TooltipTrigger>
                                <TooltipContent><p>{shiftsForDay.length} shifts</p></TooltipContent>
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
            const holiday = holidays.find(h => isSameDay(new Date(h.date), day));
            return (
                <div 
                    key={`note-${day.toISOString()}`}
                    className="group/cell col-start-auto p-1 border-b border-l min-h-[40px] bg-background/30 relative text-xs flex flex-col items-center justify-center cursor-pointer hover:bg-accent"
                    onClick={() => handleNoteCellClick(day)}
                >
                    {holiday && (
                        <div className="w-full text-center p-1 rounded-sm bg-red-500 text-white">
                            <p className="font-bold truncate">{holiday.title}</p>
                        </div>
                    )}
                    {!holiday && !isReadOnly && (
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
            if (l.employeeId !== employee.id || l.type === 'Work Extension' || !l.startDate || !l.endDate) return false;
            
            // EXCLUSION: Don't show approved Tardy items in the schedule grid
            if (l.type.toUpperCase() === 'TARDY' && (l.status === 'approved' || l.status === 'processed')) return false;

            return isWithinInterval(startOfDay(day), { start: startOfDay(new Date(l.startDate)), end: startOfDay(new Date(l.endDate)) });
        });
        return [...shiftsForDay, ...leaveForDay];
    }
    
    return (
    <div className="contents" key={employee.id} onDragOver={(e) => e.preventDefault()} onDrop={(e) => {}}>
        <div className="sticky left-0 z-20 py-1 px-2 border-b border-r flex items-center gap-3 min-h-[52px] bg-card group">
            <div className="flex items-center gap-3">
                 {employee.id !== 'unassigned' ? (
                    <Avatar className="h-9 w-9">
                        <AvatarImage src={employee.avatar} data-ai-hint="profile avatar" />
                        <AvatarFallback style={{ backgroundColor: getBackgroundColor(getFullName(employee)) }}>{getInitials(getFullName(employee))}</AvatarFallback>
                    </Avatar>
                ) : <Users className="h-6 w-6 text-muted-foreground mx-auto" />}
                <p className="font-semibold text-sm">{getFullName(employee)}</p>
            </div>
        </div>
        {days.map((day) => {
        const itemsForDay = getItemsForDay(day);
        return (
            <div
            key={`${employee.id}-${day.toISOString()}`}
            className={cn("group/cell col-start-auto p-1 border-b border-l min-h-[52px] space-y-1 bg-background/30 relative", viewMode === 'month' && day.getMonth() !== currentDate.getMonth() && 'bg-muted/50')}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => handleShiftDrop(e, employee.id === 'unassigned' ? null : employee.id, day)}
            >
            {itemsForDay.map((item) => (
                <div key={item.id} draggable={!isReadOnly} onDragStart={(e) => handleShiftDragStart(e, item)} className="h-full">
                    <ShiftBlock item={item} onClick={() => !isReadOnly && handleEditItemClick(item)} context="week" />
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
    toast({ title: "Previous Week Copied" });
  };

  const handleSaveTemplate = () => {
    if (isReadOnly) return;
    const shiftsInView = shifts.filter(shift => displayedDays.some(day => isSameDay(new Date(shift.date), day)));
    const template = shiftsInView.map(({ id, date, ...rest }) => ({
      ...rest,
      dayOfWeek: new Date(date).getDay(),
    }));
    setWeekTemplate(template as any);
    toast({ title: "Template Saved" });
  };

  const handleLoadTemplate = () => {
    if (isReadOnly) return;
    if (!weekTemplate) {
      toast({ variant: 'destructive', title: "No Template Saved" });
      return;
    }
    const shiftsOutsideCurrentWeek = shifts.filter(shift => !displayedDays.some(day => isSameDay(new Date(shift.date), day)));
    const newShifts = weekTemplate.map((templateShift: any) => {
        const targetDay = displayedDays.find(d => d.getDay() === templateShift.dayOfWeek);
        if (!targetDay) return null;
        return { ...templateShift, id: uuidv4(), date: targetDay, status: 'draft' };
    }).filter(Boolean);
    setShifts([...shiftsOutsideCurrentWeek, ...newShifts as Shift[]]);
    toast({ title: "Template Loaded" });
  };

  return (
    <Card className="h-full flex flex-col">
       <CardHeader>
        <div className="flex flex-col md:flex-row items-start justify-between gap-4">
            <div>
                <CardTitle>Schedule</CardTitle>
                <CardDescription>Drag and drop shifts, manage time off, and publish for your team.</CardDescription>
            </div>
             {!isReadOnly && (
            <div className="flex items-center gap-2">
                <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                        <Button>
                            <PlusCircle className="mr-2 h-4 w-4" />
                            New
                            <ChevronsUpDown className="ml-2 h-4 w-4" />
                        </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-48">
                        <DropdownMenuItem onClick={handleAddShiftClick}>
                            <Clock className="mr-2 h-4 w-4" />
                            <span>Shift</span>
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={handleAddLeaveClick}>
                            <Palmtree className="mr-2 h-4 w-4" />
                            <span>Time Off</span>
                        </DropdownMenuItem>
                    </DropdownMenuContent>
                </DropdownMenu>

                <DropdownMenu>
                    <DropdownMenuTrigger asChild><Button variant="outline">Actions<ChevronsUpDown className="ml-2 h-4 w-4" /></Button></DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-56">
                        <DropdownMenuLabel>General Actions</DropdownMenuLabel>
                        <DropdownMenuGroup>
                           <DropdownMenuItem onClick={() => toast({ title: "Draft Saved" })}><Save className="mr-2 h-4 w-4" /><span>Save Draft</span></DropdownMenuItem>
                           <DropdownMenuItem onClick={onPublish}><Send className="mr-2 h-4 w-4" /><span>Publish</span></DropdownMenuItem>
                        </DropdownMenuGroup>
                        <DropdownMenuSeparator />
                        <DropdownMenuLabel>Data Management</DropdownMenuLabel>
                        <DropdownMenuGroup>
                            <DropdownMenuItem onClick={() => setIsScheduleImporterOpen(true)}><Upload className="mr-2 h-4 w-4" /><span>Import Schedule</span></DropdownMenuItem>
                             <DropdownMenuItem onClick={() => { setExportPreset('current-view'); setExportFrom(dateRange.from); setExportTo(dateRange.to); setIsExportDialogOpen(true); }}><FileSpreadsheet className="mr-2 h-4 w-4" /><span>Export to Excel</span></DropdownMenuItem>
                        </DropdownMenuGroup>
                        <DropdownMenuSeparator />
                        <DropdownMenuLabel>Template Actions</DropdownMenuLabel>
                         <DropdownMenuGroup>
                            <DropdownMenuItem onClick={handleCopyPreviousWeek} disabled={viewMode !== 'week'}><Copy className="mr-2 h-4 w-4" /><span>Copy Previous Week</span></DropdownMenuItem>
                             <DropdownMenuItem onClick={handleSaveTemplate} disabled={viewMode !== 'week'}><Download className="mr-2 h-4 w-4" /><span>Save as Template</span></DropdownMenuItem>
                            <DropdownMenuItem onClick={handleLoadTemplate} disabled={!weekTemplate || viewMode !== 'week'}><Upload className="mr-2 h-4 w-4" /><span>Load Template</span></DropdownMenuItem>
                        </DropdownMenuGroup>
                        <DropdownMenuSeparator />
                        <DropdownMenuLabel>Settings</DropdownMenuLabel>
                         <DropdownMenuGroup>
                             <DropdownMenuItem onClick={() => setIsManageShiftsOpen(true)}><Settings2 className="mr-2 h-4 w-4" /><span>Manage Shift Templates</span></DropdownMenuItem>
                             <DropdownMenuItem onClick={() => setIsLeaveTypeEditorOpen(true)}><Settings className="mr-2 h-4 w-4" /><span>Manage Leave Types</span></DropdownMenuItem>
                            <DropdownMenuItem onClick={onManageHolidays}><Settings className="mr-2 h-4 w-4" /><span>Manage Holidays</span></DropdownMenuItem>
                        </DropdownMenuGroup>
                        <DropdownMenuSeparator />
                        <DropdownMenuLabel className="text-destructive">Danger Zone</DropdownMenuLabel>
                        <DropdownMenuGroup>
                            <DropdownMenuItem className="text-destructive focus:text-destructive" onClick={() => confirmClear('drafts')}>
                                <CircleSlash className="mr-2 h-4 w-4" />
                                <span>Clear All Drafts</span>
                            </DropdownMenuItem>
                            <DropdownMenuItem className="text-destructive focus:text-destructive" onClick={() => confirmClear('unassign-week')}>
                                <UserX className="mr-2 h-4 w-4" />
                                <span>Unassign Current Week</span>
                            </DropdownMenuItem>
                            <DropdownMenuItem className="text-destructive focus:text-destructive" onClick={() => confirmClear('week')}>
                                <Trash2 className="mr-2 h-4 w-4" />
                                <span>Clear Current Week</span>
                            </DropdownMenuItem>
                            <DropdownMenuItem className="text-destructive focus:text-destructive" onClick={() => confirmClear('month')}>
                                <Trash2 className="mr-2 h-4 w-4" />
                                <span>Clear Current Month</span>
                            </DropdownMenuItem>
                            <DropdownMenuItem className="text-destructive focus:text-destructive" onClick={() => confirmClear('year')}>
                                <Trash2 className="mr-2 h-4 w-4" />
                                <span>Clear Current Year</span>
                            </DropdownMenuItem>
                        </DropdownMenuGroup>
                    </DropdownMenuContent>
                </DropdownMenu>
            </div>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2 w-full justify-end mt-4">
           <Select value={viewMode} onValueChange={(value: ViewMode) => setViewMode(value)}>
            <SelectTrigger className="w-full sm:w-[120px]"><SelectValue placeholder="View" /></SelectTrigger>
            <SelectContent><SelectItem value="day">Day</SelectItem><SelectItem value="week">Week</SelectItem><SelectItem value="month">Month</SelectItem></SelectContent>
          </Select>
           <Popover>
              <PopoverTrigger asChild><Button variant={'outline'} className="w-full md:w-[260px] justify-start text-left font-normal text-sm"><CalendarIcon className="mr-2 h-4 w-4" />{dateRange?.from ? formatRange(dateRange.from, dateRange.to) : <span>Pick a date</span>}</Button></PopoverTrigger>
              <PopoverContent className="w-auto p-0" align="start"><Calendar initialFocus mode="single" selected={currentDate} onSelect={(date) => date && setCurrentDate(date)} /></PopoverContent>
          </Popover>
          <div className="flex items-center gap-1 rounded-md border bg-card p-1">
              <Button variant="ghost" size="icon" onClick={() => navigateDate('prev')}><ChevronLeft className="h-4 w-4" /></Button>
              <Button variant="ghost" size="sm" onClick={() => setCurrentDate(new Date())}>Today</Button>
              <Button variant="ghost" size="icon" onClick={() => navigateDate('next')}><ChevronRight className="h-4 w-4" /></Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="flex-1 p-0 overflow-auto" style={{ isolation: 'isolate' }}>
        <div className="overflow-auto">
            <div className="grid min-w-max" style={{ gridTemplateColumns: `minmax(180px, 1.5fr) repeat(${viewMode === 'month' ? 15 : displayedDays.length}, minmax(140px, 1fr))` }}>
                {viewMode === 'month' ? (
                    <>
                        <div className="contents">{renderGridHeader(firstHalfDays)}{renderNotesRow(firstHalfDays)}{orderedEmployees.map(e => renderEmployeeRow(e, firstHalfDays))}</div>
                        <div className="h-8 bg-muted/20 col-span-full border-y flex items-center px-4 text-xs font-bold text-muted-foreground uppercase tracking-widest">Second Half</div>
                        <div className="contents">{renderGridHeader(secondHalfDays)}{renderNotesRow(secondHalfDays)}{orderedEmployees.map(e => renderEmployeeRow(e, secondHalfDays))}</div>
                    </>
                ) : (
                    <>{renderGridHeader(displayedDays)}{renderNotesRow(displayedDays)}{orderedEmployees.map(e => renderEmployeeRow(e, displayedDays))}</>
                )}
            </div>
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
      <ShiftTemplateManager
        isOpen={isManageShiftsOpen}
        setIsOpen={setIsManageShiftsOpen}
        shiftTemplates={shiftTemplates}
        setShiftTemplates={setShiftTemplates}
      />
      <ScheduleImporter
        isOpen={isScheduleImporterOpen}
        setIsOpen={setIsScheduleImporterOpen}
        employees={employees}
        shiftTemplates={shiftTemplates}
        leaveTypes={leaveTypes}
        onImport={(data) => {
          const { shifts: importedShifts, leave: importedLeave, monthlyOrders, overwrittenCells } = data;
          
          const cellsToOverwrite = new Set(
            overwrittenCells.map(cell => `${cell.employeeId}-${format(cell.date, 'yyyy-MM-dd')}`)
          );

          setShifts(prev => [
            ...prev.filter(s => !s.employeeId || !cellsToOverwrite.has(`${s.employeeId}-${format(new Date(s.date), 'yyyy-MM-dd')}`)),
            ...importedShifts
          ]);

          setLeave(prev => [
            ...prev.filter(l => !l.employeeId || !cellsToOverwrite.has(`${l.employeeId}-${format(new Date(l.startDate), 'yyyy-MM-dd')}`)),
            ...importedLeave
          ]);

          setMonthlyEmployeeOrder(prev => ({ ...prev, ...monthlyOrders }));
          setIsScheduleImporterOpen(false);
          toast({ title: "Import Successful" });
        }}
      />

      <AlertDialog open={isClearConfirmOpen} onOpenChange={setIsClearConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-destructive" />
              Are you absolutely sure?
            </AlertDialogTitle>
            <AlertDialogDescription>
              {clearType === 'drafts' 
                ? "This will permanently delete all shifts currently in draft status across the entire schedule. This action cannot be undone."
                : clearType === 'unassign-week'
                ? "This will remove all employee assignments for the current week. The shifts will be moved to the 'Unassigned' row."
                : `This will permanently delete all shifts for the current ${clearType}. This action cannot be undone.`
              }
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setClearType(null)}>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleExecuteClear} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              {clearType === 'unassign-week' ? "Unassign Week" : "Confirm Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog open={isExportDialogOpen} onOpenChange={setIsExportDialogOpen}>
        <DialogContent className="sm:max-w-md">
            <DialogHeader>
                <DialogTitle>Export Schedule to Excel</DialogTitle>
                <DialogDescription>
                    Choose a range preset or set a custom date range. The schedule is exported in a semi-monthly layout.
                </DialogDescription>
            </DialogHeader>
            <div className="grid gap-4 py-4">
                <div className="flex flex-col gap-2">
                    <Label>Range Preset</Label>
                    <Select
                        value={exportPreset}
                        onValueChange={(v: 'current-view' | 'this-week' | 'this-month' | 'custom') => {
                            setExportPreset(v);
                            const today = new Date();
                            if (v === 'current-view') {
                                setExportFrom(dateRange.from);
                                setExportTo(dateRange.to);
                            } else if (v === 'this-week') {
                                setExportFrom(startOfWeek(today, { weekStartsOn: 1 }));
                                setExportTo(endOfWeek(today, { weekStartsOn: 1 }));
                            } else if (v === 'this-month') {
                                setExportFrom(startOfMonth(today));
                                setExportTo(endOfMonth(today));
                            }
                            // 'custom' — leave dates as-is so user can adjust them
                        }}
                    >
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                            <SelectItem value="current-view">Current View ({viewMode})</SelectItem>
                            <SelectItem value="this-week">This Week</SelectItem>
                            <SelectItem value="this-month">This Month</SelectItem>
                            <SelectItem value="custom">Custom Range</SelectItem>
                        </SelectContent>
                    </Select>
                </div>
                <div className="grid grid-cols-2 gap-3">
                    <div className="flex flex-col gap-2">
                        <Label>Start Date</Label>
                        <DatePicker
                            date={exportFrom}
                            onDateChange={(d) => { if (d) { setExportFrom(d); setExportPreset('custom'); } }}
                        />
                    </div>
                    <div className="flex flex-col gap-2">
                        <Label>End Date</Label>
                        <DatePicker
                            date={exportTo}
                            onDateChange={(d) => { if (d) { setExportTo(d); setExportPreset('custom'); } }}
                            dateProps={{ disabled: (d) => d < exportFrom }}
                        />
                    </div>
                </div>
                {exportFrom > exportTo && (
                    <p className="text-xs text-destructive">End date must be on or after start date.</p>
                )}
                <p className="text-xs text-muted-foreground">
                    Exporting <strong>{Math.ceil((exportTo.getTime() - exportFrom.getTime()) / 86400000) + 1} day(s)</strong>: {format(exportFrom, 'MMM d, yyyy')} — {format(exportTo, 'MMM d, yyyy')}
                </p>
            </div>
            <DialogFooter>
                <Button variant="ghost" onClick={() => setIsExportDialogOpen(false)}>Cancel</Button>
                <Button
                    disabled={exportFrom > exportTo}
                    onClick={async () => {
                    const rangeStart = startOfDay(exportFrom);
                    const rangeEnd = startOfDay(exportTo);

                    const workbook = new ExcelJS.Workbook();
                    const worksheet = workbook.addWorksheet('Schedule Export');

                    const headerStyle: Partial<ExcelJS.Style> = {
                        font: { bold: true, color: { argb: 'FFFFFFFF' } },
                        fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF3498DB' } },
                        alignment: { vertical: 'middle', horizontal: 'center', wrapText: true },
                        border: {
                            top: { style: 'thin', color: { argb: 'FF1A6BA0' } },
                            bottom: { style: 'thin', color: { argb: 'FF1A6BA0' } },
                            left: { style: 'thin', color: { argb: 'FF1A6BA0' } },
                            right: { style: 'thin', color: { argb: 'FF1A6BA0' } },
                        },
                    };
                    const nameStyle: Partial<ExcelJS.Style> = {
                        font: { bold: true },
                        fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF0F4F8' } },
                        alignment: { vertical: 'middle', horizontal: 'left' },
                        border: { right: { style: 'medium', color: { argb: 'FF3498DB' } } },
                    };
                    const separatorStyle: Partial<ExcelJS.Style> = {
                        fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE2E8F0' } },
                    };

                    // Build semi-monthly periods that intersect the selected range
                    const months = eachMonthOfInterval({ start: rangeStart, end: rangeEnd });
                    const periods: { start: Date; end: Date }[] = [];
                    for (const monthDate of months) {
                        const p1start = startOfMonth(monthDate);
                        const p1end = addDays(p1start, 14);   // 1–15
                        const p2start = addDays(p1start, 15); // 16–end
                        const p2end = endOfMonth(monthDate);
                        // Only include periods that overlap the selected range
                        if (p1end >= rangeStart && p1start <= rangeEnd)
                            periods.push({ start: p1start < rangeStart ? rangeStart : p1start, end: p1end > rangeEnd ? rangeEnd : p1end });
                        if (p2end >= rangeStart && p2start <= rangeEnd)
                            periods.push({ start: p2start < rangeStart ? rangeStart : p2start, end: p2end > rangeEnd ? rangeEnd : p2end });
                    }

                    let currentRow = 1;

                    for (const period of periods) {
                        const days = eachDayOfInterval(period);

                        // Period label row
                        const labelRow = worksheet.getRow(currentRow);
                        const periodLabel = `${format(period.start, 'MMM d')} – ${format(period.end, 'MMM d, yyyy')}`;
                        labelRow.getCell(1).value = periodLabel;
                        labelRow.getCell(1).style = {
                            font: { bold: true, size: 11, color: { argb: 'FF1A3C5E' } },
                            fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFCFE2F3' } },
                        };
                        worksheet.mergeCells(currentRow, 1, currentRow, days.length + 1);
                        labelRow.height = 18;
                        currentRow++;

                        // Header row — dates
                        const headerRow = worksheet.getRow(currentRow);
                        headerRow.getCell(1).value = 'Employee';
                        headerRow.getCell(1).style = headerStyle;
                        days.forEach((day, idx) => {
                            const cell = headerRow.getCell(idx + 2);
                            cell.value = format(day, 'EEE\nMM/dd');
                            cell.style = headerStyle;
                        });
                        headerRow.height = 30;
                        currentRow++;

                        // Employee rows
                        orderedEmployees.forEach(emp => {
                            const row = worksheet.getRow(currentRow);
                            row.getCell(1).value = getFullName(emp) || 'Unassigned';
                            row.getCell(1).style = nameStyle;
                            row.height = 18;

                            days.forEach((day, idx) => {
                                const shiftOnDay = shifts.find(s =>
                                    (s.employeeId === emp.id || (emp.id === 'unassigned' && !s.employeeId)) &&
                                    isSameDay(new Date(s.date), day)
                                );
                                const leaveOnDay = leave.find(l => {
                                    if (l.employeeId !== emp.id) return false;
                                    if (l.type.toUpperCase() === 'TARDY' && l.status === 'approved') return false;
                                    return isWithinInterval(day, { start: startOfDay(new Date(l.startDate)), end: startOfDay(new Date(l.endDate)) });
                                });

                                let cellValue = '';
                                let cellColor = '';
                                if (leaveOnDay) {
                                    cellValue = leaveOnDay.type;
                                    cellColor = (leaveOnDay.color || '#f59e0b').replace('#', 'FF');
                                } else if (shiftOnDay) {
                                    if (shiftOnDay.isDayOff) { cellValue = 'OFF'; cellColor = 'FFE2E8F0'; }
                                    else if (shiftOnDay.isHolidayOff) { cellValue = 'HOL'; cellColor = 'FFFDE68A'; }
                                    else { cellValue = `${shiftOnDay.startTime}-${shiftOnDay.endTime}`; cellColor = (shiftOnDay.color || '').replace('#', 'FF') || 'FFDBEAFE'; }
                                }

                                const cell = row.getCell(idx + 2);
                                cell.value = cellValue;
                                cell.style = {
                                    alignment: { vertical: 'middle', horizontal: 'center' },
                                    fill: cellColor ? { type: 'pattern', pattern: 'solid', fgColor: { argb: cellColor.startsWith('FF') ? cellColor : 'FF' + cellColor } } : undefined,
                                    border: {
                                        top: { style: 'hair', color: { argb: 'FFCBD5E1' } },
                                        bottom: { style: 'hair', color: { argb: 'FFCBD5E1' } },
                                        left: { style: 'hair', color: { argb: 'FFCBD5E1' } },
                                        right: { style: 'hair', color: { argb: 'FFCBD5E1' } },
                                    },
                                };
                            });
                            currentRow++;
                        });

                        // Separator row
                        const sepRow = worksheet.getRow(currentRow);
                        for (let c = 1; c <= days.length + 1; c++) sepRow.getCell(c).style = separatorStyle;
                        sepRow.height = 6;
                        currentRow++;
                    }

                    // Column widths
                    worksheet.getColumn(1).width = 24;
                    for (let c = 2; c <= (periods[0] ? eachDayOfInterval(periods[0]).length + 1 : 20); c++) {
                        worksheet.getColumn(c).width = 13;
                    }

                    const buffer = await workbook.xlsx.writeBuffer();
                    const filename = `Schedule_${format(rangeStart, 'yyyy-MM-dd')}_to_${format(rangeEnd, 'yyyy-MM-dd')}.xlsx`;
                    saveAs(new Blob([buffer]), filename);
                    setIsExportDialogOpen(false);
                    toast({ title: 'Export Complete', description: filename });
                }}>Generate Excel</Button>
            </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
