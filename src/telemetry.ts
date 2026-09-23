import type { Position } from './types';
export interface ObservedParameter { key: string; value: unknown; lastSeen: string; present: boolean }
export interface Telemetry { position?: Position; parameters: ObservedParameter[] }
export function messageTime(p: Position): number {
  return Date.parse(p.serverTime || p.deviceTime || p.fixTime) || 0;
}
export function mergeTelemetry(state: Telemetry, incoming: Position): Telemetry {
  if (state.position && (state.position.id === incoming.id || messageTime(incoming) < messageTime(state.position))) return state;
  const values = incoming.attributes || {};
  const fields = new Map(state.parameters.map(p => [p.key, { ...p, present: false }]));
  for (const [key, value] of Object.entries(values)) {
    fields.set(key, { key, value, lastSeen: incoming.serverTime || incoming.deviceTime || incoming.fixTime, present: true });
  }
  // Bound the diagnostic working set even if a device emits arbitrary keys.
  const parameters = [...fields.values()].sort((a, b) => Number(b.present) - Number(a.present) || Date.parse(b.lastSeen) - Date.parse(a.lastSeen)).slice(0, 512);
  return { position: incoming, parameters };
}
export function describeParameter(key: string, value: unknown) {
  const known: Record<string, [string, string, string]> = {
    ignition: ['Зажигание', 'digital', ''], motion: ['Движение', 'digital', ''],
    power: ['Внешнее питание', 'number', 'В'], battery: ['Напряжение батареи', 'number', 'В'],
    batteryLevel: ['Заряд батареи', 'number', '%'], fuel: ['Топливо — проверьте единицу протокола', 'fuel', ''],
    fuelLevel: ['Уровень топлива — проверьте единицу протокола', 'fuel', ''],
    rpm: ['Обороты двигателя', 'number', 'об/мин'], odometer: ['Пробег', 'number', 'м'],
    satellites: ['Спутники', 'number', ''], driverUniqueId: ['Идентификатор водителя', 'text', ''],
  };
  const match = known[key];
  if (match) return { name: match[0], kind: match[1], unit: match[2], confidence: 'Стандартный параметр' };
  if (/^temp\d+$/.test(key)) return { name: `Температура (${key})`, kind: 'temperature', unit: '', confidence: 'Проверьте единицу протокола' };
  if (/^adc\d+$/.test(key)) return { name: `Аналоговый вход (${key})`, kind: 'number', unit: '', confidence: 'Назначение и шкала задаются вручную' };
  return { name: key, kind: typeof value === 'boolean' ? 'digital' : typeof value === 'number' ? 'number' : 'text', unit: '', confidence: 'Назначение не определено' };
}
