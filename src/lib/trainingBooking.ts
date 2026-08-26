import { getApiBaseUrl } from '../services/api-client';
import { adminFetch } from './adminAuth';

export interface TrainingSlot {
  startsAt: string;
  endsAt: string;
  date: string;
  hour: number;
  label: string;
  bookingCount?: number;
}

export interface TrainingBooking {
  id: string;
  startsAt: string;
  endsAt: string;
  name: string;
  email: string;
  company?: string;
  phone?: string;
  notes?: string;
  createdAt?: string;
  cancelledAt?: string | null;
}

export interface TrainingSlotsResponse {
  ok: boolean;
  timezone?: string;
  slots?: TrainingSlot[];
  blockedDates?: { date: string; reason?: string }[];
  error?: string;
  needsMigration?: boolean;
}

export async function fetchTrainingSlots(days = 45): Promise<TrainingSlotsResponse> {
  const base = getApiBaseUrl();
  const res = await fetch(`${base}/api/training/slots?days=${days}`, {
    cache: 'no-store',
  });
  const data = (await res.json().catch(() => ({}))) as TrainingSlotsResponse;
  if (!res.ok) {
    return { ok: false, error: data.error || `HTTP ${res.status}`, needsMigration: data.needsMigration };
  }
  return { ok: true, ...data };
}

export async function bookTrainingSlot(body: {
  startsAt: string;
  name: string;
  email: string;
  company?: string;
  phone?: string;
  notes?: string;
}): Promise<{
  ok: boolean;
  booking?: TrainingBooking;
  icsUrl?: string;
  icsFilename?: string;
  timezone?: string;
  error?: string;
}> {
  const base = getApiBaseUrl();
  const res = await fetch(`${base}/api/training/book`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = (await res.json().catch(() => ({}))) as {
    ok?: boolean;
    booking?: TrainingBooking;
    icsUrl?: string;
    icsFilename?: string;
    timezone?: string;
    error?: string;
  };
  if (!res.ok) {
    return { ok: false, error: data.error || `HTTP ${res.status}` };
  }
  return {
    ok: true,
    booking: data.booking,
    icsUrl: data.icsUrl,
    icsFilename: data.icsFilename,
    timezone: data.timezone,
  };
}

export function trainingIcsAbsoluteUrl(bookingId: string): string {
  const base = getApiBaseUrl();
  return `${base}/api/training/booking/${encodeURIComponent(bookingId)}/ics`;
}

export function formatTrainingWhen(iso: string, timeZone?: string): string {
  try {
    return new Intl.DateTimeFormat('en-US', {
      timeZone: timeZone || undefined,
      weekday: 'long',
      month: 'long',
      day: 'numeric',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    }).format(new Date(iso));
  } catch {
    return new Date(iso).toLocaleString();
  }
}

export async function adminListTrainingBookings(includeCancelled = false) {
  const res = await adminFetch(
    `/api/admin/training/bookings${includeCancelled ? '?includeCancelled=1' : ''}`
  );
  return res.json();
}

export async function adminCancelTrainingBooking(id: string) {
  const res = await adminFetch(`/api/admin/training/bookings/${encodeURIComponent(id)}/cancel`, {
    method: 'POST',
  });
  return res.json();
}

export async function adminListBlockedDates() {
  const res = await adminFetch('/api/admin/training/blocked-dates');
  return res.json();
}

export async function adminBlockTrainingDate(date: string, reason?: string) {
  const res = await adminFetch('/api/admin/training/blocked-dates', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ date, reason }),
  });
  return res.json();
}

export async function adminUnblockTrainingDate(date: string) {
  const res = await adminFetch(`/api/admin/training/blocked-dates/${encodeURIComponent(date)}`, {
    method: 'DELETE',
  });
  return res.json();
}
