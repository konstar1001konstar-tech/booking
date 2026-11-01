// Заявка уходит на /api/bookings этого же сайта. Токен бота и chat_id мастера в страницу не входят:
// сервер берёт chat_id из базы по короткой ссылке, а не из браузера.
const SEND_ENDPOINT = '/api/bookings';
const DEFAULT_TZ = 'Europe/Moscow';
const DEFAULT_WORK_DAYS = [1, 2, 3, 4, 5, 6];
const DEFAULT_HORIZON = 14;
const THEMES = ['plum', 'rose', 'wine', 'olive', 'sand', 'ink', 'peach', 'mint', 'ocean'];
const CATEGORIES = ['manicure', 'massage', 'brows', 'other'];
const WEEK = [
  { d: 1, t: 'Пн' }, { d: 2, t: 'Вт' }, { d: 3, t: 'Ср' }, { d: 4, t: 'Чт' },
  { d: 5, t: 'Пт' }, { d: 6, t: 'Сб' }, { d: 0, t: 'Вс' }
];

const $ = (s) => document.querySelector(s);
const GALLERY_MAX = 12;
const cap = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : '');
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
}[c]));
const fmtPrice = (n) => Number(n).toLocaleString('ru-RU') + '\u00a0₽';

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
let legacyMode = false;
let busy = new Set();

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

function cleanVk(v) {
  const s = String(v || '').trim();
  if (!s) return '';
  const at = s.match(/^@?([A-Za-z0-9_.]{2,64})$/);
  if (at && !s.includes('/')) return 'https://vk.com/' + at[1];
  try {
    const u = new URL(s);
    const host = u.hostname.replace(/^(www|m)\./, '');
    const path = u.pathname.replace(/^\/+|\/+$/g, '');
    if (u.protocol === 'https:' && (host === 'vk.com' || host === 'vk.ru') && /^[A-Za-z0-9_.]{2,64}$/.test(path)) return 'https://vk.com/' + path;
  } catch (e) { /* не ссылка */ }
  return '';
}

function cleanMax(v) {
  const s = String(v || '').trim();
  if (!s) return '';
  try {
    const u = new URL(s);
    const path = u.pathname.replace(/\/+$/g, '');
    if (u.protocol === 'https:' && (u.hostname === 'max.ru' || u.hostname === 'web.max.ru') && /^\/[A-Za-z0-9_\-/]{2,120}$/.test(path)) return 'https://max.ru' + path;
  } catch (e) { /* не ссылка */ }
  return '';
}

function cleanInn(v) {
  const raw = String(v || '').trim();
  if (!raw) return '';
  const d = raw.replace(/\D/g, '');
  return d.length === 10 || d.length === 12 ? d : '';
}

function clean(r, opts) {
  const requireChat = !opts || opts.requireChat !== false;
  const allowEmptyServices = Boolean(opts && opts.allowEmptyServices);
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
    let chatId = str(r.chatId, 20);
    if (!str(r.name, 60) || !slots) return null;
    if (!services.length && !allowEmptyServices) return null;
    if (requireChat) {
      if (!/^-?\d{5,18}$/.test(chatId)) return null;
    } else if (!/^-?\d{5,18}$/.test(chatId)) {
      chatId = '';
    }
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
      gallery: (Array.isArray(r.gallery) ? r.gallery : []).map((u) => str(u, 500)).filter((u) => /^https:\/\//i.test(u)).slice(0, GALLERY_MAX),
      tz: validTz(str(r.tz, 64)),
      workDays: parseWorkDays(r.workDays) || DEFAULT_WORK_DAYS.slice(),
      horizon: parseHorizon(r.horizon) || DEFAULT_HORIZON,
      category,
      theme,
      legalName: str(r.legalName, 120),
      legalStatus: status,
      inn: cleanInn(r.inn),
      revokeContact: str(r.revokeContact, 120),
      city: str(r.city, 60),
      pubConsentAt: str(r.pubConsentAt, 40),
      termsAt: str(r.termsAt, 40),
      phone: cleanPhone(r.phone),
      telegram: cleanTelegram(r.telegram),
      vk: cleanVk(r.vk),
      max: cleanMax(r.max),
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
  if (c && c.slug) return location.origin + '/' + c.slug;
  return location.href.split('#')[0].split('?')[0] + '?config=' + toB64(pack(c));
}

function configFromApi(data) {
  const c = clean(Object.assign({}, data.profile || {}, { chatId: '' }), { requireChat: false, allowEmptyServices: true });
  if (!c) return null;
  c.slug = data.slug;
  c.published = Boolean(data.published);
  c.bookingOpen = data.bookingOpen !== false;
  return c;
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

function showView(name) {
  ['lock', 'broken', 'app', 'admin', 'loading', 'preparing'].forEach((view) => {
    const el = document.getElementById(view + '-view');
    if (el) el.classList.toggle('is-hidden', view !== name);
  });
}

function showBroken(title, text) {
  const heading = document.querySelector('#broken-view h1');
  const paragraph = $('#broken-text');
  if (heading && title) heading.textContent = title;
  if (paragraph && text) paragraph.textContent = text;
  document.title = (title || 'Ссылка повреждена') + ' · БьютиЛинк';
  showView('broken');
}

// Тема задаёт всю палитру (src/input.css). Строка состояния Safari и шапка
// Telegram красятся в основной цвет темы.
function themeRgb(name) {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim().split(/\s+/).map(Number);
  if (v.length !== 3 || v.some((n) => !Number.isFinite(n))) return '';
  return '#' + v.map((n) => n.toString(16).padStart(2, '0')).join('');
}

function applyTheme(id, animate) {
  const theme = THEMES.includes(id) ? id : 'plum';
  const root = document.documentElement;
  if (animate && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    root.classList.add('theme-anim');
    clearTimeout(applyTheme.timer);
    applyTheme.timer = setTimeout(() => root.classList.remove('theme-anim'), 400);
  }
  THEMES.forEach((name) => root.classList.remove('theme-' + name));
  root.classList.add('theme-' + theme);
  const primary = themeRgb('--c-tg');
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta && primary) meta.setAttribute('content', primary);
  if (tgApp && primary) {
    try { if (tgApp.setHeaderColor) tgApp.setHeaderColor(primary); } catch (e) { /* старый клиент */ }
    try { if (tgApp.setBackgroundColor) tgApp.setBackgroundColor(themeRgb('--c-milk') || primary); } catch (e) { /* старый клиент */ }
  }
  return theme;
}

function markThemeSwatch(theme) {
  document.querySelectorAll('#p-theme-list [data-theme]').forEach((b) => {
    b.setAttribute('aria-checked', b.dataset.theme === theme ? 'true' : 'false');
    b.tabIndex = b.dataset.theme === theme ? 0 : -1;
  });
}

function pickTheme(id) {
  const theme = THEMES.includes(id) ? id : 'plum';
  $('#p-theme').value = theme;
  markThemeSwatch(theme);
  applyTheme(theme, true);
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
        ${s.dur ? `<p class="mt-0.5 text-sm text-muted">⏱ ${esc(s.dur)}</p>` : ''}
      </div>
      <div class="flex shrink-0 flex-col items-end gap-2">
        <p class="whitespace-nowrap text-[17px] font-semibold">${fmtPrice(s.price)}</p>
        <button type="button" data-service="${i}" class="rounded-full bg-tg active:bg-tg-dark px-4 py-2 text-sm font-semibold text-ontg shadow-sm">Записаться</button>
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
  document.title = c.name + ' — онлайн-запись · БьютиЛинк';
  $('#master-name').textContent = c.name;
  $('#master-desc').textContent = c.desc;
  const draftNote = $('#draft-note');
  if (draftNote) draftNote.classList.toggle('is-hidden', c.published !== false);
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
  if (busy.has(iso + 'T' + time)) return 'busy';
  return 'free';
}

async function refreshBusy() {
  if (!config || !config.slug || legacyMode || !DAYS.length) return;
  const from = DAYS[0].iso;
  const to = DAYS[DAYS.length - 1].iso;
  try {
    const res = await fetch('/api/masters/' + encodeURIComponent(config.slug) + '/slots?from=' + from + '&to=' + to);
    const data = await res.json();
    if (data && data.ok && Array.isArray(data.busy)) busy = new Set(data.busy);
  } catch (e) { /* сервер ещё раз проверит слот при отправке */ }
  if (state.slot && slotStatus(state.iso, state.slot) !== 'free') state.slot = null;
  renderDates();
  renderSlots();
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
    b.className = base + (sel ? 'bg-tg active:bg-tg-dark text-ontg' : 'bg-ios text-ink') + (free ? '' : ' day-off');
    const sub = sel ? 'text-ontg' : 'text-muted';
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
    else if (status === 'busy') b.setAttribute('aria-label', t + ', это время уже занято');
    else if (status === 'off') b.setAttribute('aria-label', t + ', в этот день нет приёма');
    else b.setAttribute('aria-label', t);
    const base = 'rounded-xl py-3 text-[15px] font-medium ';
    b.className = base + (sel ? 'bg-tg active:bg-tg-dark text-ontg' : free ? 'bg-ios text-ink' : 'bg-ios slot-off');
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
  refreshBusy();
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
  if (c.vk) out.push({ href: c.vk, label: 'Написать во ВКонтакте', blank: true });
  if (c.max) out.push({ href: c.max, label: 'Написать в MAX', blank: true });
  if (c.phone) out.push({ href: 'tel:' + c.phone.replace(/[^\d+]/g, ''), label: 'Позвонить мастеру', blank: false });
  return out;
}

function showFallback(kind) {
  const box = $('#send-fallback');
  box.replaceChildren();
  const when = state.service && state.iso && state.slot
    ? ' В заявке: ' + state.service.name + ', ' + fullDate(state.iso) + ', ' + state.slot + '.'
    : '';
  const links = kind === 'slot_taken' || kind === 'rate_limited' || kind === 'validation' ? [] : contactLinks(config);
  let base = 'Не удалось отправить заявку. Проверьте интернет или напишите мастеру напрямую.';
  if (kind === 'slot_taken') base = 'Это время уже занято. Выберите другое.';
  else if (kind === 'rate_limited') base = 'Слишком много заявок с этого телефона или адреса. Попробуйте позже.';
  else if (kind === 'validation') base = 'Проверьте имя, телефон и согласие.';
  else if (kind === 'operator_missing') base = 'Онлайн-запись к этому мастеру пока недоступна: мастер ещё не указал свои данные для согласия на обработку данных. Свяжитесь с мастером напрямую.';
  else if (kind === 'unconfigured') base = 'Это ссылка старого формата: заявка с неё на сервер не отправляется. Напишите мастеру напрямую — время он подтвердит сам.';
  const extra = links.length || kind === 'slot_taken' || kind === 'rate_limited' || kind === 'validation'
    ? ''
    : ' Контакты мастера в ссылке не указаны — попросите телефон или мессенджер.';
  const p = document.createElement('p');
  p.className = 'text-center text-sm leading-relaxed text-muted';
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
  if (c.city) parts.push('г. ' + c.city);
  return parts.join(', ');
}

function revokePhrase(c) {
  if (c.revokeContact) {
    return 'Чтобы отозвать согласие или попросить удалить данные, напишите оператору: ' + c.revokeContact + '.';
  }
  if (c.phone || c.telegram || c.vk || c.max) {
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
  const actions = 'Сбор, запись, систематизация, хранение, уточнение, использование, удаление. Распространение и передача третьим лицам для их собственных целей не осуществляются.';
  const o = siteConf && siteConf.owner ? siteConf.owner : {};
  const months = (siteConf && siteConf.retentionMonths) || 12;
  const ownerWho = (o.fio ? o.fio + ', ' : 'владелец сервиса БьютиЛинк, ') + 'плательщик НПД (самозанятый)' + (o.inn ? ', ИНН ' + o.inn : '');
  const ownerContact = o.email ? ' Связь с ним: ' + o.email + '.' : '';
  const processor = 'По поручению оператора (ч. 3 ст. 6 152-ФЗ) данные обрабатывает ' + ownerWho + ' — сервис БьютиЛинк, на котором работает эта страница. Обработчик хранит данные только для передачи заявки мастеру и обязан соблюдать конфиденциальность и меры защиты по ст. 19 152-ФЗ.' + ownerContact;
  const storage = 'Данные хранятся в базе на территории Российской Федерации (Yandex Cloud, регион ru-central1). Мастер видит заявку в своей панели после входа через Яндекс ID или Mail.ru. Если мастер подключил Telegram, туда приходит только уведомление без вашего имени и телефона: услуга, дата и время.';
  const retention = months + ' месяцев после даты визита, затем заявка удаляется автоматически. Мастер может удалить её раньше. При отзыве согласия данные удаляются в течение 10 рабочих дней.';
  const rights = 'Вы вправе узнать, какие ваши данные обрабатываются, потребовать их уточнения, блокирования или удаления, отозвать согласие и обжаловать действия оператора в Роскомнадзоре или в суде (ст. 14, 17, 21 152-ФЗ). Ответ на запрос — в течение 10 рабочих дней.';
  if (kind === 'consent') {
    title.textContent = 'Согласие на обработку персональных данных';
    addPara(body, 'Кто даёт согласие.', 'Я, отправляя заявку, подтверждаю, что мне исполнилось 14 лет, и свободно, своей волей и в своём интересе даю согласие (ст. 9 152-ФЗ). Заявку за ребёнка младше 14 лет оставляет родитель или законный представитель.');
    addPara(body, 'Оператор.', 'Оператором персональных данных является ' + op + '.');
    addPara(body, 'Обработчик.', processor);
    addPara(body, 'Цель.', purpose);
    addPara(body, 'Перечень данных.', data);
    addPara(body, 'Действия с данными.', actions + ' Обработка автоматизированная.');
    addPara(body, 'Где хранятся.', storage);
    addPara(body, 'Срок действия и хранения.', 'Согласие действует ' + retention);
    addPara(body, 'Отзыв согласия.', revokePhrase(config) + ' Отзыв можно направить в любой форме, в том числе сообщением.');
  } else {
    title.textContent = 'Политика конфиденциальности';
    addPara(body, '1. Общие положения.', 'Политика описывает обработку персональных данных при отправке заявки с этой страницы и составлена по Федеральному закону от 27.07.2006 № 152-ФЗ «О персональных данных». Сервис не предназначен для лиц младше 14 лет.');
    addPara(body, '2. Оператор.', 'Оператором персональных данных является ' + op + '. Эта страница — форма заявки.');
    addPara(body, '3. Обработчик.', processor);
    addPara(body, '4. Состав данных.', data + ' Для защиты от спама IP-адрес и телефон учитываются только в виде необратимого хэша и удаляются через 2 дня. Сайт ставит только технические cookie; рекламы и счётчиков нет.');
    addPara(body, '5. Цель и основание.', purpose + ' Основание — ваше согласие.');
    addPara(body, '6. Хранение.', storage + ' Срок: ' + retention);
    addPara(body, '7. Ваши права.', rights + ' ' + revokePhrase(config));
    addPara(body, '8. Защита данных.', 'Передача только по HTTPS; доступ к заявкам — только у мастера после входа; хранилище закрыто от публичного доступа, ключи — в Yandex Lockbox; имена и телефоны клиентов не пишутся в журналы.');
    const p = document.createElement('p');
    const a = document.createElement('a');
    a.href = '/privacy';
    a.target = '_blank';
    a.rel = 'noopener';
    a.className = 'font-medium text-tg underline';
    a.textContent = 'Полная политика сервиса БьютиЛинк';
    p.appendChild(a);
    body.appendChild(p);
  }
  setSheet(legal, true);
  legalSheet.focus({ preventScroll: true });
}

function closeLegal() {
  setSheet(legal, false);
  if (legalReturn && legalReturn.focus) legalReturn.focus({ preventScroll: true });
}

async function deliver(payload) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 15000);
  try {
    const res = await fetch(SEND_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify(payload),
      signal: ctrl.signal
    });
    const data = await res.json().catch(() => ({}));
    if (data.error === 'operator_missing') {
      const err = new Error('operator');
      err.code = 'operator_missing';
      throw err;
    }
    if (data.error === 'slot_taken' || res.status === 409) {
      const err = new Error('slot');
      err.code = 'slot_taken';
      throw err;
    }
    if (data.error === 'rate_limited' || res.status === 429) {
      const err = new Error('rate');
      err.code = 'rate_limited';
      throw err;
    }
    if (data.error === 'validation') {
      const err = new Error('validation');
      err.code = 'validation';
      err.serverMessage = data.message;
      throw err;
    }
    if (!res.ok || data.ok === false) {
      const err = new Error('send');
      err.code = 'network';
      throw err;
    }
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
    ? 'rounded-full bg-tg active:bg-tg-dark px-3 py-1.5 text-sm font-semibold text-ontg'
    : 'rounded-full bg-surface px-3 py-1.5 text-sm font-semibold text-muted ring-1 ring-ios';
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

const INP = 'min-w-0 rounded-xl bg-surface px-3.5 py-2.5 text-sm outline-none ring-2 ring-transparent focus:ring-tg/40';

function renderRows() {
  const svcList = $('#svc-list');
  svcList.innerHTML = draft.map((s, i) => `
    <div class="rounded-xl bg-ios p-3" data-row="${i}">
      <input data-k="name" value="${esc(s.name)}" maxlength="60" placeholder="Название услуги" class="${INP} w-full">
      <div class="mt-2 flex gap-2">
        <input data-k="price" value="${esc(s.price)}" inputmode="numeric" placeholder="Цена, ₽" class="${INP} flex-1">
        <input data-k="dur" value="${esc(s.dur)}" maxlength="20" placeholder="Длит. (2 ч)" class="${INP} flex-1">
        <button type="button" data-del="${i}" aria-label="Удалить услугу" class="shrink-0 rounded-xl bg-surface px-3.5 text-red-600">✕</button>
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
  markThemeSwatch($('#p-theme').value);
  $('#p-theme-preview-name').textContent = c.name || 'Ваша страница';
  ensureTzOption(c.tz);
  $('#p-tz').value = c.tz;
  $('#p-photo').value = c.photo;
  $('#p-addr').value = c.addr || '';
  $('#p-hint').value = c.hint || '';
  $('#p-phone').value = c.phone || '';
  $('#p-telegram').value = c.telegram || '';
  $('#p-vk').value = c.vk || '';
  $('#p-max').value = c.max || '';
  $('#p-gallery').value = (c.gallery || []).join('\n');
  renderPhotoField();
  renderGalleryField();
  $('#p-horizon').value = String(c.horizon || DEFAULT_HORIZON);
  $('#p-slots').value = c.slots.join(', ');
  $('#p-legal-name').value = c.legalName || '';
  $('#p-legal-status').value = c.legalStatus || '';
  $('#p-inn').value = c.inn || '';
  $('#p-revoke').value = c.revokeContact || '';
  $('#p-city').value = c.city || '';
  $('#p-pub-consent').checked = Boolean(c.pubConsentAt);
  $('#p-terms').checked = Boolean(c.termsAt);
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

const STATUS_TEXT = {
  pending: 'Ждёт подтверждения',
  confirmed: 'Подтверждена',
  cancelled: 'Отменена'
};

function renderBookings(items) {
  const box = $('#booking-list');
  if (!items.length) {
    box.textContent = 'Пока нет заявок.';
    return;
  }
  box.innerHTML = items.map((b) => {
    const actions = [];
    if (b.status === 'pending') {
      actions.push('<button type="button" data-act="confirm" data-id="' + esc(b.id) + '" class="rounded-full bg-tg active:bg-tg-dark px-3 py-1.5 text-xs font-semibold text-ontg">Подтвердить</button>');
      actions.push('<button type="button" data-act="cancel" data-id="' + esc(b.id) + '" class="rounded-full bg-surface px-3 py-1.5 text-xs font-semibold text-muted ring-1 ring-ios">Отменить</button>');
    }
    actions.push('<button type="button" data-act="delete" data-id="' + esc(b.id) + '" class="rounded-full bg-surface px-3 py-1.5 text-xs font-semibold text-red-600 ring-1 ring-ios">Удалить</button>');
    return '<article class="rounded-xl bg-ios p-3">'
      + '<p class="font-medium">' + esc(b.dateText || b.date) + ', ' + esc(b.time) + '</p>'
      + '<p class="mt-1 text-muted">' + esc(b.serviceName) + ' · ' + esc(fmtPrice(b.servicePrice)) + '</p>'
      + '<p class="mt-1">' + esc(b.name) + ' · ' + esc(b.phone) + '</p>'
      + '<p class="mt-1 text-xs text-muted">' + esc(STATUS_TEXT[b.status] || b.status) + '</p>'
      + '<div class="mt-2 flex flex-wrap gap-2">' + actions.join('') + '</div>'
      + '</article>';
  }).join('');
}

async function loadBookings() {
  const box = $('#booking-list');
  if (!box) return;
  box.textContent = 'Загрузка заявок…';
  try {
    const res = await fetch('/api/admin/bookings', { credentials: 'same-origin' });
    const data = await res.json().catch(() => ({}));
    if (res.status === 401) {
      box.textContent = 'Войдите снова по ссылке из бота.';
      return;
    }
    if (!res.ok || !data.ok) {
      box.textContent = 'Не удалось загрузить заявки.';
      return;
    }
    renderBookings(data.bookings || []);
  } catch (e) {
    box.textContent = 'Не удалось загрузить заявки.';
  }
}

function openPanel() {
  fillPanel(config);
  loadAccount();
  $('#panel-err').classList.add('is-hidden');
  showLink(config, false);
  loadBookings();
  setSheet(panel, true);
  panelSheet.focus({ preventScroll: true });
}

function closePanel() {
  setSheet(panel, false);
  // Несохранённый выбор цвета — только предпросмотр: вернуть сохранённую тему.
  if (config) applyTheme(config.theme, true);
  const btn = $('#open-settings');
  if (btn) btn.focus({ preventScroll: true });
}

// ---- Фото из галереи телефона -------------------------------------------
// Снимок сжимается в браузере (canvas -> JPEG, до 1600 px по длинной
// стороне) и загружается в POST /api/admin/photos. В поля профиля
// попадает обычная https-ссылка, поэтому ручные ссылки тоже работают.
const PHOTO_MAX_SIDE = 1600;
const PHOTO_MAX_BYTES = 1900 * 1024;

function galleryUrls() {
  return $('#p-gallery').value.split(/[\s,]+/).filter(Boolean);
}

function setGalleryUrls(list) {
  $('#p-gallery').value = list.join('\n');
  renderGalleryField();
}

function photoStatus(id, text, isError) {
  const el = $(id);
  el.textContent = text || '';
  el.classList.toggle('is-hidden', !text);
  el.classList.toggle('text-red-600', Boolean(isError));
  el.classList.toggle('text-muted', !isError);
}

function renderPhotoField() {
  const url = $('#p-photo').value.trim();
  const img = $('#p-photo-preview');
  const ok = /^https:\/\//i.test(url);
  if (ok && img.getAttribute('src') !== url) img.src = url;
  img.classList.toggle('is-hidden', !ok);
  $('#p-photo-empty').classList.toggle('is-hidden', ok);
  $('#p-photo-remove').classList.toggle('is-hidden', !url);
}

function renderGalleryField() {
  const list = galleryUrls();
  const grid = $('#p-gallery-grid');
  grid.innerHTML = list.map((u, i) => `
    <div class="relative aspect-square overflow-hidden rounded-xl bg-ios">
      <img src="${escapeAttr(u)}" alt="Фото ${i + 1}" loading="lazy" class="h-full w-full object-cover">
      <button type="button" data-gal-del="${i}" aria-label="Удалить фото ${i + 1}" class="absolute right-1 top-1 flex h-7 w-7 items-center justify-center rounded-full bg-black/55 text-base leading-none text-white">×</button>
      ${i > 0 ? `<button type="button" data-gal-left="${i}" aria-label="Переместить фото ${i + 1} левее" class="absolute bottom-1 left-1 flex h-7 w-7 items-center justify-center rounded-full bg-black/55 text-sm leading-none text-white">←</button>` : ''}
    </div>`).join('');
  $('#p-gallery-count').textContent = list.length + ' из ' + GALLERY_MAX;
  $('#p-gallery-add').classList.toggle('is-hidden', list.length >= GALLERY_MAX);
}

function escapeAttr(v) {
  return String(v).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function loadImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => resolve({ img, url });
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('decode')); };
    img.src = url;
  });
}

function canvasBlob(canvas, quality) {
  return new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality));
}

// Safari сам декодирует HEIC с iPhone; ориентацию по EXIF браузеры уже
// учитывают при отрисовке <img>.
async function compressPhoto(file) {
  const { img, url } = await loadImage(file);
  try {
    const w0 = img.naturalWidth;
    const h0 = img.naturalHeight;
    if (!w0 || !h0) throw new Error('decode');
    let side = PHOTO_MAX_SIDE;
    let quality = 0.82;
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const k = Math.min(1, side / Math.max(w0, h0));
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(w0 * k));
      canvas.height = Math.max(1, Math.round(h0 * k));
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      const blob = await canvasBlob(canvas, quality);
      canvas.width = 0;
      canvas.height = 0;
      if (blob && blob.size <= PHOTO_MAX_BYTES) return blob;
      side = Math.round(side * 0.8);
      quality = Math.max(0.6, quality - 0.08);
    }
    throw new Error('too_big');
  } finally {
    URL.revokeObjectURL(url);
  }
}

function sendPhoto(blob, kind, onProgress) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', '/api/admin/photos?kind=' + kind);
    xhr.withCredentials = true;
    xhr.setRequestHeader('Content-Type', 'image/jpeg');
    xhr.timeout = 60000;
    xhr.upload.onprogress = (e) => { if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100)); };
    xhr.onload = () => {
      let data = {};
      try { data = JSON.parse(xhr.responseText); } catch (e) { /* ignore */ }
      if (xhr.status === 200 && data.ok && data.url) resolve(data.url);
      else if (xhr.status === 401) reject(new Error('Сессия закончилась. Войдите заново по ссылке из Telegram.'));
      else reject(new Error(data.message || 'Не удалось загрузить фото. Попробуйте ещё раз.'));
    };
    xhr.onerror = () => reject(new Error('Нет связи. Проверьте интернет и попробуйте ещё раз.'));
    xhr.ontimeout = () => reject(new Error('Загрузка заняла слишком долго. Попробуйте ещё раз.'));
    xhr.send(blob);
  });
}

async function uploadOne(file, kind, statusId, prefix) {
  if (file.type && !/^image\//.test(file.type)) throw new Error('Это не фото. Выберите снимок из галереи.');
  photoStatus(statusId, prefix + 'Сжимаем фото…');
  let blob;
  try {
    blob = await compressPhoto(file);
  } catch (e) {
    throw new Error(e.message === 'too_big'
      ? 'Фото слишком большое даже после сжатия. Выберите другое.'
      : 'Не удалось открыть фото. Выберите снимок в формате JPEG или PNG.');
  }
  return sendPhoto(blob, kind, (pct) => photoStatus(statusId, prefix + 'Загрузка… ' + pct + '%'));
}

function setupPhotoFields() {
  const avatarInput = $('#p-photo-file');
  const galleryInput = $('#p-gallery-file');
  let busy = false;
  const lock = (on) => {
    busy = on;
    avatarInput.disabled = on;
    galleryInput.disabled = on;
    $('#p-save').disabled = on;
  };

  $('#p-photo').addEventListener('input', renderPhotoField);
  $('#p-gallery').addEventListener('input', renderGalleryField);
  $('#p-photo-preview').addEventListener('error', () => {
    if ($('#p-photo').value.trim()) photoStatus('#p-photo-status', 'Фото по ссылке не открывается.', true);
  });
  $('#p-photo-remove').addEventListener('click', () => {
    $('#p-photo').value = '';
    renderPhotoField();
    photoStatus('#p-photo-status', 'Фото убрано. Нажмите «Сохранить профиль».');
  });

  avatarInput.addEventListener('change', async () => {
    const file = avatarInput.files && avatarInput.files[0];
    avatarInput.value = '';
    if (!file || busy) return;
    lock(true);
    try {
      const url = await uploadOne(file, 'avatar', '#p-photo-status', '');
      $('#p-photo').value = url;
      renderPhotoField();
      photoStatus('#p-photo-status', 'Готово. Нажмите «Сохранить профиль».');
      haptic('success');
    } catch (e) {
      photoStatus('#p-photo-status', e.message, true);
    } finally {
      lock(false);
    }
  });

  galleryInput.addEventListener('change', async () => {
    const files = Array.from(galleryInput.files || []);
    galleryInput.value = '';
    if (!files.length || busy) return;
    const room = GALLERY_MAX - galleryUrls().length;
    if (room <= 0) return photoStatus('#p-gallery-status', 'В портфолио уже ' + GALLERY_MAX + ' фото. Удалите лишние.', true);
    const queue = files.slice(0, room);
    lock(true);
    let done = 0;
    let error = '';
    try {
      for (let i = 0; i < queue.length; i += 1) {
        const prefix = queue.length > 1 ? 'Фото ' + (i + 1) + ' из ' + queue.length + ': ' : '';
        try {
          const url = await uploadOne(queue[i], 'gallery', '#p-gallery-status', prefix);
          setGalleryUrls(galleryUrls().concat(url).slice(0, GALLERY_MAX));
          done += 1;
        } catch (e) {
          error = e.message;
          if (/Сессия|связи/.test(error)) break;
        }
      }
    } finally {
      lock(false);
    }
    const skipped = files.length - queue.length;
    let text = done ? 'Добавлено фото: ' + done + '. Нажмите «Сохранить профиль».' : '';
    if (skipped > 0) text += (text ? ' ' : '') + 'Не поместилось: ' + skipped + ' (максимум ' + GALLERY_MAX + ').';
    if (error) text = (text ? text + ' ' : '') + error;
    photoStatus('#p-gallery-status', text, Boolean(error) && !done);
    if (done) haptic('success');
  });

  $('#p-gallery-grid').addEventListener('click', (e) => {
    const del = e.target.closest('[data-gal-del]');
    const left = e.target.closest('[data-gal-left]');
    const list = galleryUrls();
    if (del) {
      list.splice(Number(del.dataset.galDel), 1);
      setGalleryUrls(list);
      photoStatus('#p-gallery-status', 'Фото убрано. Нажмите «Сохранить профиль».');
    } else if (left) {
      const i = Number(left.dataset.galLeft);
      if (i > 0) [list[i - 1], list[i]] = [list[i], list[i - 1]];
      setGalleryUrls(list);
    }
  });
}

function setupAdmin() {
  setupPhotoFields();
  const settingsBtn = $('#open-settings');
  settingsBtn.classList.remove('is-hidden');
  settingsBtn.addEventListener('click', openPanel);
  panel.addEventListener('click', (e) => { if (e.target.closest('[data-close]')) closePanel(); });
  const themeList = $('#p-theme-list');
  themeList.addEventListener('click', (e) => {
    const b = e.target.closest('[data-theme]');
    if (b) pickTheme(b.dataset.theme);
  });
  themeList.addEventListener('keydown', (e) => {
    const keys = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 };
    if (!keys[e.key]) return;
    e.preventDefault();
    const items = Array.from(themeList.querySelectorAll('[data-theme]'));
    const i = items.findIndex((b) => b.dataset.theme === $('#p-theme').value);
    const next = items[(i + keys[e.key] + items.length) % items.length];
    pickTheme(next.dataset.theme);
    next.focus();
  });
  $('#p-name').addEventListener('input', () => {
    $('#p-theme-preview-name').textContent = $('#p-name').value.trim() || 'Ваша страница';
  });
  $('#svc-add').addEventListener('click', () => { readRows(); draft.push({ name: '', price: '', dur: '' }); renderRows(); });
  $('#svc-list').addEventListener('click', (e) => {
    const del = e.target.closest('[data-del]');
    if (!del) return;
    readRows();
    draft.splice(+del.dataset.del, 1);
    renderRows();
  });
  $('#booking-list').addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-act]');
    if (!btn) return;
    btn.disabled = true;
    try {
      const res = await fetch('/api/admin/bookings/' + encodeURIComponent(btn.dataset.id) + '/' + btn.dataset.act, {
        method: 'POST',
        credentials: 'same-origin'
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.ok === false) {
        const el = $('#panel-err');
        el.textContent = data.message || 'Не удалось обновить заявку';
        el.classList.remove('is-hidden');
        return;
      }
      $('#panel-err').classList.add('is-hidden');
      loadBookings();
    } catch (err) {
      const el = $('#panel-err');
      el.textContent = 'Не удалось обновить заявку';
      el.classList.remove('is-hidden');
    } finally {
      btn.disabled = false;
    }
  });
  $('#p-logout').addEventListener('click', async () => {
    await fetch('/api/admin/logout', { method: 'POST', credentials: 'same-origin' }).catch(() => {});
    location.replace('/admin');
  });
  $('#p-save').addEventListener('click', async () => {
    readRows();
    const fail = (msg) => {
      const el = $('#panel-err');
      el.textContent = msg;
      el.classList.remove('is-hidden');
      el.scrollIntoView({ block: 'center', behavior: 'smooth' });
    };
    if ($('#p-legal-name').value.trim().length < 5) return fail('Укажите ФИО — это данные оператора для согласия клиентов');
    if ($('#p-city').value.trim().length < 2) return fail('Укажите город');
    if ($('#p-revoke').value.trim().length < 3) return fail('Укажите контакт для отзыва согласия');
    if (!$('#p-pub-consent').checked) return fail('Отметьте согласие на публикацию данных оператора — без него клиенты не узнают, кто обрабатывает их данные');
    if (!$('#p-terms').checked) return fail('Примите условия для мастеров');
    const photo = $('#p-photo').value.trim();
    if (photo && !/^https:\/\//i.test(photo)) return fail('Ссылка на главное фото должна начинаться с https://');
    const phoneRaw = $('#p-phone').value.trim();
    if (phoneRaw && !cleanPhone(phoneRaw)) return fail('Телефон мастера: укажите номер с кодом страны, от 8 до 15 цифр');
    const tgRaw = $('#p-telegram').value.trim();
    if (tgRaw && !cleanTelegram(tgRaw)) return fail('Telegram: укажите @username или ссылку https://t.me/username');
    const vkRaw = $('#p-vk').value.trim();
    if (vkRaw && !cleanVk(vkRaw)) return fail('ВКонтакте: укажите ссылку https://vk.com/... или @username');
    const maxRaw = $('#p-max').value.trim();
    if (maxRaw && !cleanMax(maxRaw)) return fail('MAX: укажите ссылку https://max.ru/...');
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
    if (gal.length > GALLERY_MAX) return fail('В портфолио не больше ' + GALLERY_MAX + ' фото');
    const slots = parseSlots($('#p-slots').value);
    if (!slots) return fail('Часы приёма укажите в формате ЧЧ:ММ через запятую, например: 10:00, 12:30');
    const workDays = readWorkDays();
    if (!workDays.length) return fail('Выберите хотя бы один день приёма');
    const horizon = parseHorizon($('#p-horizon').value);
    if (!horizon) return fail('Горизонт записи: число от 1 до 60');
    const payload = {
      name: $('#p-name').value,
      desc: $('#p-desc').value,
      photo,
      addr: $('#p-addr').value,
      hint: $('#p-hint').value,
      gallery: gal,
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
      city: $('#p-city').value,
      pubConsent: $('#p-pub-consent').checked,
      terms: $('#p-terms').checked,
      phone: phoneRaw,
      telegram: tgRaw,
      vk: vkRaw,
      max: maxRaw
    };
    const c = clean(Object.assign({}, payload, { chatId: '' }), { requireChat: false });
    if (!c) return fail('Проверьте имя и наличие хотя бы одной услуги');
    const btn = $('#p-save');
    btn.disabled = true;
    try {
      const res = await fetch('/api/admin/profile', {
        method: 'PUT',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) return fail(data.message || 'Не удалось сохранить профиль');
      const next = configFromApi(data);
      if (!next) return fail('Сервер вернул неполный профиль');
      $('#panel-err').classList.add('is-hidden');
      config = next;
      applyConfig(next);
      fillPanel(next);
      showLink(next, true);
      loadAccount();
      haptic('success');
    } catch (e) {
      fail('Не удалось сохранить профиль. Проверьте интернет.');
    } finally {
      btn.disabled = false;
    }
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

async function exchangeToken(token) {
  const res = await fetch('/api/admin/session', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token })
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.ok) {
    const err = $('#admin-error');
    if (err) {
      err.textContent = data.message || 'Ссылка для входа недействительна или уже использована. Запросите новую у бота.';
      err.classList.remove('is-hidden');
    }
    showView('admin');
    document.title = 'Вход для мастера · БьютиЛинк';
    return '';
  }
  return data.slug || '';
}

let siteConf = null;

async function loadSiteConf() {
  if (siteConf) return siteConf;
  try {
    const res = await fetch('/api/config', { credentials: 'same-origin' });
    const data = await res.json();
    siteConf = data && data.ok ? data : null;
  } catch (e) {
    siteConf = null;
  }
  return siteConf || { providers: [], telegramLogin: true, owner: {}, retentionMonths: 12 };
}

function renderOwnerReq(conf) {
  const el = $('#owner-req');
  if (!el) return;
  const o = (conf && conf.owner) || {};
  const parts = [];
  if (o.fio) parts.push(o.fio);
  parts.push('плательщик НПД (самозанятый)');
  if (o.inn) parts.push('ИНН ' + o.inn);
  el.replaceChildren();
  el.appendChild(document.createTextNode('Сервис БьютиЛинк: ' + parts.join(', ')));
  if (o.email) {
    el.appendChild(document.createTextNode(' · '));
    const a = document.createElement('a');
    a.href = 'mailto:' + o.email;
    a.className = 'underline';
    a.textContent = o.email;
    el.appendChild(a);
  }
}

const AUTH_ERRORS = {
  state: 'Вход не завершён: истекло время или вход начат в другом окне. Попробуйте ещё раз.',
  denied: 'Вход отменён.',
  exchange: 'Провайдер входа не ответил. Попробуйте ещё раз.',
  provider: 'Этот способ входа сейчас недоступен.',
  session: 'Сначала войдите в панель, потом привяжите вход.',
  taken: 'Эта учётная запись уже привязана к другой странице.'
};

function showAdminError(msg) {
  const err = $('#admin-error');
  if (!err) return;
  err.textContent = msg;
  err.classList.remove('is-hidden');
}

async function showLogin(params) {
  const conf = await loadSiteConf();
  const ids = (conf.providers || []).map((p) => p.id);
  $('#login-yandex').classList.toggle('is-hidden', !ids.includes('yandex'));
  $('#login-vkid').classList.toggle('is-hidden', !ids.includes('vkid'));
  $('#login-tg').classList.toggle('is-hidden', !conf.telegramLogin);
  $('#login-none').classList.toggle('is-hidden', ids.length > 0);
  const code = params.get('auth_error');
  if (code) showAdminError(AUTH_ERRORS[code] || 'Не получилось войти. Попробуйте ещё раз.');
  if (params.get('signup') === '1') await showSignup();
}

async function showSignup() {
  let info = null;
  try {
    const res = await fetch('/api/auth/signup', { credentials: 'same-origin' });
    info = await res.json().catch(() => null);
    if (!res.ok) info = null;
  } catch (e) {
    info = null;
  }
  if (!info || !info.ok) {
    showAdminError('Регистрация не открыта: войдите через Яндекс ID или Mail.ru ещё раз.');
    return;
  }
  $('#login-box').classList.add('is-hidden');
  $('#signup-box').classList.remove('is-hidden');
  const slugEl = $('#su-slug');
  const preview = () => { $('#su-preview').textContent = location.origin + '/' + (slugEl.value.trim().toLowerCase() || 'ваш-адрес'); };
  if (info.name) $('#su-name').value = info.name;
  slugEl.addEventListener('input', preview);
  preview();
  $('#signup-box').addEventListener('submit', async (e) => {
    e.preventDefault();
    $('#admin-error').classList.add('is-hidden');
    const slug = slugEl.value.trim().toLowerCase();
    if (!/^[a-z0-9](?:[a-z0-9-]{1,30}[a-z0-9])$/.test(slug)) return showAdminError('Адрес: латинские буквы, цифры и дефис, от 3 до 32 символов.');
    if (!$('#su-terms').checked) return showAdminError('Примите условия для мастеров.');
    const btn = $('#su-submit');
    btn.disabled = true;
    try {
      const res = await fetch('/api/auth/signup', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slug, name: $('#su-name').value, terms: true })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) return showAdminError(data.message || 'Не удалось создать страницу.');
      location.replace('/' + data.slug + '?admin=1');
    } catch (err) {
      showAdminError('Не удалось создать страницу. Проверьте интернет.');
    } finally {
      btn.disabled = false;
    }
  });
}

async function loadAccount() {
  const me = await currentMaster();
  if (!me) return;
  const warn = $('#operator-warn');
  const missing = me.operatorMissing || [];
  if (missing.length) {
    warn.textContent = 'Онлайн-запись приостановлена: по 152-ФЗ клиенты должны видеть, кто обрабатывает их данные. Заполните внизу: ' + missing.join(', ') + ' — и сохраните профиль.';
    warn.classList.remove('is-hidden');
  } else {
    warn.classList.add('is-hidden');
  }
  const ids = me.identities || [];
  const providers = (me.providers || []).map((p) => p.id);
  const names = { yandex: 'Яндекс ID', vkid: 'Mail.ru' };
  const linked = ids.map((id) => names[id] || id);
  let status = linked.length ? 'Вход: ' + linked.join(', ') + '.' : 'Вход через Яндекс ID или Mail.ru не привязан.';
  status += me.telegram ? ' Telegram подключён для уведомлений.' : ' Telegram не подключён.';
  if (!linked.length && me.telegramLogin) status += ' Привяжите Яндекс ID или Mail.ru — вход через Telegram скоро отключится.';
  $('#acc-status').textContent = status;
  $('#acc-yandex').classList.toggle('is-hidden', !providers.includes('yandex') || ids.includes('yandex'));
  $('#acc-vkid').classList.toggle('is-hidden', !providers.includes('vkid') || ids.includes('vkid'));
  const tgBtn = $('#acc-tg');
  tgBtn.textContent = me.telegram ? 'Подключить другой Telegram' : 'Подключить Telegram для уведомлений';
  tgBtn.classList.remove('is-hidden');
  if (!tgBtn.dataset.bound) {
    tgBtn.dataset.bound = '1';
    tgBtn.addEventListener('click', async () => {
      try {
        const res = await fetch('/api/admin/telegram-link', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: '{}' });
        const data = await res.json().catch(() => ({}));
        if (data.ok && /^https:\/\/t\.me\//.test(data.url)) location.href = data.url;
        else $('#acc-status').textContent = data.message || 'Не удалось получить ссылку для Telegram.';
      } catch (e) {
        $('#acc-status').textContent = 'Не удалось получить ссылку для Telegram. Проверьте интернет.';
      }
    });
  }
  const params = new URLSearchParams(location.search);
  if (params.get('linked')) $('#acc-status').textContent = 'Готово: ' + (names[params.get('linked')] || 'вход') + ' привязан. ' + status;
  if (params.get('auth_error')) $('#acc-status').textContent = (AUTH_ERRORS[params.get('auth_error')] || 'Не удалось привязать вход.') + ' ' + status;
}

async function currentMaster() {
  try {
    const res = await fetch('/api/admin/me', { credentials: 'same-origin' });
    if (!res.ok) return null;
    const data = await res.json();
    return data && data.ok ? data : null;
  } catch (e) {
    return null;
  }
}

async function route() {
  const params = new URLSearchParams(location.search);
  const path = decodeURIComponent((location.pathname || '/').replace(/\/+$/, '') || '/');
  const token = params.get('token');
  legacyMode = false;
  busy = new Set();

  if (path === '/admin') {
    showView('admin');
    document.title = 'Вход для мастера · БьютиЛинк';
    if (token) {
      const slug = await exchangeToken(token);
      if (slug) location.replace('/' + slug + '?admin=1');
      else await showLogin(params);
      return;
    }
    const me = params.get('signup') === '1' ? null : await currentMaster();
    if (me && me.slug) {
      location.replace('/' + me.slug + '?admin=1');
      return;
    }
    await showLogin(params);
    return;
  }

  if (path === '/' && params.has('config')) {
    legacyMode = true;
    config = unpackConfig(params.get('config'));
    if (!config) {
      showBroken('Ссылка повреждена', 'Не удалось прочитать настройки мастера. Попросите прислать актуальную ссылку на запись.');
      return;
    }
    showView('app');
    applyConfig(config);
    const oldSettings = $('#open-settings');
    if (oldSettings) oldSettings.remove();
    return;
  }

  if (path === '/') {
    showView('lock');
    document.title = 'БьютиЛинк — онлайн-запись к бьюти-мастеру';
    renderOwnerReq(await loadSiteConf());
    return;
  }

  const slug = path.slice(1);
  if (!/^[a-z0-9](?:[a-z0-9-]{1,30}[a-z0-9])$/.test(slug)) {
    showBroken('Ссылка повреждена', 'Не удалось прочитать адрес страницы. Попросите мастера прислать актуальную ссылку.');
    return;
  }

  showView('loading');
  try {
    const res = await fetch('/api/masters/' + encodeURIComponent(slug));
    const data = await res.json().catch(() => ({}));
    let source = data;
    if (!res.ok || !data.ok) {
      const me = await currentMaster();
      if (data.error === 'not_published' && me && me.slug === slug) {
        const own = await fetch('/api/admin/profile', { credentials: 'same-origin' });
        source = await own.json().catch(() => ({}));
        if (!own.ok || !source.ok) {
          showView('preparing');
          document.title = 'Страница ещё готовится · БьютиЛинк';
          return;
        }
      } else if (data.error === 'not_published') {
        showView('preparing');
        document.title = 'Страница ещё готовится · БьютиЛинк';
        return;
      } else {
        showBroken('Страница не найдена', 'Такой страницы мастера нет. Проверьте ссылку или попросите отправить её ещё раз.');
        return;
      }
    }
    config = configFromApi(source);
    if (!config) {
      showBroken('Ссылка повреждена', 'Не удалось прочитать страницу мастера.');
      return;
    }
    showView('app');
    applyConfig(config);
    loadSiteConf();
    const me = source === data ? await currentMaster() : { slug };
    if (me && me.slug === slug) {
      setupAdmin();
      if (params.get('admin') === '1') openPanel();
    } else {
      const settings = $('#open-settings');
      if (settings) settings.remove();
    }
  } catch (e) {
    showBroken('Не удалось открыть страницу', 'Проверьте интернет и откройте ссылку ещё раз.');
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
    if (legacyMode) {
      showFallback('unconfigured');
      return;
    }
    const data = await deliver({
      slug: config.slug,
      serviceName: state.service.name,
      date: state.iso,
      time,
      name,
      phone,
      consent: true
    });
    showSuccess(name, dateText, time);
    if (data && data.notified === false) {
      $('#done-text').textContent += ' Заявка сохранена. Если сообщение в Telegram не пришло, она есть в списке заявок мастера.';
    }
  } catch (err) {
    const code = err && err.code;
    if (code === 'slot_taken') {
      busy.add(state.iso + 'T' + time);
      state.slot = null;
      renderDates();
      renderSlots();
    }
    showFallback(code === 'slot_taken' || code === 'rate_limited' || code === 'validation' || code === 'unconfigured' || code === 'operator_missing' ? code : 'network');
    if (code === 'validation' && err.serverMessage) {
      const note = $('#send-fallback p');
      if (note) note.textContent = err.serverMessage;
    }
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
route().catch(() => showBroken('Не удалось открыть страницу', 'Проверьте интернет и откройте ссылку ещё раз.'));
syncTelegramCalendarNote();
loadTelegram().then((tg) => {
  tgApp = tg;
  const user = tg && tg.initDataUnsafe && tg.initDataUnsafe.user;
  if (user && user.first_name && nameEl && !nameEl.value) nameEl.value = user.first_name;
});

