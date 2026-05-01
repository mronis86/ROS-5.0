import { useEffect, useState } from 'react';

/** Matches Tailwind `md` breakpoint: viewport at or below this width uses mobile layout. */
const DEFAULT_QUERY = '(max-width: 767px)';

export function useNarrowViewport(mediaQuery: string = DEFAULT_QUERY): boolean {
  const [matches, setMatches] = useState(() =>
    typeof window !== 'undefined' ? window.matchMedia(mediaQuery).matches : false
  );

  useEffect(() => {
    const mq = window.matchMedia(mediaQuery);
    const sync = () => setMatches(mq.matches);
    sync();
    mq.addEventListener('change', sync);
    return () => mq.removeEventListener('change', sync);
  }, [mediaQuery]);

  return matches;
}
