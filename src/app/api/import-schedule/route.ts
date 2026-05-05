
import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { v4 as uuidv4 } from 'uuid';
import Papa from 'papaparse';

/**
 * API Route to import schedules via CSV
 * 
 * Headers:
 * - x-api-key: [Your API Key]
 * 
 * Body:
 * - CSV text with columns: email, date, start_time, end_time, label, is_day_off, is_holiday_off
 */

export async function POST(req: NextRequest) {
  const db = getDb();
  
  // 1. Basic Security Check
  const apiKey = req.headers.get('x-api-key');
  const storedKeyRow = db.prepare("SELECT value FROM key_value_store WHERE key = 'import_api_key'").get() as { value: string } | undefined;
  const validKey = storedKeyRow?.value || 'onduty_secret_key';

  if (!apiKey || apiKey !== validKey) {
    return NextResponse.json({ success: false, error: 'Unauthorized. Invalid or missing API Key.' }, { status: 401 });
  }

  try {
    const csvText = await req.text();
    if (!csvText) {
      return NextResponse.json({ success: false, error: 'Empty request body.' }, { status: 400 });
    }

    const parsed = Papa.parse(csvText, {
      header: true,
      skipEmptyLines: true,
    });

    if (parsed.errors.length > 0) {
      return NextResponse.json({ success: false, error: 'CSV Parsing Error', details: parsed.errors }, { status: 400 });
    }

    const rows = parsed.data as any[];
    const results = {
      success: 0,
      failed: 0,
      errors: [] as string[],
    };

    // Use a transaction for atomic bulk import
    const importTransaction = db.transaction(() => {
      for (const row of rows) {
        const { email, date, start_time, end_time, label, is_day_off, is_holiday_off } = row;

        if (!email || !date) {
          results.failed++;
          results.errors.push(`Row missing email or date: ${JSON.stringify(row)}`);
          continue;
        }

        const employee = db.prepare('SELECT id FROM employees WHERE email = ?').get(email.toLowerCase()) as { id: string } | undefined;

        if (!employee) {
          results.failed++;
          results.errors.push(`Employee not found: ${email}`);
          continue;
        }

        // Check for existing shift on this date for this employee and delete it (Overwrite mode)
        db.prepare('DELETE FROM shifts WHERE employeeId = ? AND date = ?').run(employee.id, date);

        // Insert new shift
        db.prepare(`
          INSERT INTO shifts (id, employeeId, label, startTime, endTime, date, color, isDayOff, isHolidayOff, status)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          uuidv4(),
          employee.id,
          label || (is_day_off === '1' ? 'OFF' : 'Shift'),
          start_time || '',
          end_time || '',
          date,
          '#3b82f6', // Default color
          is_day_off === '1' ? 1 : 0,
          is_holiday_off === '1' ? 1 : 0,
          'published' // Automatically publish API imports
        );

        results.success++;
      }
    });

    importTransaction();

    return NextResponse.json({
      success: true,
      message: `Import completed. ${results.success} shifts added/updated.`,
      stats: results,
    });

  } catch (error: any) {
    console.error('API Import Failed:', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
