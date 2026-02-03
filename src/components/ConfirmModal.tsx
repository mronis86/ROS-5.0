import React from 'react';

interface ConfirmModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  confirmClassName?: string;
}

const ConfirmModal: React.FC<ConfirmModalProps> = ({
  isOpen,
  onClose,
  onConfirm,
  title,
  message,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  confirmClassName = 'bg-blue-600 hover:bg-blue-500'
}) => {
  if (!isOpen) return null;
  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-[9999]">
      <div className="bg-slate-800 p-6 rounded-xl border border-slate-600 shadow-xl max-w-md mx-4">
        <h3 className="text-white text-xl font-semibold mb-2">{title}</h3>
        <p className="text-slate-300 mb-6">{message}</p>
        <div className="flex gap-3 justify-center">
          <button
            onClick={onClose}
            className="px-4 py-2 bg-slate-600 hover:bg-slate-500 text-white rounded-lg transition-colors"
          >
            {cancelLabel}
          </button>
          <button
            onClick={() => {
              onConfirm();
              onClose();
            }}
            className={`px-4 py-2 text-white rounded-lg transition-colors ${confirmClassName}`}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
};

export default ConfirmModal;
