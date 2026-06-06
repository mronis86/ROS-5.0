import React, { useEffect, useState } from 'react';
import {
  getLogoVariant,
  LOGO_VARIANT_CHANGE_EVENT,
  type LogoVariant,
} from '../lib/branding';

type AppBrandTitleProps = {
  titleClassName?: string;
  taglineClassName?: string;
  showTagline?: boolean;
};

const AppBrandTitle: React.FC<AppBrandTitleProps> = ({
  titleClassName = 'text-xl font-bold text-white leading-tight',
  taglineClassName = 'text-[10px] uppercase tracking-[0.12em] text-slate-400 leading-tight',
  showTagline = true,
}) => {
  const [variant, setVariant] = useState<LogoVariant>(() => getLogoVariant());

  useEffect(() => {
    const refresh = () => setVariant(getLogoVariant());
    window.addEventListener(LOGO_VARIANT_CHANGE_EVENT, refresh);
    window.addEventListener('storage', refresh);
    return () => {
      window.removeEventListener(LOGO_VARIANT_CHANGE_EVENT, refresh);
      window.removeEventListener('storage', refresh);
    };
  }, []);

  return (
    <div className="min-w-0 leading-none">
      <h1 className={titleClassName}>{variant.appTitle}</h1>
      {showTagline && variant.appTagline ? (
        <p className={`mt-px ${taglineClassName}`}>{variant.appTagline}</p>
      ) : null}
    </div>
  );
};

export default AppBrandTitle;
