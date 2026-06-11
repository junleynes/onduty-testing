import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { eachDayOfInterval, format, parseISO, isWithinInterval, startOfDay } from 'date-fns';

/**
 * GET /api/reports/attendance-sheet
 *
 * Returns attendance sheet data for a date range, optionally filtered by group.
 *
 * Authentication: Bearer token or x-api-key header using the import_api_key.
 *
 * Query Parameters:
 *   from       (required) ISO date string, e.g. 2026-06-02
 *   to         (required) ISO date string, e.g. 2026-06-08  (typically a Mon–Sun week)
 *   group      (optional) Filter by group name. Omit to include all groups.
 *   format     (optional) "json" (default) or "csv"
 *
 * Response (JSON):
 * {
 *   "success": true,
 *   "period": { "from": "2026-06-02", "to": "2026-06-08" },
 *   "group": "Administration",
 *   "days": ["Mon, Jun 2", "Tue, Jun 3", ...],
 *   "data": [
 *     {
 *       "employee_name": "DELA CRUZ, JUAN A.",
 *       "group": "Administration",
 *       "position": "Senior Developer",
 *       "schedule": {
 *         "Mon, Jun 2": "SKE",
 *         "Tue, Jun 3": "WFH",
 *         "Wed, Jun 4": "VL",
 *         "Thu, Jun 5": "SKE",
 *         "Fri, Jun 6": "OFF",
 *         "Sat, Jun 7": "OFF",
 *         "Sun, Jun 8": "OFF"
 *       }
 *     },
 *     ...
 *   ]
 * }
 *
 * Schedule codes:
 *   SKE      = Standard shift (office)
 *   SKE-10   = 10-hour shift
 *   WFH      = Work from home
 *   VL/SL/etc = Leave type code
 *   HOL OFF  = Holiday
 *   OFF      = Day off / no shift
 *
 * Example:
 *   curl -H "Authorization: Bearer YOUR_API_KEY" \
 *     "https://your-onduty.com/api/reports/attendance-sheet?from=2026-06-02&to=2026-06-08&group=Administration"
 */

function getApiKey(req: NextRequest): string | null {
    const auth = req.headers.get('authorization') ?? '';
    return auth.startsWith('Bearer ') ? auth.slice(7) : req.headers.get('x-api-key');
}

export async function GET(req: NextRequest) {
    const db = getDb();

    // Auth
    const key = getApiKey(req);
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
        return NextResponse.json({ success: false, error: 'Missing required query parameters: from, to (ISO date strings, e.g. 2026-06-02).' }, { status: 400 });
    }

    let fromDate: Date, toDate: Date;
    try {
        fromDate = parseISO(fromStr);
        toDate   = parseISO(toStr);
    } catch {
        return NextResponse.json({ success: false, error: 'Invalid date format. Use ISO 8601, e.g. 2026-06-02.' }, { status: 400 });
    }

    try {
        const empQuery = group
            ? db.prepare('SELECT * FROM employees WHERE "group" = ? AND role != \'admin\' ORDER BY lastName, firstName').all(group)
            : db.prepare('SELECT * FROM employees WHERE role != \'admin\' ORDER BY "group", lastName, firstName').all();
        const employees = empQuery as any[];

        const shifts = db.prepare(
            "SELECT * FROM shifts WHERE date >= ? AND date <= ?"
        ).all(fromStr, toStr) as any[];

        const leave = db.prepare(
            "SELECT * FROM leave WHERE status = 'approved' AND startDate <= ? AND endDate >= ?"
        ).all(toStr, fromStr) as any[];

        const holidays = db.prepare(
            "SELECT * FROM holidays WHERE date >= ? AND date <= ?"
        ).all(fromStr, toStr) as any[];

        const days = eachDayOfInterval({ start: fromDate, end: toDate });
        const dayLabels = days.map(d => format(d, 'EEE, MMM d'));

        const data = employees.map(emp => {
            const schedule: Record<string, string> = {};

            days.forEach((day, idx) => {
                const dateStr = format(day, 'yyyy-MM-dd');
                const label = dayLabels[idx];

                const shift = shifts.find((s: any) => s.employeeId === emp.id && s.date === dateStr);
                const leave_ = leave.find((l: any) => {
                    if (l.employeeId !== emp.id) return false;
                    return isWithinInterval(startOfDay(day), {
                        start: startOfDay(parseISO(l.startDate)),
                        end:   startOfDay(parseISO(l.endDate))
                    });
                });
                const holiday = holidays.find((h: any) => h.date === dateStr && (!h.groupName || h.groupName === emp.group));

                let code = 'OFF';
                if (leave_) {
                    code = leave_.type.toUpperCase();
                } else if (shift && !shift.isDayOff && !shift.isHolidayOff) {
                    const shiftLabel = (shift.label ?? '').toUpperCase();
                    if (shiftLabel === 'WFH' || shiftLabel === 'WORK FROM HOME') {
                        code = 'WFH';
                    } else if (shiftLabel.includes('10H')) {
                        code = 'SKE-10';
                    } else {
                        code = 'SKE';
                    }
                } else if (holiday || shift?.isHolidayOff) {
                    code = 'HOL OFF';
                } else if (shift?.isDayOff) {
                    code = 'OFF';
                }

                schedule[label] = code;
            });

            return {
                employee_name: `${emp.lastName}, ${emp.firstName}${emp.middleInitial ? ' ' + emp.middleInitial + '.' : ''}`.toUpperCase(),
                group: emp.group ?? '',
                position: emp.position ?? '',
                schedule,
            };
        });

        if (fmt === 'csv') {
            const headers = ['employee_name', 'group', 'position', ...dayLabels];
            const csvLines = [
                headers.map(h => `"${h}"`).join(','),
                ...data.map(r => [
                    `"${r.employee_name.replace(/"/g, '""')}"`,
                    `"${r.group}"`,
                    `"${r.position}"`,
                    ...dayLabels.map(d => `"${r.schedule[d] ?? ''}"`)
                ].join(','))
            ];
            return new NextResponse(csvLines.join('\n'), {
                status: 200,
                headers: {
                    'Content-Type': 'text/csv',
                    'Content-Disposition': `attachment; filename="attendance-sheet-${fromStr}-to-${toStr}.csv"`,
                },
            });
        }

        return NextResponse.json({
            success: true,
            period: { from: fromStr, to: toStr },
            group: group ?? 'all',
            days: dayLabels,
            count: data.length,
            data,
        });

    } catch (error) {
        return NextResponse.json({ success: false, error: (error as Error).message }, { status: 500 });
    }
}
