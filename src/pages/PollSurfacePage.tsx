import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { WebPollBroadcastSurface } from '../components/WebPollDesignEditor';
import {
  fetchPublicWebPoll,
  fetchPublicWebPollRollup,
  webPollDisplayStyle,
  type WebPollSurfaceKind,
  type WebPollType,
} from '../lib/webPolls';

const SURFACES = new Set<WebPollSurfaceKind>(['stage', 'lower', 'pip']);

type Choice = { id: string; label: string; votes: number; color: string };

export default function PollSurfacePage() {
  const { token = '', surface: surfaceParam = 'stage' } = useParams();
  const surface = (
    SURFACES.has(surfaceParam as WebPollSurfaceKind) ? surfaceParam : 'stage'
  ) as WebPollSurfaceKind;

  const [question, setQuestion] = useState('');
  const [pollType, setPollType] = useState<WebPollType>('single');
  const [choices, setChoices] = useState<Choice[]>([]);
  const [style, setStyle] = useState(() => webPollDisplayStyle({}));
  const [onAir, setOnAir] = useState(false);
  const [showing, setShowing] = useState(false);
  const [motionKey, setMotionKey] = useState(0);
  const hideTimer = useRef<number | null>(null);

  const load = useCallback(async () => {
    if (!token) return;
    try {
      const [pub, rollup] = await Promise.all([
        fetchPublicWebPoll(token),
        fetchPublicWebPollRollup(token),
      ]);
      const poll = (pub as { poll?: Record<string, unknown> }).poll || {};
      const type = String(
        (rollup as { poll_type?: string }).poll_type ||
          (poll as { poll_type?: string }).poll_type ||
          'single'
      ) as WebPollType;
      const q = String(
        (rollup as { question?: string }).question ||
          (poll as { question?: string }).question ||
          ''
      );
      const nextStyle = webPollDisplayStyle({
        display_style:
          (rollup as { display_style?: unknown }).display_style ??
          (poll as { display_style?: unknown }).display_style,
        poll_type: type,
      });
      const opts =
        (rollup as { results_snapshot?: { options?: Record<string, unknown>[] } }).results_snapshot
          ?.options ||
        (rollup as { options?: Record<string, unknown>[] }).options ||
        (poll as { options?: Record<string, unknown>[] }).options ||
        [];
      setQuestion(q);
      setPollType(type);
      setStyle(nextStyle);
      setOnAir(Boolean(nextStyle.surfaces.onAir));
      setChoices(
        opts.map((o, i) => ({
          id: String(o.id || i),
          label: String(o.label || `Option ${i + 1}`),
          votes: Number(o.votes ?? o.vote_count ?? 0),
          color: String(o.color || '#38bdf8'),
        }))
      );
    } catch {
      /* keep last good frame */
    }
  }, [token]);

  useEffect(() => {
    void load();
    const id = window.setInterval(() => void load(), 1500);
    return () => window.clearInterval(id);
  }, [load]);

  useEffect(() => {
    if (hideTimer.current) {
      window.clearTimeout(hideTimer.current);
      hideTimer.current = null;
    }
    if (onAir) {
      setShowing(true);
      setMotionKey((k) => k + 1);
      return;
    }
    hideTimer.current = window.setTimeout(() => {
      setShowing(false);
      hideTimer.current = null;
    }, 700);
    return () => {
      if (hideTimer.current) window.clearTimeout(hideTimer.current);
    };
  }, [onAir]);

  const body = useMemo(() => {
    if (!showing) return null;
    return (
      <div
        className="fixed inset-0"
        style={{
          opacity: onAir ? 1 : 0,
          transition: 'opacity 0.65s cubic-bezier(0.33, 0.1, 0.25, 1)',
        }}
      >
        <WebPollBroadcastSurface
          surface={surface}
          question={question || 'Poll'}
          choices={choices}
          pollType={pollType}
          style={style}
          motionKey={motionKey}
        />
      </div>
    );
  }, [showing, onAir, surface, question, choices, pollType, style, motionKey]);

  return (
    <div className="fixed inset-0 overflow-hidden" style={{ background: 'transparent' }}>
      {body}
    </div>
  );
}
