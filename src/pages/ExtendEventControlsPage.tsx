import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import CivicsBeeStudentsPanel from '../components/civicsBee/CivicsBeeStudentsPanel';
import {
  createDefaultCivicsBeeRoster,
  CivicsBeeRoster,
  parseCivicsBeeRoster,
} from '../lib/civicsBee';
import {
  EXTEND_MODULE_LABELS,
  ExtendEventControlModule,
  eventHasExtendModule,
} from '../lib/extendEventControls';
import { DatabaseService } from '../services/database';
import { Event } from '../types/Event';

type TabId = ExtendEventControlModule;

const ExtendEventControlsPage: React.FC = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const eventIdParam = searchParams.get('eventId') || '';
  const eventFromState = (location.state as { event?: Event } | null)?.event;

  const [event, setEvent] = useState<Event | null>(eventFromState || null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<TabId>('civicsBee');
  const [roster, setRoster] = useState<CivicsBeeRoster>(() => createDefaultCivicsBeeRoster());
  const [saving, setSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);

  const eventId = event?.calendarId || event?.id || eventIdParam;

  const modules = useMemo(() => {
    const fromEvent = event?.extendEventControlModules;
    if (fromEvent && fromEvent.length > 0) return fromEvent;
    if (event?.extendEventControlsEnabled) return ['civicsBee'] as ExtendEventControlModule[];
    return [] as ExtendEventControlModule[];
  }, [event]);

  const load = useCallback(async () => {
    if (!eventId) {
      setError('Missing eventId. Open Extend Event Controls from the Run of Show menu.');
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const [cal, ext] = await Promise.all([
        DatabaseService.getCalendarEvent(eventId),
        DatabaseService.getExtendEventControls(eventId),
      ]);

      if (!ext.enabled) {
        setError(
          'Extend Event Controls is not enabled for this event. An admin can turn it on from the Event List.'
        );
        setEvent({
          id: eventId,
          calendarId: cal?.id || eventId,
          name: cal?.name || eventFromState?.name || 'Event',
          date: (cal?.date || '').toString().slice(0, 10),
          location: '',
          numberOfDays: 1,
          extendEventControlsEnabled: false,
          extendEventControlModules: [],
        });
        setLoading(false);
        return;
      }

      const moduleList = (ext.modules.length
        ? ext.modules
        : ['civicsBee']) as ExtendEventControlModule[];

      setEvent({
        id: eventId,
        calendarId: cal?.id || eventId,
        name: cal?.name || eventFromState?.name || 'Event',
        date: (cal?.date || '').toString().slice(0, 10),
        location:
          (typeof cal?.schedule_data === 'object' && cal?.schedule_data
            ? String((cal.schedule_data as { location?: string }).location || '')
            : '') || '',
        numberOfDays: 1,
        extendEventControlsEnabled: true,
        extendEventControlModules: moduleList,
      });

      setRoster(parseCivicsBeeRoster(ext.moduleData?.civicsBee));
      setActiveTab((moduleList[0] || 'civicsBee') as TabId);
    } catch (e) {
      console.error(e);
      setError('Failed to load event controls.');
    } finally {
      setLoading(false);
    }
  }, [eventFromState?.name, eventId]);

  useEffect(() => {
    void load();
  }, [load]);

  const saveCivicsBee = async () => {
    if (!eventId) return;
    setSaving(true);
    setSaveMessage(null);
    try {
      const nextRoster: CivicsBeeRoster = {
        ...roster,
        updatedAt: new Date().toISOString(),
      };
      const ok = await DatabaseService.saveExtendModuleData(eventId, 'civicsBee', nextRoster);
      if (!ok) {
        setSaveMessage('Save failed. Try again.');
        return;
      }
      setRoster(nextRoster);
      setSaveMessage('Saved.');
      setTimeout(() => setSaveMessage(null), 2500);
    } catch (e) {
      console.error(e);
      setSaveMessage('Save failed.');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="mx-auto max-w-6xl px-4 py-10 text-slate-300">Loading Extend Event Controls…</div>
    );
  }

  return (
    <div className="mx-auto max-w-6xl px-4 py-6">
      <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <button
            type="button"
            onClick={() => navigate('/')}
            className="mb-2 text-xs text-slate-400 hover:text-slate-200"
          >
            ← Event List
          </button>
          <h1 className="text-2xl font-semibold text-white">Extend Event Controls</h1>
          <p className="text-sm text-slate-400">
            {event?.name || 'Event'}
            {event?.date ? ` · ${event.date}` : ''}
          </p>
        </div>
        {saveMessage && <p className="text-sm text-emerald-300">{saveMessage}</p>}
      </div>

      {error && (
        <div className="mb-6 rounded-lg border border-amber-700/50 bg-amber-950/40 px-4 py-3 text-sm text-amber-100">
          {error}
        </div>
      )}

      {!error && modules.length > 0 && (
        <>
          {modules.length > 1 && (
            <div className="mb-4 flex flex-wrap gap-2 border-b border-slate-700 pb-3">
              {modules.map((mod) => (
                <button
                  key={mod}
                  type="button"
                  onClick={() => setActiveTab(mod)}
                  className={`rounded-md px-3 py-1.5 text-sm font-medium ${
                    activeTab === mod
                      ? 'bg-slate-100 text-slate-900'
                      : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
                  }`}
                >
                  {EXTEND_MODULE_LABELS[mod]}
                </button>
              ))}
            </div>
          )}

          {activeTab === 'civicsBee' && eventHasExtendModule(event, 'civicsBee') && (
            <CivicsBeeStudentsPanel
              roster={roster}
              saving={saving}
              onChange={setRoster}
              onSave={() => void saveCivicsBee()}
            />
          )}
        </>
      )}
    </div>
  );
};

export default ExtendEventControlsPage;
