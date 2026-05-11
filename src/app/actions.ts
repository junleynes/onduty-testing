'use server';

import type { SmtpSettings, Employee, Shift, AppVisibility, Leave } from '@/types';
import nodemailer from 'nodemailer';
import bcrypt from 'bcryptjs';
import { getDb } from '@/lib/db';
import fs from 'fs';
import path from 'path';
import { PDFDocument, rgb, StandardFonts } from 'pdf-lib';
import { format, differenceInCalendarDays, parse, differenceInMinutes, isSameDay, addDays, startOfDay, parseISO } from 'date-fns';
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
 * Hardened local-time safe date formatting.
 * Strictly avoids UTC shifts for calendar dates.
 */
function formatLocal(dateInput: Date | string | number | undefined, pattern: string): string {
    if (!dateInput) return '';
    try {
        let d: Date;
        if (typeof dateInput === 'string') {
            const isoDateOnly = dateInput.split('T')[0];
            const parts = isoDateOnly.split('-');
            if (parts.length === 3) {
                // Construct Date object at local midnight
                d = new Date(parseInt(parts[0]), parseInt(parts[1]) - 1, parseInt(parts[2]));
            } else {
                d = new Date(dateInput);
            }
        } else if (typeof dateInput === 'number') {
            d = new Date(dateInput);
        } else {
            d = dateInput;
        }
        
        if (isNaN(d.getTime())) return '';
        
        // If the date has no time (standard ISO calendar date), standard getDate/getMonth shifts 
        // if the server is in a negative offset. We force UTC component extraction if hours are 0.
        const isCalendarDate = d.getUTCHours() === 0 && d.getUTCMinutes() === 0 && d.getUTCSeconds() === 0;
        
        const dayNum = isCalendarDate ? d.getUTCDate() : d.getDate();
        const monthNum = (isCalendarDate ? d.getUTCMonth() : d.getMonth()) + 1;
        const yearNum = isCalendarDate ? d.getUTCFullYear() : d.getFullYear();
        
        const dd = String(dayNum).padStart(2, '0');
        const mm = String(monthNum).padStart(2, '0');
        const yyyy = String(yearNum);
        
        if (pattern === 'MM/dd/yyyy') return `${mm}/${dd}/${yyyy}`;
        if (pattern === 'yyyy-MM-dd') return `${yyyy}-${mm}-${dd}`;
        
        return format(d, pattern);
    } catch (e) {
        return '';
    }
}

export async function generateLeavePdf(leaveRequest: Leave): Promise<{ success: boolean; pdfDataUri?: string; error?: string; }> {
    const db = getDb();
    try {
        const templateData = db.prepare("SELECT value FROM key_value_store WHERE key = 'alafTemplate'").get() as { value: string } | undefined;
        if (!templateData || !templateData.value) {
            return { success: false, error: "ALAF template not found. Please upload one in the Reports section." };
        }

        const employee = db.prepare("SELECT * FROM employees WHERE id = ?").get(leaveRequest.employeeId) as Employee | undefined;
        if (!employee) {
            return { success: false, error: "Employee not found." };
        }

        const manager = leaveRequest.managedBy ? db.prepare("SELECT * FROM employees WHERE id = ?").get(leaveRequest.managedBy) as Employee | undefined : undefined;

        const templateBytes = Buffer.from(templateData.value, 'base64');
        const pdfDoc = await PDFDocument.load(templateBytes);
        const form = pdfDoc.getForm();

        let totalDaysValue = "";
        if (leaveRequest.durationCategory === 'minutes' && leaveRequest.totalMinutes) {
            totalDaysValue = `${leaveRequest.totalMinutes} mins`;
        } else {
            let days = differenceInCalendarDays(new Date(leaveRequest.endDate), new Date(leaveRequest.startDate)) + 1;
            if (leaveRequest.isAllDay === false && days === 1) {
                days = 0.5;
            }
            totalDaysValue = String(days);
        }

        const startDate = leaveRequest.startDate;
        const endDate = leaveRequest.endDate;
        let leaveDatesDisplay = isSameDay(startDate, endDate)
            ? formatLocal(startDate, 'MM/dd/yyyy')
            : `${formatLocal(startDate, 'MM/dd/yyyy')} to ${formatLocal(endDate, 'MM/dd/yyyy')}`;
        
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
            date_filed: [formatLocal(leaveRequest.dateFiled || new Date(), 'MM/dd/yyyy'), 'date_filed', 'datefiled', 'date_applied'],
            department: [leaveRequest.department || employee.group || '', 'department', 'dept', 'office'],
            employee_id: [leaveRequest.idNumber || employee.employeeNumber || '', 'employee_id', 'employeeid', 'id_number'],
            leave_dates: [leaveDatesDisplay, 'leave_dates', 'inclusive_dates', 'period_of_leave'],
            total_days: [totalDaysValue, 'total_days', 'no_of_days', 'days'],
            reason: [leaveRequest.reason || '', 'reason', 'remarks', 'purpose'],
            contact_info: [leaveRequest.contactInfo || employee.phone || '', 'contact_info', 'contact'],
            approval_date: [leaveRequest.managedAt ? formatLocal(leaveRequest.managedAt, 'MM/dd/yyyy') : '', 'approval_date', 'date_approved'],
            manager_name: [manager ? getFullName(manager) : '', 'manager_name', 'supervisor_name', 'superior_name', 'mgr_name'],
            leave_type: [leaveRequest.type || '', 'leave_type'],
        };

        const allFormFields = form.getFields();
        
        for (const [key, [value, ...targets]] of Object.entries(fields)) {
            const normalizedTargets = targets.map(t => t.toLowerCase().replace(/[^a-z0-9]/g, ''));
            for (const field of allFormFields) {
                const fName = field.getName().toLowerCase().replace(/[^a-z0-9]/g, '');
                const isExactKey = fName === key.replace(/_/g, '');
                const isFuzzyMatch = normalizedTargets.some(t => fName === t || (t.length > 5 && fName.endsWith(t)));
                
                if (isExactKey || isFuzzyMatch) {
                    // Exclusion rules for standard ALAF
                    if (key === 'employee_name' && (fName.includes('manager') || fName.includes('supervisor') || fName.includes('superior') || fName.includes('mgr'))) continue;
                    if (key === 'manager_name' && (fName.includes('employee') || fName.includes('applicant') || fName.includes('emp'))) continue;

                    try {
                        const textField = form.getTextField(field.getName());
                        textField.setText(value || '');
                    } catch (e) {}
                }
            }
        }
        
        if (leaveRequest.type) {
            const rawType = leaveRequest.type.toLowerCase();
            const normalizedType = rawType.replace(/[^a-z0-9]/g, '');
            for (const field of allFormFields) {
                const currentFieldName = field.getName().toLowerCase().replace(/[^a-z0-9]/g, '');
                const isTypeMatch = currentFieldName === normalizedType || 
                                    currentFieldName === `chk${normalizedType}` ||
                                    (normalizedType.length > 3 && (currentFieldName.includes(normalizedType) || currentFieldName.endsWith(normalizedType)));
                if (isTypeMatch) {
                    try { form.getCheckBox(field.getName()).check(); } catch (e) {}
                    try {
                        const radioGroup = form.getRadioGroup(field.getName());
                        const options = radioGroup.getOptions();
                        const matchingOption = options.find(opt => {
                            const normOpt = opt.toLowerCase().replace(/[^a-z0-9]/g, '');
                            return normOpt === normalizedType || (normalizedType.length > 3 && normOpt.includes(normalizedType)) || normOpt.endsWith(normalizedType);
                        });
                        if (matchingOption) radioGroup.select(matchingOption);
                    } catch (e) {}
                    try { form.getTextField(field.getName()).setText(normalizedType === 'tardy' ? 'TARDY' : 'X'); } catch (e) {}
                }
            }
        }
        
        if (leaveRequest.status === 'approved' || leaveRequest.status === 'rejected' || leaveRequest.status === 'processed') {
            const statusKey = leaveRequest.status === 'processed' ? 'approved' : leaveRequest.status.toLowerCase();
            const alternateKey = statusKey === 'approved' ? 'approve' : 'reject';
            for (const field of allFormFields) {
                const currentFieldName = field.getName().toLowerCase().replace(/[^a-z0-9]/g, '');
                const isStatusMatch = currentFieldName === statusKey || currentFieldName.endsWith(statusKey) || currentFieldName === alternateKey || currentFieldName.endsWith(alternateKey) || currentFieldName === `chk${statusKey}` || currentFieldName === `chk${alternateKey}`;
                if (isStatusMatch) {
                    try { form.getCheckBox(field.getName()).check(); } catch (e) {}
                    try { form.getTextField(field.getName()).setText('X'); } catch (e) {}
                }
            }
        }

        form.updateFieldAppearances();

        await embedSignatureToPdf(pdfDoc, leaveRequest.employeeSignature || employee.signature, ['employee_signature_af_image', 'employee_signature', 'signature_employee', 'emp_sig', 'signature_1']);
        await embedSignatureToPdf(pdfDoc, leaveRequest.managerSignature || (manager?.signature), ['manager_signature_af_image', 'manager_signature', 'signature_manager', 'supervisor_signature', 'superior_signature', 'mgr_sig', 'signature_2']);

        const pdfBytes = await pdfDoc.save();
        const pdfDataUri = `data:application/pdf;base64,${Buffer.from(pdfBytes).toString('base64')}`;

        return { success: true, pdfDataUri };
    } catch (error: any) {
        console.error('Failed to generate PDF:', error);
        return { success: false, error: error.message };
    }
}

export async function generateOffsetPdf(leaveRequest: Leave): Promise<{ success: boolean; pdfDataUri?: string; error?: string; }> {
    const db = getDb();
    try {
        const templateData = db.prepare("SELECT value FROM key_value_store WHERE key = 'offsetTemplate'").get() as { value: string } | undefined;
        if (!templateData || !templateData.value) {
            return { success: false, error: "Offset template not found. Please upload one in the Reports section." };
        }

        const employee = db.prepare("SELECT * FROM employees WHERE id = ?").get(leaveRequest.employeeId) as Employee | undefined;
        if (!employee) return { success: false, error: "Employee not found." };

        const manager = leaveRequest.managedBy ? db.prepare("SELECT * FROM employees WHERE id = ?").get(leaveRequest.managedBy) as Employee | undefined : undefined;

        let weRequest: Leave | undefined = undefined;
        let weManager: Employee | undefined = undefined;
        let weDateStr = '';
        let weDateFiledStr = '';
        
        if (leaveRequest.claimedWorkExtensionId) {
            weRequest = db.prepare("SELECT * FROM leave WHERE id = ?").get(leaveRequest.claimedWorkExtensionId) as Leave | undefined;
            if (weRequest) {
                weDateStr = formatLocal(weRequest.startDate, 'MM/dd/yyyy');
                weDateFiledStr = formatLocal(weRequest.dateFiled || weRequest.requestedAt, 'MM/dd/yyyy');
                if (weRequest.managedBy) {
                    weManager = db.prepare("SELECT * FROM employees WHERE id = ?").get(weRequest.managedBy) as Employee | undefined;
                }
            }
        }

        const templateBytes = Buffer.from(templateData.value, 'base64');
        const pdfDoc = await PDFDocument.load(templateBytes);
        const form = pdfDoc.getForm();

        let totalDaysValue = "";
        if (leaveRequest.durationCategory === 'minutes' && leaveRequest.totalMinutes) {
            totalDaysValue = `${leaveRequest.totalMinutes} mins`;
        } else {
            let days = differenceInCalendarDays(new Date(leaveRequest.endDate), new Date(leaveRequest.startDate)) + 1;
            if (leaveRequest.isAllDay === false && days === 1) {
                days = 0.5;
            }
            totalDaysValue = String(days);
        }

        const startDate = leaveRequest.startDate;
        const endDate = leaveRequest.endDate;
        let offsetDatesDisplay = isSameDay(startDate, endDate)
            ? formatLocal(startDate, 'MM/dd/yyyy')
            : `${formatLocal(startDate, 'MM/dd/yyyy')} to ${formatLocal(endDate, 'MM/dd/yyyy')}`;

        if (!leaveRequest.isAllDay && leaveRequest.durationCategory !== 'minutes') {
             if (leaveRequest.durationCategory === 'half' && leaveRequest.originalStartTime && leaveRequest.originalEndTime) {
                offsetDatesDisplay += ` (Half Day: ${leaveRequest.halfDaySegment === 'first' ? '1st Half' : '2nd Half'} of ${leaveRequest.originalStartTime}-${leaveRequest.originalEndTime})`;
            } else if (leaveRequest.startTime && leaveRequest.endTime) {
                offsetDatesDisplay += ` (${leaveRequest.startTime} - ${leaveRequest.endTime})`;
            }
        } else if (leaveRequest.durationCategory === 'minutes' && leaveRequest.startTime) {
            offsetDatesDisplay += ` @ ${leaveRequest.startTime}`;
        }

        /**
         * STRICT NAMESPACE MAPPING:
         * Data from the current Offset request is mapped to standard fields.
         * Data from the reference Work Extension is mapped to "we_" fields.
         */
        const fields: Record<string, string[]> = {
            employee_name: [getFullName(employee), 'employee_name', 'emp_name', 'applicant_name'],
            employee_id: [leaveRequest.idNumber || employee.employeeNumber || '', 'employee_id', 'employeeid', 'id_number'],
            date_filed: [formatLocal(leaveRequest.dateFiled || new Date(), 'MM/dd/yyyy'), 'date_filed', 'datefiled', 'date_applied'],
            department: [leaveRequest.department || employee.group || '', 'department', 'dept', 'office'],
            offset_dates: [offsetDatesDisplay, 'offset_dates', 'period_of_offset', 'inclusive_dates'],
            total_days: [totalDaysValue, 'total_days', 'no_of_days', 'days'],
            reason: [leaveRequest.reason || '', 'reason', 'offset_reason'],
            contact_info: [leaveRequest.contactInfo || employee.phone || '', 'contact_info', 'contact'],
            manager_name: [manager ? getFullName(manager) : '', 'manager_name', 'supervisor_name', 'mgr_name'],
        };
        
        if (weRequest) {
            fields['we_employee_name'] = [getFullName(employee), 'we_employee_name'];
            fields['we_department'] = [weRequest.department || employee.group || '', 'we_department'];
            fields['we_date_filed'] = [weDateFiledStr, 'we_date_filed'];
            fields['we_reason'] = [weRequest.reason || '', 'we_reason', 'we_remarks'];
            fields['we_date'] = [weDateStr, 'we_date'];
            fields['we_shiftfrom'] = [weRequest.originalStartTime || '', 'we_shiftfrom'];
            fields['we_shiftto'] = [weRequest.originalEndTime || '', 'we_shiftto'];
            fields['we_timein'] = [weRequest.startTime || '', 'we_timein'];
            fields['we_timeout'] = [weRequest.endTime || '', 'we_timeout'];
            fields['we_extendfrom'] = [weRequest.startTime || '', 'we_extendfrom'];
            fields['we_extendto'] = [weRequest.endTime || '', 'we_extendto'];
            fields['we_manager_name'] = [weManager ? getFullName(weManager) : '', 'we_manager_name'];
        }

        const allFormFields = form.getFields();
        for (const [key, [value, ...targets]] of Object.entries(fields)) {
            const normalizedTargets = targets.map(t => t.toLowerCase().replace(/[^a-z0-9]/g, ''));
            for (const field of allFormFields) {
                const fName = field.getName().toLowerCase().replace(/[^a-z0-9]/g, '');
                const isExactKey = fName === key.replace(/_/g, '');
                const isFuzzyMatch = normalizedTargets.some(t => fName === t || (t.length > 5 && fName.endsWith(t)));
                
                if (isExactKey || isFuzzyMatch) {
                    // Guard: Prefix strictness
                    const isWeData = key.startsWith('we_');
                    const isWeField = fName.startsWith('we');

                    if (isWeField && !isWeData) continue;
                    if (!isWeField && isWeData) continue;

                    // Guard: Name separation
                    if (key === 'employee_name' && (fName.includes('manager') || fName.includes('supervisor') || fName.includes('mgr'))) continue;
                    if (key === 'manager_name' && (fName.includes('employee') || fName.includes('applicant') || fName.includes('emp'))) continue;

                    try { form.getTextField(field.getName()).setText(value || ''); } catch (e) {}
                }
            }
        }
        
        if (leaveRequest.status === 'approved' || leaveRequest.status === 'rejected' || leaveRequest.status === 'processed') {
            const statusKey = leaveRequest.status === 'processed' ? 'approved' : leaveRequest.status.toLowerCase();
            const alternateKey = statusKey === 'approved' ? 'approve' : 'reject';
            for (const field of allFormFields) {
                const currentFieldName = field.getName().toLowerCase().replace(/[^a-z0-9]/g, '');
                if (currentFieldName === statusKey || currentFieldName.endsWith(statusKey) || currentFieldName === alternateKey || currentFieldName.endsWith(alternateKey)) {
                    try { form.getCheckBox(field.getName()).check(); } catch (e) {}
                    try { form.getTextField(field.getName()).setText('X'); } catch (e) {}
                }
            }
        }

        form.updateFieldAppearances();

        await embedSignatureToPdf(pdfDoc, leaveRequest.employeeSignature || employee.signature, ['employee_signature_af_image', 'employee_signature', 'signature_employee', 'emp_sig', 'signature_1']);
        await embedSignatureToPdf(pdfDoc, leaveRequest.managerSignature || (manager?.signature), ['manager_signature_af_image', 'manager_signature', 'signature_manager', 'mgr_sig', 'signature_2']);
        
        if (weRequest) {
            await embedSignatureToPdf(pdfDoc, weRequest.employeeSignature, ['we_employee_signature_af_image']);
            await embedSignatureToPdf(pdfDoc, weRequest.managerSignature, ['we_manager_signature_af_image']);
        }

        const pdfBytes = await pdfDoc.save();
        const pdfDataUri = `data:application/pdf;base64,${Buffer.from(pdfBytes).toString('base64')}`;

        return { success: true, pdfDataUri };
    } catch (error: any) {
        console.error('Failed to generate Offset PDF:', error);
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
            return { success: false, error: 'Employee not found.' };
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
