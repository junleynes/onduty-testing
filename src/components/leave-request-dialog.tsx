
'use client';

import React, { useEffect, useMemo } from 'react';
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
import { cn } from '@/lib/utils';
import { format } from 'date-fns';

const requestSchema = z.object({
  type: z.string().min(1, { message: 'Leave type is required.' }),
  reason: z.string().min(1, 'Reason is required.'),
  dateRange: z.object({
      from: z.date({ required_error: "A start date is required."}),
      to: z.date().optional(),
  }),
  durationCategory: z.enum(['whole', 'half', 'minutes']),
  timeSlot: z.string().optional(),
  startTime: z.string().optional(),
  endTime: z.string().optional(),
  totalMinutes: z.coerce.number().optional(),
});


type LeaveRequestDialogProps = {
  isOpen: boolean;
  setIsOpen: (isOpen: boolean) => void;
  request: Partial<Leave> | null;
  onSave: (request: Partial<Leave>) => void;
  leaveTypes: LeaveTypeOption[];
  currentUser: Employee;
};

export function LeaveRequestDialog({ isOpen, setIsOpen, request, onSave, leaveTypes, currentUser }: LeaveRequestDialogProps) {
  const form = useForm<z.infer<typeof requestSchema>>({
    resolver: zodResolver(requestSchema),
    defaultValues: {
        durationCategory: 'whole',
        timeSlot: '08:00-12:00',
        startTime: '08:00',
        endTime: '12:00',
        totalMinutes: 0
    },
  });

  const availableLeaveTypes = useMemo(() => 
    leaveTypes.filter(lt => lt.type !== 'Work Extension' && lt.type !== 'Offset'), 
  [leaveTypes]);

  useEffect(() => {
    if (isOpen) {
      const fromDate = request?.startDate ? new Date(request.startDate) : new Date();
      const toDate = request?.endDate ? new Date(request.endDate) : fromDate;
      const defaultType = request?.type || (availableLeaveTypes.length > 0 ? availableLeaveTypes[0].type : '');
      
      form.reset({
        type: defaultType,
        reason: request?.reason || '',
        dateRange: { from: fromDate, to: toDate },
        durationCategory: request?.durationCategory || (request?.isAllDay === false ? 'half' : 'whole'),
        startTime: request?.startTime || '08:00',
        endTime: request?.endTime || '12:00',
        totalMinutes: request?.totalMinutes || 0,
        timeSlot: request?.startTime && request?.endTime ? `${request.startTime}-${request.endTime}` : '08:00-12:00',
      });
    }
  }, [request, isOpen, form, currentUser, availableLeaveTypes]);

  const onSubmit = (values: z.infer<typeof requestSchema>) => {
    const finalValues: Partial<Leave> = {
      ...values,
      isAllDay: values.durationCategory === 'whole',
      startDate: values.dateRange.from,
      endDate: values.dateRange.to || values.dateRange.from,
    };
    onSave(finalValues);
  };
  
  const durationCategory = form.watch('durationCategory');
  const timeSlot = form.watch('timeSlot');

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
            <FormField
                control={form.control}
                name="dateRange"
                render={({ field }) => (
                    <FormItem className="flex flex-col">
                        <FormLabel>Dates of Leave</FormLabel>
                        <Popover>
                            <PopoverTrigger asChild>
                                <FormControl>
                                    <Button
                                        id="date"
                                        variant={"outline"}
                                        className={cn(
                                            "w-full justify-start text-left font-normal",
                                            !field.value.from && "text-muted-foreground"
                                        )}
                                    >
                                        <CalendarIcon className="mr-2 h-4 w-4" />
                                        {field.value?.from ? (
                                            field.value.to ? (
                                                <>
                                                    {format(field.value.from, "LLL dd, y")} -{" "}
                                                    {format(field.value.to, "LLL dd, y")}
                                                </>
                                            ) : (
                                                format(field.value.from, "LLL dd, y")
                                            )
                                        ) : (
                                            <span>Pick a date or range</span>
                                        )}
                                    </Button>
                                </FormControl>
                            </PopoverTrigger>
                            <PopoverContent className="w-auto p-0" align="start">
                                <Calendar
                                    initialFocus
                                    mode="range"
                                    defaultMonth={field.value?.from}
                                    selected={field.value}
                                    onSelect={field.onChange}
                                    numberOfMonths={2}
                                    captionLayout="dropdown-buttons"
                                    fromYear={2020}
                                    toYear={new Date().getFullYear() + 1}
                                />
                            </PopoverContent>
                        </Popover>
                        <FormMessage />
                    </FormItem>
                )}
            />
             <FormField
                control={form.control}
                name="durationCategory"
                render={({ field }) => (
                    <FormItem>
                    <FormLabel>Leave Duration</FormLabel>
                    <Select onValueChange={field.onChange} defaultValue={field.value}>
                        <FormControl>
                        <SelectTrigger>
                            <SelectValue />
                        </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                            <SelectItem value="whole">Whole day</SelectItem>
                            <SelectItem value="half">Half day</SelectItem>
                            <SelectItem value="minutes">Minutes / Tardy</SelectItem>
                        </SelectContent>
                    </Select>
                    <FormMessage />
                    </FormItem>
                )}
            />

            {durationCategory === 'half' && (
                <div className="space-y-4">
                    <FormField
                        control={form.control}
                        name="timeSlot"
                        render={({ field }) => (
                            <FormItem>
                                <FormLabel>Time Slot</FormLabel>
                                <Select 
                                    onValueChange={(value) => {
                                        field.onChange(value);
                                        if (value !== 'custom') {
                                            const [start, end] = value.split('-');
                                            form.setValue('startTime', start);
                                            form.setValue('endTime', end);
                                        }
                                    }}
                                    defaultValue={field.value}
                                >
                                    <FormControl>
                                        <SelectTrigger>
                                            <SelectValue placeholder="Select period" />
                                        </SelectTrigger>
                                    </FormControl>
                                    <SelectContent>
                                        <SelectItem value="08:00-12:00">AM (08:00 - 12:00)</SelectItem>
                                        <SelectItem value="13:00-17:00">PM (13:00 - 17:00)</SelectItem>
                                        <SelectItem value="custom">Custom Time</SelectItem>
                                    </SelectContent>
                                </Select>
                            </FormItem>
                        )}
                    />
                    {timeSlot === 'custom' && (
                        <div className="grid grid-cols-2 gap-4">
                            <FormField
                                control={form.control}
                                name="startTime"
                                render={({ field }) => (
                                    <FormItem>
                                        <FormLabel>Start Time</FormLabel>
                                        <Input type="time" {...field} />
                                    </FormItem>
                                )}
                            />
                            <FormField
                                control={form.control}
                                name="endTime"
                                render={({ field }) => (
                                    <FormItem>
                                        <FormLabel>End Time</FormLabel>
                                        <Input type="time" {...field} />
                                    </FormItem>
                                )}
                            />
                        </div>
                    )}
                </div>
            )}

            {durationCategory === 'minutes' && (
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
           
             <FormField
              control={form.control}
              name="reason"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Reason/Remarks</FormLabel>
                   <FormControl>
                    <Textarea {...field} placeholder="Please provide a brief reason for your request..." />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
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
