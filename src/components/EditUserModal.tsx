// components/EditUserModal.tsx
// Modal for editing a user's username
import '../App.css';

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
          >
            ×
          </button>
        </div>

        {/* Body */}
        <div className="modal-body">
          <input
            type="text"
            value={editUsername}
            onChange={(e) => setEditUsername(e.target.value)}
            onKeyPress={(e) => e.key === "Enter" && handleSaveEdit()}
            placeholder="Enter new username..."
            className="username-input"
            autoFocus
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