// Токен Telegram-бота нельзя хранить в коде страницы: его видит любой, кто откроет исходник.
// После переезда на хостинг (Object Storage + Cloud Functions) заявка должна уходить на SEND_ENDPOINT,
// а BOT_TOKEN — только в секрете функции. Пока оба значения пустые, форма не вызывает API и предлагает
// написать мастеру напрямую. Если SEND_ENDPOINT будет на другом домене, его нужно добавить в connect-src
// у мета-тега Content-Security-Policy.
const BOT_TOKEN = '';
const SEND_ENDPOINT = '';

// Клиентский ключ панели. На сервере его заменит нормальная авторизация; в клиентской ссылке ключа нет.
const ADMIN_KEY = 'beauty2026';
const STORE_KEY = 'masterConfig:v2';
const DEFAULT_TZ = 'Europe/Moscow';
const DEFAULT_WORK_DAYS = [1, 2, 3, 4, 5, 6];
const DEFAULT_HORIZON = 14;
const THEMES = ['plum', 'rose', 'wine', 'olive', 'sand', 'ink'];
const CATEGORIES = ['manicure', 'massage', 'brows', 'other'];
const CATEGORY_EMOJI = { manicure: '💅', massage: '💆', brows: '✨', other: '📌' };
const WEEK = [
  { d: 1, t: 'Пн' }, { d: 2, t: 'Вт' }, { d: 3, t: 'Ср' }, { d: 4, t: 'Чт' },
  { d: 5, t: 'Пт' }, { d: 6, t: 'Сб' }, { d: 0, t: 'Вс' }
];

const $ = (s) => document.querySelector(s);
const cap = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : '');
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
}[c]));
const fmtPrice = (n) => Number(n).toLocaleString('ru-RU') + '\u00a0₽';

const DEFAULT_GALLERY = [
  'https://images.unsplash.com/photo-1604654894610-df63bc536371?auto=format&fit=crop&w=800&q=80',
  'https://images.unsplash.com/photo-1522337360788-8b13dee7a37e?auto=format&fit=crop&w=800&q=80',
  'https://images.unsplash.com/photo-1632345031435-8727f6897d53?auto=format&fit=crop&w=800&q=80',
  'https://images.unsplash.com/photo-1610992015732-2449b76344bc?auto=format&fit=crop&w=800&q=80'
];
const DEFAULT_SERVICES = [
  { name: 'Комбинированный маникюр', price: 1500, dur: '1,5 ч' },
  { name: 'Маникюр + выравнивание + гель-лак', price: 2200, dur: '2 ч' },
  { name: 'Наращивание / Архитектура ногтей', price: 3500, dur: '2,5 ч' },
  { name: 'SMART-педикюр (полный)', price: 2800, dur: '1,5 ч' }
];
const DEFAULTS = {
  name: 'Анна | Маникюр',
  desc: 'Аккуратно, стерильно, без спешки',
  photo: '',
  addr: 'ул. Малая Бронная, 12, студия 204',
  hint: 'Вход со двора, 2 этаж, домофон 204',
  chatId: '123456789',
  services: DEFAULT_SERVICES,
  slots: ['10:00', '12:30', '15:00', '18:00'],
  gallery: DEFAULT_GALLERY.slice(),
  tz: DEFAULT_TZ,
  workDays: DEFAULT_WORK_DAYS.slice(),
  horizon: DEFAULT_HORIZON,
  category: 'manicure',
  theme: 'plum',
  legalName: '',
  legalStatus: '',
  inn: '',
  revokeContact: '',
  phone: '',
  telegram: '',
  whatsapp: ''
};

const photoEl = $('#master-photo');
const DEFAULT_AVATAR = photoEl.src;
const modal = $('#modal');
const sheet = $('#sheet');
const formView = $('#form-view');
const doneView = $('#done-view');
const legal = $('#legal');
const legalSheet = $('#legal-sheet');
const panel = $('#panel');
const panelSheet = $('#panel-sheet');
const lb = $('#lb');
const lbTrack = $('#lb-track');
const datesEl = $('#dates');
const slotsEl = $('#slots');
const nameEl = $('#name');
const phoneEl = $('#phone');
const confirmBtn = $('#confirm');
const consentEl = $('#consent');

let config = null;
let tgApp = null;
let DAYS = [];
let state = { service: null, iso: null, slot: null };
let lastTrigger = null;
let legalReturn = null;
let lbReturn = null;
let lbIndex = 0;
let sending = false;
let lastObjectUrl = '';
let draft = [];

function validTz(tz) {
  const candidate = String(tz || '').trim() || DEFAULT_TZ;
  try {
    Intl.DateTimeFormat('ru-RU', { timeZone: candidate }).format(new Date());
    return candidate;
  } catch (e) {
    return DEFAULT_TZ;
  }
}

function parseHorizon(v) {
  if (v == null || v === '') return null;
  const n = Math.round(Number(v));
  if (!Number.isFinite(n) || n < 1 || n > 60) return null;
  return n;
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

function parseSlots(text) {
  const out = [];
  for (const raw of String(text == null ? '' : text).split(/[,;\s]+/)) {
    if (!raw) continue;
    const m = /^([01]?\d|2[0-3]):([0-5]\d)$/.exec(raw);
    if (!m) return null;
    const t = m[1].padStart(2, '0') + ':' + m[2];
    if (!out.includes(t)) out.push(t);
  }
  return out.length && out.length <= 16 ? out.sort() : null;
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
  return '';
}

function cleanPhone(v) {
  const s = String(v || '').trim();
  if (!s) return '';
  let d = s.replace(/\D/g, '');
  if (d.length === 11 && d[0] === '8') d = '7' + d.slice(1);
  if (d.length < 8 || d.length > 15) return '';
  return '+' + d;
}

function cleanWhatsapp(v) {
  const phone = cleanPhone(v);
  return phone ? phone.replace(/\D/g, '') : '';
}

function cleanInn(v) {
  const raw = String(v || '').trim();
  if (!raw) return '';
  const d = raw.replace(/\D/g, '');
  return d.length === 10 || d.length === 12 ? d : '';
}

function clean(r) {
  try {
    if (!r || typeof r !== 'object') return null;
    const str = (v, n) => String(v == null ? '' : v).trim().slice(0, n);
    const services = [];
    for (const s of (Array.isArray(r.services) ? r.services : []).slice(0, 25)) {
      const price = Math.round(Number(String(s.price).replace(/\s/g, '').replace(',', '.')));
      const name = str(s.name, 60);
      if (name && price >= 0 && price <= 10000000) {
        services.push({ name, price, dur: str(s.dur, 20) });
      }
    }
    const slots = parseSlots(Array.isArray(r.slots) ? r.slots.join(',') : r.slots);
    const chatId = str(r.chatId, 20);
    if (!str(r.name, 60) || !/^-?\d{5,18}$/.test(chatId) || !services.length || !slots) return null;
    const photo = str(r.photo, 500);
    const category = CATEGORIES.includes(r.category) ? r.category : 'other';
    const theme = THEMES.includes(r.theme) ? r.theme : 'plum';
    const status = r.legalStatus === 'ip' || r.legalStatus === 'self' ? r.legalStatus : '';
    return {
      name: str(r.name, 60),
      desc: str(r.desc, 120),
      photo: /^https:\/\//i.test(photo) ? photo : '',
      addr: str(r.addr, 100),
      hint: str(r.hint, 120),
      chatId,
      services,
      slots,
      gallery: (Array.isArray(r.gallery) ? r.gallery : []).map((u) => str(u, 500)).filter((u) => /^https:\/\//i.test(u)).slice(0, 10),
      tz: validTz(str(r.tz, 64)),
      workDays: parseWorkDays(r.workDays) || DEFAULT_WORK_DAYS.slice(),
      horizon: parseHorizon(r.horizon) || DEFAULT_HORIZON,
      category,
      theme,
      legalName: str(r.legalName, 120),
      legalStatus: status,
      inn: cleanInn(r.inn),
      revokeContact: str(r.revokeContact, 120),
      phone: cleanPhone(r.phone),
      telegram: cleanTelegram(r.telegram),
      whatsapp: cleanWhatsapp(r.whatsapp)
    };
  } catch (e) {
    return null;
  }
}

function pack(c) {
  const o = {
    n: c.name, d: c.desc, c: c.chatId,
    s: c.services.map((s) => [s.name, s.price, s.dur]),
    t: c.slots, tz: c.tz, wd: c.workDays, hz: c.horizon, cat: c.category, th: c.theme
  };
  if (c.photo) o.p = c.photo;
  if (c.addr) o.a = c.addr;
  if (c.hint) o.h = c.hint;
  if (c.gallery && c.gallery.length) o.g = c.gallery;
  if (c.legalName) o.ln = c.legalName;
  if (c.legalStatus) o.ls = c.legalStatus;
  if (c.inn) o.inn = c.inn;
  if (c.revokeContact) o.rc = c.revokeContact;
  if (c.phone) o.ph = c.phone;
  if (c.telegram) o.tg = c.telegram;
  if (c.whatsapp) o.wa = c.whatsapp;
  return o;
}

function toB64(obj) {
  let b = '';
  new TextEncoder().encode(JSON.stringify(obj)).forEach((x) => { b += String.fromCharCode(x); });
  return btoa(b).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromB64(s) {
  let t = String(s || '').replace(/-/g, '+').replace(/_/g, '/');
  while (t.length % 4) t += '=';
  return JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(t), (c) => c.charCodeAt(0))));
}

function linkFor(c) {
  return location.href.split('#')[0].split('?')[0] + '?config=' + toB64(pack(c));
}

function unpackConfig(raw) {
  try {
    const o = fromB64(raw);
    return clean({
      name: o.n, desc: o.d, photo: o.p, addr: o.a || '', hint: o.h || '',
      chatId: o.c, slots: o.t, gallery: o.g,
      services: (o.s || []).map((x) => ({ name: x[0], price: x[1], dur: x[2] })),
      tz: o.tz, workDays: o.wd, horizon: o.hz, category: o.cat, theme: o.th,
      legalName: o.ln, legalStatus: o.ls, inn: o.inn, revokeContact: o.rc,
      phone: o.ph, telegram: o.tg, whatsapp: o.wa
    });
  } catch (e) {
    return null;
  }
}

function readStored() {
  try { return clean(JSON.parse(localStorage.getItem(STORE_KEY))); }
  catch (e) { return null; }
}

function showView(name) {
  $('#lock-view').classList.toggle('is-hidden', name !== 'lock');
  $('#broken-view').classList.toggle('is-hidden', name !== 'broken');
  $('#app-view').classList.toggle('is-hidden', name !== 'app');
}

function applyTheme(id) {
  const theme = THEMES.includes(id) ? id : 'plum';
  THEMES.forEach((name) => document.documentElement.classList.remove('theme-' + name));
  document.documentElement.classList.add('theme-' + theme);
  return theme;
}

function thumbUrl(url) {
  try {
    const u = new URL(url);
    const host = u.hostname;
    if (u.searchParams.has('w') || host === 'images.unsplash.com' || host === 'unsplash.com' || host.endsWith('.unsplash.com')) {
      u.searchParams.set('w', '400');
      if (!u.searchParams.has('q')) u.searchParams.set('q', '70');
      return u.toString();
    }
  } catch (e) { /* оставляем исходный адрес */ }
  return url;
}

let heroFallback = false;
function onHeroError() {
  if (heroFallback || photoEl.src === DEFAULT_AVATAR) return;
  heroFallback = true;
  photoEl.src = DEFAULT_AVATAR;
}
photoEl.addEventListener('error', onHeroError);

function setHero(url) {
  photoEl.alt = (config && config.name) || 'Фото мастера';
  heroFallback = false;
  const next = url || DEFAULT_AVATAR;
  if (photoEl.src !== next) photoEl.src = next;
}

function renderServices() {
  $('#services').innerHTML = config.services.map((s, i) => `
    <article class="flex items-center justify-between gap-4 py-4">
      <div class="min-w-0">
        <h3 class="text-[17px] font-semibold leading-snug">${esc(s.name)}</h3>
        ${s.dur ? `<p class="mt-0.5 text-sm text-neutral-600">⏱ ${esc(s.dur)}</p>` : ''}
      </div>
      <div class="flex shrink-0 flex-col items-end gap-2">
        <p class="whitespace-nowrap text-[17px] font-semibold">${fmtPrice(s.price)}</p>
        <button type="button" data-service="${i}" class="rounded-full bg-tg px-4 py-2 text-sm font-semibold text-white shadow-sm">Записаться</button>
      </div>
    </article>`).join('');
}

let galleryLock = false;
function renderGallery() {
  const list = $('#gallery-list');
  const has = config.gallery && config.gallery.length;
  $('#gallery').classList.toggle('is-hidden', !has);
  if (!has) {
    list.innerHTML = '';
    return;
  }
  list.innerHTML = config.gallery.map((u, idx) => `
    <button type="button" data-photo="${idx}" aria-label="Фото ${idx + 1} из ${config.gallery.length}, открыть" class="relative h-52 w-40 shrink-0 snap-start overflow-hidden rounded-2xl bg-ios shadow-sm">
      <img src="${esc(thumbUrl(u))}" data-full="${esc(u)}" alt="Работа мастера ${idx + 1}" width="160" height="208" loading="lazy" decoding="async" class="h-full w-full object-cover">
      <span class="absolute bottom-2 right-2 rounded-full bg-black/45 px-2 py-0.5 text-[11px] font-medium text-white">${idx + 1}/${config.gallery.length}</span>
    </button>`).join('');
  list.querySelectorAll('img[data-full]').forEach((img) => {
    img.addEventListener('error', () => removeGalleryUrl(img.getAttribute('data-full')));
  });
}

function removeGalleryUrl(url) {
  if (!config || galleryLock || !config.gallery.includes(url)) return;
  config.gallery = config.gallery.filter((u) => u !== url);
  galleryLock = true;
  try {
    renderGallery();
    if (lb.classList.contains('open')) {
      if (!config.gallery.length) closeLightbox();
      else {
        lbIndex = Math.min(lbIndex, config.gallery.length - 1);
        renderLb();
      }
    }
  } finally {
    galleryLock = false;
  }
}

function renderAddress() {
  const has = Boolean(config.addr && config.addr.trim());
  $('#address-sec').classList.toggle('is-hidden', !has);
  if (!has) return;
  $('#master-address').textContent = config.addr;
  $('#master-route-hint').textContent = config.hint || '';
  $('#master-route-hint').classList.toggle('is-hidden', !config.hint);
  $('#map-link').href = 'https://yandex.ru/maps/?text=' + encodeURIComponent(config.addr);
}

function applyConfig(c) {
  config = c;
  applyTheme(c.theme);
  document.title = c.name + ' — онлайн-запись';
  $('#master-name').textContent = c.name;
  $('#master-desc').textContent = c.desc;
  setHero(c.photo);
  renderServices();
  renderGallery();
  renderAddress();
}

function updateLbCounter() {
  const total = config && config.gallery ? config.gallery.length : 0;
  $('#lb-counter').textContent = total ? (lbIndex + 1) + ' / ' + total : '0 / 0';
}

function renderLb() {
  lbTrack.innerHTML = (config.gallery || []).map((u) => `
    <div class="lb-slide flex h-full w-full shrink-0 snap-center items-center justify-center px-4">
      <img src="${esc(u)}" data-full="${esc(u)}" alt="" class="max-h-[75dvh] max-w-full rounded-2xl object-contain shadow-2xl">
    </div>`).join('');
  lbTrack.querySelectorAll('img[data-full]').forEach((img) => {
    img.addEventListener('error', () => removeGalleryUrl(img.getAttribute('data-full')));
  });
  updateLbCounter();
  requestAnimationFrame(() => { lbTrack.scrollLeft = lbIndex * lbTrack.clientWidth; });
}

function openLightbox(index, trigger) {
  if (!config || !config.gallery || !config.gallery.length) return;
  lbReturn = trigger || document.activeElement;
  lbIndex = Math.max(0, Math.min(index, config.gallery.length - 1));
  renderLb();
  setSheet(lb, true);
  requestAnimationFrame(() => $('#lb-close').focus({ preventScroll: true }));
}

function closeLightbox() {
  setSheet(lb, false);
  if (lbReturn && lbReturn.focus) lbReturn.focus({ preventScroll: true });
}

function moveLb(delta) {
  const total = config && config.gallery ? config.gallery.length : 0;
  if (!total) return;
  lbIndex = (lbIndex + delta + total) % total;
  const width = lbTrack.clientWidth;
  if (width) lbTrack.scrollTo({ left: lbIndex * width, behavior: 'smooth' });
  updateLbCounter();
}

function goToServices() {
  closeLightbox();
  const title = $('#services-title');
  title.scrollIntoView({ behavior: 'smooth', block: 'start' });
  title.focus({ preventScroll: true });
}

function anyDialogOpen() {
  return [modal, legal, panel, lb].some((el) => el.classList.contains('open'));
}

function setSheet(el, on) {
  el.classList.toggle('open', on);
  el.setAttribute('aria-hidden', on ? 'false' : 'true');
  el.inert = !on;
  document.body.classList.toggle('scroll-lock', anyDialogOpen());
  const app = $('#app-view');
  if (app) app.setAttribute('aria-hidden', anyDialogOpen() ? 'true' : 'false');
}

function topDialog() {
  if (lb.classList.contains('open')) return lb;
  if (legal.classList.contains('open')) return legalSheet;
  if (panel.classList.contains('open')) return panelSheet;
  if (modal.classList.contains('open')) return sheet;
  return null;
}

function focusables(root) {
  return [...root.querySelectorAll('a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled])')]
    .filter((el) => !el.closest('.is-hidden'));
}

function formatDay(iso, options) {
  const inst = BookingCalendar.zonedTimeToUtc(iso, '12:00', config.tz);
  return new Intl.DateTimeFormat('ru-RU', Object.assign({ timeZone: config.tz }, options)).format(inst);
}

function fullDate(iso) {
  return cap(formatDay(iso, { weekday: 'long', day: 'numeric', month: 'long' }));
}

function monthRangeLabel(days) {
  if (!days.length) return '';
  const a = formatDay(days[0].iso, { month: 'long' });
  const b = formatDay(days[days.length - 1].iso, { month: 'long' });
  const ya = days[0].iso.slice(0, 4);
  const yb = days[days.length - 1].iso.slice(0, 4);
  if (days[0].iso.slice(0, 7) === days[days.length - 1].iso.slice(0, 7)) return cap(a);
  if (ya === yb) return cap(a) + ' — ' + b;
  return cap(a) + ' ' + ya + ' — ' + b + ' ' + yb;
}

function buildDays() {
  const today = BookingCalendar.todayISO(config.tz);
  const days = [];
  for (let i = 0; i < config.horizon; i += 1) {
    const iso = BookingCalendar.addDaysISO(today, i);
    const wd = BookingCalendar.weekdayOfISO(iso);
    days.push({ iso, wd, work: config.workDays.includes(wd) });
  }
  return days;
}

function slotStatus(iso, time) {
  const day = DAYS.find((d) => d.iso === iso);
  if (!day || !day.work) return 'off';
  const when = BookingCalendar.zonedTimeToUtc(iso, time, config.tz);
  if (when.getTime() <= Date.now()) return 'past';
  return 'free';
}

function dayAvailable(day) {
  return day.work && config.slots.some((time) => slotStatus(day.iso, time) === 'free');
}

function renderDates() {
  const x = datesEl.scrollLeft;
  datesEl.innerHTML = '';
  DAYS.forEach((day) => {
    const free = dayAvailable(day);
    const sel = state.iso === day.iso;
    const b = document.createElement('button');
    b.type = 'button';
    b.dataset.iso = day.iso;
    b.disabled = !free;
    b.setAttribute('aria-pressed', sel ? 'true' : 'false');
    const reason = !day.work ? ', выходной' : (!free ? ', нет доступного времени' : '');
    b.setAttribute('aria-label', fullDate(day.iso) + reason);
    const base = 'flex h-[68px] w-14 shrink-0 flex-col items-center justify-center rounded-2xl text-center ';
    b.className = base + (sel ? 'bg-tg text-white' : 'bg-ios text-neutral-900') + (free ? '' : ' day-off');
    const sub = sel ? 'text-white' : 'text-neutral-600';
    b.innerHTML = `<span class="text-xs ${sub}">${esc(cap(formatDay(day.iso, { weekday: 'short' })).replace('.', ''))}</span>`
      + `<span class="mt-0.5 text-lg font-semibold">${Number(day.iso.slice(8, 10))}</span>`;
    b.addEventListener('click', () => {
      state.iso = day.iso;
      state.slot = null;
      renderDates();
      renderSlots();
    });
    datesEl.appendChild(b);
  });
  datesEl.scrollLeft = x;
  $('#month').textContent = monthRangeLabel(DAYS);
}

function renderSlots() {
  slotsEl.innerHTML = '';
  config.slots.forEach((t) => {
    const status = slotStatus(state.iso, t);
    const free = status === 'free';
    const sel = state.slot === t;
    const b = document.createElement('button');
    b.type = 'button';
    b.dataset.time = t;
    b.textContent = t;
    b.disabled = !free;
    b.setAttribute('aria-pressed', sel ? 'true' : 'false');
    if (status === 'past') b.setAttribute('aria-label', t + ', это время уже прошло');
    else if (status === 'off') b.setAttribute('aria-label', t + ', в этот день нет приёма');
    else b.setAttribute('aria-label', t);
    const base = 'rounded-xl py-3 text-[15px] font-medium ';
    b.className = base + (sel ? 'bg-tg text-white' : free ? 'bg-ios text-neutral-900' : 'bg-ios slot-off');
    b.addEventListener('click', () => {
      state.slot = t;
      $('#slot-err').classList.add('is-hidden');
      renderSlots();
      prepareCalendarLinks();
    });
    slotsEl.appendChild(b);
  });
}

function eventRange() {
  if (!config || !state.service || !state.iso || !state.slot) return null;
  const start = BookingCalendar.zonedTimeToUtc(state.iso, state.slot, config.tz);
  const mins = BookingCalendar.parseDurationMin(state.service.dur);
  return {
    start,
    end: new Date(start.getTime() + mins * 60000),
    timeZone: config.tz,
    summary: state.service.name + ' — ' + config.name,
    description: 'Заявка на «' + state.service.name + '». Стоимость: ' + fmtPrice(state.service.price) + '. Мастер подтвердит время.',
    location: config.addr || '',
    alarmText: 'Напоминание о записи'
  };
}

function prepareCalendarLinks() {
  const range = eventRange();
  if (!range) return;
  $('#gcal-link').href = BookingCalendar.googleCalendarUrl(range);
}

function downloadIcs(content) {
  if (lastObjectUrl) URL.revokeObjectURL(lastObjectUrl);
  const blob = new Blob([content], { type: 'text/calendar;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  lastObjectUrl = url;
  const a = document.createElement('a');
  a.href = url;
  a.download = 'zapis.ics';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => {
    if (lastObjectUrl === url) {
      URL.revokeObjectURL(url);
      lastObjectUrl = '';
    }
  }, 1500);
}

function formatPhone(raw) {
  const trimmed = String(raw || '');
  const plus = trimmed.trim().charAt(0) === '+';
  let d = trimmed.replace(/\D/g, '');
  if (!d) return plus ? '+' : '';
  const explicitIntl = plus && !(d[0] === '7' && d.length <= 11);
  if (explicitIntl) return '+' + d.slice(0, 15);
  if (d[0] === '8') d = '7' + d.slice(1);
  if (d[0] !== '7') d = '7' + d;
  d = d.slice(0, 11);
  const n = d.slice(1);
  let out = '+7';
  if (n.length) out += ' (' + n.slice(0, 3);
  if (n.length >= 3) out += ')';
  if (n.length > 3) out += ' ' + n.slice(3, 6);
  if (n.length > 6) out += '-' + n.slice(6, 8);
  if (n.length > 8) out += '-' + n.slice(8, 10);
  return out;
}

function phoneOk(value) {
  const d = String(value || '').replace(/\D/g, '');
  if (d.length < 8 || d.length > 15) return false;
  if (d[0] === '7') return d.length === 11;
  return true;
}

function syncConsent() {
  confirmBtn.disabled = sending || !consentEl.checked;
  if (consentEl.checked) $('#consent-err').classList.add('is-hidden');
}

function openModal(service, trigger) {
  lastTrigger = trigger || null;
  DAYS = buildDays();
  const first = DAYS.find(dayAvailable) || DAYS[0];
  state = { service, iso: first ? first.iso : null, slot: null };
  $('#sheet-service').textContent = [service.name, fmtPrice(service.price), service.dur].filter(Boolean).join(' • ');
  formView.classList.remove('is-hidden');
  doneView.classList.add('is-hidden');
  ['name-err', 'phone-err', 'slot-err', 'consent-err', 'send-fallback'].forEach((id) => $('#' + id).classList.add('is-hidden'));
  nameEl.classList.remove('ring-red-400');
  phoneEl.classList.remove('ring-red-400');
  nameEl.setAttribute('aria-invalid', 'false');
  phoneEl.setAttribute('aria-invalid', 'false');
  consentEl.checked = false;
  syncConsent();
  renderDates();
  renderSlots();
  setSheet(modal, true);
  sheet.focus({ preventScroll: true });
}

function closeModal() {
  setSheet(modal, false);
  if (lastTrigger && lastTrigger.focus) lastTrigger.focus({ preventScroll: true });
}

function contactLinks(c) {
  const out = [];
  if (c.telegram) {
    const href = c.telegram.startsWith('http') ? c.telegram : 'https://t.me/' + c.telegram.replace(/^@/, '');
    out.push({ href, label: 'Написать в Telegram', blank: true });
  }
  if (c.whatsapp) out.push({ href: 'https://wa.me/' + c.whatsapp.replace(/\D/g, ''), label: 'Написать в WhatsApp', blank: true });
  if (c.phone) out.push({ href: 'tel:' + c.phone.replace(/[^\d+]/g, ''), label: 'Позвонить мастеру', blank: false });
  return out;
}

function showFallback(kind) {
  const box = $('#send-fallback');
  box.replaceChildren();
  const when = state.service && state.iso && state.slot
    ? ' В заявке: ' + state.service.name + ', ' + fullDate(state.iso) + ', ' + state.slot + '.'
    : '';
  const links = contactLinks(config);
  const base = kind === 'unconfigured'
    ? 'Заявка с этой страницы сейчас не отправляется: уведомления мастеру ещё не подключены. Напишите мастеру напрямую — время он подтвердит сам.'
    : 'Не удалось отправить заявку. Проверьте интернет или напишите мастеру напрямую.';
  const extra = links.length ? '' : ' Контакты мастера в ссылке не указаны — попросите телефон или мессенджер.';
  const p = document.createElement('p');
  p.className = 'text-center text-sm leading-relaxed text-neutral-700';
  p.textContent = base + when + extra;
  box.appendChild(p);
  links.forEach((link) => {
    const a = document.createElement('a');
    a.className = 'mt-2 block w-full rounded-2xl bg-ios py-3 text-center text-sm font-semibold text-tg';
    a.href = link.href;
    a.textContent = link.label;
    if (link.blank) {
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
    }
    box.appendChild(a);
  });
  box.classList.remove('is-hidden');
  box.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
}

function operatorPhrase(c) {
  const who = c.legalName
    ? c.legalName
    : 'мастер, указанный на этой странице («' + c.name + '»)';
  const parts = [who];
  if (c.legalStatus === 'ip') parts.push('статус: ИП');
  if (c.legalStatus === 'self') parts.push('статус: самозанятый');
  if (c.inn) parts.push('ИНН ' + c.inn);
  return parts.join(', ');
}

function revokePhrase(c) {
  if (c.revokeContact) {
    return 'Чтобы отозвать согласие или попросить удалить данные, напишите оператору: ' + c.revokeContact + '.';
  }
  if (c.phone || c.telegram || c.whatsapp) {
    return 'Чтобы отозвать согласие или попросить удалить данные, обратитесь к оператору по контакту, указанному на странице.';
  }
  return 'Чтобы отозвать согласие или попросить удалить данные, запросите у мастера контакт для обращения: в ссылке он не указан.';
}

function addPara(parent, lead, text) {
  const p = document.createElement('p');
  const b = document.createElement('b');
  b.textContent = lead + ' ';
  p.appendChild(b);
  p.appendChild(document.createTextNode(text));
  parent.appendChild(p);
}

function openLegal(kind, opener) {
  if (!config) return;
  legalReturn = opener || null;
  const title = $('#legal-title');
  const body = $('#legal-body');
  body.replaceChildren();
  const op = operatorPhrase(config);
  const data = 'Имя, номер телефона, выбранная услуга, дата и время визита.';
  const purpose = 'Связь мастера с клиентом, чтобы подтвердить заявку, напомнить о визите и оказать выбранную услугу.';
  const actions = 'Сбор, запись, систематизация, хранение, уточнение, использование, передача, удаление.';
  const transfer = 'Заявка доставляется оператору через мессенджер Telegram. Telegram получает текст сообщения и является получателем данных.';
  if (kind === 'consent') {
    title.textContent = 'Согласие на обработку персональных данных';
    addPara(body, 'Оператор.', 'Оператором персональных данных является ' + op + '.');
    addPara(body, 'Цель.', purpose);
    addPara(body, 'Перечень данных.', data);
    addPara(body, 'Действия с данными.', actions);
    addPara(body, 'Передача.', transfer);
    addPara(body, 'Срок хранения.', 'До отзыва согласия.');
    addPara(body, 'Отзыв согласия.', revokePhrase(config));
  } else {
    title.textContent = 'Политика конфиденциальности';
    addPara(body, '1. Общие положения.', 'Политика описывает обработку персональных данных при отправке заявки с этой страницы и составлена с учётом Федерального закона от 27.07.2006 № 152-ФЗ «О персональных данных».');
    addPara(body, '2. Оператор.', 'Оператором персональных данных является ' + op + '. Эта страница — форма заявки.');
    addPara(body, '3. Состав данных.', data);
    addPara(body, '4. Цель обработки.', purpose);
    addPara(body, '5. Доставка заявки.', transfer);
    addPara(body, '6. Права.', revokePhrase(config));
  }
  setSheet(legal, true);
  legalSheet.focus({ preventScroll: true });
}

function closeLegal() {
  setSheet(legal, false);
  if (legalReturn && legalReturn.focus) legalReturn.focus({ preventScroll: true });
}

function buildMessage(payload) {
  const emoji = CATEGORY_EMOJI[config.category] || CATEGORY_EMOJI.other;
  const waText = 'Здравствуйте, ' + payload.name + '! Вы оставили заявку на «' + payload.service.name + '» (' + payload.date + ', ' + payload.time + ').'
    + (config.addr ? ' Адрес: ' + config.addr + '.' : '');
  const digits = String(payload.phone).replace(/\D/g, '');
  const waUrl = 'https://wa.me/' + digits + '?text=' + encodeURIComponent(waText);
  return [
    '🔔 <b>Новая заявка</b>',
    '',
    emoji + ' Услуга: <b>' + esc(payload.service.name) + '</b>',
    'Стоимость: ' + esc(fmtPrice(payload.service.price)),
    'Дата: ' + esc(payload.date),
    'Время: <b>' + esc(payload.time) + '</b>',
    'Клиент: ' + esc(payload.name),
    'Телефон: <code>' + esc(payload.phone) + '</code>',
    'Согласие на обработку ПДн: да',
    '',
    '<a href="' + esc(waUrl) + '">Написать клиенту в WhatsApp</a>'
  ].join('\n');
}

function isDeliveryConfigured() {
  return Boolean(String(SEND_ENDPOINT).trim() || String(BOT_TOKEN).trim());
}

async function deliver(text) {
  const endpoint = String(SEND_ENDPOINT).trim();
  const token = String(BOT_TOKEN).trim();
  if (!endpoint && !token) {
    const err = new Error('unconfigured');
    err.code = 'unconfigured';
    throw err;
  }
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 15000);
  try {
    const url = endpoint || ('https://api.telegram.org/bot' + token + '/sendMessage');
    const body = endpoint
      ? { chatId: String(config.chatId), text, parseMode: 'HTML' }
      : { chat_id: String(config.chatId), text, parse_mode: 'HTML', disable_web_page_preview: true };
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: ctrl.signal
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data.ok === false) throw new Error(data.description || 'send failed');
    return data;
  } finally {
    clearTimeout(timer);
  }
}

function haptic(kind) {
  const tg = tgApp;
  if (!tg || !tg.HapticFeedback) return;
  let ok = false;
  try { ok = typeof tg.isVersionAtLeast === 'function' && tg.isVersionAtLeast('6.1'); }
  catch (e) { ok = false; }
  if (!ok) return;
  try { tg.HapticFeedback.notificationOccurred(kind); } catch (e) { /* версия без тактильного отклика */ }
}

function showSuccess(name, dateText, time) {
  const s = state.service;
  $('#done-text').textContent = name + ', мастер подтвердит время ' + time;
  $('#sum-service').textContent = s.name;
  $('#sum-date').textContent = dateText;
  $('#sum-time').textContent = time;
  $('#sum-price').textContent = fmtPrice(s.price);
  if (config.addr) {
    $('#sum-addr').textContent = config.addr;
    $('#sum-addr-row').classList.remove('is-hidden');
  } else {
    $('#sum-addr-row').classList.add('is-hidden');
  }
  prepareCalendarLinks();
  formView.classList.add('is-hidden');
  doneView.classList.remove('is-hidden');
  doneView.scrollTop = 0;
  nameEl.value = '';
  phoneEl.value = '';
  consentEl.checked = false;
  haptic('success');
}

function insideTelegram() {
  const ua = navigator.userAgent || '';
  if (/Telegram/i.test(ua)) return true;
  if (window.TelegramWebviewProxy || window.TelegramWebviewProxyProto) return true;
  const hash = location.hash || '';
  if (/tgWebApp/i.test(hash)) return true;
  const sp = new URLSearchParams(location.search);
  return sp.has('tgWebAppVersion') || sp.has('tgWebAppData');
}

function loadTelegram() {
  return new Promise((resolve) => {
    if (!insideTelegram()) { resolve(null); return; }
    const finish = () => {
      const tg = window.Telegram && window.Telegram.WebApp;
      if (!tg) { resolve(null); return; }
      try { tg.ready(); } catch (e) { /* веб-приложение без ready */ }
      try { tg.expand(); } catch (e) { /* веб-приложение без expand */ }
      resolve(tg);
    };
    if (window.Telegram && window.Telegram.WebApp) { finish(); return; }
    const s = document.createElement('script');
    s.src = 'https://telegram.org/js/telegram-web-app.js';
    s.async = true;
    s.onload = finish;
    s.onerror = () => resolve(null);
    document.head.appendChild(s);
  });
}

function paintDay(btn, on) {
  btn.setAttribute('aria-pressed', on ? 'true' : 'false');
  btn.className = on
    ? 'rounded-full bg-tg px-3 py-1.5 text-sm font-semibold text-white'
    : 'rounded-full bg-white px-3 py-1.5 text-sm font-semibold text-neutral-700 ring-1 ring-ios';
}

function readWorkDays() {
  const out = [];
  document.querySelectorAll('#p-days [data-day]').forEach((btn) => {
    if (btn.getAttribute('aria-pressed') === 'true') out.push(Number(btn.getAttribute('data-day')));
  });
  return out;
}

function initDayToggles() {
  const box = $('#p-days');
  box.innerHTML = '';
  WEEK.forEach((item) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.dataset.day = String(item.d);
    b.textContent = item.t;
    paintDay(b, DEFAULT_WORK_DAYS.includes(item.d));
    b.addEventListener('click', () => paintDay(b, b.getAttribute('aria-pressed') !== 'true'));
    box.appendChild(b);
  });
}

const INP = 'min-w-0 rounded-xl bg-white px-3.5 py-2.5 text-sm outline-none ring-2 ring-transparent focus:ring-tg/40';

function renderRows() {
  const svcList = $('#svc-list');
  svcList.innerHTML = draft.map((s, i) => `
    <div class="rounded-xl bg-ios p-3" data-row="${i}">
      <input data-k="name" value="${esc(s.name)}" maxlength="60" placeholder="Название услуги" class="${INP} w-full">
      <div class="mt-2 flex gap-2">
        <input data-k="price" value="${esc(s.price)}" inputmode="numeric" placeholder="Цена, ₽" class="${INP} flex-1">
        <input data-k="dur" value="${esc(s.dur)}" maxlength="20" placeholder="Длит. (2 ч)" class="${INP} flex-1">
        <button type="button" data-del="${i}" aria-label="Удалить услугу" class="shrink-0 rounded-xl bg-white px-3.5 text-red-600">✕</button>
      </div>
    </div>`).join('');
}

function readRows() {
  $('#svc-list').querySelectorAll('[data-row]').forEach((r) => {
    draft[+r.dataset.row] = {
      name: r.querySelector('[data-k=name]').value,
      price: r.querySelector('[data-k=price]').value,
      dur: r.querySelector('[data-k=dur]').value
    };
  });
}

function ensureTzOption(tz) {
  const sel = $('#p-tz');
  if ([...sel.options].some((o) => o.value === tz)) return;
  const opt = document.createElement('option');
  opt.value = tz;
  opt.textContent = tz;
  sel.appendChild(opt);
}

function fillPanel(c) {
  $('#p-name').value = c.name;
  $('#p-desc').value = c.desc;
  $('#p-cat').value = CATEGORIES.includes(c.category) ? c.category : 'other';
  $('#p-theme').value = THEMES.includes(c.theme) ? c.theme : 'plum';
  ensureTzOption(c.tz);
  $('#p-tz').value = c.tz;
  $('#p-photo').value = c.photo;
  $('#p-addr').value = c.addr || '';
  $('#p-hint').value = c.hint || '';
  $('#p-phone').value = c.phone || '';
  $('#p-telegram').value = c.telegram || '';
  $('#p-whatsapp').value = c.whatsapp || '';
  $('#p-chat').value = c.chatId;
  $('#p-gallery').value = (c.gallery || []).join('\n');
  $('#p-horizon').value = String(c.horizon || DEFAULT_HORIZON);
  $('#p-slots').value = c.slots.join(', ');
  $('#p-legal-name').value = c.legalName || '';
  $('#p-legal-status').value = c.legalStatus || '';
  $('#p-inn').value = c.inn || '';
  $('#p-revoke').value = c.revokeContact || '';
  document.querySelectorAll('#p-days [data-day]').forEach((btn) => {
    paintDay(btn, (c.workDays || DEFAULT_WORK_DAYS).includes(Number(btn.dataset.day)));
  });
  draft = c.services.map((s) => ({ name: s.name, price: String(s.price), dur: s.dur }));
  renderRows();
}

function showLink(c, scroll) {
  $('#link-block').classList.toggle('is-hidden', !c);
  if (!c) return;
  $('#p-link').value = linkFor(c);
  if (scroll) $('#link-block').scrollIntoView({ block: 'nearest', behavior: 'smooth' });
}

function openPanel() {
  fillPanel(config);
  $('#p-legal').checked = false;
  $('#panel-err').classList.add('is-hidden');
  showLink(config, false);
  setSheet(panel, true);
  panelSheet.focus({ preventScroll: true });
}

function closePanel() {
  setSheet(panel, false);
  const btn = $('#open-settings');
  if (btn) btn.focus({ preventScroll: true });
}

function setupAdmin() {
  const settingsBtn = $('#open-settings');
  settingsBtn.classList.remove('is-hidden');
  settingsBtn.addEventListener('click', openPanel);
  panel.addEventListener('click', (e) => { if (e.target.closest('[data-close]')) closePanel(); });
  $('#p-theme').addEventListener('change', () => applyTheme($('#p-theme').value));
  $('#svc-add').addEventListener('click', () => { readRows(); draft.push({ name: '', price: '', dur: '' }); renderRows(); });
  $('#svc-list').addEventListener('click', (e) => {
    const del = e.target.closest('[data-del]');
    if (!del) return;
    readRows();
    draft.splice(+del.dataset.del, 1);
    renderRows();
  });
  $('#p-save').addEventListener('click', () => {
    readRows();
    const fail = (msg) => {
      const el = $('#panel-err');
      el.textContent = msg;
      el.classList.remove('is-hidden');
      el.scrollIntoView({ block: 'center', behavior: 'smooth' });
    };
    if (!$('#p-legal').checked) return fail('Необходимо подтвердить согласие с условиями использования');
    const photo = $('#p-photo').value.trim();
    if (photo && !/^https:\/\//i.test(photo)) return fail('Ссылка на главное фото должна начинаться с https://');
    const phoneRaw = $('#p-phone').value.trim();
    if (phoneRaw && !cleanPhone(phoneRaw)) return fail('Телефон мастера: укажите номер с кодом страны, от 8 до 15 цифр');
    const tgRaw = $('#p-telegram').value.trim();
    if (tgRaw && !cleanTelegram(tgRaw)) return fail('Telegram: укажите @username или ссылку https://t.me/username');
    const waRaw = $('#p-whatsapp').value.trim();
    if (waRaw && !cleanWhatsapp(waRaw)) return fail('WhatsApp: укажите номер с кодом страны');
    const innRaw = $('#p-inn').value.trim();
    if (innRaw && !cleanInn(innRaw)) return fail('ИНН: 10 или 12 цифр, либо оставьте поле пустым');
    const services = draft.filter((s) => s.name.trim()).map((s) => ({
      name: s.name,
      price: String(s.price).replace(/\s/g, '').replace(',', '.'),
      dur: s.dur
    }));
    if (services.some((s) => s.price === '' || Number.isNaN(Number(s.price)))) return fail('Укажите цену каждой услуги числом');
    const gal = $('#p-gallery').value.split(/[\s,]+/).filter(Boolean);
    if (gal.some((u) => !/^https:\/\//i.test(u))) return fail('Каждая ссылка в портфолио должна начинаться с https://');
    const slots = parseSlots($('#p-slots').value);
    if (!slots) return fail('Часы приёма укажите в формате ЧЧ:ММ через запятую, например: 10:00, 12:30');
    const workDays = readWorkDays();
    if (!workDays.length) return fail('Выберите хотя бы один день приёма');
    const horizon = parseHorizon($('#p-horizon').value);
    if (!horizon) return fail('Горизонт записи: число от 1 до 60');
    const c = clean({
      name: $('#p-name').value,
      desc: $('#p-desc').value,
      photo,
      addr: $('#p-addr').value,
      hint: $('#p-hint').value,
      gallery: gal,
      chatId: $('#p-chat').value,
      services,
      slots,
      tz: $('#p-tz').value,
      workDays,
      horizon,
      category: $('#p-cat').value,
      theme: $('#p-theme').value,
      legalName: $('#p-legal-name').value,
      legalStatus: $('#p-legal-status').value,
      inn: innRaw,
      revokeContact: $('#p-revoke').value,
      phone: phoneRaw,
      telegram: tgRaw,
      whatsapp: waRaw
    });
    if (!c) return fail('Проверьте имя, корректность Chat ID (только цифры) и наличие хотя бы одной услуги');
    try { localStorage.setItem(STORE_KEY, JSON.stringify(c)); } catch (e) { /* хранилище может быть недоступно */ }
    $('#panel-err').classList.add('is-hidden');
    applyConfig(c);
    fillPanel(c);
    showLink(c, true);
    haptic('success');
  });
  $('#p-copy').addEventListener('click', async () => {
    const box = $('#p-link');
    const btn = $('#p-copy');
    try { await navigator.clipboard.writeText(box.value); }
    catch (e) {
      box.focus();
      box.select();
      try { document.execCommand('copy'); } catch (err) { /* копирование недоступно */ }
    }
    btn.textContent = 'Ссылка для клиентов скопирована';
    setTimeout(() => { btn.textContent = 'Скопировать клиентскую ссылку'; }, 2000);
  });
}

function route() {
  const params = new URLSearchParams(location.search);
  const clientMode = params.has('config');
  const adminMode = params.get('key') === ADMIN_KEY;
  if (clientMode) {
    config = unpackConfig(params.get('config'));
    if (!config) {
      showView('broken');
      document.title = 'Ссылка повреждена';
      return;
    }
  } else if (adminMode) {
    config = readStored() || clean(DEFAULTS);
  } else {
    showView('lock');
    document.title = 'Онлайн-запись к мастеру';
    return;
  }
  showView('app');
  applyConfig(config);
  if (adminMode) setupAdmin();
  else {
    const btn = $('#open-settings');
    if (btn) btn.remove();
  }
}

$('#gallery-list').addEventListener('click', (e) => {
  const btn = e.target.closest('[data-photo]');
  if (btn) openLightbox(+btn.dataset.photo, btn);
});
$('#services').addEventListener('click', (e) => {
  const btn = e.target.closest('[data-service]');
  if (btn && config) openModal(config.services[+btn.dataset.service], btn);
});
$('#lb-close').addEventListener('click', closeLightbox);
$('#lb-book').addEventListener('click', goToServices);
lb.addEventListener('click', (e) => {
  if (e.target === lbTrack || (e.target.classList && e.target.classList.contains('lb-slide'))) closeLightbox();
});
lbTrack.addEventListener('scroll', () => {
  const total = config && config.gallery ? config.gallery.length : 0;
  const width = lbTrack.clientWidth;
  if (!total || !width) return;
  lbIndex = Math.min(total - 1, Math.max(0, Math.round(lbTrack.scrollLeft / width)));
  updateLbCounter();
}, { passive: true });

modal.addEventListener('click', (e) => { if (e.target.closest('[data-close]')) closeModal(); });
phoneEl.addEventListener('input', () => {
  const next = formatPhone(phoneEl.value);
  if (phoneEl.value !== next) phoneEl.value = next;
  phoneEl.classList.remove('ring-red-400');
  phoneEl.setAttribute('aria-invalid', 'false');
  $('#phone-err').classList.add('is-hidden');
});
nameEl.addEventListener('input', () => {
  nameEl.classList.remove('ring-red-400');
  nameEl.setAttribute('aria-invalid', 'false');
  $('#name-err').classList.add('is-hidden');
});
consentEl.addEventListener('change', syncConsent);
$('#open-consent').addEventListener('click', (e) => { e.preventDefault(); openLegal('consent', e.currentTarget); });
$('#open-policy').addEventListener('click', (e) => { e.preventDefault(); openLegal('policy', e.currentTarget); });
legal.addEventListener('click', (e) => { if (e.target.closest('[data-close-legal]')) closeLegal(); });
$('#cal-btn').addEventListener('click', () => {
  const range = eventRange();
  if (!range) return;
  downloadIcs(BookingCalendar.buildIcs(range));
});
$('#done-btn').addEventListener('click', closeModal);
formView.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && e.target !== confirmBtn && e.target.tagName !== 'TEXTAREA') {
    e.preventDefault();
    confirmBtn.click();
  }
});

confirmBtn.addEventListener('click', async () => {
  if (sending) return;
  $('#send-fallback').classList.add('is-hidden');
  if (!consentEl.checked) {
    $('#consent-err').classList.remove('is-hidden');
    return;
  }
  const name = nameEl.value.trim();
  const nameOk = name.length >= 2;
  const telOk = phoneOk(phoneEl.value);
  const slotOk = Boolean(state.slot);
  let firstBad = null;
  $('#slot-err').classList.toggle('is-hidden', slotOk);
  if (!slotOk) firstBad = slotsEl;
  $('#name-err').classList.toggle('is-hidden', nameOk);
  nameEl.classList.toggle('ring-red-400', !nameOk);
  nameEl.setAttribute('aria-invalid', nameOk ? 'false' : 'true');
  if (!nameOk && !firstBad) firstBad = nameEl;
  $('#phone-err').classList.toggle('is-hidden', telOk);
  phoneEl.classList.toggle('ring-red-400', !telOk);
  phoneEl.setAttribute('aria-invalid', telOk ? 'false' : 'true');
  if (!telOk && !firstBad) firstBad = phoneEl;
  if (firstBad) {
    firstBad.scrollIntoView({ block: 'center', behavior: 'smooth' });
    if (firstBad !== slotsEl) firstBad.focus({ preventScroll: true });
    haptic('error');
    return;
  }

  const dateText = fullDate(state.iso);
  const time = state.slot;
  const phone = phoneEl.value;
  const label = confirmBtn.textContent;
  sending = true;
  confirmBtn.disabled = true;
  confirmBtn.setAttribute('aria-busy', 'true');
  confirmBtn.textContent = 'Отправка...';
  try {
    if (!isDeliveryConfigured()) {
      showFallback('unconfigured');
      return;
    }
    await deliver(buildMessage({ service: state.service, date: dateText, time, name, phone }));
    showSuccess(name, dateText, time);
  } catch (err) {
    showFallback(err && err.code === 'unconfigured' ? 'unconfigured' : 'network');
    haptic('error');
  } finally {
    sending = false;
    confirmBtn.textContent = label;
    confirmBtn.removeAttribute('aria-busy');
    syncConsent();
  }
});

document.addEventListener('keydown', (e) => {
  const dialog = topDialog();
  if (!dialog) return;
  if (e.key === 'Escape') {
    e.preventDefault();
    if (lb.classList.contains('open')) closeLightbox();
    else if (legal.classList.contains('open')) closeLegal();
    else if (panel.classList.contains('open')) closePanel();
    else if (modal.classList.contains('open')) closeModal();
    return;
  }
  if (lb.classList.contains('open') && (e.key === 'ArrowRight' || e.key === 'ArrowLeft')) {
    e.preventDefault();
    moveLb(e.key === 'ArrowRight' ? 1 : -1);
    return;
  }
  if (e.key !== 'Tab') return;
  const nodes = focusables(dialog);
  if (!nodes.length) { e.preventDefault(); return; }
  const first = nodes[0];
  const last = nodes[nodes.length - 1];
  const active = document.activeElement;
  if (e.shiftKey) {
    if (active === first || !dialog.contains(active)) {
      e.preventDefault();
      last.focus();
    }
  } else if (active === last) {
    e.preventDefault();
    first.focus();
  }
});

function syncTelegramCalendarNote() {
  $('#tg-cal-note').classList.toggle('is-hidden', !insideTelegram());
}

initDayToggles();
route();
syncTelegramCalendarNote();
loadTelegram().then((tg) => {
  tgApp = tg;
  const user = tg && tg.initDataUnsafe && tg.initDataUnsafe.user;
  if (user && user.first_name && nameEl && !nameEl.value) nameEl.value = user.first_name;
});

