/**
 * password-rules.ts — Shared password complexity rules.
 * Used by team-editor, reset-password-page, and actions.ts.
 */

export const PASSWORD_MIN_LENGTH = 8;

export const PASSWORD_RULES = [
    { test: (p: string) => p.length >= PASSWORD_MIN_LENGTH,   message: `At least ${PASSWORD_MIN_LENGTH} characters` },
    { test: (p: string) => /[A-Z]/.test(p),                   message: 'At least one uppercase letter (A-Z)' },
    { test: (p: string) => /[a-z]/.test(p),                   message: 'At least one lowercase letter (a-z)' },
    { test: (p: string) => /[0-9]/.test(p),                   message: 'At least one number (0-9)' },
    { test: (p: string) => /[^A-Za-z0-9]/.test(p),            message: 'At least one special character (!@#$...)' },
];

export function validatePassword(password: string): { valid: boolean; errors: string[] } {
    const errors = PASSWORD_RULES
        .filter(rule => !rule.test(password))
        .map(rule => rule.message);
    return { valid: errors.length === 0, errors };
}

export function passwordStrength(password: string): 'weak' | 'fair' | 'strong' {
    const passed = PASSWORD_RULES.filter(r => r.test(password)).length;
    if (passed <= 2) return 'weak';
    if (passed <= 4) return 'fair';
    return 'strong';
}
