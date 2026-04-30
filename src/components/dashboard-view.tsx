
'use client';

import React, { useEffect, useState } from 'react';
import type { NavItemKey, RolePermissions, UserRole, Employee } from '@/types';
import { Button } from './ui/button';
import { CalendarDays, ClipboardCheck, Clock, Users, Plane, Gift, PartyPopper, Smartphone, Calendar, Palmtree } from 'lucide-react';
import type { NavItem } from '@/app/page';
import { Avatar, AvatarFallback, AvatarImage } from './ui/avatar';
import { getBackgroundColor, getFullName, getInitials } from '@/lib/utils';
import { Card } from './ui/card';

const iconMap: Record<string, { icon: React.ElementType, color: string }> = {
    'my-schedule': { icon: Calendar, color: 'bg-orange-100 text-orange-700' },
    'my-tasks': { icon: ClipboardCheck, color: 'bg-green-100 text-green-700' },
    'onduty': { icon: Clock, color: 'bg-blue-100 text-blue-700' },
    'team': { icon: Users, color: 'bg-purple-100 text-purple-700' },
    'time-off': { icon: Plane, color: 'bg-cyan-100 text-cyan-700' },
    'avl-management': { icon: Palmtree, color: 'bg-emerald-100 text-emerald-700' },
    'celebrations': { icon: Gift, color: 'bg-pink-100 text-pink-700' },
    'holidays': { icon: PartyPopper, color: 'bg-yellow-100 text-yellow-700' },
    'allowance': { icon: Smartphone, color: 'bg-teal-100 text-teal-700' },
};

const QUICK_LINKS: { view: NavItemKey; label: string; }[] = [
    { view: 'my-schedule', label: 'My Schedule' },
    { view: 'my-tasks', label: 'My Tasks' },
    { view: 'onduty', label: 'On Duty' },
    { view: 'team', label: 'Team' },
    { view: 'time-off', label: 'Time Off' },
    { view: 'avl-management', label: 'AVL Manager' },
    { view: 'celebrations', label: 'Celebrations' },
    { view: 'holidays', label: 'Holidays' },
    { view: 'allowance', label: 'Mobile Load' },
];

type DashboardViewProps = {
  onNavigate: (view: NavItem) => void;
  permissions: RolePermissions;
  role: UserRole;
  currentUser: Employee;
};

export default function DashboardView({ onNavigate, permissions, role, currentUser }: DashboardViewProps) {
  const allowedViews = new Set(permissions[role] || []);
  const [greeting, setGreeting] = useState('');

  useEffect(() => {
    const hour = new Date().getHours();
    if (hour < 12) {
      setGreeting('Good Morning');
    } else if (hour < 18) {
      setGreeting('Good Afternoon');
    } else {
      setGreeting('Good Evening');
    }
  }, []);

  const availableLinks = QUICK_LINKS.filter(link => allowedViews.has(link.view));

  return (
    <div className="relative pt-12">
        <div className="absolute top-0 left-1/2 -translate-x-1/2 z-10">
             <Avatar className="h-24 w-24 border-4 border-primary shadow-lg">
                <AvatarImage src={currentUser.avatar} data-ai-hint="profile avatar" />
                <AvatarFallback style={{ backgroundColor: getBackgroundColor(getFullName(currentUser)) }} className="text-4xl font-bold">
                    {getInitials(getFullName(currentUser))}
                </AvatarFallback>
            </Avatar>
        </div>
      <Card className="text-center pt-16 pb-8 px-8 shadow-sm">

        <h1 className="text-3xl font-bold tracking-tight mt-2">
            {greeting}, {currentUser.firstName}! 👋
        </h1>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 sm:gap-6 w-full max-w-3xl mx-auto mt-8">
            {availableLinks.map(({ view, label }) => {
                const Icon = iconMap[view]?.icon || ClipboardCheck;
                const colors = iconMap[view]?.color || 'bg-gray-100 text-gray-700';
                return (
                    <button 
                        key={view} 
                        onClick={() => onNavigate(view)}
                        className="flex flex-col items-center justify-center gap-2 group p-4 border rounded-lg shadow-sm hover:shadow-md transition-shadow bg-background"
                    >
                        <div className={`flex items-center justify-center h-20 w-20 rounded-full transition-all group-hover:scale-110 ${colors}`}>
                            <Icon className="h-10 w-10" />
                        </div>
                        <span className="text-sm font-medium text-foreground mt-2">{label}</span>
                    </button>
                )
            })}
        </div>
      </Card>
    </div>
  );
}
