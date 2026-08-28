import React from 'react';

type NoLiveStreamFrameProps = {
  onOpenGuide?: () => void;
};

const NoLiveStreamFrame: React.FC<NoLiveStreamFrameProps> = ({ onOpenGuide }) => {
  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center bg-[#0a0e1a] px-6 text-center">
      <p className="text-base font-bold uppercase tracking-wide text-[#c5daf5] sm:text-lg">
        No current stream
      </p>
      <p className="mt-2 max-w-sm text-sm text-[#8aa8cc]">
        No live broadcast is scheduled for right now. Check the TV Guide for upcoming events.
      </p>
      {onOpenGuide ? (
        <button
          type="button"
          onClick={onOpenGuide}
          className="retro-tv-mode-btn retro-tv-mode-btn-active-guide mt-6 text-[11px]"
        >
          Open TV Guide
        </button>
      ) : null}
    </div>
  );
};

export default NoLiveStreamFrame;
