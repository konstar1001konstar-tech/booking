'use strict';

const { THEMES } = require('./themes');
const CATEGORIES = ['manicure', 'massage', 'brows', 'other'];
const DEFAULT_TZ = 'Europe/Moscow';
const DEFAULT_WORK_DAYS = [1, 2, 3, 4, 5, 6];
const DEFAULT_SLOTS = ['10:00', '12:00', '14:00', '16:00', '18:00'];
const RESERVED = new Set([
  'admin', 'api', 'login', 'assets', 'static', 'health', 'index', 'app',
  'www', 'telegram', 'webhook', 'robots', 'favicon', 'media'
]);

function validTz(tz) {
  const candidate = String(tz || '').trim() || DEFAULT_TZ;
  try {
    Intl.DateTimeFormat('ru-RU', { timeZone: candidate }).format(new Date());
    return candidate;
  } catch (e) {
    return '';
  }
}

function parseSlots(text) {
  const out = [];
  const src = Array.isArray(text) ? text.join(',') : String(text == null ? '' : text);
  for (const raw of src.split(/[,;\s]+/)) {
    if (!raw) continue;
    const m = /^([01]?\d|2[0-3]):([0-5]\d)$/.exec(raw);
    if (!m) return null;
    const t = m[1].padStart(2, '0') + ':' + m[2];
    if (!out.includes(t)) out.push(t);
  }
  return out.length && out.length <= 16 ? out.sort() : null;
}

function parseWorkDays(v) {
  if (v == null || v === '') return null;
  const src = Array.isArray(v) ? v : String(v).split(/[,;\s]+/);
  const out = [];
  for (const item of src) {
    if (item === '' || item == null) continue;
    const n = Number(item);
    if (Number.isInteger(n) && n >= 0 && n <= 6 && !out.includes(n)) out.push(n);
  }
  return out.length ? out.sort((a, b) => a - b) : null;
}

function parseHorizon(v) {
  const n = Math.round(Number(v));
  if (!Number.isFinite(n) || n < 1 || n > 60) return null;
  return n;
}

function cleanPhone(v) {
  const s = String(v || '').trim();
  if (!s) return '';
  let d = s.replace(/\D/g, '');
  if (d.length === 11 && d[0] === '8') d = '7' + d.slice(1);
  if (d.length < 8 || d.length > 15) return '';
  return '+' + d;
}

function cleanTelegram(v) {
  const s = String(v || '').trim();
  if (!s) return '';
  const at = s.match(/^@([A-Za-z0-9_]{5,32})$/);
  if (at) return '@' + at[1];
  try {
    const u = new URL(s);
    if (u.protocol === 'https:' && (u.hostname === 't.me' || u.hostname === 'telegram.me')) {
      const name = u.pathname.replace(/^\/+|\/+$/g, '');
      if (/^[A-Za-z0-9_]{5,32}$/.test(name)) return 'https://t.me/' + name;
    }
  } catch (e) { /* не ссылка */ }
  return null;
}

function cleanInn(v) {
  const raw = String(v || '').trim();
  if (!raw) return '';
  const d = raw.replace(/\D/g, '');
  return d.length === 10 || d.length === 12 ? d : null;
}

function httpsUrl(v, max) {
  const s = String(v || '').trim().slice(0, max || 500);
  if (!s) return '';
  return /^https:\/\//i.test(s) ? s : null;
}

function validateSlug(slug) {
  const s = String(slug || '').trim().toLowerCase();
  if (!/^[a-z0-9](?:[a-z0-9-]{1,30}[a-z0-9])$/.test(s)) {
    return { ok: false, message: 'Адрес: 3–32 символа, латиница, цифры и дефис, без дефиса по краям.' };
  }
  if (RESERVED.has(s)) return { ok: false, message: 'Этот адрес зарезервирован. Выберите другой.' };
  return { ok: true, slug: s };
}

function normalizeClientPhone(value) {
  const raw = String(value || '').trim();
  let d = raw.replace(/\D/g, '');
  if (!d) return '';
  const explicitIntl = raw.charAt(0) === '+' && !(d[0] === '7' && d.length <= 11);
  if (!explicitIntl && d[0] === '8') d = '7' + d.slice(1);
  if (!explicitIntl && d[0] !== '7' && d.length === 10) d = '7' + d;
  if (d[0] === '7' && d.length !== 11) return '';
  if (d.length < 8 || d.length > 15) return '';
  return '+' + d;
}

function sanitizeProfile(input) {
  const src = input && typeof input === 'object' ? input : {};
  const str = (v, n) => String(v == null ? '' : v).trim().slice(0, n);
  const name = str(src.name, 60);
  if (name.length < 2) return { ok: false, message: 'Укажите имя мастера, минимум 2 символа.' };
  const services = [];
  const seen = new Set();
  for (const item of (Array.isArray(src.services) ? src.services : []).slice(0, 25)) {
    const serviceName = str(item && item.name, 60);
    if (!serviceName) continue;
    const price = Math.round(Number(String(item.price).replace(/\s/g, '').replace(',', '.')));
    if (!Number.isFinite(price) || price < 0 || price > 10000000) {
      return { ok: false, message: 'Укажите цену каждой услуги числом.' };
    }
    const key = serviceName.toLowerCase();
    if (seen.has(key)) return { ok: false, message: 'Названия услуг не должны повторяться.' };
    seen.add(key);
    services.push({ name: serviceName, price, dur: str(item.dur, 20) });
  }
  if (!services.length) return { ok: false, message: 'Добавьте хотя бы одну услугу.' };
  const slots = parseSlots(src.slots);
  if (!slots) return { ok: false, message: 'Часы приёма укажите в формате ЧЧ:ММ через запятую.' };
  const workDays = parseWorkDays(src.workDays);
  if (!workDays) return { ok: false, message: 'Выберите хотя бы один день приёма.' };
  const horizon = parseHorizon(src.horizon);
  if (!horizon) return { ok: false, message: 'Горизонт записи: число от 1 до 60.' };
  const tz = validTz(str(src.tz, 64));
  if (!tz) return { ok: false, message: 'Неизвестный часовой пояс.' };
  const photo = httpsUrl(src.photo, 500);
  if (photo == null) return { ok: false, message: 'Ссылка на главное фото должна начинаться с https://' };
  const gallery = [];
  const gallerySrc = Array.isArray(src.gallery)
    ? src.gallery
    : String(src.gallery || '').split(/[\s,]+/).filter(Boolean);
  for (const item of gallerySrc.slice(0, 12)) {
    const url = httpsUrl(item, 500);
    if (url == null) return { ok: false, message: 'Каждая ссылка в портфолио должна начинаться с https://' };
    if (url) gallery.push(url);
  }
  const phone = str(src.phone, 24);
  if (phone && !cleanPhone(phone)) return { ok: false, message: 'Телефон мастера: укажите номер с кодом страны.' };
  const telegramRaw = str(src.telegram, 80);
  const telegram = telegramRaw ? cleanTelegram(telegramRaw) : '';
  if (telegram == null) return { ok: false, message: 'Telegram: укажите @username или ссылку https://t.me/username' };
  const whatsappRaw = str(src.whatsapp, 24);
  const whatsapp = whatsappRaw ? cleanPhone(whatsappRaw) : '';
  if (whatsappRaw && !whatsapp) return { ok: false, message: 'WhatsApp: укажите номер с кодом страны.' };
  const innRaw = str(src.inn, 16);
  const inn = innRaw ? cleanInn(innRaw) : '';
  if (inn == null) return { ok: false, message: 'ИНН: 10 или 12 цифр, либо оставьте поле пустым.' };
  const status = src.legalStatus === 'ip' || src.legalStatus === 'self' ? src.legalStatus : '';
  const category = CATEGORIES.includes(src.category) ? src.category : 'other';
  const theme = THEMES.includes(src.theme) ? src.theme : 'plum';
  return {
    ok: true,
    profile: {
      name,
      desc: str(src.desc, 120),
      photo,
      addr: str(src.addr, 100),
      hint: str(src.hint, 120),
      services,
      slots,
      gallery,
      tz,
      workDays,
      horizon,
      category,
      theme,
      legalName: str(src.legalName, 120),
      legalStatus: status,
      inn: inn || '',
      revokeContact: str(src.revokeContact, 120),
      phone: phone ? cleanPhone(phone) : '',
      telegram: telegram || '',
      whatsapp: whatsapp ? whatsapp.replace(/\D/g, '') : ''
    }
  };
}

function starterProfile(firstName) {
  const name = String(firstName || 'Мастер').trim().slice(0, 60) || 'Мастер';
  return {
    name,
    desc: '',
    photo: '',
    addr: '',
    hint: '',
    services: [],
    slots: DEFAULT_SLOTS.slice(),
    gallery: [],
    tz: DEFAULT_TZ,
    workDays: DEFAULT_WORK_DAYS.slice(),
    horizon: 14,
    category: 'other',
    theme: 'plum',
    legalName: '',
    legalStatus: '',
    inn: '',
    revokeContact: '',
    phone: '',
    telegram: '',
    whatsapp: ''
  };
}

module.exports = {
  THEMES,
  CATEGORIES,
  DEFAULT_TZ,
  DEFAULT_WORK_DAYS,
  DEFAULT_SLOTS,
  validateSlug,
  sanitizeProfile,
  starterProfile,
  normalizeClientPhone,
  parseSlots
};
