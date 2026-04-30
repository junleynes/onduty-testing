
'use client';

import React, { useState, useMemo } from 'react';
import type { Employee, Leave } from '@/types';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Button } from './ui/button';
import { Badge } from './ui/badge';
import { Input } from './ui/input';
import { useToast } from '@/hooks/use-toast';
import { getFullName } from '@/lib/utils';
import { format, differenceInCalendarDays, isSameDay } from 'date-fns';
import { PlusCircle, Check, X, Palmtree, User, Calendar, Save, Trash2 } from 'lucide-react';
import { LeaveRequestDialog } from './leave-request-dialog';
import type { LeaveTypeOption } from './leave-type-editor';
import { v4 as uuidv4 } from 'uuid';

type AvlManagementViewProps = {
  leaveRequests: Leave[];
  setLeaveRequests: React.Dispatch<React.SetStateAction<Leave[]>>;
  currentUser: Employee;
  employees: Employee[];
  setEmployees: React.Dispatch<React.SetStateAction<Employee[]>>;
  leaveTypes: LeaveTypeOption[];
};

export default function AvlManagementView({ leaveRequests, setLeaveRequests, currentUser, employees, setEmployees, leaveTypes }: AvlManagementViewProps) {
  const { toast } = useToast();
  const [isRequestDialogOpen, setIsRequestDialogOpen] = useState(false);
  const [tempAllotments, setTempAllotments] = useState<Record<string, number>>({});

  const isManager = currentUser.role === 'manager' || currentUser.role === 'admin';

  const groupEmployees = useMemo(() => 
    employees.filter(e => e.group === currentUser.group).sort((a,b) => a.lastName.localeCompare(b.lastName)),
    [employees, currentUser.group]
  );

  const calculateUsed = (employeeId: string) => {
    return leaveRequests
      .filter(req => req.employeeId === employeeId && req.type.toUpperCase() === 'AVL' && req.status === 'approved')
      .reduce((sum, req) => {
          if (req.isAllDay) {
              return sum + (differenceInCalendarDays(new Date(req.endDate), new Date(req.startDate)) + 1);
          }
          return sum + 0.5;
      }, 0);
  };

  const avlSummary = useMemo(() => {
    const allotted = currentUser.avlAllotted || 0;
    const used = calculateUsed(currentUser.id);
    return { allotted, used, remaining: allotted - used };
  }, [leaveRequests, currentUser]);

  const avlRequests = useMemo(() => 
    leaveRequests.filter(req => {
        const employee = employees.find(e => e.id === req.employeeId);
        const isAvl = req.type.toUpperCase() === 'AVL';
        if (!isAvl) return false;
        return isManager ? employee?.group === currentUser.group : req.employeeId === currentUser.id;
    }).sort((a,b) => new Date(b.startDate).getTime() - new Date(a.startDate).getTime()),
    [leaveRequests, employees, currentUser.group, currentUser.id, isManager]
  );

  const handleSaveAllotments = () => {
    setEmployees(prev => prev.map(emp => {
        if (tempAllotments[emp.id] !== undefined) {
            return { ...emp, avlAllotted: tempAllotments[emp.id] };
        }
        return emp;
    }));
    setTempAllotments({});
    toast({ title: "Allotments Saved" });
  };

  const handleToggleClaimed = (requestId: string) => {
    setLeaveRequests(prev => prev.map(req => 
        req.id === requestId ? { ...req, isAvlClaimed: !req.isAvlClaimed } : req
    ));
    toast({ title: "Claim Status Updated" });
  };

  const handleManageRequest = (requestId: string, status: 'approved' | 'rejected') => {
    setLeaveRequests(prev => prev.map(req => 
        req.id === requestId ? { ...req, status, managedBy: currentUser.id, managedAt: new Date() } : req
    ));
    toast({ title: `Request ${status}` });
  };

  const handleNewRequest = () => {
    setIsRequestDialogOpen(true);
  };

  const handleSaveRequest = (requestData: Partial<Leave>) => {
    const newRequest: Leave = {
      id: uuidv4(),
      employeeId: currentUser.id,
      status: 'pending',
      type: 'AVL',
      requestedAt: new Date(),
      dateFiled: new Date(),
      ...requestData,
      endDate: requestData.endDate || requestData.startDate,
      isAvlClaimed: false,
      color: '#14b8a6',
    } as Leave;
    setLeaveRequests(prev => [newRequest, ...prev]);
    setIsRequestDialogOpen(false);
    toast({ title: 'AVL Request Submitted' });
  };

  return (
    <div className="space-y-6">
      <Card className="bg-primary/5 border-primary/20">
        <CardHeader className="pb-2">
            <div className="flex items-center gap-2">
                <Palmtree className="h-5 w-5 text-primary" />
                <CardTitle className="text-lg">AVL Status Summary</CardTitle>
            </div>
            <CardDescription>Status for {currentUser.firstName} {currentUser.lastName}</CardDescription>
        </CardHeader>
        <CardContent>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-center">
                <div className="p-3 bg-background rounded-lg border">
                    <p className="text-xs text-muted-foreground uppercase font-bold">Allotted</p>
                    <p className="text-2xl font-bold">{avlSummary.allotted.toFixed(1)}</p>
                </div>
                <div className="p-3 bg-background rounded-lg border">
                    <p className="text-xs text-muted-foreground uppercase font-bold">Used</p>
                    <p className="text-2xl font-bold text-orange-600">{avlSummary.used.toFixed(1)}</p>
                </div>
                <div className="p-3 bg-background rounded-lg border border-primary/50">
                    <p className="text-xs text-muted-foreground uppercase font-bold">Remaining</p>
                    <p className="text-2xl font-bold text-primary">{avlSummary.remaining.toFixed(1)}</p>
                </div>
            </div>
        </CardContent>
      </Card>

      {isManager && (
          <Card>
              <CardHeader className="flex flex-row items-center justify-between">
                  <div>
                      <CardTitle>AVL Allotment</CardTitle>
                      <CardDescription>Set the annual leave days for your group members.</CardDescription>
                  </div>
                  <Button onClick={handleSaveAllotments} disabled={Object.keys(tempAllotments).length === 0}>
                      <Save className="h-4 w-4 mr-2" />
                      Save Changes
                  </Button>
              </CardHeader>
              <CardContent>
                  <Table>
                      <TableHeader>
                          <TableRow>
                              <TableHead>Employee</TableHead>
                              <TableHead>Position</TableHead>
                              <TableHead className="w-40">Annual Allotted (Days)</TableHead>
                              <TableHead className="text-right">Balance</TableHead>
                          </TableRow>
                      </TableHeader>
                      <TableBody>
                          {groupEmployees.map(emp => {
                              const used = calculateUsed(emp.id);
                              const currentVal = tempAllotments[emp.id] !== undefined ? tempAllotments[emp.id] : (emp.avlAllotted || 0);
                              return (
                                  <TableRow key={emp.id}>
                                      <TableCell className="font-medium">{getFullName(emp)}</TableCell>
                                      <TableCell className="text-xs">{emp.position}</TableCell>
                                      <TableCell>
                                          <Input 
                                            type="number" 
                                            step="0.5" 
                                            value={currentVal} 
                                            onChange={(e) => setTempAllotments(prev => ({...prev, [emp.id]: parseFloat(e.target.value)}))}
                                          />
                                      </TableCell>
                                      <TableCell className="text-right font-bold text-primary">{(currentVal - used).toFixed(1)}</TableCell>
                                  </TableRow>
                              );
                          })}
                      </TableBody>
                  </Table>
              </CardContent>
          </Card>
      )}

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle>AVL Plotting & Status</CardTitle>
            <CardDescription>View all vacation leave requests and their usage status.</CardDescription>
          </div>
          <Button onClick={handleNewRequest}>
              <PlusCircle className="h-4 w-4 mr-2" />
              Plot AVL Dates
          </Button>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Employee</TableHead>
                <TableHead>Dates</TableHead>
                <TableHead>Duration</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Usage Status</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {avlRequests.map(req => {
                const employee = employees.find(e => e.id === req.employeeId);
                const days = req.isAllDay ? (differenceInCalendarDays(new Date(req.endDate), new Date(req.startDate)) + 1) : 0.5;
                const isApproved = req.status === 'approved';

                return (
                  <TableRow key={req.id}>
                    <TableCell className="font-medium">{employee ? getFullName(employee) : 'Unknown'}</TableCell>
                    <TableCell>
                        {isSameDay(new Date(req.startDate), new Date(req.endDate)) 
                            ? format(new Date(req.startDate), 'MMM d, yyyy')
                            : `${format(new Date(req.startDate), 'MMM d')} - ${format(new Date(req.endDate), 'd, yyyy')}`}
                    </TableCell>
                    <TableCell>{days} Day{days !== 1 ? 's' : ''}</TableCell>
                    <TableCell>
                        <Badge variant={req.status === 'approved' ? 'default' : req.status === 'rejected' ? 'destructive' : 'secondary'}>
                            {req.status.toUpperCase()}
                        </Badge>
                    </TableCell>
                    <TableCell>
                        {isApproved ? (
                             <Badge variant={req.isAvlClaimed ? 'outline' : 'secondary'} className={req.isAvlClaimed ? 'text-green-600 border-green-600' : ''}>
                                {req.isAvlClaimed ? 'CLAIMED' : 'NOT CLAIMED'}
                            </Badge>
                        ) : (
                            <span className="text-muted-foreground italic text-xs">N/A</span>
                        )}
                    </TableCell>
                    <TableCell className="text-right">
                        <div className="flex gap-2 justify-end">
                            {isManager && req.status === 'pending' && (
                                <>
                                    <Button size="icon" variant="outline" className="text-green-600" onClick={() => handleManageRequest(req.id, 'approved')}><Check className="h-4 w-4" /></Button>
                                    <Button size="icon" variant="outline" className="text-red-600" onClick={() => handleManageRequest(req.id, 'rejected')}><X className="h-4 w-4" /></Button>
                                </>
                            )}
                            {isManager && isApproved && (
                                <Button size="sm" variant="outline" onClick={() => handleToggleClaimed(req.id)}>
                                    {req.isAvlClaimed ? 'Unclaim' : 'Mark Claimed'}
                                </Button>
                            )}
                            {!isApproved && (req.employeeId === currentUser.id || isManager) && (
                                <Button size="icon" variant="ghost" className="text-destructive" onClick={() => setLeaveRequests(prev => prev.filter(r => r.id !== req.id))}>
                                    <Trash2 className="h-4 w-4" />
                                </Button>
                            )}
                        </div>
                    </TableCell>
                  </TableRow>
                );
              })}
              {avlRequests.length === 0 && (
                  <TableRow>
                      <TableCell colSpan={6} className="text-center py-8 text-muted-foreground">No AVL requests found.</TableCell>
                  </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <LeaveRequestDialog 
        isOpen={isRequestDialogOpen}
        setIsOpen={setIsRequestDialogOpen}
        onSave={handleSaveRequest}
        request={null}
        leaveTypes={leaveTypes}
        currentUser={currentUser}
      />
    </div>
  );
}
