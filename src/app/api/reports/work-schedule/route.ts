import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { eachDayOfInterval, format, parseISO, isWithinInterval, startOfDay } from 'date-fns';

/**
 * GET /api/reports/work-schedule
 *
 * Returns work schedule data for a date range, filtered by optional group.
 *
 * Authentication: Bearer token or x-api-key header using the import_api_key.
 *
 * Query Parameters:
 *   from       (required) ISO date string, e.g. 2026-06-01
 *   to         (required) ISO date string, e.g. 2026-06-30
 *   group      (optional) Filter by group name. Omit to include all groups.
 *   format     (optional) "json" (default) or "csv"
 *
 * Response (JSON):
 * {
 *   "success": true,
 *   "period": { "from": "2026-06-01", "to": "2026-06-30" },
 *   "group": "Administration",
 *   "data": [
 *     {
 *       "employee_name": "DELA CRUZ, JUAN A.",
 *       "date": "06/01/2026",
 *       "day_status": "",
 *       "schedule_start": "08:00",
 *       "schedule_end": "17:00",
 *       "unpaidbreak_start": "12:00",
 *       "unpaidbreak_end": "13:00",
 *       "paidbreak_start": "",
 *       "paidbreak_end": ""
 *     },
 *     ...
 *   ]
 * }
 *
 * Response (CSV):
 *   Employee Name,Date,Day Status,Schedule Start,Schedule End,...
 *   "DELA CRUZ, JUAN A.",06/01/2026,,08:00,17:00,...
 *
 * Example:
 *   curl -H "Authorization: Bearer YOUR_API_KEY" \
 *     "https://your-onduty.com/api/reports/work-schedule?from=2026-06-01&to=2026-06-30&group=Administration"
 */

function apiKey(req: NextRequest): string | null {
    const auth = req.headers.get('authorization') ?? '';
    return auth.startsWith('Bearer ') ? auth.slice(7) : req.headers.get('x-api-key');
}

export async function GET(req: NextRequest) {
    const db = getDb();

    // Auth
    const key = apiKey(req);
    const stored = db.prepare("SELECT value FROM key_value_store WHERE key = 'import_api_key'").get() as { value: string } | undefined;
    if (!stored?.value || key !== stored.value) {
        return NextResponse.json({ success: false, error: 'Unauthorized. Pass your API key via Authorization: Bearer <key> or x-api-key header.' }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const fromStr = searchParams.get('from');
    const toStr   = searchParams.get('to');
    const group   = searchParams.get('group');
    const fmt     = searchParams.get('format') ?? 'json';

    if (!fromStr || !toStr) {
        return NextResponse.json({ success: false, error: 'Missing required query parameters: from, to (ISO date strings, e.g. 2026-06-01).' }, { status: 400 });
    }

    let fromDate: Date, toDate: Date;
    try {
        fromDate = parseISO(fromStr);
        toDate   = parseISO(toStr);
    } catch {
        return NextResponse.json({ success: false, error: 'Invalid date format. Use ISO 8601, e.g. 2026-06-01.' }, { status: 400 });
    }

    try {
        // Load employees
        const empQuery = group
            ? db.prepare('SELECT * FROM employees WHERE "group" = ? AND role != \'admin\' ORDER BY lastName, firstName').all(group)
            : db.prepare('SELECT * FROM employees WHERE role != \'admin\' ORDER BY "group", lastName, firstName').all();
        const employees = empQuery as any[];

        // Load shifts for the range
        const shifts = db.prepare(
            "SELECT * FROM shifts WHERE date >= ? AND date <= ?"
        ).all(fromStr, toStr) as any[];

        // Load leave that overlaps range
        const leave = db.prepare(
            "SELECT * FROM leave WHERE status = 'approved' AND startDate <= ? AND endDate >= ?"
        ).all(toStr, fromStr) as any[];

        // Load holidays in range
        const holidays = db.prepare(
            "SELECT * FROM holidays WHERE date >= ? AND date <= ?"
        ).all(fromStr, toStr) as any[];

        // Load shift templates for default schedules
        const templates = db.prepare('SELECT * FROM shift_templates').all() as any[];

        const days = eachDayOfInterval({ start: fromDate, end: toDate });

        const rows: Record<string, string>[] = [];

        for (const emp of employees) {
            const defaultTemplateId = emp.defaultShiftTemplateId;
            const defaultTemplate = templates.find((t: any) => t.id === defaultTemplateId);

            for (const day of days) {
                const dateStr = format(day, 'yyyy-MM-dd');
                const shift = shifts.find((s: any) => s.employeeId === emp.id && s.date === dateStr);
                const leave_ = leave.find((l: any) => {
                    if (l.employeeId !== emp.id) return false;
                    return isWithinInterval(startOfDay(day), {
                        start: startOfDay(parseISO(l.startDate)),
                        end:   startOfDay(parseISO(l.endDate))
                    });
                });
                const holiday = holidays.find((h: any) => h.date === dateStr && (!h.groupName || h.groupName === emp.group));

                let day_status = '';
                let schedule_start = '';
                let schedule_end = '';
                let unpaidbreak_start = '';
                let unpaidbreak_end = '';
                let paidbreak_start = '';
                let paidbreak_end = '';

                const tpl = defaultTemplate;
                const tStart = tpl?.startTime ?? '';
                const tEnd   = tpl?.endTime ?? '';
                const tBrkS  = tpl?.breakStartTime ?? '';
                const tBrkE  = tpl?.breakEndTime ?? '';
                const tUnpaid = !!tpl?.isUnpaidBreak;

                if (shift && !shift.isDayOff && !shift.isHolidayOff) {
                    const label = (shift.label ?? '').toUpperCase();
                    if (label === 'WFH' || label === 'WORK FROM HOME') day_status = 'WFH';
                    schedule_start = shift.startTime ?? '';
                    schedule_end   = shift.endTime ?? '';
                    if (shift.isUnpaidBreak) {
                        unpaidbreak_start = shift.breakStartTime ?? '';
                        unpaidbreak_end   = shift.breakEndTime ?? '';
                    } else {
                        paidbreak_start = shift.breakStartTime ?? '';
                        paidbreak_end   = shift.breakEndTime ?? '';
                    }
                } else if (holiday || shift?.isHolidayOff) {
                    schedule_start = tStart; schedule_end = tEnd;
                    if (tUnpaid) { unpaidbreak_start = tBrkS; unpaidbreak_end = tBrkE; }
                    else         { paidbreak_start   = tBrkS; paidbreak_end   = tBrkE; }
                } else if (leave_) {
                    schedule_start = tStart; schedule_end = tEnd;
                    if (tUnpaid) { unpaidbreak_start = tBrkS; unpaidbreak_end = tBrkE; }
                    else         { paidbreak_start   = tBrkS; paidbreak_end   = tBrkE; }
                } else if (shift?.isDayOff) {
                    day_status = 'FREE';
                }

                rows.push({
                    employee_name: `${emp.lastName}, ${emp.firstName}${emp.middleInitial ? ' ' + emp.middleInitial + '.' : ''}`.toUpperCase(),
                    group: emp.group ?? '',
                    date: format(day, 'MM/dd/yyyy'),
                    day_status,
                    schedule_start,
                    schedule_end,
                    unpaidbreak_start,
                    unpaidbreak_end,
                    paidbreak_start,
                    paidbreak_end,
                });
            }
        }

        if (fmt === 'csv') {
            const headers = ['employee_name','group','date','day_status','schedule_start','schedule_end','unpaidbreak_start','unpaidbreak_end','paidbreak_start','paidbreak_end'];
            const csvLines = [
                headers.join(','),
                ...rows.map(r => headers.map(h => `"${(r[h] ?? '').replace(/"/g, '""')}"`).join(','))
            ];
            return new NextResponse(csvLines.join('\n'), {
                status: 200,
                headers: {
                    'Content-Type': 'text/csv',
                    'Content-Disposition': `attachment; filename="work-schedule-${fromStr}-to-${toStr}.csv"`,
                },
            });
        }

        return NextResponse.json({
            success: true,
            period: { from: fromStr, to: toStr },
            group: group ?? 'all',
            count: rows.length,
            data: rows,
        });

    } catch (error) {
        return NextResponse.json({ success: false, error: (error as Error).message }, { status: 500 });
    }
}
