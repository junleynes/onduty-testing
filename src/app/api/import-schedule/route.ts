import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { v4 as uuidv4 } from 'uuid';
import Papa from 'papaparse';
import { findEmployeeByName, convertTo24Hour } from '@/lib/utils';
import type { Employee } from '@/types';

/**
 * API Route to import schedules via CSV (Matrix Format)
 * 
 * Headers:
 * - x-api-key: [Your API Key]
 * 
 * Body:
 * Matrix CSV (matches UI export/import format)
 * Header: Employee, 2024-08-01, 2024-08-02, ...
 */

export async function POST(req: NextRequest) {
  const db = getDb();
  
  // 1. Security Check
  const apiKey = req.headers.get('x-api-key');
  const storedKeyRow = db.prepare("SELECT value FROM key_value_store WHERE key = 'import_api_key'").get() as { value: string } | undefined;
  const validKey = storedKeyRow?.value;
  if (!validKey) return NextResponse.json({ success: false, error: 'API key not configured.' }, { status: 503 });

  if (!apiKey || apiKey !== validKey) {
    return NextResponse.json({ success: false, error: 'Unauthorized. Invalid or missing API Key.' }, { status: 401 });
  }

  try {
    const csvText = await req.text();
    if (!csvText) {
      return NextResponse.json({ success: false, error: 'Empty request body.' }, { status: 400 });
    }

    const parsed = Papa.parse(csvText, {
      header: false,
      skipEmptyLines: false,
    });

    if (parsed.errors.length > 0) {
      return NextResponse.json({ success: false, error: 'CSV Parsing Error', details: parsed.errors }, { status: 400 });
    }

    const rows = parsed.data as string[][];
    const employees = db.prepare('SELECT * FROM employees').all() as any[] as Employee[];
    const leaveTypes = db.prepare('SELECT * FROM leave_types').all() as { type: string, color: string }[];
    const shiftTemplates = db.prepare('SELECT * FROM shift_templates').all() as any[];
    
    const validLeaveTypes = new Set(leaveTypes.map(lt => lt.type.toUpperCase()));
    
    // Split into blocks (separated by empty lines)
    const blocks: string[][][] = [];
    let currentBlock: string[][] = [];
    for (const row of rows) {
        if (row.every(cell => !cell || cell.trim() === '')) {
            if (currentBlock.length > 0) {
                blocks.push(currentBlock);
                currentBlock = [];
            }
        } else {
            currentBlock.push(row);
        }
    }
    if (currentBlock.length > 0) blocks.push(currentBlock);

    const results = {
      shifts: 0,
      leave: 0,
      errors: [] as string[],
    };

    const importTransaction = db.transaction(() => {
      for (const block of blocks) {
        const headerRow = block[0];
        if (!headerRow || !headerRow[0]?.trim().toLowerCase().includes('employee')) continue;

        const dates: { colIndex: number, dateStr: string }[] = [];
        for (let i = 1; i < headerRow.length; i++) {
          const dateStr = headerRow[i]?.trim();
          if (dateStr && !isNaN(new Date(dateStr).getTime())) {
            dates.push({ colIndex: i, dateStr });
          }
        }

        if (dates.length === 0) continue;

        for (let r = 1; rowIndex < block.length; r++) {
          const row = block[r];
          const employeeName = row[0]?.trim();
          if (!employeeName) continue;

          const employee = findEmployeeByName(employeeName, employees);
          if (!employee) {
            results.errors.push(`Employee not found: ${employeeName}`);
            continue;
          }

          for (const { colIndex, dateStr } of dates) {
            const cellValue = row[colIndex]?.trim();
            if (!cellValue) continue;

            const isoDate = new Date(dateStr).toISOString().split('T')[0];
            const upperVal = cellValue.toUpperCase();

            // Clear existing shift/leave for this specific day
            db.prepare('DELETE FROM shifts WHERE employeeId = ? AND date = ?').run(employee.id, isoDate);
            db.prepare('DELETE FROM leave WHERE employeeId = ? AND startDate = ?').run(employee.id, isoDate);

            // 1. Day Off / Holiday Off
            if (upperVal === 'OFF' || upperVal === 'HOL-OFF') {
              db.prepare(`
                INSERT INTO shifts (id, employeeId, label, startTime, endTime, date, color, isDayOff, isHolidayOff, status)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
              `).run(uuidv4(), employee.id, upperVal, '', '', isoDate, '#6b7280', upperVal === 'OFF' ? 1 : 0, upperVal === 'HOL-OFF' ? 1 : 0, 'published');
              results.shifts++;
              continue;
            }

            // 2. Partial Day Leave (e.g. "9am-12pm/VL")
            if (cellValue.includes('/')) {
                const parts = cellValue.split('/').map(p => p.trim());
                const timeRegex = /(\d{1,2}(?::\d{2})?\s*(?:am|pm|a|p)?)\s*-\s*(\d{1,2}(?::\d{2})?\s*(?:am|pm|a|p)?)/i;
                const timeMatch = parts[0].match(timeRegex);
                const leaveTypeKey = parts[1]?.toUpperCase();

                if (timeMatch && leaveTypeKey && validLeaveTypes.has(leaveTypeKey)) {
                    const startTime = convertTo24Hour(timeMatch[1]);
                    const endTime = convertTo24Hour(timeMatch[2]);
                    const lt = leaveTypes.find(l => l.type.toUpperCase() === leaveTypeKey);
                    if (startTime && endTime) {
                        db.prepare(`
                            INSERT INTO leave (id, employeeId, type, color, startDate, endDate, isAllDay, startTime, endTime, status, requestedAt, managedAt, dateFiled)
                            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                        `).run(uuidv4(), employee.id, lt!.type, lt!.color, isoDate, isoDate, 0, startTime, endTime, 'approved', new Date().toISOString(), new Date().toISOString(), new Date().toISOString());
                        results.leave++;
                        continue;
                    }
                }
            }

            // 3. Whole Day Leave (e.g. "VL")
            if (validLeaveTypes.has(upperVal)) {
              const lt = leaveTypes.find(l => l.type.toUpperCase() === upperVal);
              db.prepare(`
                INSERT INTO leave (id, employeeId, type, color, startDate, endDate, isAllDay, status, requestedAt, managedAt, dateFiled)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
              `).run(uuidv4(), employee.id, lt!.type, lt!.color, isoDate, isoDate, 1, 'approved', new Date().toISOString(), new Date().toISOString(), new Date().toISOString());
              results.leave++;
              continue;
            }

            // 4. Regular Shift Time (e.g. "9am-5pm")
            const timeRegex = /(\d{1,2}(?::\d{2})?\s*(?:am|pm|a|p)?)\s*-\s*(\d{1,2}(?::\d{2})?\s*(?:am|pm|a|p)?)/i;
            const timeMatch = cellValue.match(timeRegex);
            if (timeMatch) {
              const start = convertTo24Hour(timeMatch[1]);
              const end = convertTo24Hour(timeMatch[2]);
              if (start && end) {
                const matchedTemplate = shiftTemplates.find(t => t.startTime === start && t.endTime === end);
                db.prepare(`
                  INSERT INTO shifts (id, employeeId, label, startTime, endTime, date, color, status, breakStartTime, breakEndTime, isUnpaidBreak)
                  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                `).run(
                  uuidv4(),
                  employee.id,
                  matchedTemplate ? matchedTemplate.label : 'Shift',
                  start,
                  end,
                  isoDate,
                  matchedTemplate ? matchedTemplate.color : '#3b82f6',
                  'published',
                  matchedTemplate?.breakStartTime || null,
                  matchedTemplate?.breakEndTime || null,
                  matchedTemplate?.isUnpaidBreak ? 1 : 0
                );
                results.shifts++;
              }
            }
          }
        }
      }
    });

    importTransaction();

    return NextResponse.json({
      success: true,
      message: `Import completed. ${results.shifts} shifts and ${results.leave} leave entries added.`,
      stats: results,
    });

  } catch (error: any) {
    console.error('API Import Failed:', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}