'use server';

import type { SmtpSettings, Employee, Shift, AppVisibility, Leave } from '@/types';
import nodemailer from 'nodemailer';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import { getDb } from '@/lib/db';
import fs from 'fs';
import path from 'path';
import { PDFDocument, PDFName } from 'pdf-lib';
import { isSameDay } from 'date-fns';
import { getFullName } from '@/lib/utils';

// Login attempt tracking for rate limiting (in-memory, resets on server restart)
const loginAttempts = new Map<string, { count: number; lockedUntil: number }>();
const MAX_ATTEMPTS = 5;
const LOCKOUT_MS = 15 * 60 * 1000; // 15 minutes

/**
 * pdf-lib's updateFieldAppearances() silently skips multiline text fields (Ff bit 13 = 0x1000).
 * This leaves their /AP appearance stream stale — so PDF viewers render the old /AP (wrong data)
 * when the field is not focused, and only render the correct /V when clicked.
 *
 * This function manually writes a correct /AP /N stream for any text field,
 * whether single-line or multiline, so both focused and unfocused states show the same value.
 *
 * Also fixes fields whose Rect is on a child widget rather than the field dict itself
 * (which causes updateFieldAppearances to silently produce an empty stream).
 */
function fixFieldAppearance(pdfDoc: PDFDocument, form: any, fieldName: string, value: string): void {
    try {
        const allFields = form.getFields();
        const field = allFields.find((f: any) => f.getName() === fieldName);
        if (!field) return;

        const dict = field.acroField.dict;

        // Find the widget that has the Rect — may be on the field or a child widget
        let rectArray: any = dict.lookup(PDFName.of('Rect'));
        let widgetDict: any = dict;
        if (!rectArray) {
            const kids: any = dict.lookup(PDFName.of('Kids'));
            if (kids) {
                for (let i = 0; i < kids.size(); i++) {
                    const kid = pdfDoc.context.lookup(kids.get(i)) as any;
                    if (kid?.get?.(PDFName.of('Rect'))) {
                        rectArray = kid.get(PDFName.of('Rect'));
                        widgetDict = kid;
                        break;
                    }
                }
            }
        }
        if (!rectArray) return;

        const w = (rectArray.get(2) as any).asNumber() - (rectArray.get(0) as any).asNumber();
        const h = (rectArray.get(3) as any).asNumber() - (rectArray.get(1) as any).asNumber();
        const fontSize = 8;
        const margin = 2;
        const lineHeight = fontSize * 1.35;

        const escape = (s: string) => s.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');

        const lines = (value || '').split('\n');
        let y = h - margin - fontSize;
        let content = `/Tx BMC\nBT\n/Helv ${fontSize} Tf\n0 g\n`;
        for (const line of lines) {
            content += `${margin} ${y.toFixed(2)} Td\n(${escape(line)}) Tj\n0 ${(-lineHeight).toFixed(2)} Td\n`;
            y -= lineHeight;
        }
        content += `ET\nEMC\n`;

        const streamBytes = Buffer.from(content, 'latin1');
        const apStream = pdfDoc.context.stream(streamBytes, {
            Subtype: 'Form',
            BBox: pdfDoc.context.obj([0, 0, w, h]),
        });
        const apStreamRef = pdfDoc.context.register(apStream);
        widgetDict.set(PDFName.of('AP'), pdfDoc.context.obj({ N: apStreamRef }));
    } catch (_) {
        // Silently ignore — field will still show correct /V when focused
    }
}


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
    const key = email.toLowerCase().trim();

    // ── Rate limiting ─────────────────────────────────────────────────────────
    const now = Date.now();
    const record = loginAttempts.get(key);
    if (record && record.lockedUntil > now) {
        const mins = Math.ceil((record.lockedUntil - now) / 60000);
        return { success: false, error: `Too many failed attempts. Try again in ${mins} minute${mins !== 1 ? 's' : ''}.` };
    }

    try {
        const userRow = db.prepare('SELECT * FROM employees WHERE email = ?').get(key) as any;

        if (userRow) {
            const user = JSON.parse(JSON.stringify(userRow)) as Employee;

            let isMatch = false;
            if (user.password && user.password.startsWith('$2')) {
                // Bcrypt hash — compare securely
                isMatch = await bcrypt.compare(password, user.password);
            } else if (user.password) {
                // FIX #1: plaintext password in DB — compare then immediately upgrade to bcrypt
                // This handles accounts created before bcrypt was introduced.
                // After this login, the account is bcrypt-protected going forward.
                isMatch = user.password === password;
                if (isMatch) {
                    const hashed = await bcrypt.hash(password, 12);
                    db.prepare('UPDATE employees SET password = ? WHERE id = ?').run(hashed, user.id);
                }
            }

            if (isMatch) {
                // Clear failed attempts on success
                loginAttempts.delete(key);
                // FIX #2: strip password from returned user object — never send to client
                const { password: _pw, ...safeUser } = user as any;
                return { success: true, user: safeUser as Employee };
            }
        }

        // Track failed attempt
        const attempts = loginAttempts.get(key) || { count: 0, lockedUntil: 0 };
        attempts.count += 1;
        if (attempts.count >= MAX_ATTEMPTS) {
            attempts.lockedUntil = now + LOCKOUT_MS;
            attempts.count = 0;
        }
        loginAttempts.set(key, attempts);

        return { success: false, error: 'Invalid email or password.' };

    } catch (error) {
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
        const allFields = form.getFields();

        // Compute dates display
        const startDateStr = formatComponentDate(leaveRequest.startDate);
        const endDateStr = formatComponentDate(leaveRequest.endDate);
        const datesDisplay = isSameDay(new Date(leaveRequest.startDate), new Date(leaveRequest.endDate))
            ? startDateStr : `${startDateStr} to ${endDateStr}`;

        // Compute total days
        let leaveTotalDays = '';
        if (leaveRequest.durationCategory === 'minutes') {
            const mins = leaveRequest.totalMinutes || 0;
            leaveTotalDays = `${mins} min${mins !== 1 ? 's' : ''}`;
        } else if (leaveRequest.durationCategory === 'half') {
            leaveTotalDays = '0.5';
        } else {
            const start = new Date(leaveRequest.startDate);
            const end   = new Date(leaveRequest.endDate);
            leaveTotalDays = String(Math.round((end.getTime() - start.getTime()) / 86400000) + 1);
        }

        // Strict exact-name field setter — finds field by getName() === fieldName only
        const trySet = (fieldName: string, value: string) => {
            const field = allFields.find(f => f.getName() === fieldName);
            if (field) { try { form.getTextField(fieldName).setText(value || ''); } catch (e) {} }
        };
        const tryCheck = (fieldName: string) => {
            const field = allFields.find(f => f.getName() === fieldName);
            if (field) { try { form.getCheckBox(fieldName).check(); } catch (e) {} }
        };

        // ── Text fields (exact names from ALAF_Template_Image_Sig.pdf) ────────────
        trySet('employee_name', getFullName(employee));
        trySet('employee_id',   leaveRequest.idNumber || employee.employeeNumber || '');
        trySet('department',    leaveRequest.department || employee.group || '');
        trySet('contact_info',  leaveRequest.contactInfo || employee.phone || '');
        trySet('date_filed',    formatComponentDate(leaveRequest.dateFiled || new Date()));
        trySet('leave_dates',   datesDisplay);
        trySet('total_days',    leaveTotalDays);
        trySet('reason',        leaveRequest.reason || '');
        trySet('manager_name',  manager ? getFullName(manager) : '');
        trySet('approval_date', formatComponentDate(leaveRequest.managedAt));

        // TARDY is a text field (not checkbox) used for the "Others" label
        if (leaveRequest.type === 'Tardy') trySet('TARDY', 'TARDY');

        // ── Leave type checkboxes (exact names: AVL, EL, VL, SL, PL, ML, BL, SPL, SLW, VAWC)
        // Map leave type values to exact PDF checkbox field names
        const leaveTypeMap: Record<string, string> = {
            'avl': 'AVL', 'el': 'EL', 'emergencyleave': 'EL',
            'vl': 'VL', 'vacationleave': 'VL',
            'sl': 'SL', 'sickleave': 'SL',
            'pl': 'PL', 'personalleave': 'PL',
            'ml': 'ML', 'maternityleave': 'ML',
            'bl': 'BL', 'bereavementleave': 'BL',
            'spl': 'SPL', 'specialleave': 'SPL',
            'slw': 'SLW', 'specialleaveforwomen': 'SLW',
            'vawc': 'VAWC', 'vawcleave': 'VAWC',
        };
        if (leaveRequest.type) {
            const key = leaveRequest.type.toLowerCase().replace(/[^a-z0-9]/g, '');
            const checkboxName = leaveTypeMap[key];
            if (checkboxName) tryCheck(checkboxName);
        }

        // ── Status checkboxes (exact names: approved, rejected) ───────────────────
        const status = leaveRequest.status?.toLowerCase();
        if (status === 'approved') tryCheck('approved');
        if (status === 'rejected') tryCheck('rejected');

        // updateFieldAppearances handles single-line fields but silently skips multiline.
        // fixFieldAppearance manually writes /AP for fields it misses so both focused
        // and unfocused states render correctly (fixes the click/no-click value mismatch).
        form.updateFieldAppearances();
        fixFieldAppearance(pdfDoc, form, 'employee_name', getFullName(employee));
        fixFieldAppearance(pdfDoc, form, 'manager_name',  manager ? getFullName(manager) : '');
        fixFieldAppearance(pdfDoc, form, 'reason',        leaveRequest.reason || '');
        fixFieldAppearance(pdfDoc, form, 'date_filed',    formatComponentDate(leaveRequest.dateFiled || new Date()));
        fixFieldAppearance(pdfDoc, form, 'leave_dates',   datesDisplay);
        fixFieldAppearance(pdfDoc, form, 'total_days',    leaveTotalDays);
        fixFieldAppearance(pdfDoc, form, 'department',    leaveRequest.department || employee.group || '');
        fixFieldAppearance(pdfDoc, form, 'contact_info',  leaveRequest.contactInfo || employee.phone || '');
        fixFieldAppearance(pdfDoc, form, 'employee_id',   leaveRequest.idNumber || employee.employeeNumber || '');
        fixFieldAppearance(pdfDoc, form, 'approval_date', formatComponentDate(leaveRequest.managedAt));
        await embedSignatureToPdf(pdfDoc, leaveRequest.employeeSignature || employee.signature, ['employee_signature_af_image'], 'employee');
        await embedSignatureToPdf(pdfDoc, leaveRequest.managerSignature || manager?.signature, ['manager_signature_af_image'], 'manager');

        const pdfBytes = await pdfDoc.save();
        return { success: true, pdfDataUri: `data:application/pdf;base64,${Buffer.from(pdfBytes).toString('base64')}` };
    } catch (error: any) {
        return { success: false, error: error.message };
    }
}

export async function generateOffsetPdf(leaveRequest: Leave, clientWeRequest?: Leave): Promise<{ success: boolean; pdfDataUri?: string; error?: string; }> {
    const db = getDb();
    try {
        const templateData = db.prepare("SELECT value FROM key_value_store WHERE key = 'offsetTemplate'").get() as { value: string } | undefined;
        if (!templateData || !templateData.value) return { success: false, error: "Offset template not found." };

        const employee = db.prepare("SELECT * FROM employees WHERE id = ?").get(leaveRequest.employeeId) as Employee | undefined;
        const manager  = leaveRequest.managedBy ? db.prepare("SELECT * FROM employees WHERE id = ?").get(leaveRequest.managedBy) as Employee | undefined : undefined;

        // Prefer the client-supplied WE record (has all fields including dateFiled,
        // department, durationCategory etc). Fall back to DB fetch only if not provided.
        let weRequest: Leave | undefined = clientWeRequest;
        let weManager: Employee | undefined;
        if (!weRequest && leaveRequest.claimedWorkExtensionId) {
            weRequest = db.prepare("SELECT * FROM leave WHERE id = ?").get(leaveRequest.claimedWorkExtensionId) as Leave | undefined;
        }
        if (weRequest?.managedBy) {
            weManager = db.prepare("SELECT * FROM employees WHERE id = ?").get(weRequest.managedBy) as Employee | undefined;
        }

        const pdfDoc = await PDFDocument.load(Buffer.from(templateData.value, 'base64'));
        const form = pdfDoc.getForm();
        const allFields = form.getFields();

        // Clear ALL text fields first — prevents any stale/default values
        // from showing through in fields we don't explicitly write to
        allFields.forEach(f => {
            try { form.getTextField(f.getName()).setText(''); } catch (_) {}
        });

        // Compute total days
        let totalDaysValue = '1';
        if (leaveRequest.durationCategory === 'minutes') {
            const mins = leaveRequest.totalMinutes || 0;
            totalDaysValue = `${mins} min${mins !== 1 ? 's' : ''}`;
        } else if (leaveRequest.durationCategory === 'half') {
            totalDaysValue = '0.5';
        }

        // Strict exact-name field setter using getName() === fieldName
        const trySet = (fieldName: string, value: string) => {
            const field = allFields.find(f => f.getName() === fieldName);
            if (field) { try { form.getTextField(fieldName).setText(value || ''); } catch (e) {} }
        };
        const tryCheck = (fieldName: string) => {
            const field = allFields.find(f => f.getName() === fieldName);
            if (field) { try { form.getCheckBox(fieldName).check(); } catch (e) {} }
        };

        // ── ALAF section — offset data only ──────────────────────────────────────
        trySet('employee_name',  getFullName(employee));
        trySet('employee_id',    leaveRequest.idNumber || employee?.employeeNumber || '');
        trySet('department',     leaveRequest.department || employee?.group || '');
        trySet('contact_info',   leaveRequest.contactInfo || employee?.phone || '');
        trySet('date_filed',     formatComponentDate(leaveRequest.dateFiled || new Date()));
        trySet('leave_dates',    formatComponentDate(leaveRequest.startDate));
        trySet('offset_reason',  leaveRequest.reason || '');
        trySet('total_days',     totalDaysValue);
        trySet('manager_name',   manager ? getFullName(manager) : '');
        trySet('approval_date',  formatComponentDate(leaveRequest.managedAt));

        // Status checkboxes
        const status = leaveRequest.status?.toLowerCase();
        if (status === 'approved') tryCheck('approved');
        if (status === 'rejected') tryCheck('rejected');

        // ── WE section — WE record data only ─────────────────────────────────────
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

        form.updateFieldAppearances();

        // fixFieldAppearance manually rebuilds /AP for every field — fixing both:
        // 1. Multiline fields (Ff bit 13) that updateFieldAppearances silently skips
        // 2. Fields whose Rect is on a child widget where updateFieldAppearances
        //    produces an empty stream
        // This ensures the unfocused (rendered) state matches the focused (/V) state.
        fixFieldAppearance(pdfDoc, form, 'employee_name',  getFullName(employee));
        fixFieldAppearance(pdfDoc, form, 'employee_id',    leaveRequest.idNumber || employee?.employeeNumber || '');
        fixFieldAppearance(pdfDoc, form, 'department',     leaveRequest.department || employee?.group || '');
        fixFieldAppearance(pdfDoc, form, 'contact_info',   leaveRequest.contactInfo || employee?.phone || '');
        fixFieldAppearance(pdfDoc, form, 'date_filed',     formatComponentDate(leaveRequest.dateFiled || new Date()));
        fixFieldAppearance(pdfDoc, form, 'leave_dates',    formatComponentDate(leaveRequest.startDate));
        fixFieldAppearance(pdfDoc, form, 'offset_reason',  leaveRequest.reason || '');
        fixFieldAppearance(pdfDoc, form, 'total_days',     totalDaysValue);
        fixFieldAppearance(pdfDoc, form, 'manager_name',   manager ? getFullName(manager) : '');
        fixFieldAppearance(pdfDoc, form, 'approval_date',  formatComponentDate(leaveRequest.managedAt));
        if (weRequest) {
            fixFieldAppearance(pdfDoc, form, 'we_employee_name', getFullName(employee));
            fixFieldAppearance(pdfDoc, form, 'we_department',    weRequest.department || employee?.group || '');
            fixFieldAppearance(pdfDoc, form, 'we_date_filed',    formatComponentDate(weRequest.dateFiled || weRequest.requestedAt || new Date()));
            fixFieldAppearance(pdfDoc, form, 'extended_date',    formatComponentDate(weRequest.startDate));
            fixFieldAppearance(pdfDoc, form, 'we_shiftfrom',     weRequest.originalStartTime || '');
            fixFieldAppearance(pdfDoc, form, 'we_shiftto',       weRequest.originalEndTime   || '');
            fixFieldAppearance(pdfDoc, form, 'we_timein',        weRequest.startTime || '');
            fixFieldAppearance(pdfDoc, form, 'we_timeout',       weRequest.endTime   || '');
            fixFieldAppearance(pdfDoc, form, 'we_extendfrom',    weRequest.startTime || '');
            fixFieldAppearance(pdfDoc, form, 'we_extendto',      weRequest.endTime   || '');
            fixFieldAppearance(pdfDoc, form, 'we_reason',        weRequest.reason || '');
            fixFieldAppearance(pdfDoc, form, 'we_manager_name',  weManager ? getFullName(weManager) : '');
        }

        await embedSignatureToPdf(pdfDoc, leaveRequest.employeeSignature || employee?.signature, ['employee_signature_af_image'], 'employee');
        await embedSignatureToPdf(pdfDoc, leaveRequest.managerSignature  || manager?.signature,  ['manager_signature_af_image'],  'manager');
        if (weRequest) {
            await embedSignatureToPdf(pdfDoc, weRequest.employeeSignature, ['we_employee_signature_af_image'], 'employee');
            await embedSignatureToPdf(pdfDoc, weRequest.managerSignature,  ['we_manager_signature_af_image'],  'manager');
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

        const token = crypto.randomBytes(32).toString('hex'); // FIX #3: cryptographically secure token
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

        const token = crypto.randomBytes(32).toString('hex'); // FIX #3: cryptographically secure token
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

// ── Dedicated binary field save actions ──────────────────────────────────────
// These write large binary fields directly to DB without going through the
// general saveAllData payload, preventing NetworkError from oversized payloads.

export async function savePdfDataUri(leaveId: string, pdfDataUri: string): Promise<{ success: boolean; error?: string }> {
    try {
        const db = getDb();
        db.prepare('UPDATE leave SET pdfDataUri = ? WHERE id = ?').run(pdfDataUri, leaveId);
        return { success: true };
    } catch (error) {
        return { success: false, error: (error as Error).message };
    }
}

export async function saveLeaveSignatures(leaveId: string, employeeSignature?: string, managerSignature?: string): Promise<{ success: boolean; error?: string }> {
    try {
        const db = getDb();
        if (employeeSignature) db.prepare('UPDATE leave SET employeeSignature = ? WHERE id = ?').run(employeeSignature, leaveId);
        if (managerSignature)  db.prepare('UPDATE leave SET managerSignature  = ? WHERE id = ?').run(managerSignature,  leaveId);
        return { success: true };
    } catch (error) {
        return { success: false, error: (error as Error).message };
    }
}

export async function saveAllowanceScreenshot(allowanceId: string, screenshot: string): Promise<{ success: boolean; error?: string }> {
    try {
        const db = getDb();
        db.prepare('UPDATE communication_allowances SET screenshot = ? WHERE id = ?').run(screenshot, allowanceId);
        return { success: true };
    } catch (error) {
        return { success: false, error: (error as Error).message };
    }
}

export async function saveTemplate(key: string, value: string): Promise<{ success: boolean; error?: string }> {
    try {
        const db = getDb();
        db.prepare(`
            INSERT INTO key_value_store (key, value) VALUES (?, ?)
            ON CONFLICT(key) DO UPDATE SET value = excluded.value
        `).run(key, value);
        return { success: true };
    } catch (error) {
        return { success: false, error: (error as Error).message };
    }
}

// ── Leave Recipients (external Company/Division admins) ───────────────────────

export type LeaveRecipient = {
    id: string;
    name: string;
    email: string;
    role: string;
    isDefault: boolean;
};

export async function getLeaveRecipients(): Promise<{ success: boolean; recipients?: LeaveRecipient[]; error?: string }> {
    try {
        const db = getDb();
        const rows = db.prepare('SELECT * FROM leave_recipients ORDER BY isDefault DESC, name ASC').all() as any[];
        return {
            success: true,
            recipients: rows.map(r => ({ ...r, isDefault: r.isDefault === 1 }))
        };
    } catch (error) {
        return { success: false, error: (error as Error).message };
    }
}

export async function saveLeaveRecipient(recipient: LeaveRecipient): Promise<{ success: boolean; error?: string }> {
    try {
        const db = getDb();
        db.prepare(`
            INSERT INTO leave_recipients (id, name, email, role, isDefault)
            VALUES (@id, @name, @email, @role, @isDefault)
            ON CONFLICT(id) DO UPDATE SET
                name=excluded.name, email=excluded.email,
                role=excluded.role, isDefault=excluded.isDefault
        `).run({ ...recipient, isDefault: recipient.isDefault ? 1 : 0 });
        return { success: true };
    } catch (error) {
        return { success: false, error: (error as Error).message };
    }
}

export async function deleteLeaveRecipient(id: string): Promise<{ success: boolean; error?: string }> {
    try {
        const db = getDb();
        db.prepare('DELETE FROM leave_recipients WHERE id = ?').run(id);
        return { success: true };
    } catch (error) {
        return { success: false, error: (error as Error).message };
    }
}

export async function getLeaveWithPdf(leaveId: string): Promise<{ success: boolean; pdfDataUri?: string; employeeSignature?: string; managerSignature?: string; error?: string }> {
    try {
        const db = getDb();
        const row = db.prepare('SELECT pdfDataUri, employeeSignature, managerSignature FROM leave WHERE id = ?').get(leaveId) as any;
        if (!row) return { success: false, error: 'Leave record not found.' };
        return { success: true, pdfDataUri: row.pdfDataUri, employeeSignature: row.employeeSignature, managerSignature: row.managerSignature };
    } catch (error) {
        return { success: false, error: (error as Error).message };
    }
}

export async function getEmployeeBinary(employeeId: string): Promise<{ success: boolean; avatar?: string; signature?: string; error?: string }> {
    try {
        const db = getDb();
        const row = db.prepare('SELECT avatar, signature FROM employees WHERE id = ?').get(employeeId) as any;
        if (!row) return { success: false, error: 'Employee not found.' };
        return { success: true, avatar: row.avatar, signature: row.signature };
    } catch (error) {
        return { success: false, error: (error as Error).message };
    }
}
