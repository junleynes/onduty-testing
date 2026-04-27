
'use client';

import React, { useState, useMemo, useTransition } from 'react';
import type { Leave, Employee } from '@/types';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from './ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { format, isSameDay, addDays } from 'date-fns';
import { getFullName, getInitialState } from '@/lib/utils';
import { PlusCircle, Check, X, Loader2, User, Calendar, Type, MessageSquare, Clock4, Settings, Trash2 } from 'lucide-react';
import { WorkExtensionRequestDialog } from './work-extension-request-dialog';
import { useToast } from '@/hooks/use-toast';
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { v4 as uuidv4 } from 'uuid';
import { purgeData } from '@/app/actions';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from './ui/alert-dialog';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from './ui/dialog';
import { Label } from './ui/label';
import { Input } from './ui/input';

type WorkExtensionsViewProps = {
  leaveRequests: Leave[];
  setLeaveRequests: React.Dispatch<React.SetStateAction<Leave[]>>;
  currentUser: Employee;
  employees: Employee[];
  smtpSettings: any;
};

export default function WorkExtensionsView({ leaveRequests, setLeaveRequests, currentUser, employees, smtpSettings }: WorkExtensionsViewProps) {
  const { toast } = useToast();
  const [isRequestDialogOpen, setIsRequestDialogOpen] = useState(false);
  const [editingRequest, setEditingRequest] = useState<Partial<Leave> | null>(null);
  const [isPurging, startPurgeTransition] = useTransition();

  // Settings state
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [expiryDays, setExpiryDays] = useState<number>(() => getInitialState('workExtensionExpiryDays', 30));

  const isManager = currentUser.role === 'manager' || currentUser.role === 'admin';

  const myRequests = useMemo(() => 
    leaveRequests.filter(req => req.employeeId === currentUser.id && req.type === 'Work Extension').sort((a, b) => new Date(b.startDate).getTime() - new Date(a.startDate).getTime()),
  [leaveRequests, currentUser.id]);

  const teamRequests = useMemo(() => 
    isManager 
      ? leaveRequests.filter(req => {
          const employee = employees.find(e => e.id === req.employeeId);
          return employee?.group === currentUser.group && req.type === 'Work Extension';
        }).sort((a, b) => new Date(b.startDate).getTime() - new Date(a.startDate).getTime())
      : [],
  [leaveRequests, employees, currentUser.group, isManager]);
  
  const handleNewRequest = () => {
    setEditingRequest(null);
    setIsRequestDialogOpen(true);
  };
  
  const handleEditRequest = (request: Leave) => {
    if (request.status !== 'pending') {
        toast({ variant: 'destructive', title: 'Cannot Edit', description: 'Only pending requests can be edited.' });
        return;
    }
    setEditingRequest(request);
    setIsRequestDialogOpen(true);
  }

  const handleSaveRequest = (requestData: Partial<Leave>) => {
    if (editingRequest?.id) { // Editing
      setLeaveRequests(prev => prev.map(r => r.id === editingRequest.id ? { ...r, ...requestData } as Leave : r));
      toast({ title: 'Request Updated' });
    } else { // Creating
      const newRequest: Leave = {
        id: uuidv4(),
        employeeId: currentUser.id,
        status: 'pending',
        type: 'Work Extension',
        requestedAt: new Date(),
        ...requestData,
        endDate: requestData.endDate || requestData.startDate,
        dateFiled: new Date(),
        department: currentUser.group || '',
        idNumber: currentUser.employeeNumber || '',
        contactInfo: currentUser.phone || '',
        employeeSignature: currentUser.signature,
        color: '#f39c12',
      } as Leave;
      setLeaveRequests(prev => [newRequest, ...prev]);
      toast({ title: 'Request Submitted' });
    }
    setIsRequestDialogOpen(false);
  };
  
  const handleManageRequest = async (requestId: string, newStatus: 'approved' | 'rejected') => {
    setLeaveRequests(prev =>
      prev.map(req => {
        if (req.id === requestId) {
          return {
            ...req,
            status: newStatus,
            managedBy: currentUser.id,
            managedAt: new Date(),
            managerSignature: currentUser.signature,
            workExtensionStatus: newStatus === 'approved' ? 'not-claimed' : undefined,
          };
        }
        return req;
      })
    );
    toast({ title: `Request ${newStatus}` });
  };
  
   const handleClearAllRequests = () => {
    startPurgeTransition(async () => {
        const currentWorkExtensions = leaveRequests.filter(l => l.type === 'Work Extension');
        const otherLeave = leaveRequests.filter(l => l.type !== 'Work Extension');
        
        // This is a soft delete from the UI perspective.
        // The main save action will persist this change to the DB by writing the new `otherLeave` array.
        setLeaveRequests(otherLeave);
        toast({ title: 'All Work Extensions Cleared', variant: 'destructive', description: 'All work extension requests have been permanently deleted.' });
    });
  }
  
  const handleSaveSettings = () => {
    if (typeof window !== 'undefined') {
        localStorage.setItem('workExtensionExpiryDays', String(expiryDays));
    }
    toast({ title: "Settings Saved" });
    setIsSettingsOpen(false);
  };
  
  const getStatusBadge = (req: Leave) => {
    if (req.status === 'rejected') return <Badge variant="destructive">Rejected</Badge>;
    if (req.status === 'pending') return <Badge variant="secondary">Pending</Badge>;
    if (req.status === 'approved') {
        if (req.workExtensionStatus === 'claimed') return <Badge variant="default">Claimed</Badge>;
        
        const expiryDate = addDays(new Date(req.managedAt!), expiryDays);
        if (new Date() > expiryDate) {
             return <Badge variant="destructive">Expired</Badge>;
        }
        
        return <Badge variant="outline" className="text-green-600 border-green-600">Not Claimed</Badge>;
    }
    return <Badge>{req.status}</Badge>;
  }

  const RequestList = ({ requests, forManagerView = false }: { requests: Leave[], forManagerView?: boolean }) => (
    <div className="space-y-4 md:hidden">
        {requests.map(req => {
             const employee = employees.find(e => e.id === req.employeeId);
             const dateDisplay = req.originalShiftDate ? format(new Date(req.originalShiftDate), 'MMM d, yyyy') : 'N/A';

            return (
                <Card key={req.id}>
                    <CardHeader className="p-4 flex flex-row items-center justify-between">
                        <div>
                            {forManagerView && <CardTitle className="text-base">{employee ? getFullName(employee) : 'Unknown'}</CardTitle>}
                            <CardDescription className="flex items-center gap-2"><Calendar className="h-4 w-4"/> {dateDisplay}</CardDescription>
                        </div>
                        {getStatusBadge(req)}
                    </CardHeader>
                    <CardContent className="p-4 pt-0 space-y-2 text-sm">
                        <div className="flex items-center gap-2">
                            <Clock4 className="h-4 w-4 text-muted-foreground"/>
                            <span className="font-medium">{req.startTime} - {req.endTime}</span>
                        </div>
                        <div className="flex items-start gap-2">
                            <MessageSquare className="h-4 w-4 text-muted-foreground flex-shrink-0 mt-0.5"/>
                            <p className="text-muted-foreground">{req.reason}</p>
                        </div>
                        <div className="pt-2 flex justify-end">
                            {req.status === 'pending' && <Button size="sm" variant="outline" onClick={() => handleEditRequest(req)}>Edit</Button>}
                        </div>
                    </CardContent>
                </Card>
            );
        })}
    </div>
  );
  
  const RequestTable = ({ requests, forManagerView = false }: { requests: Leave[], forManagerView?: boolean }) => (
    <div className="hidden md:block">
     <Table>
        <TableHeader>
            <TableRow>
            {forManagerView && <TableHead>Employee</TableHead>}
            <TableHead>Original Shift Date</TableHead>
            <TableHead>Extension Time</TableHead>
            <TableHead>Reason</TableHead>
            <TableHead>Status</TableHead>
            <TableHead className="text-right">Actions</TableHead>
            </TableRow>
        </TableHeader>
        <TableBody>
            {requests.map(req => {
              const employee = employees.find(e => e.id === req.employeeId);
              const dateDisplay = req.originalShiftDate ? format(new Date(req.originalShiftDate), 'MMM d, yyyy') : 'N/A';

              return (
                <TableRow key={req.id}>
                    {forManagerView && <TableCell>{employee ? getFullName(employee) : 'Unknown'}</TableCell>}
                    <TableCell>{dateDisplay}</TableCell>
                    <TableCell className="font-medium">{req.startTime} - {req.endTime}</TableCell>
                    <TableCell className="max-w-[200px] truncate">{req.reason}</TableCell>
                    <TableCell>{getStatusBadge(req)}</TableCell>
                    <TableCell className="text-right">
                       {forManagerView && req.status === 'pending' && (
                            <div className="flex gap-2 justify-end">
                                <Button size="sm" variant="outline" className="text-green-600 border-green-600 hover:bg-green-100 hover:text-green-700" onClick={() => handleManageRequest(req.id, 'approved')}><Check className="h-4 w-4" /></Button>
                                <Button size="sm" variant="outline" className="text-red-600 border-red-600 hover:bg-red-100 hover:text-red-700" onClick={() => handleManageRequest(req.id, 'rejected')}><X className="h-4 w-4" /></Button>
                            </div>
                       )}
                       {!forManagerView && req.status === 'pending' && (
                           <Button size="sm" variant="outline" onClick={() => handleEditRequest(req)}>Edit</Button>
                       )}
                    </TableCell>
                </TableRow>
              )
            })}
        </TableBody>
    </Table>
    </div>
  );

  return (
    <>
      <Card>
        <CardHeader className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
          <div>
            <CardTitle>Work Extension Requests</CardTitle>
            <CardDescription>File and manage requests for work extensions, which can be used for future offsets.</CardDescription>
          </div>
           <div className="flex gap-2">
                {isManager && (
                    <AlertDialog>
                        <AlertDialogTrigger asChild>
                            <Button variant="destructive" disabled={isPurging}>
                                {isPurging ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Trash2 className="h-4 w-4 mr-2" />}
                                Clear All
                            </Button>
                        </AlertDialogTrigger>
                        <AlertDialogContent>
                            <AlertDialogHeader>
                            <AlertDialogTitle>Are you absolutely sure?</AlertDialogTitle>
                            <AlertDialogDescription>
                                This action will permanently delete all work extension requests for your team. This cannot be undone.
                            </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                            <AlertDialogCancel>Cancel</AlertDialogCancel>
                            <AlertDialogAction onClick={handleClearAllRequests}>Continue</AlertDialogAction>
                            </AlertDialogFooter>
                        </AlertDialogContent>
                    </AlertDialog>
                )}
                 {isManager && (
                    <Button variant="outline" onClick={() => setIsSettingsOpen(true)}>
                        <Settings className="h-4 w-4 mr-2" />
                        Settings
                    </Button>
                )}
               <Button onClick={handleNewRequest}>
                   <PlusCircle className="h-4 w-4 mr-2" />
                   New Request
               </Button>
           </div>
        </CardHeader>
        <CardContent>
            <Tabs defaultValue={isManager ? "team-requests" : "my-requests"} className="w-full">
                <TabsList>
                    <TabsTrigger value="my-requests">My Requests</TabsTrigger>
                    {isManager && <TabsTrigger value="team-requests">Team Requests</TabsTrigger>}
                </TabsList>
                <TabsContent value="my-requests">
                    {myRequests.length > 0 ? <><RequestTable requests={myRequests} /><RequestList requests={myRequests} /></> : <p className="text-center text-muted-foreground p-8">You haven't made any work extension requests yet.</p>}
                </TabsContent>
                {isManager && (
                    <TabsContent value="team-requests">
                        {teamRequests.length > 0 ? <><RequestTable requests={teamRequests} forManagerView /><RequestList requests={teamRequests} forManagerView /></> : <p className="text-center text-muted-foreground p-8">Your team members haven't made any work extension requests yet.</p>}
                    </TabsContent>
                )}
            </Tabs>
        </CardContent>
      </Card>
      
      <WorkExtensionRequestDialog
        isOpen={isRequestDialogOpen}
        setIsOpen={setIsRequestDialogOpen}
        onSave={handleSaveRequest}
        request={editingRequest}
        currentUser={currentUser}
      />
      
       <Dialog open={isSettingsOpen} onOpenChange={setIsSettingsOpen}>
            <DialogContent className="sm:max-w-md">
                <DialogHeader>
                    <DialogTitle>Work Extension Settings</DialogTitle>
                    <DialogDescription>Configure rules for work extension claims.</DialogDescription>
                </DialogHeader>
                <div className="space-y-4 py-4">
                    <div className="space-y-2">
                        <Label htmlFor="expiryDays">Days Before Expiry</Label>
                        <Input 
                            id="expiryDays" 
                            type="number"
                            value={expiryDays}
                            onChange={(e) => setExpiryDays(parseInt(e.target.value, 10))}
                        />
                        <p className="text-xs text-muted-foreground">Set how many days an approved work extension can be claimed before it expires.</p>
                    </div>
                </div>
                <DialogFooter>
                    <Button variant="ghost" onClick={() => setIsSettingsOpen(false)}>Cancel</Button>
                    <Button onClick={handleSaveSettings}>Save Settings</Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    </>
  );
}
