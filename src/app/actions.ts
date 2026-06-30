'use server';

import type { SmtpSettings, Employee, Shift, AppVisibility, Leave } from '@/types';
import nodemailer from 'nodemailer';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import { getDb } from '@/lib/db';
import fs from 'fs';
import path from 'path';
import { PDFDocument, PDFName, StandardFonts } from 'pdf-lib';
import { isSameDay } from 'date-fns';
import { requireAuth, requireAdmin, requireManager } from '@/lib/auth-guard';
import { getFullName } from '@/lib/utils';
import {
    saveTemplate as saveTemplateFile, readTemplate, templateExists,
    savePdf, readPdf, pdfExists, deletePdf,
    saveAvatar as saveAvatarFile, readAvatar,
    saveSignature as saveSignatureFile, readSignature,
    saveScreenshot as saveScreenshotFile, readScreenshot,
    ensureUploadDirs,
} from '@/lib/file-storage';

import { isLocked, trackFailed, clearAttempts } from '@/lib/rate-limit';

/** Parses a YYYY-MM-DD string as local midnight to avoid UTC shift (UTC+8 Philippines). */
function parseLocalDate(dateStr: string | Date | null | undefined): Date {
  if (!dateStr) return new Date();
  if (dateStr instanceof Date) return isNaN(dateStr.getTime()) ? new Date() : dateStr;
  if (typeof dateStr !== 'string') return new Date(dateStr as any);
  if (dateStr.includes('T') || dateStr.includes(' ')) return new Date(dateStr);
  return new Date(dateStr + 'T00:00:00');
}


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
/**
 * Manually writes a correct /AP (appearance stream) for a text field, embedding
 * a real font resource so the field renders identically whether focused or not.
 *
 * Root cause this fixes: pdf-lib's form.updateFieldAppearances() resolves each
 * field's font from its /DA (default appearance) string, looked up against the
 * form's /DR (default resources) dictionary. When a PDF template was produced by
 * software that left /DR incomplete or pointing to a font not actually embedded,
 * pdf-lib silently produces an empty appearance stream for that field — the /V
 * value is still set correctly, which is why some viewers show the text only
 * while the field is focused (they render live from /V in edit mode) but blank
 * otherwise (rendering from the broken /AP). This function bypasses that broken
 * resolution entirely by embedding a known-good font directly into the field's
 * own appearance stream resources, guaranteeing both states render the same way.
 */
function fixFieldAppearance(pdfDoc: PDFDocument, form: any, fieldName: string, value: string, font: any): void {
    try {
        const allFields = form.getFields();
        const normalize = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
        const target = normalize(fieldName);

        let field = allFields.find((f: any) => f.getName() === fieldName);
        if (!field) field = allFields.find((f: any) => normalize(f.getName()) === target);
        if (!field) field = allFields.find((f: any) => normalize(f.getName()).endsWith(target));
        if (!field) return;

        const dict = field.acroField.dict;

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
        if (!w || !h || w <= 0 || h <= 0) return;

        const fontSize = 8;
        const margin = 2;
        const lineHeight = fontSize * 1.35;

        const escape = (s: string) => s.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');

        // Always write a stream — even for empty values — so a stale appearance
        // from a previous fill never lingers on the rendered page.
        const lines = (value || '').split('\n');
        let y = h - margin - fontSize;
        let content = `/Tx BMC\nq\nBT\n/F0 ${fontSize} Tf\n0 g\n`;
        for (const line of lines) {
            content += `${margin} ${y.toFixed(2)} Td\n(${escape(line)}) Tj\n0 ${(-lineHeight).toFixed(2)} Td\n`;
            y -= lineHeight;
        }
        content += `ET\nQ\nEMC\n`;

        const streamBytes = Buffer.from(content, 'latin1');
        // Embed the font directly as a resource on THIS appearance stream —
        // this is the key fix. We no longer depend on the form's shared /DR
        // dictionary resolving correctly; the font reference here is guaranteed
        // valid because `font` was embedded into pdfDoc earlier in this request.
        const apStream = pdfDoc.context.stream(streamBytes, {
            Subtype: 'Form',
            BBox: pdfDoc.context.obj([0, 0, w, h]),
            Resources: pdfDoc.context.obj({ Font: { F0: font.ref } }),
        });
        const apStreamRef = pdfDoc.context.register(apStream);
        widgetDict.set(PDFName.of('AP'), pdfDoc.context.obj({ N: apStreamRef }));
    } catch (_) {
        // If this fails, the /V value set earlier by setText() is untouched
        // and most viewers will still show it when the field is focused.
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
    if (!smtpSettings.host || !smtpSettings.port || !smtpSettings.user) {
        return { success: false, error: 'SMTP connection settings (Host, Port, User) are not fully configured.' };
    }

    // Always read SMTP password fresh from DB server-side — never trust client-supplied value
    const { getDb } = await import('@/lib/db');
    const dbSmtp = getDb().prepare('SELECT pass FROM smtp_settings WHERE id = 1').get() as any;
    const smtpPass = dbSmtp?.pass;
    if (!smtpPass) {
        return { success: false, error: 'SMTP password is not configured.' };
    }

    const isSecure = smtpSettings.port === 465 || smtpSettings.secure;

    const transporter = nodemailer.createTransport({
        host: smtpSettings.host,
        port: Number(smtpSettings.port),
        secure: isSecure,
        auth: {
            user: smtpSettings.user,
            pass: smtpPass,
        },
        tls: {
            rejectUnauthorized: true,
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

    // ── Rate limiting (DB-backed, persists across restarts) ──────────────────
    if (isLocked(key)) {
        return { success: false, error: 'Too many failed attempts. Account is locked for 15 minutes.' };
    }

    try {
        const userRow = db.prepare('SELECT * FROM employees WHERE email = ?').get(key) as any;

        if (userRow) {
            const user = JSON.parse(JSON.stringify(userRow)) as Employee;

            let isMatch = false;
            if (user.password && user.password.startsWith('$2')) {
                isMatch = await bcrypt.compare(password, user.password);
            } else if (user.password) {
                isMatch = user.password === password;
                if (isMatch) {
                    const hashed = await bcrypt.hash(password, 12);
                    db.prepare('UPDATE employees SET password = ? WHERE id = ?').run(hashed, user.id);
                }
            }

            if (isMatch) {
                clearAttempts(key);
                const { password: _pw, totpSecret: _ts, ...safeUser } = user as any;
                return { success: true, user: safeUser as Employee };
            }
        }

        trackFailed(key);
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
                date: parseLocalDate(s.date),
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


export async function purgeData(dataType: 'users' | 'shiftTemplates' | 'holidays' | 'reportTemplates' | 'tasks' | 'mobileLoad' | 'leaveTypes' | 'groups' | 'leave' | 'shifts'): Promise<{ success: boolean; error?: string }> {
    try { await requireAdmin(); } catch (e) { return { success: false, error: (e as Error).message }; }
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
            case 'shifts':
                db.prepare('DELETE FROM shifts').run();
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
    try { await requireAuth(); } catch (e) { return { success: false, error: (e as Error).message }; }
    const db = getDb();
    try {
        // Read template from disk first, fall back to DB for backwards compatibility
        let templateBase64 = readTemplate('alafTemplate');
        if (!templateBase64) {
            const templateData = db.prepare("SELECT value FROM key_value_store WHERE key = 'alafTemplate'").get() as { value: string } | undefined;
            if (!templateData?.value) return { success: false, error: "ALAF template not found. Please re-upload it in Settings → Report Templates." };
            if (templateData.value.startsWith('file:')) return { success: false, error: "ALAF template file is missing from disk. Please re-upload it in Settings → Report Templates. (The file was previously uploaded but is no longer on disk — this can happen after a server migration or deploy.)" };
            templateBase64 = templateData.value;
        }

        const employee = db.prepare("SELECT * FROM employees WHERE id = ?").get(leaveRequest.employeeId) as Employee | undefined;
        if (!employee) return { success: false, error: "Employee not found." };
        const manager = leaveRequest.managedBy ? db.prepare("SELECT * FROM employees WHERE id = ?").get(leaveRequest.managedBy) as Employee | undefined : undefined;

        // Read signatures from disk
        const employeeSig = readSignature(leaveRequest.employeeId) || readSignature(`leave_emp_${leaveRequest.id}`);
        const managerSig  = manager ? (readSignature(manager.id) || readSignature(`leave_mgr_${leaveRequest.id}`)) : undefined;

        const pdfDoc = await PDFDocument.load(Buffer.from(templateBase64, 'base64'));
        const form = pdfDoc.getForm();
        const allFields = form.getFields();

        // Compute dates display
        const startDateStr = formatComponentDate(leaveRequest.startDate);
        const endDateStr = formatComponentDate(leaveRequest.endDate);
        const datesDisplay = isSameDay(parseLocalDate(leaveRequest.startDate), parseLocalDate(leaveRequest.endDate))
            ? startDateStr : `${startDateStr} to ${endDateStr}`;

        // Compute total days
        let leaveTotalDays = '';
        if (leaveRequest.durationCategory === 'minutes') {
            const mins = leaveRequest.totalMinutes || 0;
            leaveTotalDays = `${mins} min${mins !== 1 ? 's' : ''}`;
        } else if (leaveRequest.durationCategory === 'half') {
            leaveTotalDays = '0.5';
        } else {
            const start = parseLocalDate(leaveRequest.startDate);
            const end   = parseLocalDate(leaveRequest.endDate);
            leaveTotalDays = String(Math.round((end.getTime() - start.getTime()) / 86400000) + 1);
        }

        // Robust field setter — exact name, then normalized, then suffix match.
        // Tracks every value it sets so we can regenerate appearances for
        // exactly those fields afterward (see fixFieldAppearance calls below).
        const normalizeName = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
        const findField = (fieldName: string) => {
            let field = allFields.find(f => f.getName() === fieldName);
            if (field) return field;
            const target = normalizeName(fieldName);
            field = allFields.find(f => normalizeName(f.getName()) === target);
            if (field) return field;
            return allFields.find(f => normalizeName(f.getName()).endsWith(target));
        };
        const setFieldValues: Record<string, string> = {};
        const trySet = (fieldName: string, value: string) => {
            const field = findField(fieldName);
            if (!field) return;
            try {
                form.getTextField(field.getName()).setText(value || '');
                setFieldValues[fieldName] = value || '';
            } catch (e) {}
        };
        const tryCheck = (fieldName: string) => {
            const field = findField(fieldName);
            if (field) { try { form.getCheckBox(field.getName()).check(); } catch (e) {} }
        };

        // ── Text fields (exact names from ALAF_Template_Image_Sig.pdf) ────────────
        trySet('employee_name', getFullName(employee));
        trySet('employee_id',   leaveRequest.idNumber || employee.employeeNumber || '');
        trySet('department',    leaveRequest.department || employee.department || employee.group || '');
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

        // ── Appearance generation (the actual fix) ────────────────────────────
        // 1. Embed a real, known-good font directly into this document.
        // 2. Regenerate every text field's appearance using THAT font reference
        //    rather than relying on the template's /DR dictionary, which is
        //    often incomplete/broken in templates exported from third-party tools.
        // 3. Only after every field's appearance is confirmed correct do we
        //    flatten the form — baking in the now-correct appearances permanently
        //    so the PDF renders identically in every viewer, focused or not.
        const embeddedFont = await pdfDoc.embedFont(StandardFonts.Helvetica);
        try { form.updateFieldAppearances(embeddedFont); } catch (_) {}
        for (const [fName, fValue] of Object.entries(setFieldValues)) {
            fixFieldAppearance(pdfDoc, form, fName, fValue, embeddedFont);
        }
        await embedSignatureToPdf(pdfDoc, employeeSig || leaveRequest.employeeSignature, ['employee_signature_af_image'], 'employee');
        await embedSignatureToPdf(pdfDoc, managerSig  || leaveRequest.managerSignature,  ['manager_signature_af_image'],  'manager');

        // Flatten now that every field's appearance stream is confirmed correct —
        // this bakes the text into the page permanently so it's identical in
        // every PDF viewer regardless of focus state. Signature images (drawn as
        // /AP image XObjects, not form fields) are unaffected by flattening.
        try { form.flatten(); } catch (_) {
            // If flattening fails for any reason, fall back to leaving the form
            // fields in place — appearances are already correct at this point,
            // so the PDF will still render properly even without flattening.
        }

        const pdfBytes = await pdfDoc.save();
        const pdfDataUri = `data:application/pdf;base64,${Buffer.from(pdfBytes).toString('base64')}`;

        // Save generated PDF to disk
        savePdf(leaveRequest.id, pdfDataUri);
        db.prepare('UPDATE leave SET pdfDataUri = ? WHERE id = ?').run(`file:${leaveRequest.id}.pdf`, leaveRequest.id);

        return { success: true, pdfDataUri };
    } catch (error: any) {
        return { success: false, error: error.message };
    }
}

export async function generateOffsetPdf(leaveRequest: Leave, clientWeRequest?: Leave): Promise<{ success: boolean; pdfDataUri?: string; error?: string; }> {
    try { await requireAuth(); } catch (e) { return { success: false, error: (e as Error).message }; }
    const db = getDb();
    try {
        // Read template from disk first, fall back to DB for backwards compatibility
        let templateBase64 = readTemplate('offsetTemplate');
        if (!templateBase64) {
            const templateData = db.prepare("SELECT value FROM key_value_store WHERE key = 'offsetTemplate'").get() as { value: string } | undefined;
            if (!templateData?.value) return { success: false, error: "Offset template not found. Please re-upload it in Settings → Report Templates." };
            if (templateData.value.startsWith('file:')) return { success: false, error: "Offset template file is missing from disk. Please re-upload it in Settings → Report Templates. (The file was previously uploaded but is no longer on disk — this can happen after a server migration or deploy.)" };
            templateBase64 = templateData.value;
        }

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

        // Read signatures from disk
        const employeeSig = readSignature(leaveRequest.employeeId) || readSignature(`leave_emp_${leaveRequest.id}`);
        const managerSig  = manager ? (readSignature(manager.id) || readSignature(`leave_mgr_${leaveRequest.id}`)) : undefined;
        const weEmployeeSig = weRequest ? (readSignature(`leave_emp_${weRequest.id}`) || employeeSig) : undefined;
        const weManagerSig  = weManager ? (readSignature(weManager.id) || readSignature(`leave_mgr_${weRequest?.id}`)) : undefined;

        const pdfDoc = await PDFDocument.load(Buffer.from(templateBase64, 'base64'));
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

        // Robust field setter — exact name, then normalized, then suffix match.
        const normalizeName = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
        const findField = (fieldName: string) => {
            let field = allFields.find(f => f.getName() === fieldName);
            if (field) return field;
            const target = normalizeName(fieldName);
            field = allFields.find(f => normalizeName(f.getName()) === target);
            if (field) return field;
            return allFields.find(f => normalizeName(f.getName()).endsWith(target));
        };
        const setFieldValues: Record<string, string> = {};
        const trySet = (fieldName: string, value: string) => {
            const field = findField(fieldName);
            if (!field) return;
            try {
                form.getTextField(field.getName()).setText(value || '');
                setFieldValues[fieldName] = value || '';
            } catch (e) {}
        };
        const tryCheck = (fieldName: string) => {
            const field = findField(fieldName);
            if (field) { try { form.getCheckBox(field.getName()).check(); } catch (e) {} }
        };

        // ── ALAF section — offset data only ──────────────────────────────────────
        trySet('employee_name',  getFullName(employee));
        trySet('employee_id',    leaveRequest.idNumber || employee?.employeeNumber || '');
        trySet('department',     leaveRequest.department || employee?.department || employee?.group || '');
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
            trySet('we_department',    weRequest.department || employee?.department || employee?.group || '');
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

        // ── Appearance generation (same fix as generateLeavePdf) ──────────────
        const embeddedFont = await pdfDoc.embedFont(StandardFonts.Helvetica);
        try { form.updateFieldAppearances(embeddedFont); } catch (_) {}
        for (const [fName, fValue] of Object.entries(setFieldValues)) {
            fixFieldAppearance(pdfDoc, form, fName, fValue, embeddedFont);
        }

        await embedSignatureToPdf(pdfDoc, employeeSig || leaveRequest.employeeSignature || employee?.signature, ['employee_signature_af_image'], 'employee');
        await embedSignatureToPdf(pdfDoc, managerSig  || leaveRequest.managerSignature  || manager?.signature,  ['manager_signature_af_image'],  'manager');

        // Flatten now that every field's appearance is confirmed correct.
        try { form.flatten(); } catch (_) {
            // Falls back to leaving fields in place — appearances are already
            // correct, so the PDF still renders properly without flattening.
        }
        if (weRequest) {
            await embedSignatureToPdf(pdfDoc, weEmployeeSig, ['we_employee_signature_af_image'], 'employee');
            await embedSignatureToPdf(pdfDoc, weManagerSig,  ['we_manager_signature_af_image'],  'manager');
        }

        const pdfBytes = await pdfDoc.save();
        const pdfDataUri = `data:application/pdf;base64,${Buffer.from(pdfBytes).toString('base64')}`;

        // Save generated PDF to disk
        savePdf(leaveRequest.id, pdfDataUri);
        db.prepare('UPDATE leave SET pdfDataUri = ? WHERE id = ?').run(`file:${leaveRequest.id}.pdf`, leaveRequest.id);

        return { success: true, pdfDataUri };
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
        const { validatePassword } = await import('@/lib/password-rules');
        const { valid, errors } = validatePassword(newPassword);
        if (!valid) return { success: false, error: errors[0] };

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
    try { await requireAuth(); } catch (e) { return { success: false, error: (e as Error).message }; }
    try {
        savePdf(leaveId, pdfDataUri);
        // Mark hasPdf in DB — no longer store the actual data URI
        const db = getDb();
        db.prepare('UPDATE leave SET pdfDataUri = ? WHERE id = ?').run(`file:${leaveId}.pdf`, leaveId);
        return { success: true };
    } catch (error) {
        return { success: false, error: (error as Error).message };
    }
}

export async function saveLeaveSignatures(leaveId: string, employeeSignature?: string, managerSignature?: string): Promise<{ success: boolean; error?: string }> {
    try { await requireAuth(); } catch (e) { return { success: false, error: (e as Error).message }; }
    try {
        const db = getDb();
        if (employeeSignature) {
            const path = saveSignatureFile(`leave_emp_${leaveId}`, employeeSignature);
            db.prepare('UPDATE leave SET employeeSignature = ? WHERE id = ?').run(`file:leave_emp_${leaveId}`, leaveId);
        }
        if (managerSignature) {
            const path = saveSignatureFile(`leave_mgr_${leaveId}`, managerSignature);
            db.prepare('UPDATE leave SET managerSignature = ? WHERE id = ?').run(`file:leave_mgr_${leaveId}`, leaveId);
        }
        return { success: true };
    } catch (error) {
        return { success: false, error: (error as Error).message };
    }
}

export async function saveAllowanceScreenshot(allowanceId: string, screenshot: string): Promise<{ success: boolean; error?: string }> {
    try { await requireAuth(); } catch (e) { return { success: false, error: (e as Error).message }; }
    try {
        const filePath = saveScreenshotFile(allowanceId, screenshot);
        const db = getDb();
        db.prepare('UPDATE communication_allowances SET screenshot = ? WHERE id = ?').run(`file:${allowanceId}`, allowanceId);
        return { success: true };
    } catch (error) {
        return { success: false, error: (error as Error).message };
    }
}

export async function saveTemplate(key: string, value: string): Promise<{ success: boolean; error?: string }> {
    await requireManager();
    try {
        // Save to disk
        saveTemplateFile(key, value);
        // Keep a marker in key_value_store so we know the template exists
        const db = getDb();
        db.prepare(`
            INSERT INTO key_value_store (key, value) VALUES (?, ?)
            ON CONFLICT(key) DO UPDATE SET value = excluded.value
        `).run(key, `file:${key}.pdf`);
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
    try { await requireAuth(); } catch (e) { return { success: false, error: (e as Error).message }; }
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
    try { await requireManager(); } catch (e) { return { success: false, error: (e as Error).message }; }
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
    try { await requireManager(); } catch (e) { return { success: false, error: (e as Error).message }; }
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
        await requireAuth();
        const pdfDataUri = readPdf(leaveId) || undefined;
        const employeeSignature = readSignature(`leave_emp_${leaveId}`) || undefined;
        const managerSignature  = readSignature(`leave_mgr_${leaveId}`) || undefined;
        return { success: true, pdfDataUri, employeeSignature, managerSignature };
    } catch (error) {
        return { success: false, error: (error as Error).message };
    }
}

export async function getEmployeeBinary(employeeId: string): Promise<{ success: boolean; avatar?: string; signature?: string; error?: string }> {
    try {
        await requireAuth();
        const avatar    = readAvatar(employeeId)    || undefined;
        const signature = readSignature(employeeId) || undefined;
        return { success: true, avatar, signature };
    } catch (error) {
        return { success: false, error: (error as Error).message };
    }
}

export async function backupDatabase(): Promise<{ success: boolean; data?: string; error?: string }> {
    try {
        await requireAdmin();
        const dbPath = path.join(process.cwd(), 'local.db');
        const db = getDb();
        // Checkpoint WAL so the backup file is complete
        db.pragma('wal_checkpoint(FULL)');
        const buffer = fs.readFileSync(dbPath);
        const base64 = buffer.toString('base64');
        return { success: true, data: base64 };
    } catch (error) {
        return { success: false, error: (error as Error).message };
    }
}

export async function restoreDatabase(base64Data: string): Promise<{ success: boolean; error?: string }> {
    try {
        await requireAdmin();
        const dbPath = path.join(process.cwd(), 'local.db');
        // Close the current DB connection before overwriting the file
        const { dbInstance } = await import('@/lib/db');
        if (dbInstance) dbInstance.close();
        const buffer = Buffer.from(base64Data, 'base64');
        fs.writeFileSync(dbPath, buffer);
        return { success: true };
    } catch (error) {
        return { success: false, error: (error as Error).message };
    }
}

// ── Persistent Notifications ──────────────────────────────────────────────────

export type DbNotification = {
    id: string;
    employee_id: string;
    message: string;
    is_read: boolean;
    link: string | null;
    ts: string;
};

export async function getNotifications(): Promise<{ success: boolean; data?: DbNotification[]; error?: string }> {
    try {
        await requireAuth();
        const { auth } = await import('@/auth');
        const session = await auth();
        if (!session?.user?.id) return { success: false, error: 'Not authenticated' };
        const db = getDb();
        const rows = db.prepare(
            "SELECT * FROM notifications WHERE employee_id = ? ORDER BY ts DESC LIMIT 100"
        ).all(session.user.id) as any[];
        const data: DbNotification[] = rows.map(r => ({ ...r, is_read: !!r.is_read }));
        return { success: true, data };
    } catch (error) {
        return { success: false, error: (error as Error).message };
    }
}

export async function addDbNotification(params: {
    employeeId: string;
    message: string;
    link?: string;
}): Promise<{ success: boolean; error?: string }> {
    try {
        const db = getDb();
        const { v4: uuidv4 } = await import('uuid');
        db.prepare(
            "INSERT INTO notifications (id, employee_id, message, link) VALUES (?, ?, ?, ?)"
        ).run(uuidv4(), params.employeeId, params.message, params.link ?? null);
        return { success: true };
    } catch (error) {
        return { success: false, error: (error as Error).message };
    }
}

export async function markNotificationsRead(ids?: string[]): Promise<{ success: boolean; error?: string }> {
    try {
        await requireAuth();
        const { auth } = await import('@/auth');
        const session = await auth();
        if (!session?.user?.id) return { success: false, error: 'Not authenticated' };
        const db = getDb();
        if (ids && ids.length > 0) {
            db.prepare(
                `UPDATE notifications SET is_read = 1 WHERE employee_id = ? AND id IN (${ids.map(() => '?').join(',')})`
            ).run(session.user.id, ...ids);
        } else {
            db.prepare("UPDATE notifications SET is_read = 1 WHERE employee_id = ?").run(session.user.id);
        }
        return { success: true };
    } catch (error) {
        return { success: false, error: (error as Error).message };
    }
}

export async function deleteNotification(id: string): Promise<{ success: boolean; error?: string }> {
    try {
        await requireAuth();
        const { auth } = await import('@/auth');
        const session = await auth();
        if (!session?.user?.id) return { success: false, error: 'Not authenticated' };
        const db = getDb();
        db.prepare("DELETE FROM notifications WHERE id = ? AND employee_id = ?").run(id, session.user.id);
        return { success: true };
    } catch (error) {
        return { success: false, error: (error as Error).message };
    }
}

// ── Maintenance Mode ──────────────────────────────────────────────────────────

export async function getMaintenanceMode(): Promise<{ enabled: boolean; message: string }> {
    try {
        const db = getDb();
        const row    = db.prepare("SELECT value FROM key_value_store WHERE key = 'maintenance_mode'").get()    as { value: string } | undefined;
        const msgRow = db.prepare("SELECT value FROM key_value_store WHERE key = 'maintenance_message'").get() as { value: string } | undefined;
        return { enabled: row?.value === '1', message: msgRow?.value || "We're performing scheduled maintenance and will be back shortly." };
    } catch { return { enabled: false, message: '' }; }
}

export async function setMaintenanceMode(enabled: boolean, message?: string): Promise<{ success: boolean; error?: string }> {
    try {
        await requireAdmin();
        const db = getDb();
        db.prepare("INSERT INTO key_value_store (key, value) VALUES ('maintenance_mode', ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(enabled ? '1' : '0');
        if (message !== undefined) {
            db.prepare("INSERT INTO key_value_store (key, value) VALUES ('maintenance_message', ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(message);
        }
        const { cookies } = await import('next/headers');
        const cookieStore = await cookies();
        if (enabled) cookieStore.set('onduty_maintenance', '1', { path: '/', httpOnly: true, sameSite: 'lax', maxAge: 60 * 60 * 24 * 365 });
        else cookieStore.delete('onduty_maintenance');
        return { success: true };
    } catch (error) { return { success: false, error: (error as Error).message }; }
}

// ── Audit Logs ────────────────────────────────────────────────────────────────

export type AuditLogEntry = {
    id: number; ts: string; actor_id: string | null; actor_name: string | null;
    action: string; target_type: string | null; target_id: string | null;
    target_name: string | null; detail: string | null; ip: string | null;
};

export async function getAuditLogs(opts?: { limit?: number; offset?: number; action?: string }): Promise<{ success: boolean; data?: AuditLogEntry[]; total?: number; error?: string }> {
    try {
        await requireAdmin();
        const db = getDb();
        const limit = opts?.limit ?? 50; const offset = opts?.offset ?? 0;
        const action = opts?.action?.trim();
        let where = ''; const params: (string | number)[] = [];
        if (action) { where = 'WHERE action LIKE ?'; params.push(`%${action}%`); }
        const total = (db.prepare(`SELECT COUNT(*) AS n FROM audit_logs ${where}`).get(...params) as { n: number }).n;
        const data  = db.prepare(`SELECT * FROM audit_logs ${where} ORDER BY ts DESC LIMIT ? OFFSET ?`).all(...params, limit, offset) as AuditLogEntry[];
        return { success: true, data, total };
    } catch (error) { return { success: false, error: (error as Error).message }; }
}

export async function writeAuditLog(entry: { action: string; targetType?: string; targetId?: string; targetName?: string; detail?: string }): Promise<void> {
    try {
        const { auth } = await import('@/auth');
        const session = await auth();
        const db = getDb();
        db.prepare(`INSERT INTO audit_logs (actor_id, actor_name, action, target_type, target_id, target_name, detail) VALUES (?, ?, ?, ?, ?, ?, ?)`)
          .run(session?.user?.id ?? null, session?.user?.name ?? null, entry.action, entry.targetType ?? null, entry.targetId ?? null, entry.targetName ?? null, entry.detail ?? null);
    } catch (_) {}
}

// ── Named API Keys ────────────────────────────────────────────────────────────

export type ApiKeyRecord = { id: string; name: string; key_value: string; created_at: string; };

function ensureApiKeysTable(db: ReturnType<typeof getDb>) {
    db.exec(`CREATE TABLE IF NOT EXISTS api_keys (id TEXT PRIMARY KEY, name TEXT NOT NULL, key_value TEXT NOT NULL UNIQUE, created_at TEXT NOT NULL DEFAULT (datetime('now')))`);
}

export async function getApiKeys(): Promise<{ success: boolean; keys?: ApiKeyRecord[]; error?: string }> {
    try { await requireAdmin(); const db = getDb(); ensureApiKeysTable(db); return { success: true, keys: db.prepare('SELECT * FROM api_keys ORDER BY created_at ASC').all() as ApiKeyRecord[] }; }
    catch (error) { return { success: false, error: (error as Error).message }; }
}

export async function createApiKey(name: string): Promise<{ success: boolean; key?: ApiKeyRecord; error?: string }> {
    try {
        await requireAdmin(); if (!name?.trim()) return { success: false, error: 'Name is required.' };
        const db = getDb(); ensureApiKeysTable(db);
        const id = crypto.randomUUID(); const key_value = 'od_' + crypto.randomBytes(32).toString('hex'); const created_at = new Date().toISOString();
        db.prepare('INSERT INTO api_keys (id, name, key_value, created_at) VALUES (?, ?, ?, ?)').run(id, name.trim(), key_value, created_at);
        return { success: true, key: { id, name: name.trim(), key_value, created_at } };
    } catch (error) { return { success: false, error: (error as Error).message }; }
}

export async function deleteApiKey(id: string): Promise<{ success: boolean; error?: string }> {
    try { await requireAdmin(); getDb().prepare('DELETE FROM api_keys WHERE id = ?').run(id); return { success: true }; }
    catch (error) { return { success: false, error: (error as Error).message }; }
}

// ── Report Schedules ──────────────────────────────────────────────────────────

export type ReportSchedule = {
    id: string; name: string; report_type: string; frequency: string;
    day_of_week: number | null; day_of_month: number | null; scheduled_date: string | null;
    recipient_emails: string; subject_template: string; body_template: string;
    date_range_type: string; group_filter: string | null; created_by: string;
    created_at: string; last_sent_at: string | null; is_active: number;
};

function ensureReportSchedulesTable(db: ReturnType<typeof getDb>) {
    db.exec(`CREATE TABLE IF NOT EXISTS report_schedules (
        id TEXT PRIMARY KEY, name TEXT NOT NULL, report_type TEXT NOT NULL, frequency TEXT NOT NULL,
        day_of_week INTEGER, day_of_month INTEGER, scheduled_date TEXT,
        recipient_emails TEXT NOT NULL, subject_template TEXT NOT NULL, body_template TEXT NOT NULL,
        date_range_type TEXT NOT NULL, group_filter TEXT, created_by TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now')), last_sent_at TEXT, is_active INTEGER NOT NULL DEFAULT 1)`);
}

export async function getReportSchedules(): Promise<{ success: boolean; schedules?: ReportSchedule[]; error?: string }> {
    try { await requireAdmin(); const db = getDb(); ensureReportSchedulesTable(db); return { success: true, schedules: db.prepare('SELECT * FROM report_schedules ORDER BY created_at DESC').all() as ReportSchedule[] }; }
    catch (error) { return { success: false, error: (error as Error).message }; }
}

export async function saveReportSchedule(data: Omit<ReportSchedule, 'id' | 'created_at' | 'last_sent_at'>): Promise<{ success: boolean; id?: string; error?: string }> {
    try {
        await requireAdmin(); const db = getDb(); ensureReportSchedulesTable(db);
        const id = crypto.randomUUID();
        db.prepare(`INSERT INTO report_schedules (id,name,report_type,frequency,day_of_week,day_of_month,scheduled_date,recipient_emails,subject_template,body_template,date_range_type,group_filter,created_by,is_active) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
          .run(id, data.name, data.report_type, data.frequency, data.day_of_week ?? null, data.day_of_month ?? null, data.scheduled_date ?? null, data.recipient_emails, data.subject_template, data.body_template, data.date_range_type, data.group_filter ?? null, data.created_by, data.is_active);
        return { success: true, id };
    } catch (error) { return { success: false, error: (error as Error).message }; }
}

export async function updateReportSchedule(id: string, data: Partial<Pick<ReportSchedule, 'name' | 'is_active' | 'recipient_emails' | 'subject_template' | 'body_template' | 'frequency' | 'day_of_week' | 'day_of_month' | 'scheduled_date' | 'date_range_type' | 'group_filter' | 'report_type'>>): Promise<{ success: boolean; error?: string }> {
    try {
        await requireAdmin(); const db = getDb();
        db.prepare(`UPDATE report_schedules SET ${Object.keys(data).map(k => `${k} = ?`).join(', ')} WHERE id = ?`).run(...Object.values(data), id);
        return { success: true };
    } catch (error) { return { success: false, error: (error as Error).message }; }
}

export async function deleteReportSchedule(id: string): Promise<{ success: boolean; error?: string }> {
    try { await requireAdmin(); getDb().prepare('DELETE FROM report_schedules WHERE id = ?').run(id); return { success: true }; }
    catch (error) { return { success: false, error: (error as Error).message }; }
}

export async function getApiKey(): Promise<{ success: boolean; key?: string; error?: string }> {
    try { await requireAdmin(); const row = getDb().prepare("SELECT value FROM key_value_store WHERE key = 'import_api_key'").get() as { value: string } | undefined; return { success: true, key: row?.value }; }
    catch (error) { return { success: false, error: (error as Error).message }; }
}

export async function regenerateApiKey(): Promise<{ success: boolean; key?: string; error?: string }> {
    try {
        await requireAdmin(); const db = getDb();
        const newKey = 'od_' + crypto.randomBytes(32).toString('hex');
        db.prepare("INSERT INTO key_value_store (key, value) VALUES ('import_api_key', ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(newKey);
        return { success: true, key: newKey };
    } catch (error) { return { success: false, error: (error as Error).message }; }
}

// ── Google Sheets Schedule Sync ──────────────────────────────────────────────

/**
 * Fetches a sheet tab as CSV from a Google Sheets file (works for both native
 * Sheets and uploaded .xlsx files converted by Google Sheets, since the
 * gviz/tq export endpoint reads whatever the sheet engine currently renders).
 *
 * Strips rows whose first cell matches any of the supplied filter prefixes
 * (case-insensitive, startsWith match) so the result is import-schedule
 * compliant: only "Employee" header rows and actual schedule rows remain.
 *
 * @param fileId     Google Sheets file ID (the long string in the share URL)
 * @param sheetName  Tab name to read, e.g. "2026"
 * @param filters    Prefixes to strip — rows whose first cell starts with
 *                   any of these (case-insensitive) are removed entirely.
 */
export async function syncScheduleFromGoogleSheet(
    fileId: string,
    sheetName: string,
    filters: string[]
): Promise<{ success: boolean; csv?: string; rowsKept?: number; rowsRemoved?: number; error?: string }> {
    try {
        await requireManager();

        if (!fileId?.trim()) return { success: false, error: 'File ID is required.' };
        if (!sheetName?.trim()) return { success: false, error: 'Sheet name is required.' };

        const url = `https://docs.google.com/spreadsheets/d/${encodeURIComponent(fileId.trim())}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent(sheetName.trim())}`;

        const res = await fetch(url, { cache: 'no-store' });
        if (!res.ok) {
            if (res.status === 404) {
                return { success: false, error: 'Sheet not found. Check the File ID and Sheet Name, and make sure the sheet is shared as "Anyone with the link can view".' };
            }
            return { success: false, error: `Google Sheets returned an error (HTTP ${res.status}). Check sharing permissions.` };
        }

        const rawCsv = await res.text();

        // A login/redirect page comes back as HTML, not CSV, when the sheet
        // isn't publicly viewable — detect and report that clearly.
        if (rawCsv.trim().startsWith('<')) {
            return { success: false, error: 'Could not read the sheet as CSV. Make sure it is shared as "Anyone with the link can view".' };
        }

        // Parse with a minimal CSV splitter that respects quoted commas —
        // good enough for the matrix format (Employee + date columns).
        const parseCsvLine = (line: string): string[] => {
            const cells: string[] = [];
            let cur = '';
            let inQuotes = false;
            for (let i = 0; i < line.length; i++) {
                const ch = line[i];
                if (ch === '"') {
                    if (inQuotes && line[i + 1] === '"') { cur += '"'; i++; }
                    else inQuotes = !inQuotes;
                } else if (ch === ',' && !inQuotes) {
                    cells.push(cur); cur = '';
                } else {
                    cur += ch;
                }
            }
            cells.push(cur);
            return cells;
        };

        const toCsvLine = (cells: string[]): string =>
            cells.map(c => (c.includes(',') || c.includes('"') || c.includes('\n'))
                ? `"${c.replace(/"/g, '""')}"`
                : c
            ).join(',');

        const normalizedFilters = (filters ?? [])
            .map(f => f.trim().toLowerCase())
            .filter(Boolean);

        const lines = rawCsv.split(/\r\n|\n/);
        const keptLines: string[] = [];
        let rowsRemoved = 0;

        for (const line of lines) {
            if (line.trim() === '') {
                // Preserve blank lines — they are block separators in the
                // matrix format the importer expects.
                keptLines.push('');
                continue;
            }
            const cells = parseCsvLine(line);
            const firstCell = (cells[0] ?? '').trim().toLowerCase();

            const shouldFilter = normalizedFilters.some(f => firstCell.startsWith(f));
            if (shouldFilter) {
                rowsRemoved++;
                continue;
            }
            keptLines.push(toCsvLine(cells));
        }

        // Trim trailing blank lines so the importer's block-detection doesn't
        // see a phantom empty block at the end.
        while (keptLines.length > 0 && keptLines[keptLines.length - 1].trim() === '') {
            keptLines.pop();
        }

        const cleanedCsv = keptLines.join('\n');
        const rowsKept = keptLines.filter(l => l.trim() !== '').length;

        if (rowsKept === 0) {
            return { success: false, error: 'After filtering, no rows remained. Check your filter list and sheet contents.' };
        }

        return { success: true, csv: cleanedCsv, rowsKept, rowsRemoved };
    } catch (error) {
        return { success: false, error: (error as Error).message };
    }
}
