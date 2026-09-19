import { useEffect, useRef, useState } from 'react';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { coordinatesValid } from './domain.mjs';
import type { Config, Device, Position } from './types';

export function FleetMap({ config, devices, positions, selected, route, onSelect }: {
  config: Config; devices: Device[]; positions: Position[]; selected: number | null;
  route: Position[] | null; onSelect: (id: number) => void;
}) {
  const container = useRef<HTMLDivElement>(null);
  const map = useRef<maplibregl.Map | null>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    if (!container.current) return;
    let instance: maplibregl.Map;
    try {
      instance = new maplibregl.Map({
        container: container.current, center: config.center, zoom: config.zoom,
        style: { version: 8, sources: {
          basemap: { type: 'raster', tiles: [config.tileUrl], tileSize: 256,
            attribution: config.tileAttribution },
        }, layers: [{ id: 'basemap', type: 'raster', source: 'basemap' }] },
      });
    } catch {
      setError('Не удалось открыть карту. Проверьте поддержку WebGL в браузере.');
      return;
    }
    map.current = instance;
    instance.addControl(new maplibregl.NavigationControl(), 'top-right');
    instance.on('error', () => setError('Карта загружается с ошибкой. Проверьте доступ к источнику карт; данные транспорта остаются доступны.'));
    instance.on('load', () => {
      instance.addSource('route', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
      instance.addLayer({ id: 'route', type: 'line', source: 'route',
        paint: { 'line-color': '#087f8c', 'line-width': 5, 'line-opacity': 0.85 } });
      setReady(true);
    });
    return () => { instance.remove(); map.current = null; };
  }, [config]);
  useEffect(() => {
    if (!map.current) return;
    const markers = positions.filter(coordinatesValid).flatMap(position => {
      const device = devices.find(item => item.id === position.deviceId);
      if (!device) return [];
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'vehicle-marker' + (device.id === selected ? ' selected' : '');
      button.textContent = '↑';
      button.title = device.name;
      button.setAttribute('aria-label', 'Выбрать ' + device.name);
      button.addEventListener('click', () => onSelect(device.id));
      return [new maplibregl.Marker({ element: button })
        .setLngLat([position.longitude, position.latitude]).addTo(map.current!)];
    });
    return () => markers.forEach(marker => marker.remove());
  }, [positions, devices, selected, onSelect, ready]);
  useEffect(() => {
    if (!map.current || !ready) return;
    const source = map.current.getSource('route') as maplibregl.GeoJSONSource;
    source.setData({ type: 'FeatureCollection', features: route && route.length > 1
      ? [{ type: 'Feature', properties: {}, geometry: { type: 'LineString',
          coordinates: route.map(p => [p.longitude, p.latitude]) } }] : [] });
    if (route?.length) {
      const bounds = new maplibregl.LngLatBounds();
      route.forEach(p => bounds.extend([p.longitude, p.latitude]));
      map.current.fitBounds(bounds, { padding: 65, maxZoom: 16 });
    }
  }, [route, ready]);
  useEffect(() => {
    if (!map.current || route !== null) return;
    const position = positions.find(p => p.deviceId === selected && coordinatesValid(p));
    if (position) map.current.easeTo({ center: [position.longitude, position.latitude], zoom: 14 });
  }, [selected, positions, route]);
  return <div className="map-wrap"><div ref={container} className="map" />
    {error && <div className="map-warning" role="status">{error}</div>}
    {!positions.some(coordinatesValid) && <div className="map-empty">Ожидаем координаты транспорта</div>}
  </div>;
}
