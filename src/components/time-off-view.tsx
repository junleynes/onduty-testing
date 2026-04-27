'use client';

import React, { useState, useMemo, useTransition } from 'react';
import type { Leave, Employee, LeaveRequestStatus, Shift } from '@/types';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from './ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { format, isSameDay, isWithinInterval, startOfDay, eachDayOfInterval } from 'date-fns';
import { getFullName, getInitialState, cn } from '@/lib/utils';
import { PlusCircle, Check, X, FileDown, Mail, Eye, Upload, Loader2, User, Calendar, Type, MessageSquare, Info, Trash2, ChevronsUpDown, Settings, Clock4, ArrowUpDown, Search, Filter } from 'lucide-react';
import { LeaveRequestDialog } from './leave-request-dialog';
import { useToast } from '@/hooks/use-toast';
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { v4 as uuidv4 } from 'uuid';
import type { LeaveTypeOption } from './leave-type-editor';
import { generateLeavePdf, generateOffsetPdf, sendEmail } from '@/app/actions';
import type { SmtpSettings } from '@/types';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from './ui/dialog';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { Textarea } from './ui/textarea';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from './ui/alert-dialog';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from './ui/dropdown-menu';
import { OffsetRequestDialog } from './offset-request-dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';

type TimeOffViewProps = {
  leaveRequests: Leave[];
  setLeaveRequests: React.Dispatch<React.SetStateAction<Leave[]>>;
  shifts: Shift[];
  setShifts: React.Dispatch<React.SetStateAction<Shift[]>>;
  currentUser: Employee;
  employees: Employee[];
  leaveTypes: LeaveTypeOption[];
  smtpSettings: SmtpSettings;
  onUploadAlaf: () => void;
  onUploadOffset: () => void;
};

type SortKey = 'employee' | 'type' | 'startDate' | 'status';
type SortDirection = 'asc' | 'desc';

export default function TimeOffView({ leaveRequests, setLeaveRequests, shifts, setShifts, currentUser, employees, leaveTypes, smtpSettings, onUploadAlaf, onUploadOffset }: TimeOffViewProps) {
  const { toast } = useToast();
  const [isRequestDialogOpen, setIsRequestDialogOpen] = useState(false);
  const [isOffsetDialogOpen, setIsOffsetDialogOpen] = useState(false);
  const [isEmailDialogOpen, setIsEmailDialogOpen] = useState(false);
  const [isPurging, startPurgeTransition] = useTransition();
  const [editingRequest, setEditingRequest] = useState<Partial<Leave> | null>(null);
  const [emailingRequest, setEmailingRequest] = useState<Leave | null>(null);

  // Sorting & Filtering state
  const [sortConfig, setSortConfig] = useState<{ key: SortKey; direction: SortDirection }>({ key: 'startDate', direction: 'desc' });
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [typeFilter, setTypeFilter] = useState<string>('all');

  const isManager = currentUser.role === 'manager' || currentUser.role === 'admin';

  const handleSort = (key: SortKey) => {
    setSortConfig(prev => ({
      key,
      direction: prev.key === key && prev.direction === 'asc' ? 'desc' : 'asc'
    }));
  };

  const applyFiltersAndSort = (requests: Leave[]) => {
    return requests
      .filter(req => {
        const employee = employees.find(e => e.id === req.employeeId);
        const nameMatch = getFullName(employee || {}).toLowerCase().includes(searchTerm.toLowerCase());
        const statusMatch = statusFilter === 'all' || req.status === statusFilter;
        // Updated: Case-insensitive type matching
        const typeMatch = typeFilter === 'all' || req.type.toLowerCase() === typeFilter.toLowerCase();
        return nameMatch && statusMatch && typeMatch;
      })
      .sort((a, b) => {
        let aValue: any;
        let bValue: any;

        switch (sortConfig.key) {
          case 'employee':
            aValue = getFullName(employees.find(e => e.id === a.employeeId) || {}).toLowerCase();
            bValue = getFullName(employees.find(e => e.id === b.employeeId) || {}).toLowerCase();
            break;
          case 'type':
            aValue = a.type.toLowerCase();
            bValue = b.type.toLowerCase();
            break;
          case 'startDate':
            aValue = new Date(a.startDate).getTime();
            bValue = new Date(b.startDate).getTime();
            break;
          case 'status':
            aValue = a.status.toLowerCase();
            bValue = b.status.toLowerCase();
            break;
          default:
            return 0;
        }

        if (aValue < bValue) return sortConfig.direction === 'asc' ? -1 : 1;
        if (aValue > bValue) return sortConfig.direction === 'asc' ? 1 : -1;
        return 0;
      });
  };

  const myRequests = useMemo(() => 
    applyFiltersAndSort(leaveRequests.filter(req => req.employeeId === currentUser.id && req.type !== 'Work Extension')),
  [leaveRequests, currentUser.id, searchTerm, statusFilter, typeFilter, sortConfig, employees]);

  const teamRequests = useMemo(() => 
    isManager 
      ? applyFiltersAndSort(leaveRequests.filter(req => {
          const employee = employees.find(e => e.id === req.employeeId);
          return employee?.group === currentUser.group && req.type !== 'Work Extension';
        }))
      : [],
  [leaveRequests, employees, currentUser.group, isManager, searchTerm, statusFilter, typeFilter, sortConfig]);
  
  // Calculate unique leave types for the filter list with consistent casing
  const uniqueTypesForFilter = useMemo(() => {
    const types = new Set<string>();
    // Start with defined types
    leaveTypes.forEach(lt => types.add(lt.type.toUpperCase()));
    // Add any types from requests that might not be in definitions (e.g. from imports)
    leaveRequests.forEach(req => {
      if (req.type && req.type !== 'Work Extension') {
        types.add(req.type.toUpperCase());
      }
    });
    // Add Offset explicitly as it's a core feature
    types.add('OFFSET');
    return Array.from(types).sort();
  }, [leaveTypes, leaveRequests]);

  const handleNewTimeOffRequest = () => {
    setEditingRequest(null);
    setIsRequestDialogOpen(true);
  };

  const handleNewOffsetRequest = () => {
    setEditingRequest(null);
    setIsOffsetDialogOpen(true);
  };
  
  const handleEditRequest = (request: Leave) => {
    if (request.status !== 'pending') {
        toast({ variant: 'destructive', title: 'Cannot Edit', description: 'Only pending requests can be edited.' });
        return;
    }
    setEditingRequest(request);
    if (request.type === 'Offset') {
      setIsOffsetDialogOpen(true);
    } else {
      setIsRequestDialogOpen(true);
    }
  }

  const handleSaveRequest = (requestData: Partial<Leave>) => {
    if (editingRequest?.id) { // Editing
      setLeaveRequests(prev => prev.map(r => r.id === editingRequest.id ? { ...r, ...requestData } as Leave : r));
      toast({ title: 'Request Updated' });
    } else { // Creating
      const leaveTypeDetails = leaveTypes.find(lt => lt.type.toLowerCase() === requestData.type?.toLowerCase());
      const newRequest: Leave = {
        id: uuidv4(),
        employeeId: currentUser.id,
        status: 'pending',
        requestedAt: new Date(),
        ...requestData,
        endDate: requestData.endDate || requestData.startDate,
        dateFiled: new Date(),
        department: currentUser.group || '',
        idNumber: currentUser.employeeNumber || '',
        contactInfo: currentUser.phone || '',
        employeeSignature: currentUser.signature,
        color: leaveTypeDetails?.color || '#6b7280',
      } as Leave;
      setLeaveRequests(prev => [newRequest, ...prev]);
      toast({ title: 'Request Submitted' });
    }
    setIsRequestDialogOpen(false);
    setIsOffsetDialogOpen(false);
  };
  
  const handleManageRequest = async (requestId: string, newStatus: 'approved' | 'rejected') => {
    let finalUpdatedRequest: Leave | undefined;

    setLeaveRequests(prevLeaveRequests => {
        const newLeaveRequests = [...prevLeaveRequests];
        const requestIndex = newLeaveRequests.findIndex(r => r.id === requestId);
        if (requestIndex === -1) return prevLeaveRequests;
        
        const originalRequest = newLeaveRequests[requestIndex];
        const leaveTypeDetails = leaveTypes.find(lt => lt.type.toLowerCase() === originalRequest.type.toLowerCase());

        finalUpdatedRequest = {
            ...originalRequest,
            status: newStatus,
            managedBy: currentUser.id,
            managedAt: new Date(),
            managerSignature: currentUser.signature,
            color: leaveTypeDetails?.color || originalRequest.color
        };

        newLeaveRequests[requestIndex] = finalUpdatedRequest;

        if (newStatus === 'approved' && finalUpdatedRequest.type === 'Offset' && finalUpdatedRequest.claimedWorkExtensionId) {
            const weIndex = newLeaveRequests.findIndex(r => r.id === finalUpdatedRequest!.claimedWorkExtensionId);
            if (weIndex > -1) {
                newLeaveRequests[weIndex] = {
                    ...newLeaveRequests[weIndex],
                    workExtensionStatus: 'claimed',
                };
            }
        }
        
        if (newStatus === 'approved') {
            const leaveStart = startOfDay(new Date(finalUpdatedRequest!.startDate));
            const leaveEnd = startOfDay(new Date(finalUpdatedRequest!.endDate));
            const leaveInterval = { start: leaveStart, end: leaveEnd };
            
            setShifts(prevShifts =>
                prevShifts.filter(shift => {
                    if (shift.employeeId !== finalUpdatedRequest!.employeeId) {
                        return true;
                    }
                    const shiftDate = startOfDay(new Date(shift.date));
                    return !isWithinInterval(shiftDate, leaveInterval);
                })
            );
        }
        return newLeaveRequests;
    });

    if (newStatus === 'approved' && finalUpdatedRequest) {
        toast({ title: "Request Approved & Generating PDF...", description: "Please wait a moment." });
        
        const generatorAction = finalUpdatedRequest.type === 'Offset' ? generateOffsetPdf : generateLeavePdf;
        const result = await generatorAction(finalUpdatedRequest);
        
        if (result.success && result.pdfDataUri) {
            setLeaveRequests(prev => prev.map(req => req.id === requestId ? { ...req, pdfDataUri: result.pdfDataUri } : req));
            toast({ title: "PDF Generated", description: "The form has been created." });
        } else {
            toast({ variant: 'destructive', title: 'PDF Generation Failed', description: result.error });
        }
    } else {
        toast({ title: `Request ${newStatus}` });
    }
  };


  const handleDownloadPdf = (pdfDataUri: string, employeeName: string) => {
    const link = document.createElement('a');
    link.href = pdfDataUri;
    link.download = `Leave Application - ${employeeName}.pdf`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handleOpenEmailDialog = (leaveRequest: Leave) => {
    setEmailingRequest(leaveRequest);
    setIsEmailDialogOpen(true);
  };

  const handleClearAllRequests = () => {
    startPurgeTransition(async () => {
        const currentWorkExtensions = leaveRequests.filter(l => l.type === 'Work Extension');
        setLeaveRequests(currentWorkExtensions);
        toast({ title: 'Standard Requests Cleared', variant: 'destructive', description: 'All time off requests (excluding extensions) have been permanently deleted.' });
    });
  }
  
  const SortableHeader = ({ tKey, children }: { tKey: SortKey, children: React.ReactNode }) => {
    const isSorted = sortConfig.key === tKey;
    const isAsc = sortConfig.direction === 'asc';
    return (
      <TableHead>
        <Button 
          variant="ghost" 
          size="sm" 
          className="-ml-3 h-8 data-[state=open]:bg-accent" 
          onClick={() => handleSort(tKey)}
        >
          {children}
          <ArrowUpDown className={cn("ml-2 h-4 w-4", !isSorted && "opacity-20", isSorted && isAsc && "transform rotate-180")} />
        </Button>
      </TableHead>
    );
  };

  const RequestList = ({ requests, forManagerView = false }: { requests: Leave[], forManagerView?: boolean }) => {
    const renderActions = (req: Leave) => {
        const employee = employees.find(e => e.id === req.employeeId);
        if (forManagerView) {
            if (req.status === 'pending') {
                return (
                    <div className="flex gap-2 justify-end">
                        <Button size="sm" variant="outline" className="text-green-600 border-green-600 hover:bg-green-100 hover:text-green-700" onClick={() => handleManageRequest(req.id, 'approved')}><Check className="h-4 w-4 mr-1" />Approve</Button>
                        <Button size="sm" variant="outline" className="text-red-600 border-red-600 hover:bg-red-100 hover:text-red-700" onClick={() => handleManageRequest(req.id, 'rejected')}><X className="h-4 w-4 mr-1" />Reject</Button>
                    </div>
                );
            }
            if (req.pdfDataUri) {
                return (
                    <div className="flex gap-2 justify-end flex-wrap">
                        <a href={req.pdfDataUri} target="_blank" rel="noopener noreferrer"><Button size="sm" variant="outline"><Eye className="h-4 w-4 mr-1" />View</Button></a>
                        <Button size="sm" variant="outline" onClick={() => handleDownloadPdf(req.pdfDataUri!, getFullName(employee!))}><FileDown className="h-4 w-4 mr-1" />Download</Button>
                        <Button size="sm" variant="outline" onClick={() => handleOpenEmailDialog(req)}><Mail className="h-4 w-4 mr-1" />Email</Button>
                    </div>
                );
            }
        } else {
            if (req.status === 'pending') {
                return <Button size="sm" variant="outline" onClick={() => handleEditRequest(req)}>Edit</Button>;
            }
            if (req.pdfDataUri) {
                return (
                    <div className="flex gap-2 justify-end">
                        <a href={req.pdfDataUri} target="_blank" rel="noopener noreferrer"><Button size="sm" variant="outline"><Eye className="h-4 w-4 mr-1" />View</Button></a>
                        <Button size="sm" variant="outline" onClick={() => handleDownloadPdf(req.pdfDataUri!, getFullName(employee!))}><FileDown className="h-4 w-4 mr-1" />Download</Button>
                    </div>
                );
            }
        }
        return null;
    };
    
    return (
        <div className="space-y-4 md:hidden">
            {requests.map(req => {
                 const employee = employees.find(e => e.id === req.employeeId);
                 const startDate = new Date(req.startDate);
                 const endDate = new Date(req.endDate);
                 const dateDisplay = isSameDay(startDate, endDate)
                    ? format(startDate, 'MMM d, yyyy')
                    : `${format(startDate, 'MMM d')} - ${format(endDate, 'd, yyyy')}`;

                return (
                    <Card key={req.id}>
                        <CardHeader className="p-4 flex flex-row items-center justify-between">
                            <div>
                                {forManagerView && <CardTitle className="text-base">{employee ? getFullName(employee) : 'Unknown'}</CardTitle>}
                                <CardDescription className="flex items-center gap-2"><Calendar className="h-4 w-4"/> {dateDisplay}</CardDescription>
                            </div>
                            <Badge variant={req.status === 'approved' ? 'default' : req.status === 'rejected' ? 'destructive' : 'secondary'}>{req.status}</Badge>
                        </CardHeader>
                        <CardContent className="p-4 pt-0 space-y-2 text-sm">
                            <div className="flex items-center gap-2">
                                <Type className="h-4 w-4 text-muted-foreground"/>
                                <span className="font-medium">{req.type}</span>
                            </div>
                            <div className="flex items-start gap-2">
                                <MessageSquare className="h-4 w-4 text-muted-foreground flex-shrink-0 mt-0.5"/>
                                <p className="text-muted-foreground">{req.reason}</p>
                            </div>
                            <div className="pt-2 flex justify-end">
                                {renderActions(req)}
                            </div>
                        </CardContent>
                    </Card>
                );
            })}
        </div>
     );
  };
  
  const RequestTable = ({ requests, forManagerView = false }: { requests: Leave[], forManagerView?: boolean }) => {
    const renderActions = (req: Leave) => {
        const employee = employees.find(e => e.id === req.employeeId);
        if (forManagerView) {
            if (req.status === 'pending') {
                return (
                    <div className="flex gap-2 justify-end">
                        <Button size="sm" variant="outline" className="text-green-600 border-green-600 hover:bg-green-100 hover:text-green-700" onClick={() => handleManageRequest(req.id, 'approved')}><Check className="h-4 w-4" /></Button>
                        <Button size="sm" variant="outline" className="text-red-600 border-red-600 hover:bg-red-100 hover:text-red-700" onClick={() => handleManageRequest(req.id, 'rejected')}><X className="h-4 w-4" /></Button>
                    </div>
                );
            }
            if (req.pdfDataUri) {
                return (
                    <div className="flex gap-2 justify-end">
                        <a href={req.pdfDataUri} target="_blank" rel="noopener noreferrer"><Button size="sm" variant="outline"><Eye className="h-4 w-4" /></Button></a>
                        <Button size="sm" variant="outline" onClick={() => handleDownloadPdf(req.pdfDataUri!, getFullName(employee!))}><FileDown className="h-4 w-4" /></Button>
                        <Button size="sm" variant="outline" onClick={() => handleOpenEmailDialog(req)}><Mail className="h-4 w-4" /></Button>
                    </div>
                );
            }
        } else {
            if (req.status === 'pending') {
                return <Button size="sm" variant="outline" onClick={() => handleEditRequest(req)}>Edit</Button>;
            }
            if (req.pdfDataUri) {
                return (
                    <div className="flex gap-2 justify-end">
                        <a href={req.pdfDataUri} target="_blank" rel="noopener noreferrer"><Button size="sm" variant="outline"><Eye className="h-4 w-4" /></Button></a>
                        <Button size="sm" variant="outline" onClick={() => handleDownloadPdf(req.pdfDataUri!, getFullName(employee!))}><FileDown className="h-4 w-4" /></Button>
                    </div>
                );
            }
        }
        return null;
    };
    
    return (
        <div className="hidden md:block">
         <Table>
            <TableHeader>
                <TableRow>
                {forManagerView && <SortableHeader tKey="employee">Employee</SortableHeader>}
                <SortableHeader tKey="type">Type</SortableHeader>
                <SortableHeader tKey="startDate">Dates</SortableHeader>
                <TableHead>Reason</TableHead>
                <SortableHeader tKey="status">Status</SortableHeader>
                <TableHead className="text-right">Actions</TableHead>
                </TableRow>
            </TableHeader>
            <TableBody>
                {requests.map(req => {
                  const employee = employees.find(e => e.id === req.employeeId);
                  const startDate = new Date(req.startDate);
                  const endDate = new Date(req.endDate);
                  const dateDisplay = isSameDay(startDate, endDate)
                    ? format(startDate, 'MMM d, yyyy')
                    : `${format(startDate, 'MMM d, yyyy')} - ${format(endDate, 'MMM d, yyyy')}`;

                  return (
                    <TableRow key={req.id}>
                        {forManagerView && <TableCell>{employee ? getFullName(employee) : 'Unknown'}</TableCell>}
                        <TableCell className="font-medium">{req.type}</TableCell>
                        <TableCell>{dateDisplay}</TableCell>
                        <TableCell className="max-w-[200px] truncate">{req.reason}</TableCell>
                        <TableCell><Badge variant={req.status === 'approved' ? 'default' : req.status === 'rejected' ? 'destructive' : 'secondary'}>{req.status}</Badge></TableCell>
                        <TableCell className="text-right">
                           {renderActions(req)}
                        </TableCell>
                    </TableRow>
                  )
                })}
            </TableBody>
        </Table>
        </div>
    )
  };


  return (
    <>
      <Card>
        <CardHeader className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
          <div>
            <CardTitle>Time Off Requests</CardTitle>
            <CardDescription>Manage your leave requests and offsets.</CardDescription>
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
                                This action will permanently delete all standard time off requests for your team. This cannot be undone.
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
                    <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                            <Button variant="outline">
                                <Settings className="h-4 w-4 mr-2" />
                                Manage Templates
                                <ChevronsUpDown className="h-4 w-4 ml-2" />
                            </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                            <DropdownMenuItem onClick={onUploadAlaf}>
                                <Upload className="h-4 w-4 mr-2" />
                                ALAF Template (Leave Form)
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={onUploadOffset}>
                                <Upload className="h-4 w-4 mr-2" />
                                Offset Request Template
                            </DropdownMenuItem>
                        </DropdownMenuContent>
                    </DropdownMenu>
                )}
               <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                      <Button>
                          <PlusCircle className="h-4 w-4 mr-2" />
                          New Request
                          <ChevronsUpDown className="h-4 w-4 ml-2" />
                      </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                      <DropdownMenuItem onClick={handleNewTimeOffRequest}>
                          Time Off Request
                      </DropdownMenuItem>
                       <DropdownMenuItem onClick={handleNewOffsetRequest}>
                          Offset Request
                      </DropdownMenuItem>
                  </DropdownMenuContent>
              </DropdownMenu>
           </div>
        </CardHeader>
        <CardContent>
            {/* Filter Bar */}
            <div className="flex flex-col md:flex-row gap-4 mb-6 items-center">
              <div className="relative flex-1 w-full">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input 
                  placeholder="Search team members..." 
                  className="pl-10"
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                />
              </div>
              <div className="flex gap-2 w-full md:w-auto">
                <Select value={statusFilter} onValueChange={setStatusFilter}>
                  <SelectTrigger className="w-[140px]">
                    <Filter className="h-4 w-4 mr-2 opacity-50" />
                    <SelectValue placeholder="Status" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Statuses</SelectItem>
                    <SelectItem value="pending">Pending</SelectItem>
                    <SelectItem value="approved">Approved</SelectItem>
                    <SelectItem value="rejected">Rejected</SelectItem>
                  </SelectContent>
                </Select>
                <Select value={typeFilter} onValueChange={setTypeFilter}>
                  <SelectTrigger className="w-[140px]">
                    <Type className="h-4 w-4 mr-2 opacity-50" />
                    <SelectValue placeholder="Type" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Types</SelectItem>
                    {uniqueTypesForFilter.map(typeName => (
                      <SelectItem key={typeName} value={typeName}>{typeName}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <Tabs defaultValue={isManager ? "team-requests" : "my-requests"} className="w-full">
                <TabsList className="mb-4">
                    <TabsTrigger value="my-requests">My Requests ({myRequests.length})</TabsTrigger>
                    {isManager && <TabsTrigger value="team-requests">Team Requests ({teamRequests.length})</TabsTrigger>}
                </TabsList>
                <TabsContent value="my-requests">
                    {myRequests.length > 0 ? (
                        <>
                           <RequestTable requests={myRequests} />
                           <RequestList requests={myRequests} />
                        </>
                     ) : <p className="text-center text-muted-foreground p-8 border-2 border-dashed rounded-lg">No matching requests found.</p>}
                </TabsContent>
                {isManager && (
                    <TabsContent value="team-requests">
                        {teamRequests.length > 0 ? (
                            <>
                                <RequestTable requests={teamRequests} forManagerView />
                                <RequestList requests={teamRequests} forManagerView />
                            </>
                        ) : <p className="text-center text-muted-foreground p-8 border-2 border-dashed rounded-lg">No matching team requests found.</p>}
                    </TabsContent>
                )}
            </Tabs>
        </CardContent>
      </Card>
      
      <LeaveRequestDialog 
        isOpen={isRequestDialogOpen}
        setIsOpen={setIsRequestDialogOpen}
        onSave={handleSaveRequest}
        request={editingRequest}
        leaveTypes={leaveTypes}
        currentUser={currentUser}
      />

       <OffsetRequestDialog
        isOpen={isOffsetDialogOpen}
        setIsOpen={setIsOffsetDialogOpen}
        onSave={handleSaveRequest}
        request={editingRequest}
        currentUser={currentUser}
        allLeaveRequests={leaveRequests}
      />

      {emailingRequest && (
        <EmailDialog
            isOpen={isEmailDialogOpen}
            setIsOpen={setIsEmailDialogOpen}
            leaveRequest={emailingRequest}
            smtpSettings={smtpSettings}
            employees={employees}
        />
      )}
    </>
  );
}


type EmailDialogProps = {
    isOpen: boolean;
    setIsOpen: (isOpen: boolean) => void;
    leaveRequest: Leave;
    smtpSettings: SmtpSettings;
    employees: Employee[];
};

function EmailDialog({ isOpen, setIsOpen, leaveRequest, smtpSettings, employees }: EmailDialogProps) {
    const requester = employees.find(e => e.id === leaveRequest.employeeId);
    const manager = employees.find(e => e.id === leaveRequest.managedBy);

    const [to, setTo] = useState('');
    const [subject, setSubject] = useState('');
    const [body, setBody] = useState('');
    const [isSending, startTransition] = useTransition();
    const { toast } = useToast();

    React.useEffect(() => {
        if (isOpen && requester && manager) {
            const startDate = format(new Date(leaveRequest.startDate), 'MMM d, yyyy');
            const endDate = format(new Date(leaveRequest.endDate), 'MMM d, yyyy');
            const duration = isSameDay(new Date(leaveRequest.startDate), new Date(leaveRequest.endDate)) ? startDate : `From ${startDate} to ${endDate}`;

            const newSubject = `Leave Request - ${getFullName(requester)}`;
            const newBody = `Dear ${getFullName(manager)},

Please find attached the leave application form of ${getFullName(requester)}.

Details:
- Type: ${leaveRequest.type}
- Reason: ${leaveRequest.reason || 'N/A'}
- Duration: ${duration}
- Status: ${leaveRequest.status.charAt(0).toUpperCase() + leaveRequest.status.slice(1)}

Thank you,  
Onduty Admin`;
            
            setTo(manager.email);
            setSubject(newSubject);
            setBody(newBody);
        }
    }, [isOpen, leaveRequest, requester, manager]);
    
    const handleSend = async () => {
        if (!to) {
            toast({ variant: 'destructive', title: 'Recipient required', description: 'Please enter an email address.' });
            return;
        }
        if (!leaveRequest.pdfDataUri) {
            toast({ variant: 'destructive', title: 'PDF not found', description: 'The leave form PDF is not available to attach.' });
            return;
        }

        startTransition(async () => {
            const attachment = {
                filename: `Leave Application - ${requester ? getFullName(requester) : 'Unknown'}.pdf`,
                content: leaveRequest.pdfDataUri!.split('base64,')[1],
            };

            toast({ title: 'Sending email...', description: `Sending leave form to ${to}` });
            const result = await sendEmail({ to, subject, htmlBody: body.replace(/\n/g, '<br>'), attachments: [attachment] }, smtpSettings);

            if (result.success) {
                toast({ title: 'Email Sent!', description: 'The leave form has been sent successfully.' });
                setIsOpen(false);
            } else {
                toast({ variant: 'destructive', title: 'Email Failed', description: result.error });
            }
        });
    };

    return (
        <Dialog open={isOpen} onOpenChange={setIsOpen}>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>Send Leave Form</DialogTitle>
                    <DialogDescription>The approved ALAF will be sent as a PDF attachment.</DialogDescription>
                </DialogHeader>
                <div className="space-y-4 py-4">
                    <div className="space-y-2">
                        <Label htmlFor="recipientEmail">Recipient Email</Label>
                        <Input id="recipientEmail" type="email" value={to} onChange={(e) => setTo(e.target.value)} placeholder="recipient@example.com" />
                    </div>
                     <div className="space-y-2">
                        <Label>Subject</Label>
                        <Input value={subject} onChange={(e) => setSubject(e.target.value)} />
                    </div>
                    <div className="space-y-2">
                        <Label>Body</Label>
                        <Textarea value={body} onChange={(e) => setBody(e.target.value)} rows={12} />
                    </div>
                </div>
                <DialogFooter>
                    <Button variant="ghost" onClick={() => setIsOpen(false)}>Cancel</Button>
                    <Button onClick={handleSend} disabled={isSending}>
                        {isSending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                        Send
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
