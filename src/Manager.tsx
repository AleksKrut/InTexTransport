import { useEffect, useState, type FormEvent } from 'react';
import { api, ApiError, json } from './api';
import type { Device, User } from './types';

export function Manager({ user, onBack, onLogout }: {
  user: User; onBack: () => void; onLogout: () => void;
}) {
  const [clients, setClients] = useState<User[]>([]), [devices, setDevices] = useState<Device[]>([]);
  const [selected, setSelected] = useState<User | null>(null), [assigned, setAssigned] = useState<number[]>([]);
  const [loading, setLoading] = useState(true), [linksLoading, setLinksLoading] = useState(false);
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState('');
  const [search, setSearch] = useState('');
  function fail(e: unknown) {
    if (e instanceof ApiError && e.status === 401) onLogout();
    else setError(e instanceof Error ? e.message : 'Не удалось выполнить операцию.');
  }
  async function refresh() {
    const [users, objects] = await Promise.all([api<User[]>('/users'), api<Device[]>('/devices?all=true')]);
    setClients(users.filter(item => !item.administrator));
    setDevices(objects);
  }
  useEffect(() => { void refresh().catch(fail).finally(() => setLoading(false)); }, []);
  useEffect(() => {
    let active = true;
    setAssigned([]); setLinksLoading(!!selected);
    if (selected) {
      api<Device[]>('/devices?userId=' + selected.id)
        .then(items => { if (active) setAssigned(items.map(item => item.id)); })
        .catch(e => { if (active) { fail(e); setSelected(null); } })
        .finally(() => { if (active) setLinksLoading(false); });
    }
    return () => { active = false; };
  }, [selected?.id]);
  async function createClient(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError(''); setNotice('');
    const form = event.currentTarget, data = new FormData(form);
    try {
      const client = await api<User>('/users', json({
        name: String(data.get('name')).trim(), email: String(data.get('email')).trim(),
        password: String(data.get('password')), administrator: false,
        readonly: true, deviceReadonly: true, userLimit: 0, deviceLimit: 0,
        limitCommands: true, fixedEmail: true,
      }));
      form.reset(); await refresh(); setSelected(client);
      setNotice('Клиент создан. Теперь назначьте ему транспорт. Передайте пароль клиенту отдельно.');
    } catch (e) { fail(e); } finally { setBusy(false); }
  }
  async function toggleDevice(deviceId: number, enabled: boolean) {
    if (!selected) return;
    setBusy(true); setError(''); setNotice('');
    try {
      await api('/permissions', { ...json({ userId: selected.id, deviceId }), method: enabled ? 'POST' : 'DELETE' });
      setAssigned(current => enabled ? [...current, deviceId] : current.filter(id => id !== deviceId));
      setNotice(enabled ? 'Доступ к транспорту предоставлен.' : 'Прямой доступ к транспорту снят.');
    } catch (e) { fail(e); } finally { setBusy(false); }
  }
  async function setDisabled() {
    if (!selected) return;
    setBusy(true); setError(''); setNotice('');
    try {
      const updated = await api<User>('/users/' + selected.id, {
        ...json({ ...selected, disabled: !selected.disabled }), method: 'PUT',
      });
      setSelected(updated); await refresh();
      setNotice(updated.disabled ? 'Учётная запись заблокирована.' : 'Учётная запись включена.');
    } catch (e) { fail(e); } finally { setBusy(false); }
  }
  if (!user.administrator) return <main className="loading">Этот раздел доступен только администратору.</main>;
  return <div className="manager-shell"><header className="topbar">
    <div className="brand"><span className="brand-icon">↗</span>Менеджер<span className="local-tag">LOCAL</span></div>
    <button className="ghost" onClick={onBack}>Выбор раздела</button></header>
    <main className="manager-content"><div className="manager-title"><div><p className="eyebrow">УПРАВЛЕНИЕ ДОСТУПОМ</p>
      <h1>Клиенты и транспорт</h1><p className="muted">Создавайте учётные записи и назначайте машины для просмотра.</p></div>
      <span className="badge">Клиентов: {clients.length}</span></div>
      {error && <p className="error" role="alert">{error}</p>}
      {notice && <p className="success" role="status">{notice}</p>}
      <div className="manager-grid"><section className="manager-card">
        <h2>Новый клиент</h2><form className="client-form" onSubmit={createClient}>
          <label>Компания / имя клиента<input name="name" required maxLength={100} /></label>
          <label>Email для входа<input name="email" type="email" autoComplete="off" required /></label>
          <label>Первоначальный пароль<input name="password" type="password" autoComplete="new-password" minLength={12} required /></label>
          <p className="muted">Клиент сможет просматривать назначенный транспорт и маршруты. Управление клиентами, изменение машин и команды трекерам недоступны.</p>
          <button className="primary" disabled={busy}>Создать клиента</button>
        </form></section><section className="manager-card">
        <h2>Клиенты</h2><input aria-label="Поиск клиента" placeholder="Название или email" value={search} onChange={e => setSearch(e.target.value)} />
        <div className="client-list">{loading ? <p className="muted">Загрузка…</p> : clients.filter(c => (c.name + ' ' + c.email).toLowerCase().includes(search.toLowerCase())).map(client =>
          <button className={'client-row' + (client.id === selected?.id ? ' active' : '')} key={client.id} disabled={busy} onClick={() => { setSelected(client); setError(''); setNotice(''); }}>
            <strong>{client.name}</strong><span>{client.email}</span><small>{client.disabled ? 'Заблокирован' : 'Активен'}</small>
          </button>)}
          {!loading && !clients.length && <p className="muted">Создайте первую учётную запись клиента.</p>}</div>
      </section><section className="manager-card assignments">
        <h2>{selected ? selected.name : 'Доступ к транспорту'}</h2>
        {selected ? <><p className="muted">{selected.email}</p>
          <button className="ghost" disabled={busy || linksLoading} onClick={setDisabled}>{selected.disabled ? 'Разблокировать клиента' : 'Заблокировать клиента'}</button>
          <h3>Назначенный транспорт</h3>
          <p className="muted">Каждое изменение сохраняется сразу.</p>
          {linksLoading ? <p className="muted">Загружаем права…</p> : devices.map(device =>
            <label className="assignment" key={device.id}><input type="checkbox" disabled={busy} checked={assigned.includes(device.id)}
              onChange={e => toggleDevice(device.id, e.target.checked)} /><span><strong>{device.name}</strong><small>{device.uniqueId}</small></span></label>)}
          {!devices.length && <p className="muted">Сначала добавьте транспорт в разделе мониторинга.</p>}
          <p className="muted footnote">Здесь управляются прямые назначения. Если вы настроили доступ через группы в штатном интерфейсе Traccar, снимайте его там же.</p>
        </> : <p className="muted">Выберите клиента, чтобы назначить ему машины.</p>}
      </section></div>
    </main></div>;
}
