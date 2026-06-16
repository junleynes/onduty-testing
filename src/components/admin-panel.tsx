
'use client';

import React, { useState, useTransition, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import type { Employee, SmtpSettings, UserRole } from '@/types';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { getInitials, getBackgroundColor, getFullName } from '@/lib/utils';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';
import { Button } from './ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, DropdownMenuSeparator } from './ui/dropdown-menu';
import { MoreHorizontal, Pencil, PlusCircle, Trash2, Upload, Users, EyeOff, KeyRound, Mail, Download, ShieldCheck, ShieldOff, ShieldAlert, Construction, ToggleLeft, ToggleRight } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { Checkbox } from './ui/checkbox';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from './ui/alert-dialog';
import { sendActivationLink, getMaintenanceMode, setMaintenanceMode } from '@/app/actions';
import { adminSetupTotp, adminDisableTotp, adminDisableAllTotp, getTotpStatusAll } from '@/app/totp-actions';
import Papa from 'papaparse';
import { saveAs } from 'file-saver';
import { format } from 'date-fns';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from './ui/dialog';
import { Badge } from './ui/badge';
import type { ShiftTemplate } from '@/components/shift-editor';
import type { LeaveTypeOption } from '@/components/leave-type-editor';
import { saveTemplate } from '@/app/actions';
import { FileText, Settings2, Settings, CalendarDays } from 'lucide-react';

type AdminPanelProps = {
  users: Employee[];
  setUsers: React.Dispatch<React.SetStateAction<Employee[]>>;
  groups: string[];
  onAddMember: () => void;
  onEditMember: (employee: Employee, isPasswordReset?: boolean) => void;
  onDeleteMember: (employeeId: string) => void;
  onBatchDelete: (employeeIds: string[]) => void;
  onImportMembers: () => void;
  onManageGroups: () => void;
  smtpSettings: SmtpSettings;
  shiftTemplates: ShiftTemplate[];
  setShiftTemplates: React.Dispatch<React.SetStateAction<ShiftTemplate[]>>;
  leaveTypes: LeaveTypeOption[];
  setLeaveTypes: React.Dispatch<React.SetStateAction<LeaveTypeOption[]>>;
  templates: Record<string, string | null>;
  setTemplates: React.Dispatch<React.SetStateAction<Record<string, string | null>>>;
};

export default function AdminPanel({ users, setUsers, groups, onAddMember, onEditMember, onDeleteMember, onBatchDelete, onImportMembers, onManageGroups, smtpSettings, shiftTemplates, setShiftTemplates, leaveTypes, setLeaveTypes, templates, setTemplates }: AdminPanelProps) {
  const { toast } = useToast();
  const [selectedRowIds, setSelectedRowIds] = useState<string[]>([]);
  const [isSending, startSendingTransition] = useTransition();
  const [totpStatuses, setTotpStatuses] = useState<Record<string, boolean>>({});
  const [totpDialog, setTotpDialog] = useState<{ open: boolean; secret?: string; qrDataUri?: string; userEmail?: string }>({ open: false });
  const [maintenanceEnabled, setMaintenanceEnabled] = useState(false);
  const [maintenanceMessage, setMaintenanceMessage] = useState("We're performing scheduled maintenance. We'll be back shortly.");
  const [isMaintenanceSaving, startMaintenanceTransition] = useTransition();


  // Load 2FA statuses on mount
  useEffect(() => {
    getTotpStatusAll().then(res => {
      if (res.success && res.statuses) setTotpStatuses(res.statuses);
    });
    getMaintenanceMode().then(r => {
      setMaintenanceEnabled(r.enabled);
      if (r.message) setMaintenanceMessage(r.message);
    });
  }, []);

  const handleRoleChange = (userId: string, newRole: UserRole) => {
    setUsers(users.map(user =>
      user.id === userId ? { ...user, role: newRole } : user
    ));
    toast({ title: 'User Role Updated' });
  };

  const handleSelectAll = (checked: boolean) => {
    setSelectedRowIds(checked ? users.map(u => u.id) : []);
  };

  const handleSelectRow = (id: string, checked: boolean) => {
    setSelectedRowIds(prev => checked ? [...prev, id] : prev.filter(rowId => rowId !== id));
  };

  const numSelected = selectedRowIds.length;
  const rowCount = users.length;

  const handleBatchDelete = () => {
    onBatchDelete(selectedRowIds);
    setSelectedRowIds([]);
  };

  const handleSendActivation = (employeeId: string) => {
    startSendingTransition(async () => {
      const origin = typeof window !== 'undefined' ? window.location.origin : '';
      const result = await sendActivationLink(employeeId, origin, smtpSettings);
      if (result.success) {
        toast({ title: 'Activation Link Sent', description: 'The user will receive an email to set their password.' });
      } else {
        toast({ variant: 'destructive', title: 'Failed to Send Link', description: result.error });
      }
    });
  };

  const handleEnable2FA = async (user: Employee) => {
    const result = await adminSetupTotp(user.id);
    if (!result.success) {
      toast({ variant: 'destructive', title: '2FA Setup Failed', description: result.error });
      return;
    }
    setTotpStatuses(prev => ({ ...prev, [user.id]: true }));
    setTotpDialog({ open: true, secret: result.secret, qrDataUri: result.qrDataUri, userEmail: result.userEmail });
  };

  const handleDisable2FA = async (userId: string) => {
    const result = await adminDisableTotp(userId);
    if (!result.success) {
      toast({ variant: 'destructive', title: 'Failed', description: result.error });
      return;
    }
    setTotpStatuses(prev => ({ ...prev, [userId]: false }));
    toast({ title: '2FA Disabled', description: 'Two-factor authentication has been removed for this user.' });
  };

  const handleDisableAll2FA = async () => {
    const result = await adminDisableAllTotp();
    if (!result.success) {
      toast({ variant: 'destructive', title: 'Failed', description: result.error });
      return;
    }
    setTotpStatuses({});
    toast({ title: 'All 2FA Disabled', description: 'Two-factor authentication has been reset for all users.' });
  };

  const handleExportCsv = () => {
    const csvData = users.map(user => {
      const manager = users.find(e => e.id === user.reportsTo);
      const defaultShift = shiftTemplates.find(t => t.id === user.defaultShiftTemplateId);
      return {
        'First Name': user.firstName,
        'Last Name': user.lastName,
        'M.I.': user.middleInitial || '',
        'Position': user.position || '',
        'Department': user.department || '',
        'Group': user.group || '',
        'Email': user.email,
        'Phone': user.phone || '',
        'ID Number': user.employeeNumber || '',
        'Employee Number': user.personnelNumber || '',
        'Role': user.role,
        'Load Allocation': user.loadAllocation || 0,
        'Work Schedule Type': user.workScheduleType || '8h-paid',
        'Default Schedule': defaultShift?.label || defaultShift?.name || '',
        'Show in Schedule': user.visibility?.schedule !== false,
        'Show in On Duty': user.visibility?.onDuty !== false,
        'Show in Org Chart': user.visibility?.orgChart !== false,
        'Show in Mobile Load': user.visibility?.mobileLoad !== false,
        'Reports To': manager ? getFullName(manager) : '',
        'Gender': user.gender || '',
        'Employee Classification': user.employeeClassification || '',
        'Birth Date': user.birthDate ? format(new Date(user.birthDate), 'yyyy-MM-dd') : '',
        'Start Date': user.startDate ? format(new Date(user.startDate), 'yyyy-MM-dd') : '',
        'Last Promotion Date': user.lastPromotionDate ? format(new Date(user.lastPromotionDate), 'yyyy-MM-dd') : '',
        '2FA Enabled': totpStatuses[user.id] ? 'Yes' : 'No',
      };
    });
    const csv = Papa.unparse(csvData);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    saveAs(blob, `Users_Export_${format(new Date(), 'yyyy-MM-dd')}.csv`);
    toast({ title: 'Export Successful' });
  };

  return (
    <>
    <Card>
      <CardHeader className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div>
          <CardTitle>Users and Groups</CardTitle>
          <CardDescription>Manage users, roles, group assignments, and two-factor authentication.</CardDescription>
        </div>
        <div className="flex gap-2 flex-wrap justify-start md:justify-end">
          {numSelected > 0 ? (
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="destructive">
                  <Trash2 className="h-4 w-4 mr-2" />Delete Selected ({numSelected})
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Are you absolutely sure?</AlertDialogTitle>
                  <AlertDialogDescription>
                    This will permanently delete {numSelected} user(s) and all associated data.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction onClick={handleBatchDelete}>Continue</AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          ) : (
            <>
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button variant="outline">
                    <ShieldOff className="h-4 w-4 mr-2" />Disable All 2FA
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Disable 2FA for all users?</AlertDialogTitle>
                    <AlertDialogDescription>
                      This will remove two-factor authentication from every user account. They can be re-enrolled individually.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <AlertDialogAction onClick={handleDisableAll2FA}>Disable All</AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
              <Button variant="outline" onClick={onManageGroups}>
                <Users className="h-4 w-4 mr-2" />Manage Groups
              </Button>
              <Button variant="outline" onClick={handleExportCsv}>
                <Download className="h-4 w-4 mr-2" />Export Users
              </Button>
              <Button variant="outline" onClick={onImportMembers}>
                <Upload className="h-4 w-4 mr-2" />Import Users
              </Button>
              <Button onClick={onAddMember}>
                <PlusCircle className="h-4 w-4 mr-2" />Add User
              </Button>
            </>
          )}
        </div>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead padding="checkbox">
                <Checkbox
                  checked={numSelected > 0 && numSelected === rowCount}
                  onCheckedChange={(checked) => handleSelectAll(!!checked)}
                  aria-label="Select all"
                />
              </TableHead>
              <TableHead>User</TableHead>
              <TableHead>Email</TableHead>
              <TableHead>Group</TableHead>
              <TableHead>Role</TableHead>
              <TableHead className="text-center">2FA</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {users.map((user) => (
              <TableRow key={user.id} data-state={selectedRowIds.includes(user.id) && 'selected'}>
                <TableCell padding="checkbox">
                  <Checkbox
                    checked={selectedRowIds.includes(user.id)}
                    onCheckedChange={(checked) => handleSelectRow(user.id, !!checked)}
                    aria-label="Select row"
                  />
                </TableCell>
                <TableCell>
                  <div className="flex items-center gap-4">
                    <Avatar>
                      <AvatarImage src={user.avatar || undefined} data-ai-hint="profile avatar" />
                      <AvatarFallback style={{ backgroundColor: getBackgroundColor(getFullName(user)) }}>
                        {getInitials(getFullName(user))}
                      </AvatarFallback>
                    </Avatar>
                    <div>
                      <div className="flex items-center gap-2">
                        <p className="font-medium">{getFullName(user)}</p>
                        {user.visibility?.schedule === false && <EyeOff className="h-4 w-4 text-muted-foreground" title="Hidden in app" />}
                      </div>
                      <p className="text-sm text-muted-foreground">{user.position}</p>
                    </div>
                  </div>
                </TableCell>
                <TableCell>
                  <a href={`mailto:${user.email}`} className="text-sm text-primary hover:underline">{user.email}</a>
                </TableCell>
                <TableCell>
                  <span className="font-medium">{user.group}</span>
                </TableCell>
                <TableCell>
                  <Select value={user.role} onValueChange={(newRole: UserRole) => handleRoleChange(user.id, newRole)}>
                    <SelectTrigger className="w-[120px]">
                      <SelectValue placeholder="Select a role" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="admin">Admin</SelectItem>
                      <SelectItem value="manager">Manager</SelectItem>
                      <SelectItem value="member">Member</SelectItem>
                    </SelectContent>
                  </Select>
                </TableCell>
                <TableCell className="text-center">
                  {totpStatuses[user.id]
                    ? <Badge variant="default" className="bg-green-600 gap-1"><ShieldCheck className="h-3 w-3" />On</Badge>
                    : <Badge variant="outline" className="gap-1 text-muted-foreground"><ShieldAlert className="h-3 w-3" />Off</Badge>
                  }
                </TableCell>
                <TableCell className="text-right">
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="icon">
                        <MoreHorizontal className="h-4 w-4" />
                        <span className="sr-only">More Actions</span>
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onClick={() => onEditMember(user)}>
                        <Pencil className="mr-2 h-4 w-4" /><span>Edit</span>
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => onEditMember(user, true)}>
                        <KeyRound className="mr-2 h-4 w-4" /><span>Reset Password</span>
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => handleSendActivation(user.id)} disabled={isSending}>
                        <Mail className="mr-2 h-4 w-4" /><span>Send Activation Link</span>
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      {totpStatuses[user.id] ? (
                        <DropdownMenuItem onClick={() => handleDisable2FA(user.id)}>
                          <ShieldOff className="mr-2 h-4 w-4" /><span>Disable 2FA</span>
                        </DropdownMenuItem>
                      ) : (
                        <DropdownMenuItem onClick={() => handleEnable2FA(user)}>
                          <ShieldCheck className="mr-2 h-4 w-4" /><span>Enable 2FA</span>
                        </DropdownMenuItem>
                      )}
                      <DropdownMenuSeparator />
                      <DropdownMenuItem className="text-red-600 focus:text-red-600" onClick={() => onDeleteMember(user.id)}>
                        <Trash2 className="mr-2 h-4 w-4" /><span>Delete</span>
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>

    {/* 2FA QR Code Dialog — shown to admin after enabling for a user */}
    <Dialog open={totpDialog.open} onOpenChange={(o) => setTotpDialog(prev => ({ ...prev, open: o }))}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>2FA Enabled for {totpDialog.userEmail}</DialogTitle>
          <DialogDescription>
            Have the user scan this QR code with Google Authenticator or Authy. The code is only shown once.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col items-center gap-4 py-2">
          {totpDialog.qrDataUri && (
            <div className="border-2 border-border rounded-lg p-3 bg-white">
              <img src={totpDialog.qrDataUri} alt="2FA QR Code" width={200} height={200} />
            </div>
          )}
          <div className="text-center space-y-1">
            <p className="text-xs text-muted-foreground">Manual entry key:</p>
            <code className="text-xs font-mono bg-muted px-3 py-1.5 rounded-md tracking-widest select-all block">
              {totpDialog.secret?.match(/.{1,4}/g)?.join(' ')}
            </code>
          </div>
        </div>
        <DialogFooter>
          <Button onClick={() => setTotpDialog({ open: false })}>Done</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>


      {/* Maintenance Mode */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Construction className="h-5 w-5 text-amber-500" />
            Maintenance Mode
          </CardTitle>
          <CardDescription>
            When enabled, only admins can access OnDuty. All other users see a maintenance notice.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between rounded-lg border p-4">
            <div>
              <p className="font-medium">Maintenance Mode</p>
              <p className="text-sm text-muted-foreground">
                {maintenanceEnabled ? (
                  <span className="text-amber-600 font-medium">⚠ Currently ON — site is restricted to admins only</span>
                ) : (
                  <span className="text-green-600 font-medium">✓ Currently OFF — site is accessible to all users</span>
                )}
              </p>
            </div>
            <Button
              variant={maintenanceEnabled ? "destructive" : "outline"}
              className="gap-2 min-w-[120px]"
              disabled={isMaintenanceSaving}
              onClick={() => {
                startMaintenanceTransition(async () => {
                  const newState = !maintenanceEnabled;
                  const result = await setMaintenanceMode(newState, maintenanceMessage);
                  if (result.success) {
                    setMaintenanceEnabled(newState);
                    toast({ title: newState ? 'Maintenance Mode ON' : 'Maintenance Mode OFF', description: newState ? 'Only admins can now access the site.' : 'Site is now accessible to all users.' });
                  } else {
                    toast({ variant: 'destructive', title: 'Failed', description: result.error });
                  }
                });
              }}
            >
              {maintenanceEnabled ? <ToggleRight className="h-4 w-4" /> : <ToggleLeft className="h-4 w-4" />}
              {maintenanceEnabled ? 'Turn OFF' : 'Turn ON'}
            </Button>
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium">Maintenance Message</label>
            <textarea
              className="w-full border rounded-md px-3 py-2 text-sm bg-background resize-none"
              rows={3}
              value={maintenanceMessage}
              onChange={e => setMaintenanceMessage(e.target.value)}
              placeholder="We're performing scheduled maintenance. We'll be back shortly."
            />
            <Button size="sm" variant="outline" disabled={isMaintenanceSaving} onClick={() => {
              startMaintenanceTransition(async () => {
                await setMaintenanceMode(maintenanceEnabled, maintenanceMessage);
                toast({ title: 'Message Updated' });
              });
            }}>Save Message</Button>
          </div>
        </CardContent>
      </Card>

    </>
  );
}
