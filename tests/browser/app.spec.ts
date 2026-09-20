import { expect, test, type Page } from '@playwright/test';

async function mockApi(page: Page, administrator = true, firstStart = false, denyAssignment = false) {
  let signedIn = false, isNew = firstStart, nextUser = 2, nextDevice = 2;
  const admin = { id: 1, name: 'Администратор', email: 'admin@example.test', administrator,
    readonly: !administrator, deviceReadonly: !administrator };
  const users: any[] = [admin], links: Record<number, number[]> = {};
  const devices: any[] = [{ id: 1, name: 'Газель А123ВС', uniqueId: 'demo-001', status: 'online', attributes: {} }];
  await page.route('**/api/**', async route => {
    const request = route.request(), url = new URL(request.url()), path = url.pathname, method = request.method();
    const respond = (body: unknown, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
    if (path === '/api/server') return respond({ newServer: isNew, registration: false });
    if (path === '/api/session') {
      if (method === 'POST') { signedIn = true; return respond(admin); }
      if (method === 'DELETE') { signedIn = false; return route.fulfill({ status: 204 }); }
      return signedIn ? respond(admin) : respond({}, 404);
    }
    if (path === '/api/users' && method === 'POST' && isNew) { isNew = false; return respond(admin); }
    if (!signedIn) return respond({}, 401);
    if (path === '/api/users') {
      if (method === 'GET') return respond(users);
      const created = { id: nextUser++, ...request.postDataJSON() };
      users.push(created); return respond(created);
    }
    if (/^\/api\/users\/\d+$/.test(path) && method === 'PUT') {
      const id = Number(path.split('/').pop()), index = users.findIndex(u => u.id === id);
      users[index] = { ...users[index], ...request.postDataJSON() }; return respond(users[index]);
    }
    if (path === '/api/devices') {
      if (method === 'POST') {
        const created = { id: nextDevice++, status: 'unknown', ...request.postDataJSON() };
        devices.push(created); return respond(created);
      }
      if (url.searchParams.has('userId')) return respond(devices.filter(d => (links[Number(url.searchParams.get('userId'))] ?? []).includes(d.id)));
      return respond(devices);
    }
    if (/^\/api\/devices\/\d+$/.test(path) && method === 'PUT') {
      const id = Number(path.split('/').pop()), index = devices.findIndex(d => d.id === id);
      devices[index] = { ...devices[index], ...request.postDataJSON() }; return respond(devices[index]);
    }
    if (path === '/api/permissions') {
      if (denyAssignment) return respond({}, 403);
      const { userId, deviceId } = request.postDataJSON();
      links[userId] = method === 'POST' ? [...(links[userId] ?? []), deviceId] : (links[userId] ?? []).filter(id => id !== deviceId);
      return route.fulfill({ status: 204 });
    }
    if (path === '/api/positions') return respond([]);
    return respond({}, 404);
  });
  await page.route('https://tile.openstreetmap.org/**', route => route.abort());
}
async function login(page: Page) {
  await page.goto('/');
  await page.getByLabel('Email', { exact: true }).fill('admin@example.test');
  await page.getByLabel('Пароль', { exact: true }).fill('test-password-12345');
  await page.getByRole('button', { name: 'Войти в мониторинг' }).click();
}
async function openManager(page: Page) {
  await login(page);
  await page.getByRole('button', { name: /Открыть менеджер/ }).click();
}
async function createClient(page: Page) {
  await page.getByRole('button', { name: /Создать клиента/ }).last().click();
  const modal = page.getByRole('dialog');
  await modal.getByLabel('Название клиента / компании').fill('ООО Север');
  await modal.getByLabel('ИНН', { exact: true }).fill('7701234567');
  await modal.getByLabel('Email для входа').fill('fleet@example.test');
  await modal.getByLabel('Первоначальный пароль').fill('customer-password-123');
  await modal.getByRole('button', { name: 'Сохранить', exact: true }).click();
  await expect(modal).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Выбрать ООО Север', exact: true })).toBeVisible();
}
async function switchTab(page: Page, label: string) {
  await page.getByRole('navigation', { name: 'Разделы менеджера' }).getByRole('button', { name: new RegExp(label) }).click();
}

test('manager creates and edits client and assigns vehicle in manager', async ({ page }) => {
  await mockApi(page); await openManager(page); await createClient(page);
  await switchTab(page, 'Транспорт');
  await page.getByRole('button', { name: /Добавить транспорт/ }).click();
  const modal = page.getByRole('dialog');
  await modal.getByLabel('Название транспорта').fill('КамАЗ 01');
  await modal.getByLabel('Госномер', { exact: true }).fill('А001АА');
  await modal.getByLabel('IMEI / ID терминала').fill('860000000000001');
  await modal.getByLabel('Модель терминала').fill('NAVTELECOM SMART');
  await modal.getByLabel('Протокол терминала').selectOption('EGTS');
  await modal.getByLabel('Клиент — назначить доступ').selectOption({ label: 'ООО Север' });
  await modal.getByRole('button', { name: 'Сохранить', exact: true }).click();
  await expect(modal).toHaveCount(0);
  await expect(page.getByRole('row').filter({ hasText: 'КамАЗ 01' })).toContainText('ООО Север');
  await page.getByRole('button', { name: 'Выбрать КамАЗ 01', exact: true }).click();
  await page.getByRole('button', { name: 'Редактировать', exact: true }).click();
  await modal.getByLabel('Госномер', { exact: true }).fill('А002АА');
  await modal.getByRole('button', { name: 'Сохранить', exact: true }).click();
  await expect(page.getByRole('row').filter({ hasText: 'КамАЗ 01' })).toContainText('А002АА');
  await page.screenshot({ path: 'test-results/manager-vehicles.png', fullPage: true });
  await switchTab(page, 'Клиенты');
  await page.getByRole('button', { name: 'Выбрать ООО Север', exact: true }).click();
  await page.getByRole('button', { name: 'Доступ к транспорту', exact: true }).click();
  const check = modal.getByRole('checkbox', { name: /КамАЗ 01/ });
  await expect(check).toBeChecked(); await check.click(); await expect(check).not.toBeChecked();
  await modal.getByRole('button', { name: 'Готово' }).click();
  await page.getByRole('button', { name: 'Заблокировать', exact: true }).click();
  await expect(page.getByRole('row').filter({ hasText: 'ООО Север' })).toContainText('Заблокирован');
  await page.getByRole('button', { name: 'Редактировать', exact: true }).click();
  await modal.getByLabel('Контактное лицо').fill('Иван Иванов');
  await modal.getByRole('button', { name: 'Сохранить', exact: true }).click();
  await expect(page.getByRole('row').filter({ hasText: 'ООО Север' })).toContainText('Иван Иванов');
  await page.screenshot({ path: 'test-results/manager-clients.png', fullPage: true });
});

test('manager creates explicit full-access manager and restricted observer', async ({ page }) => {
  await mockApi(page); await openManager(page); await createClient(page);
  await switchTab(page, 'Пользователи');
  await page.getByRole('button', { name: /Создать пользователя/ }).click();
  const modal = page.getByRole('dialog');
  await modal.getByLabel('Имя пользователя').fill('Менеджер Анна');
  await modal.getByLabel('Email для входа').fill('anna@example.test');
  await modal.getByLabel('Первоначальный пароль').fill('manager-password-123');
  await modal.getByLabel('Роль', { exact: true }).selectOption('manager');
  const managerRequest = page.waitForRequest(req => req.url().endsWith('/api/users') && req.method() === 'POST');
  await modal.getByRole('button', { name: 'Сохранить', exact: true }).click();
  expect((await managerRequest).postDataJSON()).toMatchObject({ administrator: true, readonly: false });
  await expect(page.getByRole('row').filter({ hasText: 'Менеджер Анна' })).toContainText('Менеджер системы');
  await page.getByRole('button', { name: /Создать пользователя/ }).click();
  await modal.getByLabel('Имя пользователя').fill('Диспетчер Иван');
  await modal.getByLabel('Email для входа').fill('ivan@example.test');
  await modal.getByLabel('Первоначальный пароль').fill('observer-password-123');
  await modal.getByLabel('Клиент', { exact: true }).selectOption({ label: 'ООО Север' });
  const observerRequest = page.waitForRequest(req => req.url().endsWith('/api/users') && req.method() === 'POST');
  await modal.getByRole('button', { name: 'Сохранить', exact: true }).click();
  expect((await observerRequest).postDataJSON()).toMatchObject({ administrator: false, readonly: true, deviceReadonly: true, userLimit: 0 });
  await expect(page.getByRole('row').filter({ hasText: 'Диспетчер Иван' })).toContainText('Наблюдатель');
  await page.reload();
  await page.getByRole('button', { name: /Открыть менеджер/ }).click();
  await switchTab(page, 'Пользователи');
  await expect(page.getByRole('button', { name: 'Выбрать Диспетчер Иван', exact: true })).toBeVisible();
  await page.screenshot({ path: 'test-results/manager-users.png', fullPage: true });
});

test('partial assignment failure does not ask user to create the vehicle again', async ({ page }) => {
  await mockApi(page, true, false, true); await openManager(page); await createClient(page);
  await switchTab(page, 'Транспорт');
  await page.getByRole('button', { name: /Добавить транспорт/ }).click();
  const modal = page.getByRole('dialog');
  await modal.getByLabel('Название транспорта').fill('Без доступа');
  await modal.getByLabel('IMEI / ID терминала').fill('partial-001');
  await modal.getByLabel('Клиент — назначить доступ').selectOption({ label: 'ООО Север' });
  await modal.getByRole('button', { name: 'Сохранить', exact: true }).click();
  await expect(modal).toHaveCount(0);
  await expect(page.getByRole('status')).toContainText('Транспорт создан, но доступ клиенту не назначен');
  await expect(page.getByRole('button', { name: 'Выбрать Без доступа', exact: true })).toHaveCount(1);
});

test('customer directly enters read-only monitoring even on reload', async ({ page }) => {
  await mockApi(page, false); await login(page);
  await expect(page.getByRole('heading', { name: 'Выберите рабочий раздел' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Разделы', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /Газель А123ВС/ }).first()).toBeVisible();
  await expect(page.getByRole('button', { name: 'Добавить транспорт' })).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole('button', { name: /Газель А123ВС/ }).first()).toBeVisible();
  await expect(page.getByRole('button', { name: 'Разделы', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Выйти', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Вход в систему' })).toBeVisible();
});

test('administrator monitoring also has no creation controls', async ({ page }) => {
  await mockApi(page); await login(page);
  await page.getByRole('button', { name: /Открыть мониторинг/ }).click();
  await expect(page.getByRole('button', { name: /Газель А123ВС/ }).first()).toBeVisible();
  await expect(page.getByRole('button', { name: 'Добавить транспорт' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Разделы', exact: true }).click();
  await expect(page.getByRole('button', { name: /Открыть менеджер/ })).toBeVisible();
});

test('first start creates administrator before section choice', async ({ page }) => {
  await mockApi(page, true, true); await page.goto('/');
  await page.getByLabel('Ваше имя').fill('Владелец');
  await page.getByLabel('Email', { exact: true }).fill('admin@example.test');
  await page.getByLabel('Пароль', { exact: true }).fill('owner-password-123');
  await page.getByRole('button', { name: 'Создать и войти' }).click();
  await expect(page.getByRole('heading', { name: 'Выберите рабочий раздел' })).toBeVisible();
});
