import { overtimeSignPrefix, type OvertimeSignId } from './overtimeSign';

export function pageClockSignClass(seconds: number, sign?: OvertimeSignId): string {
  const prefix = overtimeSignPrefix(seconds, sign).trim();
  if (prefix === '+') return 'mr-[0.12em] -translate-y-[0.02em]';
  return 'mr-[0.12em]';
}

type OvertimeClockTextProps = {
  seconds: number;
  body: string;
  sign?: OvertimeSignId;
  className?: string;
  signClassName?: string;
};

/** Sign sits in its own slot, vertically centered, with a gap before the digits. */
export function OvertimeClockText({ seconds, body, sign, className, signClassName }: OvertimeClockTextProps) {
  const prefix = overtimeSignPrefix(seconds, sign).trim();
  if (!prefix) {
    return <span className={className}>{body}</span>;
  }
  return (
    <span className={`inline-flex items-center justify-center ${className || ''}`}>
      <span
        className={`inline-flex shrink-0 items-center justify-center leading-none ${
          signClassName || '-translate-y-[0.04em] mr-[0.06em]'
        }`}
      >
        {prefix}
      </span>
      <span>{body}</span>
    </span>
  );
}
