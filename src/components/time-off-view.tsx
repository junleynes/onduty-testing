
'use client';

import React, { useState, useMemo, useTransition , useRef } from 'react';
import type { Leave, Employee, LeaveRequestStatus, Shift } from '@/types';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from './ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { format, isSameDay, isWithinInterval, startOfDay, eachDayOfInterval, differenceInCalendarDays } from 'date-fns';
import { getFullName, getInitialState, cn } from '@/lib/utils';
import { PlusCircle, Check, X, FileDown, Mail, Eye, Upload, Loader2, User, Calendar, Type, MessageSquare, Info, Trash2, ChevronsUpDown, Settings, Clock4, ArrowUpDown, Search, Filter, Palmtree, ListChecks, Plus, Star, StarOff } from 'lucide-react';
import { LeaveRequestDialog } from './leave-request-dialog';
import { useToast } from '@/hooks/use-toast';
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { v4 as uuidv4 } from 'uuid';
import type { LeaveTypeOption } from './leave-type-editor';
import { generateLeavePdf, generateOffsetPdf, sendEmail, savePdfDataUri, saveLeaveSignatures, getLeaveRecipients, addDbNotification, writeAuditLog } from '@/app/actions';
import type { LeaveRecipient } from '@/app/actions';
import { LeaveRecipientsManager } from './leave-recipients-manager';
import type { SmtpSettings } from '@/types';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from './ui/dialog';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { Textarea } from './ui/textarea';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from './ui/alert-dialog';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from './ui/dropdown-menu';
import { OffsetRequestDialog } from './offset-request-dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';
import { Checkbox } from './ui/checkbox';

type TimeOffViewProps = {
  leaveRequests: Leave[];
  setLeaveRequests: React.Dispatch<React.SetStateAction<Leave[]>>;
  shifts: Shift[];
  setShifts: React.Dispatch<React.SetStateAction<Shift[]>>;
  currentUser: Employee;
  employees: Employee[];
  leaveTypes: LeaveTypeOption[];
  smtpSettings: SmtpSettings;
};

type SortKey = 'employee' | 'type' | 'startDate' | 'status' | 'dateFiled';
type SortDirection = 'asc' | 'desc';

export default function TimeOffView({ leaveRequests, setLeaveRequests, shifts, setShifts, currentUser, employees, leaveTypes, smtpSettings }: TimeOffViewProps) {
  const { toast } = useToast();
  const [isRequestDialogOpen, setIsRequestDialogOpen] = useState(false);
  const notifyEmployeeOnApprove = useRef(true);
  const [pendingAction, setPendingAction] = useState<{ requestId: string; status: 'approved' | 'rejected' } | null>(null);
  const [notifyEmployee, setNotifyEmployee] = useState(true);
  const [isOffsetDialogOpen, setIsOffsetDialogOpen] = useState(false);
  const [isEmailDialogOpen, setIsEmailDialogOpen] = useState(false);
  const [isPurging, startPurgeTransition] = useTransition();
  const [editingRequest, setEditingRequest] = useState<Partial<Leave> | null>(null);
  const [emailingRequest, setEmailingRequest] = useState<Leave | null>(null);

  const [sortConfig, setSortConfig] = useState<{ key: SortKey; direction: SortDirection }>({ key: 'dateFiled', direction: 'desc' });
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [typeFilter, setTypeFilter] = useState<string>('all');
  
  const [selectedIds, setSelectedIds] = useState<string[]>([]);

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
          case 'dateFiled':
            aValue = new Date(a.dateFiled || a.requestedAt || 0).getTime();
            bValue = new Date(a.dateFiled || a.requestedAt || 0).getTime();
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
  
  const uniqueTypesForFilter = useMemo(() => {
    const types = new Set<string>();
    // Only show leave types for the current user's group (or unscoped types)
    leaveTypes
      .filter(lt => lt.groupName === null || lt.groupName === undefined || lt.groupName === currentUser.group)
      .forEach(lt => types.add(lt.type.toUpperCase()));
    leaveRequests.forEach(req => {
      if (req.type && req.type !== 'Work Extension') {
        types.add(req.type.toUpperCase());
      }
    });
    types.add('OFFSET');
    return Array.from(types).sort();
  }, [leaveTypes, leaveRequests, currentUser.group]);

  const toggleSelect = (id: string) => {
    setSelectedIds(prev => prev.includes(id) ? prev.filter(i => i !== id) : [...prev, id]);
  };

  const handleSelectAll = (ids: string[], checked: boolean) => {
    if (checked) {
        setSelectedIds(prev => Array.from(new Set([...prev, ...ids])));
    } else {
        setSelectedIds(prev => prev.filter(id => !ids.includes(id)));
    }
  };

  const handleDeleteSelected = () => {
    setLeaveRequests(prev => {
        // Identify work extensions that need to be reset
        const idsToReset = new Set<string>();
        prev.forEach(req => {
            if (selectedIds.includes(req.id) && req.type === 'Offset' && req.claimedWorkExtensionId) {
                idsToReset.add(req.claimedWorkExtensionId);
            }
        });

        // Perform filtering and reset status of linked extensions
        return prev
            .filter(r => !selectedIds.includes(r.id))
            .map(r => {
                if (idsToReset.has(r.id)) {
                    return { ...r, workExtensionStatus: 'not-claimed' as const };
                }
                return r;
            });
    });
    setSelectedIds([]);
    toast({ title: `${selectedIds.length} Request(s) Deleted`, variant: 'destructive' });
  };

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

  const handleSaveRequest = (requestData: Partial<Leave>, notifySuperior: boolean) => {
    if (editingRequest?.id) { 
      setLeaveRequests(prev => prev.map(r => r.id === editingRequest.id ? { ...r, ...requestData } as Leave : r));
      toast({ title: 'Request Updated' });
    } else { 
      const leaveTypeDetails = leaveTypes.find(lt => lt.type.toLowerCase() === requestData.type?.toLowerCase());
      const newRequest: Leave = {
        id: uuidv4(),
        employeeId: currentUser.id,
        status: 'pending',
        requestedAt: new Date(),
        ...requestData,
        endDate: requestData.endDate || requestData.startDate,
        dateFiled: new Date(),
        department: currentUser.department || currentUser.group || '',
        idNumber: currentUser.employeeNumber || '',
        contactInfo: currentUser.phone || '',
        employeeSignature: currentUser.signature,
        color: leaveTypeDetails?.color || '#6b7280',
      } as Leave;
      setLeaveRequests(prev => [newRequest, ...prev]);
      if (currentUser.signature) {
        saveLeaveSignatures(newRequest.id, currentUser.signature, undefined).catch(() => {});
      }
      toast({ title: 'Request Submitted' });

      // Email superior/manager if checkbox was checked and SMTP is configured
      if (notifySuperior && smtpSettings?.host) {
        const superior = employees.find(e =>
          (e.role === 'manager' || e.role === 'admin') &&
          e.group === currentUser.group &&
          e.id !== currentUser.id &&
          e.email
        );
        if (superior?.email) {
          const startStr = newRequest.startDate ? format(new Date(newRequest.startDate), 'MMM d, yyyy') : '';
          const endStr   = newRequest.endDate   ? format(new Date(newRequest.endDate),   'MMM d, yyyy') : '';
          const dateRange = startStr === endStr ? startStr : `${startStr} – ${endStr}`;
          sendEmail({
            to: superior.email,
            subject: `[OnDuty] New ${newRequest.type} request from ${getFullName(currentUser)}`,
            htmlBody: `<p>Hi ${superior.firstName},</p>
<p><strong>${getFullName(currentUser)}</strong> has filed a new <strong>${newRequest.type}</strong> request.</p>
<p><strong>Dates:</strong> ${dateRange}</p>
${newRequest.reason ? `<p><strong>Reason:</strong> ${newRequest.reason}</p>` : ''}
<p>Please log in to OnDuty to review and approve or reject the request.</p>`,
          }, smtpSettings).catch(() => {});
        }
      }
    }
    setIsRequestDialogOpen(false);
    setIsOffsetDialogOpen(false);
  };
  
  const handleManageRequest = async (requestId: string, newStatus: LeaveRequestStatus, shouldNotifyEmployee = true) => {
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
            managedAt: originalRequest.managedAt || new Date(),
            managerSignature: originalRequest.managerSignature || currentUser.signature,
            color: leaveTypeDetails?.color || originalRequest.color
        };

        newLeaveRequests[requestIndex] = finalUpdatedRequest;

        // Save manager signature directly to DB — bypasses the save payload size limit
        const sigToSave = originalRequest.managerSignature || currentUser.signature;
        if (sigToSave) {
            saveLeaveSignatures(requestId, undefined, sigToSave).catch(() => {});
        }

        if (newStatus === 'rejected' && originalRequest.type === 'Offset' && originalRequest.claimedWorkExtensionId) {
             const weIndex = newLeaveRequests.findIndex(r => r.id === originalRequest.claimedWorkExtensionId);
             if (weIndex > -1) {
                newLeaveRequests[weIndex] = {
                    ...newLeaveRequests[weIndex],
                    workExtensionStatus: 'not-claimed',
                };
            }
        }

        if (newStatus === 'approved' && finalUpdatedRequest.type === 'Offset' && finalUpdatedRequest.claimedWorkExtensionId) {
            const weIndex = newLeaveRequests.findIndex(r => r.id === finalUpdatedRequest!.claimedWorkExtensionId);
            if (weIndex > -1) {
                newLeaveRequests[weIndex] = {
                    ...newLeaveRequests[weIndex],
                    workExtensionStatus: 'claimed',
                };
            }
        }
        
        if (newStatus === 'approved' && originalRequest.status === 'pending') {
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

    if (newStatus === 'approved' && finalUpdatedRequest && finalUpdatedRequest.status === 'approved') {
        toast({ title: "Request Approved & Generating PDF...", description: "Please wait a moment." });
        
        const generatorAction = finalUpdatedRequest.type === 'Offset' ? generateOffsetPdf : generateLeavePdf;
        
        // For Offset requests, pass the linked WE record directly from client state
        // so generateOffsetPdf doesn't need to re-fetch from DB (which may be missing
        // columns like dateFiled, department, durationCategory from pending migrations)
        let pdfResult;
        if (finalUpdatedRequest.type === 'Offset' && finalUpdatedRequest.claimedWorkExtensionId) {
            const weRecord = leaveRequests.find(r => r.id === finalUpdatedRequest!.claimedWorkExtensionId);
            pdfResult = await generateOffsetPdf(finalUpdatedRequest, weRecord);
        } else {
            pdfResult = await generatorAction(finalUpdatedRequest);
        }
        const result = pdfResult;
        
        if (result.success && result.pdfDataUri) {
            // Save PDF directly to DB — bypasses the save payload size limit
            savePdfDataUri(requestId, result.pdfDataUri).catch(() => {});
            setLeaveRequests(prev => prev.map(req => req.id === requestId ? { ...req, pdfDataUri: result.pdfDataUri } : req));
            toast({ title: "PDF Generated", description: "The form has been created." });
        } else {
            toast({ variant: 'destructive', title: 'PDF Generation Failed', description: result.error });
        }
    } else {
        toast({ title: `Request ${newStatus}` });
    }

    // Notify the requester via email + in-app notification if configured
    if (finalUpdatedRequest && smtpSettings?.host) {
        const requester = employees.find(e => e.id === finalUpdatedRequest!.employeeId);
        if (requester?.email) {
            const statusLabel = newStatus === 'approved' ? 'Approved ✅' : 'Rejected ❌';
            const managerName = getFullName(currentUser);
            const startStr = finalUpdatedRequest.startDate ? format(new Date(finalUpdatedRequest.startDate), 'MMM d, yyyy') : '';
            const endStr   = finalUpdatedRequest.endDate   ? format(new Date(finalUpdatedRequest.endDate),   'MMM d, yyyy') : '';
            const dateRange = startStr === endStr ? startStr : `${startStr} – ${endStr}`;
            if (shouldNotifyEmployee) {
              sendEmail({
                to: requester.email,
                subject: `[OnDuty] Your ${finalUpdatedRequest.type} request has been ${newStatus}`,
                htmlBody: `<p>Hi ${requester.firstName},</p>
<p>Your <strong>${finalUpdatedRequest.type}</strong> request for <strong>${dateRange}</strong> has been <strong>${statusLabel}</strong> by ${managerName}.</p>
${finalUpdatedRequest.reason ? `<p><strong>Original reason:</strong> ${finalUpdatedRequest.reason}</p>` : ''}
<p>Please log in to OnDuty for more details.</p>`,
              }, smtpSettings).catch(() => {});
            }
        }
    }
    // In-app persistent notification for the requester regardless of SMTP
    if (finalUpdatedRequest?.employeeId) {
        const startStr = finalUpdatedRequest.startDate ? format(new Date(finalUpdatedRequest.startDate), 'MMM d') : '';
        addDbNotification({
            employeeId: finalUpdatedRequest.employeeId,
            message: `Your ${finalUpdatedRequest.type} request${startStr ? ` for ${startStr}` : ''} was ${newStatus} by ${getFullName(currentUser)}.`,
            link: 'time-off',
        }).catch(() => {});
    }
  };

  const handleDownloadPdf = async (req: Leave, employeeName: string) => {
    let pdfDataUri = req.pdfDataUri;
    if (!pdfDataUri || pdfDataUri.startsWith('file:')) {
      const result = await getLeaveWithPdf(req.id);
      if (result.success && result.pdfDataUri) {
        pdfDataUri = result.pdfDataUri;
        setLeaveRequests(prev => prev.map(r => r.id === req.id ? { ...r, pdfDataUri } : r));
      } else {
        toast({ variant: 'destructive', title: 'PDF not found', description: 'Could not load the PDF file.' });
        return;
      }
    }
    const link = document.createElement('a');
    link.href = pdfDataUri;
    link.download = `Leave Application - ${employeeName}.pdf`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handleViewPdf = async (req: Leave) => {
    let pdfDataUri = req.pdfDataUri;
    if (!pdfDataUri || pdfDataUri.startsWith('file:')) {
      const result = await getLeaveWithPdf(req.id);
      if (result.success && result.pdfDataUri) {
        pdfDataUri = result.pdfDataUri;
        setLeaveRequests(prev => prev.map(r => r.id === req.id ? { ...r, pdfDataUri } : r));
      } else {
        toast({ variant: 'destructive', title: 'PDF not found', description: 'Could not load the PDF file.' });
        return;
      }
    }
    window.open(pdfDataUri, '_blank');
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
                        <Button size="sm" variant="outline" className="text-green-600 border-green-600 hover:bg-green-100 hover:text-green-700" onClick={() => { setNotifyEmployee(true); setPendingAction({ requestId: req.id, status: 'approved' }); }}><Check className="h-4 w-4 mr-1" />Approve</Button>
                        <Button size="sm" variant="outline" className="text-red-600 border-red-600 hover:bg-red-100 hover:text-red-700" onClick={() => { setNotifyEmployee(false); setPendingAction({ requestId: req.id, status: 'rejected' }); }}><X className="h-4 w-4 mr-1" />Reject</Button>
                    </div>
                );
            }
            return (
                <div className="flex gap-2 justify-end flex-wrap">
                    {req.status === 'approved' && (
                        <Button size="sm" variant="outline" className="text-blue-600 border-blue-600 hover:bg-blue-100" onClick={() => handleManageRequest(req.id, 'processed')} title="Mark as Processed">
                            <ListChecks className="h-4 w-4 mr-1" />Process
                        </Button>
                    )}
                    {req.pdfDataUri && (
                        <>
                            <a onClick={() => handleViewPdf(req)} ><Button size="sm" variant="outline"><Eye className="h-4 w-4 mr-1" />View</Button></a>
                            <Button size="sm" variant="outline" onClick={() => handleDownloadPdf(req, getFullName(employee!))}><FileDown className="h-4 w-4 mr-1" />Download</Button>
                            <Button size="sm" variant="outline" onClick={() => handleOpenEmailDialog(req)}><Mail className="h-4 w-4 mr-1" />Email</Button>
                        </>
                    )}
                </div>
            );
        } else {
            if (req.status === 'pending') {
                return (
                    <div className="flex gap-2 justify-end">
                        <Button size="sm" variant="outline" onClick={() => handleEditRequest(req)}>Edit</Button>
                    </div>
                );
            }
            if (req.pdfDataUri) {
                return (
                    <div className="flex gap-2 justify-end">
                        <a onClick={() => handleViewPdf(req)} ><Button size="sm" variant="outline"><Eye className="h-4 w-4 mr-1" />View</Button></a>
                        <Button size="sm" variant="outline" onClick={() => handleDownloadPdf(req, getFullName(employee!))}><FileDown className="h-4 w-4 mr-1" />Download</Button>
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
                            <div className="flex items-center gap-3">
                                <Checkbox 
                                  checked={selectedIds.includes(req.id)}
                                  onCheckedChange={() => toggleSelect(req.id)}
                                />
                                <div>
                                    {forManagerView && <CardTitle className="text-base">{employee ? getFullName(employee) : 'Unknown'}</CardTitle>}
                                    <CardDescription className="flex items-center gap-2"><Calendar className="h-4 w-4"/> {dateDisplay}</CardDescription>
                                </div>
                            </div>
                            <Badge variant={req.status === 'approved' ? 'default' : req.status === 'rejected' ? 'destructive' : req.status === 'processed' ? 'outline' : 'secondary'}>{req.status}</Badge>
                        </CardHeader>
                        <CardContent className="p-4 pt-0 space-y-2 text-sm">
                            <div className="flex items-center gap-2">
                                <Type className="h-4 w-4 text-muted-foreground"/>
                                <span className="font-medium">{req.type}</span>
                            </div>
                            <div className="flex items-center gap-2 text-xs text-muted-foreground">
                                <Clock4 className="h-3 w-3" />
                                <span>Filed: {format(new Date(req.dateFiled || req.requestedAt || new Date()), 'MMM d, yyyy')}</span>
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
                        <Button size="sm" variant="outline" className="text-green-600 border-green-600 hover:bg-green-100 hover:text-green-700" onClick={() => { setNotifyEmployee(true); setPendingAction({ requestId: req.id, status: 'approved' }); }} title="Approve"><Check className="h-4 w-4" /></Button>
                        <Button size="sm" variant="outline" className="text-red-600 border-red-600 hover:bg-red-100 hover:text-red-700" onClick={() => { setNotifyEmployee(false); setPendingAction({ requestId: req.id, status: 'rejected' }); }} title="Reject"><X className="h-4 w-4" /></Button>
                    </div>
                );
            }
            return (
                <div className="flex gap-2 justify-end">
                    {req.status === 'approved' && (
                        <Button size="sm" variant="outline" className="text-blue-600 border-blue-600 hover:bg-blue-100" onClick={() => handleManageRequest(req.id, 'processed')} title="Mark as Processed">
                            <ListChecks className="h-4 w-4" />
                        </Button>
                    )}
                    {req.pdfDataUri && (
                        <>
                            <a onClick={() => handleViewPdf(req)} ><Button size="sm" variant="outline" title="View PDF"><Eye className="h-4 w-4" /></Button></a>
                            <Button size="sm" variant="outline" onClick={() => handleDownloadPdf(req, getFullName(employee!))} title="Download PDF"><FileDown className="h-4 w-4" /></Button>
                            <Button size="sm" variant="outline" onClick={() => handleOpenEmailDialog(req)} title="Send via Email"><Mail className="h-4 w-4" /></Button>
                        </>
                    )}
                </div>
            );
        } else {
            if (req.status === 'pending') {
                return (
                    <div className="flex gap-2 justify-end">
                        <Button size="sm" variant="outline" onClick={() => handleEditRequest(req)}>Edit</Button>
                    </div>
                );
            }
            if (req.pdfDataUri) {
                return (
                    <div className="flex gap-2 justify-end">
                        <a onClick={() => handleViewPdf(req)} ><Button size="sm" variant="outline"><Eye className="h-4 w-4" /></Button></a>
                        <Button size="sm" variant="outline" onClick={() => handleDownloadPdf(req, getFullName(employee!))}><FileDown className="h-4 w-4" /></Button>
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
                <TableHead className="w-12">
                   <Checkbox 
                     checked={requests.length > 0 && requests.every(r => selectedIds.includes(r.id))}
                     onCheckedChange={(checked) => handleSelectAll(requests.map(r => r.id), !!checked)}
                   />
                </TableHead>
                <SortableHeader tKey="dateFiled">Date Filed</SortableHeader>
                {forManagerView && <SortableHeader tKey="employee">Employee</SortableHeader>}
                <SortableHeader tKey="type">Type</SortableHeader>
                <SortableHeader tKey="startDate">Leave Dates</SortableHeader>
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
                        <TableCell>
                            <Checkbox 
                              checked={selectedIds.includes(req.id)}
                              onCheckedChange={() => toggleSelect(req.id)}
                            />
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                            {format(new Date(req.dateFiled || req.requestedAt || new Date()), 'MMM d, yyyy')}
                        </TableCell>
                        {forManagerView && <TableCell>{employee ? getFullName(employee) : 'Unknown'}</TableCell>}
                        <TableCell className="font-medium">{req.type}</TableCell>
                        <TableCell>{dateDisplay}</TableCell>
                        <TableCell className="max-w-[200px] truncate">{req.reason}</TableCell>
                        <TableCell><Badge variant={req.status === 'approved' ? 'default' : req.status === 'rejected' ? 'destructive' : req.status === 'processed' ? 'outline' : 'secondary'}>{req.status}</Badge></TableCell>
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
      <div className="space-y-6">
        <Card>
            <CardHeader className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
            <div className="space-y-1">
                <CardTitle>Time Off Requests</CardTitle>
                <CardDescription>Manage your leave requests and offsets.</CardDescription>
            </div>
            <div className="flex gap-2 flex-wrap items-center">
                    {selectedIds.length > 0 && (
                        <AlertDialog>
                            <AlertDialogTrigger asChild>
                                <Button variant="destructive">
                                    <Trash2 className="h-4 w-4 mr-2" />
                                    Delete Selected ({selectedIds.length})
                                </Button>
                            </AlertDialogTrigger>
                            <AlertDialogContent>
                                <AlertDialogHeader>
                                <AlertDialogTitle>Are you absolutely sure?</AlertDialogTitle>
                                <AlertDialogDescription>
                                    This will permanently delete {selectedIds.length} selected request(s). This action cannot be undone.
                                </AlertDialogDescription>
                                </AlertDialogHeader>
                                <AlertDialogFooter>
                                <AlertDialogCancel>Cancel</AlertDialogCancel>
                                <AlertDialogAction onClick={handleDeleteSelected}>Delete</AlertDialogAction>
                                </AlertDialogFooter>
                            </AlertDialogContent>
                        </AlertDialog>
                    )}
                    {isManager && (
                        <AlertDialog>
                            <AlertDialogTrigger asChild>
                                <Button variant="destructive" disabled={isPurging} className={cn(selectedIds.length > 0 && "hidden md:flex")}>
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
                        <SelectItem value="processed">Processed</SelectItem>
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
      </div>
      
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

      {/* Approve / Reject confirmation dialog with optional email notification */}
      <AlertDialog open={!!pendingAction} onOpenChange={open => { if (!open) setPendingAction(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {pendingAction?.status === 'approved' ? 'Approve Request?' : 'Reject Request?'}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {pendingAction?.status === 'approved'
                ? 'This will approve the request and generate the PDF form.'
                : 'This will reject the request.'}
            </AlertDialogDescription>
          </AlertDialogHeader>
          {smtpSettings?.host && (
            <div className="flex items-center gap-2 px-1 py-2">
              <Checkbox
                id="notifyEmployeeCheck"
                checked={notifyEmployee}
                onCheckedChange={v => setNotifyEmployee(!!v)}
              />
              <label htmlFor="notifyEmployeeCheck" className="text-sm cursor-pointer select-none">
                Notify employee by email after {pendingAction?.status === 'approved' ? 'approving' : 'rejecting'}
              </label>
            </div>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setPendingAction(null)}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className={pendingAction?.status === 'rejected' ? 'bg-destructive hover:bg-destructive/90' : ''}
              onClick={() => {
                if (pendingAction) {
                  handleManageRequest(pendingAction.requestId, pendingAction.status, notifyEmployee);
                  setPendingAction(null);
                }
              }}
            >
              {pendingAction?.status === 'approved' ? 'Yes, Approve' : 'Yes, Reject'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {emailingRequest && (
        <EmailDialog
            isOpen={isEmailDialogOpen}
            setIsOpen={setIsEmailDialogOpen}
            leaveRequest={emailingRequest}
            smtpSettings={smtpSettings}
            employees={employees}
            currentUser={currentUser}
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
    currentUser: Employee;
};

function EmailDialog({ isOpen, setIsOpen, leaveRequest, smtpSettings, employees, currentUser }: EmailDialogProps) {
    const requester = employees.find(e => e.id === leaveRequest.employeeId);

    const [recipients, setRecipients] = useState<LeaveRecipient[]>([]);
    const [selectedRecipientId, setSelectedRecipientId] = useState('');
    const [recipientName, setRecipientName] = useState('');
    const [to, setTo] = useState('');
    const [subject, setSubject] = useState('');
    const [body, setBody] = useState('');
    const [isManageOpen, setIsManageOpen] = useState(false);
    const [isSending, startTransition] = useTransition();
    const { toast } = useToast();

    // Load recipients and init form when dialog opens
    React.useEffect(() => {
        if (!isOpen) return;

        getLeaveRecipients().then(r => {
            if (r.success && r.recipients) {
                setRecipients(r.recipients);
                // Auto-select default recipient
                const def = r.recipients.find(x => x.isDefault) || r.recipients[0];
                if (def) {
                    setSelectedRecipientId(def.id);
                    setRecipientName(def.name);
                    setTo(def.email);
                }
            }
        });

        if (!requester) return;
        const startDate = format(new Date(leaveRequest.startDate), 'MMM d, yyyy');
        const endDate   = format(new Date(leaveRequest.endDate),   'MMM d, yyyy');
        const duration  = isSameDay(new Date(leaveRequest.startDate), new Date(leaveRequest.endDate))
            ? startDate : `From ${startDate} to ${endDate}`;

        setSubject(`Leave Request - ${getFullName(requester)}`);
        setBody(`Dear Recipient,

Please find attached the leave application form of ${getFullName(requester)}.

Details:
- Type: ${leaveRequest.type}
- Reason: ${leaveRequest.reason || 'N/A'}
- Duration: ${duration}
- Status: ${leaveRequest.status.charAt(0).toUpperCase() + leaveRequest.status.slice(1)}

Thank you,
${getFullName(currentUser)}`);
    }, [isOpen]);

    // Update salutation when recipient changes
    const handleSelectRecipient = (id: string) => {
        const r = recipients.find(x => x.id === id);
        if (!r) return;
        setSelectedRecipientId(id);
        setRecipientName(r.name);
        setTo(r.email);
        setBody(prev => {
            const lines = prev.split('\n');
            if (lines[0].startsWith('Dear ')) lines[0] = `Dear ${r.name},`;
            return lines.join('\n');
        });
    };

    const handleSend = async () => {
        if (!to) {
            toast({ variant: 'destructive', title: 'Recipient required', description: 'Please enter or select a recipient email.' });
            return;
        }

        // Lazy-load PDF from disk if not in state
        let pdfDataUri = leaveRequest.pdfDataUri;
        if (!pdfDataUri || pdfDataUri.startsWith('file:')) {
            const loaded = await getLeaveWithPdf(leaveRequest.id);
            if (loaded.success && loaded.pdfDataUri) {
                pdfDataUri = loaded.pdfDataUri;
            } else {
                toast({ variant: 'destructive', title: 'PDF not found', description: 'Generate the leave form PDF first.' });
                return;
            }
        }

        startTransition(async () => {
            const result = await sendEmail({
                to,
                subject,
                htmlBody: body.replace(/\n/g, '<br>'),
                attachments: [{
                    filename: `Leave Application - ${requester ? getFullName(requester) : 'Unknown'}.pdf`,
                    content: pdfDataUri!.split('base64,')[1],
                }],
                fromName: getFullName(currentUser),
                fromEmail: currentUser.email,
            }, smtpSettings);

            if (result.success) {
                toast({ title: 'Email Sent!', description: `Leave form sent to ${to}` });
                setIsOpen(false);
            } else {
                toast({ variant: 'destructive', title: 'Email Failed', description: result.error });
            }
        });
    };

    return (
        <>
        <Dialog open={isOpen} onOpenChange={setIsOpen}>
            <DialogContent className="sm:max-w-xl">
                <DialogHeader>
                    <DialogTitle>Send Leave Form</DialogTitle>
                    <DialogDescription>The approved ALAF will be sent as a PDF attachment.</DialogDescription>
                </DialogHeader>
                <div className="space-y-4 py-4">
                    {/* Sender — locked to current user */}
                    <div className="rounded-md border p-4 space-y-3">
                        <Label className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Sender Information</Label>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <div className="space-y-1">
                                <Label htmlFor="senderName" className="text-xs">Name</Label>
                                <Input id="senderName" value={getFullName(currentUser)} readOnly className="bg-muted cursor-not-allowed" />
                            </div>
                            <div className="space-y-1">
                                <Label htmlFor="senderEmail" className="text-xs">Email</Label>
                                <Input id="senderEmail" value={currentUser.email} readOnly className="bg-muted cursor-not-allowed" />
                            </div>
                        </div>
                    </div>

                    {/* Recipient — from managed leave_recipients list */}
                    <div className="rounded-md border p-4 space-y-3">
                        <div className="flex items-center justify-between">
                            <Label className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Recipient Information</Label>
                            <Button variant="ghost" size="sm" className="h-6 text-xs px-2" onClick={() => setIsManageOpen(true)}>
                                Manage Recipients
                            </Button>
                        </div>
                        {recipients.length > 0 ? (
                            <Select value={selectedRecipientId} onValueChange={handleSelectRecipient}>
                                <SelectTrigger>
                                    <SelectValue placeholder="Select recipient..." />
                                </SelectTrigger>
                                <SelectContent>
                                    {recipients.map(r => (
                                        <SelectItem key={r.id} value={r.id}>
                                            {r.name} — {r.role}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        ) : (
                            <p className="text-sm text-muted-foreground">
                                No recipients configured.{' '}
                                <button className="underline text-primary" onClick={() => setIsManageOpen(true)}>
                                    Add one now.
                                </button>
                            </p>
                        )}
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <div className="space-y-1">
                                <Label htmlFor="recipientName" className="text-xs">Name</Label>
                                <Input id="recipientName" value={recipientName} onChange={e => setRecipientName(e.target.value)} />
                            </div>
                            <div className="space-y-1">
                                <Label htmlFor="recipientEmail" className="text-xs">Email</Label>
                                <Input id="recipientEmail" type="email" value={to} onChange={e => setTo(e.target.value)} />
                            </div>
                        </div>
                    </div>

                    <div className="space-y-2">
                        <Label>Subject</Label>
                        <Input value={subject} onChange={e => setSubject(e.target.value)} />
                    </div>
                    <div className="space-y-2">
                        <Label>Body</Label>
                        <Textarea value={body} onChange={e => setBody(e.target.value)} rows={7} />
                    </div>
                </div>
                <DialogFooter>
                    <Button variant="ghost" onClick={() => setIsOpen(false)}>Cancel</Button>
                    <Button onClick={handleSend} disabled={isSending || !to}>
                        {isSending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                        Send Email
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
        <LeaveRecipientsManager isOpen={isManageOpen} setIsOpen={(open) => {
            setIsManageOpen(open);
            // Reload recipients after managing
            if (!open) getLeaveRecipients().then(r => {
                if (r.success && r.recipients) {
                    setRecipients(r.recipients);
                    const def = r.recipients.find(x => x.isDefault) || r.recipients[0];
                    if (def && !selectedRecipientId) {
                        setSelectedRecipientId(def.id);
                        setRecipientName(def.name);
                        setTo(def.email);
                    }
                }
            });
        }} />
        </>
    );
}
