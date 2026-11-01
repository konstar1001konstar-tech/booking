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

function bookingMessage(booking, master) {
  const category = master && master.profile ? master.profile.category : 'other';
  const emoji = { manicure: '💅', massage: '💆', brows: '✨', other: '📌' }[category] || '📌';
  const lines = [
    '🔔 <b>Новая заявка</b>',
    '',
    emoji + ' Услуга: <b>' + escapeHtml(booking.serviceName) + '</b>',
    'Стоимость: ' + escapeHtml(formatPrice(booking.servicePrice)),
    'Дата: ' + escapeHtml(booking.dateText || booking.date),
    'Время: <b>' + escapeHtml(booking.time) + '</b>',
    'Клиент: ' + escapeHtml(booking.clientName),
    'Телефон: <code>' + escapeHtml(booking.clientPhone) + '</code>',
    'Согласие на обработку ПДн: да'
  ];
  if (master && master.profile && master.profile.addr) {
    lines.push('Адрес: ' + escapeHtml(master.profile.addr));
  }
  const digits = String(booking.clientPhone || '').replace(/\D/g, '');
  if (digits) {
    const waText = 'Здравствуйте, ' + booking.clientName + '! Вы оставили заявку на «'
      + booking.serviceName + '» (' + (booking.dateText || booking.date) + ', ' + booking.time + ').';
    const waUrl = 'https://wa.me/' + digits + '?text=' + encodeURIComponent(waText);
    lines.push('', '<a href="' + escapeHtml(waUrl) + '">Написать клиенту в WhatsApp</a>');
  }
  return lines.join('\n');
}

function bookingKeyboard(bookingId) {
  return {
    inline_keyboard: [[
      { text: 'Подтвердить', callback_data: 'ok:' + bookingId },
      { text: 'Отменить', callback_data: 'no:' + bookingId }
    ]]
  };
}

module.exports = { escapeHtml, formatPrice, bookingMessage, bookingKeyboard };
