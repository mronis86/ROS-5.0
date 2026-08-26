import React, { useCallback, useEffect, useMemo, useState } from 'react';
import AppLogo from '../components/AppLogo';
import AppBrandTitle from '../components/AppBrandTitle';
import {
  bookTrainingSlot,
  fetchTrainingSlots,
  formatTrainingWhen,
  trainingIcsAbsoluteUrl,
  type TrainingBooking,
  type TrainingSlot,
} from '../lib/trainingBooking';

type Step = 'pick' | 'form' | 'done';

const TrainingBookingPage: React.FC = () => {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [timezone, setTimezone] = useState('America/New_York');
  const [slots, setSlots] = useState<TrainingSlot[]>([]);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [selectedSlot, setSelectedSlot] = useState<TrainingSlot | null>(null);
  const [step, setStep] = useState<Step>('pick');
  const [submitting, setSubmitting] = useState(false);
  const [booking, setBooking] = useState<TrainingBooking | null>(null);

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [company, setCompany] = useState('');
  const [phone, setPhone] = useState('');
  const [notes, setNotes] = useState('');

  const loadSlots = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchTrainingSlots(45);
      if (!data.ok) {
        setError(data.error || 'Could not load available times.');
        setSlots([]);
        return;
      }
      setTimezone(data.timezone || 'America/New_York');
      setSlots(data.slots || []);
      if (!selectedDate && data.slots?.length) {
        setSelectedDate(data.slots[0].date);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load slots.');
    } finally {
      setLoading(false);
    }
  }, [selectedDate]);

  useEffect(() => {
    void loadSlots();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- initial load only
  }, []);

  const dates = useMemo(() => {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const s of slots) {
      if (!seen.has(s.date)) {
        seen.add(s.date);
        out.push(s.date);
      }
    }
    return out;
  }, [slots]);

  const daySlots = useMemo(
    () => slots.filter((s) => s.date === selectedDate),
    [slots, selectedDate]
  );

  const formatDayLabel = (dateKey: string) => {
    try {
      const [y, m, d] = dateKey.split('-').map(Number);
      const utcNoon = new Date(Date.UTC(y, m - 1, d, 16, 0, 0));
      return new Intl.DateTimeFormat('en-US', {
        timeZone: timezone,
        weekday: 'short',
        month: 'short',
        day: 'numeric',
      }).format(utcNoon);
    } catch {
      return dateKey;
    }
  };

  const onPickSlot = (slot: TrainingSlot) => {
    setSelectedSlot(slot);
    setStep('form');
    setError(null);
  };

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedSlot) return;
    setSubmitting(true);
    setError(null);
    try {
      const result = await bookTrainingSlot({
        startsAt: selectedSlot.startsAt,
        name,
        email,
        company,
        phone,
        notes,
      });
      if (!result.ok || !result.booking) {
        setError(result.error || 'Could not complete booking.');
        return;
      }
      setBooking(result.booking);
      setStep('done');
      await loadSlots();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Booking failed.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 to-slate-800 text-slate-200">
      <div className="mx-auto max-w-3xl px-4 py-8">
        <div className="flex items-center gap-3 mb-8">
          <AppLogo size="sm" />
          <div>
            <AppBrandTitle titleClassName="text-lg font-semibold text-white leading-tight" showTagline={false} />
            <p className="text-xs uppercase tracking-wide text-slate-500">Book application training</p>
          </div>
        </div>

        <div className="rounded-2xl border border-slate-700/80 bg-slate-900/70 p-5 sm:p-6 shadow-xl">
          <h1 className="text-xl sm:text-2xl font-semibold text-white mb-1">Schedule a training session</h1>
          <p className="text-sm text-slate-400 mb-6">
            Available Monday–Friday, 9:00 AM – 5:00 PM ({timezone.replace(/_/g, ' ')}). Each session is one hour.
            Several people can book the same time if needed.
          </p>

          {error ? (
            <div className="mb-4 rounded-lg border border-red-700/50 bg-red-950/40 px-3 py-2 text-sm text-red-200">
              {error}
            </div>
          ) : null}

          {step === 'pick' && (
            <>
              {loading ? (
                <p className="text-slate-400 text-sm">Loading available times…</p>
              ) : dates.length === 0 ? (
                <p className="text-slate-400 text-sm">No open slots in the next few weeks. Please check back later.</p>
              ) : (
                <div className="space-y-4">
                  <div className="flex gap-2 overflow-x-auto pb-1">
                    {dates.map((d) => (
                      <button
                        key={d}
                        type="button"
                        onClick={() => setSelectedDate(d)}
                        className={`shrink-0 rounded-lg px-3 py-2 text-xs font-semibold ${
                          selectedDate === d
                            ? 'bg-blue-600 text-white'
                            : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
                        }`}
                      >
                        {formatDayLabel(d)}
                      </button>
                    ))}
                  </div>
                  <div className="flex flex-wrap items-center gap-3 text-[11px] text-slate-400">
                    <span className="inline-flex items-center gap-1.5">
                      <span className="h-2.5 w-2.5 rounded-sm bg-slate-600 border border-slate-500" />
                      Open
                    </span>
                    <span className="inline-flex items-center gap-1.5">
                      <span className="h-2.5 w-2.5 rounded-sm bg-amber-500/80 border border-amber-400" />
                      Others already booked — still available
                    </span>
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                    {daySlots.map((slot) => {
                      const hasBookings = (slot.bookingCount || 0) > 0;
                      return (
                        <button
                          key={slot.startsAt}
                          type="button"
                          onClick={() => onPickSlot(slot)}
                          className={`rounded-xl px-3 py-3 text-sm font-medium transition-colors text-left ${
                            hasBookings
                              ? 'border-2 border-amber-400/80 bg-amber-950/50 text-amber-50 hover:bg-amber-900/60 hover:border-amber-300'
                              : 'border border-slate-600 bg-slate-800/80 text-white hover:border-blue-500 hover:bg-slate-700'
                          }`}
                        >
                          <span className="block font-semibold">
                            {new Intl.DateTimeFormat('en-US', {
                              timeZone: timezone,
                              hour: 'numeric',
                              minute: '2-digit',
                            }).format(new Date(slot.startsAt))}
                          </span>
                          {hasBookings ? (
                            <span className="block text-[11px] text-amber-200/90 mt-1 font-medium">
                              {slot.bookingCount} booked · still open
                            </span>
                          ) : (
                            <span className="block text-[11px] text-slate-400 mt-1">Available</span>
                          )}
                        </button>
                      );
                    })}
                  </div>
                  {daySlots.length === 0 ? (
                    <p className="text-sm text-slate-500">No open hours on this day.</p>
                  ) : null}
                </div>
              )}
            </>
          )}

          {step === 'form' && selectedSlot ? (
            <form onSubmit={onSubmit} className="space-y-4">
              <div className="rounded-lg bg-slate-800/80 border border-slate-600 px-3 py-2 text-sm">
                <p className="text-slate-400 text-xs uppercase tracking-wide mb-0.5">Selected time</p>
                <p className="text-white font-medium">
                  {formatTrainingWhen(selectedSlot.startsAt, timezone)}
                </p>
                <button
                  type="button"
                  className="mt-1 text-xs text-blue-400 hover:text-blue-300"
                  onClick={() => {
                    setStep('pick');
                    setSelectedSlot(null);
                  }}
                >
                  Change time
                </button>
              </div>

              <label className="block">
                <span className="text-xs font-medium text-slate-400">Full name *</span>
                <input
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-blue-500/40"
                />
              </label>
              <label className="block">
                <span className="text-xs font-medium text-slate-400">Email *</span>
                <input
                  required
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-blue-500/40"
                />
              </label>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <label className="block">
                  <span className="text-xs font-medium text-slate-400">Company</span>
                  <input
                    value={company}
                    onChange={(e) => setCompany(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-blue-500/40"
                  />
                </label>
                <label className="block">
                  <span className="text-xs font-medium text-slate-400">Phone</span>
                  <input
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-blue-500/40"
                  />
                </label>
              </div>
              <label className="block">
                <span className="text-xs font-medium text-slate-400">Notes (optional)</span>
                <textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  rows={3}
                  className="mt-1 w-full rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-blue-500/40"
                  placeholder="What do you want to learn?"
                />
              </label>

              <button
                type="submit"
                disabled={submitting}
                className="w-full rounded-lg bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white font-semibold py-2.5 text-sm"
              >
                {submitting ? 'Booking…' : 'Confirm booking'}
              </button>
            </form>
          ) : null}

          {step === 'done' && booking ? (
            <div className="space-y-4">
              <div className="rounded-xl border border-emerald-700/50 bg-emerald-950/30 px-4 py-3">
                <p className="text-emerald-300 font-semibold">You’re booked</p>
                <p className="text-sm text-slate-200 mt-1">
                  {formatTrainingWhen(booking.startsAt, timezone)}
                </p>
                <p className="text-xs text-slate-400 mt-1">
                  Confirmation for {booking.name} · {booking.email}
                </p>
              </div>
              <a
                href={trainingIcsAbsoluteUrl(booking.id)}
                className="inline-flex items-center justify-center w-full rounded-lg bg-blue-600 hover:bg-blue-500 text-white font-semibold py-2.5 text-sm"
              >
                Add to your calendar (.ics)
              </a>
              <p className="text-xs text-slate-500 text-center">
                Opens a calendar file you can import into Google Calendar, Outlook, Apple Calendar, and others.
              </p>
              <button
                type="button"
                onClick={() => {
                  setStep('pick');
                  setSelectedSlot(null);
                  setBooking(null);
                  setName('');
                  setEmail('');
                  setCompany('');
                  setPhone('');
                  setNotes('');
                }}
                className="w-full text-sm text-slate-400 hover:text-white"
              >
                Book another session
              </button>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
};

export default TrainingBookingPage;
