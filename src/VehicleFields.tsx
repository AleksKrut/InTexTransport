import { useEffect, useState } from 'react';
import { api } from './api';
import type { Device, Position } from './types';
import { sensorsFrom, sensorValue, type Sensor } from './sensors';

interface Catalog { protocols: { id: string; label: string; port: number; transport: string }[]; models: { name: string; manufacturer: string; protocol: string }[] }
interface Connection { configured: boolean; host?: string; localHost?: string; protocols?: string[] }
export function VehicleFields({ device }: { device?: Device }) {
  const attrs = device?.attributes ?? {};
  const [catalog, setCatalog] = useState<Catalog>();
  const [connection, setConnection] = useState<Connection>();
  const [message, setMessage] = useState('');
  const [model, setModel] = useState(device?.model ?? '');
  const [manufacturer, setManufacturer] = useState(String(attrs.intehManufacturer ?? ''));
  const legacy: Record<string, string> = { EGTS: 'egts', 'FLEX / NAVTELECOM': 'navis', Teltonika: 'teltonika', 'Wialon IPS': 'wialon', OsmAnd: 'osmand' };
  const oldProtocol = String(attrs.intehProtocol ?? '');
  const [protocol, setProtocol] = useState(legacy[oldProtocol] ?? oldProtocol);
  const [tab, setTab] = useState('terminal');
  const [sensors, setSensors] = useState<Sensor[]>(() => sensorsFrom(attrs.intehSensors));
  const [position, setPosition] = useState<Position>();
  useEffect(() => {
    let active = true;
    Promise.all([fetch('/equipment.json').then(r => { if (!r.ok) throw Error(); return r.json(); }),
      fetch('/connection.json', { cache: 'no-store' }).then(r => { if (!r.ok) throw Error(); return r.json(); })])
      .then(([c, endpoint]) => { if (active) { setCatalog(c); setConnection(endpoint); } })
      .catch(() => { if (active) setMessage('Не удалось загрузить каталог или настройки подключения. Закройте карточку и повторите.'); });
    if (device) api<Position[]>('/positions').then(rows => { if (active) setPosition(rows.find(p => p.deviceId === device.id)); })
      .catch(() => { if (active) setMessage('Последние параметры не загружены. Настройки датчиков сохранены в карточке.'); });
    return () => { active = false; };
  }, [device?.id]);
  const chosen = catalog?.protocols.find(p => p.id === protocol);
  const enabled = connection?.configured && connection.protocols?.includes(protocol);
  const patchSensor = (id: string, patch: Partial<Sensor>) => setSensors(rows => rows.map(s => s.id === id ? { ...s, ...patch } : s));
  return <>
    <label>Госномер<input name="plate" defaultValue={String(attrs.intehPlate ?? '')} maxLength={30} /></label>
    <label>IMEI / ID терминала<input name="uniqueId" required maxLength={128} defaultValue={device?.uniqueId} /></label>
    <label>Тип транспорта<select name="vehicleType" defaultValue={String(attrs.intehVehicleType ?? '')}><option value="">Не указан</option>{['Легковой автомобиль', 'Грузовой автомобиль', 'Автобус', 'Спецтехника', 'Прицеп', 'Другой'].map(v => <option key={v}>{v}</option>)}</select></label>
    <label>Подразделение<input name="department" defaultValue={String(attrs.intehDepartment ?? '')} maxLength={100} /></label>
    <div className="vehicle-tabs full-width" role="tablist" aria-label="Настройки транспорта">{[['terminal', 'Терминал'], ['sensors', 'Датчики'], ['settings', 'Настройки']].map(([key, label]) => <button type="button" role="tab" aria-selected={tab === key} key={key} onClick={() => setTab(key)}>{label}{key === 'sensors' ? ` (${sensors.length})` : ''}</button>)}</div>
    <input type="hidden" name="sensors" value={JSON.stringify(sensors)} />
    <div className="full-width form-grid" hidden={tab !== 'terminal'}>
      <label>Производитель<select aria-label="Производитель" name="manufacturer" value={manufacturer} onChange={e => { setManufacturer(e.target.value); setModel(''); setProtocol(''); }}><option value="">Все / другая модель</option>{Array.from(new Set(catalog?.models.map(m => m.manufacturer))).map(m => <option key={m}>{m}</option>)}{manufacturer && !catalog?.models.some(m => m.manufacturer === manufacturer) && <option>{manufacturer}</option>}</select></label>
      <label>Модель терминала<input name="model" list="terminal-models" value={model} maxLength={100} placeholder="Выберите или введите модель" onChange={e => { setModel(e.target.value); const entry = catalog?.models.find(m => m.name === e.target.value); if (entry) { setManufacturer(entry.manufacturer); setProtocol(entry.protocol); } }} /><datalist id="terminal-models">{catalog?.models.filter(m => !manufacturer || m.manufacturer === manufacturer).map(m => <option key={m.name + m.protocol} value={m.name} />)}</datalist></label>
      <label>Протокол терминала<select name="protocol" value={protocol} onChange={e => setProtocol(e.target.value)}><option value="">Выбрать позже</option>{catalog?.protocols.map(p => <option key={p.id} value={p.id}>{p.label}{p.id === 'navis' ? ' — NTCB / FLEX' : ''}</option>)}{protocol && !catalog?.protocols.some(p => p.id === protocol) && <option value={protocol}>{protocol}</option>}</select></label>
      <label>SIM / телефон терминала<input name="phone" defaultValue={device?.phone} maxLength={40} /></label>
      <label>SIM 2<input name="sim2" defaultValue={String(attrs.intehSim2 ?? '')} maxLength={40} /></label>
      <label>Версия прошивки<input name="firmware" defaultValue={String(attrs.intehFirmware ?? '')} maxLength={80} /></label>
      <div className="connection-card full-width"><strong>Подключение терминала</strong>
        <p>Адрес: <b>{connection?.host || 'Внешний адрес не задан в мастере установки'}</b></p>
        <p>Порт: <b>{chosen ? `${chosen.port} / ${chosen.transport.toUpperCase()}` : 'Выберите протокол'}</b></p>
        <p>{enabled ? 'Порт настроен установщиком. Доступность из мобильной сети нужно проверить на сервере.' : 'Приёмник не настроен или его состояние неизвестно. Запустите мастер установки и выберите этот протокол.'}</p>
        {connection?.localHost && <p>Внутренний адрес: {connection.localHost} — для локального теста.</p>}
        <small>Каталог указывает совместимость протокола, а не проверку всех функций модели. ID должен совпадать с передаваемым устройством. Для EGTS проверьте настроенный ID, он может отличаться от IMEI.</small>
      </div>
    </div>
    <div className="full-width" hidden={tab !== 'sensors'}>
      <p className="muted">Выберите параметр из последнего сообщения или введите его точное имя. Датчик физически подключается и настраивается через конфигуратор терминала.</p>
      <button type="button" onClick={() => setSensors(rows => [...rows, { id: `${Date.now()}-${Math.random().toString(36).slice(2)}`, name: '', parameter: '', kind: 'number', unit: '', factor: 1, offset: 0, calibration: '', enabled: true }])}>+ Добавить датчик</button>
      <datalist id="sensor-parameters">{Object.keys(position?.attributes ?? {}).map(key => <option key={key}>{key}</option>)}</datalist>
      {sensors.map((s, i) => <fieldset className="sensor-card" key={s.id}><legend>Датчик {i + 1}</legend><div className="form-grid">
        <label>Название датчика<input value={s.name} maxLength={100} onChange={e => patchSensor(s.id, { name: e.target.value })} /></label>
        <label>Параметр<input list="sensor-parameters" value={s.parameter} maxLength={100} onChange={e => patchSensor(s.id, { parameter: e.target.value })} /></label>
        <label>Вид<select aria-label="Вид" value={s.kind} onChange={e => patchSensor(s.id, { kind: e.target.value })}>{[['number', 'Числовой'], ['fuel', 'Уровень топлива'], ['temperature', 'Температура'], ['digital', 'Дискретный'], ['text', 'Текст / идентификатор']].map(([k, n]) => <option key={k} value={k}>{n}</option>)}</select></label>
        <label>Единица измерения<input value={s.unit} maxLength={20} onChange={e => patchSensor(s.id, { unit: e.target.value })} /></label>
        <label>Коэффициент<input type="number" step="any" value={s.factor} onChange={e => patchSensor(s.id, { factor: e.target.value === '' ? NaN : Number(e.target.value) })} /></label>
        <label>Смещение<input type="number" step="any" value={s.offset} onChange={e => patchSensor(s.id, { offset: e.target.value === '' ? NaN : Number(e.target.value) })} /></label>
        <label className="full-width">Тарировка: вход;выход (по строке на точку)<textarea value={s.calibration} placeholder={'0;0\n1000;100'} onChange={e => patchSensor(s.id, { calibration: e.target.value })} /></label>
        <label><input type="checkbox" checked={s.enabled} onChange={e => patchSensor(s.id, { enabled: e.target.checked })} /> Показывать в мониторинге</label>
        <p>Последнее значение: {sensorValue(s, position?.attributes)}</p>
      </div><button type="button" onClick={() => setSensors(rows => rows.filter(row => row.id !== s.id))}>Удалить датчик</button></fieldset>)}
      {!sensors.length && <p>Датчиков пока нет.</p>}
      <p className="muted">Число × коэффициент + смещение, затем линейная тарировка. Вне диапазона значение не вычисляется. Настройки применяются к показаниям в интерфейсе; исходные сообщения сохраняются.</p>
      <details><summary>Последние параметры терминала</summary><pre>{position ? JSON.stringify(position.attributes, null, 2) : 'Сообщений нет. Сначала подключите терминал.'}</pre></details>
    </div>
    <div className="full-width form-grid" hidden={tab !== 'settings'}>
      <label>VIN<input name="vin" defaultValue={String(attrs.intehVin ?? '')} maxLength={17} /></label>
      <label>Марка / модель автомобиля<input name="vehicleModel" defaultValue={String(attrs.intehVehicleModel ?? '')} maxLength={100} /></label>
      <label className="full-width">Примечание<textarea name="notes" defaultValue={String(attrs.intehNotes ?? '')} maxLength={2000} /></label>
    </div>
    {message && <p className="error full-width" role="alert">{message}</p>}
  </>;
}
