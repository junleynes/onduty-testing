
'use client';

import React, { useEffect, useMemo, useState } from 'react';
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
import type { Leave, Employee } from '@/types';
import { Textarea } from './ui/textarea';
import { Input } from './ui/input';
import type { LeaveTypeOption } from './leave-type-editor';
import { Calendar } from './ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from './ui/popover';
import { CalendarIcon } from 'lucide-react';
import { Checkbox } from './ui/checkbox';
import { cn } from '@/lib/utils';
import { format, differenceInCalendarDays, isSameDay } from 'date-fns';
import { Tabs, TabsList, TabsTrigger } from './ui/tabs';
import { RadioGroup, RadioGroupItem } from './ui/radio-group';

const requestSchema = z.object({
  type: z.string().min(1, { message: 'Leave type is required.' }),
  reason: z.string().min(1, 'Reason is required.'),
  selectionMode: z.enum(['single', 'multiple', 'range']),
  singleDate: z.date().optional(),
  multipleDates: z.array(z.date()).optional(),
  dateRange: z.object({
      from: z.date().optional(),
      to: z.date().optional(),
  }).optional(),
  durationCategory: z.enum(['whole', 'half', 'minutes']),
  originalStartTime: z.string().optional(),
  originalEndTime: z.string().optional(),
  halfDaySegment: z.enum(['first', 'second']).optional(),
  startTime: z.string().optional(),
  endTime: z.string().optional(),
  totalMinutes: z.coerce.number().optional(),
}).refine(data => {
    if (data.selectionMode === 'single') return !!data.singleDate;
    if (data.selectionMode === 'multiple') return data.multipleDates && data.multipleDates.length > 0;
    if (data.selectionMode === 'range') return data.dateRange?.from;
    return false;
}, {
    message: "Please select date(s).",
    path: ["singleDate"]
}).refine(data => {
    if (data.durationCategory === 'half' && data.selectionMode === 'single') {
        return !!data.originalStartTime && !!data.originalEndTime && !!data.halfDaySegment;
    }
    return true;
}, {
    message: "Please provide original schedule and select a segment.",
    path: ["halfDaySegment"]
});


const REASON_TEMPLATES = [
  'I will attend to a personal matter.',
  'I will attend a family event.',
  'I am not feeling well.',
  'I have a medical appointment.',
  'I need to attend to an urgent family concern.',
  'I will be travelling out of town.',
  'I have a prior personal commitment.',
  'I need to process government documents.',
];

type LeaveRequestDialogProps = {
  isOpen: boolean;
  setIsOpen: (isOpen: boolean) => void;
  request: Partial<Leave> | null;
  onSave: (request: Partial<Leave>, notifySuperior: boolean) => void;
  leaveTypes: LeaveTypeOption[];
  currentUser: Employee;
};

export function LeaveRequestDialog({ isOpen, setIsOpen, request, onSave, leaveTypes, currentUser }: LeaveRequestDialogProps) {
  const [notifySuperior, setNotifySuperior] = useState(true);
  const form = useForm<z.infer<typeof requestSchema>>({
    resolver: zodResolver(requestSchema),
    defaultValues: {
        selectionMode: 'single',
        durationCategory: 'whole',
        startTime: '08:00',
        endTime: '12:00',
        totalMinutes: 0,
        multipleDates: [],
        halfDaySegment: 'first',
    },
  });

  const availableLeaveTypes = useMemo(() => 
    leaveTypes.filter(lt => 
      lt.type !== 'Work Extension' && lt.type !== 'Offset' &&
      (lt.groupName === null || lt.groupName === undefined || lt.groupName === (currentUser as any).group)
    ), 
  [leaveTypes, currentUser]);

  useEffect(() => {
    if (isOpen) {
      const fromDate = request?.startDate ? new Date(request.startDate) : new Date();
      const toDate = request?.endDate ? new Date(request.endDate) : fromDate;
      const defaultType = request?.type || (availableLeaveTypes.length > 0 ? availableLeaveTypes[0].type : '');
      
      form.reset({
        type: defaultType,
        reason: request?.reason || '',
        selectionMode: request?.endDate && !isSameDay(new Date(request.startDate!), new Date(request.endDate)) ? 'range' : 'single',
        singleDate: fromDate,
        dateRange: { from: fromDate, to: toDate },
        multipleDates: request?.startDate ? [new Date(request.startDate)] : [],
        durationCategory: request?.durationCategory || (request?.isAllDay === false ? 'half' : 'whole'),
        originalStartTime: request?.originalStartTime || '',
        originalEndTime: request?.originalEndTime || '',
        halfDaySegment: request?.halfDaySegment || 'first',
        startTime: request?.startTime || '08:00',
        endTime: request?.endTime || '12:00',
        totalMinutes: request?.totalMinutes || 0,
      });
    }
  }, [request, isOpen, form, currentUser, availableLeaveTypes]);

  const selectionMode = form.watch('selectionMode');
  const singleDate = form.watch('singleDate');
  const multipleDates = form.watch('multipleDates') || [];
  const dateRange = form.watch('dateRange');
  const durationCategory = form.watch('durationCategory');

  const totalDays = useMemo(() => {
    if (durationCategory === 'minutes') return 0;
    let base = 0;
    if (selectionMode === 'single') base = singleDate ? 1 : 0;
    else if (selectionMode === 'multiple') base = multipleDates.length;
    else if (selectionMode === 'range') {
        if (dateRange?.from && dateRange?.to) {
            base = differenceInCalendarDays(dateRange.to, dateRange.from) + 1;
        } else if (dateRange?.from) {
            base = 1;
        }
    }
    return durationCategory === 'half' ? base * 0.5 : base;
  }, [selectionMode, singleDate, multipleDates, dateRange, durationCategory]);

  const onSubmit = (values: z.infer<typeof requestSchema>) => {
    if (values.selectionMode === 'multiple' && values.multipleDates) {
        // Submit each date individually
        values.multipleDates.forEach(date => {
            onSave({
                ...values,
                isAllDay: values.durationCategory === 'whole',
                startDate: date,
                endDate: date,
            }, notifySuperior);
        });
    } else {
        const finalValues: Partial<Leave> = {
            ...values,
            isAllDay: values.durationCategory === 'whole',
            startDate: values.selectionMode === 'range' ? values.dateRange?.from : values.singleDate,
            endDate: values.selectionMode === 'range' ? values.dateRange?.to || values.dateRange?.from : values.singleDate,
        };
        onSave(finalValues, notifySuperior);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{request?.id ? 'Edit Request' : 'New Time Off Request'}</DialogTitle>
          <DialogDescription>
            {request?.id ? 'Update the details for your request.' : 'Fill in the details for your request.'}
          </DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4 py-4 max-h-[70vh] overflow-y-auto pr-2">
             <div className="grid grid-cols-2 gap-4">
               <FormItem>
                  <FormLabel>Name</FormLabel>
                  <FormControl>
                    <Input readOnly disabled value={`${currentUser.firstName} ${currentUser.lastName}`} />
                  </FormControl>
                </FormItem>
                 <FormItem>
                  <FormLabel>Date Filed</FormLabel>
                  <FormControl>
                    <Input readOnly disabled value={format(new Date(), 'MMMM d, yyyy')} />
                  </FormControl>
                </FormItem>
             </div>
            <FormField
              control={form.control}
              name="type"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Leave Type</FormLabel>
                  <Select onValueChange={field.onChange} defaultValue={field.value}>
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue placeholder="Select a request type" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {availableLeaveTypes.map(lt => (
                        <SelectItem key={lt.type} value={lt.type}>{lt.type}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />

            <div className="space-y-2">
                <FormLabel>Dates of Leave</FormLabel>
                <Tabs value={selectionMode} onValueChange={(v) => {
                    form.setValue('selectionMode', v as any);
                    if (v !== 'single') form.setValue('durationCategory', 'whole');
                }}>
                    <TabsList className="grid w-full grid-cols-3 mb-2">
                        <TabsTrigger value="single">Single</TabsTrigger>
                        <TabsTrigger value="multiple">Multiple</TabsTrigger>
                        <TabsTrigger value="range">Range</TabsTrigger>
                    </TabsList>
                </Tabs>
                
                <Popover>
                    <PopoverTrigger asChild>
                        <Button
                            variant={"outline"}
                            className={cn(
                                "w-full justify-start text-left font-normal",
                                !singleDate && selectionMode === 'single' && "text-muted-foreground"
                            )}
                        >
                            <CalendarIcon className="mr-2 h-4 w-4" />
                            {selectionMode === 'single' ? (
                                singleDate ? format(singleDate, "PPP") : <span>Pick a date</span>
                            ) : selectionMode === 'multiple' ? (
                                multipleDates.length > 0 ? `${multipleDates.length} dates selected` : <span>Pick dates</span>
                            ) : (
                                dateRange?.from ? (
                                    dateRange.to ? (
                                        <>{format(dateRange.from, "LLL dd, y")} - {format(dateRange.to, "LLL dd, y")}</>
                                    ) : format(dateRange.from, "LLL dd, y")
                                ) : <span>Pick a range</span>
                            )}
                        </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-auto p-0" align="start">
                        {selectionMode === 'single' && (
                            <Calendar
                                mode="single"
                                selected={singleDate}
                                onSelect={(d) => {
                                    form.setValue('singleDate', d);
                                }}
                                initialFocus
                            />
                        )}
                        {selectionMode === 'multiple' && (
                            <Calendar
                                mode="multiple"
                                selected={multipleDates}
                                onSelect={(d) => {
                                    form.setValue('multipleDates', d);
                                }}
                                initialFocus
                            />
                        )}
                        {selectionMode === 'range' && (
                            <Calendar
                                mode="range"
                                selected={dateRange}
                                onSelect={(d) => {
                                    form.setValue('dateRange', d || { from: undefined, to: undefined });
                                }}
                                numberOfMonths={2}
                                initialFocus
                            />
                        )}
                    </PopoverContent>
                </Popover>
                <FormMessage />
            </div>

             <FormField
                control={form.control}
                name="durationCategory"
                render={({ field }) => (
                    <FormItem>
                    <FormLabel>Leave Duration</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value}>
                        <FormControl>
                        <SelectTrigger>
                            <SelectValue />
                        </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                            <SelectItem value="whole">Whole day</SelectItem>
                            {selectionMode === 'single' && <SelectItem value="half">Half day</SelectItem>}
                            {selectionMode === 'single' && <SelectItem value="minutes">Minutes / Tardy</SelectItem>}
                        </SelectContent>
                    </Select>
                    <FormMessage />
                    </FormItem>
                )}
            />

            {durationCategory === 'half' && selectionMode === 'single' && (
                <div className="space-y-4 p-4 border rounded-md bg-muted/20">
                    <p className="text-sm font-semibold">Half Day Filing Details</p>
                    <div className="grid grid-cols-2 gap-4">
                        <FormField
                            control={form.control}
                            name="originalStartTime"
                            render={({ field }) => (
                                <FormItem>
                                    <FormLabel className="text-xs">Orig. Sched Start</FormLabel>
                                    <Input type="time" {...field} />
                                </FormItem>
                            )}
                        />
                        <FormField
                            control={form.control}
                            name="originalEndTime"
                            render={({ field }) => (
                                <FormItem>
                                    <FormLabel className="text-xs">Orig. Sched End</FormLabel>
                                    <Input type="time" {...field} />
                                </FormItem>
                            )}
                        />
                    </div>
                    <FormField
                        control={form.control}
                        name="halfDaySegment"
                        render={({ field }) => (
                            <FormItem className="space-y-3">
                                <FormLabel>Which half are you filing?</FormLabel>
                                <FormControl>
                                    <RadioGroup
                                        onValueChange={field.onChange}
                                        defaultValue={field.value}
                                        className="flex gap-4"
                                    >
                                        <FormItem className="flex items-center space-x-2 space-y-0">
                                            <FormControl><RadioGroupItem value="first" /></FormControl>
                                            <FormLabel className="font-normal">First Half</FormLabel>
                                        </FormItem>
                                        <FormItem className="flex items-center space-x-2 space-y-0">
                                            <FormControl><RadioGroupItem value="second" /></FormControl>
                                            <FormLabel className="font-normal">Second Half</FormLabel>
                                        </FormItem>
                                    </RadioGroup>
                                </FormControl>
                                <FormMessage />
                            </FormItem>
                        )}
                    />
                </div>
            )}

            {durationCategory === 'minutes' && selectionMode === 'single' && (
                <div className="grid grid-cols-2 gap-4">
                     <FormField
                        control={form.control}
                        name="totalMinutes"
                        render={({ field }) => (
                            <FormItem>
                                <FormLabel>Minutes</FormLabel>
                                <Input type="number" {...field} placeholder="e.g. 15" />
                            </FormItem>
                        )}
                    />
                    <FormField
                        control={form.control}
                        name="startTime"
                        render={({ field }) => (
                            <FormItem>
                                <FormLabel>Start / Arrival Time</FormLabel>
                                <Input type="time" {...field} />
                            </FormItem>
                        )}
                    />
                </div>
            )}
           
             <FormItem>
                <FormLabel>Reason/Remarks</FormLabel>
                <div className="space-y-2">
                  <select
                    className="w-full text-sm border rounded-md px-3 py-2 bg-background text-muted-foreground"
                    value=""
                    onChange={e => { if (e.target.value) form.setValue('reason', e.target.value); e.target.value = ''; }}
                  >
                    <option value="">— Use a template reason —</option>
                    {REASON_TEMPLATES.map(t => <option key={t} value={t}>{t}</option>)}
                  </select>
                  <FormField
                    control={form.control}
                    name="reason"
                    render={({ field }) => (
                      <FormItem>
                        <FormControl>
                          <Textarea {...field} placeholder="Write your reason here, or choose a template above..." rows={3} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>
              </FormItem>

              <div className="flex items-center gap-2 pt-1">
                <Checkbox id="notifySuperiorLeave" checked={notifySuperior} onCheckedChange={v => setNotifySuperior(!!v)} />
                <label htmlFor="notifySuperiorLeave" className="text-sm text-muted-foreground cursor-pointer select-none">
                  Notify my superior/manager after submitting
                </label>
              </div>

            {durationCategory !== 'minutes' && totalDays > 0 && (
                <div className="p-3 bg-muted rounded-md text-sm font-medium flex justify-between items-center">
                    <span>Summary</span>
                    <span>Total: {totalDays} Day{totalDays !== 1 ? 's' : ''}</span>
                </div>
            )}

            <DialogFooter>
              <Button type="button" variant="ghost" onClick={() => setIsOpen(false)}>Cancel</Button>
              <Button type="submit">Submit Request</Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
