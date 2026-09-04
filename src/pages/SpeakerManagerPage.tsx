import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { canAccessSpeakerManager } from '../services/auth-service';
import { apiClient, type SpeakerDirectoryRow } from '../services/api-client';

type SpeakerForm = {
  full_name: string;
  title: string;
  org: string;
  photo_link: string;
  notes: string;
  email: string;
};

const emptyForm = (): SpeakerForm => ({
  full_name: '',
  title: '',
  org: '',
  photo_link: '',
  notes: '',
  email: '',
});

function formFromRow(row: SpeakerDirectoryRow): SpeakerForm {
  return {
    full_name: row.full_name || '',
    title: row.title || '',
    org: row.org || '',
    photo_link: row.photo_link || '',
    notes: row.notes || '',
    email: row.email || '',
  };
}

const SpeakerManagerPage: React.FC = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const allowed = canAccessSpeakerManager(user);

  const [speakers, setSpeakers] = useState<SpeakerDirectoryRow[]>([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [showModal, setShowModal] = useState(false);
  const [form, setForm] = useState<SpeakerForm>(emptyForm());

  useEffect(() => {
    if (!allowed) {
      navigate('/', { replace: true });
    }
  }, [allowed, navigate]);

  const load = useCallback(async (q = '') => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiClient.listSpeakers(q, 200);
      setSpeakers(res.speakers || []);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load speakers');
      setSpeakers([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!allowed) return;
    void load('');
  }, [allowed, load]);

  const filteredHint = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return speakers.length;
    return speakers.filter(
      (s) =>
        s.full_name.toLowerCase().includes(q) ||
        s.title.toLowerCase().includes(q) ||
        s.org.toLowerCase().includes(q) ||
        s.email.toLowerCase().includes(q)
    ).length;
  }, [speakers, search]);

  const openCreate = () => {
    setEditingId(null);
    setForm(emptyForm());
    setShowModal(true);
  };

  const openEdit = (row: SpeakerDirectoryRow) => {
    setEditingId(row.id);
    setForm(formFromRow(row));
    setShowModal(true);
  };

  const saveSpeaker = async () => {
    if (!form.full_name.trim()) {
      setError('Full name is required.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      if (editingId) {
        await apiClient.updateSpeaker(editingId, form);
      } else {
        await apiClient.createSpeaker(form);
      }
      setShowModal(false);
      await load(search.trim());
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save speaker');
    } finally {
      setBusy(false);
    }
  };

  const removeSpeaker = async (row: SpeakerDirectoryRow) => {
    if (!confirm(`Delete ${row.full_name} from the speaker database?`)) return;
    setBusy(true);
    setError(null);
    try {
      await apiClient.deleteSpeaker(row.id);
      await load(search.trim());
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to delete speaker');
    } finally {
      setBusy(false);
    }
  };

  if (!allowed) return null;

  const visible = search.trim()
    ? speakers.filter((s) => {
        const q = search.trim().toLowerCase();
        return (
          s.full_name.toLowerCase().includes(q) ||
          s.title.toLowerCase().includes(q) ||
          s.org.toLowerCase().includes(q) ||
          s.email.toLowerCase().includes(q)
        );
      })
    : speakers;

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 to-slate-800 text-slate-200 pt-[var(--app-header-height)]">
      <div className="max-w-6xl mx-auto px-4 py-6">
        <div className="flex flex-wrap items-start justify-between gap-3 mb-6">
          <div>
            <h1 className="text-2xl font-bold text-white">Speaker Manager</h1>
            <p className="text-sm text-slate-400 mt-1">
              Global speaker database for recurring guests. Producers and Admins only.
            </p>
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => navigate('/')}
              className="px-3 py-2 rounded-lg bg-slate-700 hover:bg-slate-600 text-sm text-white"
            >
              Back to Events
            </button>
            <button
              type="button"
              onClick={openCreate}
              className="px-3 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-sm font-semibold text-white"
            >
              + Add Speaker
            </button>
          </div>
        </div>

        <div className="flex flex-wrap gap-2 mb-4">
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void load(search.trim());
            }}
            placeholder="Filter by name, title, org, email…"
            className="flex-1 min-w-[220px] px-3 py-2 rounded-lg bg-slate-800 border border-slate-600 text-white text-sm"
          />
          <button
            type="button"
            onClick={() => void load(search.trim())}
            className="px-3 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-sm text-white"
          >
            Search
          </button>
        </div>

        {error && (
          <div className="mb-4 rounded-lg border border-red-700/60 bg-red-950/40 px-3 py-2 text-sm text-red-200">
            {error}
          </div>
        )}

        <div className="text-xs text-slate-500 mb-2">
          {loading ? 'Loading…' : `${filteredHint} speaker${filteredHint === 1 ? '' : 's'}`}
        </div>

        <div className="overflow-x-auto rounded-xl border border-slate-700 bg-slate-800/80">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="border-b border-slate-700 text-left text-slate-400">
                <th className="px-3 py-2 font-semibold">Photo</th>
                <th className="px-3 py-2 font-semibold">Name</th>
                <th className="px-3 py-2 font-semibold">Title</th>
                <th className="px-3 py-2 font-semibold">Organization</th>
                <th className="px-3 py-2 font-semibold">Email</th>
                <th className="px-3 py-2 font-semibold text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {!loading && visible.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-3 py-8 text-center text-slate-500">
                    No speakers yet. Add one, or save new speakers from a Run of Show.
                  </td>
                </tr>
              )}
              {visible.map((row) => (
                <tr key={row.id} className="border-b border-slate-700/70 hover:bg-slate-900/40">
                  <td className="px-3 py-2">
                    {row.photo_link ? (
                      <img
                        src={row.photo_link}
                        alt=""
                        className="w-10 h-10 rounded object-cover border border-slate-600"
                        onError={(e) => {
                          e.currentTarget.style.display = 'none';
                        }}
                      />
                    ) : (
                      <div className="w-10 h-10 rounded bg-slate-700 border border-slate-600" />
                    )}
                  </td>
                  <td className="px-3 py-2 text-white font-medium">{row.full_name}</td>
                  <td className="px-3 py-2 text-slate-300">{row.title || '—'}</td>
                  <td className="px-3 py-2 text-slate-300">{row.org || '—'}</td>
                  <td className="px-3 py-2 text-slate-400">{row.email || '—'}</td>
                  <td className="px-3 py-2 text-right whitespace-nowrap">
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => openEdit(row)}
                      className="px-2 py-1 mr-1 rounded bg-slate-600 hover:bg-slate-500 text-xs text-white"
                    >
                      Edit
                    </button>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void removeSpeaker(row)}
                      className="px-2 py-1 rounded bg-red-700/80 hover:bg-red-600 text-xs text-white"
                    >
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60">
          <div className="w-full max-w-lg bg-slate-800 border border-slate-600 rounded-xl shadow-2xl">
            <div className="px-5 py-4 border-b border-slate-700">
              <h2 className="text-lg font-semibold text-white">
                {editingId ? 'Edit Speaker' : 'Add Speaker'}
              </h2>
            </div>
            <div className="px-5 py-4 space-y-3">
              {(
                [
                  ['full_name', 'Full Name *'],
                  ['title', 'Title'],
                  ['org', 'Organization'],
                  ['photo_link', 'Photo URL'],
                  ['email', 'Email'],
                ] as const
              ).map(([key, label]) => (
                <div key={key}>
                  <label className="block text-xs font-medium text-slate-400 mb-1">{label}</label>
                  <input
                    type="text"
                    value={form[key]}
                    onChange={(e) => setForm((prev) => ({ ...prev, [key]: e.target.value }))}
                    className="w-full px-3 py-2 rounded-lg bg-slate-900 border border-slate-600 text-white text-sm"
                  />
                </div>
              ))}
              <div>
                <label className="block text-xs font-medium text-slate-400 mb-1">Notes</label>
                <textarea
                  value={form.notes}
                  onChange={(e) => setForm((prev) => ({ ...prev, notes: e.target.value }))}
                  rows={3}
                  className="w-full px-3 py-2 rounded-lg bg-slate-900 border border-slate-600 text-white text-sm"
                />
              </div>
            </div>
            <div className="px-5 py-3 border-t border-slate-700 flex justify-end gap-2">
              <button
                type="button"
                disabled={busy}
                onClick={() => setShowModal(false)}
                className="px-4 py-2 rounded-lg bg-slate-700 hover:bg-slate-600 text-sm text-white"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => void saveSpeaker()}
                className="px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-sm font-semibold text-white"
              >
                {busy ? 'Saving…' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default SpeakerManagerPage;
