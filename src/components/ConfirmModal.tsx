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
  /** Backdrop overlay; default is a light dim (e.g. bg-black/40) */
  backdropClassName?: string;
}

const ConfirmModal: React.FC<ConfirmModalProps> = ({
  isOpen,
  onClose,
  onConfirm,
  title,
  message,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  confirmClassName = 'bg-blue-600 hover:bg-blue-500',
  backdropClassName = 'bg-black/40',
}) => {
  if (!isOpen) return null;

  const handleConfirm = () => {
    onConfirm();
    onClose();
  };

  return (
    <div
      className={`fixed inset-0 ${backdropClassName} flex items-center justify-center z-[9999] p-4`}
      role="dialog"
      aria-modal="true"
      aria-labelledby="confirm-modal-title"
      aria-describedby="confirm-modal-desc"
    >
      <div className="bg-slate-800 border border-slate-600 p-8 rounded-xl shadow-2xl max-w-md w-full">
        <h2 id="confirm-modal-title" className="text-xl font-bold text-white mb-3">
          {title}
        </h2>
        <p id="confirm-modal-desc" className="text-slate-300 text-base mb-6 leading-relaxed">
          {message}
        </p>
        <div className="flex gap-3 justify-center">
          <button
            type="button"
            onClick={onClose}
            className="px-5 py-2.5 bg-slate-600 hover:bg-slate-500 text-white font-medium rounded-lg transition-colors"
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={handleConfirm}
            className={`px-5 py-2.5 text-white font-medium rounded-lg transition-colors ${confirmClassName}`}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
};

export default ConfirmModal;
