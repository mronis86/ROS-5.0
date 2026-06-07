import React from 'react';
import ShowcaseFrame from './ShowcaseFrame';
import ShowcaseScaledViewport from './ShowcaseScaledViewport';
import type { ShowcaseScreenMeta } from './showcaseTypes';

type Props = {
  screen: ShowcaseScreenMeta;
  onEnlarge: () => void;
};

const ShowcaseScreenCard: React.FC<Props> = ({ screen, onEnlarge }) => (
  <ShowcaseFrame title={screen.title} subtitle={screen.subtitle} onEnlarge={onEnlarge}>
    <ShowcaseScaledViewport
      designWidth={screen.designWidth}
      designHeight={screen.designHeight}
      maxDisplayHeight={screen.compactMaxHeight}
    >
      {screen.render()}
    </ShowcaseScaledViewport>
  </ShowcaseFrame>
);

export default ShowcaseScreenCard;
