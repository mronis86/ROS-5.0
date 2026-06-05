import React, { useCallback, useEffect, useState } from 'react';

type Health = { status?: string; mode?: string; phase?: number; db?: string };
type CalendarEvent = { id: string; name: string; date: string };

const HomePage: React.FC = () => {
  const [health, setHealth] = useState<Health | null>(null);
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    setError(null);
    try {
      const [h, ev] = await Promise.all([
        fetch('/health', { cache: 'no-store' }).then((r) => r.json()),
        fetch('/api/calendar-events', { cache: 'no-store' }).then((r) => r.json()),
      ]);
      setHealth(h);
      setEvents(Array.isArray(ev) ? ev : []);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Request failed');
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const seedSample = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/dev/seed-sample', { method: 'POST' });
      if (!res.ok) throw new Error(await res.text());
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Seed failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ maxWidth: 640, margin: '3rem auto', padding: '0 1.5rem' }}>
      <h1 style={{ margin: 0, fontSize: '1.75rem' }}>ROS Offline Show</h1>
      <p style={{ color: '#94a3b8', lineHeight: 1.5 }}>
        Phase 2 — LAN server with SQLite. Separate from the hosted app on port 3003.
      </p>

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: '1.5rem' }}>
        <button
          type="button"
          onClick={() => void refresh()}
          style={btnStyle}
        >
          Refresh
        </button>
        <button type="button" disabled={busy} onClick={() => void seedSample()} style={btnStyle}>
          {busy ? '…' : 'Create sample event'}
        </button>
      </div>

      {error && <p style={{ color: '#f87171' }}>{error}</p>}

      <section style={cardStyle}>
        <strong>Server</strong>
        {health ? (
          <pre style={preStyle}>{JSON.stringify(health, null, 2)}</pre>
        ) : (
          <p style={{ color: '#94a3b8' }}>Checking…</p>
        )}
      </section>

      <section style={{ ...cardStyle, marginTop: '1rem' }}>
        <strong>Calendar events ({events.length})</strong>
        {events.length === 0 ? (
          <p style={{ color: '#94a3b8', margin: '0.5rem 0 0' }}>
            No events yet — click “Create sample event”.
          </p>
        ) : (
          <ul style={{ margin: '0.5rem 0 0', paddingLeft: '1.25rem' }}>
            {events.map((ev) => (
              <li key={ev.id} style={{ marginBottom: 4 }}>
                {ev.name} <span style={{ color: '#64748b' }}>({ev.date})</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <p style={{ marginTop: '2rem', fontSize: 14, color: '#64748b' }}>
        Use the bar at the bottom to confirm you are on the offline app and see Internet / Railway /
        Neon / Local LAN status.
      </p>
    </div>
  );
};

const btnStyle: React.CSSProperties = {
  padding: '8px 14px',
  borderRadius: 6,
  border: '1px solid #475569',
  background: '#1e293b',
  color: '#e2e8f0',
  cursor: 'pointer',
};

const cardStyle: React.CSSProperties = {
  padding: '1rem 1.25rem',
  borderRadius: 8,
  background: '#1e293b',
  border: '1px solid #334155',
};

const preStyle: React.CSSProperties = {
  margin: '0.5rem 0 0',
  fontSize: 13,
  overflow: 'auto',
};

export default HomePage;
