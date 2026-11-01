'use strict';

const cal = require('../../../calendar.js');
const { HttpError } = require('../errors');

function dateText(iso, timeZone) {
  const when = cal.zonedTimeToUtc(iso, '12:00', timeZone);
  const text = new Intl.DateTimeFormat('ru-RU', {
    timeZone,
    weekday: 'long',
    day: 'numeric',
    month: 'long'
  }).format(when);
  return text ? text.charAt(0).toUpperCase() + text.slice(1) : iso;
}

function assertSlotOpen(profile, date, time, now) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw new HttpError(400, 'validation', 'Выберите дату.');
  }
  if (!profile.slots.includes(time)) {
    throw new HttpError(400, 'validation', 'Этого времени нет в графике мастера.');
  }
  const weekday = cal.weekdayOfISO(date);
  if (!profile.workDays.includes(weekday)) {
    throw new HttpError(400, 'validation', 'В этот день мастер не принимает.');
  }
  const today = cal.todayISO(profile.tz, now);
  const last = cal.addDaysISO(today, profile.horizon - 1);
  if (date < today || date > last) {
    throw new HttpError(400, 'validation', 'Эта дата вне открытого горизонта записи.');
  }
  const when = cal.zonedTimeToUtc(date, time, profile.tz);
  if (when.getTime() <= now.getTime()) {
    throw new HttpError(400, 'validation', 'Это время уже прошло.');
  }
  return when;
}

module.exports = { dateText, assertSlotOpen };
