import { useCallback, useEffect, useMemo, useState } from 'react';

export type EventListLayoutPreference = 'auto' | 'desktop' | 'mobile';

const STORAGE_KEY = 'ros.eventList.layoutPreference';

/** Aligns with Tailwind `md` (768px): below = narrow / mobile-friendly. */
const NARROW_QUERY = '(max-width: 767px)';

function readPreference(): EventListLayoutPreference {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw === 'desktop' || raw === 'mobile' || raw === 'auto') return raw;
  } catch {
    // ignore
  }
  return 'auto';
}

export function useEventListLayoutPreference() {
  const [preference, setPreferenceState] = useState<EventListLayoutPreference>(() =>
    typeof window === 'undefined' ? 'auto' : readPreference()
  );
  const [isNarrow, setIsNarrow] = useState(() =>
    typeof window === 'undefined' ? false : window.matchMedia(NARROW_QUERY).matches
  );

  useEffect(() => {
    const mq = window.matchMedia(NARROW_QUERY);
    const onChange = () => setIsNarrow(mq.matches);
    onChange();
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  const setPreference = useCallback((next: EventListLayoutPreference) => {
    setPreferenceState(next);
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // ignore
    }
  }, []);

  const effectiveLayout = useMemo<'desktop' | 'mobile'>(() => {
    if (preference === 'mobile') return 'mobile';
    if (preference === 'desktop') return 'desktop';
    return isNarrow ? 'mobile' : 'desktop';
  }, [preference, isNarrow]);

  return { preference, setPreference, effectiveLayout, isNarrow };
}
