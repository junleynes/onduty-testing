
'use server';

import { getDb } from './db';
import type { Employee, Shift, Leave, Note, Holiday, Task, CommunicationAllowance, SmtpSettings, AppVisibility, TardyRecord, RolePermissions, NavItemKey, FaqItem, PreferredAvl } from '@/types';
import { readAvatar, readSignature, ensureUploadDirs } from '@/lib/file-storage';
import { requireAuth } from '@/lib/auth-guard';
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

/**
 * Formats a Date to a local YYYY-MM-DD string WITHOUT converting to UTC first.
 * Using toISOString().split('T')[0] incorrectly converts to UTC, which shifts
 * the date back by one day for timezones east of UTC (e.g. UTC+8 Philippines).
 * This function always uses the local calendar date as the user intended.
 */
function toLocalDateString(date: Date | string | undefined | null): string {
  if (!date) return '';
  const d = date instanceof Date ? date : new Date(date);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export async function getData() {
  // Middleware already protects this route — but guard here too so errors
  // return { success: false } instead of throwing and making result undefined
  try { await requireAuth(); } catch (e) {
    return { success: false, error: 'Unauthorized', data: undefined };
  }
  const db = getDb();
  try {
    // Exclude large binary columns (avatar, signature, screenshot, pdfDataUri,
    // employeeSignature, managerSignature) from the bulk load — these are fetched
    // individually only when needed, keeping the page load payload small and fast.
    const employees = db.prepare(`
        SELECT id, employeeNumber, firstName, lastName, middleInitial, email, phone,
               position, role, "group", birthDate, startDate, loadAllocation,
               visibility, lastPromotionDate, reportsTo, gender, employeeClassification,
               personnelNumber, avlAllotted, avlBeginningBalance, workScheduleType,
               defaultShiftTemplateId, department
        FROM employees
    `).all() as any[];

    const shifts = db.prepare('SELECT * FROM shifts').all() as any[];

    const leave = db.prepare(`
        SELECT id, employeeId, type, color, startDate, endDate, isAllDay,
               startTime, endTime, status, reason, requestedAt, managedBy, managedAt,
               originalShiftDate, originalStartTime, originalEndTime, halfDaySegment,
               dateFiled, department, idNumber, contactInfo,
               workExtensionStatus, claimedWorkExtensionId, isAvlClaimed,
               durationCategory, totalMinutes,
               CASE WHEN pdfDataUri IS NOT NULL THEN 1 ELSE 0 END AS hasPdf
        FROM leave
    `).all() as any[];

    const notes = db.prepare('SELECT * FROM notes').all() as any[];
    const holidays = db.prepare('SELECT * FROM holidays').all() as any[];
    const tasks = db.prepare('SELECT * FROM tasks').all() as any[];

    const allowances = db.prepare(`
        SELECT id, employeeId, year, month, balance, asOfDate
        FROM communication_allowances
    `).all() as any[];

    const groups = db.prepare('SELECT name FROM groups').all().map((g: any) => g.name) as string[];
    const smtpSettings: SmtpSettings = db.prepare('SELECT * FROM smtp_settings WHERE id = 1').get() as any || {};
    const tardyRecords = db.prepare('SELECT * FROM tardy_records').all() as any[];
    const preferredAvl = db.prepare('SELECT * FROM preferred_avl').all() as any[];
    
    const shiftTemplates = db.prepare('SELECT * FROM shift_templates').all() as any[];
    let leaveTypes = db.prepare('SELECT * FROM leave_types').all() as any[];
    
    // Seed default leave types if empty
    if (leaveTypes.length === 0) {
        const defaults: LeaveTypeOption[] = [
            { type: 'AVL', color: '#14b8a6' },
            { type: 'VL', color: '#3b82f6' },
            { type: 'SL', color: '#ef4444' },
            { type: 'EL', color: '#f59e0b' },
            { type: 'BL', color: '#10b981' },
            { type: 'OFFSET', color: '#8b5cf6' },
            { type: 'PL', color: '#6b7280' },
        ];
        const insertStmt = db.prepare('INSERT INTO leave_types (type, color) VALUES (?, ?)');
        defaults.forEach(d => insertStmt.run(d.type, d.color));
        leaveTypes = defaults;
    }

    const keyValuePairs = db.prepare('SELECT * FROM key_value_store').all() as {key: string, value: string}[];
    
    // Separate specialized JSON stores from general templates
    const templatesMap: Record<string, string | null> = {};
    let monthlyOrderData = '{}';
    let faqData = '[]';
    let avlLockData = '{}';

    keyValuePairs.forEach(row => {
      if (row.key === 'monthlyEmployeeOrder') {
        monthlyOrderData = row.value;
      } else if (row.key === 'faqs') {
        faqData = row.value;
      } else if (row.key === 'avlLocks') {
        avlLockData = row.value;
      } else {
        templatesMap[row.key] = row.value;
      }
    });

    const monthlyEmployeeOrderValue = safeParseJSON(monthlyOrderData, {});
    const faqsValue: FaqItem[] = safeParseJSON(faqData, [
      { id: '1', question: 'What do the leave type codes stand for?', answer: 'Common leave codes include:\n- AVL: Annual Vacation Leave (Yearly allotted pool)\n- VL: Vacation Leave (General)\n- SL: Sick Leave\n- EL: Emergency Leave\n- CTO: Compensatory Time Off (earned overtime used as leave)\n- OFFSET: Claiming an approved Work Extension\n- TARDY: Filing for specific instances of tardiness.' },
      { id: '2', question: 'How do I request time off?', answer: 'Navigate to the "Time Off" section from the sidebar. Click the "New Request" button, fill in the required details such as leave type and dates, and submit your request. Your manager will be notified to review it.' },
      { id: '3', question: 'Where can I see my schedule for the upcoming week?', answer: 'You can view your personal schedule by clicking on "My Schedule" in the sidebar. This will show you all your assigned shifts for the selected period.' },
    ]);
    const avlLocksValue = safeParseJSON(avlLockData, {});
    
    const permissionsData = db.prepare('SELECT * FROM permissions').all() as { role: 'admin' | 'manager' | 'member', allowed_views: string }[];
    const permissionsMap: RolePermissions = permissionsData.reduce((acc, { role, allowed_views }) => {
        acc[role] = JSON.parse(allowed_views);
        return acc;
    }, { admin: [], manager: [], member: [] } as RolePermissions);

    ensureUploadDirs();

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
      }) as AppVisibility,
      // Read binary files from disk — not stored in DB columns anymore
      avatar:    readAvatar(e.id)    || e.avatar    || null,
      signature: readSignature(e.id) || e.signature || null,
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
      isAvlClaimed: l.isAvlClaimed === 1,
      // pdfDataUri not loaded here — fetched lazily via getLeaveWithPdf() when needed
      // hasPdf flag lets UI show View/Download/Send buttons without loading the actual PDF
      pdfDataUri: l.hasPdf ? `file:${l.id}.pdf` : undefined,
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

    const processedPreferredAvl: PreferredAvl[] = preferredAvl.map(p => ({
        ...p,
        plottedDays: safeParseJSON(p.plottedDays || p.dayNumbers, []),
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

    // Strip SMTP password before sending to client — only read server-side when actually sending mail
    const { pass: _smtpPass, ...safeSmtpSettings } = smtpSettings as any;
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
        smtpSettings: safeSmtpSettings,
        tardyRecords: processedTardyRecords,
        templates: templatesMap,
        shiftTemplates: processedShiftTemplates,
        leaveTypes,
        permissions: permissionsMap,
        monthlyEmployeeOrder: monthlyEmployeeOrderValue,
        faqs: faqsValue,
        preferredAvl: processedPreferredAvl,
        avlLocks: avlLocksValue,
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
  preferredAvl,
  avlLocks,
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
  preferredAvl: PreferredAvl[];
  avlLocks: Record<string, boolean>;
}): Promise<{ success: boolean; error?: string }> {
  try { await requireAuth(); } catch (e) { return { success: false, error: (e as Error).message }; }
  const db = getDb();
  
  const saveTransaction = db.transaction(() => {
    // ── Employees: upsert active, delete removed ──────────────────────────
        const allDbEmployeeIds = new Set(db.prepare('SELECT id FROM employees').all().map((r: any) => r.id));
        const employeeIdsInState = new Set(employees.map(e => e.id));
        const employeesToDelete = [...allDbEmployeeIds].filter(id => !employeeIdsInState.has(id) && id !== 'emp-admin-01');
        if (employeesToDelete.length > 0) {
            db.prepare(`DELETE FROM employees WHERE id IN (${employeesToDelete.map(() => '?').join(',')})`).run(...employeesToDelete);
        }
        // Upsert all non-binary employee fields. avatar and signature are stripped
        // from the payload to keep it small — preserve whatever is already in DB.
        const empUpsertStmt = db.prepare(`
            INSERT INTO employees (id, employeeNumber, firstName, lastName, middleInitial, email, phone, password,
                position, role, "group", birthDate, startDate, loadAllocation, visibility, lastPromotionDate,
                reportsTo, gender, employeeClassification, personnelNumber, avlAllotted, avlBeginningBalance,
                workScheduleType, defaultShiftTemplateId, department)
            VALUES (@id, @employeeNumber, @firstName, @lastName, @middleInitial, @email, @phone, @password,
                @position, @role, @group, @birthDate, @startDate, @loadAllocation, @visibility, @lastPromotionDate,
                @reportsTo, @gender, @employeeClassification, @personnelNumber, @avlAllotted, @avlBeginningBalance,
                @workScheduleType, @defaultShiftTemplateId, @department)
            ON CONFLICT(id) DO UPDATE SET
                employeeNumber=excluded.employeeNumber, firstName=excluded.firstName, lastName=excluded.lastName,
                middleInitial=excluded.middleInitial, email=excluded.email, phone=excluded.phone,
                position=excluded.position, role=excluded.role, "group"=excluded."group",
                birthDate=excluded.birthDate, startDate=excluded.startDate, loadAllocation=excluded.loadAllocation,
                visibility=excluded.visibility, lastPromotionDate=excluded.lastPromotionDate,
                reportsTo=excluded.reportsTo, gender=excluded.gender,
                employeeClassification=excluded.employeeClassification,
                personnelNumber=excluded.personnelNumber, avlAllotted=excluded.avlAllotted,
                avlBeginningBalance=excluded.avlBeginningBalance,
                workScheduleType=excluded.workScheduleType,
                defaultShiftTemplateId=excluded.defaultShiftTemplateId,
                department=excluded.department
                -- avatar and signature intentionally excluded: preserved from DB, updated by dedicated actions
        `);
        for (const e of employees) {
            empUpsertStmt.run({
                id: e.id, employeeNumber: e.employeeNumber || null,
                firstName: e.firstName, lastName: e.lastName, middleInitial: e.middleInitial || null,
                email: e.email, phone: e.phone || null, password: e.password || null,
                position: e.position || null, role: e.role, group: e.group || null,
                birthDate: e.birthDate ? new Date(e.birthDate).toISOString().split('T')[0] : null,
                startDate: e.startDate ? new Date(e.startDate).toISOString().split('T')[0] : null,
                loadAllocation: e.loadAllocation || 0,
                visibility: e.visibility ? JSON.stringify(e.visibility) : null,
                lastPromotionDate: e.lastPromotionDate ? new Date(e.lastPromotionDate).toISOString().split('T')[0] : null,
                reportsTo: e.reportsTo || null, gender: e.gender || null,
                employeeClassification: e.employeeClassification || null,
                personnelNumber: e.personnelNumber || null,
                avlAllotted: e.avlAllotted || 0, avlBeginningBalance: e.avlBeginningBalance || 0,
                workScheduleType: e.workScheduleType || '8h-paid',
                defaultShiftTemplateId: e.defaultShiftTemplateId || null,
                department: e.department || null,
            });
        }

        // ── Groups: sync additions and removals ───────────────────────────────
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

        // ── Shifts: upsert (INSERT OR REPLACE) ───────────────────────────────
        const dbShiftIds = new Set(db.prepare('SELECT id FROM shifts').all().map((r: any) => r.id));
        const stateShiftIds = new Set(shifts.map(s => s.id));
        const shiftsToDelete = [...dbShiftIds].filter(id => !stateShiftIds.has(id));
        if (shiftsToDelete.length > 0) {
            db.prepare(`DELETE FROM shifts WHERE id IN (${shiftsToDelete.map(() => '?').join(',')})`).run(...shiftsToDelete);
        }
        const shiftStmt = db.prepare(`INSERT OR REPLACE INTO shifts (id, employeeId, label, startTime, endTime, date, color, isDayOff, isHolidayOff, status, breakStartTime, breakEndTime, isUnpaidBreak) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
        for (const shift of shifts) {
            shiftStmt.run(shift.id, shift.employeeId, shift.label, shift.startTime, shift.endTime, toLocalDateString(shift.date), shift.color, shift.isDayOff ? 1 : 0, shift.isHolidayOff ? 1 : 0, shift.status, shift.breakStartTime, shift.breakEndTime, shift.isUnpaidBreak ? 1 : 0);
        }

        // ── Leave: upsert ─────────────────────────────────────────────────────
        const dbLeaveIds = new Set(db.prepare('SELECT id FROM leave').all().map((r: any) => r.id));
        const stateLeaveIds = new Set(leave.map(l => l.id));
        const leaveToDelete = [...dbLeaveIds].filter(id => !stateLeaveIds.has(id));
        if (leaveToDelete.length > 0) {
            db.prepare(`DELETE FROM leave WHERE id IN (${leaveToDelete.map(() => '?').join(',')})`).run(...leaveToDelete);
        }
        const leaveInsertStmt = db.prepare(`
        INSERT OR REPLACE INTO leave (id, employeeId, type, color, startDate, endDate, isAllDay, startTime, endTime,
            status, reason, requestedAt, managedBy, managedAt, originalShiftDate, originalStartTime, originalEndTime,
            halfDaySegment, dateFiled, department, idNumber, contactInfo, durationCategory, totalMinutes,
            workExtensionStatus, claimedWorkExtensionId, isAvlClaimed,
            employeeSignature, managerSignature, pdfDataUri)
        VALUES (@id, @employeeId, @type, @color, @startDate, @endDate, @isAllDay, @startTime, @endTime,
            @status, @reason, @requestedAt, @managedBy, @managedAt, @originalShiftDate, @originalStartTime, @originalEndTime,
            @halfDaySegment, @dateFiled, @department, @idNumber, @contactInfo, @durationCategory, @totalMinutes,
            @workExtensionStatus, @claimedWorkExtensionId, @isAvlClaimed,
            COALESCE(@employeeSignature, (SELECT employeeSignature FROM leave WHERE id=@id)),
            COALESCE(@managerSignature,  (SELECT managerSignature  FROM leave WHERE id=@id)),
            COALESCE(@pdfDataUri,        (SELECT pdfDataUri        FROM leave WHERE id=@id)))
        `);
        for (const l of leave) {
            leaveInsertStmt.run({
                id: l.id, employeeId: l.employeeId, type: l.type, color: l.color,
                startDate: toLocalDateString(l.startDate),
                endDate: toLocalDateString(l.endDate || l.startDate),
                isAllDay: l.isAllDay ? 1 : 0, startTime: l.startTime, endTime: l.endTime,
                status: l.status, reason: l.reason,
                requestedAt: l.requestedAt?.toISOString(),
                managedBy: l.managedBy, managedAt: l.managedAt?.toISOString(),
                originalShiftDate: l.originalShiftDate ? toLocalDateString(l.originalShiftDate) : null,
                originalStartTime: l.originalStartTime, originalEndTime: l.originalEndTime,
                halfDaySegment: l.halfDaySegment || null,
                dateFiled: l.dateFiled ? toLocalDateString(l.dateFiled) : toLocalDateString(new Date()),
                department: l.department, idNumber: l.idNumber, contactInfo: l.contactInfo,
                durationCategory: (l as any).durationCategory || null,
                totalMinutes: (l as any).totalMinutes || null,
                workExtensionStatus: l.workExtensionStatus || null,
                claimedWorkExtensionId: l.claimedWorkExtensionId || null,
                isAvlClaimed: l.isAvlClaimed ? 1 : 0,
                // Binary fields stripped from payload — COALESCE in SQL preserves DB value
                employeeSignature: null,
                managerSignature: null,
                pdfDataUri: null,
            });
        }

        // ── Notes: upsert ─────────────────────────────────────────────────────
        const dbNoteIds = new Set(db.prepare('SELECT id FROM notes').all().map((r: any) => r.id));
        const stateNoteIds = new Set(notes.map(n => n.id));
        const notesToDelete = [...dbNoteIds].filter(id => !stateNoteIds.has(id));
        if (notesToDelete.length > 0) {
            db.prepare(`DELETE FROM notes WHERE id IN (${notesToDelete.map(() => '?').join(',')})`).run(...notesToDelete);
        }
        const noteStmt = db.prepare('INSERT OR REPLACE INTO notes (id, date, title, description) VALUES (?, ?, ?, ?)');
        notes.forEach(note => noteStmt.run(note.id, toLocalDateString(note.date), note.title, note.description));

        // ── Holidays: upsert ──────────────────────────────────────────────────
        const dbHolidayIds = new Set(db.prepare('SELECT id FROM holidays').all().map((r: any) => r.id));
        const stateHolidayIds = new Set(holidays.map(h => h.id));
        const holidaysToDelete = [...dbHolidayIds].filter(id => !stateHolidayIds.has(id));
        if (holidaysToDelete.length > 0) {
            db.prepare(`DELETE FROM holidays WHERE id IN (${holidaysToDelete.map(() => '?').join(',')})`).run(...holidaysToDelete);
        }
        const holidayStmt = db.prepare('INSERT OR REPLACE INTO holidays (id, date, title) VALUES (?, ?, ?)');
        holidays.forEach(h => holidayStmt.run(h.id, toLocalDateString(h.date), h.title));

        // ── Tasks: upsert ─────────────────────────────────────────────────────
        const dbTaskIds = new Set(db.prepare('SELECT id FROM tasks').all().map((r: any) => r.id));
        const stateTaskIds = new Set(tasks.map(t => t.id));
        const tasksToDelete = [...dbTaskIds].filter(id => !stateTaskIds.has(id));
        if (tasksToDelete.length > 0) {
            db.prepare(`DELETE FROM tasks WHERE id IN (${tasksToDelete.map(() => '?').join(',')})`).run(...tasksToDelete);
        }
        const taskStmt = db.prepare('INSERT OR REPLACE INTO tasks (id, shiftId, assigneeId, scope, title, description, status, acknowledgedAt, completedAt, dueDate, createdBy) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
        for (const task of tasks) {
            taskStmt.run(task.id, task.shiftId, task.assigneeId, task.scope, task.title, task.description, task.status, task.acknowledgedAt?.toISOString(), task.completedAt?.toISOString(), task.dueDate?.toISOString(), task.createdBy);
        }

        // ── Allowances: upsert, preserve screenshot from DB ───────────────────
        const dbAllowanceIds = new Set(db.prepare('SELECT id FROM communication_allowances').all().map((r: any) => r.id));
        const stateAllowanceIds = new Set(allowances.map(a => a.id));
        const allowancesToDelete = [...dbAllowanceIds].filter(id => !stateAllowanceIds.has(id));
        if (allowancesToDelete.length > 0) {
            db.prepare(`DELETE FROM communication_allowances WHERE id IN (${allowancesToDelete.map(() => '?').join(',')})`).run(...allowancesToDelete);
        }
        const allowanceStmt = db.prepare(`
            INSERT INTO communication_allowances (id, employeeId, year, month, balance, asOfDate, screenshot)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET
                employeeId=excluded.employeeId, year=excluded.year, month=excluded.month,
                balance=excluded.balance, asOfDate=excluded.asOfDate,
                screenshot=COALESCE(excluded.screenshot, screenshot)
        `);
        for (const allowance of allowances) {
            allowanceStmt.run(
                allowance.id, allowance.employeeId, allowance.year, allowance.month,
                allowance.balance,
                allowance.asOfDate ? new Date(allowance.asOfDate).toISOString() : null,
                allowance.screenshot || null  // null means COALESCE keeps existing DB value
            );
        }

        // ── Tardy records: upsert ─────────────────────────────────────────────
        db.prepare('DELETE FROM tardy_records').run(); // tardy has no id PK — full replace is safe
        const tardyStmt = db.prepare('INSERT INTO tardy_records (employeeId, employeeName, date, schedule, timeIn, timeOut, remarks) VALUES (?, ?, ?, ?, ?, ?, ?)');
        for (const record of tardyRecords) {
            tardyStmt.run(record.employeeId, record.employeeName, toLocalDateString(record.date), record.schedule, record.timeIn, record.timeOut, record.remarks);
        }

        // ── Shift templates: upsert ───────────────────────────────────────────
        const dbTemplateIds = new Set(db.prepare('SELECT id FROM shift_templates').all().map((r: any) => r.id));
        const stateTemplateIds = new Set(shiftTemplates.map(t => t.id));
        const templatesToDelete = [...dbTemplateIds].filter(id => !stateTemplateIds.has(id));
        if (templatesToDelete.length > 0) {
            db.prepare(`DELETE FROM shift_templates WHERE id IN (${templatesToDelete.map(() => '?').join(',')})`).run(...templatesToDelete);
        }
        const shiftTemplateStmt = db.prepare('INSERT OR REPLACE INTO shift_templates (id, name, label, startTime, endTime, color, breakStartTime, breakEndTime, isUnpaidBreak) VALUES (@id, @name, @label, @startTime, @endTime, @color, @breakStartTime, @breakEndTime, @isUnpaidBreak)');
        for (const tpl of shiftTemplates) {
            shiftTemplateStmt.run({ id: tpl.id, name: tpl.name, label: tpl.label, startTime: tpl.startTime, endTime: tpl.endTime, color: tpl.color, breakStartTime: tpl.breakStartTime || null, breakEndTime: tpl.breakEndTime || null, isUnpaidBreak: tpl.isUnpaidBreak ? 1 : 0 });
        }

        // ── Leave types: full replace (no stable PK) ──────────────────────────
        db.prepare('DELETE FROM leave_types').run();
        const leaveTypeStmt = db.prepare('INSERT INTO leave_types (type, color) VALUES (@type, @color)');
        for (const lt of leaveTypes) { leaveTypeStmt.run({ type: lt.type, color: lt.color }); }

        // ── SMTP: upsert ──────────────────────────────────────────────────────
        if (smtpSettings && smtpSettings.host) {
            db.prepare(`INSERT INTO smtp_settings (id, host, port, secure, user, pass, fromEmail, fromName) VALUES (1, @host, @port, @secure, @user, @pass, @fromEmail, @fromName) ON CONFLICT(id) DO UPDATE SET host=excluded.host, port=excluded.port, secure=excluded.secure, user=excluded.user, pass=excluded.pass, fromEmail=excluded.fromEmail, fromName=excluded.fromName`)
              .run({ host: smtpSettings.host, port: smtpSettings.port, secure: smtpSettings.secure ? 1 : 0, user: smtpSettings.user || null, pass: smtpSettings.pass || null, fromEmail: smtpSettings.fromEmail, fromName: smtpSettings.fromName });
        }

        // ── Key-value store: upsert ───────────────────────────────────────────
        const kvStmt = db.prepare('INSERT INTO key_value_store (key, value) VALUES (@key, @value) ON CONFLICT(key) DO UPDATE SET value=excluded.value');
        for (const [key, value] of Object.entries(templates)) { if (value) kvStmt.run({ key, value }); }
        kvStmt.run({ key: 'monthlyEmployeeOrder', value: JSON.stringify(monthlyEmployeeOrder) });
        kvStmt.run({ key: 'faqs', value: JSON.stringify(faqs) });
        kvStmt.run({ key: 'avlLocks', value: JSON.stringify(avlLocks) });

        // ── Permissions: upsert ───────────────────────────────────────────────
        const permStmt = db.prepare('INSERT INTO permissions (role, allowed_views) VALUES (@role, @allowed_views) ON CONFLICT(role) DO UPDATE SET allowed_views=excluded.allowed_views');
        for (const [role, allowed_views] of Object.entries(permissions)) { permStmt.run({ role, allowed_views: JSON.stringify(allowed_views) }); }

        // ── Preferred AVL: upsert ─────────────────────────────────────────────
        const dbAvlIds = new Set(db.prepare('SELECT id FROM preferred_avl').all().map((r: any) => r.id));
        const stateAvlIds = new Set(preferredAvl.map(p => p.id));
        const avlToDelete = [...dbAvlIds].filter(id => !stateAvlIds.has(id));
        if (avlToDelete.length > 0) {
            db.prepare(`DELETE FROM preferred_avl WHERE id IN (${avlToDelete.map(() => '?').join(',')})`).run(...avlToDelete);
        }
        const avlStmt = db.prepare('INSERT OR REPLACE INTO preferred_avl (id, employeeId, year, month, plottedDays) VALUES (?, ?, ?, ?, ?)');
        for (const p of preferredAvl) { avlStmt.run(p.id, p.employeeId, p.year, p.month, JSON.stringify(p.plottedDays)); }

  });

  try {
    db.pragma('foreign_keys = OFF');
    saveTransaction();
    db.pragma('foreign_keys = ON');
    return { success: true };
  } catch (error) {
    db.pragma('foreign_keys = ON');
    console.error('Failed to save data:', error);
    return { success: false, error: (error as Error).message };
  }
}
