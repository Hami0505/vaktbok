// Grensesnittet i ekte nettleser, uten konto og uten nett mot Supabase.
// Alt utenfor localhost blokkeres, så testene aldri rører den ekte databasen.
import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

test.beforeEach(async ({ page }) => {
  await page.route(url => !/^https?:\/\/localhost(:\d+)?\//.test(url.href), route => route.abort());
  page.errors = [];
  page.on('pageerror', e => page.errors.push(e.message));
  await page.goto('/');
});

test.afterEach(async ({ page }) => {
  expect(page.errors, 'ingen JavaScript-feil på siden').toEqual([]);
});

async function noSideScroll(page) {
  const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(over, 'siden skal ikke kunne scrolles sidelengs').toBeLessThanOrEqual(0);
}

async function addEmployer(page, name, rate) {
  await page.fill('#eName', name);
  await page.fill('#eRate', String(rate));
  await page.click('#empForm button[type=submit]');
  await expect(page.locator('#empDialog')).not.toBeVisible();
}

async function addShift(page, { date, start, end, breakMin = '0' }) {
  await page.click('#t-uke');
  await page.click('#newShiftBtn');
  await expect(page.locator('#shiftDialog')).toBeVisible();
  await page.fill('#fDate', date);
  await page.fill('#fStart', start);
  await page.fill('#fEnd', end);
  await page.fill('#fBreak', breakMin);
  await page.click('#saveShiftBtn');
  await expect(page.locator('#shiftDialog')).not.toBeVisible();
}

test('landingssiden: tydelig valg, ingen tilgjengelighetsfeil, ingen sidelengs scroll', async ({ page }) => {
  await expect(page.getByRole('heading', { name: 'Alle vaktene dine, på ett sted.' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Start med egne vakter' })).toBeVisible();
  await noSideScroll(page);
  const axe = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
  expect(axe.violations.map(v => `${v.id}: ${v.nodes.map(n => n.target).join(', ')}`)).toEqual([]);
});

test('ny bruker: arbeidsgiver, vakt og timer i uka', async ({ page }) => {
  await page.getByRole('button', { name: 'Start med egne vakter' }).click();
  await expect(page.locator('#empDialog')).toBeVisible();
  await addEmployer(page, 'Byrå', 250);
  const today = await page.evaluate(() => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; });
  await addShift(page, { date: today, start: '08:00', end: '16:00', breakMin: '30' });
  await expect(page.locator('#weekList')).toContainText('Byrå');
  await expect(page.locator('#weekSum')).toContainText('7,5');
  await noSideScroll(page);
  // overlever omlasting (lagres lokalt)
  await page.reload();
  await expect(page.locator('#weekList')).toContainText('Byrå');
});

test('for kort hviletid gir varsel', async ({ page }) => {
  await page.getByRole('button', { name: 'Start med egne vakter' }).click();
  await addEmployer(page, 'Kafé', 200);
  const [d1, d2] = await page.evaluate(() => {
    const iso = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const a = new Date(); const day = (a.getDay() + 6) % 7; a.setDate(a.getDate() - day); // mandag denne uka
    const b = new Date(a); b.setDate(a.getDate() + 1);
    return [iso(a), iso(b)];
  });
  await addShift(page, { date: d1, start: '15:00', end: '23:00' });
  await addShift(page, { date: d2, start: '07:00', end: '15:00' });
  await expect(page.locator('#v-uke')).toContainText(/hvile/i);
});

test('eksempeldata: alle faner tegnes uten feil og uten sidelengs scroll', async ({ page }) => {
  await page.getByRole('button', { name: 'Prøv med eksempeldata' }).click();
  await expect(page.locator('#weekList')).not.toBeEmpty();
  for (const tab of ['#t-uke', '#t-oversikt', '#t-arbeidsgivere', '#t-konto']) {
    await page.click(tab);
    await noSideScroll(page);
  }
  await page.click('#t-uke');
  const axe = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
  expect(axe.violations.map(v => `${v.id}: ${v.nodes.map(n => n.target).join(', ')}`)).toEqual([]);
});

test('gjest på iPhone får råd om Hjem-skjermen', async ({ browser }) => {
  const ctx = await browser.newContext({
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
    viewport: { width: 390, height: 844 },
  });
  const page = await ctx.newPage();
  await page.route(url => !/^https?:\/\/localhost(:\d+)?\//.test(url.href), route => route.abort());
  await page.goto('/');
  await page.getByRole('button', { name: 'Prøv med eksempeldata' }).click();
  const banner = page.locator('#banners');
  await expect(banner).toContainText('Hjem-skjermen');
  await banner.getByRole('button', { name: 'Skjønner' }).click();
  await expect(banner).not.toContainText('Hjem-skjermen');
  // etter 30 dager kommer påminnelsen igjen
  await page.evaluate(() => localStorage.setItem('vaktbok:guest-warned', new Date(Date.now() - 31 * 86400000).toISOString()));
  await page.reload();
  await expect(banner).toContainText('Hjem-skjermen');
  await ctx.close();
});
