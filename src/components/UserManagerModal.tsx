// components/UserManagerModal.tsx
// Modal for adding new users + viewing/deleting existing users

import type { User } from "../types/Users";
import '../App.css';

interface UserManagerModalProps {
  showAddUserModal: boolean;
  setShowAddUserModal: (v: boolean) => void;
  newUsername: string;
  setNewUsername: (v: string) => void;
  users: User[];
  currentUserId: string;
  handleAddUser: () => void;
  handleEditUser: (id: string) => void;
  handleDeleteUser: (id: string) => void;
}

export default function UserManagerModal({
  showAddUserModal,
  setShowAddUserModal,
  newUsername,
  setNewUsername,
  users,
  currentUserId,
  handleAddUser,
  handleEditUser,
  handleDeleteUser
}: UserManagerModalProps) {
  if (!showAddUserModal) return null;

  return (
    <div className="modal-overlay" onClick={() => setShowAddUserModal(false)}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="modal-header">
          <h2>Manage Users</h2>
          <button
            onClick={() => setShowAddUserModal(false)}
            className="modal-close"
          >
            ×
          </button>
        </div>

        {/* Body */}
        <div className="modal-body">
          {/* Add User Section */}
          <div className="add-user-section">
            <h3>Add New User</h3>
            <div className="add-user-form">
              <input
                type="text"
                value={newUsername}
                onChange={(e) => setNewUsername(e.target.value)}
                onKeyPress={(e) => e.key === "Enter" && handleAddUser()}
                placeholder="Enter username..."
                className="username-input"
              />
              <button onClick={handleAddUser} className="add-btn">
                Add
              </button>
            </div>
          </div>

          {/* User List Section */}
          <div className="users-list-section">
            <h3>Current Users</h3>
            <div className="users-list">
              {users.map((user) => (
                <div key={user.id} className="user-item">
                  <span className="user-name">{user.username}</span>

                  <div className="user-actions">
                    {/* Edit Button */}
                    <button
                      onClick={() => handleEditUser(user.id)}
                      className="edit-btn"
                      title="Edit username"
                    >
                      ✏️
                    </button>

                    {/* Delete Button */}
                    <button
                      onClick={() => handleDeleteUser(user.id)}
                      className="delete-btn"
                      title="Delete user"
                      disabled={user.id === currentUserId || users.length <= 2}
                    >
                      🗑️
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}