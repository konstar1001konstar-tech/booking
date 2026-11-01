/* Даты слотов и файл .ics считаются в часовом поясе мастера, не в поясе телефона клиента. */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.BookingCalendar = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  function pad(n) {
    return String(n).padStart(2, '0');
  }

  function zonedParts(date, timeZone) {
    var fmt = new Intl.DateTimeFormat('en-US', {
      timeZone: timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      weekday: 'short'
    });
    var out = { year: '1970', month: '01', day: '01', hour: '00', minute: '00', second: '00', weekday: 'Sun' };
    fmt.formatToParts(date).forEach(function (p) {
      if (p.type !== 'literal') out[p.type] = p.value;
    });
    if (out.hour === '24') out.hour = '00';
    return out;
  }

  function offsetMinutes(date, timeZone) {
    var p = zonedParts(date, timeZone);
    var shown = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
    return Math.round((shown - date.getTime()) / 60000);
  }

  function formatOffset(mins) {
    var sign = mins >= 0 ? '+' : '-';
    var a = Math.abs(mins);
    return sign + pad(Math.floor(a / 60)) + pad(a % 60);
  }

  function zonedTimeToUtc(iso, hhmm, timeZone) {
    var date = iso.split('-').map(Number);
    var time = hhmm.split(':').map(Number);
    var wall = Date.UTC(date[0], date[1] - 1, date[2], time[0], time[1], 0);
    function shift(utcMs) {
      return wall - offsetMinutes(new Date(utcMs), timeZone) * 60000;
    }
    return new Date(shift(shift(wall)));
  }

  function todayISO(timeZone, now) {
    var p = zonedParts(now || new Date(), timeZone);
    return p.year + '-' + p.month + '-' + p.day;
  }

  function addDaysISO(iso, days) {
    var parts = iso.split('-').map(Number);
    var dt = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2] + days));
    return dt.getUTCFullYear() + '-' + pad(dt.getUTCMonth() + 1) + '-' + pad(dt.getUTCDate());
  }

  function weekdayOfISO(iso) {
    var parts = iso.split('-').map(Number);
    return new Date(Date.UTC(parts[0], parts[1] - 1, parts[2])).getUTCDay();
  }

  function utcStamp(date) {
    return date.getUTCFullYear() + pad(date.getUTCMonth() + 1) + pad(date.getUTCDate()) +
      'T' + pad(date.getUTCHours()) + pad(date.getUTCMinutes()) + pad(date.getUTCSeconds()) + 'Z';
  }

  function localStamp(date, timeZone) {
    var p = zonedParts(date, timeZone);
    return p.year + p.month + p.day + 'T' + p.hour + p.minute + p.second;
  }

  function icsText(value) {
    return String(value == null ? '' : value)
      .replace(/\\/g, '\\\\')
      .replace(/\r\n|\n|\r/g, '\\n')
      .replace(/;/g, '\\;')
      .replace(/,/g, '\\,');
  }

  function foldLine(line) {
    var bytes = new TextEncoder().encode(line);
    if (bytes.length <= 75) return line;
    var parts = [];
    var i = 0;
    var first = true;
    var dec = new TextDecoder('utf-8', { fatal: true });
    while (i < bytes.length) {
      var budget = first ? 75 : 74;
      var end = Math.min(i + budget, bytes.length);
      if (end < bytes.length) {
        while (end > i && (bytes[end] & 0xc0) === 0x80) end -= 1;
        if (end === i) end = Math.min(i + budget, bytes.length);
      }
      var chunk = dec.decode(bytes.subarray(i, end));
      parts.push(first ? chunk : ' ' + chunk);
      i = end;
      first = false;
    }
    return parts.join('\r\n');
  }

  function parseDurationMin(dur) {
    var raw = String(dur || '').trim().toLowerCase();
    if (!raw) return 60;
    var s = raw.replace(/,/g, '.');
    var min = 0;
    var matched = false;
    var hm = s.match(/(\d+(?:\.\d+)?)\s*(?:часов|часа|час|ч|h)/);
    var mm = s.match(/(\d+(?:\.\d+)?)\s*(?:минут|минуты|минута|мин|м|min)/);
    if (hm) {
      min += Math.round(parseFloat(hm[1]) * 60);
      matched = true;
    }
    if (mm) {
      min += Math.round(parseFloat(mm[1]));
      matched = true;
    }
    if (!matched) {
      var n = parseFloat(s);
      if (isFinite(n) && n > 0) {
        min = n <= 12 ? Math.round(n * 60) : Math.round(n);
        matched = true;
      }
    }
    if (!matched || min <= 0) return 60;
    if (min > 12 * 60) return 12 * 60;
    return min;
  }

  function vtimezoneLines(timeZone, start) {
    var off = formatOffset(offsetMinutes(start, timeZone));
    var local = zonedParts(start, timeZone);
    var jan = zonedTimeToUtc(local.year + '-01-15', '12:00', timeZone);
    var kind = formatOffset(offsetMinutes(jan, timeZone)) === off ? 'STANDARD' : 'DAYLIGHT';
    return [
      'BEGIN:VTIMEZONE',
      'TZID:' + timeZone,
      'BEGIN:' + kind,
      'DTSTART:19700101T000000',
      'TZOFFSETFROM:' + off,
      'TZOFFSETTO:' + off,
      'TZNAME:GMT' + off,
      'END:' + kind,
      'END:VTIMEZONE'
    ];
  }

  function makeUid() {
    var bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    var hex = '';
    bytes.forEach(function (b) { hex += b.toString(16).padStart(2, '0'); });
    return hex + '@booking-card';
  }

  function buildIcs(opts) {
    var tz = opts.timeZone || 'Europe/Moscow';
    var start = opts.start;
    var end = opts.end;
    var lines = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//BookingCard//Online Booking//RU',
      'CALSCALE:GREGORIAN',
      'METHOD:PUBLISH'
    ].concat(vtimezoneLines(tz, start), [
      'BEGIN:VEVENT',
      'UID:' + (opts.uid || makeUid()),
      'DTSTAMP:' + utcStamp(opts.stamp || new Date()),
      'DTSTART;TZID=' + tz + ':' + localStamp(start, tz),
      'DTEND;TZID=' + tz + ':' + localStamp(end, tz),
      'SUMMARY:' + icsText(opts.summary)
    ]);
    if (opts.location) lines.push('LOCATION:' + icsText(opts.location));
    lines.push('DESCRIPTION:' + icsText(opts.description));
    lines.push('BEGIN:VALARM');
    lines.push('TRIGGER:-PT2H');
    lines.push('ACTION:DISPLAY');
    lines.push('DESCRIPTION:' + icsText(opts.alarmText || 'Напоминание о записи'));
    lines.push('END:VALARM');
    lines.push('END:VEVENT');
    lines.push('END:VCALENDAR');
    return lines.map(foldLine).join('\r\n') + '\r\n';
  }

  function googleCalendarUrl(opts) {
    var tz = opts.timeZone || 'Europe/Moscow';
    var url = new URL('https://calendar.google.com/calendar/render');
    url.searchParams.set('action', 'TEMPLATE');
    url.searchParams.set('text', opts.summary || '');
    url.searchParams.set('dates', localStamp(opts.start, tz) + '/' + localStamp(opts.end, tz));
    url.searchParams.set('details', opts.description || '');
    if (opts.location) url.searchParams.set('location', opts.location);
    url.searchParams.set('ctz', tz);
    return url.toString();
  }

  return {
    zonedParts: zonedParts,
    zonedTimeToUtc: zonedTimeToUtc,
    todayISO: todayISO,
    addDaysISO: addDaysISO,
    weekdayOfISO: weekdayOfISO,
    offsetMinutes: offsetMinutes,
    formatOffset: formatOffset,
    parseDurationMin: parseDurationMin,
    icsText: icsText,
    foldLine: foldLine,
    buildIcs: buildIcs,
    googleCalendarUrl: googleCalendarUrl,
    localStamp: localStamp,
    utcStamp: utcStamp
  };
});
