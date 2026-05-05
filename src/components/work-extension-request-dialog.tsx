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
import { format } from 'date-fns';
import { DatePicker } from './ui/date-picker';
import { getFullName } from '@/lib/utils';


const requestSchema = z.object({
  employeeId: z.string().min(1, 'Employee is required.'),
  originalShiftDate: z.date({ required_error: "Original shift date is required."}),
  originalStartTime: z.string().min(1, 'Original shift start time is required.'),
  originalEndTime: z.string().min(1, 'Original shift end time is required.'),
  startDate: z.date({ required_error: "A start date is required."}),
  startTime: z.string().min(1, 'Start time is required.'),
  endTime: z.string().min(1, 'End time is required.'),
  reason: z.string().min(1, 'Reason is required.'),
});


type WorkExtensionRequestDialogProps = {
  isOpen: boolean;
  setIsOpen: (isOpen: boolean) => void;
  request: Partial<Leave> | null;
  onSave: (request: Partial<Leave>) => void;
  currentUser: Employee;
  employees: Employee[];
};

export function WorkExtensionRequestDialog({ isOpen, setIsOpen, request, onSave, currentUser, employees }: WorkExtensionRequestDialogProps) {
  const form = useForm<z.infer<typeof requestSchema>>({
    resolver: zodResolver(requestSchema),
    defaultValues: {},
  });

  const isManager = currentUser.role === 'manager' || currentUser.role === 'admin';
  const groupMembers = useMemo(() => 
    employees.filter(e => e.group === currentUser.group).sort((a,b) => a.lastName.localeCompare(b.lastName)),
  [employees, currentUser.group]);

  useEffect(() => {
    if (isOpen) {
      form.reset({
        employeeId: request?.employeeId || currentUser.id,
        originalShiftDate: request?.originalShiftDate ? new Date(request.originalShiftDate) : new Date(),
        originalStartTime: request?.originalStartTime || '',
        originalEndTime: request?.originalEndTime || '',
        startDate: request?.startDate ? new Date(request.startDate) : new Date(),
        startTime: request?.startTime || '',
        endTime: request?.endTime || '',
        reason: request?.reason || '',
      });
    }
  }, [request, isOpen, form, currentUser.id]);

  const onSubmit = (values: z.infer<typeof requestSchema>) => {
    const finalValues: Partial<Leave> = {
      ...values,
      type: 'Work Extension',
      endDate: values.startDate, // Work extensions are for a single day
      isAllDay: false,
    };
    onSave(finalValues);
  };
  
  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{request?.id ? 'Edit' : 'New'} Work Extension Request</DialogTitle>
          <DialogDescription>
            {request?.id ? 'Update the details for this work extension.' : 'Fill in the details for the work extension.'}
          </DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4 py-4 max-h-[70vh] overflow-y-auto pr-2">
            
            {isManager ? (
               <FormField
                  control={form.control}
                  name="employeeId"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Employee</FormLabel>
                      <Select onValueChange={field.onChange} value={field.value}>
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue placeholder="Select team member..." />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {groupMembers.map(emp => (
                            <SelectItem key={emp.id} value={emp.id}>{getFullName(emp)}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />
            ) : (
                <FormItem>
                    <FormLabel>Name</FormLabel>
                    <FormControl>
                    <Input readOnly disabled value={getFullName(currentUser)} />
                    </FormControl>
                </FormItem>
            )}

             <div className="rounded-md border p-4 space-y-4">
                <p className="text-sm font-medium">Original Shift Details</p>
                 <FormField
                    control={form.control}
                    name="originalShiftDate"
                    render={({ field }) => (
                        <FormItem>
                            <FormLabel>Date of Original Shift</FormLabel>
                            <DatePicker date={field.value} onDateChange={field.onChange} />
                            <FormMessage />
                        </FormItem>
                    )}
                />
                 <div className="grid grid-cols-2 gap-4">
                     <FormField
                        control={form.control}
                        name="originalStartTime"
                        render={({ field }) => (
                        <FormItem>
                            <FormLabel>Start Time</FormLabel>
                            <Input type="time" {...field} />
                            <FormMessage />
                        </FormItem>
                        )}
                    />
                     <FormField
                        control={form.control}
                        name="originalEndTime"
                        render={({ field }) => (
                        <FormItem>
                            <FormLabel>End Time</FormLabel>
                            <Input type="time" {...field} />
                            <FormMessage />
                        </FormItem>
                        )}
                    />
                 </div>
             </div>
             
             <div className="rounded-md border p-4 space-y-4">
                <p className="text-sm font-medium">Extended Work Details</p>
                <FormField
                    control={form.control}
                    name="startDate"
                    render={({ field }) => (
                        <FormItem>
                            <FormLabel>Date of Work Extension</FormLabel>
                            <DatePicker date={field.value} onDateChange={field.onChange} />
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
                            <Input type="time" {...field} />
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
                            <Input type="time" {...field} />
                            <FormMessage />
                        </FormItem>
                        )}
                    />
                 </div>

             </div>

             <FormField
              control={form.control}
              name="reason"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Reason for Extension</FormLabel>
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
