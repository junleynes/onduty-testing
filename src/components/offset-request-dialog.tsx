
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
import { Calendar } from './ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from './ui/popover';
import { CalendarIcon } from 'lucide-react';
import { cn, getInitialState } from '@/lib/utils';
import { format, addDays } from 'date-fns';

const requestSchema = z.object({
  claimedWorkExtensionId: z.string().min(1, { message: 'You must select a work extension to claim.'}),
  reason: z.string().min(1, 'Reason is required.'),
  dateRange: z.object({
      from: z.date({ required_error: "A start date is required."}),
      to: z.date().optional(),
  }),
  isAllDay: z.boolean(),
});


type OffsetRequestDialogProps = {
  isOpen: boolean;
  setIsOpen: (isOpen: boolean) => void;
  request: Partial<Leave> | null;
  onSave: (request: Partial<Leave>) => void;
  currentUser: Employee;
  allLeaveRequests: Leave[];
};

export function OffsetRequestDialog({ isOpen, setIsOpen, request, onSave, currentUser, allLeaveRequests }: OffsetRequestDialogProps) {
  const expiryDays = getInitialState('workExtensionExpiryDays', 30);
  
  const form = useForm<z.infer<typeof requestSchema>>({
    resolver: zodResolver(requestSchema),
    defaultValues: {},
  });
  
  const availableWorkExtensions = useMemo(() => {
    return allLeaveRequests.filter(l => 
        l.employeeId === currentUser.id &&
        l.type === 'Work Extension' &&
        l.status === 'approved' &&
        l.workExtensionStatus === 'not-claimed' &&
        l.managedAt &&
        new Date() <= addDays(new Date(l.managedAt), expiryDays)
    );
  }, [allLeaveRequests, currentUser.id, expiryDays]);


  useEffect(() => {
    if (isOpen) {
      const fromDate = request?.startDate ? new Date(request.startDate) : new Date();
      const toDate = request?.endDate ? new Date(request.endDate) : fromDate;
      form.reset({
        claimedWorkExtensionId: request?.claimedWorkExtensionId || '',
        reason: request?.reason || '',
        dateRange: { from: fromDate, to: toDate },
        isAllDay: request?.isAllDay ?? true,
      });
    }
  }, [request, isOpen, form, currentUser]);

  const onSubmit = (values: z.infer<typeof requestSchema>) => {
    const finalValues: Partial<Leave> = {
      type: 'Offset',
      claimedWorkExtensionId: values.claimedWorkExtensionId,
      reason: values.reason,
      startDate: values.dateRange.from,
      endDate: values.dateRange.to || values.dateRange.from,
      isAllDay: values.isAllDay,
    };
    onSave(finalValues);
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
            <FormField
                control={form.control}
                name="dateRange"
                render={({ field }) => (
                    <FormItem className="flex flex-col">
                        <FormLabel>Dates of Offset</FormLabel>
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
                                />
                            </PopoverContent>
                        </Popover>
                        <FormMessage />
                    </FormItem>
                )}
            />
             <FormField
                control={form.control}
                name="isAllDay"
                render={({ field }) => (
                    <FormItem>
                    <FormLabel>Leave Duration</FormLabel>
                    <Select onValueChange={(value) => field.onChange(value === 'true')} defaultValue={String(field.value)}>
                        <FormControl>
                        <SelectTrigger>
                            <SelectValue />
                        </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                            <SelectItem value="true">Whole day</SelectItem>
                            <SelectItem value="false">Half day</SelectItem>
                        </SelectContent>
                    </Select>
                    <FormMessage />
                    </FormItem>
                )}
            />
           
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
