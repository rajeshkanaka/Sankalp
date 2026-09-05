import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Temporal } from '@js-temporal/polyfill';
import { z } from 'zod';
import { Calendar } from '@/features/progress/calendar';
import { PageHeader } from '@/components/presentation';
import { getPageUser } from '@/server/auth/server';
import { getRuntimeInfo } from '@/server/config';
import { AppError } from '@/server/errors';
import { getCalendarView } from '@/server/progress/service';
import styles from '@/styles/sanctuary.module.css';

const filtersSchema = z.object({
  month: z
    .string()
    .regex(/^\d{4}-(0[1-9]|1[0-2])$/)
    .optional(),
  journey: z.uuid().optional(),
  mode: z.enum(['grid', 'list']).optional(),
  date: z.iso.date().optional(),
});

export default async function CalendarPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await getPageUser();
  const runtime = getRuntimeInfo();
  const parsed = filtersSchema.safeParse(await searchParams);
  let bounds: { month: string; from: string; to: string } | null = null;
  if (parsed.success) {
    try {
      const month = parsed.data.month ?? runtime.now.slice(0, 7);
      const first = Temporal.PlainYearMonth.from(month).toPlainDate({ day: 1 });
      const last = first.add({ months: 1 }).subtract({ days: 1 });
      bounds = {
        month,
        from: first.subtract({ days: first.dayOfWeek - 1 }).toString(),
        to: last.add({ days: 7 - last.dayOfWeek }).toString(),
      };
      if (parsed.data.date && !parsed.data.date.startsWith(month)) bounds = null;
      if (!z.iso.date().safeParse(bounds?.to).success) bounds = null;
    } catch {
      bounds = null;
    }
  }
  if (!parsed.success || !bounds)
    return (
      <>
        <PageHeader
          title="Choose calendar dates"
          description="Use a valid month and a date within that month."
        />
        <Link prefetch={false} className={styles.button} href="/calendar">
          Reset calendar filters
        </Link>
      </>
    );
  try {
    const view = await getCalendarView(user.id, {
      from: bounds.from,
      to: bounds.to,
      ...(parsed.data.journey ? { journeyId: parsed.data.journey } : {}),
    });
    return (
      <Calendar
        view={view}
        month={bounds.month}
        journeyId={parsed.data.journey}
        mode={parsed.data.mode ?? 'grid'}
        date={parsed.data.date}
        demo={runtime.demo}
      />
    );
  } catch (error) {
    if (error instanceof AppError && error.status === 404) notFound();
    throw error;
  }
}
