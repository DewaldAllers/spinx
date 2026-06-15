import { addDays, endOfMonth, format, isAfter, parseISO, startOfMonth } from 'date-fns';

export function monthKey(date = new Date()) {
  return format(date, 'yyyy-MM');
}

export function firstDayOfMonth(date = new Date()) {
  return startOfMonth(date);
}

export function monthRange(date = new Date()) {
  return {
    from: startOfMonth(date),
    to: endOfMonth(date),
  };
}

export function isPastGracePeriod(dueDate: Date, graceDays: number, now = new Date()) {
  return isAfter(now, addDays(dueDate, graceDays));
}

export function parseDateParam(value: unknown, fallback: Date) {
  if (typeof value !== 'string' || value.length === 0) {
    return fallback;
  }
  return parseISO(value);
}
