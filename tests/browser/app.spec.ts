import { expect, test, type Page } from '@playwright/test';

async function mockApi(page: Page, administrator = true, firstStart = false) {
  let signedIn = false;
  let isNew = firstStart;
  const admin = { id: 1, name: 'Администратор', email: 'admin@example.test', administrator,
    readonly: !administrator, deviceReadonly: !administrator };
  let clients: any[] = [];
  let assigned = false;
  const devices = [{ id: 1, name: 'Газель А123ВС', uniqueId: 'demo-001', status: 'online' }];
  await page.route('**/api/**', async route => {
    const request = route.request(), url = new URL(request.url());
    const path = url.pathname, method = request.method();
    const respond = (body: unknown, status = 200) => route.fulfill({
      status, contentType: 'application/json', body: JSON.stringify(body),
    });
    if (path === '/api/server') return respond({ newServer: isNew, registration: false });
    if (path === '/api/session') {
      if (method === 'POST') { signedIn = true; return respond(admin); }
      if (method === 'DELETE') { signedIn = false; return route.fulfill({ status: 204 }); }
      return signedIn ? respond(admin) : respond({}, 401);
    }
    if (path === '/api/users' && method === 'POST' && isNew) {
      isNew = false; return respond(admin);
    }
    if (!signedIn) return respond({}, 401);
    if (path === '/api/users') {
      if (method === 'GET') return respond([admin, ...clients]);
      const client = { id: 2, ...request.postDataJSON() };
      clients.push(client); return respond(client);
    }
    if (path === '/api/users/2' && method === 'PUT') {
      clients = [request.postDataJSON()]; return respond(clients[0]);
    }
    if (path === '/api/devices') {
      if (url.searchParams.has('userId')) return respond(assigned ? devices : []);
      return respond(devices);
    }
    if (path === '/api/permissions') {
      assigned = method === 'POST';
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

test('administrator chooses manager, creates customer and changes device access', async ({ page }) => {
  await mockApi(page);
  await login(page);
  await expect(page.getByRole('heading', { name: 'Выберите рабочий раздел' })).toBeVisible();
  await page.getByRole('button', { name: /Открыть менеджер/ }).click();
  await page.getByLabel('Компания / имя клиента').fill('ООО Север');
  await page.getByLabel('Email для входа').fill('fleet@example.test');
  await page.getByLabel('Первоначальный пароль').fill('customer-password-123');
  await page.getByRole('button', { name: 'Создать клиента' }).click();
  await expect(page.getByRole('heading', { name: 'ООО Север' })).toBeVisible();
  const assignment = page.getByRole('checkbox', { name: /Газель А123ВС/ });
  await assignment.click();
  await expect(assignment).toBeChecked();
  await expect(page.getByRole('status')).toContainText('предоставлен');
  await assignment.click();
  await expect(page.getByRole('status')).toContainText('снят');
  await page.getByRole('button', { name: 'Заблокировать клиента' }).click();
  await expect(page.getByRole('button', { name: 'Разблокировать клиента' })).toBeVisible();
  await page.screenshot({ path: 'test-results/manager.png', fullPage: true });
  await page.getByRole('button', { name: 'Выбор раздела' }).click();
  await page.screenshot({ path: 'test-results/sections.png', fullPage: true });
});

test('customer sees monitoring only, and cannot add devices in UI', async ({ page }) => {
  await mockApi(page, false);
  await login(page);
  await expect(page.getByRole('button', { name: /Открыть менеджер/ })).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Выберите рабочий раздел' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Разделы', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /Газель А123ВС/ }).first()).toBeVisible();
  await expect(page.getByRole('button', { name: 'Добавить транспорт' })).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole('button', { name: /Газель А123ВС/ }).first()).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Выберите рабочий раздел' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Разделы', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Выйти', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Вход в систему' })).toBeVisible();
});

test('first start creates the administrator before choosing a section', async ({ page }) => {
  await mockApi(page, true, true);
  await page.goto('/');
  await page.getByLabel('Ваше имя').fill('Владелец');
  await page.getByLabel('Email', { exact: true }).fill('admin@example.test');
  await page.getByLabel('Пароль', { exact: true }).fill('owner-password-123');
  await page.getByRole('button', { name: 'Создать и войти' }).click();
  await expect(page.getByRole('heading', { name: 'Выберите рабочий раздел' })).toBeVisible();
});
