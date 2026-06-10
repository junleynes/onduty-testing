'use client';

import React, { useState } from 'react';
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
import { Input } from './ui/input';
import { PlusCircle, Trash2, Upload } from 'lucide-react';
import { ScrollArea } from './ui/scroll-area';
import { useToast } from '@/hooks/use-toast';
import type { Holiday } from '@/types';
import type { Employee } from '@/types';
import { DatePicker } from './ui/date-picker';
import { format } from 'date-fns';
import { Separator } from './ui/separator';
import { v4 as uuidv4 } from 'uuid';

const formSchema = z.object({
  title: z.string().min(1, 'Holiday name is required'),
  date: z.date({ required_error: 'A date is required.' }),
});

type HolidayEditorProps = {
  isOpen: boolean;
  setIsOpen: (isOpen: boolean) => void;
  holidays: Holiday[];
  setHolidays: React.Dispatch<React.SetStateAction<Holiday[]>>;
  onImport: () => void;
  currentUser: Employee | null;
};

export function HolidayEditor({ isOpen, setIsOpen, holidays, setHolidays, onImport, currentUser }: HolidayEditorProps) {
  const { toast } = useToast();
  const currentGroup = currentUser?.group ?? null;

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      title: '',
      date: new Date(),
    },
  });

  const onSubmit = (values: z.infer<typeof formSchema>) => {
    const newHoliday: Holiday = {
        ...values,
        id: uuidv4(),
        groupName: currentGroup,
    };
    setHolidays(prev => [...prev, newHoliday].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime()));
    form.reset({ title: '', date: new Date() });
    toast({ title: 'Holiday Added' });
  };

  const deleteHoliday = (id: string) => {
    setHolidays(prev => prev.filter(h => h.id !== id));
    toast({ title: 'Holiday Removed', variant: 'destructive' });
  };

  // Only show holidays for the current group (or unscoped nulls)
  const groupHolidays = [...holidays]
    .filter(h => h.groupName === currentGroup || (currentGroup === null && (h.groupName === null || h.groupName === undefined)))
    .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Manage Holidays{currentGroup ? ` — ${currentGroup}` : ''}</DialogTitle>
          <DialogDescription>
            Add or remove holidays for {currentGroup ? `the ${currentGroup} group` : 'this group'}.
          </DialogDescription>
        </DialogHeader>

        <div className="font-semibold">Add New Holiday</div>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <div className="grid grid-cols-[2fr,1fr] gap-4">
              <FormField
                control={form.control}
                name="title"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="sr-only">Holiday Name</FormLabel>
                    <FormControl>
                      <Input {...field} placeholder="Holiday Name (e.g., Independence Day)" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="date"
                render={({ field }) => (
                  <FormItem className="flex flex-col">
                    <FormLabel className="sr-only">Date</FormLabel>
                    <DatePicker date={field.value} onDateChange={field.onChange} />
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>
            <Button type="submit" className="w-full">
              <PlusCircle className="mr-2 h-4 w-4" />Add Holiday
            </Button>
          </form>
        </Form>

        <Separator />

        <Button variant="outline" className="w-full" onClick={onImport}>
          <Upload className="mr-2 h-4 w-4" />Import from CSV
        </Button>

        <div className="font-semibold mt-4">
          Holidays{currentGroup ? ` for ${currentGroup}` : ''} ({groupHolidays.length})
        </div>
        <ScrollArea className="h-60 pr-6 border rounded-md">
          <div className="space-y-2 p-2">
            {groupHolidays.map((holiday) => (
              <div key={holiday.id} className="flex items-center justify-between gap-2 p-2 border rounded-md">
                <div>
                  <p className="font-medium">{holiday.title}</p>
                  <p className="text-sm text-muted-foreground">{format(new Date(holiday.date), 'MMMM d, yyyy')}</p>
                </div>
                <Button
                  type="button"
                  variant="destructive"
                  size="icon"
                  onClick={() => deleteHoliday(holiday.id)}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            ))}
            {groupHolidays.length === 0 && (
              <p className="text-sm text-muted-foreground text-center p-4">
                No holidays added for {currentGroup ? `the ${currentGroup} group` : 'this group'} yet.
              </p>
            )}
          </div>
        </ScrollArea>

        <DialogFooter>
          <Button type="button" variant="secondary" onClick={() => setIsOpen(false)}>Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
