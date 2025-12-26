import React, { useState } from "react";
import { useWebSocketConfig } from "./WebSocketConfig";

const suggestions = [
  "ws://localhost:8080",
  "wss://your-tunnel-url.ngrok.app",
];

function formatWebSocketUrl(input: string): string | null {
  let value = input.trim();
  
  // Convert https:// to wss://
  if (value.startsWith("https://")) {
    value = value.replace("https://", "wss://");
  }
  // Convert http:// to ws://
  else if (value.startsWith("http://")) {
    value = value.replace("http://", "ws://");
  }
  // If no protocol, add ws://
  else if (!value.startsWith("ws://") && !value.startsWith("wss://")) {
    value = "ws://" + value;
  }
  
  try {
    new URL(value);
    return value;
  } catch {
    return null;
  }
}

// Modal styles
const modalStyles = {
  overlay: {
    position: "fixed" as const,
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: "rgba(0, 0, 0, 0.5)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    zIndex: 1000,
  },
  modal: {
    backgroundColor: "#1e1e1e",
    borderRadius: "12px",
    padding: "24px",
    width: "400px",
    maxWidth: "90%",
    boxShadow: "0 8px 32px rgba(0, 0, 0, 0.3)",
  },
  title: {
    color: "#ffffff",
    margin: "0 0 20px 0",
    fontSize: "1.25rem",
    display: "flex",
    alignItems: "center",
    gap: "10px",
  },
  input: {
    width: "100%",
    padding: "10px 14px",
    fontSize: "14px",
    border: "2px solid #333",
    borderRadius: "6px",
    backgroundColor: "#2d2d2d",
    color: "#ffffff",
    outline: "none",
    marginBottom: "15px",
  },
  suggestions: {
    marginTop: "15px",
    paddingTop: "15px",
    borderTop: "1px solid #333",
  },
  suggestionBtn: {
    backgroundColor: "transparent",
    color: "#66b2ff",
    border: "1px solid #444",
    padding: "6px 12px",
    marginBottom: "6px",
    borderRadius: "4px",
    cursor: "pointer",
    fontSize: "13px",
    width: "100%",
    textAlign: "left" as const,
  },
  buttonGroup: {
    display: "flex",
    gap: "10px",
    marginTop: "20px",
  },
  connectBtn: {
    backgroundColor: "#007acc",
    color: "white",
    border: "none",
    padding: "10px 20px",
    borderRadius: "6px",
    cursor: "pointer",
    flex: 1,
  },
  cancelBtn: {
    backgroundColor: "#444",
    color: "white",
    border: "none",
    padding: "10px 20px",
    borderRadius: "6px",
    cursor: "pointer",
    flex: 1,
  },
  error: {
    color: "#ff6b6b",
    fontSize: "13px",
    marginBottom: "10px",
    backgroundColor: "rgba(255, 107, 107, 0.1)",
    padding: "8px",
    borderRadius: "4px",
  },
  currentUrl: {
    fontSize: "12px",
    color: "#aaa",
    marginBottom: "15px",
    wordBreak: "break-all" as const,
    padding: "8px",
    backgroundColor: "rgba(76, 175, 80, 0.1)",
    borderRadius: "4px",
    border: "1px solid rgba(76, 175, 80, 0.3)",
  },
};

// Icon styles
const iconStyles = {
  container: {
    position: "relative" as const,
    display: "inline-block",
  },
  button: {
    border: "none",
    color: "#666",
    cursor: "pointer",
    padding: "8px",
    fontSize: "18px",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    borderRadius: "4px",
    transition: "all 0.2s",
  },
  buttonHover: {
    backgroundColor: "rgba(0, 122, 204, 0.1)",
    color: "#007acc",
  },
  statusDot: {
    position: "absolute" as const,
    top: "4px",
    right: "4px",
    width: "8px",
    height: "8px",
    borderRadius: "50%",
  },
};

const ConnectToServer: React.FC = () => {
  const { 
    websocketUrl, 
    setWebsocketUrl, 
    triggerReconnect // Get the reconnect function
  } = useWebSocketConfig();
  const [showModal, setShowModal] = useState(false);
  const [input, setInput] = useState(websocketUrl);
  const [error, setError] = useState("");
  const [isHovered, setIsHovered] = useState(false);

  const handleConnect = () => {
    const formatted = formatWebSocketUrl(input);
    if (!formatted) {
      setError("Invalid WebSocket URL format");
      return;
    }
    setError("");
    setWebsocketUrl(formatted);
    triggerReconnect(); // Trigger reconnection after setting new URL
    setShowModal(false);
  };

  const handleSuggestionClick = (suggestion: string) => {
    setInput(suggestion);
  };

  const resetToCurrent = () => {
    setInput(websocketUrl);
    setError("");
  };

  return (
    <>
      <div style={iconStyles.container}>
        <button
          onClick={() => setShowModal(true)}
          onMouseEnter={() => setIsHovered(true)}
          onMouseLeave={() => setIsHovered(false)}
          style={{
            ...iconStyles.button,
            ...(isHovered ? iconStyles.buttonHover : {}),
            backgroundColor: isHovered ? "rgba(0, 122, 204, 0.1)" : "transparent",
          }}
          title="Configure WebSocket Server"
        >
          ⚙️
        </button>
        <div
          style={{
            ...iconStyles.statusDot,
            backgroundColor: websocketUrl.includes("localhost") ? "#4caf50" : "#ff9800",
          }}
        />
      </div>

      {showModal && (
        <div style={modalStyles.overlay} onClick={() => setShowModal(false)}>
          <div style={modalStyles.modal} onClick={(e) => e.stopPropagation()}>
            <h3 style={modalStyles.title}>
              <span>🔌</span>
              WebSocket Server Configuration
            </h3>

            {websocketUrl !== input && (
              <div style={modalStyles.currentUrl}>
                <strong>Current:</strong> {websocketUrl}
              </div>
            )}

            {error && <div style={modalStyles.error}>{error}</div>}

            <input
              type="text"
              value={input}
              onChange={(e) => {
                setInput(e.target.value);
                setError("");
              }}
              onKeyDown={(e) => e.key === "Enter" && handleConnect()}
              placeholder="Enter WebSocket URL (http/https will auto-convert)"
              style={modalStyles.input}
              autoFocus
            />

            <div style={modalStyles.suggestions}>
              <div style={{ color: "#aaa", fontSize: "12px", marginBottom: "8px" }}>
                Quick suggestions:
              </div>
              {suggestions.map((suggestion) => (
                <button
                  key={suggestion}
                  onClick={() => handleSuggestionClick(suggestion)}
                  style={modalStyles.suggestionBtn}
                >
                  {suggestion}
                </button>
              ))}
            </div>

            <div style={modalStyles.buttonGroup}>
              <button onClick={resetToCurrent} style={modalStyles.cancelBtn}>
                Reset
              </button>
              <button onClick={handleConnect} style={modalStyles.connectBtn}>
                Connect
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};

export default ConnectToServer;