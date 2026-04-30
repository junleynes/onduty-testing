
'use server';

import { getDb } from './db';
import type { Employee, Shift, Leave, Note, Holiday, Task, CommunicationAllowance, SmtpSettings, AppVisibility, TardyRecord, RolePermissions, NavItemKey, FaqItem } from '@/types';
import type { ShiftTemplate } from '@/components/shift-editor';
import type { LeaveTypeOption } from '@/components/leave-type-editor';

function safeParseJSON(jsonString: string | null | undefined, defaultValue: any) {
  if (!jsonString) return defaultValue;
  try {
    return JSON.parse(jsonString);
  } catch (e) {
    return defaultValue;
  }
}

export async function getData() {
  const db = getDb();
  try {
    const employees = db.prepare('SELECT * FROM employees').all() as any[];
    const shifts = db.prepare('SELECT * FROM shifts').all() as any[];
    const leave = db.prepare('SELECT * FROM leave').all() as any[];
    const notes = db.prepare('SELECT * FROM notes').all() as any[];
    const holidays = db.prepare('SELECT * FROM holidays').all() as any[];
    const tasks = db.prepare('SELECT * FROM tasks').all() as any[];
    const allowances = db.prepare('SELECT * FROM communication_allowances').all() as any[];
    const groups = db.prepare('SELECT name FROM groups').all().map((g: any) => g.name) as string[];
    const smtpSettings: SmtpSettings = db.prepare('SELECT * FROM smtp_settings WHERE id = 1').get() as any || {};
    const tardyRecords = db.prepare('SELECT * FROM tardy_records').all() as any[];
    
    const shiftTemplates = db.prepare('SELECT * FROM shift_templates').all() as any[];
    let leaveTypes = db.prepare('SELECT * FROM leave_types').all() as any[];
    
    // Seed default leave types if empty
    if (leaveTypes.length === 0) {
        const defaults: LeaveTypeOption[] = [
            { type: 'AVL', color: '#14b8a6' },
            { type: 'VL', color: '#3b82f6' },
            { type: 'SL', color: '#ef4444' },
            { type: 'EL', color: '#f59e0b' },
            { type: 'CTO', color: '#10b981' },
            { type: 'OFFSET', color: '#8b5cf6' },
            { type: 'TARDY', color: '#6b7280' },
        ];
        const insertStmt = db.prepare('INSERT INTO leave_types (type, color) VALUES (?, ?)');
        defaults.forEach(d => insertStmt.run(d.type, d.color));
        leaveTypes = defaults;
    }

    const keyValuePairs = db.prepare('SELECT * FROM key_value_store').all() as {key: string, value: string}[];
    const templates = keyValuePairs.reduce((acc, { key, value }) => {
        acc[key] = value;
        return acc;
    }, {} as Record<string, string | null>);
    
    const permissionsData = db.prepare('SELECT * FROM permissions').all() as { role: 'admin' | 'manager' | 'member', allowed_views: string }[];
    const permissions: RolePermissions = permissionsData.reduce((acc, { role, allowed_views }) => {
        acc[role] = JSON.parse(allowed_views);
        return acc;
    }, { admin: [], manager: [], member: [] } as RolePermissions);

    const monthlyOrderData = db.prepare("SELECT value FROM key_value_store WHERE key = 'monthlyEmployeeOrder'").get() as { value: string } | undefined;
    const monthlyEmployeeOrder = monthlyOrderData ? JSON.parse(monthlyOrderData.value) : {};

    const faqData = db.prepare("SELECT value FROM key_value_store WHERE key = 'faqs'").get() as { value: string } | undefined;
    const faqs: FaqItem[] = faqData ? JSON.parse(faqData.value) : [
      { id: '1', question: 'What do the leave type codes stand for?', answer: 'Common leave codes include:\n- AVL: Annual Vacation Leave (Yearly allotted pool)\n- VL: Vacation Leave (General)\n- SL: Sick Leave\n- EL: Emergency Leave\n- CTO: Compensatory Time Off (earned overtime used as leave)\n- OFFSET: Claiming an approved Work Extension\n- TARDY: Filing for specific instances of tardiness.' },
      { id: '2', question: 'How do I request time off?', answer: 'Navigate to the "Time Off" section from the sidebar. Click the "New Request" button, fill in the required details such as leave type and dates, and submit your request. Your manager will be notified to review it.' },
      { id: '3', question: 'Where can I see my schedule for the upcoming week?', answer: 'You can view your personal schedule by clicking on "My Schedule" in the sidebar. This will show you all your assigned shifts for the selected period.' },
    ];


    const processedEmployees: Employee[] = employees.map(e => ({
      ...e,
      birthDate: e.birthDate ? new Date(e.birthDate) : undefined,
      startDate: e.startDate ? new Date(e.startDate) : undefined,
      lastPromotionDate: e.lastPromotionDate ? new Date(e.lastPromotionDate) : undefined,
      visibility: safeParseJSON(e.visibility, {
        schedule: true,
        onDuty: true,
        orgChart: true,
        mobileLoad: true,
      }) as AppVisibility
    }));

    const processedShifts: Shift[] = shifts.map(s => ({
      ...s,
      date: new Date(s.date),
      isDayOff: s.isDayOff === 1,
      isHolidayOff: s.isHolidayOff === 1,
      isUnpaidBreak: s.isUnpaidBreak === 1,
    }));
    
    const processedLeave: Leave[] = leave.map((l: any) => ({
      ...l,
      startDate: new Date(l.startDate),
      endDate: new Date(l.endDate),
      isAllDay: l.isAllDay === 1,
      requestedAt: l.requestedAt ? new Date(l.requestedAt) : undefined,
      managedAt: l.managedAt ? new Date(l.managedAt) : undefined,
      originalShiftDate: l.originalShiftDate ? new Date(l.originalShiftDate) : undefined,
      dateFiled: l.dateFiled ? new Date(l.dateFiled) : new Date(),
    }));
    
    const processedNotes: Note[] = notes.map(n => ({
      ...n,
      date: new Date(n.date),
    }));

    const processedHolidays: Holiday[] = holidays.map(h => ({
      ...h,
      date: new Date(h.date),
    }));

    const processedTasks: Task[] = tasks.map(t => ({
      ...t,
      acknowledgedAt: t.acknowledgedAt ? new Date(t.acknowledgedAt) : undefined,
      completedAt: t.completedAt ? new Date(t.completedAt) : undefined,
      dueDate: t.dueDate ? new Date(t.dueDate) : undefined,
    }));
    
    const processedAllowances: CommunicationAllowance[] = allowances.map(a => ({
        ...a,
        asOfDate: a.asOfDate ? new Date(a.asOfDate) : undefined,
    }));
    
    const processedShiftTemplates: ShiftTemplate[] = shiftTemplates.map(t => ({
        ...t,
        id: t.id ?? `tpl-${Math.random()}`,
        isUnpaidBreak: t.isUnpaidBreak === 1,
    }));

    const processedTardyRecords: TardyRecord[] = tardyRecords.map(t => ({
        ...t,
        date: new Date(t.date),
    }));

    if (processedEmployees.length === 0) {
        const adminUser: Employee = {
            id: "emp-admin-01",
            employeeNumber: "001",
            firstName: "Super",
            lastName: "Admin",
            email: "admin@onduty.local",
            phone: "123-456-7890",
            position: "System Administrator",
            role: "admin",
            group: "Administration"
        };
        processedEmployees.push(adminUser);
    }


    return {
      success: true,
      data: {
        employees: processedEmployees,
        shifts: processedShifts,
        leave: processedLeave,
        notes: processedNotes,
        holidays: processedHolidays,
        tasks: processedTasks,
        allowances: processedAllowances,
        groups,
        smtpSettings,
        tardyRecords: processedTardyRecords,
        templates,
        shiftTemplates: processedShiftTemplates,
        leaveTypes,
        permissions,
        monthlyEmployeeOrder,
        faqs,
      }
    };
  } catch (error) {
    console.error('Failed to fetch data:', error);
    return { success: false, error: (error as Error).message };
  }
}


export async function saveAllData({
  employees,
  shifts,
  leave,
  notes,
  holidays,
  tasks,
  allowances,
  groups,
  smtpSettings,
  tardyRecords,
  templates,
  shiftTemplates,
  leaveTypes,
  permissions,
  monthlyEmployeeOrder,
  faqs,
}: {
  employees: Employee[];
  shifts: Shift[];
  leave: Leave[];
  notes: Note[];
  holidays: Holiday[];
  tasks: Task[];
  allowances: CommunicationAllowance[];
  groups: string[];
  smtpSettings: SmtpSettings;
  tardyRecords: TardyRecord[];
  templates: Record<string, string | null>;
  shiftTemplates: ShiftTemplate[];
  leaveTypes: LeaveTypeOption[];
  permissions: RolePermissions;
  monthlyEmployeeOrder: Record<string, string[]>;
  faqs: FaqItem[];
}): Promise<{ success: boolean; error?: string }> {
  const db = getDb();
  
  const saveTransaction = db.transaction(() => {
    // 1. Disable FK checks to prevent ordering issues during mass replacement
    db.prepare('PRAGMA foreign_keys = OFF').run();

    try {
        // 2. Clear core data
        db.prepare('DELETE FROM communication_allowances').run();
        db.prepare('DELETE FROM tasks').run();
        db.prepare('DELETE FROM shifts').run();
        db.prepare('DELETE FROM leave').run();
        db.prepare('DELETE FROM notes').run();
        db.prepare('DELETE FROM holidays').run();
        db.prepare('DELETE FROM tardy_records').run();
        db.prepare('DELETE FROM shift_templates').run();
        db.prepare('DELETE FROM leave_types').run();
        
        // --- EMPLOYEES ---
        const allDbEmployeeIds = new Set(db.prepare('SELECT id from employees').all().map((row: any) => row.id));
        const employeeIdsInState = new Set(employees.map(e => e.id));
        const employeesToDelete = [...allDbEmployeeIds].filter(id => !employeeIdsInState.has(id) && id !== 'emp-admin-01');
        if (employeesToDelete.length > 0) {
            const deleteStmt = db.prepare(`DELETE FROM employees WHERE id IN (${employeesToDelete.map(() => '?').join(',')})`);
            deleteStmt.run(...employeesToDelete);
        }
        
        // --- GROUPS ---
        const dbGroups = new Set(db.prepare('SELECT name FROM groups').all().map((g: any) => g.name));
        const stateGroups = new Set(groups);
        const groupsToAdd = [...stateGroups].filter(g => !dbGroups.has(g));
        const groupsToDelete = [...dbGroups].filter(g => !stateGroups.has(g));

        if (groupsToAdd.length > 0) {
            const insertStmt = db.prepare('INSERT INTO groups (name) VALUES (?)');
            groupsToAdd.forEach(g => insertStmt.run(g));
        }
        if (groupsToDelete.length > 0) {
            const updateEmployeesStmt = db.prepare('UPDATE employees SET "group" = NULL WHERE "group" = ?');
            groupsToDelete.forEach(g => updateEmployeesStmt.run(g));
            const deleteGroupStmt = db.prepare('DELETE FROM groups WHERE name = ?');
            groupsToDelete.forEach(g => deleteGroupStmt.run(g));
        }
        
        // --- SHIFTS ---
        const shiftStmt = db.prepare('INSERT INTO shifts (id, employeeId, label, startTime, endTime, date, color, isDayOff, isHolidayOff, status, breakStartTime, breakEndTime, isUnpaidBreak) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
        for(const shift of shifts) {
            shiftStmt.run(shift.id, shift.employeeId, shift.label, shift.startTime, shift.endTime, new Date(shift.date).toISOString().split('T')[0], shift.color, shift.isDayOff ? 1 : 0, shift.isHolidayOff ? 1 : 0, shift.status, shift.breakStartTime, shift.breakEndTime, shift.isUnpaidBreak ? 1 : 0);
        }

        // --- LEAVE ---
        const leaveInsertStmt = db.prepare(`
        INSERT INTO leave (id, employeeId, type, color, startDate, endDate, isAllDay, startTime, endTime, status, reason, requestedAt, managedBy, managedAt, originalShiftDate, originalStartTime, originalEndTime, dateFiled, department, idNumber, contactInfo, employeeSignature, managerSignature, pdfDataUri, workExtensionStatus, claimedWorkExtensionId) 
        VALUES (@id, @employeeId, @type, @color, @startDate, @endDate, @isAllDay, @startTime, @endTime, @status, @reason, @requestedAt, @managedBy, @managedAt, @originalShiftDate, @originalStartTime, @originalEndTime, @dateFiled, @department, @idNumber, @contactInfo, @employeeSignature, @managerSignature, @pdfDataUri, @workExtensionStatus, @claimedWorkExtensionId)
        `);
        
        for(const l of leave) {
            leaveInsertStmt.run({
                id: l.id,
                employeeId: l.employeeId,
                type: l.type,
                color: l.color,
                startDate: new Date(l.startDate).toISOString(),
                endDate: new Date(l.endDate || l.startDate).toISOString(),
                isAllDay: l.isAllDay ? 1 : 0, 
                startTime: l.startTime, 
                endTime: l.endTime, 
                status: l.status, 
                reason: l.reason, 
                requestedAt: l.requestedAt?.toISOString(), 
                managedBy: l.managedBy, 
                managedAt: l.managedAt?.toISOString(),
                originalShiftDate: l.originalShiftDate?.toISOString(),
                originalStartTime: l.originalStartTime,
                originalEndTime: l.originalEndTime,
                dateFiled: l.dateFiled?.toISOString(),
                department: l.department,
                idNumber: l.idNumber,
                contactInfo: l.contactInfo,
                employeeSignature: l.employeeSignature,
                managerSignature: l.managerSignature,
                pdfDataUri: l.pdfDataUri,
                workExtensionStatus: l.workExtensionStatus || null,
                claimedWorkExtensionId: l.claimedWorkExtensionId || null
            });
        }

        // --- NOTES ---
        const noteStmt = db.prepare('INSERT INTO notes (id, date, title, description) VALUES (?, ?, ?, ?)');
        notes.forEach(note => {
            noteStmt.run(note.id, new Date(note.date).toISOString().split('T')[0], note.title, note.description);
        });

        // --- HOLIDAYS ---
        const holidayInsertStmt = db.prepare('INSERT INTO holidays (id, date, title) VALUES (@id, @date, @title)');
        for(const holiday of holidays) {
            holidayInsertStmt.run({id: holiday.id, date: new Date(holiday.date).toISOString().split('T')[0], title: holiday.title});
        }

        // --- TASKS ---
        const taskStmt = db.prepare('INSERT INTO tasks (id, shiftId, assigneeId, scope, title, description, status, acknowledgedAt, completedAt, dueDate, createdBy) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
        for(const task of tasks) {
            taskStmt.run(task.id, task.shiftId, task.assigneeId, task.scope, task.title, task.description, task.status, task.acknowledgedAt?.toISOString(), task.completedAt?.toISOString(), task.dueDate?.toISOString(), task.createdBy);
        }

        // --- ALLOWANCES ---
        const allowanceStmt = db.prepare('INSERT INTO communication_allowances (id, employeeId, year, month, balance, asOfDate, screenshot) VALUES (?, ?, ?, ?, ?, ?, ?)');
        for(const allowance of allowances) {
            allowanceStmt.run(allowance.id, allowance.employeeId, allowance.year, allowance.month, allowance.balance, allowance.asOfDate ? new Date(allowance.asOfDate).toISOString() : null, allowance.screenshot);
        }
        
        // --- SMTP SETTINGS ---
        if (smtpSettings && smtpSettings.host) {
            const smtpStmt = db.prepare(`
            INSERT INTO smtp_settings (id, host, port, secure, user, pass, fromEmail, fromName)
            VALUES (1, @host, @port, @secure, @user, @pass, @fromEmail, @fromName)
            ON CONFLICT(id) DO UPDATE SET
                host=excluded.host, port=excluded.port, secure=excluded.secure, user=excluded.user,
                pass=excluded.pass, fromEmail=excluded.fromEmail, fromName=excluded.fromName
            `);
            smtpStmt.run({ 
                host: smtpSettings.host,
                port: smtpSettings.port,
                secure: smtpSettings.secure ? 1 : 0,
                user: smtpSettings.user || null,
                pass: smtpSettings.pass || null,
                fromEmail: smtpSettings.fromEmail,
                fromName: smtpSettings.fromName
            });
        }

        // --- TARDY RECORDS ---
        const tardyStmt = db.prepare('INSERT INTO tardy_records (employeeId, employeeName, date, schedule, timeIn, timeOut, remarks) VALUES (?, ?, ?, ?, ?, ?, ?)');
        for(const record of tardyRecords) {
            tardyStmt.run(record.employeeId, record.employeeName, new Date(record.date).toISOString().split('T')[0], record.schedule, record.timeIn, record.timeOut, record.remarks);
        }
        
        // --- SHIFT TEMPLATES ---
        const shiftTemplateInsertStmt = db.prepare('INSERT INTO shift_templates (id, name, label, startTime, endTime, color, breakStartTime, breakEndTime, isUnpaidBreak) VALUES (@id, @name, @label, @startTime, @endTime, @color, @breakStartTime, @breakEndTime, @isUnpaidBreak)');
        for(const tpl of shiftTemplates) {
            shiftTemplateInsertStmt.run({
                id: tpl.id,
                name: tpl.name,
                label: tpl.label,
                startTime: tpl.startTime,
                endTime: tpl.endTime,
                color: tpl.color,
                breakStartTime: tpl.breakStartTime || null,
                breakEndTime: tpl.breakEndTime || null,
                isUnpaidBreak: tpl.isUnpaidBreak ? 1 : 0
            });
        }

        // --- LEAVE TYPES ---
        const leaveTypeInsertStmt = db.prepare('INSERT INTO leave_types (type, color) VALUES (@type, @color)');
        for(const lt of leaveTypes) {
            leaveTypeInsertStmt.run({
                type: lt.type,
                color: lt.color
            });
        }

        // --- KEY-VALUE STORE ---
        const templateStmt = db.prepare('INSERT INTO key_value_store (key, value) VALUES (@key, @value) ON CONFLICT(key) DO UPDATE SET value=excluded.value');
        for(const [key, value] of Object.entries(templates)) {
            if (value) {
                templateStmt.run({ key, value });
            }
        }
        templateStmt.run({ key: 'monthlyEmployeeOrder', value: JSON.stringify(monthlyEmployeeOrder) });
        templateStmt.run({ key: 'faqs', value: JSON.stringify(faqs) });
        
        // --- PERMISSIONS ---
        const permissionsStmt = db.prepare('INSERT INTO permissions (role, allowed_views) VALUES (@role, @allowed_views) ON CONFLICT(role) DO UPDATE SET allowed_views=excluded.allowed_views');
        for (const [role, allowed_views] of Object.entries(permissions)) {
            permissionsStmt.run({ role, allowed_views: JSON.stringify(allowed_views) });
        }

    } finally {
        // 3. Re-enable FK checks
        db.prepare('PRAGMA foreign_keys = ON').run();
    }
  });

  try {
    saveTransaction();
    return { success: true };
  } catch (error) {
    console.error('Failed to save data:', error);
    return { success: false, error: (error as Error).message };
  }
}
