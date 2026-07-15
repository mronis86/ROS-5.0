import React, { useCallback, useEffect, useRef, useState } from 'react';

type FocusField = 'email' | 'password';
type KeyboardLayout = 'letters' | 'symbols';

const ROW1 = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0'];
const ROW2 = ['q', 'w', 'e', 'r', 't', 'y', 'u', 'i', 'o', 'p'];
const ROW3 = ['a', 's', 'd', 'f', 'g', 'h', 'j', 'k', 'l'];
const ROW4_LETTERS = ['z', 'x', 'c', 'v', 'b', 'n', 'm', '@', '.', '-', '_'];

/** Common password / special characters (two rows + digit row already present). */
const SYM_ROW2 = ['!', '@', '#', '$', '%', '^', '&', '*', '(', ')'];
const SYM_ROW3 = ['-', '_', '=', '+', '[', ']', '{', '}', '\\', '|'];
const SYM_ROW4 = [';', ':', '"', "'", '<', '>', ',', '.', '?', '/'];

function KeyBtn({
  label,
  wide,
  active,
  onPress,
}: {
  label: string;
  wide?: boolean;
  active?: boolean;
  onPress: () => void;
}) {
  return (
    <button
      type="button"
      tabIndex={-1}
      onClick={onPress}
      className={`min-h-[44px] rounded-lg border text-sm font-semibold touch-manipulation active:scale-95 transition-colors ${
        wide ? 'px-4 flex-[1.6]' : 'px-2 flex-1'
      } ${
        active
          ? 'border-sky-400/60 bg-sky-500/30 text-sky-50'
          : 'border-slate-600/80 bg-slate-800/90 text-slate-100 hover:bg-slate-700'
      }`}
    >
      {label}
    </button>
  );
}

function insertAtCursor(
  value: string,
  insert: string,
  start: number | null,
  end: number | null
): { next: string; caret: number } {
  const s = start ?? value.length;
  const e = end ?? value.length;
  const next = value.slice(0, s) + insert + value.slice(e);
  return { next, caret: s + insert.length };
}

export interface UltritouchOpsLoginProps {
  busy?: boolean;
  error?: string | null;
  onCancel: () => void;
  onSubmit: (email: string, password: string) => void | Promise<void>;
}

/**
 * Touch-friendly ops login for Ultritouch Log tab.
 * Real inputs: physical keyboard works; on-screen keys also work; inputMode=none
 * reduces soft-keyboard popups on touch panels.
 */
const UltritouchOpsLogin: React.FC<UltritouchOpsLoginProps> = ({
  busy = false,
  error = null,
  onCancel,
  onSubmit,
}) => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [focus, setFocus] = useState<FocusField>('email');
  const [shift, setShift] = useState(false);
  const [layout, setLayout] = useState<KeyboardLayout>('letters');
  const emailRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);

  const activeRef = focus === 'email' ? emailRef : passwordRef;

  useEffect(() => {
    activeRef.current?.focus();
  }, [focus, activeRef]);

  const applyChar = useCallback(
    (ch: string) => {
      const nextCh = shift && /^[a-z]$/.test(ch) ? ch.toUpperCase() : ch;
      const el = activeRef.current;
      if (focus === 'email') {
        const { next, caret } = insertAtCursor(
          email,
          nextCh,
          el?.selectionStart ?? null,
          el?.selectionEnd ?? null
        );
        setEmail(next);
        requestAnimationFrame(() => {
          emailRef.current?.focus();
          emailRef.current?.setSelectionRange(caret, caret);
        });
      } else {
        const { next, caret } = insertAtCursor(
          password,
          nextCh,
          el?.selectionStart ?? null,
          el?.selectionEnd ?? null
        );
        setPassword(next);
        requestAnimationFrame(() => {
          passwordRef.current?.focus();
          passwordRef.current?.setSelectionRange(caret, caret);
        });
      }
      if (shift) setShift(false);
    },
    [activeRef, email, focus, password, shift]
  );

  const backspace = useCallback(() => {
    const el = activeRef.current;
    const start = el?.selectionStart ?? null;
    const end = el?.selectionEnd ?? null;
    if (focus === 'email') {
      if (start != null && end != null && start !== end) {
        const next = email.slice(0, start) + email.slice(end);
        setEmail(next);
        requestAnimationFrame(() => {
          emailRef.current?.focus();
          emailRef.current?.setSelectionRange(start, start);
        });
        return;
      }
      const caret = start ?? email.length;
      if (caret <= 0) return;
      const next = email.slice(0, caret - 1) + email.slice(caret);
      setEmail(next);
      requestAnimationFrame(() => {
        emailRef.current?.focus();
        emailRef.current?.setSelectionRange(caret - 1, caret - 1);
      });
      return;
    }
    if (start != null && end != null && start !== end) {
      const next = password.slice(0, start) + password.slice(end);
      setPassword(next);
      requestAnimationFrame(() => {
        passwordRef.current?.focus();
        passwordRef.current?.setSelectionRange(start, start);
      });
      return;
    }
    const caret = start ?? password.length;
    if (caret <= 0) return;
    const next = password.slice(0, caret - 1) + password.slice(caret);
    setPassword(next);
    requestAnimationFrame(() => {
      passwordRef.current?.focus();
      passwordRef.current?.setSelectionRange(caret - 1, caret - 1);
    });
  }, [activeRef, email, focus, password]);

  const clearField = useCallback(() => {
    if (focus === 'email') {
      setEmail('');
      requestAnimationFrame(() => emailRef.current?.focus());
    } else {
      setPassword('');
      requestAnimationFrame(() => passwordRef.current?.focus());
    }
  }, [focus]);

  const canSubmit = !busy && email.trim().length > 0 && password.length > 0;
  const showSymbols = layout === 'symbols';

  const fieldShell = (active: boolean) =>
    `rounded-xl border px-3 py-2 text-left ${
      active
        ? 'border-sky-400/60 bg-sky-950/40 ring-1 ring-sky-400/30'
        : 'border-slate-700 bg-slate-900/60'
    }`;

  return (
    <div className="absolute inset-0 z-30 flex items-stretch justify-center bg-black/75 p-3">
      <form
        className="flex w-full max-w-[980px] flex-col rounded-2xl border border-slate-600/70 bg-[#0c1220] shadow-2xl overflow-hidden"
        onSubmit={(e) => {
          e.preventDefault();
          if (canSubmit) void onSubmit(email, password);
        }}
      >
        <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-slate-700/80">
          <div>
            <div className="text-sm font-bold text-white">Ops log sign-in</div>
            <div className="text-[11px] text-slate-400">
              Type with a physical keyboard or the on-screen keys · tap{' '}
              <span className="text-slate-300">!#1</span> for symbols
            </div>
          </div>
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="rounded-lg border border-slate-600 px-3 py-1.5 text-sm font-semibold text-slate-300 hover:bg-slate-800 disabled:opacity-50"
          >
            Cancel
          </button>
        </div>

        <div className="grid grid-cols-2 gap-3 px-4 pt-3">
          <label className={fieldShell(focus === 'email')}>
            <div className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold">Email</div>
            <input
              ref={emailRef}
              type="email"
              name="email"
              autoComplete="username"
              autoCapitalize="off"
              autoCorrect="off"
              spellCheck={false}
              inputMode="none"
              value={email}
              disabled={busy}
              onFocus={() => setFocus('email')}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              className="mt-0.5 w-full bg-transparent font-mono text-sm text-white outline-none placeholder:text-slate-600"
            />
          </label>
          <label className={fieldShell(focus === 'password')}>
            <div className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold">Password</div>
            <input
              ref={passwordRef}
              type="password"
              name="password"
              autoComplete="current-password"
              inputMode="none"
              value={password}
              disabled={busy}
              onFocus={() => setFocus('password')}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              className="mt-0.5 w-full bg-transparent font-mono text-sm text-white outline-none placeholder:text-slate-600"
            />
          </label>
        </div>

        {error ? (
          <div className="mx-4 mt-2 rounded-lg border border-rose-500/35 bg-rose-950/30 px-3 py-2 text-xs text-rose-200">
            {error}
          </div>
        ) : null}

        <div className="flex-1 flex flex-col justify-end gap-1.5 px-3 py-3 min-h-0">
          <div className="flex gap-1.5">
            {ROW1.map((k) => (
              <KeyBtn key={`n-${k}`} label={k} onPress={() => applyChar(k)} />
            ))}
          </div>

          {showSymbols ? (
            <>
              <div className="flex gap-1.5">
                {SYM_ROW2.map((k) => (
                  <KeyBtn key={`s2-${k}`} label={k} onPress={() => applyChar(k)} />
                ))}
              </div>
              <div className="flex gap-1.5">
                {SYM_ROW3.map((k) => (
                  <KeyBtn key={`s3-${k}`} label={k} onPress={() => applyChar(k)} />
                ))}
              </div>
              <div className="flex gap-1.5">
                <KeyBtn label="ABC" onPress={() => setLayout('letters')} />
                {SYM_ROW4.map((k) => (
                  <KeyBtn key={`s4-${k}`} label={k} onPress={() => applyChar(k)} />
                ))}
                <KeyBtn label="⌫" onPress={backspace} />
              </div>
            </>
          ) : (
            <>
              <div className="flex gap-1.5">
                {ROW2.map((k) => (
                  <KeyBtn
                    key={`l2-${k}`}
                    label={shift ? k.toUpperCase() : k}
                    onPress={() => applyChar(k)}
                  />
                ))}
              </div>
              <div className="flex gap-1.5 px-4">
                {ROW3.map((k) => (
                  <KeyBtn
                    key={`l3-${k}`}
                    label={shift ? k.toUpperCase() : k}
                    onPress={() => applyChar(k)}
                  />
                ))}
              </div>
              <div className="flex gap-1.5">
                <KeyBtn label={shift ? 'SHIFT' : 'Shift'} active={shift} onPress={() => setShift((s) => !s)} />
                {ROW4_LETTERS.map((k) => (
                  <KeyBtn
                    key={`l4-${k}`}
                    label={shift && /^[a-z]$/.test(k) ? k.toUpperCase() : k}
                    onPress={() => applyChar(k)}
                  />
                ))}
                <KeyBtn label="⌫" onPress={backspace} />
              </div>
            </>
          )}

          <div className="flex gap-1.5">
            <KeyBtn
              label={showSymbols ? 'ABC' : '!#1'}
              active={showSymbols}
              onPress={() => setLayout((l) => (l === 'symbols' ? 'letters' : 'symbols'))}
            />
            <KeyBtn label="Clear" onPress={clearField} />
            <KeyBtn label="Space" wide onPress={() => applyChar(' ')} />
            <KeyBtn
              label={focus === 'email' ? 'Next →' : '← Email'}
              onPress={() => setFocus((f) => (f === 'email' ? 'password' : 'email'))}
            />
            <button
              type="submit"
              disabled={!canSubmit}
              className="min-h-[44px] flex-[1.8] rounded-lg border border-emerald-500/50 bg-emerald-500/25 px-3 text-sm font-bold text-emerald-50 hover:bg-emerald-500/35 disabled:opacity-40 touch-manipulation active:scale-95"
            >
              {busy ? 'Signing in…' : 'Sign in'}
            </button>
          </div>
        </div>
      </form>
    </div>
  );
};

export default UltritouchOpsLogin;
