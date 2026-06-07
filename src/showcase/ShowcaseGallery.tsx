import React, { useMemo, useState } from 'react';
import ShowcaseEnlargeModal from './ShowcaseEnlargeModal';
import ShowcaseScreenCard from './ShowcaseScreenCard';
import { SHOWCASE_SCREENS, getShowcaseScreen } from './showcaseScreens';

const ShowcaseGallery: React.FC = () => {
  const [enlargedId, setEnlargedId] = useState<string | null>(null);
  const enlargedScreen = useMemo(
    () => (enlargedId ? getShowcaseScreen(enlargedId) ?? null : null),
    [enlargedId]
  );

  const mainScreens = useMemo(
    () => SHOWCASE_SCREENS.filter((s) => s.galleryGroup !== 'content-review'),
    []
  );
  const contentReviewScreens = useMemo(
    () => SHOWCASE_SCREENS.filter((s) => s.galleryGroup === 'content-review'),
    []
  );

  return (
    <section aria-label="ROS screen mockups">
      <div className="mb-6 text-center">
        <p className="mx-auto max-w-2xl text-sm leading-relaxed text-slate-400">
          Click any preview or <strong className="font-medium text-slate-300">Enlarge</strong> to open it
          full-size. Demo data only — mocks share a live{' '}
          <strong className="font-medium text-slate-300">follow timeline</strong> (CUE 1 → CUE 2).{' '}
          <strong className="font-medium text-slate-300">Clock</strong>,{' '}
          <strong className="font-medium text-slate-300">Photo View</strong>,{' '}
          <strong className="font-medium text-slate-300">Run of Show</strong>,{' '}
          <strong className="font-medium text-slate-300">Green Room</strong>, and{' '}
          <strong className="font-medium text-slate-300">Content Review (Follow)</strong> stay in sync.{' '}
          <strong className="font-medium text-slate-300">Notes Popout</strong> follows the same cue timeline.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {mainScreens.map((screen) => (
          <ShowcaseScreenCard
            key={screen.id}
            screen={screen}
            onEnlarge={() => setEnlargedId(screen.id)}
          />
        ))}
      </div>

      {contentReviewScreens.length > 0 ? (
        <div className="mt-10">
          <div className="mb-4 text-center">
            <h3 className="text-base font-semibold text-white">Content Review</h3>
            <p className="mx-auto mt-1 max-w-xl text-xs text-slate-400">
              Collaborative cue review with Creative + ROS approvals — Drive broadcasts your pick; Follow mirrors the
              driver or live show timeline.
            </p>
          </div>
          <div className="mx-auto grid max-w-4xl grid-cols-1 gap-4 sm:grid-cols-2">
            {contentReviewScreens.map((screen) => (
              <ShowcaseScreenCard
                key={screen.id}
                screen={screen}
                onEnlarge={() => setEnlargedId(screen.id)}
              />
            ))}
          </div>
        </div>
      ) : null}

      <ShowcaseEnlargeModal screen={enlargedScreen} onClose={() => setEnlargedId(null)} />
    </section>
  );
};

export default ShowcaseGallery;
