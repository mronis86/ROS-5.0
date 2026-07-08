import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, Navigate } from 'react-router-dom';
import { Users } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { canAccessAccessManager } from '../services/auth-service';
import { getApiBaseUrl } from '../services/api-client';
import { apiJsonHeaders } from '../lib/sessionAuth';

type AccessStatus = 'pending' | 'approved' | 'rejected';

interface AccessRequestRow {
  id: string;
  email: string;
  full_name: string;
  status: AccessStatus;
  requested_at: string;
  reviewed_at?: string | null;
  reviewed_by?: string | null;
  portal_url?: string | null;
}

async function accessManagerFetch(path: string, init?: RequestInit): Promise<Response> {
  const base = getApiBaseUrl();
  const headers = new Headers(init?.headers);
  const json = apiJsonHeaders();
  Object.entries(json).forEach(([key, value]) => headers.set(key, value));
  return fetch(`${base}${path}`, { ...init, headers });
}

function formatDate(value?: string | null): string {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString();
}

export default function AccessManagerPage() {
  const { user, loading } = useAuth();
  const [requests, setRequests] = useState<AccessRequestRow[]>([]);
  const [listLoading, setListLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<'all' | AccessStatus>('pending');
  const [search, setSearch] = useState('');

  const fetchRequests = useCallback(async () => {
    setListLoading(true);
    setError(null);
    try {
      const res = await accessManagerFetch(`/api/admin/access-requests?status=${statusFilter}`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError((data as { error?: string }).error || `HTTP ${res.status}`);
        setRequests([]);
        return;
      }
      setRequests(Array.isArray((data as { requests?: AccessRequestRow[] }).requests) ? data.requests : []);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Request failed');
      setRequests([]);
    } finally {
      setListLoading(false);
    }
  }, [statusFilter]);

  useEffect(() => {
    if (canAccessAccessManager(user)) {
      void fetchRequests();
    }
  }, [user, fetchRequests]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return requests;
    return requests.filter(
      (row) =>
        row.email.toLowerCase().includes(q) ||
        (row.full_name || '').toLowerCase().includes(q)
    );
  }, [requests, search]);

  const approve = async (id: string, email: string) => {
    if (!confirm(`Approve access for ${email}?`)) return;
    setError(null);
    try {
      const res = await accessManagerFetch(`/api/admin/access-requests/${id}/approve`, {
        method: 'POST',
        body: JSON.stringify({ make_admin: false }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError((data as { error?: string }).error || `HTTP ${res.status}`);
        return;
      }
      await fetchRequests();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Approve failed');
    }
  };

  const reject = async (id: string, email: string) => {
    if (!confirm(`Reject access for ${email}?`)) return;
    setError(null);
    try {
      const res = await accessManagerFetch(`/api/admin/access-requests/${id}/reject`, {
        method: 'POST',
        body: JSON.stringify({}),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError((data as { error?: string }).error || `HTTP ${res.status}`);
        return;
      }
      await fetchRequests();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Reject failed');
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-900 text-slate-300 flex items-center justify-center pt-[var(--app-header-height)]">
        Loading…
      </div>
    );
  }

  if (!canAccessAccessManager(user)) {
    return <Navigate to="/" replace />;
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 to-slate-800 text-slate-200 pt-[var(--app-header-height)]">
      <div className="mx-auto max-w-5xl px-4 py-8 sm:px-6">
        <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-white flex items-center gap-2">
              <Users className="h-6 w-6 text-amber-300" />
              Access manager
            </h1>
            <p className="mt-2 text-sm text-slate-400 max-w-2xl">
              Review and approve user access requests. Event managers can authorize users but cannot grant
              administrator privileges.
            </p>
          </div>
          <Link
            to="/"
            className="rounded-lg border border-slate-600 bg-slate-800 px-3 py-2 text-sm text-slate-200 hover:bg-slate-700"
          >
            Back to events
          </Link>
        </div>

        <div className="rounded-xl border border-slate-700 bg-slate-800/80 p-5 sm:p-6">
          <div className="mb-4 flex flex-wrap items-center gap-2">
            {(['pending', 'approved', 'rejected', 'all'] as const).map((filter) => (
              <button
                key={filter}
                type="button"
                onClick={() => setStatusFilter(filter)}
                className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
                  statusFilter === filter
                    ? 'bg-amber-600 text-white'
                    : 'bg-slate-700/80 text-slate-300 hover:bg-slate-600'
                }`}
              >
                {filter === 'all' ? 'All' : filter.charAt(0).toUpperCase() + filter.slice(1)}
              </button>
            ))}
            <button
              type="button"
              onClick={() => void fetchRequests()}
              disabled={listLoading}
              className="ml-auto rounded-lg bg-slate-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-slate-500 disabled:opacity-50"
            >
              {listLoading ? 'Loading…' : 'Refresh'}
            </button>
          </div>

          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by name or email…"
            className="mb-4 w-full rounded-lg border border-slate-600 bg-slate-900/60 px-3 py-2 text-sm text-white placeholder:text-slate-500"
          />

          {error ? (
            <div className="mb-4 rounded-lg border border-red-700/50 bg-red-900/30 px-4 py-3 text-sm text-red-200">
              {error}
            </div>
          ) : null}

          {filtered.length === 0 ? (
            <p className="text-sm text-slate-400">
              {search.trim() ? `No users match "${search.trim()}".` : 'No access requests in this view.'}
            </p>
          ) : (
            <div className="overflow-x-auto rounded-lg border border-slate-600">
              <table className="min-w-full text-sm">
                <thead className="bg-slate-900/80 text-left text-xs uppercase tracking-wide text-slate-400">
                  <tr>
                    <th className="px-3 py-2">Name</th>
                    <th className="px-3 py-2">Email</th>
                    <th className="px-3 py-2">Status</th>
                    <th className="px-3 py-2">Requested</th>
                    <th className="px-3 py-2">Reviewed</th>
                    <th className="px-3 py-2 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((row) => (
                    <tr key={row.id} className="border-t border-slate-700/80">
                      <td className="px-3 py-2 text-white">{row.full_name || '—'}</td>
                      <td className="px-3 py-2 text-slate-300">{row.email}</td>
                      <td className="px-3 py-2">
                        <span
                          className={`inline-flex rounded px-2 py-0.5 text-xs font-medium ${
                            row.status === 'approved'
                              ? 'bg-emerald-900/50 text-emerald-200'
                              : row.status === 'rejected'
                                ? 'bg-red-900/50 text-red-200'
                                : 'bg-amber-900/50 text-amber-200'
                          }`}
                        >
                          {row.status}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-slate-400 whitespace-nowrap">{formatDate(row.requested_at)}</td>
                      <td className="px-3 py-2 text-slate-400 whitespace-nowrap">{formatDate(row.reviewed_at)}</td>
                      <td className="px-3 py-2">
                        <div className="flex justify-end gap-2">
                          {row.status !== 'approved' ? (
                            <button
                              type="button"
                              onClick={() => void approve(row.id, row.email)}
                              className="rounded bg-emerald-700 px-2.5 py-1 text-xs font-medium text-white hover:bg-emerald-600"
                            >
                              Approve
                            </button>
                          ) : null}
                          {row.status !== 'rejected' ? (
                            <button
                              type="button"
                              onClick={() => void reject(row.id, row.email)}
                              className="rounded bg-red-900/80 px-2.5 py-1 text-xs font-medium text-red-100 hover:bg-red-800"
                            >
                              Reject
                            </button>
                          ) : null}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
