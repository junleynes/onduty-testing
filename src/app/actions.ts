'use server';

import type { SmtpSettings, Employee, Shift, AppVisibility, Leave } from '@/types';
import nodemailer from 'nodemailer';
import bcrypt from 'bcryptjs';
import { getDb } from '@/lib/db';
import fs from 'fs';
import path from 'path';
import { PDFDocument } from 'pdf-lib';
import { differenceInCalendarDays, isSameDay } from 'date-fns';
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

async function embedSignatureToPdf(pdfDoc: PDFDocument, sigData: string | undefined, fieldNames: string[]) {
    if (!sigData || !sigData.includes('base64,')) return;
    const form = pdfDoc.getForm();
    const allFormFields = form.getFields();
    
    try {
        const sigBase64 = sigData.split('base64,')[1];
        if (!sigBase64) return;
        const buffer = Buffer.from(sigBase64, 'base64');
        
        let image;
        if (sigData.includes('image/jpeg') || sigData.includes('image/jpg')) {
            image = await pdfDoc.embedJpg(buffer);
        } else if (sigData.includes('image/png')) {
            image = await pdfDoc.embedPng(buffer);
        } else {
            try { image = await pdfDoc.embedPng(buffer); } catch (e) { return; }
        }

        const normalizedTargets = fieldNames.map(n => n.toLowerCase().replace(/[^a-z0-9]/g, ''));

        for (const field of allFormFields) {
            const currentFieldName = field.getName().toLowerCase().replace(/[^a-z0-9]/g, '');
            const isMatch = normalizedTargets.some(target => 
                currentFieldName === target || 
                (target.length > 5 && currentFieldName.endsWith(target))
            );

            if (isMatch) {
                try {
                    const button = form.getButton(field.getName());
                    button.setImage(image);
                } catch (e) {}
            }
        }
    } catch (sigErr) {
        console.error("Signature processing error:", sigErr);
    }
}

/**
 * Literal date component extractor. 
 * Prevents "one day behind" error by manually extracting Month, Day, and Year 
 * using local methods or raw regex parsing.
 */
function formatComponentDate(dateInput: Date | string | number | undefined): string {
    if (!dateInput) return '';
    try {
        let dateObj: Date;
        if (dateInput instanceof Date) {
            dateObj = dateInput;
        } else if (typeof dateInput === 'string') {
            const match = dateInput.match(/^(\d{4})-(\d{2})-(\d{2})/);
            if (match) {
                const [_, yyyy, mm, dd] = match;
                return `${mm}/${dd}/${yyyy}`;
            }
            dateObj = new Date(dateInput);
        } else {
            dateObj = new Date(dateInput);
        }

        if (isNaN(dateObj.getTime())) return '';
        
        const mm = String(dateObj.getMonth() + 1).padStart(2, '0');
        const dd = String(dateObj.getDate()).padStart(2, '0');
        const yyyy = dateObj.getFullYear();
        return `${mm}/${dd}/${yyyy}`;
    } catch (e) {
        return '';
    }
}

/**
 * Checks if a PDF field name indicates it belongs to a manager/approver.
 */
function isManagerPdfField(fName: string): boolean {
    const managers = ['manager', 'supervisor', 'superior', 'mgr', 'approver', 'dept_head', 'head', 'authorized_rep'];
    return managers.some(m => fName.includes(m));
}

/**
 * Checks if a PDF field name indicates it belongs to an employee/requester.
 */
function isEmployeePdfField(fName: string): boolean {
    const employees = ['employee', 'applicant', 'emp', 'staff', 'requester', 'user'];
    return employees.some(e => fName.includes(e));
}

/**
 * Checks if a PDF field belongs to the Work Extension namespace.
 */
function isWorkExtensionField(fName: string): boolean {
    return fName.startsWith('we') || fName.includes('workext') || fName.includes('extension');
}

export async function generateLeavePdf(leaveRequest: Leave): Promise<{ success: boolean; pdfDataUri?: string; error?: string; }> {
    const db = getDb();
    try {
        const templateData = db.prepare("SELECT value FROM key_value_store WHERE key = 'alafTemplate'").get() as { value: string } | undefined;
        if (!templateData || !templateData.value) {
            return { success: false, error: "ALAF template not found. Please upload one in the Reports section." };
        }

        const employee = db.prepare("SELECT * FROM employees WHERE id = ?").get(leaveRequest.employeeId) as Employee | undefined;
        if (!employee) return { success: false, error: "Employee not found." };
        const manager = leaveRequest.managedBy ? db.prepare("SELECT * FROM employees WHERE id = ?").get(leaveRequest.managedBy) as Employee | undefined : undefined;

        const templateBytes = Buffer.from(templateData.value, 'base64');
        const pdfDoc = await PDFDocument.load(templateBytes);
        const form = pdfDoc.getForm();

        let totalDaysValue = "";
        if (leaveRequest.durationCategory === 'minutes' && leaveRequest.totalMinutes) {
            totalDaysValue = `${leaveRequest.totalMinutes} mins`;
        } else {
            let days = differenceInCalendarDays(new Date(leaveRequest.endDate), new Date(leaveRequest.startDate)) + 1;
            if (leaveRequest.isAllDay === false && days === 1) days = 0.5;
            totalDaysValue = String(days);
        }

        const startDateStr = formatComponentDate(leaveRequest.startDate);
        const endDateStr = formatComponentDate(leaveRequest.endDate);
        let leaveDatesDisplay = isSameDay(new Date(leaveRequest.startDate), new Date(leaveRequest.endDate))
            ? startDateStr
            : `${startDateStr} to ${endDateStr}`;
        
        if (!leaveRequest.isAllDay && leaveRequest.durationCategory !== 'minutes') {
            if (leaveRequest.durationCategory === 'half' && leaveRequest.originalStartTime && leaveRequest.originalEndTime) {
                leaveDatesDisplay += ` (Half Day: ${leaveRequest.halfDaySegment === 'first' ? '1st Half' : '2nd Half'} of ${leaveRequest.originalStartTime}-${leaveRequest.originalEndTime})`;
            } else if (leaveRequest.startTime && leaveRequest.endTime) {
                leaveDatesDisplay += ` (${leaveRequest.startTime} - ${leaveRequest.endTime})`;
            }
        } else if (leaveRequest.durationCategory === 'minutes' && leaveRequest.startTime) {
            leaveDatesDisplay += ` @ ${leaveRequest.startTime}`;
        }

        const fields = {
            employee_name: [getFullName(employee), 'employee_name', 'emp_name', 'applicant_name'],
            date_filed: [formatComponentDate(leaveRequest.dateFiled || new Date()), 'date_filed', 'date_applied'],
            department: [leaveRequest.department || employee.group || '', 'department', 'dept', 'office'],
            employee_id: [leaveRequest.idNumber || employee.employeeNumber || '', 'employee_id', 'id_number'],
            leave_dates: [leaveDatesDisplay, 'leave_dates', 'inclusive_dates', 'period_of_leave'],
            total_days: [totalDaysValue, 'total_days', 'no_of_days', 'days'],
            reason: [leaveRequest.reason || '', 'reason', 'remarks', 'purpose'],
            contact_info: [leaveRequest.contactInfo || employee.phone || '', 'contact_info', 'contact'],
            manager_name: [manager ? getFullName(manager) : '', 'manager_name', 'supervisor_name', 'approver_name'],
            approval_date: [formatComponentDate(leaveRequest.managedAt), 'approval_date', 'date_approved', 'managed_at'],
        };

        const allFormFields = form.getFields();
        for (const [key, [value, ...targets]] of Object.entries(fields)) {
            const normalizedTargets = targets.map(t => t.toLowerCase().replace(/[^a-z0-9]/g, ''));
            for (const field of allFormFields) {
                const fName = field.getName().toLowerCase().replace(/[^a-z0-9]/g, '');
                
                // STRICT ROLE ISOLATION
                // Prevent Employee Name from matching Manager fields
                if (key === 'employee_name' && isManagerPdfField(fName)) continue;
                // Prevent Manager Name from matching Employee fields
                if (key === 'manager_name' && isEmployeePdfField(fName)) continue;

                const isMatch = normalizedTargets.some(t => fName === t || (t.length > 5 && fName.endsWith(t)));
                if (isMatch) {
                    try { form.getTextField(field.getName()).setText(value || ''); } catch (e) {}
                }
            }
        }
        
        if (leaveRequest.type) {
            const normalizedType = leaveRequest.type.toLowerCase().replace(/[^a-z0-9]/g, '');
            for (const field of allFormFields) {
                const fName = field.getName().toLowerCase().replace(/[^a-z0-9]/g, '');
                if (fName === normalizedType || fName === `chk${normalizedType}` || (normalizedType.length > 3 && fName.includes(normalizedType))) {
                    try { form.getCheckBox(field.getName()).check(); } catch (e) {}
                    try { form.getTextField(field.getName()).setText('X'); } catch (e) {}
                }
            }
        }
        
        if (['approved', 'rejected', 'processed'].includes(leaveRequest.status)) {
            const statusKey = leaveRequest.status === 'processed' ? 'approved' : leaveRequest.status.toLowerCase();
            for (const field of allFormFields) {
                const fName = field.getName().toLowerCase().replace(/[^a-z0-9]/g, '');
                if (fName === statusKey || fName === `chk${statusKey}` || fName === (statusKey === 'approved' ? 'approve' : 'reject')) {
                    try { form.getCheckBox(field.getName()).check(); } catch (e) {}
                    try { form.getTextField(field.getName()).setText('X'); } catch (e) {}
                }
            }
        }

        form.updateFieldAppearances();
        await embedSignatureToPdf(pdfDoc, leaveRequest.employeeSignature || employee.signature, ['employee_signature_af_image', 'signature_employee', 'signature_1']);
        await embedSignatureToPdf(pdfDoc, leaveRequest.managerSignature || manager?.signature, ['manager_signature_af_image', 'signature_manager', 'signature_2']);

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
        if (!employee) return { success: false, error: "Employee not found." };
        const manager = leaveRequest.managedBy ? db.prepare("SELECT * FROM employees WHERE id = ?").get(leaveRequest.managedBy) as Employee | undefined : undefined;

        let weRequest: Leave | undefined;
        let weManager: Employee | undefined;
        if (leaveRequest.claimedWorkExtensionId) {
            weRequest = db.prepare("SELECT * FROM leave WHERE id = ?").get(leaveRequest.claimedWorkExtensionId) as Leave | undefined;
            if (weRequest?.managedBy) weManager = db.prepare("SELECT * FROM employees WHERE id = ?").get(weRequest.managedBy) as Employee | undefined;
        }

        const pdfDoc = await PDFDocument.load(Buffer.from(templateData.value, 'base64'));
        const form = pdfDoc.getForm();

        const startDateStr = formatComponentDate(leaveRequest.startDate);
        const endDateStr = formatComponentDate(leaveRequest.endDate);
        const totalDaysValue = (leaveRequest.durationCategory === 'minutes') ? `${leaveRequest.totalMinutes} mins` : String(differenceInCalendarDays(new Date(leaveRequest.endDate), new Date(leaveRequest.startDate)) + 1 + (leaveRequest.isAllDay === false ? -0.5 : 0));

        const fields: Record<string, string[]> = {
            // CURRENT OFFSET FIELDS
            employee_name: [getFullName(employee), 'employee_name', 'emp_name'],
            employee_id: [leaveRequest.idNumber || employee.employeeNumber || '', 'employee_id', 'id_number'],
            date_filed: [formatComponentDate(leaveRequest.dateFiled || new Date()), 'date_filed', 'date_applied'],
            department: [leaveRequest.department || employee.group || '', 'department', 'dept'],
            offset_dates: [isSameDay(new Date(leaveRequest.startDate), new Date(leaveRequest.endDate)) ? startDateStr : `${startDateStr} to ${endDateStr}`, 'offset_dates', 'period_of_offset'],
            total_days: [totalDaysValue, 'total_days', 'days'],
            reason: [leaveRequest.reason || '', 'reason', 'offset_reason'],
            manager_name: [manager ? getFullName(manager) : '', 'manager_name', 'supervisor_name', 'approver_name'],
            approval_date: [formatComponentDate(leaveRequest.managedAt), 'approval_date', 'date_approved', 'managed_at'],
        };
        
        if (weRequest) {
            // REFERENCE WORK EXTENSION FIELDS (WE NAMESPACE)
            fields['we_employee_name'] = [getFullName(employee), 'we_employee_name'];
            fields['we_department'] = [weRequest.department || employee.group || '', 'we_department'];
            fields['we_date_filed'] = [formatComponentDate(weRequest.dateFiled || weRequest.requestedAt), 'we_date_filed'];
            fields['we_reason'] = [weRequest.reason || '', 'we_reason'];
            fields['we_date'] = [formatComponentDate(weRequest.startDate), 'we_date'];
            fields['we_timein'] = [weRequest.startTime || '', 'we_timein'];
            fields['we_timeout'] = [weRequest.endTime || '', 'we_timeout'];
            fields['we_manager_name'] = [weManager ? getFullName(weManager) : '', 'we_manager_name'];
        }

        const allFormFields = form.getFields();
        for (const [key, [value, ...targets]] of Object.entries(fields)) {
            const isWeKey = key.startsWith('we_');
            const normalizedTargets = targets.map(t => t.toLowerCase().replace(/[^a-z0-9]/g, ''));

            for (const field of allFormFields) {
                const fName = field.getName().toLowerCase().replace(/[^a-z0-9]/g, '');
                const isWeField = isWorkExtensionField(fName);

                // 1. STRICT NAMESPACE ISOLATION
                if (isWeKey && !isWeField) continue;
                if (!isWeKey && isWeField) continue;

                // 2. STRICT ROLE ISOLATION
                if (key.includes('employee_name') && isManagerPdfField(fName)) continue;
                if (key.includes('manager_name') && isEmployeePdfField(fName)) continue;

                // 3. TARGET MATCHING
                const isMatch = normalizedTargets.some(t => fName === t || (t.length > 5 && fName.endsWith(t)));
                if (isMatch) {
                    try { form.getTextField(field.getName()).setText(value || ''); } catch (e) {}
                }
            }
        }

        form.updateFieldAppearances();
        await embedSignatureToPdf(pdfDoc, leaveRequest.employeeSignature || employee.signature, ['employee_signature_af_image']);
        await embedSignatureToPdf(pdfDoc, leaveRequest.managerSignature || manager?.signature, ['manager_signature_af_image']);
        if (weRequest) {
            await embedSignatureToPdf(pdfDoc, weRequest.employeeSignature, ['we_employee_signature_af_image']);
            await embedSignatureToPdf(pdfDoc, weRequest.managerSignature, ['we_manager_signature_af_image']);
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
