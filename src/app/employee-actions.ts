
'use server';

import { getDb } from '@/lib/db';
import type { Employee } from '@/types';
import { z } from 'zod';
import { v4 as uuidv4 } from 'uuid';

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
  reportsTo: z.string().optional().nullable(),
  visibility: z.object({
      schedule: z.boolean().optional(),
      onDuty: z.boolean().optional(),
      orgChart: z.boolean().optional(),
      mobileLoad: z.boolean().optional(),
  }).optional(),
  gender: z.enum(['Male', 'Female']).optional().nullable(),
  employeeClassification: z.enum(['Rank-and-File', 'Confidential', 'Managerial']).optional().nullable(),
}).refine(data => {
    // If it's a new user (no ID), password can be blank (to send activation link)
    if (!data.id) {
      return true;
    }
    // If it's an existing user, password is optional. But if provided, it must be at least 6 chars.
    if (data.password && data.password.length > 0) {
      return data.password.length >= 6;
    }
    // If password is not provided for an existing user, it's valid.
    return true;
  }, {
    message: 'Password must be at least 6 characters long.',
    path: ['password'],
});


// Helper to check for email uniqueness
async function isEmailUnique(email: string, currentId?: string): Promise<boolean> {
    const db = getDb();
    if (currentId) {
        // Correctly check for emails on OTHER records
        const row = db.prepare('SELECT id FROM employees WHERE email = ? AND id != ?').get(email, currentId);
        return !row;
    } else {
        // Check for any record with this email when creating a new user
        const row = db.prepare('SELECT id FROM employees WHERE email = ?').get(email);
        return !row;
    }
}

export async function addEmployee(employeeData: Partial<Employee>): Promise<{ success: boolean; error?: string; employee?: Employee }> {
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
        const newEmployee: Employee = {
            id: uuidv4(),
            firstName: data.firstName,
            lastName: data.lastName,
            email: data.email,
            role: data.role || 'member',
            phone: data.phone || '',
            position: data.position || '',
            ...data,
            password: data.password || null, // Can be null if activation link is used
            avatar: data.avatar || null,
            signature: data.signature || null,
        };

        const stmt = db.prepare(`
            INSERT INTO employees (id, employeeNumber, firstName, lastName, middleInitial, email, phone, password, position, role, "group", avatar, loadAllocation, avlAllotted, birthDate, startDate, signature, visibility, lastPromotionDate, reportsTo, gender, employeeClassification, personnelNumber)
            VALUES (@id, @employeeNumber, @firstName, @lastName, @middleInitial, @email, @phone, @password, @position, @role, @group, @avatar, @loadAllocation, @avlAllotted, @birthDate, @startDate, @signature, @visibility, @lastPromotionDate, @reportsTo, @gender, @employeeClassification, @personnelNumber)
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
            birthDate: newEmployee.birthDate ? new Date(newEmployee.birthDate).toISOString() : null,
            startDate: newEmployee.startDate ? new Date(newEmployee.startDate).toISOString() : null,
            signature: newEmployee.signature,
            visibility: JSON.stringify(newEmployee.visibility || {}),
            lastPromotionDate: newEmployee.lastPromotionDate ? new Date(newEmployee.lastPromotionDate).toISOString() : null,
            reportsTo: newEmployee.reportsTo || null,
            gender: newEmployee.gender || null,
            employeeClassification: newEmployee.employeeClassification || null,
        });

        return { success: true, employee: newEmployee };

    } catch (error) {
        console.error('Failed to add employee:', error);
        return { success: false, error: (error as Error).message };
    }
}

export async function updateEmployee(employeeData: Partial<Employee>): Promise<{ success: boolean; error?: string; employee?: Partial<Employee> }> {
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
        const existingEmployee = db.prepare('SELECT * FROM employees WHERE id = ?').get(data.id) as Employee | undefined;
        if (!existingEmployee) {
            return { success: false, error: 'Employee not found.' };
        }
        
        // Merge incoming data with existing data
        const updatedEmployee = { ...existingEmployee, ...data };

        // If password is not being updated, keep the old one
        if (!data.password || data.password.trim() === '') {
            updatedEmployee.password = existingEmployee.password;
        }

        // Preserve existing images if the form sends an empty value (no new file uploaded)
        if (!data.avatar) {
            updatedEmployee.avatar = existingEmployee.avatar;
        }
        if (!data.signature) {
            updatedEmployee.signature = existingEmployee.signature;
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
                birthDate = @birthDate,
                startDate = @startDate,
                signature = @signature,
                visibility = @visibility,
                lastPromotionDate = @lastPromotionDate,
                reportsTo = @reportsTo,
                gender = @gender,
                employeeClassification = @employeeClassification
            WHERE id = @id
        `);

        stmt.run({
            id: updatedEmployee.id,
            employeeNumber: updatedEmployee.employeeNumber || null,
            personnelNumber: updatedEmployee.personnelNumber || null,
            firstName: updatedEmployee.firstName,
            lastName: updatedEmployee.lastName,
            middleInitial: updatedEmployee.middleInitial || null,
            email: updatedEmployee.email,
            phone: updatedEmployee.phone || null,
            password: updatedEmployee.password,
            position: updatedEmployee.position || null,
            role: updatedEmployee.role,
            group: updatedEmployee.group || null,
            avatar: updatedEmployee.avatar || null,
            loadAllocation: updatedEmployee.loadAllocation || 0,
            avlAllotted: updatedEmployee.avlAllotted || 0,
            birthDate: updatedEmployee.birthDate ? new Date(updatedEmployee.birthDate).toISOString() : null,
            startDate: updatedEmployee.startDate ? new Date(updatedEmployee.startDate).toISOString() : null,
            signature: updatedEmployee.signature || null,
            visibility: JSON.stringify(updatedEmployee.visibility || {}),
            lastPromotionDate: updatedEmployee.lastPromotionDate ? new Date(updatedEmployee.lastPromotionDate).toISOString() : null,
            reportsTo: updatedEmployee.reportsTo || null,
            gender: updatedEmployee.gender || null,
            employeeClassification: updatedEmployee.employeeClassification || null,
        });

        return { success: true, employee: updatedEmployee };

    } catch (error) {
        console.error('Failed to update employee:', error);
        if ((error as any).code === 'SQLITE_CONSTRAINT_UNIQUE') {
            return { success: false, error: 'Another user is already using this email address.' };
        }
        return { success: false, error: (error as Error).message };
    }
}
