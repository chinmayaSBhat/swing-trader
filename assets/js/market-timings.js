// Market timings and holiday helpers for Indian markets
const MARKET_HOLIDAYS_2026 = [
  "2026-01-26", // Republic Day
  "2026-03-14", // Holi
  "2026-04-02", // Ram Navami
  "2026-04-10", // Mahavir Jayanti
  "2026-04-14", // Ambedkar Jayanti
  "2026-04-21", // Mahavir Jayanti
  "2026-05-01", // Maharashtra Day
  "2026-08-15", // Independence Day
  "2026-10-02", // Gandhi Jayanti
  "2026-11-04", // Diwali
  "2026-11-05", // Diwali
  "2026-12-25", // Christmas
  // Add all NSE/BSE holidays
];

function toIST(date = new Date()) {
  // return a Date object representing current time in IST by using locale conversion
  return new Date(date.toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }));
}

function isHoliday(dateStr) {
  return MARKET_HOLIDAYS_2026.includes(dateStr);
}

function isMarketOpen() {
  try {
    const now = toIST();
    const day = now.getDay();
    if (day === 0 || day === 6) return false;
    const dateStr = now.toISOString().split('T')[0];
    if (isHoliday(dateStr)) return false;
    const hour = now.getHours();
    const minute = now.getMinutes();
    const currentTime = hour * 60 + minute;
    const marketOpen = 9 * 60 + 15; // 9:15
    const marketClose = 15 * 60 + 30; // 15:30
    return currentTime >= marketOpen && currentTime <= marketClose;
  } catch (e) {
    console.error('isMarketOpen error', e);
    return false;
  }
}

function toDateWithOffsetISO(dateStr, hh, mm) {
  // build ISO with IST offset so Date() parses as correct UTC equivalent
  // e.g. '2026-02-27T09:15:00+05:30'
  return new Date(`${dateStr}T${String(hh).padStart(2,'0')}:${String(mm).padStart(2,'0')}:00+05:30`);
}

function formatCountdown(ms) {
  if (ms <= 0) return '0m';
  const totalMin = Math.floor(ms / 60000);
  const days = Math.floor(totalMin / (60*24));
  const hours = Math.floor((totalMin % (60*24)) / 60);
  const minutes = totalMin % 60;
  if (days > 0) return `${days}d ${hours}h ${minutes}m`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

function getNextMarketOpen() {
  try {
    const now = new Date();
    const istNow = toIST(now);
    const todayStr = istNow.toISOString().split('T')[0];
    const marketOpenToday = toDateWithOffsetISO(todayStr, 9, 15);
    const marketCloseToday = toDateWithOffsetISO(todayStr, 15, 30);

    // if market open now
    if (isMarketOpen()) {
      const diff = marketCloseToday - now;
      return `Market closes in ${formatCountdown(diff)}`;
    }

    // if before open today and today is trading day
    const day = istNow.getDay();
    const isWeekend = (day === 0 || day === 6);
    const isHolidayToday = isHoliday(todayStr);
    if (!isWeekend && !isHolidayToday && istNow < marketOpenToday) {
      const diff = marketOpenToday - now;
      return `Market opens in ${formatCountdown(diff)}`;
    }

    // otherwise search next day
    for (let i = 1; i < 10; i++) {
      const candidate = new Date(istNow.getTime() + i * 24 * 60 * 60 * 1000);
      const candStr = candidate.toISOString().split('T')[0];
      const candDay = candidate.getDay();
      if (candDay === 0 || candDay === 6) continue;
      if (isHoliday(candStr)) continue;
      const nextOpen = toDateWithOffsetISO(candStr, 9, 15);
      const diff = nextOpen - now;
      return `Market opens in ${formatCountdown(diff)}`;
    }

    return 'Market schedule unavailable';
  } catch (e) {
    console.error('getNextMarketOpen error', e);
    return 'Unknown';
  }
}

export { MARKET_HOLIDAYS_2026, isMarketOpen, getNextMarketOpen };