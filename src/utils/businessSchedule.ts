// Dominican Republic Business Schedule & Official Holidays Utility for Todo Lapto
import type { HolidayOverride } from '../types';

export interface DominicanTimeContext {
  date: Date;
  year: number;
  month: number; // 1-12
  day: number; // 1-31
  ymd: string; // 'YYYY-MM-DD'
  dayOfWeek: number; // 0 = Sunday, 1 = Monday, ..., 6 = Saturday
  dayName: string; // 'Lunes', 'Martes', etc.
  monthName: string; // 'Enero', 'Febrero', etc.
  hour: number; // 0-23
  minute: number; // 0-59
  time12: string; // '08:30 AM'
  time24: string; // '08:30'
  fullDateStr: string; // 'Jueves 29 de Octubre de 2026'
  isHoliday: boolean;
  holidayName?: string;
  wasOriginalHolidayMoved?: boolean;
  originalHolidayName?: string;
  movedToDate?: string;
  movedToHumanDate?: string;
  movedHolidayNotice?: string;
  isOpen: boolean;
  statusReason: 'open' | 'closed_night' | 'closed_morning' | 'closed_sunday' | 'closed_holiday';
  statusSummary: string; // '🟢 ABIERTO' or '🔴 CERRADO'
  statusDetail: string; // 'Abierto (Lunes a Sábado de 8:30 AM a 6:00 PM)' or 'Cerrado por horario nocturno...'
  nextOpeningStr: string; // 'Mañana viernes a las 8:30 AM'
  customerNotice: string;
}

export interface EnrichedHolidayItem {
  id: string; // 'YYYY-MM-DD' or 'custom-YYYY-MM-DD'
  name: string;
  originalDate: string; // 'YYYY-MM-DD'
  originalDayName: string;
  originalHumanDate: string;
  status: 'normal' | 'moved' | 'workday' | 'custom_holiday';
  effectiveDate: string | null; // 'YYYY-MM-DD' or null if 'workday'
  effectiveHumanDate: string | null;
  movedToDate?: string;
  note?: string;
  isCustom?: boolean;
  nextMondayDate: string;
  nextMondayLabel: string;
  prevMondayDate: string;
  prevMondayLabel: string;
}

// Module-level shared overrides so both backend and frontend components stay in sync
let globalHolidayOverrides: HolidayOverride[] = [];

export function setGlobalHolidayOverrides(overrides?: HolidayOverride[]) {
  if (Array.isArray(overrides)) {
    globalHolidayOverrides = overrides;
  } else {
    globalHolidayOverrides = [];
  }
}

export function getGlobalHolidayOverrides(): HolidayOverride[] {
  return globalHolidayOverrides;
}

export const DAY_NAMES = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];
export const MONTH_NAMES = [
  'Enero',
  'Febrero',
  'Marzo',
  'Abril',
  'Mayo',
  'Junio',
  'Julio',
  'Agosto',
  'Septiembre',
  'Octubre',
  'Noviembre',
  'Diciembre',
];

export function formatYMD(year: number, month: number, day: number): string {
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

export function parseYMD(ymd: string): { year: number; month: number; day: number; dayOfWeek: number } | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec((ymd || '').trim());
  if (!match) return null;
  const year = parseInt(match[1], 10);
  const month = parseInt(match[2], 10);
  const day = parseInt(match[3], 10);
  const dt = new Date(Date.UTC(year, month - 1, day, 12, 0, 0));
  return {
    year,
    month,
    day,
    dayOfWeek: dt.getUTCDay(),
  };
}

export function formatHumanDateShortRD(ymd: string, includeYear = false): string {
  const parsed = parseYMD(ymd);
  if (!parsed) return ymd;
  const dayName = DAY_NAMES[parsed.dayOfWeek];
  const monthName = MONTH_NAMES[parsed.month - 1] || '';
  return includeYear
    ? `${dayName} ${parsed.day} de ${monthName} de ${parsed.year}`
    : `${dayName} ${parsed.day} de ${monthName}`;
}

/**
 * Calculates the nearest previous Monday and following Monday for a given YYYY-MM-DD date.
 */
export function getSuggestedMondaysForDate(ymd: string): {
  nextMondayDate: string;
  nextMondayLabel: string;
  prevMondayDate: string;
  prevMondayLabel: string;
} {
  const parsed = parseYMD(ymd);
  if (!parsed) {
    return {
      nextMondayDate: ymd,
      nextMondayLabel: ymd,
      prevMondayDate: ymd,
      prevMondayLabel: ymd,
    };
  }
  const baseUtc = new Date(Date.UTC(parsed.year, parsed.month - 1, parsed.day, 12, 0, 0));
  const dow = baseUtc.getUTCDay(); // 0=Sun, 1=Mon, ..., 6=Sat

  // Days until next Monday (if already Monday, +7 days)
  const daysToNextMonday = dow === 0 ? 1 : dow === 1 ? 7 : 8 - dow;
  const nextMonUtc = new Date(baseUtc.getTime() + daysToNextMonday * 24 * 60 * 60 * 1000);
  const nextMondayDate = formatYMD(
    nextMonUtc.getUTCFullYear(),
    nextMonUtc.getUTCMonth() + 1,
    nextMonUtc.getUTCDate()
  );

  // Days since previous Monday (if already Monday, -7 days)
  const daysSincePrevMonday = dow === 0 ? 6 : dow === 1 ? 7 : dow - 1;
  const prevMonUtc = new Date(baseUtc.getTime() - daysSincePrevMonday * 24 * 60 * 60 * 1000);
  const prevMondayDate = formatYMD(
    prevMonUtc.getUTCFullYear(),
    prevMonUtc.getUTCMonth() + 1,
    prevMonUtc.getUTCDate()
  );

  return {
    nextMondayDate,
    nextMondayLabel: formatHumanDateShortRD(nextMondayDate),
    prevMondayDate,
    prevMondayLabel: formatHumanDateShortRD(prevMondayDate),
  };
}

/**
 * Calculates Easter Sunday for a given year using the anonymous Gregorian algorithm (Computus / Meeus).
 */
export function getEasterSunday(year: number): { month: number; day: number } {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31); // 3 = March, 4 = April
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return { month, day };
}

/**
 * Returns the list of official Dominican Republic calendar holidays for a specific year (on their original calendar date).
 */
export function getDominicanHolidays(year: number): { month: number; day: number; name: string }[] {
  const easter = getEasterSunday(year);
  const easterDate = new Date(Date.UTC(year, easter.month - 1, easter.day));

  // Viernes Santo (Good Friday): Easter Sunday - 2 days
  const goodFridayDate = new Date(easterDate.getTime() - 2 * 24 * 60 * 60 * 1000);
  // Corpus Christi: Easter Sunday + 60 days (always a Thursday)
  const corpusChristiDate = new Date(easterDate.getTime() + 60 * 24 * 60 * 60 * 1000);

  return [
    { month: 1, day: 1, name: 'Año Nuevo' },
    { month: 1, day: 6, name: 'Día de los Santos Reyes' },
    { month: 1, day: 21, name: 'Día de Nuestra Señora de la Altagracia' },
    { month: 1, day: 26, name: 'Día de Juan Pablo Duarte' },
    { month: 2, day: 27, name: 'Día de la Independencia Nacional' },
    {
      month: goodFridayDate.getUTCMonth() + 1,
      day: goodFridayDate.getUTCDate(),
      name: 'Viernes Santo (Semana Santa)',
    },
    { month: 5, day: 1, name: 'Día Internacional del Trabajo' },
    {
      month: corpusChristiDate.getUTCMonth() + 1,
      day: corpusChristiDate.getUTCDate(),
      name: 'Corpus Christi',
    },
    { month: 8, day: 16, name: 'Día de la Restauración de la República' },
    { month: 9, day: 24, name: 'Día de Nuestra Señora de las Mercedes' },
    { month: 11, day: 6, name: 'Día de la Constitución' },
    { month: 12, day: 25, name: 'Día de Navidad' },
  ];
}

/**
 * Dynamically calculates the list of years to display in the Dominican Republic Holiday Calendar selector.
 * Automatically expands future years as the next year approaches so it never stays stuck in 2027.
 */
export function getAvailableHolidayYears(
  currentRdYear: number,
  currentRdMonth: number,
  overridesInput?: HolidayOverride[],
  extraMaxYear?: number
): number[] {
  const overrides = overridesInput ?? globalHolidayOverrides;
  const startYear = Math.min(2025, currentRdYear - 1);
  // When approaching the next year (Sept-Dec, or anytime), preload upcoming years automatically
  const autoFutureOffset = currentRdMonth >= 9 ? 3 : 2;
  let maxYear = Math.max(currentRdYear + autoFutureOffset, 2028);

  if (extraMaxYear && extraMaxYear > maxYear && extraMaxYear <= 2100) {
    maxYear = extraMaxYear;
  }

  for (const o of overrides) {
    const origYear = parseInt((o.originalDate || '').slice(0, 4), 10);
    if (!isNaN(origYear) && origYear > maxYear && origYear <= 2100) {
      maxYear = origYear;
    }
    if (o.movedToDate) {
      const movedYear = parseInt(o.movedToDate.slice(0, 4), 10);
      if (!isNaN(movedYear) && movedYear > maxYear && movedYear <= 2100) {
        maxYear = movedYear;
      }
    }
  }

  const years: number[] = [];
  for (let y = startYear; y <= maxYear; y++) {
    years.push(y);
  }
  return years;
}

/**
 * Returns all official RD holidays + custom holidays for a given year enriched with user overrides.
 */
export function getHolidaysWithOverridesForYear(
  year: number,
  overridesInput?: HolidayOverride[]
): EnrichedHolidayItem[] {
  const overrides = overridesInput ?? globalHolidayOverrides;
  const baseHolidays = getDominicanHolidays(year);

  const items: EnrichedHolidayItem[] = baseHolidays.map(h => {
    const originalDate = formatYMD(year, h.month, h.day);
    const parsed = parseYMD(originalDate)!;
    const mondays = getSuggestedMondaysForDate(originalDate);
    const matchedOverride = overrides.find(
      o => !o.isCustom && (o.originalDate === originalDate || o.id === originalDate)
    );

    const status = matchedOverride?.status || 'normal';
    const movedToDate = status === 'moved' ? matchedOverride?.movedToDate : undefined;

    let effectiveDate: string | null = originalDate;
    if (status === 'moved' && movedToDate) {
      effectiveDate = movedToDate;
    } else if (status === 'workday') {
      effectiveDate = null;
    }

    return {
      id: originalDate,
      name: h.name,
      originalDate,
      originalDayName: DAY_NAMES[parsed.dayOfWeek],
      originalHumanDate: formatHumanDateShortRD(originalDate),
      status,
      effectiveDate,
      effectiveHumanDate: effectiveDate ? formatHumanDateShortRD(effectiveDate) : null,
      movedToDate,
      note: matchedOverride?.note,
      isCustom: false,
      ...mondays,
    };
  });

  // Also append custom holidays for that year
  const customForYear = overrides.filter(
    o => (o.isCustom || o.status === 'custom_holiday') && o.originalDate.startsWith(`${year}-`)
  );
  for (const c of customForYear) {
    const parsed = parseYMD(c.originalDate);
    if (!parsed) continue;
    const mondays = getSuggestedMondaysForDate(c.originalDate);
    items.push({
      id: c.id || `custom-${c.originalDate}`,
      name: c.name || 'Feriado / Cierre Especial',
      originalDate: c.originalDate,
      originalDayName: DAY_NAMES[parsed.dayOfWeek],
      originalHumanDate: formatHumanDateShortRD(c.originalDate),
      status: 'custom_holiday',
      effectiveDate: c.originalDate,
      effectiveHumanDate: formatHumanDateShortRD(c.originalDate),
      note: c.note,
      isCustom: true,
      ...mondays,
    });
  }

  return items.sort((a, b) => a.originalDate.localeCompare(b.originalDate));
}

/**
 * Evaluates whether a specific calendar date (year, month, day) is an active holiday,
 * or if it was originally a holiday that was moved to another day (making it a normal workday).
 */
export function evaluateDateHolidayStatus(
  year: number,
  month: number,
  day: number,
  overridesInput?: HolidayOverride[]
): {
  isHoliday: boolean;
  holidayName?: string;
  wasOriginalHolidayMoved?: boolean;
  originalHolidayName?: string;
  movedToDate?: string;
  movedToHumanDate?: string;
  movedHolidayNotice?: string;
} {
  const overrides = overridesInput ?? globalHolidayOverrides;
  const targetYMD = formatYMD(year, month, day);

  // 1. Check if a holiday from another date was MOVED to today (targetYMD)
  const movedHere = overrides.find(
    o => o.status === 'moved' && o.movedToDate === targetYMD && o.originalDate !== targetYMD
  );
  if (movedHere) {
    const origHuman = formatHumanDateShortRD(movedHere.originalDate);
    return {
      isHoliday: true,
      holidayName: `${movedHere.name} (Feriado movido del ${origHuman})`,
    };
  }

  // 2. Check if there is a custom holiday on targetYMD
  const customHere = overrides.find(
    o => (o.status === 'custom_holiday' || o.isCustom) && o.originalDate === targetYMD
  );
  if (customHere) {
    return {
      isHoliday: true,
      holidayName: `${customHere.name}${customHere.note ? ` — ${customHere.note}` : ''}`,
    };
  }

  // 3. Check official RD holidays for this date
  const officialHolidays = getDominicanHolidays(year);
  const official = officialHolidays.find(h => h.month === month && h.day === day);
  if (!official) {
    return { isHoliday: false };
  }

  // Check if user configured an override for this official holiday
  const overrideOnOriginal = overrides.find(
    o => !o.isCustom && (o.originalDate === targetYMD || o.id === targetYMD)
  );

  if (overrideOnOriginal) {
    if (overrideOnOriginal.status === 'moved' && overrideOnOriginal.movedToDate && overrideOnOriginal.movedToDate !== targetYMD) {
      const movedToHuman = formatHumanDateShortRD(overrideOnOriginal.movedToDate);
      const todayHuman = formatHumanDateShortRD(targetYMD);
      return {
        isHoliday: false,
        wasOriginalHolidayMoved: true,
        originalHolidayName: official.name,
        movedToDate: overrideOnOriginal.movedToDate,
        movedToHumanDate: movedToHuman,
        movedHolidayNotice: `El feriado "${official.name}" que originalmente caía hoy (${todayHuman}) fue MOVIDO para el ${movedToHuman}. Por lo tanto, HOY (${todayHuman}) NO ES FERIADO y es día laborable normal en Todo Lapto (8:30 AM a 6:00 PM).`,
      };
    }

    if (overrideOnOriginal.status === 'workday') {
      const todayHuman = formatHumanDateShortRD(targetYMD);
      return {
        isHoliday: false,
        wasOriginalHolidayMoved: true,
        originalHolidayName: official.name,
        movedHolidayNotice: `El feriado "${official.name}" (${todayHuman}) fue marcado como DÍA LABORABLE NORMAL. Hoy (${todayHuman}) NO es feriado y trabajamos en horario regular (8:30 AM a 6:00 PM).`,
      };
    }
  }

  return {
    isHoliday: true,
    holidayName: official.name,
  };
}

/**
 * Returns current Dominican Republic time and business status (open/closed) for Todo Lapto.
 * Todo Lapto Schedule:
 * - Monday through Saturday: 8:30 AM to 6:00 PM (08:30 - 18:00)
 * - Sunday: Closed all day
 * - Official RD Holidays (respecting user overrides/moved dates): Closed all day
 */
export function getDominicanTimeContext(
  baseDate: Date = new Date(),
  overridesInput?: HolidayOverride[]
): DominicanTimeContext {
  const overrides = overridesInput ?? globalHolidayOverrides;

  // Use Intl.DateTimeFormat in timezone 'America/Santo_Domingo' (UTC-4)
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Santo_Domingo',
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    weekday: 'short',
    hour: 'numeric',
    minute: 'numeric',
    second: 'numeric',
    hour12: false,
  });

  const parts = dtf.formatToParts(baseDate);
  const partMap: Record<string, string> = {};
  for (const p of parts) {
    partMap[p.type] = p.value;
  }

  const year = parseInt(partMap.year, 10);
  const month = parseInt(partMap.month, 10); // 1-12
  const day = parseInt(partMap.day, 10);
  let hour = parseInt(partMap.hour, 10);
  if (hour === 24) hour = 0;
  const minute = parseInt(partMap.minute, 10);
  const ymd = formatYMD(year, month, day);

  // Determine weekday in Santo Domingo time
  const localCalDate = new Date(Date.UTC(year, month - 1, day, 12, 0, 0));
  const dayOfWeek = localCalDate.getUTCDay(); // 0 = Sunday, 1 = Monday, ..., 6 = Saturday

  const dayName = DAY_NAMES[dayOfWeek];
  const monthName = MONTH_NAMES[month - 1];

  // Format 12h string
  const h12 = hour % 12 || 12;
  const ampm = hour >= 12 ? 'PM' : 'AM';
  const time12 = `${h12.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')} ${ampm}`;
  const time24 = `${hour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')}`;
  const fullDateStr = `${dayName} ${day} de ${monthName} de ${year}`;

  // Evaluate holiday with user overrides (moved holidays / workdays)
  const holidayEval = evaluateDateHolidayStatus(year, month, day, overrides);
  const isHoliday = holidayEval.isHoliday;
  const holidayName = holidayEval.holidayName;

  // Business open/close evaluation
  // Opening: 8:30 AM (08:30 = 8 * 60 + 30 = 510 minutes)
  // Closing: 6:00 PM (18:00 = 18 * 60 = 1080 minutes)
  const currentMinutes = hour * 60 + minute;
  const OPEN_MINUTES = 8 * 60 + 30; // 08:30
  const CLOSE_MINUTES = 18 * 60; // 18:00

  let isOpen = false;
  let statusReason: DominicanTimeContext['statusReason'] = 'closed_night';
  let statusSummary = '🔴 CERRADO';
  let statusDetail = '';
  let nextOpeningStr = '';
  let customerNotice = '';

  if (isHoliday) {
    isOpen = false;
    statusReason = 'closed_holiday';
    statusSummary = '🔴 CERRADO (Día Feriado)';
    statusDetail = `Cerrado por festividad oficial: ${holidayName}`;
    const nextOpen = findNextBusinessDay(year, month, day, dayOfWeek, overrides);
    nextOpeningStr = `${nextOpen.dayName} ${nextOpen.day} de ${nextOpen.monthName} a las 8:30 AM`;
    customerNotice = `Hoy es día feriado en República Dominicana (${holidayName}) y nuestra tienda y departamento de envíos se encuentran cerrados. Con gusto registramos y apartamos tu pedido ahora mismo, y será despachado a primera hora el ${nextOpeningStr}.`;
  } else if (dayOfWeek === 0) {
    // Sunday
    isOpen = false;
    statusReason = 'closed_sunday';
    statusSummary = '🔴 CERRADO (Domingo)';
    statusDetail = 'Cerrado por descanso dominical (Atención de Lunes a Sábado de 8:30 AM a 6:00 PM)';
    const nextOpen = findNextBusinessDay(year, month, day, dayOfWeek, overrides);
    nextOpeningStr = `${nextOpen.dayName} ${nextOpen.day} de ${nextOpen.monthName} a las 8:30 AM`;
    customerNotice = `Hoy domingo nuestra tienda y mensajería están cerradas por descanso semanal. Podemos apartar y dejar registrado tu pedido de inmediato, y será despachado el ${nextOpeningStr} tan pronto iniciemos labores.`;
  } else {
    // Monday through Saturday (including days where an original holiday was moved to another day!)
    const movedNoteSuffix = holidayEval.wasOriginalHolidayMoved
      ? ` — Nota: El feriado ${holidayEval.originalHolidayName} fue movido${holidayEval.movedToHumanDate ? ` al ${holidayEval.movedToHumanDate}` : ''}, hoy laboramos normal`
      : '';

    if (currentMinutes >= OPEN_MINUTES && currentMinutes < CLOSE_MINUTES) {
      isOpen = true;
      statusReason = 'open';
      statusSummary = holidayEval.wasOriginalHolidayMoved
        ? '🟢 ABIERTO (Feriado Movido — Hoy Laborable)'
        : '🟢 ABIERTO';
      statusDetail = `Abierto en horario laboral (Lunes a Sábado de 8:30 AM a 6:00 PM)${movedNoteSuffix}`;
      nextOpeningStr = `Hoy hasta las 6:00 PM`;
      customerNotice = `Estamos abiertos y operando activamente${movedNoteSuffix}. Tu pedido puede ser preparado y despachado hoy mismo en Santo Domingo o enviado al interior.`;
    } else if (currentMinutes < OPEN_MINUTES) {
      // Early morning before 8:30 AM
      isOpen = false;
      statusReason = 'closed_morning';
      statusSummary = '🔴 CERRADO (Antes de apertura)';
      statusDetail = `Aún no abrimos. Abrimos hoy a las 8:30 AM.${movedNoteSuffix}`;
      nextOpeningStr = `Hoy a las 8:30 AM`;
      customerNotice = `Nuestra tienda y mensajería abren hoy a las 8:30 AM${movedNoteSuffix}. Podemos tomar y apartar tu pedido ahora mismo, y lo prepararemos para entrega tan pronto iniciemos labores a las 8:30 AM.`;
    } else {
      // Evening after 6:00 PM
      isOpen = false;
      statusReason = 'closed_night';
      statusSummary = '🔴 CERRADO (Horario Nocturno)';
      statusDetail = `Cerrado por fin de jornada laboral (Horario de 8:30 AM a 6:00 PM)${movedNoteSuffix}`;
      const nextOpen = findNextBusinessDay(year, month, day, dayOfWeek, overrides);
      nextOpeningStr = `${nextOpen.isTomorrow ? 'Mañana ' : ''}${nextOpen.dayName} ${nextOpen.day} de ${nextOpen.monthName} a las 8:30 AM`;
      customerNotice = `Nuestra jornada laboral de hoy ya ha concluido (cerramos a las 6:00 PM). Podemos tomar tus datos y dejar tu orden registrada y apartada en el sistema, y te la estaremos enviando a primera hora ${nextOpeningStr} tan pronto abramos el negocio.`;
    }
  }

  return {
    date: baseDate,
    year,
    month,
    day,
    ymd,
    dayOfWeek,
    dayName,
    monthName,
    hour,
    minute,
    time12,
    time24,
    fullDateStr,
    isHoliday,
    holidayName,
    wasOriginalHolidayMoved: holidayEval.wasOriginalHolidayMoved,
    originalHolidayName: holidayEval.originalHolidayName,
    movedToDate: holidayEval.movedToDate,
    movedToHumanDate: holidayEval.movedToHumanDate,
    movedHolidayNotice: holidayEval.movedHolidayNotice,
    isOpen,
    statusReason,
    statusSummary,
    statusDetail,
    nextOpeningStr,
    customerNotice,
  };
}

/**
 * Helper to find the next business open day starting from tomorrow, respecting moved holidays.
 */
function findNextBusinessDay(
  currentYear: number,
  currentMonth: number,
  currentDay: number,
  currentDayOfWeek: number,
  overrides?: HolidayOverride[]
): { dayName: string; day: number; monthName: string; isTomorrow: boolean } {
  let probeDate = new Date(Date.UTC(currentYear, currentMonth - 1, currentDay, 12, 0, 0));
  let step = 0;

  while (step < 14) {
    step++;
    probeDate = new Date(probeDate.getTime() + 24 * 60 * 60 * 1000);
    const pYear = probeDate.getUTCFullYear();
    const pMonth = probeDate.getUTCMonth() + 1;
    const pDay = probeDate.getUTCDate();
    const pDayOfWeek = probeDate.getUTCDay();

    // Skip Sundays
    if (pDayOfWeek === 0) continue;

    // Evaluate Holidays (respecting moved dates and workday overrides)
    const evalStatus = evaluateDateHolidayStatus(pYear, pMonth, pDay, overrides);
    if (evalStatus.isHoliday) continue;

    // Found open day!
    return {
      dayName: DAY_NAMES[pDayOfWeek],
      day: pDay,
      monthName: MONTH_NAMES[pMonth - 1],
      isTomorrow: step === 1,
    };
  }

  return {
    dayName: 'el próximo día laborable',
    day: currentDay + 1,
    monthName: MONTH_NAMES[currentMonth - 1],
    isTomorrow: true,
  };
}

/**
 * Builds a concise summary of active holiday changes (moved holidays / workday overrides)
 * so the AI always knows both that the original day is NO LONGER a holiday and which day IS the holiday.
 */
export function buildHolidayOverridesSummaryText(
  year: number,
  overridesInput?: HolidayOverride[]
): string {
  const overrides = overridesInput ?? globalHolidayOverrides;
  if (!overrides || overrides.length === 0) {
    return 'Todos los días feriados oficiales de RD se celebran en su fecha calendario original (sin traslados configurados actualmente).';
  }

  const lines: string[] = [];
  for (const o of overrides) {
    if (o.status === 'moved' && o.movedToDate) {
      const origHuman = formatHumanDateShortRD(o.originalDate, true);
      const movedHuman = formatHumanDateShortRD(o.movedToDate, true);
      lines.push(
        `• 🔄 FERIADO MOVIDO (${o.name}): Originalmente caía el ${origHuman}, pero fue MOVIDO al ${movedHuman}. ➡️ IMPORTANTE: El ${origHuman} YA NO ES FERIADO (se trabaja en horario normal de 8:30 AM a 6:00 PM) y el día cerrado por feriado pasa a ser el ${movedHuman}.`
      );
    } else if (o.status === 'workday') {
      const origHuman = formatHumanDateShortRD(o.originalDate, true);
      lines.push(
        `• 💼 FERIADO HABILITADO COMO LABORABLE (${o.name}): El ${origHuman} YA NO ES FERIADO para la tienda; trabajamos en horario normal de 8:30 AM a 6:00 PM.`
      );
    } else if (o.status === 'custom_holiday' || o.isCustom) {
      const origHuman = formatHumanDateShortRD(o.originalDate, true);
      lines.push(
        `• 🔴 DÍA FERIADO / CIERRE ESPECIAL (${o.name}): El ${origHuman} la tienda y el despacho estarán CERRADOS todo el día${o.note ? ` (${o.note})` : ''}.`
      );
    }
  }

  if (lines.length === 0) {
    return 'Todos los días feriados oficiales de RD se celebran en su fecha calendario original.';
  }

  return lines.join('\n');
}

/**
 * Builds the AI prompt context block for the Dominican Republic Date, Time & Business Schedule.
 */
export function buildDominicanTimePromptContext(
  baseDate: Date = new Date(),
  overridesInput?: HolidayOverride[]
): string {
  const overrides = overridesInput ?? globalHolidayOverrides;
  const ctx = getDominicanTimeContext(baseDate, overrides);
  const holidayOverridesSummary = buildHolidayOverridesSummaryText(ctx.year, overrides);

  const movedTodayDirective = ctx.movedHolidayNotice
    ? `\n📢 **ATENCIÓN ESPECIAL SOBRE EL FERIADO DE HOY:**\n${ctx.movedHolidayNotice}\n- Si el cliente pregunta si hoy estamos abiertos o si trabajamos hoy por el feriado, confírmale claramente que **HOY SÍ ESTAMOS LABORANDO NORMALMENTE de 8:30 AM a 6:00 PM** porque ese día feriado fue movido${ctx.movedToHumanDate ? ` para el ${ctx.movedToHumanDate}` : ''}.\n`
    : '';

  const orderDirective = ctx.isOpen
    ? `🟢 **LA TIENDA Y EL SERVICIO DE ENVÍOS ESTÁN ABIERTOS EN ESTE MOMENTO.**
- Puedes confirmar pedidos para despacho el mismo día en Santo Domingo (mensajería privada en 2 a 4 horas) o envío a provincias por Metro Pac / Caribe Tours / Vimenpaq.
- Si el cliente pregunta si puede pasar a la tienda física en la Av. Charles de Gaulle #133, confirma que estamos ABIERTOS ahora mismo hasta las 6:00 PM.${movedTodayDirective}`
    : `🔴 **LA TIENDA FÍSICA Y EL SERVICIO DE ENVÍOS ESTÁN CERRADOS EN ESTE MOMENTO.**
(${ctx.statusDetail})
${movedTodayDirective}
⚠️ **REGLA CRÍTICA PARA PEDIDOS FUERA DE HORARIO / CERRADO:**
1. **SÍ PUEDES Y DEBES TOMAR EL PEDIDO:**
   - Toma los datos del cliente con total normalidad (nombre, teléfono, producto, dirección y método de pago).
   - Genera la cotización o registra la orden en el sistema. ¡NUNCA rechaces una venta por estar cerrado!
2. **ACLARACIÓN OBLIGATORIA DE ENTREGA AL CLIENTE:**
   - Explícale cordialmente que el negocio y la tienda están cerrados en este momento (${ctx.statusReason === 'closed_holiday' ? `por ser día feriado: ${ctx.holidayName}` : ctx.statusReason === 'closed_sunday' ? 'por ser domingo' : 'por ser horario nocturno fuera de jornada laboral'}).
   - Infórmale con total claridad y seguridad que **su equipo queda apartado y reservado**, y que **su orden será despachada y coordinada tan pronto abramos nuestras puertas: ${ctx.nextOpeningStr}**.
3. **SI PREGUNTA POR VISITAR LA TIENDA FÍSICA:**
   - Aclárale que la tienda física en la Av. Charles de Gaulle #133 está actualmente cerrada y que con gusto le esperamos en nuestra próxima apertura (${ctx.nextOpeningStr}).`;

  return `
======================================================================
🕒 FECHA, HORA Y ESTADO DEL NEGOCIO EN REPÚBLICA DOMINICANA (HORA RD)
======================================================================
- Fecha actual en RD: ${ctx.fullDateStr}
- Hora actual en RD: ${ctx.time12} (${ctx.time24} hrs) · Zona: America/Santo_Domingo (UTC-4)
- Estado operativo del negocio: ${ctx.statusSummary}
- Detalle de horario: ${ctx.statusDetail}
${ctx.isHoliday ? `- 🇩🇴 FESTIVIDAD NACIONAL ACTIVA HOY: ${ctx.holidayName} (Día no laborable en RD)\n` : ''}${ctx.movedHolidayNotice ? `- 🔄 CAMBIO DE DÍA FERIADO HOY: ${ctx.movedHolidayNotice}\n` : ''}- Próxima apertura comercial: ${ctx.nextOpeningStr}
- Horario oficial Todo Lapto: Lunes a Sábado de 8:30 AM a 6:00 PM · Domingos: Cerrado

📅 CAMBIOS DE DÍAS FERIADOS EN RD (TRASLADOS A LUNES / DÍAS LABORABLES):
${holidayOverridesSummary}

INSTRUCCIÓN DE OPERACIÓN PARA LA IA EN ESTE INSTANTE:
${orderDirective}
======================================================================`;
}
