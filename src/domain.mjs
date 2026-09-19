export function coordinatesValid(position) {
  return position?.valid === true
    && Number.isFinite(position.latitude) && Math.abs(position.latitude) <= 90
    && Number.isFinite(position.longitude) && Math.abs(position.longitude) <= 180;
}
export function speedKmh(knots) {
  return typeof knots === 'number' && Number.isFinite(knots) ? Math.round(knots * 1.852) : null;
}
export function routeQuery(deviceId, from, to) {
  const start = new Date(from), end = new Date(to);
  if (!Number.isInteger(deviceId) || deviceId <= 0) throw new Error('Выберите транспорт.');
  if (!Number.isFinite(+start) || !Number.isFinite(+end) || start >= end)
    throw new Error('Укажите корректный период: начало должно быть раньше окончания.');
  if (+end - +start > 7 * 86400000) throw new Error('Выберите период не более 7 дней.');
  return new URLSearchParams({ deviceId: String(deviceId), from: start.toISOString(), to: end.toISOString() });
}
export function orderedRoute(positions) {
  return positions.filter(coordinatesValid).sort((a, b) => +new Date(a.fixTime) - +new Date(b.fixTime));
}
