'use client';

import React, { useEffect, useState, useMemo } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { FileText, MoreHorizontal, Pencil, Copy, Trash2, X, PlusCircle, Repeat, Search } from 'lucide-react';
import { getFullName } from '@/lib/utils';
import type { Employee, Shift, Task } from '@/types';
import { Checkbox } from './ui/checkbox';
import { Tabs, TabsContent, TabsList, TabsTrigger } from './ui/tabs';
import { ScrollArea } from './ui/scroll-area';
import { Card, CardContent } from './ui/card';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from './ui/dropdown-menu';
import { useToast } from '@/hooks/use-toast';
import { DatePicker } from './ui/date-picker';
import { Textarea } from './ui/textarea';
import { v4 as uuidv4 } from 'uuid';
import { RadioGroup, RadioGroupItem } from './ui/radio-group';
import { Separator } from './ui/separator';


const shiftSchema = z.object({
  employeeId: z.string().nullable(),
  label: z.string().optional(),
  date: z.date({ required_error: 'A date is required.' }),
  startTime: z.string().optional(),
  endTime: z.string().optional(),
  color: z.string().optional(),
  id: z.string().optional(),
  isDayOff: z.boolean().default(false),
  isHolidayOff: z.boolean().default(false),
  breakStartTime: z.string().optional(),
  breakEndTime: z.string().optional(),
  isUnpaidBreak: z.boolean().optional(),
  
  // Repeat fields
  repeat: z.boolean().optional(),
  repeatType: z.enum(['occurrences', 'untilDate']).optional(),
  repeatOccurrences: z.coerce.number().optional(),
  repeatUntil: z.date().optional(),
}).refine(data => {
    if (data.isDayOff || data.isHolidayOff) return true;
    return !!data.label && !!data.startTime && !!data.endTime;
}, {
    message: "Label, start time, and end time are required for shifts.",
    path: ["label"],
}).refine(data => {
    if (!data.repeat) return true;
    if (data.repeatType === 'occurrences') return data.repeatOccurrences && data.repeatOccurrences > 0;
    if (data.repeatType === 'untilDate') return !!data.repeatUntil;
    return false;
}, {
    message: "Please specify how to repeat the shift.",
    path: ['repeatOccurrences'],
});


export type ShiftTemplate = {
  id: string;
  name: string;
  label: string;
  startTime: string;
  endTime: string;
  color: string;
  breakStartTime?: string;
  breakEndTime?: string;
  isUnpaidBreak?: boolean;
  groupName?: string | null;
};

export type ShiftWithRepeat = z.infer<typeof shiftSchema>;

type ShiftEditorProps = {
  isOpen: boolean;
  setIsOpen: (isOpen: boolean) => void;
  shift: Shift | Partial<Shift> | null;
  onSave: (shift: ShiftWithRepeat) => void;
  onDelete: (shiftId: string) => void;
  employees: Employee[];
  shiftTemplates: ShiftTemplate[];
  setShiftTemplates: React.Dispatch<React.SetStateAction<ShiftTemplate[]>>;
  tasks: Task[];
  setTasks: React.Dispatch<React.SetStateAction<Task[]>>;
  currentUser: Employee;
};

const roleColors: { [key: string]: string } = {
  Manager: 'hsl(var(--chart-1))',
  Chef: 'hsl(var(--chart-1))',
  Barista: 'hsl(var(--chart-5))',
  Cashier: 'hsl(var(--chart-3))',
};

const shiftColorOptions = [
    { label: 'Default', value: 'default' },
    { label: 'Orange', value: 'hsl(var(--chart-4))' },
    { label: 'Red', value: 'hsl(var(--chart-1))' },
    { label: 'Blue', value: '#3498db' },
    { label: 'Green', value: 'hsl(var(--chart-2))' },
    { label: 'Purple', value: '#9b59b6' },
    { label: 'Pink', value: '#e91e63' },
    { label: 'Yellow', value: '#f1c40f' },
    { label: 'White', value: '#ffffff' },
    { label: 'Dark Grayish Blue', value: '#6b7280' },
];

function ShiftEditorForm({ isOpen, setIsOpen, shift, onSave, onDelete, employees, shiftTemplates, setShiftTemplates, tasks, setTasks, currentUser }: ShiftEditorProps) {
  const { toast } = useToast();
  const [editingTemplate, setEditingTemplate] = useState<ShiftTemplate | null>(null);
  const [editingTask, setEditingTask] = useState<Partial<Task> | null>(null);
  const [taskTitle, setTaskTitle] = useState('');
  const [taskDescription, setTaskDescription] = useState('');
  const [activeTab, setActiveTab] = useState('details');
  const [templateSearch, setTemplateSearch] = useState('');

  const selectedEmployee = employees.find(e => e.id === shift?.employeeId);
  const defaultColor = selectedEmployee ? roleColors[selectedEmployee.position] : shiftColorOptions[1].value;

  const form = useForm<z.infer<typeof shiftSchema>>({
    resolver: zodResolver(shiftSchema),
    defaultValues: {
        id: shift?.id || undefined,
        employeeId: shift?.employeeId || null,
        label: shift?.label || '',
        date: shift?.date ? new Date(shift.date) : new Date(),
        startTime: shift?.startTime || '',
        endTime: shift?.endTime || '',
        color: shift?.color || defaultColor,
        isDayOff: shift?.isDayOff || false,
        isHolidayOff: shift?.isHolidayOff || false,
        breakStartTime: shift?.breakStartTime || '',
        breakEndTime: shift?.breakEndTime || '',
        isUnpaidBreak: shift?.isUnpaidBreak || false,
        repeat: false,
        repeatType: 'occurrences',
        repeatOccurrences: 1,
    },
  });

  useEffect(() => {
    if (editingTask) {
        setTaskTitle(editingTask.title || '');
        setTaskDescription(editingTask.description || '');
    } else {
        setTaskTitle('');
        setTaskDescription('');
    }
  }, [editingTask]);

  const filteredTemplates = useMemo(() => {
    // Find the employee being edited to filter templates by their group.
    // If Unassigned (employeeId is null/undefined), show ALL templates.
    const assignedEmployee = shift?.employeeId
      ? employees.find(e => e.id === shift.employeeId)
      : null;

    const groupFiltered = assignedEmployee
      ? shiftTemplates.filter(t =>
          t.groupName === null || t.groupName === undefined || t.groupName === assignedEmployee.group
        )
      : shiftTemplates; // Unassigned — show all

    if (!templateSearch) return groupFiltered;
    const lowerSearch = templateSearch.toLowerCase();
    return groupFiltered.filter(t =>
        t.name.toLowerCase().includes(lowerSearch) ||
        t.label.toLowerCase().includes(lowerSearch)
    );
  }, [shiftTemplates, templateSearch, shift, employees]);

  const handleEditTemplate = (template: ShiftTemplate) => {
    setEditingTemplate(template);
    form.reset({
        ...form.getValues(),
        label: template.label,
        startTime: template.startTime,
        endTime: template.endTime,
        color: template.color,
        breakStartTime: template.breakStartTime,
        breakEndTime: template.breakEndTime,
        isUnpaidBreak: template.isUnpaidBreak,
    });
    setActiveTab('details');
  };
  
  const tasksForShift = shift?.id ? tasks.filter(t => t.shiftId === shift.id) : [];

  const handleSaveTask = () => {
    if (!taskTitle || !shift?.id) return;
    const taskData: Partial<Task> = {
        title: taskTitle,
        description: taskDescription,
    };
    if (editingTask?.id) {
        setTasks(tasks.map(t => t.id === editingTask.id ? { ...t, ...taskData } : t));
        toast({ title: "Task Updated" });
    } else {
        const newTask: Task = {
            id: `task-${Date.now()}`,
            shiftId: shift.id,
            scope: 'shift',
            status: 'pending',
            createdBy: currentUser.id,
            title: taskTitle,
            description: taskDescription,
        };
        setTasks([...tasks, newTask]);
        toast({ title: "Task Added" });
    }
    setEditingTask(null);
  }

  const handleDeleteTask = (taskId: string) => {
    setTasks(tasks.filter(t => t.id !== taskId));
    toast({ title: "Task Deleted", variant: 'destructive' });
  }

  const onSubmit = (values: z.infer<typeof shiftSchema>) => {
    if (editingTemplate) {
        const formValues = form.getValues();
        const updatedTemplate: ShiftTemplate = {
            ...editingTemplate,
            name: `${formValues.label} (${formValues.startTime}-${formValues.endTime})`,
            label: formValues.label || editingTemplate.label,
            startTime: formValues.startTime || editingTemplate.startTime,
            endTime: formValues.endTime || editingTemplate.endTime,
            color: formValues.color || editingTemplate.color,
            breakStartTime: formValues.breakStartTime,
            breakEndTime: formValues.breakEndTime,
            isUnpaidBreak: formValues.isUnpaidBreak,
        };
        setShiftTemplates(prev => 
            prev.map(t => t.id === editingTemplate.id ? updatedTemplate : t)
        );
        toast({ title: 'Template Updated', description: `The "${updatedTemplate.name}" template has been updated.` });
        setEditingTemplate(null);
        return;
    }

    const finalValues: ShiftWithRepeat = { ...values };
    if (values.isDayOff) {
        finalValues.label = 'OFF';
        finalValues.startTime = '';
        finalValues.endTime = '';
        finalValues.color = '#6b7280';
    } else if (values.isHolidayOff) {
        finalValues.label = 'HOL-OFF';
        finalValues.startTime = '';
        finalValues.endTime = '';
        finalValues.color = '#6b7280';
    } else if (finalValues.color === 'default' || !finalValues.color) {
        const employee = employees.find(e => e.id === values.employeeId);
        finalValues.color = employee ? roleColors[employee.position] : shiftColorOptions[1].value;
    }
    onSave(finalValues);
  };

  const handleDelete = () => {
    if (shift?.id) {
        onDelete(shift.id);
    }
  }
  
  const isDayOff = form.watch('isDayOff');
  const isHolidayOff = form.watch('isHolidayOff');
  const isRepeating = form.watch('repeat');
  const repeatType = form.watch('repeatType');

  const handleTemplateClick = (template: ShiftTemplate) => {
    form.reset({
      ...form.getValues(),
      label: template.label,
      startTime: template.startTime,
      endTime: template.endTime,
      color: template.color,
      breakStartTime: template.breakStartTime || '',
      breakEndTime: template.breakEndTime || '',
      isUnpaidBreak: template.isUnpaidBreak || false,
    });
    toast({ title: 'Template Applied', description: `The "${template.name}" template has been applied.`});
  }

  const handleDuplicateTemplate = (templateToDuplicate: typeof shiftTemplates[0]) => {
    const newTemplate = { ...templateToDuplicate, id: uuidv4(), name: `${templateToDuplicate.name} (Copy)` };
    setShiftTemplates(prev => [...prev, newTemplate]);
    toast({ title: 'Template Duplicated' });
  };

  const handleDeleteTemplate = (templateIdToDelete: string) => {
    setShiftTemplates(prev => prev.filter(t => t.id !== templateIdToDelete));
    toast({ title: 'Template Deleted', variant: 'destructive' });
  };

  const handleSaveAsTemplate = () => {
    const currentValues = form.getValues();
    if (currentValues.isDayOff || currentValues.isHolidayOff || !currentValues.label || !currentValues.startTime || !currentValues.endTime) {
        toast({ title: 'Cannot Save Template', description: 'Please provide a label, start time, and end time for a working shift.', variant: 'destructive' });
        return;
    }
    const newTemplate: ShiftTemplate = {
        id: uuidv4(),
        name: `${currentValues.label} (${currentValues.startTime}-${currentValues.endTime})`,
        label: currentValues.label,
        startTime: currentValues.startTime,
        endTime: currentValues.endTime,
        color: currentValues.color || 'default',
        breakStartTime: currentValues.breakStartTime,
        breakEndTime: currentValues.breakEndTime,
        isUnpaidBreak: currentValues.isUnpaidBreak,
    };
    setShiftTemplates(prev => [...prev, newTemplate]);
    toast({ title: 'Template Saved', description: `New template "${newTemplate.name}" has been created.` });
  }

  const cancelEditTemplate = () => {
    setEditingTemplate(null);
    form.reset({
        id: shift?.id || undefined,
        employeeId: shift?.employeeId || null,
        label: shift?.label || '',
        date: shift?.date ? new Date(shift.date) : new Date(),
        startTime: shift?.startTime || '',
        endTime: shift?.endTime || '',
        color: shift?.color || defaultColor,
        isDayOff: shift?.isDayOff || false,
        isHolidayOff: shift?.isHolidayOff || false,
        breakStartTime: shift?.breakStartTime || '',
        breakEndTime: shift?.breakEndTime || '',
        isUnpaidBreak: shift?.isUnpaidBreak || false,
    });
  }

  return (
    <>
        <DialogHeader>
          <DialogTitle>{editingTemplate ? `Editing Template: ${editingTemplate.name}` : (shift?.id ? 'Edit Shift' : 'Add New Shift')}</DialogTitle>
          <DialogDescription>
            {editingTemplate ? "Modify the template details below." : (shift?.id ? "Update the details for this shift." : "Fill in the details for the new shift.")}
          </DialogDescription>
        </DialogHeader>
        <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
            <TabsList className="grid w-full grid-cols-3">
                <TabsTrigger value="details">Details</TabsTrigger>
                <TabsTrigger value="tasks" disabled={!shift?.id || isDayOff || isHolidayOff}>Tasks</TabsTrigger>
                <TabsTrigger value="templates" disabled={!!editingTemplate}>Templates</TabsTrigger>
            </TabsList>
            <TabsContent value="details">
                 <Form {...form}>
                    <form onSubmit={form.handleSubmit(onSubmit)}>
                        <ScrollArea className="h-[55vh] pr-6">
                            <div className="space-y-4 py-4">
                                {!editingTemplate && (
                                    <>
                                    <FormField
                                        control={form.control}
                                        name="employeeId"
                                        render={({ field }) => (
                                            <FormItem>
                                            <FormLabel>Employee</FormLabel>
                                            <Select onValueChange={(value) => field.onChange(value === 'unassigned' ? null : value)} defaultValue={field.value || 'unassigned'}>
                                                <FormControl>
                                                <SelectTrigger>
                                                    <SelectValue placeholder="Select an employee" />
                                                </SelectTrigger>
                                                </FormControl>
                                                <SelectContent>
                                                <SelectItem value={'unassigned'}>Unassigned</SelectItem>
                                                {employees.map(emp => (
                                                    <SelectItem key={emp.id} value={emp.id}>{getFullName(emp)}</SelectItem>
                                                ))}
                                                </SelectContent>
                                            </Select>
                                            <FormMessage />
                                            </FormItem>
                                        )}
                                    />
                                    <FormField
                                    control={form.control}
                                    name="date"
                                    render={({ field }) => (
                                        <FormItem className="flex flex-col">
                                        <FormLabel>Date</FormLabel>
                                        <DatePicker
                                                date={field.value}
                                                onDateChange={field.onChange}
                                            />
                                        <FormMessage />
                                        </FormItem>
                                    )}
                                    />
                                    <div className="flex gap-4">
                                        <FormField
                                            control={form.control}
                                            name="isDayOff"
                                            render={({ field }) => (
                                                <FormItem className="flex flex-row items-center space-x-3 space-y-0 rounded-md border p-4">
                                                    <FormControl>
                                                        <Checkbox
                                                        checked={field.value}
                                                        onCheckedChange={(checked) => {
                                                            field.onChange(checked);
                                                            if (checked) form.setValue('isHolidayOff', false);
                                                        }}
                                                        />
                                                    </FormControl>
                                                    <div className="space-y-1 leading-none">
                                                        <FormLabel>
                                                        OFF
                                                        </FormLabel>
                                                    </div>
                                                </FormItem>
                                            )}
                                        />
                                        <FormField
                                            control={form.control}
                                            name="isHolidayOff"
                                            render={({ field }) => (
                                                <FormItem className="flex flex-row items-center space-x-3 space-y-0 rounded-md border p-4">
                                                    <FormControl>
                                                        <Checkbox
                                                        checked={field.value}
                                                        onCheckedChange={(checked) => {
                                                            field.onChange(checked);
                                                            if (checked) form.setValue('isDayOff', false);
                                                        }}
                                                        />
                                                    </FormControl>
                                                    <div className="space-y-1 leading-none">
                                                        <FormLabel>
                                                        HOL-OFF
                                                        </FormLabel>
                                                    </div>
                                                </FormItem>
                                            )}
                                        />
                                    </div>
                                    </>
                                )}
                                

                                {!isDayOff && !isHolidayOff && (
                                <>
                                    <FormField
                                    control={form.control}
                                    name="label"
                                    render={({ field }) => (
                                        <FormItem>
                                        <FormLabel>Shift Label</FormLabel>
                                        <FormControl>
                                            <Input placeholder="e.g., Morning Shift" {...field} />
                                        </FormControl>
                                        <FormMessage />
                                        </FormItem>
                                    )}
                                    />
                                    <div className="grid grid-cols-2 gap-4">
                                        <FormField
                                            control={form.control}
                                            name="startTime"
                                            render={({ field }) => (
                                                <FormItem>
                                                    <FormLabel>Start Time</FormLabel>
                                                    <FormControl>
                                                        <Input type="time" {...field} />
                                                    </FormControl>
                                                    <FormMessage />
                                                </FormItem>
                                            )}
                                        />
                                        <FormField
                                            control={form.control}
                                            name="endTime"
                                            render={({ field }) => (
                                                <FormItem>
                                                    <FormLabel>End Time</FormLabel>
                                                    <FormControl>
                                                        <Input type="time" {...field} />
                                                    </FormControl>
                                                    <FormMessage />
                                                </FormItem>
                                            )}
                                        />
                                    </div>
                                    <div className="space-y-2 rounded-md border p-4">
                                        <div className="flex items-center justify-between">
                                            <FormLabel>Break Time</FormLabel>
                                            <FormField
                                                control={form.control}
                                                name="isUnpaidBreak"
                                                render={({ field }) => (
                                                    <FormItem className="flex flex-row items-center space-x-2 space-y-0">
                                                        <FormControl>
                                                            <Checkbox
                                                                checked={field.value}
                                                                onCheckedChange={field.onChange}
                                                            />
                                                        </FormControl>
                                                        <FormLabel className="text-sm font-normal">
                                                            Unpaid Break
                                                        </FormLabel>
                                                    </FormItem>
                                                )}
                                            />
                                        </div>
                                        <div className="grid grid-cols-2 gap-4 pt-2">
                                            <FormField
                                                control={form.control}
                                                name="breakStartTime"
                                                render={({ field }) => (
                                                    <FormItem>
                                                        <FormLabel className="text-xs text-muted-foreground">Break Start</FormLabel>
                                                        <FormControl>
                                                            <Input type="time" {...field} />
                                                        </FormControl>
                                                    </FormItem>
                                                )}
                                            />
                                            <FormField
                                                control={form.control}
                                                name="breakEndTime"
                                                render={({ field }) => (
                                                    <FormItem>
                                                        <FormLabel className="text-xs text-muted-foreground">Break End</FormLabel>
                                                        <FormControl>
                                                            <Input type="time" {...field} />
                                                        </FormControl>
                                                    </FormItem>
                                                )}
                                            />
                                        </div>
                                    </div>
                                    <FormField
                                    control={form.control}
                                    name="color"
                                    render={({ field }) => (
                                        <FormItem>
                                        <FormLabel>Shift Color</FormLabel>
                                        <Select onValueChange={field.onChange} defaultValue={field.value}>
                                            <FormControl>
                                            <SelectTrigger>
                                                <SelectValue placeholder="Select a color" />
                                            </SelectTrigger>
                                            </FormControl>
                                            <SelectContent>
                                            {shiftColorOptions.map(option => (
                                                <SelectItem key={option.label} value={option.value}>
                                                <div className="flex items-center gap-2">
                                                        {option.value && option.value !== 'default' && <div className="w-4 h-4 rounded-full border" style={{backgroundColor: option.value}} />}
                                                        <span>{option.label}</span>
                                                </div>
                                                </SelectItem>
                                            ))}
                                            </SelectContent>
                                        </Select>
                                        <FormMessage />
                                        </FormItem>
                                    )}
                                    />
                                </>
                                )}
                                
                                {!shift?.id && !editingTemplate && (
                                    <>
                                    <Separator />
                                    <FormField
                                        control={form.control}
                                        name="repeat"
                                        render={({ field }) => (
                                        <FormItem className="flex flex-row items-center space-x-3 space-y-0 rounded-md border p-4">
                                            <FormControl>
                                                <Checkbox checked={field.value} onCheckedChange={field.onChange} />
                                            </FormControl>
                                            <div className="space-y-1 leading-none">
                                            <FormLabel className="flex items-center gap-2">
                                                <Repeat className="h-4 w-4" /> Repeat this shift
                                            </FormLabel>
                                            </div>
                                        </FormItem>
                                        )}
                                    />
                                    {isRepeating && (
                                        <div className="space-y-4 rounded-md border p-4">
                                            <FormField
                                                control={form.control}
                                                name="repeatType"
                                                render={({ field }) => (
                                                    <FormItem className="space-y-3">
                                                        <FormControl>
                                                            <RadioGroup onValueChange={field.onChange} defaultValue={field.value} className="flex flex-col space-y-1">
                                                                <FormItem className="flex items-center space-x-3 space-y-0">
                                                                    <FormControl><RadioGroupItem value="occurrences" /></FormControl>
                                                                    <FormLabel className="font-normal">
                                                                        For the next <FormField control={form.control} name="repeatOccurrences" render={({ field: numField }) => (
                                                                            <Input type="number" min="1" {...numField} className="inline-block w-20 mx-2 h-8" disabled={repeatType !== 'occurrences'} />
                                                                        )} /> occurrences, every day.
                                                                    </FormLabel>
                                                                </FormItem>
                                                                <FormItem className="flex items-center space-x-3 space-y-0">
                                                                    <FormControl><RadioGroupItem value="untilDate" /></FormControl>
                                                                    <FormLabel className="font-normal flex items-center gap-2">
                                                                        Every day until <FormField control={form.control} name="repeatUntil" render={({ field: dateField }) => (
                                                                            <DatePicker date={dateField.value} onDateChange={dateField.onChange} />
                                                                        )} />
                                                                    </FormLabel>
                                                                </FormItem>
                                                            </RadioGroup>
                                                        </FormControl>
                                                        <FormMessage />
                                                    </FormItem>
                                                )}
                                            />
                                        </div>
                                    )}
                                    </>
                                )}
                            </div>
                        </ScrollArea>

                        <DialogFooter className="flex-shrink-0 flex w-full flex-row sm:justify-between items-center pt-4 border-t">
                            <div className="flex items-center">
                                {shift?.id && !editingTemplate && (
                                    <Button type="button" variant="destructive" onClick={handleDelete} className="mr-auto">
                                        <Trash2 className="mr-2 h-4 w-4" />
                                        Delete
                                    </Button>
                                )}
                                {editingTemplate && (
                                    <Button type="button" variant="ghost" onClick={cancelEditTemplate} className="mr-auto">
                                        <X className="mr-2 h-4 w-4" />
                                        Cancel Edit
                                    </Button>
                                )}
                            </div>
                            <div className="flex items-center gap-2">
                                {!editingTemplate && (
                                <Button type="button" variant="outline" onClick={handleSaveAsTemplate} disabled={isDayOff || isHolidayOff}>
                                    Save as Template
                                </Button>
                                )}
                                <Button type="submit">{editingTemplate ? "Save Template" : "Save Shift"}</Button>
                            </div>
                        </DialogFooter>
                    </form>
                </Form>
            </TabsContent>
            <TabsContent value="tasks">
                <ScrollArea className="h-[55vh] pr-6">
                    <div className="space-y-4 py-4">
                        <Card>
                            <CardContent className="p-4 space-y-2">
                                <h4 className="font-semibold">{editingTask ? 'Edit Task' : 'Add New Task'}</h4>
                                <Input placeholder="Task Title" value={taskTitle} onChange={(e) => setTaskTitle(e.target.value)} />
                                <Textarea placeholder="Task Description (optional)" value={taskDescription} onChange={(e) => setTaskDescription(e.target.value)} />
                                <div className="flex justify-end gap-2">
                                    {editingTask && <Button variant="ghost" onClick={() => setEditingTask(null)}>Cancel Edit</Button>}
                                    <Button onClick={handleSaveTask} disabled={!taskTitle}>{editingTask ? 'Save Changes' : 'Add Task'}</Button>
                                </div>
                            </CardContent>
                        </Card>
                        <h4 className="font-semibold pt-4">Assigned Tasks</h4>
                        <div className="space-y-2">
                            {tasksForShift.length > 0 ? tasksForShift.map(task => (
                                <Card key={task.id} className="p-3 group">
                                    <div className="flex justify-between items-start">
                                        <div>
                                            <p className="font-semibold">{task.title}</p>
                                            <p className="text-sm text-muted-foreground">{task.description}</p>
                                        </div>
                                        <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setEditingTask(task)}>
                                                <Pencil className="h-4 w-4" />
                                            </Button>
                                            <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" onClick={() => handleDeleteTask(task.id)}>
                                                <Trash2 className="h-4 w-4" />
                                            </Button>
                                        </div>
                                    </div>
                                </Card>
                            )) : (
                                <p className="text-sm text-muted-foreground text-center py-4">No tasks assigned to this shift yet.</p>
                            )}
                        </div>
                    </div>
                </ScrollArea>
            </TabsContent>
            <TabsContent value="templates">
                <div className="relative pt-4 pb-2 px-1">
                    <Search className="absolute left-3 top-[26px] h-4 w-4 text-muted-foreground" />
                    <Input 
                        placeholder="Search templates..." 
                        className="pl-9" 
                        value={templateSearch}
                        onChange={(e) => setTemplateSearch(e.target.value)}
                    />
                </div>
                <ScrollArea className="h-[48vh] pr-6">
                    <div className="space-y-2 py-4">
                        {filteredTemplates.map((template) => (
                           <Card key={template.id} className="p-3 hover:bg-muted group">
                               <div className="flex items-center justify-between">
                                   <div className="flex items-start gap-3 cursor-pointer flex-1" onClick={() => handleTemplateClick(template)}>
                                       <FileText className="h-5 w-5 text-muted-foreground mt-1" />
                                       <div>
                                         <p className="font-semibold">{template.name}</p>
                                         <p className="text-sm text-muted-foreground">{template.startTime} - {template.endTime}</p>
                                         <p className="text-sm text-muted-foreground flex items-center gap-1">
                                            <span className="w-3 h-3 rounded-full" style={{ backgroundColor: template.color }}></span> 
                                            Label: {template.label}
                                         </p>
                                       </div>
                                   </div>
                                    <DropdownMenu>
                                        <DropdownMenuTrigger asChild>
                                            <Button variant="ghost" size="icon" className="h-8 w-8 opacity-0 group-hover:opacity-100">
                                                <MoreHorizontal className="h-4 w-4" />
                                            </Button>
                                        </DropdownMenuTrigger>
                                        <DropdownMenuContent align="end">
                                            <DropdownMenuItem onClick={() => handleEditTemplate(template)}>
                                                <Pencil className="mr-2 h-4 w-4" />
                                                <span>Edit</span>
                                            </DropdownMenuItem>
                                            <DropdownMenuItem onClick={() => handleDuplicateTemplate(template)}>
                                                <Copy className="mr-2 h-4 w-4" />
                                                <span>Duplicate</span>
                                            </DropdownMenuItem>
                                            <DropdownMenuItem className="text-red-600 focus:text-red-600" onClick={() => handleDeleteTemplate(template.id)}>
                                                <Trash2 className="mr-2 h-4 w-4" />
                                                <span>Delete</span>
                                            </DropdownMenuItem>
                                        </DropdownMenuContent>
                                    </DropdownMenu>
                               </div>
                           </Card>
                        ))}
                        {filteredTemplates.length === 0 && (
                            <p className="text-center text-muted-foreground py-8 text-sm italic">No templates found matching "{templateSearch}".</p>
                        )}
                    </div>
                </ScrollArea>
            </TabsContent>
        </Tabs>
    </>
  );
}


export function ShiftEditor(props: ShiftEditorProps) {
    if (!props.isOpen) {
        return null;
    }
    return (
        <Dialog open={props.isOpen} onOpenChange={props.setIsOpen}>
            <DialogContent className="sm:max-w-lg">
                <ShiftEditorForm {...props} />
            </DialogContent>
        </Dialog>
    );
}

    