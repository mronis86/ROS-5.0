import { getApiBaseUrl } from '../services/api-client';
import type { RefreshNotice } from './appSettings';
import {
  ROS_APP_VERSION,
  ROS_APP_VERSION_DATE,
  ROS_APP_VERSION_SEQ,
  type RosVersionInfo,
} from './rosVersion';

const POLL_MS = 45_000;
const FIRST_CHECK_MS = 8_000;

export type RemoteRosVersion = RosVersionInfo;

function parseLiveFile(data: unknown): RosVersionInfo | null {
  if (!data || typeof data !== 'object') return null;
  const version = String((data as { version?: unknown }).version || '').trim();
  if (!version) return null;
  return {
    version,
    date: String((data as { date?: unknown }).date || ''),
    seq: Number((data as { seq?: unknown }).seq) || 0,
  };
}

/** Live Cloudflare `/ros-version.json` — what Admin should notify, not a stale Admin tab. */
export async function fetchLiveRosVersion(): Promise<RosVersionInfo> {
  try {
    const res = await fetch(`/ros-version.json?t=${Date.now()}`, { cache: 'no-store' });
    if (res.ok) {
      const parsed = parseLiveFile(await res.json());
      if (parsed) return parsed;
    }
  } catch {
    /* fall through */
  }
  return {
    version: ROS_APP_VERSION,
    date: ROS_APP_VERSION_DATE,
    seq: ROS_APP_VERSION_SEQ,
  };
}

/** True when this tab is older than the version Admin asked people to load. */
export function isBehindRefreshNotice(notice: RefreshNotice | null | undefined): boolean {
  if (!notice?.version) return false;
  const noticeDate = String(notice.date || '');
  const noticeSeq = Number(notice.seq) || 0;
  if (noticeDate && ROS_APP_VERSION_DATE) {
    if (ROS_APP_VERSION_DATE < noticeDate) return true;
    if (ROS_APP_VERSION_DATE > noticeDate) return false;
    return ROS_APP_VERSION_SEQ < noticeSeq;
  }
  return notice.version !== ROS_APP_VERSION;
}

/**
 * Poll Neon app_settings for an Admin-pushed refresh notice.
 * Deploys alone do not show the banner.
 */
export function subscribeRefreshNotice(
  onNotice: (notice: RefreshNotice | null) => void
): () => void {
  let stopped = false;

  const check = async () => {
    if (stopped) return;
    try {
      const res = await fetch(`${getApiBaseUrl()}/api/app-settings?t=${Date.now()}`, {
        cache: 'no-store',
      });
      if (!res.ok) return;
      const data = (await res.json()) as { refreshNotice?: RefreshNotice | null };
      const notice = data.refreshNotice;
      onNotice(
        notice && notice.version
          ? {
              version: String(notice.version),
              date: String(notice.date || ''),
              seq: Number(notice.seq) || 0,
              at: notice.at || null,
            }
          : null
      );
    } catch {
      /* offline */
    }
  };

  const first = window.setTimeout(() => {
    void check();
  }, FIRST_CHECK_MS);
  const interval = window.setInterval(() => {
    void check();
  }, POLL_MS);

  return () => {
    stopped = true;
    window.clearTimeout(first);
    window.clearInterval(interval);
  };
}
