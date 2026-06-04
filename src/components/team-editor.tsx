
'use client';

import React, { useEffect, useState, useMemo } from 'react';
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
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage, FormDescription } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import type { Employee, UserRole, AppVisibility } from '@/types';
import { DatePicker } from './ui/date-picker';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';
import { Avatar, AvatarImage, AvatarFallback } from './ui/avatar';
import { getInitials, getFullName, getBackgroundColor } from '@/lib/utils';
import Image from 'next/image';
import { Checkbox } from './ui/checkbox';
import { useToast } from '@/hooks/use-toast';

const employeeSchema = z.object({
  id: z.string().optional(),
  employeeNumber: z.string().optional().nullable(),
  personnelNumber: z.string().optional().nullable(),
  firstName: z.string().min(1, 'First name is required'),
  lastName: z.string().min(1, 'Last name is required'),
  middleInitial: z.string().max(1).optional(),
  email: z.string().email('Invalid email address'),
  phone: z.string().optional(),
  password: z.string().optional(),
  birthDate: z.date().optional().nullable(),
  startDate: z.date().optional().nullable(),
  lastPromotionDate: z.date().optional().nullable(),
  position: z.string().optional(),
  role: z.custom<UserRole>().optional(),
  group: z.string().optional(),
  avatar: z.string().optional().nullable(),
  signature: z.string().optional().nullable(),
  loadAllocation: z.coerce.number().optional(),
  avlAllotted: z.coerce.number().optional(),
  reportsTo: z.string().optional().nullable(),
  visibility: z.object({
      schedule: z.boolean().optional(),
      onDuty: z.boolean().optional(),
      orgChart: z.boolean().optional(),
      mobileLoad: z.boolean().optional(),
  }).optional(),
  gender: z.enum(['Male', 'Female']).optional(),
  employeeClassification: z.enum(['Rank-and-File', 'Confidential', 'Managerial']).optional(),
}).refine(data => {
    // If it's a new user (no ID), password can be blank (to send activation link)
    if (!data.id) {
      return true;
    }
    // If it's an existing user, password is optional. But if provided, it must be at least 6 chars.
    if (data.password && data.password.length > 0) {
      return data.password.length >= 6;
    }
    // If password is not provided for an existing user, it's valid.
    return true;
  }, {
    message: 'Password must be at least 6 characters long.',
    path: ['password'],
});


type TeamEditorProps = {
  isOpen: boolean;
  setIsOpen: (isOpen: boolean) => void;
  employee: Partial<Employee> | null;
  onSave: (employee: Partial<Employee>) => Promise<void>;
  isPasswordResetMode?: boolean;
  context?: 'admin' | 'manager';
  groups: string[];
  setGroups: React.Dispatch<React.SetStateAction<string[]>>;
  employees: Employee[];
};

export function TeamEditor({ isOpen, setIsOpen, employee, onSave, isPasswordResetMode = false, context = 'manager', groups, setGroups, employees }: TeamEditorProps) {
    const { toast } = useToast();
    const [positions] = useState(() => [...new Set(employees.map(e => e.position).filter(Boolean))]);
    const [avatarPreview, setAvatarPreview] = useState<string | null>(null);
    const [signaturePreview, setSignaturePreview] = useState<string | null>(null);
    
    const form = useForm<z.infer<typeof employeeSchema>>({
        resolver: zodResolver(employeeSchema),
        defaultValues: {},
    });
  
  const isNewEmployee = !employee?.id;
  const selectedGroup = form.watch("group");

  useEffect(() => {
    if(isOpen) {
        const defaultValues = isNewEmployee ? {
            id: undefined,
            employeeNumber: '',
            personnelNumber: '',
            firstName: '',
            lastName: '',
            middleInitial: '',
            email: '',
            phone: '',
            password: '',
            birthDate: undefined,
            startDate: undefined,
            lastPromotionDate: undefined,
            position: '',
            role: 'member',
            group: '',
            avatar: '',
            signature: '',
            loadAllocation: 0,
            avlAllotted: 0,
            reportsTo: null,
            visibility: {
              schedule: true,
              onDuty: true,
              orgChart: true,
              mobileLoad: true,
            },
        } : {
            ...employee,
            employeeNumber: employee.employeeNumber || '',
            personnelNumber: employee.personnelNumber || '',
            password: '', // Always start with an empty password field for editing
            birthDate: employee.birthDate ? new Date(employee.birthDate) : undefined,
            startDate: employee.startDate ? new Date(employee.startDate) : undefined,
            lastPromotionDate: employee.lastPromotionDate ? new Date(employee.lastPromotionDate) : undefined,
            loadAllocation: employee.loadAllocation ?? 0,
            avlAllotted: employee.avlAllotted ?? 0,
            visibility: {
              schedule: employee.visibility?.schedule ?? true,
              onDuty: employee.visibility?.onDuty ?? true,
              orgChart: employee.visibility?.orgChart ?? true,
              mobileLoad: employee.visibility?.mobileLoad ?? true,
            }
        };
        form.reset(defaultValues as any);
        setAvatarPreview(employee?.avatar || null);
        setSignaturePreview(employee?.signature || null);
    }
  }, [employee, form, isOpen, isNewEmployee]);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>, fieldName: 'avatar' | 'signature') => {
      const file = e.target.files?.[0];
      if (file) {
          const reader = new FileReader();
          reader.onloadend = () => {
              const base64String = reader.result as string;
              form.setValue(fieldName, base64String);
              if (fieldName === 'avatar') {
                  setAvatarPreview(base64String);
              } else {
                  setSignaturePreview(base64String);
              }
          };
          reader.readAsDataURL(file);
      } else {
        // Handle file removal
        form.setValue(fieldName, null);
        if (fieldName === 'avatar') {
            setAvatarPreview(null);
        } else {
            setSignaturePreview(null);
        }
      }
  };

  const [isSaving, setIsSaving] = useState(false);
  const [pwValue, setPwValue] = useState('');
  const [pwError, setPwError] = useState('');

  // Handle password reset separately — bypasses full schema validation which
  // requires firstName/lastName/email that may be missing from currentUser state
  const handlePasswordReset = async () => {
    setPwError('');
    if (!pwValue || pwValue.length < 6) {
        setPwError('Password must be at least 6 characters.');
        return;
    }
    if (!employee?.id) {
        setPwError('Employee ID is missing.');
        return;
    }
    setIsSaving(true);
    try {
        const { updatePassword } = await import('@/app/employee-actions');
        const result = await updatePassword(employee.id, pwValue);
        if (result.success) {
            setPwValue('');
            setIsOpen(false);
            toast({ title: 'Password Updated', description: 'The password has been changed successfully.' });
        } else {
            setPwError(result.error || 'Failed to update password.');
        }
    } finally {
        setIsSaving(false);
    }
  };

  const onSubmit = async (values: z.infer<typeof employeeSchema>) => {
    setIsSaving(true);
    try {
        await onSave(values);
        if (values.group && !groups.includes(values.group)) {
            setGroups(prev => [...prev, values.group!]);
        }
        setIsOpen(false);
    } finally {
        setIsSaving(false);
    }
  };


  const isSimplifiedView = context === 'admin' && !isPasswordResetMode;

  const title = isPasswordResetMode ? 'Reset User Password' : (isSimplifiedView ? 'Edit User' : (employee?.id ? 'Edit Team Member' : 'Add Team Member'));
  const description = isPasswordResetMode ? `Enter a new password for ${employee?.firstName}.` : (isSimplifiedView ? "Update the user's core credentials and role." : (employee?.id ? "Update the details for this team member." : "Fill in the details for the new team member."));

  const availableManagers = useMemo(() => {
    return employees.filter(e => 
        e.role === 'manager' && 
        e.id !== employee?.id &&
        e.group === selectedGroup
    );
  }, [employees, employee?.id, selectedGroup]);

  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            {description}
          </DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4 py-4 max-h-[70vh] overflow-y-auto pr-4">
            {isPasswordResetMode ? (
                <div className="space-y-3 py-2">
                    <div className="space-y-1">
                        <label className="text-sm font-medium">New Password</label>
                        <Input
                            type="password"
                            value={pwValue}
                            onChange={e => { setPwValue(e.target.value); setPwError(''); }}
                            placeholder="Enter new password (min 6 characters)"
                            disabled={isSaving}
                        />
                        {pwError && <p className="text-sm text-destructive">{pwError}</p>}
                    </div>
                    <DialogFooter className="pt-2">
                        <Button type="button" variant="ghost" onClick={() => setIsOpen(false)} disabled={isSaving}>Cancel</Button>
                        <Button type="button" onClick={handlePasswordReset} disabled={isSaving || !pwValue}>
                            {isSaving ? 'Saving...' : 'Update Password'}
                        </Button>
                    </DialogFooter>
                </div>
            ) : (
                <>
                    <div className="grid grid-cols-1 md:grid-cols-[1fr_1fr_80px] gap-4">
                     <FormField
                        control={form.control}
                        name="firstName"
                        render={({ field }) => (
                        <FormItem>
                            <FormLabel>First Name</FormLabel>
                            <FormControl>
                            <Input {...field} />
                            </FormControl>
                            <FormMessage />
                        </FormItem>
                        )}
                    />
                    <FormField
                        control={form.control}
                        name="lastName"
                        render={({ field }) => (
                        <FormItem>
                            <FormLabel>Last Name</FormLabel>
                            <FormControl>
                            <Input {...field} />
                            </FormControl>
                            <FormMessage />
                        </FormItem>
                        )}
                    />
                     <FormField
                        control={form.control}
                        name="middleInitial"
                        render={({ field }) => (
                        <FormItem>
                            <FormLabel>M.I.</FormLabel>
                            <FormControl>
                            <Input {...field} />
                            </FormControl>
                            <FormMessage />
                        </FormItem>
                        )}
                    />
                    </div>
                     <FormField
                        control={form.control}
                        name="email"
                        render={({ field }) => (
                        <FormItem>
                            <FormLabel>Email</FormLabel>
                            <FormControl>
                            <Input {...field} type="email" />
                            </FormControl>
                            <FormMessage />
                        </FormItem>
                        )}
                    />
                     <FormField
                        control={form.control}
                        name="password"
                        render={({ field }) => (
                        <FormItem>
                            <FormLabel>Password</FormLabel>
                            <FormControl>
                            <Input type="password" {...field} placeholder={isNewEmployee ? 'Leave blank to send activation link' : 'Leave blank to keep current password'} />
                            </FormControl>
                            <FormMessage />
                        </FormItem>
                        )}
                    />

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                         <FormField
                            control={form.control}
                            name="group"
                            render={({ field }) => (
                                <FormItem>
                                <FormLabel>Group</FormLabel>
                                 <Select onValueChange={field.onChange} defaultValue={field.value}>
                                    <FormControl>
                                        <SelectTrigger>
                                            <SelectValue placeholder="Select a group" />
                                        </SelectTrigger>
                                    </FormControl>
                                    <SelectContent>
                                        {groups.map(group => (
                                            <SelectItem key={group} value={group}>{group}</SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                                <FormMessage />
                                </FormItem>
                            )}
                        />
                        <FormField
                            control={form.control}
                            name="role"
                            render={({ field }) => (
                            <FormItem>
                                <FormLabel>Role</FormLabel>
                                 <Select onValueChange={field.onChange} defaultValue={field.value}>
                                    <FormControl>
                                    <SelectTrigger>
                                        <SelectValue placeholder="Select a role" />
                                    </SelectTrigger>
                                    </FormControl>
                                    <SelectContent>
                                    <SelectItem value="admin">Admin</SelectItem>
                                    <SelectItem value="manager">Manager</SelectItem>
                                    <SelectItem value="member">Member</SelectItem>
                                    </SelectContent>
                                </Select>
                                <FormMessage />
                            </FormItem>
                            )}
                        />
                    </div>

                    {!isSimplifiedView && (
                        <>
                           <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                <FormField
                                    control={form.control}
                                    name="employeeNumber"
                                    render={({ field }) => (
                                    <FormItem>
                                        <FormLabel>ID Number</FormLabel>
                                        <FormControl>
                                        <Input {...field} value={field.value ?? ''} />
                                        </FormControl>
                                        <FormMessage />
                                    </FormItem>
                                    )}
                                />
                                <FormField
                                    control={form.control}
                                    name="personnelNumber"
                                    render={({ field }) => (
                                    <FormItem>
                                        <FormLabel>Employee Number</FormLabel>
                                        <FormControl>
                                        <Input {...field} value={field.value ?? ''} />
                                        </FormControl>
                                        <FormMessage />
                                    </FormItem>
                                    )}
                                />
                                <FormField
                                    control={form.control}
                                    name="position"
                                    render={({ field }) => (
                                    <FormItem>
                                        <FormLabel>Position</FormLabel>
                                        <FormControl>
                                            <Input list="positions-list" {...field} />
                                        </FormControl>
                                        <datalist id="positions-list">
                                            {positions.map(pos => <option key={pos} value={pos} />)}
                                        </datalist>
                                        <FormMessage />
                                    </FormItem>
                                    )}
                                />
                            </div>
                            
                             <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                <FormField
                                    control={form.control}
                                    name="gender"
                                    render={({ field }) => (
                                    <FormItem>
                                        <FormLabel>Gender</FormLabel>
                                        <Select onValueChange={field.onChange} defaultValue={field.value}>
                                            <FormControl>
                                                <SelectTrigger>
                                                    <SelectValue placeholder="Select a gender" />
                                                </SelectTrigger>
                                            </FormControl>
                                            <SelectContent>
                                                <SelectItem value="Male">Male</SelectItem>
                                                <SelectItem value="Female">Female</SelectItem>
                                            </SelectContent>
                                        </Select>
                                        <FormMessage />
                                    </FormItem>
                                    )}
                                />
                                <FormField
                                    control={form.control}
                                    name="employeeClassification"
                                    render={({ field }) => (
                                    <FormItem>
                                        <FormLabel>Employee Classification</FormLabel>
                                         <Select onValueChange={field.onChange} defaultValue={field.value}>
                                            <FormControl>
                                                <SelectTrigger>
                                                    <SelectValue placeholder="Select a classification" />
                                                </SelectTrigger>
                                            </FormControl>
                                            <SelectContent>
                                                <SelectItem value="Rank-and-File">Rank-and-File</SelectItem>
                                                <SelectItem value="Confidential">Confidential</SelectItem>
                                                <SelectItem value="Managerial">Managerial</SelectItem>
                                            </SelectContent>
                                        </Select>
                                        <FormMessage />
                                    </FormItem>
                                    )}
                                />
                            </div>

                            <FormField
                                control={form.control}
                                name="reportsTo"
                                render={({ field }) => (
                                    <FormItem>
                                    <FormLabel>Reports To</FormLabel>
                                    <Select
                                        onValueChange={(value) => field.onChange(value === 'null' ? null : value)}
                                        value={field.value ?? 'null'}
                                    >
                                        <FormControl>
                                        <SelectTrigger>
                                            <SelectValue placeholder="Select a manager" />
                                        </SelectTrigger>
                                        </FormControl>
                                        <SelectContent>
                                            <SelectItem value="null">None</SelectItem>
                                            {availableManagers.map(manager => (
                                                <SelectItem key={manager.id} value={manager.id}>
                                                    {getFullName(manager)}
                                                </SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                    <FormMessage />
                                    </FormItem>
                                )}
                            />

                             <FormField
                                control={form.control}
                                name="phone"
                                render={({ field }) => (
                                <FormItem>
                                    <FormLabel>Phone</FormLabel>
                                    <FormControl>
                                    <Input {...field} type="tel" />
                                    </FormControl>
                                    <FormMessage />
                                </FormItem>
                                )}
                            />
                            
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <FormField
                                control={form.control}
                                name="birthDate"
                                render={({ field }) => (
                                <FormItem className="flex flex-col">
                                    <FormLabel>Birth Date</FormLabel>
                                    <DatePicker 
                                        date={field.value || undefined} 
                                        onDateChange={field.onChange}
                                        dateProps={{
                                        captionLayout: "dropdown-buttons",
                                        fromYear: 1950,
                                        toYear: new Date().getFullYear()
                                        }}
                                    />
                                    <FormMessage />
                                </FormItem>
                                )}
                            />
                            <FormField
                                control={form.control}
                                name="startDate"
                                render={({ field }) => (
                                <FormItem className="flex flex-col">
                                    <FormLabel>Start Date</FormLabel>
                                    <DatePicker
                                        date={field.value || undefined}
                                        onDateChange={field.onChange}
                                        dateProps={{
                                            captionLayout: "dropdown-buttons",
                                            fromYear: 1950,
                                            toYear: new Date().getFullYear()
                                        }}
                                    />
                                    <FormMessage />
                                </FormItem>
                                )}
                            />
                            </div>
                            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                                <FormField
                                    control={form.control}
                                    name="lastPromotionDate"
                                    render={({ field }) => (
                                    <FormItem className="flex flex-col">
                                        <FormLabel>Last Promotion Date</FormLabel>
                                        <DatePicker
                                            date={field.value || undefined}
                                            onDateChange={field.onChange}
                                            dateProps={{
                                                captionLayout: "dropdown-buttons",
                                                fromYear: 1950,
                                                toYear: new Date().getFullYear()
                                            }}
                                        />
                                        <FormMessage />
                                    </FormItem>
                                    )}
                                />
                                <FormField
                                    control={form.control}
                                    name="loadAllocation"
                                    render={({ field }) => (
                                    <FormItem>
                                        <FormLabel>Load Allocation</FormLabel>
                                        <FormControl>
                                            <Input type="number" {...field} />
                                        </FormControl>
                                        <FormMessage />
                                    </FormItem>
                                    )}
                                />
                                <FormField
                                    control={form.control}
                                    name="avlAllotted"
                                    render={({ field }) => (
                                    <FormItem>
                                        <FormLabel>AVL Allotted (Days)</FormLabel>
                                        <FormControl>
                                            <Input type="number" step="0.5" {...field} />
                                        </FormControl>
                                        <FormMessage />
                                    </FormItem>
                                    )}
                                />
                            </div>
                            <div className="space-y-2 rounded-md border p-4">
                                <FormLabel>App Visibility</FormLabel>
                                <FormDescription>Control where this user is visible within the application.</FormDescription>
                                <div className="grid grid-cols-2 gap-4 pt-2">
                                     <FormField
                                        control={form.control}
                                        name="visibility.schedule"
                                        render={({ field }) => (
                                            <FormItem className="flex flex-row items-start space-x-3 space-y-0">
                                                <FormControl><Checkbox checked={field.value} onCheckedChange={field.onChange} /></FormControl>
                                                <FormLabel className="font-normal">Show in Schedule</FormLabel>
                                            </FormItem>
                                        )}
                                    />
                                     <FormField
                                        control={form.control}
                                        name="visibility.onDuty"
                                        render={({ field }) => (
                                            <FormItem className="flex flex-row items-start space-x-3 space-y-0">
                                                <FormControl><Checkbox checked={field.value} onCheckedChange={field.onChange} /></FormControl>
                                                <FormLabel className="font-normal">Show in On Duty</FormLabel>
                                            </FormItem>
                                        )}
                                    />
                                     <FormField
                                        control={form.control}
                                        name="visibility.orgChart"
                                        render={({ field }) => (
                                            <FormItem className="flex flex-row items-start space-x-3 space-y-0">
                                                <FormControl><Checkbox checked={field.value} onCheckedChange={field.onChange} /></FormControl>
                                                <FormLabel className="font-normal">Show in Org Chart</FormLabel>
                                            </FormItem>
                                        )}
                                    />
                                     <FormField
                                        control={form.control}
                                        name="visibility.mobileLoad"
                                        render={({ field }) => (
                                            <FormItem className="flex flex-row items-start space-x-3 space-y-0">
                                                <FormControl><Checkbox checked={field.value} onCheckedChange={field.onChange} /></FormControl>
                                                <FormLabel className="font-normal">Show in Mobile Load</FormLabel>
                                            </FormItem>
                                        )}
                                    />
                                </div>
                            </div>
                             <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                                <FormItem>
                                    <FormLabel>Profile Picture</FormLabel>
                                    <div className="flex items-center gap-4">
                                        <Avatar className="h-20 w-20">
                                            <AvatarImage src={avatarPreview || undefined} data-ai-hint="profile avatar" />
                                            <AvatarFallback style={{ backgroundColor: getBackgroundColor(getFullName(form.getValues())) }}>
                                                {getInitials(getFullName(form.getValues()))}
                                            </AvatarFallback>
                                        </Avatar>
                                        <FormControl>
                                            <Input type="file" accept="image/*" onChange={(e) => handleFileChange(e, 'avatar')} className="max-w-xs" />
                                        </FormControl>
                                    </div>
                                    <FormMessage />
                                </FormItem>
                                <FormItem>
                                    <FormLabel>Digital Signature</FormLabel>
                                     <div className="flex items-center gap-4">
                                        <div className="h-20 w-32 border rounded-md flex items-center justify-center bg-gray-100">
                                            {signaturePreview ? (
                                                <Image src={signaturePreview} alt="Signature Preview" width={128} height={80} className="object-contain h-full w-full" />
                                            ) : (
                                                <span className="text-xs text-muted-foreground">No Signature</span>
                                            )}
                                        </div>
                                        <FormControl>
                                            <Input type="file" accept="image/*" onChange={(e) => handleFileChange(e, 'signature')} className="max-w-xs" />
                                        </FormControl>
                                    </div>
                                    <FormMessage />
                                </FormItem>
                            </div>
                        </>
                    )}
                </>
            )}

            {!isPasswordResetMode && (
            <DialogFooter className="pt-4">
                <Button type="button" variant="ghost" onClick={() => setIsOpen(false)} disabled={isSaving}>Cancel</Button>
                <Button type="submit" disabled={isSaving}>
                    {isSaving ? 'Saving...' : 'Save'}
                </Button>
            </DialogFooter>
            )}
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
