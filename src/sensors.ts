export interface Sensor { id: string; name: string; parameter: string; kind: string; unit: string; factor: number; offset: number; calibration: string; enabled: boolean }
export function sensorsFrom(value: unknown): Sensor[] {
  try {
    const list = typeof value === 'string' ? JSON.parse(value) : value;
    return Array.isArray(list) ? list.filter(s => s && typeof s.name === 'string' && typeof s.parameter === 'string') : [];
  } catch { return []; }
}
export function calibrationPoints(text: string): number[][] {
  if (!text.trim()) return [];
  const rows = text.trim().split(/\n/).map(line => line.split(';').map(v => Number(v.trim().replace(',', '.'))));
  if (rows.length < 2 || rows.some(row => row.length !== 2 || row.some(v => !Number.isFinite(v)))
    || rows.some((row, i) => i > 0 && row[0] <= rows[i - 1][0])) throw new Error('Тарировка: минимум две строки «вход;выход», входы строго возрастают.');
  return rows;
}
export function sensorValue(sensor: Sensor, attributes?: Record<string, unknown>): string {
  const raw = attributes?.[sensor.parameter];
  if (raw === undefined || raw === null || raw === '') return 'Нет данных';
  if (sensor.kind === 'digital') return raw === true || raw === 1 ? 'Включено' : raw === false || raw === 0 ? 'Выключено' : 'Некорректные данные';
  if (sensor.kind === 'text') return String(raw);
  if (typeof raw !== 'number' || !Number.isFinite(raw)) return 'Некорректные данные';
  let value = raw * sensor.factor + sensor.offset;
  try {
    const points = calibrationPoints(sensor.calibration || '');
    if (points.length) {
      if (value < points[0][0] || value > points[points.length - 1][0]) return 'Вне тарировки';
      const i = Math.max(1, points.findIndex(point => point[0] >= value));
      const [x0, y0] = points[i - 1], [x1, y1] = points[i];
      value = y0 + (value - x0) * (y1 - y0) / (x1 - x0);
    }
  } catch { return 'Ошибка тарировки'; }
  return Number.isFinite(value) ? `${Number(value.toFixed(2))} ${sensor.unit || ''}`.trim() : 'Некорректные данные';
}
