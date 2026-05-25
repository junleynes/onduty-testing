'use server';

import type { SmtpSettings, Employee, Shift, AppVisibility, Leave } from '@/types';
import nodemailer from 'nodemailer';
import bcrypt from 'bcryptjs';
import { getDb } from '@/lib/db';
import fs from 'fs';
import path from 'path';
import { PDFDocument } from 'pdf-lib';
import { isSameDay } from 'date-fns';
import { v4 as uuidv4 } from 'uuid';
import { getFullName } from '@/lib/utils';


type Attachment = {
    filename: string;
    content: string; // Base64 encoded string
}

export async function sendEmail(
    { to, subject, htmlBody, attachments, fromName, fromEmail }: { to: string, subject: string, htmlBody: string, attachments?: Attachment[], fromName?: string, fromEmail?: string },
    smtpSettings: SmtpSettings
) {
    if (!smtpSettings.fromEmail || !smtpSettings.fromName) {
        return { success: false, error: 'SMTP settings (From Email and From Name) are not configured.' };
    }
    if (!smtpSettings.host || !smtpSettings.port || !smtpSettings.user || !smtpSettings.pass) {
        return { success: false, error: 'SMTP connection settings (Host, Port, User, Pass) are not fully configured.' };
    }

    const isSecure = smtpSettings.port === 465 || smtpSettings.secure;

    const transporter = nodemailer.createTransport({
        host: smtpSettings.host,
        port: Number(smtpSettings.port),
        secure: isSecure,
        auth: {
            user: smtpSettings.user,
            pass: smtpSettings.pass,
        },
        tls: {
            rejectUnauthorized: false,
            minVersion: 'TLSv1.2'
        },
        connectionTimeout: 20000,
        greetingTimeout: 20000,
        socketTimeout: 60000,
    });

    try {
        await transporter.sendMail({
            from: `"${fromName || smtpSettings.fromName}" <${fromEmail || smtpSettings.fromEmail}>`,
            to: to,
            subject: subject,
            html: htmlBody,
            attachments: attachments?.map(att => ({
                filename: att.filename,
                content: Buffer.from(att.content, 'base64'),
            }))
        });
        return { success: true };
    } catch (error) {
        console.error('Email sending failed:', error);
        return { success: false, error: (error as Error).message };
    }
}


export async function verifyUser(email: string, password: string): Promise<{ success: boolean; user?: Employee; error?: string; }> {
    const db = getDb();
    try {
        const userRow = db.prepare('SELECT * FROM employees WHERE email = ?').get(email.toLowerCase()) as any;

        if (userRow) {
            const user = JSON.parse(JSON.stringify(userRow)) as Employee;
            
            if (user.password && user.password.startsWith('$2')) {
                const isMatch = await bcrypt.compare(password, user.password);
                if (isMatch) {
                    return { success: true, user: user };
                }
            } 
            else if (user.password === password) {
                return { success: true, user: user };
            }
        }
        
        return { success: false, error: 'Invalid email or password.' };

    } catch (error) {
        console.error('Login verification failed:', error);
        return { success: false, error: (error as Error).message };
    }
}

function safeParseJSON(jsonString: string | null | undefined, defaultValue: any) {
  if (!jsonString) return defaultValue;
  try {
    return JSON.parse(jsonString);
  } catch (e) {
    return defaultValue;
  }
}

export async function getPublicData(): Promise<{
    success: boolean;
    data?: { employees: Employee[], shifts: Shift[] };
    error?: string;
}> {
    const db = getDb();
    try {
        const allEmployees = db.prepare('SELECT * FROM employees').all() as any[];
        const allShifts = db.prepare('SELECT * FROM shifts').all() as any[];
        
        const processedEmployees: Employee[] = allEmployees.map(e => ({
            ...e,
            visibility: safeParseJSON(e.visibility, {}) as AppVisibility
        }));

        const visibleEmployees = processedEmployees.filter(e => e.visibility?.onDuty !== false);

        const publishedShifts = allShifts
            .map(s => ({
                ...s,
                date: new Date(s.date),
                isDayOff: s.isDayOff === 1,
                isHolidayOff: s.isHolidayOff === 1,
                isUnpaidBreak: s.isUnpaidBreak === 1,
            }))
            .filter(s => s.status === 'published' && !s.isDayOff && !s.isHolidayOff);

        return {
            success: true,
            data: {
                employees: visibleEmployees,
                shifts: publishedShifts,
            }
        };

    } catch (error) {
        console.error('Failed to fetch public data:', error);
        return { success: false, error: (error as Error).message };
    }
}

export async function resetToFactorySettings(): Promise<{ success: boolean; error?: string }> {
    const dbPath = path.join(process.cwd(), 'local.db');
    
    const dbModule = require('@/lib/db');
    if (dbModule.dbInstance && dbModule.dbInstance.open) {
        dbModule.dbInstance.close();
    }
    dbModule.dbInstance = null;

    try {
        if (fs.existsSync(dbPath)) {
            fs.unlinkSync(dbPath);
        }
        return { success: true };
    } catch (error) {
        console.error('Failed to reset database:', error);
        return { success: false, error: (error as Error).message };
    }
}


export async function purgeData(dataType: 'users' | 'shiftTemplates' | 'holidays' | 'reportTemplates' | 'tasks' | 'mobileLoad' | 'leaveTypes' | 'groups' | 'leave'): Promise<{ success: boolean; error?: string }> {
    const db = getDb();
    try {
        switch (dataType) {
            case 'users':
                db.prepare("DELETE FROM employees WHERE role != 'admin' AND email != 'admin@onduty.local'").run();
                break;
            case 'shiftTemplates':
                db.prepare('DELETE FROM shift_templates').run();
                break;
            case 'holidays':
                db.prepare('DELETE FROM holidays').run();
                break;
            case 'reportTemplates':
                db.prepare("DELETE FROM key_value_store WHERE key LIKE ?").run('%Template');
                break;
            case 'tasks':
                db.prepare('DELETE FROM tasks').run();
                break;
            case 'mobileLoad':
                db.prepare('DELETE FROM communication_allowances').run();
                db.prepare("UPDATE employees SET loadAllocation = 0").run();
                break;
            case 'leaveTypes':
                db.prepare('DELETE FROM leave_types').run();
                break;
            case 'leave':
                db.prepare('DELETE FROM leave').run();
                break;
            case 'groups':
                db.prepare("UPDATE employees SET 'group' = NULL").run();
                db.prepare('DELETE FROM groups').run();
                break;
            default:
                return { success: false, error: 'Invalid data type specified for purging.' };
        }
        return { success: true };
    } catch (error) {
        console.error(`Failed to purge ${dataType}:`, error);
        return { success: false, error: (error as Error).message };
    }
}

/**
 * Robust date component extractor. 
 * Prevents "one day behind" error by manually extracting Month, Day, and Year literal values.
 */
function formatComponentDate(dateInput: Date | string | number | undefined): string {
    if (!dateInput) return '';
    try {
        // Method 1: Raw String Splitting (Safest for ISO strings from DB)
        if (typeof dateInput === 'string') {
            const match = dateInput.match(/^(\d{4})-(\d{2})-(\d{2})/);
            if (match) {
                return `${match[2]}/${match[3]}/${match[1]}`;
            }
        }
        
        const dateObj = (dateInput instanceof Date) ? dateInput : new Date(dateInput);
        if (isNaN(dateObj.getTime())) return '';
        
        // Method 2: UTC detection. Calendar dates are usually stored as midnight UTC.
        // If we detect midnight, we extract UTC components to avoid local timezone shifts.
        const isMidnight = dateObj.getUTCHours() === 0 && dateObj.getUTCMinutes() === 0;
        
        const mm = String((isMidnight ? dateObj.getUTCMonth() : dateObj.getMonth()) + 1).padStart(2, '0');
        const dd = String(isMidnight ? dateObj.getUTCDate() : dateObj.getDate()).padStart(2, '0');
        const yyyy = isMidnight ? dateObj.getUTCFullYear() : dateObj.getFullYear();
        return `${mm}/${dd}/${yyyy}`;
    } catch (e) {
        return '';
    }
}

/**
 * STRICT ROLE ISOLATION HELPERS
 * Categorizes PDF field names and data keys to prevent Employee/Manager overlaps.
 *
 * FIX 1 — isWorkExtensionField: `name.startsWith('we')` was too broad and matched
 * common field names like "weight", "week", "welcome", "webform", etc., causing those
 * non-WE fields to be skipped when filling the main section of the offset PDF.
 * Changed to only match the explicit "we_" prefix (underscore required) or the longer
 * keyword strings which are unambiguous.
 *
 * FIX 2 — MANAGER_KEYWORDS: 'head' and 'user' are dangerously short and generic.
 * 'head' falsely matched fields like "letterhead", "header", "thread".
 * 'user' in EMPLOYEE_KEYWORDS falsely matched fields like "username", "user_id" which
 * are neutral metadata fields — not the employee's name or ID — causing them to receive
 * the employee name value. Both removed.
 *
 * FIX 3 — isManagerPdfField exclusion list was using includes() on the pre-normalized
 * fName that already had underscores stripped (replace(/[^a-z0-9]/g, '')), so
 * 'employee_name' never matched — the guard was silently dead. Fixed to match the
 * already-normalized form (no underscores).
 *
 * FIX 4 — getDataRole: key 'reason' and 'department' resolved to 'neutral', so the
 * role-guard let them write into ANY matching field name regardless of role. In a
 * combined offset+WE template that contains both an employee "reason" field and a
 * manager "reason" annotation field, both got the same value. Fixed by making neutral
 * data keys skip manager-tagged fields explicitly inside the loop (see generateOffsetPdf).
 *
 * FIX 5 — generateOffsetPdf field loop: the we_ namespace guard used
 * `name.startsWith('we')` (no underscore) consistent with the old isWorkExtensionField,
 * so field names like "wednesday" or "weight" were incorrectly treated as WE-section
 * fields and excluded from the main offset fill pass. Aligned with the fixed
 * isWorkExtensionField (requires "we_" prefix).
 */
const MANAGER_KEYWORDS = ['manager', 'supervisor', 'superior', 'mgr', 'approver', 'dept_head', 'authorized', 'officer', 'station_mgr', 'approving'];
const EMPLOYEE_KEYWORDS = ['employee', 'applicant', 'emp', 'staff', 'requester', 'member', 'filing_party'];

function isManagerPdfField(fName: string): boolean {
    const name = fName.toLowerCase();
    // FIX 3: fName is already normalized (no underscores) by callers, so check
    // normalized forms: 'employeename', 'empname', 'applicantname'
    if (name.includes('employeename') || name.includes('empname') || name.includes('applicantname')) return false;
    return MANAGER_KEYWORDS.some(m => name.includes(m));
}

function isEmployeePdfField(fName: string): boolean {
    const name = fName.toLowerCase();
    if (MANAGER_KEYWORDS.some(m => name.includes(m))) return false;
    return EMPLOYEE_KEYWORDS.some(e => name.includes(e));
}

function getFieldRole(fName: string): 'employee' | 'manager' | 'neutral' {
    if (isManagerPdfField(fName)) return 'manager';
    if (isEmployeePdfField(fName)) return 'employee';
    return 'neutral';
}

function getDataRole(key: string): 'employee' | 'manager' | 'neutral' {
    const k = key.toLowerCase();
    if (k.includes('manager') || k.includes('approval') || k.includes('we_manager')) return 'manager';
    if (k.includes('employee') || k.includes('emp_') || k.includes('applicant') || k.includes('we_employee')) return 'employee';
    return 'neutral';
}

// FIX 1: require the explicit "we_" prefix (with underscore) so short "we" alone
// does not accidentally match unrelated field names like "weight", "week", "welcome".
// Also recognises 'extended_date' which is a WE-section field without the we_ prefix.
function isWorkExtensionField(fName: string): boolean {
    const name = fName.toLowerCase();
    return name.startsWith('we_') || name === 'extended_date' || name.includes('workext') || name.includes('workextension');
}

async function embedSignatureToPdf(pdfDoc: PDFDocument, sigData: string | undefined, fieldNames: string[], dataRole: 'employee' | 'manager') {
    if (!sigData || !sigData.includes('base64,')) return;
    const form = pdfDoc.getForm();
    const allFormFields = form.getFields();
    
    try {
        const sigBase64 = sigData.split('base64,')[1];
        const buffer = Buffer.from(sigBase64, 'base64');
        let image;
        try { image = await pdfDoc.embedPng(buffer); } catch (e) { 
            try { image = await pdfDoc.embedJpg(buffer); } catch (e2) { return; }
        }

        const normalizedTargets = fieldNames.map(n => n.toLowerCase().replace(/[^a-z0-9]/g, ''));

        for (const field of allFormFields) {
            const fName = field.getName().toLowerCase().replace(/[^a-z0-9]/g, '');
            const fieldRole = getFieldRole(fName);

            // STRICT ROLE ENFORCEMENT
            if (dataRole === 'manager' && fieldRole !== 'manager') continue;
            if (dataRole === 'employee' && fieldRole === 'manager') continue;

            const isMatch = normalizedTargets.some(target => 
                fName === target || (target.length > 5 && fName.endsWith(target))
            );

            if (isMatch) {
                try {
                    const button = form.getButton(field.getName());
                    button.setImage(image);
                } catch (e) {}
            }
        }
    } catch (err) {}
}

export async function generateLeavePdf(leaveRequest: Leave): Promise<{ success: boolean; pdfDataUri?: string; error?: string; }> {
    const db = getDb();
    try {
        const templateData = db.prepare("SELECT value FROM key_value_store WHERE key = 'alafTemplate'").get() as { value: string } | undefined;
        if (!templateData || !templateData.value) return { success: false, error: "ALAF template not found." };

        const employee = db.prepare("SELECT * FROM employees WHERE id = ?").get(leaveRequest.employeeId) as Employee | undefined;
        if (!employee) return { success: false, error: "Employee not found." };
        const manager = leaveRequest.managedBy ? db.prepare("SELECT * FROM employees WHERE id = ?").get(leaveRequest.managedBy) as Employee | undefined : undefined;

        const pdfDoc = await PDFDocument.load(Buffer.from(templateData.value, 'base64'));
        const form = pdfDoc.getForm();

        const startDateStr = formatComponentDate(leaveRequest.startDate);
        const endDateStr = formatComponentDate(leaveRequest.endDate);
        const datesDisplay = isSameDay(new Date(leaveRequest.startDate), new Date(leaveRequest.endDate)) ? startDateStr : `${startDateStr} to ${endDateStr}`;

        // Compute total days
        let leaveTotalDays = '';
        if (leaveRequest.durationCategory === 'minutes') {
            const mins = leaveRequest.totalMinutes || 0;
            leaveTotalDays = `${mins} min${mins !== 1 ? 's' : ''}`;
        } else if (leaveRequest.durationCategory === 'half') {
            leaveTotalDays = '0.5';
        } else {
            const start = new Date(leaveRequest.startDate);
            const end = new Date(leaveRequest.endDate);
            const days = Math.round((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)) + 1;
            leaveTotalDays = String(days);
        }

        // ── Fill fields directly by exact template field name ─────────────────────
        // Pre-clear all text fields first to remove any default/pre-filled values
        // that might bleed into the rendered output alongside our new values.
        form.getFields().forEach(f => {
            try { form.getTextField(f.getName()).setText(''); } catch (e) {}
        });

        const trySet = (fieldName: string, value: string) => {
            try { form.getTextField(fieldName).setText(value || ''); } catch (e) {}
        };

        // Employee fields — only employee data, never manager
        trySet('employee_name',  getFullName(employee));
        trySet('employee_id',    leaveRequest.idNumber || employee.employeeNumber || '');
        trySet('department',     leaveRequest.department || employee.group || '');
        trySet('contact_info',   leaveRequest.contactInfo || employee.phone || '');
        trySet('leave_dates',    datesDisplay);
        trySet('total_days',     leaveTotalDays);
        trySet('reason',         leaveRequest.reason || '');
        trySet('date_filed',     formatComponentDate(leaveRequest.dateFiled || new Date()));

        // Manager fields — only manager data, never employee
        trySet('manager_name',   manager ? getFullName(manager) : '');
        trySet('approval_date',  formatComponentDate(leaveRequest.managedAt));

        // ── Checkboxes ────────────────────────────────────────────────────────────
        const allFormFields = form.getFields();

        // 1. Leave type checkbox (e.g. AVL, VL, SL, Offset, etc.)
        // BUG FIX: fn.endsWith(t) caused 'avl' to match when t='vl'.
        // Use EXACT match only: fn === t or fn === 'chk'+t.
        // Also check the raw (non-normalized) field name for exact match.
        if (leaveRequest.type) {
            const t = leaveRequest.type.toLowerCase().replace(/[^a-z0-9]/g, '');
            allFormFields.forEach(f => {
                const fn = f.getName().toLowerCase().replace(/[^a-z0-9]/g, '');
                const fnRaw = f.getName().toLowerCase();
                if (fn === t || fn === `chk${t}` || fnRaw === t || fnRaw === `chk_${t}` || fnRaw === `chk${t}`) {
                    try { form.getCheckBox(f.getName()).check(); } catch (e) {}
                }
            });
        }

        // 2. Approved / Rejected status checkbox
        const status = leaveRequest.status?.toLowerCase();
        if (status === 'approved' || status === 'rejected') {
            allFormFields.forEach(f => {
                const fn = f.getName().toLowerCase().replace(/[^a-z0-9]/g, '');
                // Exact match only — avoid partial matches like 'disapproved' matching 'approved'
                if (fn === status || fn === `chk${status}`) {
                    try { form.getCheckBox(f.getName()).check(); } catch (e) {}
                }
            });
        }

        form.updateFieldAppearances();
        await embedSignatureToPdf(pdfDoc, leaveRequest.employeeSignature || employee.signature, ['employee_signature_af_image', 'signature_employee'], 'employee');
        await embedSignatureToPdf(pdfDoc, leaveRequest.managerSignature || manager?.signature, ['manager_signature_af_image', 'signature_manager'], 'manager');

        const pdfBytes = await pdfDoc.save();
        return { success: true, pdfDataUri: `data:application/pdf;base64,${Buffer.from(pdfBytes).toString('base64')}` };
    } catch (error: any) {
        return { success: false, error: error.message };
    }
}

export async function generateOffsetPdf(leaveRequest: Leave): Promise<{ success: boolean; pdfDataUri?: string; error?: string; }> {
    const db = getDb();
    try {
        const templateData = db.prepare("SELECT value FROM key_value_store WHERE key = 'offsetTemplate'").get() as { value: string } | undefined;
        if (!templateData || !templateData.value) return { success: false, error: "Offset template not found." };

        const employee = db.prepare("SELECT * FROM employees WHERE id = ?").get(leaveRequest.employeeId) as Employee | undefined;
        const manager = leaveRequest.managedBy ? db.prepare("SELECT * FROM employees WHERE id = ?").get(leaveRequest.managedBy) as Employee | undefined : undefined;

        let weRequest: Leave | undefined;
        let weManager: Employee | undefined;
        if (leaveRequest.claimedWorkExtensionId) {
            weRequest = db.prepare("SELECT * FROM leave WHERE id = ?").get(leaveRequest.claimedWorkExtensionId) as Leave | undefined;
            if (weRequest?.managedBy) weManager = db.prepare("SELECT * FROM employees WHERE id = ?").get(weRequest.managedBy) as Employee | undefined;
        }

        const pdfDoc = await PDFDocument.load(Buffer.from(templateData.value, 'base64'));
        const form = pdfDoc.getForm();

        // Compute total days for the offset request
        let totalDaysValue = '';
        if (leaveRequest.durationCategory === 'minutes') {
            const mins = leaveRequest.totalMinutes || 0;
            totalDaysValue = `${mins} min${mins !== 1 ? 's' : ''}`;
        } else if (leaveRequest.durationCategory === 'half') {
            totalDaysValue = '0.5';
        } else {
            totalDaysValue = '1';
        }

        // ── PASS 1: Fill ALAF (offset) section fields directly by exact name ──────
        // Using getTextField by exact name instead of a loop completely eliminates
        // any risk of a WE field being matched by an ALAF data key or vice-versa.
        // Pre-clear all text fields first to remove any default/pre-filled values.
        form.getFields().forEach(f => {
            try { form.getTextField(f.getName()).setText(''); } catch (e) {}
        });

        const trySet = (fieldName: string, value: string) => {
            try { form.getTextField(fieldName).setText(value || ''); } catch (e) {}
        };

        trySet('employee_name',  getFullName(employee));
        trySet('employee_id',    leaveRequest.idNumber || employee?.employeeNumber || '');
        trySet('department',     leaveRequest.department || employee?.group || '');
        trySet('contact_info',   leaveRequest.contactInfo || employee?.phone || '');
        trySet('leave_dates',    formatComponentDate(leaveRequest.startDate));
        trySet('offset_reason',  leaveRequest.reason || '');
        trySet('total_days',     totalDaysValue);
        trySet('manager_name',   manager ? getFullName(manager) : '');
        trySet('approval_date',  formatComponentDate(leaveRequest.managedAt));
        trySet('date_filed',     formatComponentDate(leaveRequest.dateFiled || new Date()));

        // ── PASS 2: Fill WE section fields directly by exact name ────────────────
        if (weRequest) {
            trySet('we_employee_name', getFullName(employee));
            trySet('we_department',    weRequest.department || employee?.group || '');
            trySet('we_date_filed',    formatComponentDate(weRequest.dateFiled || weRequest.requestedAt || new Date()));
            trySet('extended_date',    formatComponentDate(weRequest.startDate));
            trySet('we_shiftfrom',     weRequest.originalStartTime || '');
            trySet('we_shiftto',       weRequest.originalEndTime   || '');
            trySet('we_timein',        weRequest.startTime || '');
            trySet('we_timeout',       weRequest.endTime   || '');
            trySet('we_extendfrom',    weRequest.startTime || '');
            trySet('we_extendto',      weRequest.endTime   || '');
            trySet('we_reason',        weRequest.reason || '');
            trySet('we_manager_name',  weManager ? getFullName(weManager) : '');
        }

        // ── Checkboxes — approved / rejected status ───────────────────────────────
        const allOffsetFormFields = form.getFields();
        const offsetStatus = leaveRequest.status?.toLowerCase();
        if (offsetStatus === 'approved' || offsetStatus === 'rejected') {
            allOffsetFormFields.forEach(f => {
                const fn = f.getName().toLowerCase().replace(/[^a-z0-9]/g, '');
                if (fn === offsetStatus || fn === `chk${offsetStatus}` || fn.includes(offsetStatus)) {
                    try { form.getCheckBox(f.getName()).check(); } catch (e) {}
                }
            });
        }

        form.updateFieldAppearances();
        await embedSignatureToPdf(pdfDoc, leaveRequest.employeeSignature || employee?.signature, ['employee_signature_af_image'], 'employee');
        await embedSignatureToPdf(pdfDoc, leaveRequest.managerSignature || manager?.signature, ['manager_signature_af_image'], 'manager');
        if (weRequest) {
            await embedSignatureToPdf(pdfDoc, weRequest.employeeSignature, ['we_employee_signature_af_image'], 'employee');
            await embedSignatureToPdf(pdfDoc, weRequest.managerSignature, ['we_manager_signature_af_image'], 'manager');
        }

        const pdfBytes = await pdfDoc.save();
        return { success: true, pdfDataUri: `data:application/pdf;base64,${Buffer.from(pdfBytes).toString('base64')}` };
    } catch (error: any) {
        return { success: false, error: error.message };
    }
}


export async function sendPasswordResetLink(email: string, origin: string, smtpSettings: SmtpSettings): Promise<{ success: boolean; error?: string }> {
    const db = getDb();
    try {
        const employee = db.prepare('SELECT * FROM employees WHERE email = ?').get(email) as Employee | undefined;
        if (!employee) {
            return { success: true };
        }

        const token = uuidv4();
        const expiresAt = new Date(Date.now() + 3600000); 

        db.prepare('INSERT INTO password_reset_tokens (token, employeeId, expiresAt) VALUES (?, ?, ?)')
          .run(token, employee.id, expiresAt.toISOString());

        const resetLink = `${origin}/reset-password?token=${token}`;

        const subject = 'Password Reset Request for OnDuty';
        const htmlBody = `
            <p>Hello ${employee.firstName},</p>
            <p>You requested a password reset. Please click the link below to set a new password:</p>
            <p><a href="${resetLink}">Reset Password</a></p>
            <p>If you did not request this, please ignore this email. This link is valid for one hour.</p>
        `;

        return await sendEmail({ to: email, subject, htmlBody }, smtpSettings);
    } catch (error) {
        console.error('Password reset request failed:', error);
        return { success: false, error: (error as Error).message };
    }
}

export async function sendActivationLink(employeeId: string, origin: string, smtpSettings: SmtpSettings): Promise<{ success: boolean; error?: string }> {
    const db = getDb();
    try {
        const employee = db.prepare('SELECT * FROM employees WHERE id = ?').get(employeeId) as Employee | undefined;
        if (!employee) {
            return { success: true, error: 'Employee not found.' };
        }

        const token = uuidv4();
        const expiresAt = new Date(Date.now() + 24 * 3600000); 

        db.prepare('INSERT INTO password_reset_tokens (token, employeeId, expiresAt) VALUES (?, ?, ?)')
          .run(token, employee.id, expiresAt.toISOString());

        const activationLink = `${origin}/reset-password?token=${token}`;

        const subject = 'Activate Your OnDuty Account';
        const htmlBody = `
            <p>Hello ${employee.firstName},</p>
            <p>Welcome to OnDuty! To activate your account and set your password, please click the link below:</p>
            <p><a href="${activationLink}">Activate Account</a></p>
            <p>This link is valid for 24 hours.</p>
        `;

        return await sendEmail({ to: employee.email, subject, htmlBody }, smtpSettings);

    } catch (error) {
        console.error('Account activation failed:', error);
        return { success: false, error: (error as Error).message };
    }
}

export async function verifyPasswordResetToken(token: string): Promise<{ success: boolean; error?: string }> {
    const db = getDb();
    try {
        const tokenRecord = db.prepare('SELECT * FROM password_reset_tokens WHERE token = ?').get(token) as { expiresAt: string } | undefined;

        if (!tokenRecord) {
            return { success: false, error: 'Invalid or expired token.' };
        }
        
        if (new Date(tokenRecord.expiresAt) < new Date()) {
             db.prepare('DELETE FROM password_reset_tokens WHERE token = ?').run(token);
             return { success: false, error: 'Invalid or expired token.' };
        }
        
        return { success: true };

    } catch (error) {
        console.error('Token verification failed:', error);
        return { success: false, error: (error as Error).message };
    }
}


export async function resetPasswordWithToken(token: string, newPassword: string):Promise<{ success: boolean; error?: string }> {
    const db = getDb();
    try {
        const tokenRecord = db.prepare('SELECT * FROM password_reset_tokens WHERE token = ?').get(token) as { employeeId: string, expiresAt: string } | undefined;
        
        if (!tokenRecord || new Date(tokenRecord.expiresAt) < new Date()) {
             if (tokenRecord) {
                db.prepare('DELETE FROM password_reset_tokens WHERE token = ?').run(token);
             }
             return { success: false, error: 'Invalid or expired token.' };
        }

        const hashedPassword = await bcrypt.hash(newPassword, 10);
        db.prepare('UPDATE employees SET password = ? WHERE id = ?').run(hashedPassword, tokenRecord.employeeId);
        db.prepare('DELETE FROM password_reset_tokens WHERE token = ?').run(token);

        return { success: true };
    } catch(error) {
         console.error('Password reset failed:', error);
        return { success: false, error: (error as Error).message };
    }
}
