import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"
import type { Employee } from "@/types";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function getFullName(employee: Partial<Employee | null>): string {
    if (!employee) return '';
    const parts: string[] = [];
    if (employee.firstName) parts.push(employee.firstName);
    if (employee.middleInitial) parts.push(employee.middleInitial);
    if (employee.lastName) parts.push(employee.lastName);
    return parts.join(' ');
}

export function getInitials(name: string) {
  if (!name) return '';
  const names = name.trim().split(' ').filter(Boolean);
  if (names.length === 0) return '';
  const first = names[0]?.[0] || '';
  const last = names.length > 1 ? names[names.length - 1]?.[0] : '';
  return (first + last).toUpperCase();
}

export function getBackgroundColor(name: string) {
    const colors = [
        '#ef4444', '#f97316', '#eab308', '#84cc16', '#22c55e', 
        '#14b8a6', '#06b6d4', '#3b82f6', '#8b5cf6', '#d946ef'
    ];
    if (!name) return colors[0];
    const charCodeSum = name.split('').reduce((sum, char) => sum + char.charCodeAt(0), 0);
    const index = charCodeSum % colors.length;
    return colors[index];
}

// Helper function to get initial state from localStorage or defaults
export const getInitialState = <T>(key: string, defaultValue: T): T => {
    if (typeof window === 'undefined') {
        return defaultValue;
    }
    try {
        const item = window.localStorage.getItem(key);
        if (!item) {
            return defaultValue;
        }

        // A more robust date reviver that handles UTC dates correctly
        const dateReviver = (k: string, v: any) => {
            if (['date', 'birthDate', 'startDate', 'timestamp', 'completedAt', 'dueDate', 'asOfDate'].includes(k) && typeof v === 'string') {
                // Regex to check for ISO 8601 date format (YYYY-MM-DDTHH:mm:ss.sssZ)
                const isoDateRegex = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z?$/;
                if (isoDateRegex.test(v)) {
                    const date = new Date(v);
                    if (!isNaN(date.getTime())) {
                        return date;
                    }
                }
            }
            return v;
        };

        try {
            // First, try to parse as JSON. This will handle complex objects and arrays.
            return JSON.parse(item, dateReviver);
        } catch (jsonError) {
            // If parsing fails, it might be a simple string or number that wasn't stored as JSON.
            // In this case, we return the raw item.
            // We can check if it's a number and parse it.
            if (!isNaN(Number(item))) {
                return Number(item) as any;
            }
            return item as any;
        }

    } catch (error) {
        console.error(`Error reading from localStorage for key "${key}":`, error);
        return defaultValue;
    }
};

const normalizeName = (name: string): string => {
  if (!name) return '';
  return name.trim().toLowerCase().replace(/,/g, '').replace(/\s+/g, ' ');
};

export const findEmployeeByName = (name: string, allEmployees: Employee[]): Employee | null => {
  if (!name || typeof name !== 'string') return null;

  const normalizedInput = normalizeName(name);

  // Exact match first
  for (const emp of allEmployees) {
    const fullName = normalizeName(`${emp.firstName} ${emp.lastName}`);
    const fullNameWithMI = normalizeName(`${emp.firstName} ${emp.middleInitial || ''} ${emp.lastName}`);
    if (fullName === normalizedInput || fullNameWithMI === normalizedInput) {
      return emp;
    }
  }

  // Handle "Lastname, Firstname M.I. Suffix"
  if (name.includes(',')) {
    const parts = name.split(',').map(p => p.trim());
    const lastNamePart = normalizeName(parts[0]);
    const firstNamePart = normalizeName(parts[1] || '');

    for (const emp of allEmployees) {
      const normalizedEmpLastName = normalizeName(emp.lastName);
      const normalizedEmpFirstName = normalizeName(emp.firstName);
      if (normalizedEmpLastName === lastNamePart && firstNamePart.startsWith(normalizedEmpFirstName)) {
        return emp;
      }
    }
  }

  return null;
};

export const convertTo24Hour = (timeStr: string): string => {
    if (!timeStr || typeof timeStr !== 'string') return '';
    let time = timeStr.trim().toLowerCase();
    
    // Check for am/pm
    const isPm = time.includes('pm') || time.includes('p');
    const isAm = time.includes('am') || time.includes('a');
    
    // Remove am/pm for easier parsing
    time = time.replace(/am|pm|a|p/g, '').trim();
    
    let [hours, minutes] = time.split(':').map(Number);
    if (isNaN(hours)) hours = 0;
    if (isNaN(minutes)) minutes = 0;

    if (isPm && hours < 12) {
        hours += 12;
    }
    if (isAm && hours === 12) { // Handle 12am (midnight)
        hours = 0;
    }

    return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
};