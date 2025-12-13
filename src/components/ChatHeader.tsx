// components/ChatHeader.tsx
// Displays app header, connection status, user selector, typing indicators

import type { User } from "../types/Users";
import '../App.css';

interface ChatHeaderProps {
  users: User[];
  currentUserId: string;
  connectionStatus: "connecting" | "connected" | "disconnected";
  typingIndicators: Map<string, boolean>;
  getUsernameById: (id: string) => string;
  setCurrentUserId: (id: string) => void;
  setShowAddUserModal: (value: boolean) => void;
}

export default function ChatHeader({
  users,
  currentUserId,
  connectionStatus,
  typingIndicators,
  getUsernameById,
  setCurrentUserId,
  setShowAddUserModal
}: ChatHeaderProps) {
  const getStatusColor = () => {
    switch (connectionStatus) {
      case "connected":
        return "#10b981";
      case "connecting":
        return "#f59e0b";
      case "disconnected":
        return "#ef4444";
    }
  };

  const getStatusText = () => {
    switch (connectionStatus) {
      case "connected":
        return "Connected";
      case "connecting":
        return "Connecting...";
      case "disconnected":
        return "Disconnected";
    }
  };

  const typingUsers = Array.from(typingIndicators.entries())
    .filter(([_, isTyping]) => isTyping)
    .map(([userId]) => getUsernameById(userId));

  return (
    <header className="app-header">
      <div className="header-content">
        {/* Left Section */}
        <div className="header-left">
          <h1 className="app-title">💬 Chat App</h1>

          <div className="status-indicator">
            <span
              className="status-dot"
              style={{ backgroundColor: getStatusColor() }}
            />
            {getStatusText()}

            {typingUsers.length > 0 && (
              <span className="typing-status">
                • {typingUsers.join(", ")} {typingUsers.length === 1 ? "is" : "are"} typing
              </span>
            )}
          </div>
        </div>

        {/* Right Section */}
        <div className="header-right">
          <div className="user-label">Chatting as</div>

          <select
            value={currentUserId}
            onChange={(e) => setCurrentUserId(e.target.value)}
            className="user-select"
          >
            {users.map((user) => (
              <option key={user.id} value={user.id}>
                {user.username}
              </option>
            ))}
          </select>

          <button
            className="manage-users-btn"
            onClick={() => setShowAddUserModal(true)}
            title="Manage users"
          >
            ⚙️
          </button>
        </div>
      </div>
    </header>
  );
}