'use strict';

function escapeHtml(value) {
  return String(value == null ? '' : value).replace(/[&<>"]/g, (ch) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;'
  }[ch]));
}

function formatPrice(n) {
  return Number(n).toLocaleString('ru-RU') + '\u00a0₽';
}

// Уведомление мастеру в Telegram. Имени и телефона клиента здесь нет: текст
// проходит через серверы Telegram и релей на Vercel (вне РФ), а персональные
// данные клиента остаются в базе в Yandex Cloud и видны только в панели.
function bookingMessage(booking, master, panelUrl) {
  const category = master && master.profile ? master.profile.category : 'other';
  const emoji = { manicure: '💅', massage: '💆', brows: '✨', other: '📌' }[category] || '📌';
  const lines = [
    '🔔 <b>Новая заявка</b>',
    '',
    emoji + ' Услуга: <b>' + escapeHtml(booking.serviceName) + '</b>',
    'Стоимость: ' + escapeHtml(formatPrice(booking.servicePrice)),
    'Дата: ' + escapeHtml(booking.dateText || booking.date),
    'Время: <b>' + escapeHtml(booking.time) + '</b>'
  ];
  const addr = master && master.profile ? master.profile.addr : '';
  if (addr) lines.push('Адрес: ' + escapeHtml(addr));
  lines.push(
    '',
    'Имя и телефон клиента — в панели мастера:'
  );
  if (panelUrl) lines.push(escapeHtml(panelUrl));
  return lines.join('\n');
}

function bookingKeyboard(bookingId, panelUrl) {
  const rows = [[
    { text: 'Подтвердить', callback_data: 'ok:' + bookingId },
    { text: 'Отменить', callback_data: 'no:' + bookingId }
  ]];
  if (panelUrl && /^https:\/\//.test(panelUrl)) rows.push([{ text: 'Открыть заявки', url: panelUrl }]);
  return { inline_keyboard: rows };
}

module.exports = { escapeHtml, formatPrice, bookingMessage, bookingKeyboard };
