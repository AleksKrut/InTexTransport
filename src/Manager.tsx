import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { api, ApiError, json } from './api';
import { accountKind, accountPermissions, clientIdOf, roleLabel } from './management';
import type { Device, User } from './types';
import './manager.css';

type Tab = 'clients' | 'users' | 'vehicles';
type Editor = { type: 'client' | 'user'; item?: User } | { type: 'vehicle'; item?: Device };
type Links = Record<number, number[]>;
const tabs: { key: Tab; label: string }[] = [
  { key: 'clients', label: 'Клиенты' }, { key: 'users', label: 'Пользователи' }, { key: 'vehicles', label: 'Транспорт' },
];
const time = (value?: string) => value ? new Date(value).toLocaleString('ru-RU') : 'Сообщений ещё нет';
const status = (value: string) => value === 'online' ? 'На связи' : value === 'offline' ? 'Нет связи' : 'Ожидание';
const field = (data: FormData, key: string) => String(data.get(key) ?? '').trim();

function Modal({ title, busy, close, children }: { title: string; busy: boolean; close: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => { ref.current?.showModal(); }, []);
  return <dialog ref={ref} className="manage-dialog" aria-label={title}
    onCancel={e => { e.preventDefault(); if (!busy) close(); }}>
    <div className="dialog-heading"><h2>{title}</h2><button type="button" className="ghost" aria-label="Закрыть окно" disabled={busy} onClick={close}>×</button></div>
    {children}
  </dialog>;
}

export function Manager({ user, onBack, onLogout }: { user: User; onBack: () => void; onLogout: () => void }) {
  const [users, setUsers] = useState<User[]>([]), [devices, setDevices] = useState<Device[]>([]);
  const [links, setLinks] = useState<Links>({});
  const [tab, setTab] = useState<Tab>('clients');
  const [clientFilter, setClientFilter] = useState<number | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const [search, setSearch] = useState(''), [treeSearch, setTreeSearch] = useState('');
  const [page, setPage] = useState(1);
  const [busy, setBusy] = useState(false), [loading, setLoading] = useState(true);
  const [error, setError] = useState(''), [notice, setNotice] = useState('');
  const [editor, setEditor] = useState<Editor | null>(null);
  const [role, setRole] = useState('observer');
  const [accessUser, setAccessUser] = useState<User | null>(null);
  const [accessSearch, setAccessSearch] = useState('');
  const [refreshKey, setRefreshKey] = useState(0);
  const clients = users.filter(u => accountKind(u) === 'client');
  const activeClient = clients.find(c => c.id === clientFilter);
  const selectedUser = users.find(u => u.id === selected);
  const selectedDevice = devices.find(d => d.id === selected);
  const fail = useCallback((e: unknown) => {
    if (e instanceof ApiError && e.status === 401) onLogout();
    else setError(e instanceof Error ? e.message : 'Не удалось выполнить операцию.');
  }, [onLogout]);
  const fetchSnapshot = useCallback(async () => {
    const [accounts, objects] = await Promise.all([api<User[]>('/users'), api<Device[]>('/devices?all=true')]);
    const access: Links = {};
    const viewers = accounts.filter(account => !account.administrator);
    for (let i = 0; i < viewers.length; i += 4) {
      await Promise.all(viewers.slice(i, i + 4).map(async account => {
        access[account.id] = (await api<Device[]>('/devices?userId=' + account.id)).map(device => device.id);
      }));
    }
    return { accounts, objects, access };
  }, []);
  const applySnapshot = useCallback((snapshot: Awaited<ReturnType<typeof fetchSnapshot>>) => {
    setUsers(snapshot.accounts); setDevices(snapshot.objects); setLinks(snapshot.access);
  }, []);
  useEffect(() => {
    if (!user.administrator) { setLoading(false); return; }
    let active = true;
    setLoading(true); setError('');
    fetchSnapshot().then(snapshot => { if (active) applySnapshot(snapshot); })
      .catch(e => { if (active) fail(e); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [fetchSnapshot, applySnapshot, fail, refreshKey, user.administrator]);
  useEffect(() => { setPage(1); setSelected(null); }, [tab, search, clientFilter]);

  function openEditor(type: Editor['type'], item?: User | Device) {
    setError(''); setNotice(''); setEditor({ type, item } as Editor);
    setRole(item && 'administrator' in item && item.administrator ? 'manager' : 'observer');
  }
  async function refresh() { applySnapshot(await fetchSnapshot()); }
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editor) return;
    setBusy(true); setError(''); setNotice('');
    const data = new FormData(event.currentTarget);
    let saved = false;
    try {
      if (editor.type === 'vehicle') {
        const current = editor.item;
        const payload = { ...(current ?? {}), name: field(data, 'name'), uniqueId: field(data, 'uniqueId'),
          model: field(data, 'model'), phone: field(data, 'phone'),
          attributes: { ...(current?.attributes ?? {}), intehPlate: field(data, 'plate'), intehProtocol: field(data, 'protocol') } };
        if (!payload.name || !payload.uniqueId) throw new Error('Заполните название и идентификатор терминала.');
        const device = await api<Device>(current ? '/devices/' + current.id : '/devices', { ...json(payload), method: current ? 'PUT' : 'POST' });
        saved = true; setEditor(null); setSelected(device.id);
        const targetClient = Number(data.get('clientId'));
        if (!current && targetClient) {
          try { await api('/permissions', json({ userId: targetClient, deviceId: device.id })); }
          catch {
            setNotice('Транспорт создан, но доступ клиенту не назначен. Выберите клиента и нажмите «Доступ к транспорту».');
            await refresh(); return;
          }
        }
        setNotice(current ? 'Карточка транспорта сохранена.' : 'Транспорт добавлен. Настройте терминал на адрес сервера и порт его протокола.');
      } else {
        const current = editor.item, isClient = editor.type === 'client';
        const isManager = !isClient && role === 'manager';
        const attributes = { ...(current?.attributes ?? {}) };
        if (isClient) {
          Object.assign(attributes, { intehAccountType: 'client', intehInn: field(data, 'inn'),
            intehContact: field(data, 'contact'), intehPhone: field(data, 'phone') });
        } else {
          Object.assign(attributes, { intehAccountType: isManager ? 'manager' : 'observer',
            intehClientId: isManager ? 0 : Number(data.get('clientId')) || 0 });
        }
        const payload: Record<string, unknown> = {
          ...(current ?? {}), name: field(data, 'name'), email: field(data, 'email'),
          attributes, ...accountPermissions(isManager),
        };
        if (current?.id === user.id) Object.assign(payload, accountPermissions(true));
        const password = String(data.get('password') ?? '');
        if (password) payload.password = password; else delete payload.password;
        if (!payload.name) throw new Error('Введите название или имя.');
        await api<User>(current ? '/users/' + current.id : '/users', { ...json(payload), method: current ? 'PUT' : 'POST' });
        saved = true; setEditor(null);
        setNotice(current ? 'Учётная запись сохранена.' : isClient
          ? 'Клиент создан. Назначьте ему машины кнопкой «Доступ к транспорту».'
          : isManager ? 'Менеджер создан. Ему доступны все клиенты и транспорт.'
          : 'Наблюдатель создан. Назначьте ему транспорт отдельно; выбор клиента служит для группировки.');
      }
      await refresh();
    } catch (e) {
      if (saved) setNotice('Данные сохранены, но список не обновился. Нажмите «Обновить».');
      fail(e);
    } finally { setBusy(false); }
  }
  async function toggleAccess(deviceId: number, enabled: boolean) {
    if (!accessUser) return;
    setBusy(true); setError('');
    try {
      await api('/permissions', { ...json({ userId: accessUser.id, deviceId }), method: enabled ? 'POST' : 'DELETE' });
      setLinks(current => ({ ...current, [accessUser.id]: enabled
        ? [...(current[accessUser.id] ?? []), deviceId] : (current[accessUser.id] ?? []).filter(id => id !== deviceId) }));
      setNotice(enabled ? 'Доступ предоставлен.' : 'Прямой доступ снят.');
    } catch (e) { fail(e); } finally { setBusy(false); }
  }
  async function toggleDisabled() {
    if (!selectedUser || selectedUser.id === user.id) return;
    setBusy(true); setError(''); setNotice('');
    try {
      await api('/users/' + selectedUser.id, { ...json({ ...selectedUser, disabled: !selectedUser.disabled }), method: 'PUT' });
      setNotice(selectedUser.disabled ? 'Учётная запись разблокирована.' : 'Учётная запись заблокирована.');
      await refresh();
    } catch (e) { fail(e); } finally { setBusy(false); }
  }
  const filtered = (tab === 'vehicles' ? devices : tab === 'clients' ? clients : users).filter(item => {
    if (clientFilter) {
      if (tab === 'vehicles' && !(links[clientFilter] ?? []).includes(item.id)) return false;
      if (tab !== 'vehicles' && clientIdOf(item as User) !== clientFilter) return false;
    }
    const text = tab === 'vehicles'
      ? [item.name, (item as Device).uniqueId, (item as Device).model, (item as Device).attributes?.intehPlate]
      : [item.name, (item as User).email, (item as User).attributes?.intehInn];
    return text.join(' ').toLowerCase().includes(search.toLowerCase());
  });
  const pageCount = Math.max(1, Math.ceil(filtered.length / 20)), currentPage = Math.min(page, pageCount);
  const rows = filtered.slice((currentPage - 1) * 20, currentPage * 20);
  const selectClient = (id: number | null) => { setClientFilter(id); setSearch(''); setSelected(null); };
  const assignedNames = (id: number) => clients.filter(c => links[c.id]?.includes(id)).map(c => c.name).join(', ') || 'Не назначен';
  const editorUser = editor?.type === 'client' || editor?.type === 'user' ? editor.item : undefined;
  const editorDevice = editor?.type === 'vehicle' ? editor.item : undefined;
  const title = editor ? (editor.item ? 'Редактирование: ' : 'Создание: ') +
    (editor.type === 'client' ? 'клиент' : editor.type === 'user' ? 'пользователь' : 'транспорт') : '';
  if (!user.administrator) return <main className="loading">Этот раздел доступен только менеджеру системы.</main>;

  return <div className="management">
    <header className="topbar"><div className="brand"><span className="brand-icon">↗</span>ИнТехТранспорт <span className="local-tag">МЕНЕДЖЕР</span></div>
      <div className="account"><span>{user.name}</span><button className="ghost" onClick={onBack}>Выбор раздела</button></div></header>
    <div className="management-layout">
      <aside className="client-tree">
        <div className="tree-heading"><h2>Клиенты</h2><button className="icon-button" aria-label="Создать клиента" disabled={loading || busy} onClick={() => openEditor('client')}>+</button></div>
        <input aria-label="Поиск клиента" placeholder="Поиск клиента…" value={treeSearch} onChange={e => setTreeSearch(e.target.value)} />
        <button className={'tree-row tree-root' + (clientFilter === null ? ' chosen' : '')} onClick={() => selectClient(null)}>
          <span>▦ Все клиенты</span><b>{clients.length}</b></button>
        <div className="tree-items">{clients.filter(c => c.name.toLowerCase().includes(treeSearch.toLowerCase())).map(client =>
          <button className={'tree-row' + (clientFilter === client.id ? ' chosen' : '')} key={client.id} onClick={() => selectClient(client.id)}>
            <span><i className={'status-dot ' + (client.disabled ? 'offline' : 'online')} />{client.name}</span><b>{links[client.id]?.length ?? 0}</b>
          </button>)}
          {!loading && !clients.length && <p className="muted tree-empty">Создайте клиента кнопкой «+». Затем добавьте транспорт и назначьте доступ.</p>}
        </div>
        <div className="tree-footer"><strong>{devices.length} объектов</strong><span>{users.length} учётных записей</span></div>
      </aside>
      <main className="management-main">
        <nav className="manage-tabs" aria-label="Разделы менеджера">{tabs.map(item =>
          <button key={item.key} aria-current={tab === item.key ? 'page' : undefined} onClick={() => { setTab(item.key); setSearch(''); }}>
            {item.label}<span>{item.key === 'clients' ? clients.length : item.key === 'users' ? users.length : devices.length}</span></button>)}</nav>
        <div className="manage-context"><div><p className="eyebrow">МЕНЕДЖЕР / {activeClient?.name ?? 'ВСЕ КЛИЕНТЫ'}</p>
          <h1>{tabs.find(t => t.key === tab)?.label}</h1></div>{activeClient && <button className="ghost" onClick={() => selectClient(null)}>Сбросить клиента</button>}</div>
        <div className="manage-toolbar">
          <button className="primary" disabled={busy || loading} onClick={() => openEditor(tab === 'clients' ? 'client' : tab === 'users' ? 'user' : 'vehicle')}>
            + {tab === 'clients' ? 'Создать клиента' : tab === 'users' ? 'Создать пользователя' : 'Добавить транспорт'}</button>
          <button disabled={!selected || busy || loading} onClick={() => openEditor(tab === 'vehicles' ? 'vehicle' : tab === 'clients' || (selectedUser && accountKind(selectedUser) === 'client') ? 'client' : 'user', tab === 'vehicles' ? selectedDevice : selectedUser)}>Редактировать</button>
          {tab !== 'vehicles' && <><button disabled={!selectedUser || selectedUser.administrator || busy || loading} onClick={() => { setAccessUser(selectedUser!); setAccessSearch(''); setError(''); setNotice(''); }}>Доступ к транспорту</button>
            <button disabled={!selectedUser || selectedUser.id === user.id || busy || loading} onClick={toggleDisabled}>{selectedUser?.disabled ? 'Разблокировать' : 'Заблокировать'}</button></>}
          <button disabled={busy || loading} onClick={() => setRefreshKey(key => key + 1)}>Обновить</button>
          <input aria-label="Поиск в таблице" placeholder={tab === 'vehicles' ? 'Название, госномер, IMEI…' : 'Название, email, ИНН…'} value={search} onChange={e => setSearch(e.target.value)} />
        </div>
        {error && !editor && !accessUser && <p className="error manage-message" role="alert">{error}</p>}
        {notice && !editor && !accessUser && <p className="success manage-message" role="status">{notice}</p>}
        <div className="manage-table-wrap" aria-busy={loading}><table className="manage-table">
          <thead><tr><th>№</th><th>Состояние</th><th>{tab === 'vehicles' ? 'Объект мониторинга' : tab === 'clients' ? 'Клиент' : 'Имя'}</th>
            {tab === 'vehicles' ? <><th>Госномер</th><th>IMEI / ID терминала</th><th>Модель</th><th>Протокол</th><th>Клиенты с доступом</th><th>Последняя связь</th></>
              : tab === 'clients' ? <><th>ИНН</th><th>Email для входа</th><th>Контакт</th><th>Телефон</th><th>Объекты</th></>
                : <><th>Email для входа</th><th>Роль</th><th>Клиент</th><th>Объекты</th></>}</tr></thead>
          <tbody>{!loading && rows.map((item, index) => {
            const account = item as User, device = item as Device;
            return <tr key={item.id} className={selected === item.id ? 'selected-row' : ''} onClick={() => setSelected(item.id)}>
              <td>{(currentPage - 1) * 20 + index + 1}</td>
              <td><span className={'table-status ' + (tab === 'vehicles' ? device.status === 'online' ? 'good' : 'quiet' : account.disabled ? 'quiet' : 'good')}>{tab === 'vehicles' ? status(device.status) : account.disabled ? 'Заблокирован' : 'Активен'}</span></td>
              <td><button className="table-name" aria-label={'Выбрать ' + item.name} aria-pressed={selected === item.id} onClick={() => setSelected(item.id)}>{item.name}</button></td>
              {tab === 'vehicles' ? <><td>{String(device.attributes?.intehPlate || '—')}</td><td className="mono">{device.uniqueId}</td><td>{device.model || '—'}</td><td>{String(device.attributes?.intehProtocol || 'Не указан')}</td><td>{assignedNames(device.id)}</td><td>{time(device.lastUpdate)}</td></>
                : tab === 'clients' ? <><td>{String(account.attributes?.intehInn || '—')}</td><td>{account.email}</td><td>{String(account.attributes?.intehContact || '—')}</td><td>{String(account.attributes?.intehPhone || '—')}</td><td>{links[account.id]?.length ?? 0}</td></>
                  : <><td>{account.email}</td><td>{roleLabel(account)}</td><td>{clients.find(c => c.id === clientIdOf(account))?.name || '—'}</td><td>{account.administrator ? 'Все' : links[account.id]?.length ?? 0}</td></>}
            </tr>;
          })}</tbody>
        </table>{loading && <div className="table-empty">Загружаем клиентов, транспорт и права…</div>}
          {!loading && !rows.length && <div className="table-empty"><strong>Записей пока нет</strong><p>Измените фильтр или воспользуйтесь кнопкой создания над таблицей.</p></div>}</div>
        <footer className="table-footer"><span>Записей: {filtered.length}{selected ? ' · Строка выбрана' : ' · Выберите строку для действий'}</span>
          <div><button disabled={currentPage === 1} onClick={() => setPage(currentPage - 1)}>←</button><span>{currentPage} / {pageCount}</span><button disabled={currentPage >= pageCount} onClick={() => setPage(currentPage + 1)}>→</button></div></footer>
        <p className="manager-help">{tab === 'vehicles' ? 'Протокол в карточке — настройка учёта. Порт приёма включается в мастере установки. Координаты появятся после подключения терминала.'
          : 'Клиент содержит основную учётную запись компании. Дополнительных наблюдателей создавайте в «Пользователях» и назначайте им транспорт отдельно.'}</p>
      </main>
    </div>
    {editor && <Modal title={title} busy={busy} close={() => { setEditor(null); setError(''); }}>
      <form className="manager-form" onSubmit={save}>
        <div className="form-grid">
          <label className="full-width">{editor.type === 'client' ? 'Название клиента / компании' : editor.type === 'user' ? 'Имя пользователя' : 'Название транспорта'}
            <input name="name" required maxLength={100} defaultValue={editor.item?.name} autoFocus /></label>
          {editor.type === 'vehicle' ? <>
            <label>Госномер<input name="plate" defaultValue={String(editorDevice?.attributes?.intehPlate ?? '')} maxLength={30} /></label>
            <label>IMEI / ID терминала<input name="uniqueId" required maxLength={128} defaultValue={editorDevice?.uniqueId} /></label>
            <label>Модель терминала<input name="model" placeholder="Например, NAVTELECOM SMART…" defaultValue={editorDevice?.model} maxLength={100} /></label>
            <label>SIM / телефон терминала<input name="phone" defaultValue={editorDevice?.phone} maxLength={40} /></label>
            <label>Протокол терминала<select name="protocol" defaultValue={String(editorDevice?.attributes?.intehProtocol ?? '')}>
              <option value="">Выбрать позже</option><option value="EGTS">EGTS</option><option value="FLEX / NAVTELECOM">FLEX / NAVTELECOM</option><option value="Teltonika">Teltonika</option><option value="Wialon IPS">Wialon IPS</option><option value="OsmAnd">OsmAnd</option><option value="Другой">Другой</option>
            </select></label>
            {!editorDevice && <label>Клиент — назначить доступ<select name="clientId" defaultValue={clientFilter ?? ''}><option value="">Без назначения</option>{clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>}
          </> : <>
            {editor.type === 'client' && <><label>ИНН<input name="inn" inputMode="numeric" pattern="([0-9]{10}|[0-9]{12})?" title="10 или 12 цифр" defaultValue={String(editorUser?.attributes?.intehInn ?? '')} /></label>
              <label>Контактное лицо<input name="contact" defaultValue={String(editorUser?.attributes?.intehContact ?? '')} maxLength={100} /></label>
              <label>Контактный телефон<input name="phone" defaultValue={String(editorUser?.attributes?.intehPhone ?? '')} maxLength={40} /></label></>}
            <label>Email для входа<input name="email" type="email" required defaultValue={editorUser?.email} autoComplete="off" /></label>
            <label>{editorUser ? 'Новый пароль (необязательно)' : 'Первоначальный пароль'}<input name="password" type="password" minLength={12} required={!editorUser} autoComplete="new-password" /></label>
            {editor.type === 'user' && <><label>Роль<select name="role" aria-label="Роль" value={role} disabled={editorUser?.id === user.id} onChange={e => setRole(e.target.value)}>
              <option value="observer">Наблюдатель</option><option value="manager">Менеджер системы — полный доступ</option>
            </select></label>
              {role !== 'manager' && <label>Клиент<select name="clientId" aria-label="Клиент" defaultValue={editorUser ? clientIdOf(editorUser) ?? '' : clientFilter ?? ''}><option value="">Без клиента</option>{clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>}</>}
          </>}
        </div>
        <div className="form-note">{editor.type === 'vehicle' ? 'ID должен совпадать с идентификатором в терминале. Выбор протокола здесь не открывает порт сервера. Доступ другим пользователям выдаётся через их карточки.'
          : role === 'manager' && editor.type === 'user' ? 'Менеджер системы получает полный доступ: все клиенты, пользователи, транспорт и настройки.'
            : 'Эта учётная запись предназначена только для наблюдения. Машины назначаются через «Доступ к транспорту»; принадлежность клиенту сама по себе не даёт прав.'}</div>
        {error && <p className="error" role="alert">{error}</p>}
        <div className="form-actions"><button type="button" className="ghost" disabled={busy} onClick={() => setEditor(null)}>Отмена</button><button className="primary" disabled={busy}>{busy ? 'Сохранение…' : 'Сохранить'}</button></div>
      </form>
    </Modal>}
    {accessUser && <Modal title={'Доступ к транспорту: ' + accessUser.name} busy={busy} close={() => { setAccessUser(null); setError(''); }}>
      <p className="muted">Отметьте машины для этой учётной записи. Каждое изменение сохраняется сразу.</p>
      <input aria-label="Поиск транспорта для доступа" placeholder="Название или IMEI…" value={accessSearch} onChange={e => setAccessSearch(e.target.value)} />
      {error && <p className="error" role="alert">{error}</p>}{notice && <p className="success" role="status">{notice}</p>}
      <div className="access-list">{devices.filter(d => (d.name + ' ' + d.uniqueId).toLowerCase().includes(accessSearch.toLowerCase())).map(device =>
        <label className="assignment" key={device.id}><input type="checkbox" disabled={busy} checked={(links[accessUser.id] ?? []).includes(device.id)}
          onChange={e => toggleAccess(device.id, e.target.checked)} /><span><strong>{device.name}</strong><small>{device.uniqueId}</small></span></label>)}
        {!devices.length && <p className="muted">Добавьте машины во вкладке «Транспорт».</p>}</div>
      <p className="muted">Здесь показаны прямые назначения. Если доступ выдан через группы в штатном Traccar, управлять такими связями нужно там же.</p>
      <div className="form-actions"><button className="primary" disabled={busy} onClick={() => setAccessUser(null)}>Готово</button></div>
    </Modal>}
  </div>;
}
