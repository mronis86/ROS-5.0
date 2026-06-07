import React from 'react';

export type ShowcaseEnlargeFit = 'contain' | 'width';

export type ShowcaseScreenMeta = {
  id: string;
  title: string;
  subtitle: string;
  designWidth: number;
  designHeight: number;
  /** Max visible height in grid card mode (px). */
  compactMaxHeight: number;
  /** Enlarge modal: scale to fit width and allow vertical scroll (default: width). */
  enlargeFit?: ShowcaseEnlargeFit;
  /** Override auto modal width (default: derived from designWidth). */
  enlargeMaxWidth?: '6xl' | '7xl';
  render: () => React.ReactNode;
};
