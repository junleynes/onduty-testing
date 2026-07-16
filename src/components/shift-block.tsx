
'use client';

import React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import type { Shift, Leave } from '@/types';
import { cn } from '@/lib/utils';
import { getEmployeeById } from '@/lib/data';
import { getFullName } from '@/lib/utils';
import { Check } from 'lucide-react';


const blockVariants = cva(
  'w-full rounded-md text-left text-white overflow-hidden border relative',
  {
    variants: {
      type: {
        shift: 'text-black',
        leave: 'border-transparent',
        dayOff: 'text-center',
      },
      interactive: {
        true: 'cursor-pointer',
        false: 'cursor-default',
      },
      context: {
        week: 'p-1',
        month: 'p-0.5',
      }
    },
    defaultVariants: {
      type: 'shift',
      interactive: true,
      context: 'week',
    },
  }
);

interface ShiftBlockProps extends VariantProps<typeof blockVariants> {
  item: Shift | Leave;
  onClick: () => void;
  employee?: { firstName: string, lastName: string, middleInitial?: string } | null;
}


function isLeave(item: Shift | Leave): item is Leave {
  return 'type' in item;
}

const formatLeaveTime = (time: string) => {
    if (!time) return '';
    const [h, m] = time.split(':');
    let hour = parseInt(h, 10);
    const suffix = hour >= 12 ? 'p' : 'a';
    hour = hour % 12 || 12; // convert to 12-hour format
    if (m === '00') return `${hour}${suffix}`;
    return `${hour}:${m}${suffix}`;
};


export function ShiftBlock({ item, onClick, interactive, context, employee: employeeProp }: ShiftBlockProps) {
  if (isLeave(item)) {
    const backgroundColor = item.color || '#f97316';
    const isApprovedRequest = item.status === 'approved' && item.requestedAt;

    // For month view, just show the leave type for compactness
    if (context === 'month') {
       return (
          <div
            onClick={onClick}
            className={cn(blockVariants({ type: 'leave', interactive, context }), "text-center")}
            style={{ backgroundColor: backgroundColor, color: 'white' }}
          >
            <p className="font-bold text-xs truncate">{item.type}</p>
            {isApprovedRequest && <Check className="absolute top-0.5 right-0.5 h-3 w-3" />}
          </div>
       );
    }
    
    // Detailed view for day/week
    return (
      <div
        onClick={onClick}
        className={cn(blockVariants({ type: 'leave', interactive, context }))}
        style={{ backgroundColor: backgroundColor, color: 'white' }}
      >
        {isApprovedRequest && <Check className="absolute top-1 right-1 h-3.5 w-3.5" />}
        <div className="text-center">
             <p className="font-bold text-xs truncate">{item.type}</p>
            {item.isAllDay ? (
                 <p className="text-xs truncate">All day</p>
            ) : (
                <p className="text-xs truncate">{formatLeaveTime(item.startTime || '')}-{formatLeaveTime(item.endTime || '')}</p>
            )}
        </div>
      </div>
    );
  }

  const shift = item;

  if (!shift.label) return null;

  if (shift.isDayOff || shift.isHolidayOff) {
    const backgroundColor = '#6b7280';
    return (
       <div
        onClick={onClick}
        className={cn(blockVariants({ type: 'dayOff', interactive, context }))}
        style={{ backgroundColor: backgroundColor, color: 'white' }}
      >
        <p className="font-bold text-xs truncate whitespace-pre-wrap">{shift.label}</p>
         {context === 'week' && <p className="text-xs truncate whitespace-pre-wrap">All day</p>}
      </div>
    )
  }

  const employee = employeeProp ?? (shift.employeeId ? getEmployeeById(shift.employeeId) : null);
  
  const formatTime = (time: string) => {
    if (!time) return '';
    const [h, m] = time.split(':');
    let hour = parseInt(h, 10);
    const suffix = hour >= 12 ? 'p' : 'a';
    hour = hour % 12 || 12;
    // Always drop :00 minutes in week view for compactness
    if (m === '00') return `${hour}${suffix}`;
    return `${hour}:${m}${suffix}`;
  };

  const backgroundColor = shift.color || 'hsl(var(--primary))';
  const textColor = shift.color === '#ffffff' ? 'black' : 'white';
  const isDraft = shift.status === 'draft';

  return (
    <div
      onClick={onClick}
      className={cn(blockVariants({ type: 'shift', interactive, context }), 'text-center')}
      style={{ backgroundColor: backgroundColor, color: textColor, borderColor: backgroundColor === '#ffffff' ? 'hsl(var(--border))' : 'transparent' }}
    >
      {isDraft && context !== 'month' && (
        <div className="absolute inset-0 w-full h-full bg-striped-semitransparent z-10"></div>
      )}
      <div className="relative z-20">
        {context === 'month' ? (
           <p className="font-semibold text-xs truncate whitespace-pre-wrap">
              {shift.label}
           </p>
        ) : (
          <>
            <p className="font-semibold text-xs truncate whitespace-pre-wrap">
              {formatTime(shift.startTime)}-{formatTime(shift.endTime)}
            </p>
            <p className="text-xs truncate whitespace-pre-wrap">
              {shift.label}
            </p>
          </>
        )}
      </div>
    </div>
  );
}
