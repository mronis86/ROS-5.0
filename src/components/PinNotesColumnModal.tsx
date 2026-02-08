import React, { useState } from 'react';

export type PinNotesColumn = { type: 'notes' | 'custom' | 'cue'; id: string; name: string };

interface PinNotesColumnModalProps {
  customColumns: { id: string; name: string }[];
  onClose: () => void;
  onOpen: (selected: PinNotesColumn[]) => void;
}

const PinNotesColumnModal: React.FC<PinNotesColumnModalProps> = ({
  customColumns,
  onClose,
  onOpen,
}) => {
  const [selected, setSelected] = useState<PinNotesColumn[]>([{ type: 'notes', id: 'notes', name: 'Notes' }]);

  const toggle = (col: PinNotesColumn) => {
    setSelected((prev) => {
      const has = prev.some((c) => c.id === col.id && c.type === col.type);
      if (has) {
        const next = prev.filter((c) => !(c.id === col.id && c.type === col.type));
        return next.length > 0 ? next : prev;
      }
      return [...prev, col];
    });
  };

  const isSelected = (col: PinNotesColumn) =>
    selected.some((c) => c.id === col.id && c.type === col.type);

  const allOptions: PinNotesColumn[] = [
    { type: 'notes', id: 'notes', name: 'Notes' },
    ...customColumns.map((c) => ({ type: 'custom' as const, id: c.id, name: c.name })),
  ];

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-slate-800 rounded-lg p-6 w-full max-w-md">
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-xl font-bold text-white">Notes popout</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-white text-2xl">
            ×
          </button>
        </div>
        <p className="text-slate-300 text-sm mb-4">
          Choose one or more columns to show. The window will follow the current cue and show the current row plus the next 3 rows. You can change columns later inside the popout.
        </p>
        <div className="space-y-2 mb-6">
          {allOptions.map((col) => (
            <label
              key={col.type + col.id}
              className="flex items-center gap-3 px-4 py-3 bg-slate-700 hover:bg-slate-600 rounded-lg cursor-pointer transition-colors"
            >
              <input
                type="checkbox"
                checked={isSelected(col)}
                onChange={() => toggle(col)}
                className="w-5 h-5 rounded border-slate-500"
              />
              <span className="text-white font-medium">{col.name}</span>
            </label>
          ))}
        </div>
        <div className="flex gap-2 justify-end">
          <button
            onClick={onClose}
            className="px-4 py-2 bg-slate-600 hover:bg-slate-500 text-white rounded-lg transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={() => onOpen(selected)}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg transition-colors"
          >
            Open popout
          </button>
        </div>
      </div>
    </div>
  );
};

export default PinNotesColumnModal;
