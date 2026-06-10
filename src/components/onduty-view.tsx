
'use client';

import React, { useState, useEffect } from 'react';
import type { Employee, Shift } from '@/types';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { getInitials, getBackgroundColor, getFullName } from '@/lib/utils';
import { isSameDay, parse, subDays } from 'date-fns';
import { Clock, Phone, Mail, ExternalLink } from 'lucide-react';
import { Button } from './ui/button';
import Link from 'next/link';

type ActiveShift = {
  employee: Employee;
  shift: Shift;
};

type OndutyViewProps = {
  employees: Employee[];
  shifts: Shift[];
  currentUser: Employee | null;
};

export default function OndutyView({ employees, shifts, currentUser }: OndutyViewProps) {
  const [currentTime, setCurrentTime] = useState(new Date());

  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(new Date()), 60000); // Update every minute
    return () => clearInterval(timer);
  }, []);

  const visibleEmployees = employees.filter(e => e.visibility?.onDuty !== false);
  const publishedShifts = shifts.filter(s => s.status === 'published' && !s.isDayOff && !s.isHolidayOff);
  const activeShifts: ActiveShift[] = [];

  const today = currentTime;
  const yesterday = subDays(today, 1);
  const relevantDays = [today, yesterday];

  publishedShifts.forEach(shift => {
    if (!shift.employeeId) return;

    const shiftDate = new Date(shift.date);
    
    // Only consider shifts from today or yesterday to catch overnight shifts
    if (!relevantDays.some(relevantDay => isSameDay(shiftDate, relevantDay))) return;

    const startTime = parse(shift.startTime, 'HH:mm', shiftDate);
    let endTime = parse(shift.endTime, 'HH:mm', shiftDate);

    // Handle overnight shifts by adding a day to the end time
    if (endTime < startTime) {
      endTime = new Date(endTime.getTime() + 24 * 60 * 60 * 1000);
    }
    
    if (currentTime >= startTime && currentTime <= endTime) {
      const employee = visibleEmployees.find(e => e.id === shift.employeeId);
      if (employee) {
        activeShifts.push({ employee, shift });
      }
    }
  });

  const groupedActiveShifts = activeShifts.reduce((acc, { employee, shift }) => {
    const groupName = employee.group || 'Unassigned';
    if (!acc[groupName]) {
      acc[groupName] = [];
    }
    acc[groupName].push({ employee, shift });
    return acc;
  }, {} as Record<string, ActiveShift[]>);
  
  // Sort employees within each group
  for (const groupName in groupedActiveShifts) {
    groupedActiveShifts[groupName].sort((a, b) => a.employee.lastName.localeCompare(b.employee.lastName));
  }

  const groupOrder = Object.keys(groupedActiveShifts).sort();

  return (
    <div className="space-y-4">
        <div className="flex justify-between items-start">
            <div>
                <h2 className="text-2xl font-bold tracking-tight">Who's On Duty?</h2>
                <p className="text-muted-foreground">
                    Team members currently on shift as of {currentTime.toLocaleTimeString()}.
                </p>
            </div>
            <Button asChild variant="outline">
                <Link href="/onduty" target="_blank">
                    <ExternalLink className="mr-2 h-4 w-4" />
                    View Public Page
                </Link>
            </Button>
        </div>
       
      <div className="space-y-6">
        {groupOrder.length > 0 ? (
            groupOrder.map(groupName => (
            <Card key={groupName}>
                <CardHeader>
                <CardTitle>{groupName}</CardTitle>
                </CardHeader>
                <CardContent>
                <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                    {groupedActiveShifts[groupName].map(({ employee, shift }) => (
                    <Card key={employee.id} className="shadow-md">
                        <CardContent className="p-4 flex flex-col gap-4">
                        <div className="flex items-center gap-4">
                            <Avatar className="h-16 w-16 border-2 border-primary">
                            <AvatarImage src={employee.avatar} data-ai-hint="profile avatar" />
                            <AvatarFallback style={{ backgroundColor: getBackgroundColor(getFullName(employee)) }} className="text-xl">
                                {getInitials(getFullName(employee))}
                            </AvatarFallback>
                            </Avatar>
                            <div>
                            <p className="font-bold text-lg">{getFullName(employee)}</p>
                            </div>
                        </div>
                        <div className="space-y-2 text-sm">
                            <div className="flex items-center gap-2">
                            <Clock className="h-4 w-4 text-muted-foreground" /> 
                            <span>{shift.startTime} - {shift.endTime}</span>
                            </div>
                            <div className="flex items-center gap-2">
                            <Mail className="h-4 w-4 text-muted-foreground" /> 
                            <a href={`mailto:${employee.email}`} className="text-primary hover:underline">{employee.email}</a>
                            </div>
                            <div className="flex items-center gap-2">
                            <Phone className="h-4 w-4 text-muted-foreground" /> 
                            <a href={`tel:${employee.phone}`} className="hover:underline">{employee.phone}</a>
                            </div>
                        </div>
                        </CardContent>
                    </Card>
                    ))}
                </div>
                </CardContent>
            </Card>
            ))
        ) : (
            <Card>
            <CardHeader>
                <CardTitle>No One On Duty</CardTitle>
            </CardHeader>
            <CardContent>
                <p className="text-center text-muted-foreground p-8 border-2 border-dashed rounded-lg">
                    There are currently no team members on a published shift.
                </p>
            </CardContent>
            </Card>
        )}
       </div>
    </div>
  );
}
