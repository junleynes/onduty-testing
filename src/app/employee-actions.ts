'use server';

import { getDb } from '@/lib/db';
import type { Employee } from '@/types';
import { z } from 'zod';
import { v4 as uuidv4 } from 'uuid';
import bcrypt from 'bcryptjs';
import { saveAvatar, saveSignature, readAvatar, readSignature } from '@/lib/file-storage';
import { requireAuth, requireAdmin, requireManager } from '@/lib/auth-guard';
import { writeAuditLog } from '@/app/actions';
const employeeSchema = z.object({
  id: z.string().optional(),
  employeeNumber: z.string().optional().nullable(),
  personnelNumber: z.string().optional().nullable(),
  firstName: z.string().min(1, 'First name is required'),
  lastName: z.string().min(1, 'Last name is required'),
  middleInitial: z.string().max(1).optional(),
  email: z.string().email('Invalid email address'),
  phone: z.string().optional(),
  password: z.string().optional(),
  birthDate: z.date().optional().nullable(),
  startDate: z.date().optional().nullable(),
  lastPromotionDate: z.date().optional().nullable(),
  position: z.string().optional(),
  role: z.enum(['admin', 'manager', 'member']).optional(),
  group: z.string().optional(),
  avatar: z.string().optional().nullable(),
  signature: z.string().optional().nullable(),
  loadAllocation: z.coerce.number().optional(),
  avlAllotted: z.coerce.number().optional(),
  avlBeginningBalance: z.coerce.number().optional(),
  reportsTo: z.string().optional().nullable(),
  visibility: z.object({
      schedule: z.boolean().optional(),
      onDuty: z.boolean().optional(),
      orgChart: z.boolean().optional(),
      mobileLoad: z.boolean().optional(),
  }).optional(),
  gender: z.enum(['Male', 'Female']).optional().nullable(),
  employeeClassification: z.enum(['Rank-and-File', 'Confidential', 'Managerial']).optional().nullable(),
  workScheduleType: z.enum(['8h-paid', '8h-unpaid', '10h-paid', '10h-unpaid']).optional().nullable(),
  defaultShiftTemplateId: z.string().optional().nullable(),
  department: z.string().optional().nullable(),
}).refine(data => {
    if (!data.id) return true;
    if (data.password && data.password.length > 0) {
      return data.password.length >= 6;
    }
    return true;
  }, {
    message: 'Password must be at least 6 characters long.',
    path: ['password'],
});


async function isEmailUnique(email: string, currentId?: string): Promise<boolean> {
    const db = getDb();
    if (currentId) {
        const row = db.prepare('SELECT id FROM employees WHERE email = ? AND id != ?').get(email.toLowerCase(), currentId);
        return !row;
    } else {
        const row = db.prepare('SELECT id FROM employees WHERE email = ?').get(email.toLowerCase());
        return !row;
    }
}

export async function addEmployee(employeeData: Partial<Employee>): Promise<{ success: boolean; error?: string; employee?: Employee }> {
    try { await requireManager(); } catch (e) { return { success: false, error: (e as Error).message }; }
    const validation = employeeSchema.safeParse(employeeData);
    if (!validation.success) {
        return { success: false, error: validation.error.errors.map(e => e.message).join(', ') };
    }
    
    const data = validation.data;

    if (!await isEmailUnique(data.email)) {
        return { success: false, error: 'Another user is already using this email address.' };
    }

    const db = getDb();
    try {
        let hashedPassword: string;
        if (data.password) {
            // Use provided password
            hashedPassword = await bcrypt.hash(data.password, 10);
        } else {
            // No password supplied — generate a secure random one.
            // The user will need to reset their password via the forgot-password flow.
            const randomPassword = require('crypto').randomBytes(16).toString('hex');
            hashedPassword = await bcrypt.hash(randomPassword, 10);
        }

        const employeeId = uuidv4();

        // Save avatar and signature to disk — store only the file path in DB
        let avatarPath: string | null = null;
        let signaturePath: string | null = null;
        if (data.avatar && data.avatar.startsWith('data:')) {
            avatarPath = saveAvatar(employeeId, data.avatar);
        }
        if (data.signature && data.signature.startsWith('data:')) {
            signaturePath = saveSignature(employeeId, data.signature);
        }

        const newEmployee: Employee = {
            id: employeeId,
            firstName: data.firstName,
            lastName: data.lastName,
            email: data.email.toLowerCase(),
            role: data.role || 'member',
            phone: data.phone || '',
            position: data.position || '',
            ...data,
            password: hashedPassword,
            avatar: avatarPath,
            signature: signaturePath,
        };

        // Auto-create the group if it doesn't exist (prevents FK constraint failure)
        if (newEmployee.group) {
            db.prepare(`INSERT INTO groups (name) VALUES (?) ON CONFLICT(name) DO NOTHING`).run(newEmployee.group);
        }

        // Validate reportsTo references a real employee — clear if not found
        if (newEmployee.reportsTo) {
            const refExists = db.prepare('SELECT id FROM employees WHERE id = ?').get(newEmployee.reportsTo);
            if (!refExists) newEmployee.reportsTo = undefined;
        }

        const stmt = db.prepare(`
            INSERT INTO employees (id, employeeNumber, firstName, lastName, middleInitial, email, phone, password, position, role, "group", avatar, loadAllocation, avlAllotted, birthDate, startDate, signature, visibility, lastPromotionDate, reportsTo, gender, employeeClassification, personnelNumber, avlBeginningBalance, department)
            VALUES (@id, @employeeNumber, @firstName, @lastName, @middleInitial, @email, @phone, @password, @position, @role, @group, @avatar, @loadAllocation, @avlAllotted, @birthDate, @startDate, @signature, @visibility, @lastPromotionDate, @reportsTo, @gender, @employeeClassification, @personnelNumber, @avlBeginningBalance, @department)
        `);

        stmt.run({
            id: newEmployee.id,
            employeeNumber: newEmployee.employeeNumber || null,
            personnelNumber: newEmployee.personnelNumber || null,
            firstName: newEmployee.firstName,
            lastName: newEmployee.lastName,
            middleInitial: newEmployee.middleInitial || null,
            email: newEmployee.email,
            phone: newEmployee.phone || null,
            password: newEmployee.password,
            position: newEmployee.position || null,
            role: newEmployee.role,
            group: newEmployee.group || null,
            avatar: newEmployee.avatar,
            loadAllocation: newEmployee.loadAllocation || 0,
            avlAllotted: newEmployee.avlAllotted || 0,
            avlBeginningBalance: newEmployee.avlBeginningBalance || 0,
            birthDate: newEmployee.birthDate ? new Date(newEmployee.birthDate).toISOString() : null,
            startDate: newEmployee.startDate ? new Date(newEmployee.startDate).toISOString() : null,
            signature: newEmployee.signature,
            visibility: JSON.stringify(newEmployee.visibility || {}),
            lastPromotionDate: newEmployee.lastPromotionDate ? new Date(newEmployee.lastPromotionDate).toISOString() : null,
            reportsTo: newEmployee.reportsTo || null,
            gender: newEmployee.gender || null,
            employeeClassification: newEmployee.employeeClassification || null,
            department: newEmployee.department || null,
        });

        // Return employee with actual binary data for immediate UI use
        await writeAuditLog({ action: 'employee.create', targetType: 'employee', targetId: employeeId, targetName: `${newEmployee.firstName} ${newEmployee.lastName}` });
        return { success: true, employee: { ...newEmployee, avatar: data.avatar || avatarPath, signature: data.signature || signaturePath } };

    } catch (error) {
        console.error('Failed to add employee:', error);
        return { success: false, error: (error as Error).message };
    }
}

export async function updatePassword(employeeId: string, newPassword: string): Promise<{ success: boolean; error?: string }> {
    try { await requireAuth(); } catch (e) { return { success: false, error: (e as Error).message }; }
    if (!employeeId) return { success: false, error: 'Employee ID is required.' };
    const { validatePassword } = await import('@/lib/password-rules');
    const { valid, errors } = validatePassword(newPassword);
    if (!valid) return { success: false, error: errors[0] };

    const db = getDb();
    try {
        // Ensure admin exists in DB
        if (employeeId === 'emp-admin-01') {
            const exists = db.prepare('SELECT id FROM employees WHERE id = ?').get(employeeId);
            if (!exists) {
                db.prepare(`INSERT OR IGNORE INTO employees (id, employeeNumber, firstName, lastName, email, phone, position, role, "group")
                    VALUES ('emp-admin-01','001','Super','Admin','admin@onduty.local','123-456-7890','System Administrator','admin','Administration')`).run();
            }
        }

        const hashed = await bcrypt.hash(newPassword.trim(), 10);
        const result = db.prepare('UPDATE employees SET password = ? WHERE id = ?').run(hashed, employeeId);

        if (result.changes === 0) return { success: false, error: 'Employee not found.' };

        // Audit log
        try {
            const { logAudit } = await import('@/app/actions');
            const target = db.prepare('SELECT firstName, lastName FROM employees WHERE id = ?').get(employeeId) as any;
            await logAudit({ action: 'password.admin_reset', targetType: 'employee', targetId: employeeId, targetName: target ? `${target.firstName} ${target.lastName}` : employeeId, detail: 'Admin reset password for employee' });
        } catch { /* never block */ }

        return { success: true };
    } catch (error) {
        return { success: false, error: (error as Error).message };
    }
}

export async function updateEmployee(employeeData: Partial<Employee>): Promise<{ success: boolean; error?: string; employee?: Partial<Employee> }> {
    try { await requireAuth(); } catch (e) { return { success: false, error: (e as Error).message }; }
    if (!employeeData.id) {
        return { success: false, error: 'Employee ID is required for an update.' };
    }
    
    const validation = employeeSchema.safeParse(employeeData);
    if (!validation.success) {
        return { success: false, error: validation.error.errors.map(e => e.message).join(', ') };
    }
    
    const data = validation.data;
    
    if (data.email) {
        if (!await isEmailUnique(data.email, data.id)) {
            return { success: false, error: 'Another user is already using this email address.' };
        }
    }
    
    const db = getDb();
    
    try {
        let existingEmployee = db.prepare('SELECT * FROM employees WHERE id = ?').get(data.id) as Employee | undefined;
        
        // If admin account doesn't exist in DB yet (was previously only in client state),
        // insert it first so the update can proceed
        if (!existingEmployee && data.id === 'emp-admin-01') {
            db.prepare(`
                INSERT OR IGNORE INTO employees (id, employeeNumber, firstName, lastName, email, phone, position, role, "group")
                VALUES ('emp-admin-01', '001', 'Super', 'Admin', 'admin@onduty.local', '123-456-7890', 'System Administrator', 'admin', 'Administration')
            `).run();
            existingEmployee = db.prepare('SELECT * FROM employees WHERE id = ?').get(data.id) as Employee | undefined;
        }
        
        if (!existingEmployee) {
            return { success: false, error: 'Employee not found.' };
        }
        
        const updatedEmployee = { ...existingEmployee, ...data };

        if (data.password && data.password.trim() !== '') {
            updatedEmployee.password = await bcrypt.hash(data.password, 10);
        } else {
            updatedEmployee.password = existingEmployee.password;
        }

        // Save new avatar/signature to disk if provided as data URI, keep existing path otherwise
        if (data.avatar && data.avatar.startsWith('data:')) {
            updatedEmployee.avatar = saveAvatar(data.id!, data.avatar);
        } else if (!data.avatar) {
            updatedEmployee.avatar = existingEmployee.avatar;
        }

        if (data.signature && data.signature.startsWith('data:')) {
            updatedEmployee.signature = saveSignature(data.id!, data.signature);
        } else if (!data.signature) {
            updatedEmployee.signature = existingEmployee.signature;
        }

        // Auto-create group if it doesn't exist (prevents FK constraint failure)
        if (updatedEmployee.group) {
            db.prepare(`INSERT INTO groups (name) VALUES (?) ON CONFLICT(name) DO NOTHING`).run(updatedEmployee.group);
        }

        const stmt = db.prepare(`
            UPDATE employees SET
                employeeNumber = @employeeNumber,
                personnelNumber = @personnelNumber,
                firstName = @firstName,
                lastName = @lastName,
                middleInitial = @middleInitial,
                email = @email,
                phone = @phone,
                password = @password,
                position = @position,
                role = @role,
                "group" = @group,
                avatar = @avatar,
                loadAllocation = @loadAllocation,
                avlAllotted = @avlAllotted,
                avlBeginningBalance = @avlBeginningBalance,
                birthDate = @birthDate,
                startDate = @startDate,
                signature = @signature,
                visibility = @visibility,
                lastPromotionDate = @lastPromotionDate,
                reportsTo = @reportsTo,
                gender = @gender,
                employeeClassification = @employeeClassification,
                workScheduleType = @workScheduleType,
                defaultShiftTemplateId = @defaultShiftTemplateId,
                department = @department
            WHERE id = @id
        `);

        stmt.run({
            id: updatedEmployee.id,
            employeeNumber: updatedEmployee.employeeNumber || null,
            personnelNumber: updatedEmployee.personnelNumber || null,
            firstName: updatedEmployee.firstName,
            lastName: updatedEmployee.lastName,
            middleInitial: updatedEmployee.middleInitial || null,
            email: updatedEmployee.email.toLowerCase(),
            phone: updatedEmployee.phone || null,
            password: updatedEmployee.password,
            position: updatedEmployee.position || null,
            role: updatedEmployee.role,
            group: updatedEmployee.group || null,
            avatar: updatedEmployee.avatar || null,
            loadAllocation: updatedEmployee.loadAllocation || 0,
            avlAllotted: updatedEmployee.avlAllotted || 0,
            avlBeginningBalance: updatedEmployee.avlBeginningBalance || 0,
            birthDate: updatedEmployee.birthDate ? new Date(updatedEmployee.birthDate).toISOString() : null,
            startDate: updatedEmployee.startDate ? new Date(updatedEmployee.startDate).toISOString() : null,
            signature: updatedEmployee.signature || null,
            visibility: JSON.stringify(updatedEmployee.visibility || {}),
            lastPromotionDate: updatedEmployee.lastPromotionDate ? new Date(updatedEmployee.lastPromotionDate).toISOString() : null,
            reportsTo: updatedEmployee.reportsTo || null,
            gender: updatedEmployee.gender || null,
            employeeClassification: updatedEmployee.employeeClassification || null,
            workScheduleType: updatedEmployee.workScheduleType || '8h-paid',
            defaultShiftTemplateId: updatedEmployee.defaultShiftTemplateId || null,
            department: updatedEmployee.department || null,
        });

        await writeAuditLog({ action: 'employee.update', targetType: 'employee', targetId: updatedEmployee.id, targetName: `${updatedEmployee.firstName} ${updatedEmployee.lastName}` });
        return { success: true, employee: updatedEmployee };

    } catch (error) {
        console.error('Failed to update employee:', error);
        return { success: false, error: (error as Error).message };
    }
}
