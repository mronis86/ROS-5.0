import { overtimeSignPrefix, type OvertimeSignId } from './overtimeSign';

type OvertimeClockTextProps = {
  seconds: number;
  body: string;
  sign?: OvertimeSignId;
  className?: string;
};

/** Sign sits in its own slot, vertically centered, with a gap before the digits. */
export function OvertimeClockText({ seconds, body, sign, className }: OvertimeClockTextProps) {
  const prefix = overtimeSignPrefix(seconds, sign).trim();
  if (!prefix) {
    return <span className={className}>{body}</span>;
  }
  return (
    <span className={`inline-flex items-center justify-center ${className || ''}`}>
      <span className="inline-flex w-[0.7em] shrink-0 items-center justify-center leading-none -translate-y-[0.06em] mr-[0.22em]">
        {prefix}
      </span>
      <span>{body}</span>
    </span>
  );
}
