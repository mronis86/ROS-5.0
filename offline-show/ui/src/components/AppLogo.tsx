import React, { useEffect, useState } from 'react';
import {
  getLogoVariant,
  getLogoVariantId,
  LOGO_VARIANT_CHANGE_EVENT,
  type LogoVariantId,
} from '../lib/branding';

type AppLogoSize = 'sm' | 'md' | 'lg';

type AppLogoProps = {
  size?: AppLogoSize;
  className?: string;
};

const sizeClasses: Record<LogoVariantId | 'default-box', Record<AppLogoSize, string>> = {
  'default-box': {
    sm: 'w-8 h-8 text-lg',
    md: 'w-10 h-10 text-xl',
    lg: 'w-12 h-12 text-2xl',
  },
  default: {
    sm: 'h-8 w-auto max-w-[140px]',
    md: 'h-10 w-auto max-w-[160px]',
    lg: 'h-12 w-auto max-w-[200px]',
  },
  sinor: {
    sm: 'h-8 w-auto max-w-[200px]',
    md: 'h-10 w-auto max-w-[240px]',
    lg: 'h-12 w-auto max-w-[280px]',
  },
};

const AppLogo: React.FC<AppLogoProps> = ({ size = 'sm', className = '' }) => {
  const [variantId, setVariantId] = useState<LogoVariantId>(() => getLogoVariantId());

  useEffect(() => {
    const refresh = () => setVariantId(getLogoVariantId());
    window.addEventListener(LOGO_VARIANT_CHANGE_EVENT, refresh);
    window.addEventListener('storage', refresh);
    return () => {
      window.removeEventListener(LOGO_VARIANT_CHANGE_EVENT, refresh);
      window.removeEventListener('storage', refresh);
    };
  }, []);

  const variant = getLogoVariant(variantId);

  if (variant.type === 'image' && variant.src) {
    return (
      <img
        src={variant.src}
        alt={variant.label}
        className={`object-contain object-left ${sizeClasses[variant.id][size]} ${className}`.trim()}
      />
    );
  }

  const boxClass = sizeClasses['default-box'][size];
  return (
    <div
      className={`bg-blue-600 rounded-lg flex items-center justify-center shrink-0 ${boxClass} ${className}`.trim()}
    >
      <span className="text-white font-bold">R</span>
    </div>
  );
};

export default AppLogo;
