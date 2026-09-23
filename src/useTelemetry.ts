import { useEffect, useState } from 'react';
import { api, ApiError } from './api';
import type { Position } from './types';
import { mergeTelemetry, type Telemetry } from './telemetry';

export function useTelemetry(deviceId?: number) {
  const [data, setData] = useState<Telemetry>({ parameters: [] });
  const [status, setStatus] = useState('Ожидание подключения');
  const [error, setError] = useState('');
  useEffect(() => {
    setData({ parameters: [] }); setError('');
    if (!deviceId) { setStatus('Сначала сохраните объект'); return; }
    let stopped = false, socket: WebSocket | undefined;
    let retry: ReturnType<typeof setTimeout>, poll: ReturnType<typeof setTimeout>;
    const accept = (rows: Position[]) => {
      if (!Array.isArray(rows) || stopped) return;
      for (const row of rows) if (row.deviceId === deviceId) setData(previous => mergeTelemetry(previous, row));
    };
    const connect = () => {
      if (stopped) return;
      socket = new WebSocket(`${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/api/socket`);
      socket.onopen = () => { if (!stopped) setStatus('Прямой поток сообщений'); };
      socket.onmessage = event => {
        try { const message = JSON.parse(event.data); if (message.positions) accept(message.positions); }
        catch { /* Ignore a malformed frame; the REST snapshot remains available. */ }
      };
      socket.onclose = () => {
        if (!stopped) { setStatus('Поток отключён · опрос каждые 5 секунд'); retry = setTimeout(connect, 5000); }
      };
      socket.onerror = () => socket?.close();
    };
    const refresh = async () => {
      try { accept(await api<Position[]>('/positions')); if (!stopped) setError(''); }
      catch (e) {
        if (stopped) return;
        setError(e instanceof Error ? e.message : 'Нет связи с сервером');
        if (e instanceof ApiError && (e.status === 401 || e.status === 403)) {
          stopped = true; clearTimeout(retry); socket?.close(); setData({ parameters: [] }); setStatus('Доступ завершён'); return;
        }
      }
      if (!stopped) poll = setTimeout(refresh, 5000);
    };
    setStatus('Подключение к потоку сообщений'); connect(); void refresh();
    return () => { stopped = true; clearTimeout(retry); clearTimeout(poll); socket?.close(); };
  }, [deviceId]);
  const current = data.position?.deviceId === deviceId ? data : { parameters: [] };
  return { ...current, position: data.position?.deviceId === deviceId ? data.position : undefined, status, error };
}
