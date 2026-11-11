import { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

interface MapPickerProps {
  lat: number | null;
  lng: number | null;
  onChange: (lat: number, lng: number) => void;
}

interface GeoResult {
  display_name: string;
  lat: string;
  lon: string;
}

const DEFAULT_CENTER: [number, number] = [25.04, 102.71];

/** 门店地图选点：OpenStreetMap 瓦片 + 地址搜索（Nominatim），无需地图 Key */
export function MapPicker({ lat, lng, onChange }: MapPickerProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const markerRef = useRef<L.Marker | null>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  const [keyword, setKeyword] = useState('');
  const [results, setResults] = useState<GeoResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [message, setMessage] = useState('');

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const center: [number, number] = lat !== null && lng !== null ? [lat, lng] : DEFAULT_CENTER;
    const map = L.map(containerRef.current, { center, zoom: lat !== null ? 14 : 13 });
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '© OpenStreetMap',
    }).addTo(map);

    const pin = L.divIcon({
      className: 'map-pin',
      html: '<span></span>',
      iconSize: [18, 18],
      iconAnchor: [9, 9],
    });
    map.on('click', (event: L.LeafletMouseEvent) => {
      const next = { lat: event.latlng.lat, lng: event.latlng.lng };
      if (markerRef.current) markerRef.current.setLatLng(event.latlng);
      else markerRef.current = L.marker(event.latlng, { icon: pin }).addTo(map);
      onChangeRef.current(Number(next.lat.toFixed(6)), Number(next.lng.toFixed(6)));
    });
    mapRef.current = map;

    return () => {
      map.remove();
      mapRef.current = null;
      markerRef.current = null;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (lat === null || lng === null) return;
    const point: [number, number] = [lat, lng];
    if (!markerRef.current) {
      markerRef.current = L.marker(point, {
        icon: L.divIcon({
          className: 'map-pin',
          html: '<span></span>',
          iconSize: [18, 18],
          iconAnchor: [9, 9],
        }),
      }).addTo(map);
    } else {
      markerRef.current.setLatLng(point);
    }
    map.setView(point, map.getZoom() < 10 ? 14 : map.getZoom());
  }, [lat, lng]);

  async function search() {
    const text = keyword.trim();
    if (!text) return;
    setSearching(true);
    setMessage('');
    try {
      const res = await fetch(
        `https://nominatim.openstreetmap.org/search?format=json&limit=5&countrycodes=cn&q=${encodeURIComponent(text)}`,
        { headers: { Accept: 'application/json' } },
      );
      if (!res.ok) throw new Error('请求失败');
      const list = (await res.json()) as GeoResult[];
      setResults(list);
      if (!list.length) setMessage('没有找到地点，可在地图上直接点击定位');
    } catch {
      setMessage('地址搜索不可用，请在地图上点击选点或手动填写坐标');
    } finally {
      setSearching(false);
    }
  }

  function pick(result: GeoResult) {
    const nextLat = Number(result.lat);
    const nextLng = Number(result.lon);
    onChange(nextLat, nextLng);
    setResults([]);
    mapRef.current?.setView([nextLat, nextLng], 15);
  }

  return (
    <div className="map-picker">
      <div className="map-picker-search">
        <input
          className="input"
          value={keyword}
          placeholder="搜索地点，例如 昆明市五华区"
          onChange={(event) => setKeyword(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              void search();
            }
          }}
        />
        <button type="button" className="btn btn-ghost btn-sm" disabled={searching} onClick={() => void search()}>
          {searching ? '搜索中…' : '搜索地图'}
        </button>
      </div>
      {message && <p className="small muted map-picker-msg">{message}</p>}
      {results.length > 0 && (
        <div className="map-picker-results">
          {results.map((item) => (
            <button type="button" key={`${item.lat}-${item.lon}`} onClick={() => pick(item)}>
              {item.display_name}
            </button>
          ))}
        </div>
      )}
      <div ref={containerRef} className="map-picker-canvas" />
      <p className="small muted map-picker-msg">在地图上点击可标记门店位置，坐标会自动填入表单。</p>
    </div>
  );
}
