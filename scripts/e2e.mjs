import { spawn } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { chromium, devices } from 'playwright';

const port = process.env.PORT || '4173';
const base = 'http://127.0.0.1:' + port;
const outDir = process.env.ARTIFACTS || '/opt/cursor/artifacts';

function waitForServer() {
  const started = Date.now();
  return new Promise((resolve, reject) => {
    const tick = async () => {
      try {
        const res = await fetch(base + '/api/health');
        if (res.ok) return resolve();
      } catch (e) { /* сервер ещё поднимается */ }
      if (Date.now() - started > 10000) return reject(new Error('mock server did not start'));
      setTimeout(tick, 150);
    };
    tick();
  });
}

const server = spawn(process.execPath, ['local/server.js'], {
  cwd: fileURLToPath(new URL('..', import.meta.url)),
  env: { ...process.env, PORT: port },
  stdio: ['ignore', 'pipe', 'pipe']
});
server.stdout.on('data', (chunk) => process.stdout.write(chunk));
server.stderr.on('data', (chunk) => process.stderr.write(chunk));

let browser;
try {
  await waitForServer();
  await mkdir(outDir, { recursive: true });
  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ ...devices['iPhone 13'] });
  const page = await context.newPage();
  const consoleErrors = [];
  page.on('pageerror', (err) => consoleErrors.push(String(err)));

  await page.goto(base + '/anna', { waitUntil: 'domcontentloaded' });
  await page.getByRole('heading', { name: 'Анна | Маникюр' }).waitFor();
  await page.screenshot({ path: outDir + '/mobile_master_card.png' });

  const slotsReady = page.waitForResponse((res) => res.url().includes('/slots') && res.ok());
  await page.getByRole('button', { name: 'Записаться' }).first().click();
  await slotsReady;
  await page.getByRole('heading', { name: 'Заявка на приём' }).waitFor();
  const slot = page.locator('#slots button:not([disabled])').first();
  await slot.waitFor();
  const slotText = (await slot.textContent()).trim();
  await slot.click();
  await page.locator('#name').fill('Мария');
  await page.locator('#phone').fill('9991234567');
  await page.locator('#consent').check();
  await page.getByRole('button', { name: 'Отправить заявку' }).click();
  await page.getByRole('heading', { name: 'Заявка отправлена' }).waitFor();
  await page.screenshot({ path: outDir + '/mobile_booking_sent.png' });
  await page.getByRole('button', { name: 'Готово' }).click();

  await page.getByRole('button', { name: 'Записаться' }).first().click();
  const busy = page.locator('#slots button', { hasText: slotText });
  await busy.waitFor();
  if (!(await busy.isDisabled())) throw new Error('слот ' + slotText + ' остался свободным после заявки');
  const label = await busy.getAttribute('aria-label');
  if (!label || !label.includes('занято')) throw new Error('нет подписи о занятости: ' + label);
  await page.screenshot({ path: outDir + '/mobile_slot_busy.png' });

  const login = await fetch(base + '/__test/login-link?slug=anna').then((res) => res.json());
  if (!login.ok) throw new Error('нет ссылки входа');
  await page.goto(base + login.url, { waitUntil: 'domcontentloaded' });
  await page.waitForURL(/\/anna/);
  await page.getByRole('heading', { name: 'Конструктор визитки' }).waitFor();
  await page.getByText('Мария').waitFor();
  await page.getByText('Ждёт подтверждения').waitFor();
  await page.screenshot({ path: outDir + '/mobile_admin_bookings.png' });

  if (consoleErrors.length) throw new Error(consoleErrors.join('\n'));
  console.log('e2e ok', slotText);
} finally {
  if (browser) await browser.close();
  server.kill('SIGTERM');
}
