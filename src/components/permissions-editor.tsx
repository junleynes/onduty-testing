
'use client';

import React from 'react';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Checkbox } from './ui/checkbox';
import { useToast } from '@/hooks/use-toast';
import type { RolePermissions, UserRole, NavItemKey } from '@/types';
import { ScrollArea } from './ui/scroll-area';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

const ALL_FEATURES: { key: NavItemKey; label: string, group: string }[] = [
  // Main Views
  { key: 'dashboard', label: 'Dashboard', group: 'Main Views' },
  { key: 'my-schedule', label: 'My Schedule', group: 'Main Views' },
  { key: 'my-tasks', label: 'My Tasks', group: 'Main Views' },
  { key: 'schedule', label: 'Schedule', group: 'Main Views' },
  { key: 'onduty', label: 'On Duty', group: 'Main Views' },
  { key: 'time-off', label: 'Time Off', group: 'Main Views' },
  { key: 'avl-management', label: 'AVL Management', group: 'Main Views' },
  { key: 'work-extensions', label: 'Work Extensions', group: 'Main Views' },
  { key: 'allowance', label: 'Mobile Load', group: 'Main Views' },
  { key: 'task-manager', label: 'Task Manager', group: 'Main Views' },
  { key: 'team', label: 'Team', group: 'Main Views' },
  { key: 'org-chart', label: 'Org Chart', group: 'Main Views' },
  { key: 'celebrations', label: 'Celebrations', group: 'Main Views' },
  { key: 'holidays', label: 'Holidays', group: 'Main Views' },
  { key: 'faq', label: 'FAQ', group: 'Support' },
  // Reports Access
  { key: 'reports', label: 'Reports Page Access', group: 'Reports' },
  { key: 'report-work-schedule', label: 'Work Schedule Report', group: 'Reports' },
  { key: 'report-attendance', label: 'Attendance Sheet Report', group: 'Reports' },
  { key: 'report-work-extension', label: 'Work Extension Report', group: 'Reports' },
  { key: 'report-overtime', label: 'Overtime/ND Report', group: 'Reports' },
  { key: 'report-user-summary', label: 'User Summary Report', group: 'Reports' },
  { key: 'report-tardy', label: 'Tardy Report', group: 'Reports' },
  { key: 'report-wfh', label: 'WFH Certification', group: 'Reports' },
  // Admin
  { key: 'admin', label: 'Users and Groups', group: 'Admin' },
  { key: 'smtp-settings', label: 'SMTP Settings', group: 'Admin' },
  { key: 'permissions', label: 'Permissions', group: 'Admin' },
  { key: 'danger-zone', label: 'Danger Zone', group: 'Admin' },
];

const ROLES: UserRole[] = ['admin', 'manager', 'member'];
const ADMIN_ONLY_FEATURES: NavItemKey[] = ['admin', 'permissions', 'smtp-settings', 'danger-zone'];


const groupedFeatures = ALL_FEATURES.reduce((acc, feature) => {
    if (!acc[feature.group]) {
        acc[feature.group] = [];
    }
    acc[feature.group].push(feature);
    return acc;
}, {} as Record<string, typeof ALL_FEATURES>);

type PermissionsEditorProps = {
  permissions: RolePermissions;
  setPermissions: React.Dispatch<React.SetStateAction<RolePermissions>>;
};

export function PermissionsEditor({ permissions, setPermissions }: PermissionsEditorProps) {
  const { toast } = useToast();

  const handlePermissionChange = (role: UserRole, feature: NavItemKey, isChecked: boolean) => {
    setPermissions(prev => {
      const currentPermissions = new Set(prev[role] || []);
      if (isChecked) {
        currentPermissions.add(feature);
      } else {
        currentPermissions.delete(feature);
      }
      return {
        ...prev,
        [role]: Array.from(currentPermissions),
      };
    });
    toast({ title: 'Permissions Updated', description: 'Changes have been saved automatically.' });
  };


  return (
    <Card>
      <CardHeader>
        <CardTitle>Manage Permissions</CardTitle>
        <CardDescription>
            Control which sections and features each user role can access. Changes are saved automatically.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <ScrollArea className="h-[70vh] border rounded-md">
          <Table>
            <TableHeader className="sticky top-0 bg-background z-10">
              <TableRow>
                <TableHead className="w-[250px]">Feature</TableHead>
                {ROLES.map(role => (
                  <TableHead key={role} className="text-center capitalize">{role}</TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {Object.entries(groupedFeatures).map(([groupName, features]) => (
                <React.Fragment key={groupName}>
                    <TableRow>
                        <TableCell colSpan={ROLES.length + 1} className="font-semibold bg-muted/50 py-2">
                            {groupName}
                        </TableCell>
                    </TableRow>
                    {features.map(({ key, label }) => (
                        <TableRow key={key}>
                        <TableCell className="font-medium">{label}</TableCell>
                        {ROLES.map(role => {
                            const isChecked = role === 'admin' ? ADMIN_ONLY_FEATURES.includes(key) : permissions[role]?.includes(key);
                            return (
                                <TableCell key={role} className="text-center">
                                <Checkbox
                                    checked={isChecked}
                                    onCheckedChange={(checked) => handlePermissionChange(role, key, !!checked)}
                                    disabled={role === 'admin'}
                                />
                                </TableCell>
                            );
                        })}
                        </TableRow>
                    ))}
                </React.Fragment>
              ))}
            </TableBody>
          </Table>
        </ScrollArea>
      </CardContent>
    </Card>
  );
}
