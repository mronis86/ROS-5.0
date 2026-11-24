import React, { useMemo } from 'react';
import { Navigate, useParams } from 'react-router-dom';

/** Legacy /polls/:token → unified per-event engagement page. */
export default function PollEventAudiencePage() {
  const { token = '' } = useParams<{ token: string }>();
  const safe = useMemo(() => decodeURIComponent(token || '').trim(), [token]);
  if (!safe) {
    return (
      <div className="min-h-screen bg-zinc-950 text-white flex items-center justify-center p-6">
        Invalid link
      </div>
    );
  }
  return <Navigate to={`/engage/${encodeURIComponent(safe)}`} replace />;
}
