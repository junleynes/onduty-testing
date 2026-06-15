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
import { Calendar } from './ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from './ui/popover';
import { CalendarIcon } from 'lucide-react';
import { Checkbox } from './ui/checkbox';
import { cn, getInitialState } from '@/lib/utils';
import { format, addDays, startOfDay, isSameDay } from 'date-fns';
import { RadioGroup, RadioGroupItem } from './ui/radio-group';

const requestSchema = z.object({
  claimedWorkExtensionId: z.string().min(1, { message: 'You must select a work extension to claim.'}),
  reason: z.string().min(1, 'Reason is required.'),
  singleDate: z.date({ required_error: "Please select a date." }),
  durationCategory: z.enum(['whole', 'half', 'minutes']),
  originalStartTime: z.string().optional(),
  originalEndTime: z.string().optional(),
  halfDaySegment: z.enum(['first', 'second']).optional(),
  startTime: z.string().optional(),
  endTime: z.string().optional(),
  totalMinutes: z.coerce.number().optional(),
}).refine(data => {
    if (data.durationCategory === 'half') {
        return !!data.originalStartTime && !!data.originalEndTime && !!data.halfDaySegment;
    }
    return true;
}, {
    message: "Please provide original schedule and select a segment.",
    path: ["halfDaySegment"]
});


const OFFSET_REASON_TEMPLATES = [
  'I will use my offset for a personal matter.',
  'I will attend a family event.',
  'I have a medical appointment.',
  'I will be travelling out of town.',
  'I need to attend to an urgent family concern.',
  'I have a prior personal commitment.',
  'I need to process government documents.',
];

type OffsetRequestDialogProps = {
  isOpen: boolean;
  setIsOpen: (isOpen: boolean) => void;
  request: Partial<Leave> | null;
  onSave: (request: Partial<Leave>, notifySuperior: boolean) => void;
  currentUser: Employee;
  allLeaveRequests: Leave[];
};

export function OffsetRequestDialog({ isOpen, setIsOpen, request, onSave, currentUser, allLeaveRequests }: OffsetRequestDialogProps) {
  const [notifySuperior, setNotifySuperior] = useState(true);
  const expiryDays = Number(getInitialState('workExtensionExpiryDays', 30));
  
  const form = useForm<z.infer<typeof requestSchema>>({
    resolver: zodResolver(requestSchema),
    defaultValues: {
        durationCategory: 'whole',
        startTime: '08:00',
        endTime: '12:00',
        totalMinutes: 0,
        halfDaySegment: 'first',
    },
  });
  
  const availableWorkExtensions = useMemo(() => {
    return allLeaveRequests.filter(l => {
        const isMine = l.employeeId === currentUser.id;
        const isWorkExtension = l.type === 'Work Extension';
        const isApproved = l.status === 'approved' || l.status === 'processed';
        const isNotClaimed = !l.workExtensionStatus || l.workExtensionStatus === 'not-claimed';
        
        if (!isMine || !isWorkExtension || !isApproved || !isNotClaimed || !l.managedAt) {
            return false;
        }

        const expiryDate = addDays(new Date(l.managedAt), expiryDays);
        return startOfDay(new Date()) <= startOfDay(expiryDate);
    });
  }, [allLeaveRequests, currentUser.id, expiryDays]);


  useEffect(() => {
    if (isOpen) {
      const fromDate = request?.startDate ? new Date(request.startDate) : new Date();
      form.reset({
        claimedWorkExtensionId: request?.claimedWorkExtensionId || '',
        reason: request?.reason || '',
        singleDate: fromDate,
        durationCategory: request?.durationCategory || (request?.isAllDay === false ? 'half' : 'whole'),
        originalStartTime: request?.originalStartTime || '',
        originalEndTime: request?.originalEndTime || '',
        halfDaySegment: request?.halfDaySegment || 'first',
        startTime: request?.startTime || '08:00',
        endTime: request?.endTime || '12:00',
        totalMinutes: request?.totalMinutes || 0,
      });
    }
  }, [request, isOpen, form]);

  const singleDate = form.watch('singleDate');
  const durationCategory = form.watch('durationCategory');

  const totalDays = useMemo(() => {
    if (durationCategory === 'minutes') return 0;
    const base = singleDate ? 1 : 0;
    return durationCategory === 'half' ? base * 0.5 : base;
  }, [singleDate, durationCategory]);

  const onSubmit = (values: z.infer<typeof requestSchema>) => {
    const finalValues: Partial<Leave> = {
        ...values,
        type: 'Offset',
        isAllDay: values.durationCategory === 'whole',
        startDate: values.singleDate,
        endDate: values.singleDate,
    };
    onSave(finalValues, notifySuperior);
  };

  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{request?.id ? 'Edit' : 'New'} Offset Request</DialogTitle>
          <DialogDescription>
            Claim an approved work extension by filing for an offset.
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
              name="claimedWorkExtensionId"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Claim Work Extension</FormLabel>
                  <Select onValueChange={field.onChange} value={field.value}>
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue placeholder="Select an approved work extension..." />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {availableWorkExtensions.length > 0 ? (
                        availableWorkExtensions.map(we => (
                          <SelectItem key={we.id} value={we.id}>
                            <div className="flex flex-col">
                                <span className="font-medium">{format(new Date(we.startDate), 'MMM d, yyyy')} ({we.startTime}-{we.endTime})</span>
                                <span className="text-xs text-muted-foreground line-clamp-1">{we.reason}</span>
                            </div>
                          </SelectItem>
                        ))
                      ) : (
                        <div className="p-4 text-sm text-muted-foreground text-center italic">No claimable work extensions found.</div>
                      )}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />

            <div className="space-y-2">
                <FormLabel>Date of Offset</FormLabel>
                <Popover>
                    <PopoverTrigger asChild>
                        <Button
                            variant={"outline"}
                            className={cn(
                                "w-full justify-start text-left font-normal",
                                !singleDate && "text-muted-foreground"
                            )}
                        >
                            <CalendarIcon className="mr-2 h-4 w-4" />
                            {singleDate ? format(singleDate, "PPP") : <span>Pick a date</span>}
                        </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-auto p-0" align="start">
                        <Calendar
                            mode="single"
                            selected={singleDate}
                            onSelect={(d) => form.setValue('singleDate', d!)}
                            initialFocus
                        />
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
                            <SelectItem value="half">Half day</SelectItem>
                            <SelectItem value="minutes">Minutes / Tardy</SelectItem>
                        </SelectContent>
                    </Select>
                    <FormMessage />
                    </FormItem>
                )}
            />

            {durationCategory === 'half' && (
                <div className="space-y-4 p-4 border rounded-md bg-muted/20">
                    <p className="text-sm font-semibold">Half Day Offset Details</p>
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
                                <FormLabel>Arrival Time</FormLabel>
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
                    onChange={e => {
                      if (e.target.value) form.setValue('reason', e.target.value);
                      e.target.value = '';
                    }}
                  >
                    <option value="">— Use a template reason —</option>
                    {OFFSET_REASON_TEMPLATES.map(t => (
                      <option key={t} value={t}>{t}</option>
                    ))}
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
                <Checkbox
                  id="notifySuperiorOffset"
                  checked={notifySuperior}
                  onCheckedChange={v => setNotifySuperior(!!v)}
                />
                <label htmlFor="notifySuperiorOffset" className="text-sm text-muted-foreground cursor-pointer select-none">
                  Notify my superior/manager by email after submitting
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
