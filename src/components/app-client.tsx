
'use client';

import React, { useState, useMemo, useEffect, useCallback } from 'react';
import type { UserRole, Employee, Shift, Leave, Notification, Note, Holiday, Task, CommunicationAllowance, SmtpSettings, TardyRecord, RolePermissions, FaqItem, PreferredAvl } from '@/types';
import type { ShiftTemplate, ShiftWithRepeat } from '@/components/shift-editor';
import { SidebarProvider, Sidebar } from '@/components/ui/sidebar';
import Header from '@/components/header';
import SidebarNav from '@/components/sidebar-nav';
import { useRouter } from 'next/navigation';
import { useNotifications } from '@/hooks/use-notifications';
import { isSameDay, getMonth, getDate, getYear, format, differenceInYears, addDays, isBefore, startOfDay, isWithinInterval } from 'date-fns';
import { getData, saveAllData } from '@/lib/db-actions';
import { useSession, signOut } from 'next-auth/react';
import { addEmployee, updateEmployee } from '@/app/employee-actions';
import { saveTemplate } from '@/app/actions';
import { useToast } from '@/hooks/use-toast';
import { v4 as uuidv4 } from 'uuid';


// Views
import ScheduleView from '@/components/schedule-view';
import MyScheduleView from '@/components/my-schedule-view';
import TeamView from '@/components/team-view';
import AdminPanel from '@/components/admin-panel';
import ApiDocsView from '@/components/api-docs-view';
import AuditLogsView from '@/components/audit-logs-view';
import TemplatesView from '@/components/templates-view';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { TeamEditor } from '@/components/team-editor';
import { MemberImporter } from '@/components/member-importer';
import { GroupEditor } from '@/components/group-editor';
import OrgChartView from '@/components/org-chart-view';
import CelebrationsView from '@/components/celebrations-view';
import { NoteViewer } from '@/components/note-viewer';
import { NoteEditor } from '@/components/note-editor';
import { HolidayEditor } from '@/components/holiday-editor';
import HolidaysView from '@/components/holidays-view';
import OndutyView from '@/components/onduty-view';
import MyTasksView from '@/components/my-tasks-view';
import AllowanceView from '@/components/allowance-view';
import TaskManagerView from '@/components/task-manager-view';
import SmtpSettingsView from '@/components/smtp-settings-view';
import { HolidayImporter } from '@/components/holiday-importer';
import ReportsView from '@/components/reports-view';
import TimeOffView from '@/components/time-off-view';
import type { LeaveTypeOption } from '@/components/leave-type-editor';
import type { NavItemKey } from '@/types';
import { PermissionsEditor } from '@/components/permissions-editor';
import DangerZoneView from '@/components/danger-zone-view';
import DashboardView from '@/components/dashboard-view';
import FaqView from '@/components/faq-view';
import WorkExtensionsView from '@/components/work-extensions-view';
import AvlManagementView from '@/components/avl-management-view';


export type NavItem = NavItemKey;


function AppContent() {
  const router = useRouter();
  const { toast } = useToast();
  
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [shifts, setShifts] = useState<Shift[]>([]);
  const [leave, setLeave] = useState<Leave[]>([]);
  const [groups, setGroups] = useState<string[]>([]);
  const [notes, setNotes] = useState<Note[]>([]);
  const [holidays, setHolidays] = useState<Holiday[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [allowances, setAllowances] = useState<CommunicationAllowance[]>([]);
  const [smtpSettings, setSmtpSettings] = useState<SmtpSettings>({});
  const [tardyRecords, setTardyRecords] = useState<TardyRecord[]>([]);
  const [templates, setTemplates] = useState<Record<string, string | null>>({});
  const [shiftTemplates, setShiftTemplates] = useState<ShiftTemplate[]>([]);
  const [leaveTypes, setLeaveTypes] = useState<LeaveTypeOption[]>([]);
  const [permissions, setPermissions] = useState<RolePermissions>({ admin: [], manager: [], member: []});
  const [monthlyEmployeeOrder, setMonthlyEmployeeOrder] = useState<Record<string, string[]>>({});
  const [faqs, setFaqs] = useState<FaqItem[]>([]);
  const [preferredAvl, setPreferredAvl] = useState<PreferredAvl[]>([]);
  const [avlLocks, setAvlLocks] = useState<Record<string, boolean>>({});
  
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [initialDataLoaded, setInitialDataLoaded] = useState(false);

  const [currentUser, setCurrentUser] = useState<Employee | null>(null);
  const [activeView, setActiveView] = useState<NavItem>('dashboard');
  
  const [isEditorOpen, setIsEditorOpen] = useState(false);
  const [isImporterOpen, setIsImporterOpen] = useState(false);
  const [isGroupEditorOpen, setIsGroupEditorOpen] = useState(false);
  const [isHolidayEditorOpen, setIsHolidayEditorOpen] = useState(false);
  const [isHolidayImporterOpen, setIsHolidayImporterOpen] = useState(false);
  const [editingEmployee, setEditingEmployee] = useState<Partial<Employee> | null>(null);
  const [isPasswordResetMode, setIsPasswordResetMode] = useState(false);
  const [editorContext, setEditorContext] = useState<'admin' | 'manager'>('manager');

  const [isNoteViewerOpen, setIsNoteViewerOpen] = useState(false);
  const [viewingNote, setViewingNote] = useState<Note | Holiday | null>(null);
  const [isNoteEditorOpen, setIsNoteEditorOpen] = useState(false);
  const [editingNote, setEditingNote] = useState<Partial<Note> | null>(null);


  const { notifications, setNotifications, addNotification, addNotificationForUser } = useNotifications();

  // Save all data to the database whenever there's a change
  useEffect(() => {
    if (!initialDataLoaded || isLoading) return;

    /**
     * Format any Date or date-like value to a plain "YYYY-MM-DD" string using the
     * BROWSER's local timezone (date-fns `format` uses local time).
     *
     * Why this is necessary:
     * Next.js server actions serialize arguments via JSON.stringify before the RPC
     * call. A JS Date at local midnight in UTC+8 (e.g. June 10 00:00 UTC+8) becomes
     * "2026-06-09T16:00:00.000Z" in the payload. The server (running UTC) then calls
     * getDate() on that string and gets 9 — one day behind. Pre-formatting to a plain
     * "YYYY-MM-DD" string here means the server receives "2026-06-10" and never needs
     * to parse a time component at all, so the server timezone is irrelevant.
     */
    const toDateStr = (d: Date | string | undefined | null): string => {
      if (!d) return '';
      if (typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d.trim())) return d.trim();
      const dt = d instanceof Date ? d : new Date(d);
      return format(dt, 'yyyy-MM-dd');
    };

    const dataToSave = {
        employees: employees.map(e => ({
            ...e,
            // Strip large binary fields — avatar and signature are saved separately
            // via dedicated upload actions and must not round-trip on every state change
            avatar: undefined,
            signature: undefined,
        })),
        // Pre-format date to plain YYYY-MM-DD using the browser's local timezone so
        // the UTC server never misinterprets a time-bearing ISO string.
        shifts: shifts.map(s => ({
            ...s,
            date: toDateStr(s.date),
        })),
        // Strip all binary fields from leave records — these are written directly
        // to DB by their respective actions and must not bloat the save payload
        leave: leave.map(l => ({
            ...l,
            pdfDataUri: undefined,
            employeeSignature: undefined,
            managerSignature: undefined,
            startDate:         toDateStr(l.startDate),
            endDate:           toDateStr(l.endDate),
            dateFiled:         toDateStr(l.dateFiled),
            originalShiftDate: l.originalShiftDate ? toDateStr(l.originalShiftDate) : undefined,
        })),
        notes:    notes.map(n => ({ ...n, date: toDateStr(n.date) })),
        holidays: holidays.map(h => ({ ...h, date: toDateStr(h.date) })),
        tasks,
        allowances: allowances.map(a => ({
            ...a,
            screenshot: undefined, // saved by dedicated allowance action
        })),
        groups,
        smtpSettings,
        tardyRecords,
        templates: {
            // Strip PDF template binaries — they are large (~200KB each) and only
            // change when the user explicitly uploads a new template. They are saved
            // by the template uploader action, not by the general save loop.
            ...Object.fromEntries(
                Object.entries(templates).filter(([k]) =>
                    k !== 'alafTemplate' && k !== 'offsetTemplate'
                )
            ),
            import_api_key: localStorage.getItem('import_api_key') || 'onduty_secret_key'
        },
        shiftTemplates,
        leaveTypes,
        permissions,
        monthlyEmployeeOrder,
        faqs,
        preferredAvl,
        avlLocks,
    };

    const saveData = async () => {
        setIsSaving(true);
        try {
            const result = await saveAllData(dataToSave);
            if (!result.success) {
                 toast({
                    variant: 'destructive',
                    title: 'Save Failed',
                    description: result.error || 'Could not save changes to the database.',
                });
            }
        } catch (error) {
             toast({
                variant: 'destructive',
                title: 'Save Error',
                description: (error as Error).message,
            });
        } finally {
            setIsSaving(false);
        }
    };

    const timeoutId = setTimeout(saveData, 1500); // Debounce saves
    return () => clearTimeout(timeoutId);

  }, [initialDataLoaded, isLoading, toast, employees, shifts, leave, notes, holidays, tasks, allowances, groups, smtpSettings, tardyRecords, templates, shiftTemplates, leaveTypes, permissions, monthlyEmployeeOrder, faqs, preferredAvl, avlLocks]);

  // Use NextAuth session — replaces localStorage-based auth
  const { data: session, status } = useSession();

  // Load initial data from DB once session is authenticated
  useEffect(() => {
    if (status === 'loading') return;
    if (status === 'unauthenticated') {
        router.push('/login');
        return;
    }
    async function loadData() {
      setIsLoading(true);
      try {
        const result = await getData();

        if (!result) {
          // Should never happen after the fix above, but guard anyway
          toast({ variant: 'destructive', title: 'Session error', description: 'Please refresh the page.' });
          setIsLoading(false);
          return;
        }

        if (result.success && result.data) {
          setEmployees(result.data.employees);
          setShifts(result.data.shifts);
          setLeave(result.data.leave);
          setNotes(result.data.notes);
          setHolidays(result.data.holidays);
          setTasks(result.data.tasks);
          setAllowances(result.data.allowances);
          setGroups(result.data.groups);
          setSmtpSettings(result.data.smtpSettings);
          setTardyRecords(result.data.tardyRecords);
          setShiftTemplates(result.data.shiftTemplates);
          setLeaveTypes(result.data.leaveTypes);
          setTemplates(result.data.templates);
          setPermissions(result.data.permissions);
          setMonthlyEmployeeOrder(result.data.monthlyEmployeeOrder);
          setFaqs(result.data.faqs);
          setPreferredAvl(result.data.preferredAvl);
          setAvlLocks(result.data.avlLocks || {});

          // Set currentUser from DB employees using session user id
          const sessionId = session?.user?.id;
          const userFromDb = result.data.employees.find(emp => emp.id === sessionId);
          if (userFromDb) {
            setCurrentUser(userFromDb);
            setActiveView(userFromDb.role === 'admin' ? 'admin' : 'dashboard');
          } else {
              // Session valid but employee not in DB — force logout
              await signOut({ callbackUrl: '/login' });
              return;
          }
        } else {
          if (result.error === 'Unauthorized') {
            router.push('/login');
            return;
          }
          toast({ variant: 'destructive', title: 'Failed to load data', description: result.error });
        }
      } catch (e) {
        toast({ variant: 'destructive', title: 'Failed to load data', description: 'Please refresh the page.' });
      }
      setIsLoading(false);
      setInitialDataLoaded(true);
    }
    loadData();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, session?.user?.id]);

  // Effect to register Service Worker
    useEffect(() => {
        if ('serviceWorker' in navigator && process.env.NODE_ENV === 'production') {
            window.addEventListener('load', () => {
                navigator.serviceWorker.register('/sw.js').then(
                    (registration) => {
                        console.log('Service Worker registration successful with scope: ', registration.scope);
                    },
                    (err) => {
                        console.log('Service Worker registration failed: ', err);
                    }
                );
            });
        }
    }, []);


  // Effect for sending celebration notifications
    useEffect(() => {
        if (!employees.length || !currentUser) return;

        const today = new Date();
        const storageKey = `celebrations-notified-${format(today, 'yyyy-MM-dd')}`;
        
        const getNotifiedToday = () => {
             if (typeof window === 'undefined') return [];
             return JSON.parse(localStorage.getItem(storageKey) || '[]');
        }
        
        const notifiedToday: string[] = getNotifiedToday();

        const celebrationsToNotify: { employee: Employee; type: 'birthday' | 'anniversary' }[] = [];

        employees.forEach(employee => {
            if (employee.birthDate) {
                const birthDate = new Date(employee.birthDate);
                if (getMonth(birthDate) === getMonth(today) && getDate(birthDate) === getDate(today)) {
                    if (!notifiedToday.includes(`${employee.id}-birthday`)) {
                        celebrationsToNotify.push({ employee, type: 'birthday' });
                    }
                }
            }
            if (employee.startDate) {
                const startDate = new Date(employee.startDate);
                const yearsOfService = differenceInYears(today, startDate);
        
                const isMilestone = yearsOfService >= 5 && yearsOfService % 5 === 0;

                if (isMilestone) {
                    if (getMonth(startDate) === getMonth(today) && getDate(startDate) === getDate(today)) {
                         if (!notifiedToday.includes(`${employee.id}-anniversary`)) {
                            celebrationsToNotify.push({
                                employee,
                                type: 'anniversary',
                            });
                        }
                    }
                }
            }
        });

        if (celebrationsToNotify.length > 0) {
            const newNotified = [...notifiedToday];
            let notificationsAdded = false;

            celebrationsToNotify.forEach(({ employee, type }) => {
                const employeeGroup = employee.group;
                if (!employeeGroup) return;

                const membersInGroup = employees.filter(e => e.group === employeeGroup);
                const message = type === 'birthday'
                    ? `It's ${employee.firstName} ${employee.lastName}'s birthday today! Wish them well.`
                    : `It's ${employee.firstName} ${employee.lastName}'s work anniversary today!`;
                
                membersInGroup.forEach(member => {
                    addNotificationForUser({ message, employeeId: member.id, link: '/celebrations' });
                });
                newNotified.push(`${employee.id}-${type}`);
                notificationsAdded = true;
            });
            
            if (notificationsAdded) {
                 if (typeof window !== 'undefined') {
                    localStorage.setItem(storageKey, JSON.stringify(newNotified));
                }
            }
        }
    }, [employees, addNotificationForUser, currentUser]);

  const approvedLeave = useMemo(() => leave.filter(l => l.status === 'approved'), [leave]);

  const shiftsForView = useMemo(() => {
    if (currentUser?.role === 'member') {
      return shifts.filter(shift => shift.status === 'published');
    }
    return shifts;
  }, [shifts, currentUser]);
  
  const leaveForView = useMemo(() => {
    if (currentUser?.role === 'member') {
        // Members see all approved leave, same as shifts.
        return approvedLeave;
    }
    // Managers and admins see all leave.
    return leave;
  }, [leave, approvedLeave, currentUser]);

  // Only show holidays relevant to the current user's group (or unscoped nulls)
  const holidaysForView = useMemo(() => {
    if (!currentUser) return holidays;
    return holidays.filter(h =>
      h.groupName === null || h.groupName === undefined || h.groupName === currentUser.group
    );
  }, [holidays, currentUser]);


  const handleNavigate = (view: NavItem) => {
    setActiveView(view);
  };
  
  const handleLogout = async () => {
    setCurrentUser(null);
    await signOut({ callbackUrl: '/login' });
  }

  const handleOpenProfileEditor = () => {
    setEditingEmployee(currentUser);
    setIsPasswordResetMode(false);
    setEditorContext(currentUser?.role === 'admin' ? 'admin' : 'manager'); 
    setIsEditorOpen(true);
  }

  const handleOpenPasswordEditor = () => {
    setEditingEmployee(currentUser);
    setIsPasswordResetMode(true);
    setEditorContext('manager');
    setIsEditorOpen(true);
  }

  const handleAddMember = (context: 'admin' | 'manager') => {
    setEditingEmployee({});
    setIsPasswordResetMode(false);
    setEditorContext(context);
    setIsEditorOpen(true);
  };

  const handleEditMember = (employee: Employee, isPasswordReset = false) => {
    setEditingEmployee(employee);
    setIsPasswordResetMode(isPasswordReset);
    setEditorContext(currentUser?.role === 'admin' ? 'admin' : 'manager');
    setIsEditorOpen(true);
  };

  const handleDeleteMember = (employeeId: string) => {
    setEmployees(prev => prev.filter(emp => emp.id !== employeeId));
    // The database's ON DELETE CASCADE will handle associated records.
    // We just need to update the state for other related items if necessary.
    setLeave(prev => prev.filter(l => l.employeeId !== employeeId));
    setShifts(prev => prev.filter(s => s.employeeId !== employeeId));
    setTasks(prev => prev.filter(t => t.assigneeId !== employeeId && t.createdBy !== employeeId));
    setAllowances(prev => prev.filter(a => a.employeeId !== employeeId));

    toast({ title: 'User Removed', description: 'The user and all their associated data have been removed.', variant: 'destructive' });
  };
  
  const handleBatchDeleteMembers = (employeeIds: string[]) => {
    const idsToDelete = new Set(employeeIds);
    setEmployees(prev => prev.filter(emp => !idsToDelete.has(emp.id)));
    
    // Again, rely on CASCADE for DB, just clean up state
    setLeave(prev => prev.filter(l => l.employeeId && !idsToDelete.has(l.employeeId)));
    setShifts(prev => prev.filter(s => s.employeeId && !idsToDelete.has(s.employeeId)));
    setTasks(prev => prev.filter(t => 
        (t.assigneeId && !idsToDelete.has(t.assigneeId)) &&
        !idsToDelete.has(t.createdBy)
    ));
    setAllowances(prev => prev.filter(a => a.employeeId && !idsToDelete.has(a.employeeId)));

    toast({ title: `${employeeIds.length} Users Removed`, description: 'All associated data has been removed.', variant: 'destructive' });
  };


 const handleSaveMember = async (employeeData: Partial<Employee>): Promise<void> => {
    if (employeeData.id) {
      // Update existing employee
      const result = await updateEmployee(employeeData);
      if (result.success && result.employee) {
        const { password: _pw, ...safeEmployee } = result.employee as any;
        setEmployees(prev => prev.map(emp => emp.id === safeEmployee.id ? {...emp, ...safeEmployee} as Employee : emp));
        if (currentUser?.id === safeEmployee.id) {
          setCurrentUser(prev => ({ ...prev!, ...safeEmployee }));
          // No localStorage — session managed by NextAuth httpOnly cookie
        }
        toast({ title: 'Member Updated', description: 'The team member details have been saved.'});
      } else {
        toast({ variant: 'destructive', title: 'Update Failed', description: result.error || 'Unknown error' });
        throw new Error(result.error || 'Update failed');
      }
    } else {
      // Add new employee
      const result = await addEmployee(employeeData);
      if (result.success && result.employee) {
        setEmployees(prev => [...prev, result.employee!]);
        toast({ title: 'Member Added', description: 'The new team member has been created.' });
      } else {
        toast({ variant: 'destructive', title: 'Creation Failed', description: result.error });
      }
    }
  };
  
  const handleImportMembers = async (newMembers: Partial<Employee>[]): Promise<void> => {
    let successCount = 0;
    let errorCount = 0;
    let updatedEmployees = [...employees];

    // Auto-create any groups from the CSV that do not exist yet
    const csvGroups = [...new Set(newMembers.map(m => m.group).filter((g): g is string => !!g))];
    const newGroups = csvGroups.filter(g => !groups.includes(g));
    if (newGroups.length > 0) {
      setGroups(prev => [...prev, ...newGroups]);
    }

    for (const member of newMembers) {
      if (!member.email) {
        console.warn('Skipping member with no email:', member);
        errorCount++;
        continue;
      }
      
      const existingEmployee = updatedEmployees.find(e => e.email.toLowerCase() === member.email!.toLowerCase());
      
      const memberWithId = {
          ...member,
          id: existingEmployee?.id || uuidv4(),
      };

      // Resolve reportsTo ID after all employees are potentially added
      if (typeof member.reportsTo === 'string' && member.reportsTo) {
          const manager = updatedEmployees.find(e => 
              (e.firstName + ' ' + e.lastName).toLowerCase() === member.reportsTo?.toLowerCase() ||
              (e.firstName + ' ' + e.middleInitial + ' ' + e.lastName).toLowerCase() === member.reportsTo?.toLowerCase()
          );
          if (manager) {
              memberWithId.reportsTo = manager.id;
          } else {
              console.warn(`Manager "${member.reportsTo}" not found for employee "${member.firstName} ${member.lastName}". Setting reportsTo to null.`);
              memberWithId.reportsTo = null;
          }
      }

      if (existingEmployee) {
        // Update existing employee
        const result = await updateEmployee({ ...existingEmployee, ...memberWithId });
        if (result.success && result.employee) {
            updatedEmployees = updatedEmployees.map(emp => emp.id === result.employee!.id ? {...emp, ...result.employee} as Employee : emp);
            successCount++;
        } else {
            console.error(`Failed to update imported member ${member.email}:`, result.error);
            errorCount++;
        }
      } else {
        // Add new employee
        const result = await addEmployee(memberWithId);
        if (result.success && result.employee) {
            updatedEmployees.push(result.employee);
            successCount++;
        } else {
             console.error(`Failed to add imported member ${member.email}:`, result.error);
            errorCount++;
        }
      }
    }
    
    setEmployees(updatedEmployees);

    toast({
      title: 'Import Complete',
      description: `${successCount} member(s) processed successfully. ${errorCount > 0 ? `${errorCount} failed.` : ''}`
    });
  };

  const handleImportHolidays = (newHolidays: Partial<Holiday>[]) => {
      const holidaysWithIds: Holiday[] = newHolidays.map((holiday) => ({
        ...holiday,
        id: uuidv4(),
        groupName: currentUser?.group ?? null,
      } as Holiday));

      setHolidays(prev => [...prev, ...holidaysWithIds]);
      toast({ title: 'Import Successful', description: `${holidaysWithIds.length} new holidays added.`})
  }
  
  const handleSaveShift = (savedShift: ShiftWithRepeat) => {
    const isEditing = !!savedShift.id;
    const employee = employees.find(e => e.id === savedShift.employeeId);
    const employeeName = employee ? getFullName(employee) : 'Unassigned';

    if (isEditing) {
        setShifts(shifts.map(s => s.id === savedShift.id ? { ...s, ...savedShift, status: 'draft' } as Shift : s));
        addNotification({ message: `Shift for ${employeeName} on ${format(savedShift.date, 'MMM d')} was updated.` });
    } else {
        const newShifts: Shift[] = [];
        const baseShift: Omit<Shift, 'id' | 'date'> = {
            employeeId: savedShift.employeeId,
            label: savedShift.label!,
            startTime: savedShift.startTime!,
            endTime: savedShift.endTime!,
            color: savedShift.color,
            isDayOff: savedShift.isDayOff,
            isHolidayOff: savedShift.isHolidayOff,
            status: 'draft',
            breakStartTime: savedShift.breakStartTime,
            breakEndTime: savedShift.breakEndTime,
            isUnpaidBreak: savedShift.isUnpaidBreak,
        };

        if (savedShift.repeat) {
            let dates: Date[] = [];
            if (savedShift.repeatType === 'occurrences' && savedShift.repeatOccurrences) {
                for (let i = 0; i < savedShift.repeatOccurrences; i++) {
                    dates.push(addDays(savedShift.date, i));
                }
            } else if (savedShift.repeatType === 'untilDate' && savedShift.repeatUntil) {
                let currentDate = savedShift.date;
                while (isBefore(currentDate, savedShift.repeatUntil) || isSameDay(currentDate, savedShift.repeatUntil)) {
                    dates.push(currentDate);
                    currentDate = addDays(currentDate, 1);
                }
            }
            dates.forEach(date => {
                newShifts.push({ ...baseShift, id: uuidv4(), date });
            });
        } else {
            newShifts.push({ ...baseShift, id: uuidv4(), date: savedShift.date });
        }
        
        if (newShifts.length > 0) {
            setShifts(prev => [...prev, ...newShifts]);
            const notificationMessage = newShifts.length > 1 
                ? `${newShifts.length} shifts created for ${employeeName}.`
                : `New shift created for ${employeeName} on ${format(savedShift.date, 'MMM d')}.`;
            addNotification({ message: notificationMessage });
        }
    }
  };

  const handlePublish = () => {
    setShifts(currentShifts => 
        currentShifts.map(shift => ({...shift, status: 'published' }))
    );
    addNotification({ message: 'The schedule has been published.' });
    toast({ title: "Schedule Published!", description: "All shifts are now marked as published." });
  };
  
  const handleEditNote = (note: Partial<Note>) => {
    setEditingNote(note);
    setIsNoteEditorOpen(true);
  };
  
  const handleSaveNote = (savedNote: Note | Partial<Note>) => {
    if (currentUser?.role === 'member') return;
    if (savedNote.id) {
        setNotes(notes.map(n => n.id === savedNote.id ? savedNote as Note : n));
        toast({ title: 'Note Updated' });
    } else {
        const newNoteWithId = { ...savedNote, id: uuidv4() } as Note;
        setNotes([...notes, newNoteWithId]);
        toast({ title: 'Note Added' });
    }
    setIsNoteEditorOpen(false);
    setEditingNote(null);
  };

  const handleDeleteNote = (noteId: string) => {
    if (currentUser?.role === 'member') return;
    setNotes(notes.filter(n => n.id !== noteId));
    setIsNoteEditorOpen(false);
    setEditingNote(null);
    toast({ title: 'Note Deleted', variant: 'destructive' });
  };
  
  const handlePurgeData = (dataType: 'users' | 'shiftTemplates' | 'holidays' | 'reportTemplates' | 'tasks' | 'mobileLoad' | 'leaveTypes' | 'groups' | 'shifts') => {
        switch (dataType) {
            case 'users':
                const adminUser = employees.find(e => e.id === 'emp-admin-01');
                setEmployees(adminUser ? [adminUser] : []);
                setShifts([]);
                setLeave([]);
                setTasks([]);
                setAllowances([]);
                setTardyRecords([]);
                break;
            case 'shiftTemplates':
                setShiftTemplates([]);
                break;
            case 'holidays':
                setHolidays([]);
                break;
            case 'reportTemplates':
                setTemplates({});
                break;
            case 'tasks':
                setTasks([]);
                break;
            case 'mobileLoad':
                setAllowances([]);
                setEmployees(prev => prev.map(e => ({ ...e, loadAllocation: 0 })));
                break;
            case 'leaveTypes':
                setLeaveTypes([]);
                break;
            case 'groups':
                setGroups([]);
                break;
            case 'shifts':
                setShifts([]);
                break;
        }
    };



  const currentView = useMemo(() => {
    if (!initialDataLoaded || !currentUser) {
        return (
             <Card>
                <CardHeader>
                    <CardTitle>Loading...</CardTitle>
                </CardHeader>
                <CardContent>
                    <p>Loading application data. Please wait...</p>
                </CardContent>
            </Card>
        )
    }

    const membersOfMyGroup = employees.filter(e => e.group === currentUser.group);
    
    const userPermissions = permissions[currentUser.role] || [];
    // Admins have all permissions, non-admins must have the view explicitly granted
    const hasPermission = currentUser.role === 'admin' || userPermissions.includes(activeView)

    if (!hasPermission) {
         return (
             <Card>
                <CardHeader>
                    <CardTitle>Access Denied</CardTitle>
                </CardHeader>
                <CardContent>
                    <p>You do not have permission to view this page. Please contact an administrator.</p>
                </CardContent>
            </Card>
        )
    }


    switch (activeView) {
      case 'dashboard':
        return <DashboardView onNavigate={handleNavigate} permissions={permissions} role={currentUser.role} currentUser={currentUser} />;
      case 'schedule': {
        const scheduleEmployees = (currentUser.role === 'admin' ? employees : membersOfMyGroup).filter(e => e.role !== 'admin');
        
        return (
          <ScheduleView 
            employees={scheduleEmployees}
            setEmployees={setEmployees}
            shifts={shiftsForView}
            setShifts={setShifts}
            leave={leaveForView}
            setLeave={setLeave}
            notes={notes}
            setNotes={setNotes}
            holidays={holidaysForView}
            setHolidays={setHolidays}
            tasks={tasks}
            setTasks={setTasks}
            currentUser={currentUser}
            onPublish={handlePublish}
            addNotification={addNotification}
            onViewNote={(note) => {
              setViewingNote(note);
              setIsNoteViewerOpen(true);
            }}
            onEditNote={handleEditNote}
            onManageHolidays={() => setIsHolidayEditorOpen(true)}
            smtpSettings={smtpSettings}
            shiftTemplates={shiftTemplates}
            setShiftTemplates={setShiftTemplates}
            leaveTypes={leaveTypes}
            monthlyEmployeeOrder={monthlyEmployeeOrder}
            setMonthlyEmployeeOrder={setMonthlyEmployeeOrder}
          />
        );
      }
      case 'team': {
        const teamEmployees = employees.filter(emp => emp.role !== 'admin' && emp.group === currentUser.group);
        return <TeamView employees={teamEmployees} currentUser={currentUser} onEditMember={handleEditMember} />;
      }
      case 'onduty':
        return <OndutyView employees={membersOfMyGroup} shifts={shifts} currentUser={currentUser} />;
       case 'org-chart':
        return <OrgChartView employees={membersOfMyGroup} currentUser={currentUser} />;
      case 'celebrations':
        return <CelebrationsView employees={employees} />;
      case 'holidays':
        return <HolidaysView 
                  holidays={holidaysForView} 
                  isManager={currentUser.role === 'manager' || currentUser.role === 'admin'}
                  onManageHolidays={() => setIsHolidayEditorOpen(true)}
                />;
       case 'time-off':
        return <TimeOffView
                  leaveRequests={leave}
                  setLeaveRequests={setLeave}
                  shifts={shifts}
                  setShifts={setShifts}
                  currentUser={currentUser}
                  employees={employees}
                  leaveTypes={leaveTypes}
                  smtpSettings={smtpSettings}
               />;
        case 'avl-management':
          return <AvlManagementView
                  currentUser={currentUser}
                  employees={employees}
                  setEmployees={setEmployees}
                  preferredAvl={preferredAvl}
                  setPreferredAvl={setPreferredAvl}
                  avlLocks={avlLocks}
                  setAvlLocks={setAvlLocks}
                />;
        case 'work-extensions':
        return <WorkExtensionsView
                  leaveRequests={leave}
                  setLeaveRequests={setLeave}
                  currentUser={currentUser}
                  employees={employees}
                  smtpSettings={smtpSettings}
                />;
      case 'allowance':
        return <AllowanceView 
                  employees={employees}
                  setEmployees={setEmployees}
                  allowances={allowances} 
                  setAllowances={setAllowances} 
                  currentUser={currentUser} 
                  smtpSettings={smtpSettings}
               />;
      case 'my-schedule':
        return <MyScheduleView shifts={shiftsForView} employeeId={currentUser.id} employees={employees} />;
      case 'my-tasks':
        return <MyTasksView tasks={tasks} setTasks={setTasks} shifts={shifts} currentUser={currentUser} />;
      case 'task-manager':
        return <TaskManagerView tasks={tasks} setTasks={setTasks} currentUser={currentUser} employees={employees} />;
      case 'faq':
        return <FaqView faqs={faqs} setFaqs={setFaqs} currentUser={currentUser} />;
      case 'reports':
          return <ReportsView 
                    employees={employees} 
                    shifts={shifts} 
                    leave={leave} 
                    holidays={holidaysForView} 
                    currentUser={currentUser} 
                    tardyRecords={tardyRecords}
                    setTardyRecords={setTardyRecords}
                    templates={templates}
                    setTemplates={setTemplates}
                    shiftTemplates={shiftTemplates}
                    leaveTypes={leaveTypes}
                    permissions={permissions}
                    smtpSettings={smtpSettings}
                  />;
      case 'admin':
        return (
            <AdminPanel 
                users={employees} 
                setUsers={setEmployees}
                groups={groups}
                onAddMember={() => handleAddMember('admin')}
                onEditMember={handleEditMember}
                onDeleteMember={handleDeleteMember}
                onBatchDelete={handleBatchDeleteMembers}
                onImportMembers={() => setIsImporterOpen(true)}
                onManageGroups={() => setIsGroupEditorOpen(true)}
                smtpSettings={smtpSettings}
                shiftTemplates={shiftTemplates}
                setShiftTemplates={setShiftTemplates}
                leaveTypes={leaveTypes}
                setLeaveTypes={setLeaveTypes}
                templates={templates}
                setTemplates={setTemplates}
            />
        );
      case 'templates':
        return <TemplatesView
          templates={templates}
          setTemplates={setTemplates}
          groups={groups}
          shiftTemplates={shiftTemplates}
          setShiftTemplates={setShiftTemplates}
          leaveTypes={leaveTypes}
          setLeaveTypes={setLeaveTypes}
        />;
       case 'permissions':
        return <PermissionsEditor permissions={permissions} setPermissions={setPermissions} />;
      case 'smtp-settings':
        return <SmtpSettingsView settings={smtpSettings} onSave={setSmtpSettings} />;
      case 'danger-zone':
        return <DangerZoneView onPurgeData={handlePurgeData} />;
      case 'api-docs':
        return <ApiDocsView />;
      case 'audit-logs':
        return <AuditLogsView />;
      default:
        return (
            <Card>
                <CardHeader>
                    <CardTitle>Welcome to OnDuty</CardTitle>
                    <CardDescription>Select a view from the sidebar to get started.</CardDescription>
                </CardHeader>
                <CardContent>
                    <p>You are currently logged in as {currentUser.firstName}.</p>
                </CardContent>
            </Card>
        );
    }
  }, [activeView, employees, shifts, leave, notes, holidays, tasks, allowances, smtpSettings, tardyRecords, templates, shiftTemplates, leaveForView, currentUser, groups, shiftsForView, addNotification, router, toast, initialDataLoaded, leaveTypes, permissions, monthlyEmployeeOrder, faqs, preferredAvl, avlLocks]);

  if (!initialDataLoaded || !currentUser) {
      return (
        <div className="flex h-screen w-full items-center justify-center">
            <p>Loading...</p>
        </div>
      );
  }

  const userNotifications = notifications.filter(n => !n.employeeId || n.employeeId === currentUser.id);
  const role = currentUser.role || 'member';

  return (
    <>
    <div className='flex h-screen w-full'>
      <Sidebar>
        <SidebarNav role={role} permissions={permissions} activeView={activeView} onNavigate={handleNavigate} />
      </Sidebar>
      <div className="flex flex-col flex-1 overflow-hidden">
        <Header 
          currentUser={currentUser} 
          onLogout={handleLogout} 
          onEditProfile={handleOpenProfileEditor} 
          onResetPassword={handleOpenPasswordEditor}
          notifications={userNotifications}
          setNotifications={setNotifications}
          onNavigate={handleNavigate}
        />
        <main className="flex-1 overflow-auto p-4 md:p-6 lg:p-8">
            {currentView}
        </main>
      </div>
    </div>
    
    <TeamEditor
        isOpen={isEditorOpen}
        setIsOpen={setIsEditorOpen}
        employee={editingEmployee}
        onSave={handleSaveMember}
        isPasswordResetMode={isPasswordResetMode}
        context={editorContext}
        groups={groups}
        setGroups={setGroups}
        employees={employees}
        shiftTemplates={shiftTemplates}
        smtpSettings={smtpSettings}
    />
    <MemberImporter
        isOpen={isImporterOpen}
        setIsOpen={setIsImporterOpen}
        onImport={handleImportMembers}
        employees={employees}
    />
    <GroupEditor
        isOpen={isGroupEditorOpen}
        setIsOpen={setIsGroupEditorOpen}
        groups={groups}
        setGroups={setGroups}
    />
     <HolidayEditor
        isOpen={isHolidayEditorOpen}
        setIsOpen={setIsHolidayEditorOpen}
        holidays={holidays}
        setHolidays={setHolidays}
        onImport={() => setIsHolidayImporterOpen(true)}
        currentUser={currentUser}
    />
    <HolidayImporter
        isOpen={isHolidayImporterOpen}
        setIsOpen={setIsHolidayImporterOpen}
        onImport={handleImportHolidays}
    />
    <NoteEditor
        isOpen={isNoteEditorOpen}
        setIsOpen={setIsNoteEditorOpen}
        note={editingNote}
        onSave={handleSaveNote}
        onDelete={handleDeleteNote}
    />
    {viewingNote && (
        <NoteViewer
            isOpen={isNoteViewerOpen}
            setIsOpen={setIsNoteViewerOpen}
            note={viewingNote}
            isManager={currentUser.role === 'manager' || currentUser.role === 'admin'}
            onEdit={(note) => {
                if ('description' in note) {
                    setIsNoteViewerOpen(false);
                    handleEditNote(note);
                }
            }}
        />
    )}

    </>
  );
}

export default function Home() {
  return (
    <SidebarProvider defaultOpen={false}>
      <AppContent />
    </SidebarProvider>
  );
}
