import React, { useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import {
  getSegmentSpellcheckVersion,
  misspelledSegmentWords,
  normalizeSpellingOk,
  subscribeSegmentSpellcheck,
} from '../lib/segmentNameSpellcheck';

export function useSegmentNameSpelling(text: string, ignored?: unknown): string[] {
  const version = useSyncExternalStore(subscribeSegmentSpellcheck, getSegmentSpellcheckVersion);
  const ok = useMemo(() => normalizeSpellingOk(ignored), [ignored]);
  return useMemo(() => misspelledSegmentWords(text, ok), [text, version, ok]);
}

function SpellingWordRow({
  word,
  canFix,
  onConfirm,
  onFix,
}: {
  word: string;
  canFix: boolean;
  onConfirm: (word: string) => void;
  onFix: (from: string, to: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [typed, setTyped] = useState(word);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing) inputRef.current?.select();
  }, [editing]);

  return (
    <div className="rounded-lg bg-slate-800 px-3 py-2.5">
      <div className="mb-2 truncate text-sm font-semibold text-white" title={word}>
        {word}
      </div>
      {editing && canFix ? (
        <form
          className="flex items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            const next = typed.trim();
            if (!next || next === word) {
              setEditing(false);
              setTyped(word);
              return;
            }
            onFix(word, next);
          }}
        >
          <input
            ref={inputRef}
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                e.preventDefault();
                setEditing(false);
                setTyped(word);
              }
            }}
            className="h-8 min-w-0 flex-1 rounded-md border border-slate-500 bg-slate-900 px-2 text-sm text-white outline-none focus:border-yellow-300"
            aria-label={`Replace ${word}`}
          />
          <button
            type="submit"
            className="h-8 shrink-0 rounded-md bg-yellow-300 px-3 text-xs font-bold text-slate-900 hover:bg-yellow-200"
          >
            Save
          </button>
        </form>
      ) : (
        <div className={`grid gap-2 ${canFix ? 'grid-cols-2' : 'grid-cols-1'}`}>
          <button
            type="button"
            onClick={() => onConfirm(word)}
            className="h-8 rounded-md bg-yellow-300 text-xs font-bold text-slate-900 hover:bg-yellow-200"
          >
            Keep
          </button>
          {canFix ? (
            <button
              type="button"
              onClick={() => {
                setTyped(word);
                setEditing(true);
              }}
              className="h-8 rounded-md border border-slate-500 bg-slate-700 text-xs font-bold text-white hover:bg-slate-600"
            >
              Fix
            </button>
          ) : null}
        </div>
      )}
    </div>
  );
}

export function SegmentSpellingChip({
  words,
  canFix,
  canAskRos,
  asked,
  onConfirm,
  onFix,
  onAskRos,
}: {
  words: string[];
  canFix: boolean;
  canAskRos?: boolean;
  asked?: boolean;
  onConfirm: (word: string) => void;
  onFix: (from: string, to: string) => void;
  onAskRos?: () => void;
}) {
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [cleared, setCleared] = useState<string[]>([]);
  const [panelPos, setPanelPos] = useState({ top: 0, left: 0 });

  const remaining = useMemo(() => {
    const skip = new Set(cleared);
    return words.filter((word) => !skip.has(word.toLowerCase()));
  }, [words, cleared]);

  useEffect(() => {
    setCleared((prev) => prev.filter((word) => words.some((w) => w.toLowerCase() === word)));
  }, [words]);

  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const btn = buttonRef.current;
      const panel = panelRef.current;
      if (!btn || !panel) return;
      const rect = btn.getBoundingClientRect();
      const width = panel.offsetWidth;
      const height = panel.offsetHeight;
      let left = rect.left;
      if (left + width > window.innerWidth - 8) left = window.innerWidth - 8 - width;
      if (left < 8) left = 8;
      let top = rect.bottom + 6;
      if (top + height > window.innerHeight - 8) top = rect.top - 6 - height;
      if (top < 8) top = 8;
      setPanelPos({ top, left });
    };
    place();
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [open, remaining.length]);

  useEffect(() => {
    if (!open) return;
    const onDoc = (event: MouseEvent) => {
      const target = event.target as Node | null;
      if (buttonRef.current?.contains(target)) return;
      if (panelRef.current?.contains(target)) return;
      setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  if (!remaining.length) return null;

  const confirmWord = (word: string) => {
    setCleared((prev) => (prev.includes(word.toLowerCase()) ? prev : [...prev, word.toLowerCase()]));
    onConfirm(word);
  };

  const label = remaining.length === 1 ? 'Spelling' : `Spelling · ${remaining.length}`;

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setOpen((prev) => !prev);
        }}
        className="self-start inline-flex items-center justify-center px-2 py-1 rounded-md text-xs font-bold bg-yellow-300 text-slate-900 border border-yellow-100 shadow-sm hover:bg-yellow-200"
        title="Review spelling"
        aria-expanded={open}
        aria-label={label}
      >
        {label}
      </button>
      {open
        ? createPortal(
            <div
              ref={panelRef}
              className="fixed z-[80] w-[248px] rounded-xl border border-slate-600 bg-slate-900 p-2 shadow-2xl"
              style={{ top: panelPos.top, left: panelPos.left }}
              onMouseDown={(e) => e.stopPropagation()}
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex flex-col gap-2">
                {remaining.map((word) => (
                  <SpellingWordRow
                    key={word}
                    word={word}
                    canFix={canFix}
                    onConfirm={confirmWord}
                    onFix={onFix}
                  />
                ))}
                {canAskRos ? (
                  <button
                    type="button"
                    onClick={() => onAskRos?.()}
                    className={
                      asked
                        ? 'h-8 rounded-md border border-yellow-300 bg-yellow-300/15 text-xs font-bold text-yellow-200 hover:bg-yellow-300/25'
                        : 'h-8 rounded-md border border-slate-500 bg-slate-800 text-xs font-bold text-white hover:bg-slate-700'
                    }
                  >
                    {asked ? 'On ROS' : 'Ask ROS'}
                  </button>
                ) : null}
              </div>
            </div>,
            document.body
          )
        : null}
    </>
  );
}
