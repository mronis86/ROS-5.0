import React from 'react';

type QuickModeBoltIconProps = {
  className?: string;
};

const QuickModeBoltIcon: React.FC<QuickModeBoltIconProps> = ({ className = 'h-3.5 w-3.5' }) => (
  <svg
    className={`shrink-0 ${className}`}
    viewBox="0 0 20 20"
    fill="currentColor"
    aria-hidden
  >
    <path d="M11.3 1.046A1 1 0 0112 2v5h4a1 1 0 01.82 1.573l-7 10A1 1 0 018 18v-5H4a1 1 0 01-.82-1.573l7-10a1 1 0 011.12-.38z" />
  </svg>
);

export default QuickModeBoltIcon;
