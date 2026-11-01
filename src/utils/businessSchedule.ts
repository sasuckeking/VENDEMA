// Dominican Republic Business Schedule & Official Holidays Utility for Todo Lapto

export interface DominicanTimeContext {
  date: Date;
  year: number;
  month: number; // 1-12
  day: number; // 1-31
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
  isOpen: boolean;
  statusReason: 'open' | 'closed_night' | 'closed_morning' | 'closed_sunday' | 'closed_holiday';
  statusSummary: string; // '🟢 ABIERTO' or '🔴 CERRADO'
  statusDetail: string; // 'Abierto (Lunes a Sábado de 8:30 AM a 6:00 PM)' or 'Cerrado por horario nocturno...'
  nextOpeningStr: string; // 'Mañana viernes a las 8:30 AM'
  customerNotice: string;
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
 * Returns the list of official Dominican Republic holidays for a specific year.
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

const DAY_NAMES = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];
const MONTH_NAMES = [
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

/**
 * Returns current Dominican Republic time and business status (open/closed) for Todo Lapto.
 * Todo Lapto Schedule:
 * - Monday through Saturday: 8:30 AM to 6:00 PM (08:30 - 18:00)
 * - Sunday: Closed all day
 * - Official RD Holidays: Closed all day
 */
export function getDominicanTimeContext(baseDate: Date = new Date()): DominicanTimeContext {
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

  // Determine weekday in Santo Domingo time
  // Construct a noon UTC date matching the local RD calendar day to get consistent dayOfWeek
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

  // Check holiday
  const holidays = getDominicanHolidays(year);
  const holiday = holidays.find(h => h.month === month && h.day === day);
  const isHoliday = Boolean(holiday);
  const holidayName = holiday?.name;

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
    // Next day could be holiday or Sunday, check forward
    const nextOpen = findNextBusinessDay(year, month, day, dayOfWeek);
    nextOpeningStr = `${nextOpen.dayName} ${nextOpen.day} de ${nextOpen.monthName} a las 8:30 AM`;
    customerNotice = `Hoy es día feriado en República Dominicana (${holidayName}) y nuestra tienda y departamento de envíos se encuentran cerrados. Con gusto registramos y apartamos tu pedido ahora mismo, y será despachado a primera hora el ${nextOpeningStr}.`;
  } else if (dayOfWeek === 0) {
    // Sunday
    isOpen = false;
    statusReason = 'closed_sunday';
    statusSummary = '🔴 CERRADO (Domingo)';
    statusDetail = 'Cerrado por descanso dominical (Atención de Lunes a Sábado de 8:30 AM a 6:00 PM)';
    const nextOpen = findNextBusinessDay(year, month, day, dayOfWeek);
    nextOpeningStr = `${nextOpen.dayName} a las 8:30 AM`;
    customerNotice = `Hoy domingo nuestra tienda y mensajería están cerradas por descanso semanal. Podemos apartar y dejar registrado tu pedido de inmediato, y será despachado el ${nextOpeningStr} tan pronto iniciemos labores.`;
  } else {
    // Monday through Saturday
    if (currentMinutes >= OPEN_MINUTES && currentMinutes < CLOSE_MINUTES) {
      isOpen = true;
      statusReason = 'open';
      statusSummary = '🟢 ABIERTO';
      statusDetail = `Abierto en horario laboral (Lunes a Sábado de 8:30 AM a 6:00 PM)`;
      nextOpeningStr = `Hoy hasta las 6:00 PM`;
      customerNotice = `Estamos abiertos y operando activamente. Tu pedido puede ser preparado y despachado hoy mismo en Santo Domingo o enviado al interior.`;
    } else if (currentMinutes < OPEN_MINUTES) {
      // Early morning before 8:30 AM
      isOpen = false;
      statusReason = 'closed_morning';
      statusSummary = '🔴 CERRADO (Antes de apertura)';
      statusDetail = 'Aún no abrimos. Abrimos hoy a las 8:30 AM.';
      nextOpeningStr = `Hoy a las 8:30 AM`;
      customerNotice = `Nuestra tienda y mensajería abren hoy a las 8:30 AM. Podemos tomar y apartar tu pedido ahora mismo, y lo prepararemos para entrega tan pronto iniciemos labores a las 8:30 AM.`;
    } else {
      // Evening after 6:00 PM
      isOpen = false;
      statusReason = 'closed_night';
      statusSummary = '🔴 CERRADO (Horario Nocturno)';
      statusDetail = 'Cerrado por fin de jornada laboral (Horario de 8:30 AM a 6:00 PM)';
      const nextOpen = findNextBusinessDay(year, month, day, dayOfWeek);
      nextOpeningStr = `${nextOpen.isTomorrow ? 'Mañana ' : ''}${nextOpen.dayName} a las 8:30 AM`;
      customerNotice = `Nuestra jornada laboral de hoy ya ha concluido (cerramos a las 6:00 PM). Podemos tomar tus datos y dejar tu orden registrada y apartada en el sistema, y te la estaremos enviando a primera hora ${nextOpeningStr} tan pronto abramos el negocio.`;
    }
  }

  return {
    date: baseDate,
    year,
    month,
    day,
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
    isOpen,
    statusReason,
    statusSummary,
    statusDetail,
    nextOpeningStr,
    customerNotice,
  };
}

/**
 * Helper to find the next business open day starting from tomorrow.
 */
function findNextBusinessDay(
  currentYear: number,
  currentMonth: number,
  currentDay: number,
  currentDayOfWeek: number
): { dayName: string; day: number; monthName: string; isTomorrow: boolean } {
  let probeDate = new Date(Date.UTC(currentYear, currentMonth - 1, currentDay, 12, 0, 0));
  let step = 0;

  while (step < 10) {
    step++;
    probeDate = new Date(probeDate.getTime() + 24 * 60 * 60 * 1000);
    const pYear = probeDate.getUTCFullYear();
    const pMonth = probeDate.getUTCMonth() + 1;
    const pDay = probeDate.getUTCDate();
    const pDayOfWeek = probeDate.getUTCDay();

    // Skip Sundays
    if (pDayOfWeek === 0) continue;

    // Skip Holidays
    const holidays = getDominicanHolidays(pYear);
    const isHoliday = holidays.some(h => h.month === pMonth && h.day === pDay);
    if (isHoliday) continue;

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
 * Builds the AI prompt context block for the Dominican Republic Date, Time & Business Schedule.
 */
export function buildDominicanTimePromptContext(baseDate: Date = new Date()): string {
  const ctx = getDominicanTimeContext(baseDate);

  const orderDirective = ctx.isOpen
    ? `🟢 **LA TIENDA Y EL SERVICIO DE ENVÍOS ESTÁN ABIERTOS EN ESTE MOMENTO.**
- Puedes confirmar pedidos para despacho el mismo día en Santo Domingo (mensajería privada en 2 a 4 horas) o envío a provincias por Metro Pac / Caribe Tours / Vimenpaq.
- Si el cliente pregunta si puede pasar a la tienda física en la Av. Charles de Gaulle #133, confirma que estamos ABIERTOS ahora mismo hasta las 6:00 PM.`
    : `🔴 **LA TIENDA FÍSICA Y EL SERVICIO DE ENVÍOS ESTÁN CERRADOS EN ESTE MOMENTO.**
(${ctx.statusDetail})

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
${ctx.isHoliday ? `- 🇩🇴 FESTIVIDAD NACIONAL DE HOY: ${ctx.holidayName} (Día no laborable en RD)\n` : ''}- Próxima apertura comercial: ${ctx.nextOpeningStr}
- Horario oficial Todo Lapto: Lunes a Sábado de 8:30 AM a 6:00 PM · Domingos: Cerrado

INSTRUCCIÓN DE OPERACIÓN PARA LA IA EN ESTE INSTANTE:
${orderDirective}
======================================================================`;
}
