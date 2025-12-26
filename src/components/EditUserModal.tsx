// components/EditUserModal.tsx
import '../App.css';
import { useEffect, useRef } from 'react';

interface EditUserModalProps {
  showEditModal: boolean;
  setShowEditModal: (v: boolean) => void;
  editUsername: string;
  setEditUsername: (v: string) => void;
  handleSaveEdit: () => void;
}

export default function EditUserModal({
  showEditModal,
  setShowEditModal,
  editUsername,
  setEditUsername,
  handleSaveEdit
}: EditUserModalProps) {
  const inputRef = useRef<HTMLInputElement>(null);

  // Auto-focus when modal opens
  useEffect(() => {
    if (showEditModal && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [showEditModal]);

  if (!showEditModal) return null;

  return (
    <div className="modal-overlay" onClick={() => setShowEditModal(false)}>
      <div className="modal-content small" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="modal-header">
          <h2>Edit Username</h2>
          <button
            onClick={() => setShowEditModal(false)}
            className="modal-close"
            aria-label="Close modal"
          >
            ×
          </button>
        </div>

        {/* Body */}
        <div className="modal-body">
          <input
            ref={inputRef}
            type="text"
            value={editUsername}
            onChange={(e) => setEditUsername(e.target.value)}
            onKeyPress={(e) => e.key === "Enter" && handleSaveEdit()}
            placeholder="Enter new username..."
            className="username-input"
            aria-label="Username input"
          />

          <div className="modal-actions">
            <button
              onClick={() => setShowEditModal(false)}
              className="cancel-btn"
            >
              Cancel
            </button>

            <button
              onClick={handleSaveEdit}
              className="save-btn"
            >
              Save
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}