// components/MessageInput.tsx
// Input bar for sending messages + typing detection

import React from "react";
import '../App.css';

interface MessageInputProps {
  text: string;
  setText: (v: string) => void;
  handleTyping: () => void;
  handleSendMessage: () => void;
  connectionStatus: "connecting" | "connected" | "disconnected";
  toUserId: string;
  setToUserId: (v: string) => void;
  users: { id: string; username: string }[];
  currentUserId: string;
}

export default function MessageInput({
  text,
  setText,
  handleTyping,
  handleSendMessage,
  connectionStatus,
  toUserId,
  setToUserId,
  users,
  currentUserId
}: MessageInputProps) {
  const handleKeyPress = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  };

  return (
    <div className="input-container">
      {/* Recipient Selector */}
      <div className="recipient-selector">
        <label>Send to</label>
        <select
          value={toUserId}
          onChange={(e) => setToUserId(e.target.value)}
          className="recipient-select"
        >
          {users
            .filter((u) => u.id !== currentUserId)
            .map((u) => (
              <option key={u.id} value={u.id}>
                {u.username}
              </option>
            ))}
        </select>
      </div>

      {/* Message Input */}
      <input
        type="text"
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          if (e.target.value.trim()) handleTyping();
        }}
        onKeyPress={handleKeyPress}
        placeholder="Type your message..."
        disabled={connectionStatus !== "connected"}
        className="message-input"
      />

      {/* Send Button */}
      <button
        onClick={handleSendMessage}
        disabled={!text.trim() || connectionStatus !== "connected"}
        className="send-button"
      >
        Send
      </button>
    </div>
  );
}