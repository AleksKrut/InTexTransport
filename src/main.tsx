import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { createRoot } from 'react-dom/client';
import { api, ApiError, json } from './api';
import { FleetMap } from './Map';
import { Manager } from './Manager';
import { orderedRoute, routeQuery, speedKmh } from './domain.mjs';
import type { Config, Device, Position, Server, User } from './types';
import './style.css';

const formatTime = (value?: string) => value ? new Date(value).toLocaleString('ru-RU') : 'Нет данных';
const localInput = (date: Date) => new Date(+date - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
const statusLabel = (status: string) => status === 'online' ? 'На связи' : status === 'offline' ? 'Нет связи' : 'Ожидание';
const errorMessage = (error: unknown) => error instanceof Error ? error.message : 'Не удалось выполнить операцию.';

function Login({ server, onLogin, onCreated }: { server: Server; onLogin: (user: User) => void; onCreated: () => void }) {
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError('');
    const data = new FormData(event.currentTarget);
    const email = String(data.get('email')).trim(), password = String(data.get('password'));
    try {
      if (server.newServer) {
        await api('/users', json({ name: String(data.get('name')).trim(), email, password }));
        onCreated();
      }
      const user = await api<User>('/session', {
        method: 'POST', body: new URLSearchParams({ email, password }),
      });
      onLogin(user);
    } catch (e) { setError(e instanceof ApiError && e.status === 401 ? 'Неверный email или пароль.' : errorMessage(e)); }
    finally { setBusy(false); }
  }
  return <main className="login-shell"><section className="intro">
    <div className="brand"><span className="brand-icon">↗</span> ИнТехТранспорт</div>
    <div><p className="eyebrow">ВАШ ТРАНСПОРТ. ВАШ СЕРВЕР.</p><h1>Весь автопарк.<br />На одной карте.</h1>
    <p className="intro-text">Положение транспорта, история маршрутов и данные трекеров — в вашей локальной системе.</p></div>
    <small>Первая версия · локальное развёртывание</small>
  </section><section className="login-panel"><form onSubmit={submit} className="login-form">
    <p className="eyebrow">РАБОЧЕЕ МЕСТО ДИСПЕТЧЕРА</p>
    <h2>{server.newServer ? 'Настройка администратора' : 'Вход в систему'}</h2>
    <p className="muted">{server.newServer ? 'Создайте первую учётную запись владельца сервера.' : 'Используйте учётную запись вашего сервера.'}</p>
    {server.newServer && <label>Ваше имя<input name="name" autoComplete="name" required maxLength={100} /></label>}
    <label>Email<input name="email" type="email" autoComplete="username" required /></label>
    <label>Пароль<input name="password" type="password" autoComplete={server.newServer ? 'new-password' : 'current-password'} minLength={server.newServer ? 12 : 1} required /></label>
    {error && <p className="error" role="alert">{error}</p>}
    <button className="primary" disabled={busy}>{busy ? 'Подключение…' : server.newServer ? 'Создать и войти' : 'Войти в мониторинг'}</button>
    <small className="muted">Данные хранятся на вашем сервере. Фоновая карта может загружаться из интернета.</small>
  </form></section></main>;
}

function Dashboard({ user, config, server, onLogout, onBack }: { user: User; config: Config; server: Server; onLogout: () => void; onBack: () => void }) {
  const [devices, setDevices] = useState<Device[]>([]), [positions, setPositions] = useState<Position[]>([]);
  const [selected, setSelected] = useState<number | null>(null), [search, setSearch] = useState('');
  const [error, setError] = useState(''), [lastRefresh, setLastRefresh] = useState<string>();
  const [adding, setAdding] = useState(false), [saving, setSaving] = useState(false);
  const [route, setRoute] = useState<Position[] | null>(null), [routeBusy, setRouteBusy] = useState(false);
  const [routeMessage, setRouteMessage] = useState('');
  const routeRequest = useRef(0);
  const [from, setFrom] = useState(localInput(new Date(Date.now() - 3600000)));
  const [to, setTo] = useState(localInput(new Date()));
  const selectedDevice = devices.find(d => d.id === selected);
  const position = positions.find(p => p.deviceId === selected);
  const select = useCallback((id: number) => {
    routeRequest.current++; setRouteBusy(false); setSelected(id); setRoute(null); setRouteMessage('');
  }, []);
  const handleError = useCallback((e: unknown) => {
    if (e instanceof ApiError && e.status === 401) onLogout();
    else setError(errorMessage(e));
  }, [onLogout]);
  const refresh = useCallback(async () => {
    const [nextDevices, nextPositions] = await Promise.all([api<Device[]>('/devices?all=true'), api<Position[]>('/positions')]);
    setDevices(nextDevices); setPositions(nextPositions); setLastRefresh(new Date().toISOString()); setError('');
  }, []);
  useEffect(() => {
    let alive = true;
    let timer: ReturnType<typeof setTimeout>;
    const tick = async () => {
      try { if (alive) await refresh(); } catch (e) { if (alive) handleError(e); }
      if (alive) timer = setTimeout(tick, 5000);
    };
    void tick();
    return () => { alive = false; clearTimeout(timer); routeRequest.current++; };
  }, [refresh, handleError]);
  async function logout() {
    try { await api('/session', { method: 'DELETE' }); onLogout(); } catch (e) { handleError(e); }
  }
  async function addDevice(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setSaving(true); setError('');
    const data = new FormData(event.currentTarget);
    try {
      const device = await api<Device>('/devices', json({
        name: String(data.get('name')).trim(), uniqueId: String(data.get('uniqueId')).trim(),
      }));
      setAdding(false); select(device.id); await refresh();
    } catch (e) { handleError(e); } finally { setSaving(false); }
  }
  async function loadRoute(event: FormEvent) {
    event.preventDefault(); setError('');
    const requestId = ++routeRequest.current;
    setRouteBusy(true); setRoute(null); setRouteMessage('');
    try {
      const query = routeQuery(selected, from, to);
      const result = orderedRoute(await api<Position[]>('/positions?' + query)) as Position[];
      if (requestId !== routeRequest.current) return;
      setRoute(result); setRouteMessage(result.length ? 'Точек в маршруте: ' + result.length : 'За этот период координат нет.');
    } catch (e) { if (requestId === routeRequest.current) handleError(e); }
    finally { if (requestId === routeRequest.current) setRouteBusy(false); }
  }
  const visible = devices.filter(d => (d.name + ' ' + d.uniqueId).toLowerCase().includes(search.toLowerCase()));
  const online = devices.filter(d => d.status === 'online').length;
  const canAdd = user.administrator && !user.readonly && !user.deviceReadonly && !server.readonly && !server.deviceReadonly;
  return <div className="app">
    <header className="topbar"><div className="brand"><span className="brand-icon">↗</span>{config.title}<span className="local-tag">LOCAL</span></div>
      <div className="account"><span>{user.name}</span>{user.administrator && <button className="ghost" onClick={onBack}>Разделы</button>}<button className="ghost" onClick={logout}>Выйти</button></div></header>
    <div className="workspace"><aside className="sidebar">
      <div className="section-heading"><div><p className="eyebrow">ДИСПЕТЧЕРСКАЯ</p><h1>Транспорт <span>{devices.length}</span></h1></div>
        {canAdd && <button className="icon-button" onClick={() => setAdding(!adding)} aria-label="Добавить транспорт">+</button>}</div>
      <div className="stats"><div><strong>{online}</strong><span>На связи</span></div><div><strong>{devices.length - online}</strong><span>Ожидание / нет связи</span></div></div>
      {adding && <form className="add-form" onSubmit={addDevice}>
        <h3>Новый транспорт</h3>
        <label>Название<input name="name" placeholder="Газель · А123ВС" required maxLength={100} /></label>
        <label>IMEI / идентификатор<input name="uniqueId" placeholder="Точно как в настройках трекера" pattern=".*\S.*" required maxLength={128} /></label>
        <button className="primary" disabled={saving}>{saving ? 'Сохранение…' : 'Добавить'}</button>
      </form>}
      <label className="search"><span className="sr-only">Поиск транспорта</span><input placeholder="Название или IMEI" value={search} onChange={e => setSearch(e.target.value)} /></label>
      <div className="device-list">{visible.map(device => {
        const point = positions.find(p => p.deviceId === device.id);
        return <button key={device.id} className={'device-card' + (selected === device.id ? ' active' : '')} onClick={() => select(device.id)}>
          <div className="device-line"><strong>{device.name}</strong><span className={'status-dot ' + device.status} /></div>
          <span className="device-id">{device.uniqueId}</span>
          <div className="device-line"><span>{statusLabel(device.status)}</span><span>{point ? speedKmh(point.speed) ?? '—' : '—'} км/ч</span></div>
        </button>;
      })}
      {!visible.length && <div className="empty"><strong>{devices.length ? 'Ничего не найдено' : 'Добавьте первый транспорт'}</strong><p>{devices.length ? 'Измените поисковый запрос.' : 'Укажите название и идентификатор, затем направьте трекер на этот сервер.'}</p></div>}</div>
      <footer className="sidebar-footer">Обновление каждые 5 секунд<br />Последнее: {formatTime(lastRefresh)}</footer>
    </aside><main className="main">
      {error && <div className="error banner" role="alert">{error} Последние загруженные данные могут быть устаревшими.</div>}
      <FleetMap config={config} devices={devices} positions={positions} selected={selected} route={route} onSelect={select} />
      <section className="details">
        {selectedDevice ? <>
          <div className="detail-heading"><div><p className="eyebrow">ВЫБРАННЫЙ ОБЪЕКТ</p><h2>{selectedDevice.name}</h2></div><span className="badge">{statusLabel(selectedDevice.status)}</span></div>
          <div className="telemetry"><div><span>Скорость</span><strong>{position ? speedKmh(position.speed) ?? '—' : '—'} км/ч</strong></div>
            <div><span>Зажигание</span><strong>{position?.attributes.ignition === true ? 'Включено' : position?.attributes.ignition === false ? 'Выключено' : 'Нет данных'}</strong></div>
            <div><span>Время координат</span><strong>{formatTime(position?.fixTime)}</strong></div>
            <div><span>Последняя связь</span><strong>{formatTime(selectedDevice.lastUpdate)}</strong></div></div>
          <form className="route-form" onSubmit={loadRoute}><label>Начало периода<input type="datetime-local" required value={from} onChange={e => setFrom(e.target.value)} /></label>
            <label>Конец периода<input type="datetime-local" required value={to} onChange={e => setTo(e.target.value)} /></label>
            <button className="primary" disabled={routeBusy}>{routeBusy ? 'Загрузка…' : 'Показать маршрут'}</button>
            {route !== null && <button type="button" className="ghost" onClick={() => { routeRequest.current++; setRoute(null); setRouteMessage(''); }}>Текущая позиция</button>}
          </form><p className="muted route-message" role="status">{routeMessage || 'Время указано в часовом поясе вашего браузера. Период — до 7 дней.'}</p>
        </> : <div className="select-hint"><strong>Выберите транспорт на карте или в списке</strong><p>Здесь появятся показания трекера и история маршрута.</p></div>}
      </section>
    </main></div>
  </div>;
}

function App() {
  const [config, setConfig] = useState<Config>(), [server, setServer] = useState<Server>();
  const [user, setUser] = useState<User | null>(null), [loading, setLoading] = useState(true), [error, setError] = useState('');
  const [mode, setMode] = useState<'monitoring' | 'manager' | null>(null);
  const onLogout = useCallback(() => { setUser(null); setMode(null); }, []);
  async function boot() {
    setLoading(true); setError('');
    try {
      const response = await fetch('/config.json');
      if (!response.ok) throw new Error('Не удалось загрузить настройки сайта.');
      setConfig(await response.json());
      setServer(await api<Server>('/server'));
      try { setUser(await api<User>('/session')); }
      catch (e) {
        // Traccar returns 404 for GET /session when no user is signed in.
        if (e instanceof ApiError && (e.status === 401 || e.status === 404)) setUser(null);
        else throw e;
      }
    } catch (e) { setError(errorMessage(e)); } finally { setLoading(false); }
  }
  useEffect(() => { void boot(); }, []);
  if (loading) return <main className="loading">Подключаемся к серверу мониторинга…</main>;
  if (error || !config || !server) return <main className="loading"><h2>Нет соединения с сервером</h2><p>{error}</p><button className="primary" onClick={boot}>Повторить</button></main>;
  if (!user) return <Login server={server} onLogin={setUser} onCreated={() => setServer({ ...server, newServer: false })} />;
  if (mode === 'manager' && user.administrator) return <Manager user={user} onBack={() => setMode(null)} onLogout={onLogout} />;
  if (!user.administrator || mode === 'monitoring') return <Dashboard user={user} config={config} server={server} onLogout={onLogout} onBack={() => setMode(null)} />;
  return <main className="mode-shell"><div className="mode-content">
    <div className="brand"><span className="brand-icon">↗</span>{config.title}<span className="local-tag">LOCAL</span></div>
    <p className="eyebrow">ДОБРО ПОЖАЛОВАТЬ, {user.name}</p><h1>Выберите рабочий раздел</h1>
    <p className="muted">Наблюдайте за транспортом или управляйте доступом клиентов.</p>
    <div className="mode-grid"><button className="mode-card" onClick={() => setMode('monitoring')}>
      <span className="mode-symbol">↗</span><strong>Мониторинг</strong><span>Карта, транспорт, показания и история маршрутов.</span><b>Открыть мониторинг →</b>
    </button>{user.administrator && <button className="mode-card" onClick={() => setMode('manager')}>
      <span className="mode-symbol">☷</span><strong>Менеджер</strong><span>Клиенты, учётные записи и назначение транспорта.</span><b>Открыть менеджер →</b>
    </button>}</div>
    <button className="ghost" onClick={async () => { try { await api('/session', { method: 'DELETE' }); onLogout(); } catch (e) { setError(errorMessage(e)); } }}>Выйти из системы</button>
  </div></main>;
}
createRoot(document.getElementById('root')!).render(<App />);
