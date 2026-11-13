import { overtimeSignPrefix, type OvertimeSignId } from './overtimeSign';

export function pageClockSignClass(seconds: number, sign?: OvertimeSignId): string {
  const prefix = overtimeSignPrefix(seconds, sign).trim();
  if (prefix === '+') return 'ot-sign ot-sign-plus';
  if (prefix) return 'ot-sign';
  return '';
}

type OvertimeClockTextProps = {
  seconds: number;
  body: string;
  sign?: OvertimeSignId;
  className?: string;
  signClassName?: string;
};

/**
 * Sign + digits as one inline text run (not flex children).
 * PreShow `ros-rainbow-text` uses background-clip:text — flex slots hide the +/−.
 */
export function OvertimeClockText({ seconds, body, sign, className, signClassName }: OvertimeClockTextProps) {
  const prefix = overtimeSignPrefix(seconds, sign).trim();
  if (!prefix) {
    return <span className={className}>{body}</span>;
  }
  const signCls = signClassName || pageClockSignClass(seconds, sign);
  return (
    <span className={className}>
      <span className={signCls}>{prefix}</span>
      {body}
    </span>
  );
}
