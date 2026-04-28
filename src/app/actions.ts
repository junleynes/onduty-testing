'use server';

import type { SmtpSettings, Employee, Shift, AppVisibility, Leave } from '@/types';
import nodemailer from 'nodemailer';
import { getDb } from '@/lib/db';
import fs from 'fs';
import path from 'path';
import { PDFDocument, rgb, StandardFonts } from 'pdf-lib';
import { format, differenceInCalendarDays, parse, differenceInMinutes } from 'date-fns';
import { v4 as uuidv4 } from 'uuid';
import { getFullName } from '@/lib/utils';


type Attachment = {
    filename: string;
    content: string; // Base64 encoded string
}

export async function sendEmail(
    { to, subject, htmlBody, attachments }: { to: string, subject: string, htmlBody: string, attachments?: Attachment[] },
    smtpSettings: SmtpSettings
) {
    if (!smtpSettings.fromEmail || !smtpSettings.fromName) {
        return { success: false, error: 'SMTP settings (From Email and From Name) are not configured.' };
    }
    if (!smtpSettings.host || !smtpSettings.port || !smtpSettings.user || !smtpSettings.pass) {
        return { success: false, error: 'SMTP connection settings (Host, Port, User, Pass) are not fully configured.' };
    }

    const transporter = nodemailer.createTransport({
        host: smtpSettings.host,
        port: smtpSettings.port,
        secure: smtpSettings.port === 465, // Use SSL for port 465, otherwise STARTTLS
        auth: {
            user: smtpSettings.user,
            pass: smtpSettings.pass,
        },
        tls: {
            rejectUnauthorized: false // Often required for cloud environments
        }
    });

    try {
        await transporter.sendMail({
            from: `"${smtpSettings.fromName}" <${smtpSettings.fromEmail}>`,
            to: to,
            subject: subject,
            html: htmlBody,
            attachments: attachments?.map(att => ({
                filename: att.filename,
                content: Buffer.from(att.content, 'base64'), // Decode base64 to buffer
            }))
        });
        return { success: true };
    } catch (error) {
        console.error('Email sending with nodemailer failed:', error);
        return { success: false, error: (error as Error).message };
    }
}


export async function verifyUser(email: string, password: string): Promise<{ success: boolean; user?: Employee; error?: string; }> {
    // Hardcode check for the default admin user to bypass any potential DB issues.
    if (email.toLowerCase() === 'admin@onduty.local') {
        if (password === 'P@ssw0rd') {
            const adminUser: Employee = {
                id: "emp-admin-01",
                employeeNumber: "001",
                firstName: "Super",
                lastName: "Admin",
                email: "admin@onduty.local",
                password: "P@ssw0rd", // Ensure password is included in the returned object
                phone: "123-456-7890",
                position: "System Administrator",
                role: "admin",
                group: "Administration",
            };
            return { success: true, user: adminUser };
        } else {
            return { success: false, error: 'Invalid email or password.' };
        }
    }

    // Continue with database check for all other users.
    const db = getDb();
    try {
        const stmt = db.prepare('SELECT * FROM employees WHERE email = ?');
        const userRow = stmt.get(email);

        if (userRow) {
            // Ensure we are working with a plain object
            const user = JSON.parse(JSON.stringify(userRow)) as Employee;
            
            if (user.password === password) {
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
    
    // Close the database connection if it's open.
    const dbModule = require('@/lib/db');
    if (dbModule.dbInstance && dbModule.dbInstance.open) {
        dbModule.dbInstance.close();
    }
    
    // Invalidate the singleton instance in db.ts
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
                db.prepare("DELETE FROM key_value_store WHERE key LIKE '%Template'").run();
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

// Internal Helper for Digital Signatures
async function embedSignatureToPdf(pdfDoc: PDFDocument, sigData: string | undefined, fieldNames: string[]) {
    if (!sigData || !sigData.includes('base64,')) return;
    const form = pdfDoc.getForm();
    const allFormFields = form.getFields();
    
    try {
        const sigBase64 = sigData.split('base64,')[1];
        const buffer = Buffer.from(sigBase64, 'base64');
        
        let image;
        if (sigData.includes('image/jpeg') || sigData.includes('image/jpg')) {
            image = await pdfDoc.embedJpg(buffer);
        } else if (sigData.includes('image/png')) {
            image = await pdfDoc.embedPng(buffer);
        } else {
            // Fallback to PNG if type is ambiguous
            try { image = await pdfDoc.embedPng(buffer); } catch (e) { return; }
        }

        const normalizedTargets = fieldNames.map(n => n.toLowerCase().replace(/[\s_]/g, ''));

        for (const field of allFormFields) {
            const currentFieldName = field.getName().toLowerCase().replace(/[\s_]/g, '');
            if (normalizedTargets.includes(currentFieldName)) {
                try {
                    const button = form.getButton(field.getName());
                    button.setImage(image);
                } catch (e) {
                    console.warn(`Field ${field.getName()} matched signature target but is not a Push Button field.`);
                }
            }
        }
    } catch (sigErr) {
        console.error("Signature processing error:", sigErr);
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

        let totalDaysValue = differenceInCalendarDays(new Date(leaveRequest.endDate), new Date(leaveRequest.startDate)) + 1;
        if (leaveRequest.isAllDay === false && totalDaysValue === 1) {
            totalDaysValue = 0.5;
        }

        const fields = {
            employee_name: [getFullName(employee), 'fullname', 'name', 'employee_name', 'employee name'],
            date_filed: [format(new Date(leaveRequest.dateFiled || new Date()), 'yyyy-MM-dd'), 'date_filed', 'datefiled', 'date_applied', 'date filed'],
            department: [leaveRequest.department || employee.group || '', 'department', 'dept', 'office', 'div_dept'],
            employee_id: [leaveRequest.idNumber || employee.employeeNumber || '', 'employee_id', 'employeeid', 'id_number', 'idnumber', 'id no'],
            leave_dates: [`${format(new Date(leaveRequest.startDate), 'yyyy-MM-dd')} to ${format(new Date(leaveRequest.endDate), 'yyyy-MM-dd')}`, 'leave_dates', 'dates', 'period', 'dates of leave applied for'],
            total_days: [String(totalDaysValue), 'total_days', 'totaldays', 'no_of_days', 'total no of leave days'],
            reason: [leaveRequest.reason || '', 'reason', 'remarks', 'purpose', 'details_reasons'],
            contact_info: [leaveRequest.contactInfo || employee.phone || '', 'contact_info', 'contact', 'phone', 'i can be contacted at'],
            approval_date: [leaveRequest.managedAt ? format(new Date(leaveRequest.managedAt), 'yyyy-MM-dd') : '', 'approval_date', 'approvaldate', 'date_approved', 'date received'],
            manager_name: [manager ? getFullName(manager) : '', 'manager_name', 'manager', 'supervisor', 'superior', 'immediate superior', 'immediate_superior'],
        };

        const allFormFields = form.getFields();
        for (const [key, [value, ...fieldNames]] of Object.entries(fields)) {
            let fieldSet = false;
            const normalizedTargets = fieldNames.map(n => n.toLowerCase().replace(/[\s_]/g, ''));
            for (const field of allFormFields) {
                const currentFieldName = field.getName().toLowerCase().replace(/[\s_]/g, '');
                if (normalizedTargets.includes(currentFieldName)) {
                    try {
                        const textField = form.getTextField(field.getName());
                        textField.setText(value);
                        fieldSet = true;
                    } catch (e) {}
                }
                if (fieldSet) break;
            }
        }
        
        // Handle Leave Type (Checkbox or Radio Group)
        if (leaveRequest.type) {
            const normalizedType = leaveRequest.type.toLowerCase().replace(/[\s_]/g, '');
            for (const field of allFormFields) {
                const currentFieldName = field.getName().toLowerCase().replace(/[\s_]/g, '');
                
                // Try as Checkbox
                if (currentFieldName === normalizedType || currentFieldName === `chk${normalizedType}`) {
                    try {
                        const checkbox = form.getCheckBox(field.getName());
                        checkbox.check();
                        break;
                    } catch (e) {}
                }

                // Try as Radio Group
                try {
                    const radioGroup = form.getRadioGroup(field.getName());
                    const options = radioGroup.getOptions();
                    const matchingOption = options.find(opt => 
                        opt.toLowerCase().replace(/[\s_]/g, '') === normalizedType
                    );
                    if (matchingOption) {
                        radioGroup.select(matchingOption);
                        break;
                    }
                } catch (e) {}
            }
        }
        
        // Handle Approval Status
        if (leaveRequest.status === 'approved' || leaveRequest.status === 'rejected') {
            const statusKey = leaveRequest.status.toLowerCase();
            let checked = false;
            for (const field of allFormFields) {
                const currentFieldName = field.getName().toLowerCase().replace(/[\s_]/g, '');
                
                // Try as Checkbox
                if (currentFieldName === statusKey) {
                    try {
                        const checkbox = form.getCheckBox(field.getName());
                        checkbox.check();
                        checked = true;
                        break;
                    } catch (e) {}
                }

                // Try as Radio Group
                try {
                    const radioGroup = form.getRadioGroup(field.getName());
                    const options = radioGroup.getOptions();
                    const matchingOption = options.find(opt => 
                        opt.toLowerCase() === statusKey
                    );
                    if (matchingOption) {
                        radioGroup.select(matchingOption);
                        checked = true;
                        break;
                    }
                } catch (e) {}
            }
            if (!checked) {
                const statusNames = ['approval_status', 'status', 'decision', 'official action'];
                for (const name of statusNames) {
                    try {
                        form.getTextField(name).setText(leaveRequest.status.toUpperCase());
                        break;
                    } catch (e) {}
                }
            }
        }

        await embedSignatureToPdf(pdfDoc, leaveRequest.employeeSignature || employee.signature, ['employee_signature_af_image', 'employee_signature', 'signature_employee', 'emp_sig', 'employee signature', 'signature_1']);
        await embedSignatureToPdf(pdfDoc, leaveRequest.managerSignature || (manager?.signature), ['manager_signature_af_image', 'manager_signature', 'signature_manager', 'supervisor_signature', 'superior_signature', 'mgr_sig', 'immediate superior signature', 'signature_2']);

        // CRITICAL: Update appearances for all fields before flattening to prevent Adobe Acrobat Error (18)
        form.updateFieldAppearances();

        try { form.flatten(); } catch (e) {}

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

        // Fetch the claimed work extension details
        let weDate = 'N/A';
        let weHours = 'N/A';
        if (leaveRequest.claimedWorkExtensionId) {
            const weRequest = db.prepare("SELECT * FROM leave WHERE id = ?").get(leaveRequest.claimedWorkExtensionId) as any;
            if (weRequest) {
                weDate = format(new Date(weRequest.startDate), 'MM/dd/yyyy');
                if (weRequest.startTime && weRequest.endTime) {
                    const start = parse(weRequest.startTime, 'HH:mm', new Date());
                    const end = parse(weRequest.endTime, 'HH:mm', new Date());
                    let diff = (end.getTime() - start.getTime()) / (1000 * 60 * 60);
                    if (diff < 0) diff += 24;
                    weHours = diff.toFixed(2);
                }
            }
        }

        const templateBytes = Buffer.from(templateData.value, 'base64');
        const pdfDoc = await PDFDocument.load(templateBytes);
        const form = pdfDoc.getForm();

        let totalDaysValue = differenceInCalendarDays(new Date(leaveRequest.endDate), new Date(leaveRequest.startDate)) + 1;
        if (leaveRequest.isAllDay === false && totalDaysValue === 1) totalDaysValue = 0.5;

        const fields = {
            employee_name: [getFullName(employee), 'fullname', 'name', 'employee_name'],
            date_filed: [format(new Date(leaveRequest.dateFiled || new Date()), 'yyyy-MM-dd'), 'date_filed', 'datefiled'],
            department: [leaveRequest.department || employee.group || '', 'department', 'dept'],
            offset_dates: [`${format(new Date(leaveRequest.startDate), 'MM/dd/yyyy')} to ${format(new Date(leaveRequest.endDate), 'MM/dd/yyyy')}`, 'offset_dates', 'dates', 'period'],
            total_days: [String(totalDaysValue), 'total_days', 'no_of_days'],
            reason: [leaveRequest.reason || '', 'reason', 'remarks'],
            work_extension_date: [weDate, 'work_extension_date', 'we_date', 'claimed_date'],
            work_extension_hours: [weHours, 'work_extension_hours', 'we_hours', 'claimed_hours'],
            manager_name: [manager ? getFullName(manager) : '', 'manager_name', 'supervisor'],
        };

        const allFormFields = form.getFields();
        for (const [key, [value, ...fieldNames]] of Object.entries(fields)) {
            let fieldSet = false;
            const normalizedTargets = fieldNames.map(n => n.toLowerCase().replace(/[\s_]/g, ''));
            for (const field of allFormFields) {
                const currentFieldName = field.getName().toLowerCase().replace(/[\s_]/g, '');
                if (normalizedTargets.includes(currentFieldName)) {
                    try {
                        const textField = form.getTextField(field.getName());
                        textField.setText(value);
                        fieldSet = true;
                    } catch (e) {}
                }
                if (fieldSet) break;
            }
        }

        await embedSignatureToPdf(pdfDoc, leaveRequest.employeeSignature || employee.signature, ['employee_signature_af_image', 'employee_signature', 'signature_employee', 'emp_sig', 'signature_1']);
        await embedSignatureToPdf(pdfDoc, leaveRequest.managerSignature || (manager?.signature), ['manager_signature_af_image', 'manager_signature', 'signature_manager', 'mgr_sig', 'signature_2']);

        // CRITICAL: Update appearances for all fields before flattening to prevent Adobe Acrobat Error (18)
        form.updateFieldAppearances();

        try { form.flatten(); } catch (e) {}

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
            // Don't reveal if the user exists or not for security reasons.
            // We'll just return success as if an email was sent.
            return { success: true };
        }

        const token = uuidv4();
        const expiresAt = new Date(Date.now() + 3600000); // 1 hour expiry

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
        const expiresAt = new Date(Date.now() + 24 * 3600000); // 24 hours expiry for activation

        db.prepare('INSERT INTO password_reset_tokens (token, employeeId, expiresAt) VALUES (?, ?, ?)')
          .run(token, employee.id, expiresAt.toISOString());

        const activationLink = `${origin}/reset-password?token=${token}`; // Re-use the reset page for activation

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

        // Update the password
        db.prepare('UPDATE employees SET password = ? WHERE id = ?').run(newPassword, tokenRecord.employeeId);
        
        // Invalidate the token
        db.prepare('DELETE FROM password_reset_tokens WHERE token = ?').run(token);

        return { success: true };
    } catch(error) {
         console.error('Password reset failed:', error);
        return { success: false, error: (error as Error).message };
    }
}
