
'use client';

import React, { useState, useMemo, useEffect } from 'react';
import { addDays, format, eachDayOfInterval, isSameDay, startOfWeek, endOfWeek, subDays, startOfMonth, endOfMonth, getDate, parse, isWithinInterval, startOfDay, startOfYear, endOfYear, eachMonthOfInterval } from 'date-fns';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import type { Employee, Shift, Leave, Notification, Note, Holiday, Task, SmtpSettings } from '@/types';
import { Avatar, AvatarFallback, AvatarImage } from './ui/avatar';
import { Button } from './ui/button';
import { PlusCircle, ChevronLeft, ChevronRight, Calendar as CalendarIcon, Copy, CircleSlash, UserX, Download, Settings, Save, Send, ChevronsUpDown, Users, Clock, Briefcase, GripVertical, Trash2, FileSpreadsheet, Settings2, Upload } from 'lucide-react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Calendar } from '@/components/ui/calendar';
import { cn, getInitials, getBackgroundColor, getFullName } from '@/lib/utils';
import { ShiftEditor, type ShiftTemplate, type ShiftWithRepeat } from './shift-editor';
import { LeaveEditor } from './leave-editor';
import { ShiftBlock } from './shift-block';
import { DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from './ui/dropdown-menu';
import { useToast } from '@/hooks/use-toast';
import { LeaveTypeEditor, type LeaveTypeOption } from './leave-type-editor';
import { LeaveTypeImporter } from './leave-type-importer';
import { Tooltip, TooltipProvider, TooltipContent, TooltipTrigger } from './ui/tooltip';
import * as ExcelJS from 'exceljs';
import { saveAs } from 'file-saver';
import { v4 as uuidv4 } from 'uuid';
import { ShiftTemplateManager } from './shift-template-manager';
import { ScheduleImporter } from './schedule-importer';

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
              <Button variant="outline" onClick={() => setIsManageShiftsOpen(true)}>
                <Settings2 className="mr-2 h-4 w-4" />
                Manage Shift Templates
              </Button>
              <DropdownMenu>
                <DropdownMenuTrigger asChild><Button><PlusCircle className="mr-2 h-4 w-4" />Add</Button></DropdownMenuTrigger>
                <DropdownMenuContent><DropdownMenuItem onClick={handleAddShiftClick}>Add Shift</DropdownMenuItem><DropdownMenuItem onClick={handleAddLeaveClick}>Add Time Off</DropdownMenuItem></DropdownMenuContent>
              </DropdownMenu>
                <DropdownMenu>
                    <DropdownMenuTrigger asChild><Button variant="outline">Actions<ChevronsUpDown className="ml-2 h-4 w-4" /></Button></DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                        <DropdownMenuGroup>
                           <DropdownMenuItem onClick={() => toast({ title: "Draft Saved" })}><Save className="mr-2 h-4 w-4" /><span>Save Draft</span></DropdownMenuItem>
                           <DropdownMenuItem onClick={onPublish}><Send className="mr-2 h-4 w-4" /><span>Publish</span></DropdownMenuItem>
                        </DropdownMenuGroup>
                        <DropdownMenuSeparator />
                        <DropdownMenuGroup>
                            <DropdownMenuItem onClick={() => setIsScheduleImporterOpen(true)}><Upload className="mr-2 h-4 w-4" /><span>Import Schedule</span></DropdownMenuItem>
                        </DropdownMenuGroup>
                        <DropdownMenuSeparator />
                         <DropdownMenuGroup>
                            <DropdownMenuItem onClick={handleCopyPreviousWeek} disabled={viewMode !== 'week'}><Copy className="mr-2 h-4 w-4" /><span>Copy Previous Week</span></DropdownMenuItem>
                             <DropdownMenuItem onClick={handleSaveTemplate} disabled={viewMode !== 'week'}><Download className="mr-2 h-4 w-4" /><span>Save as Template</span></DropdownMenuItem>
                            <DropdownMenuItem onClick={handleLoadTemplate} disabled={!weekTemplate || viewMode !== 'week'}><Upload className="mr-2 h-4 w-4" /><span>Load Template</span></DropdownMenuItem>
                        </DropdownMenuGroup>
                        <DropdownMenuSeparator />
                         <DropdownMenuGroup>
                             <DropdownMenuItem onClick={() => setIsLeaveTypeEditorOpen(true)}><Settings className="mr-2 h-4 w-4" /><span>Manage Leave Types</span></DropdownMenuItem>
                            <DropdownMenuItem onClick={onManageHolidays}><Settings className="mr-2 h-4 w-4" /><span>Manage Holidays</span></DropdownMenuItem>
                            <DropdownMenuItem onClick={() => setIsExportDialogOpen(true)}><FileSpreadsheet className="mr-2 h-4 w-4" /><span>Export Semi-Monthly Excel</span></DropdownMenuItem>
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
      <CardContent className="flex-1 p-0 overflow-auto">
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
    </Card>
  );
}
