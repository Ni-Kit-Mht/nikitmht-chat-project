// components/MessagesContainer.tsx
// Displays chat messages + system messages + scroll logic with auto-scroll

import { useEffect, useRef, useState } from "react";
import type { Message } from "../types/Message";
import '../App.css';

interface MessagesContainerProps {
  messages: Message[];
  currentUsername: string;
}

export default function MessagesContainer({
  messages,
  currentUsername
}: MessagesContainerProps) {
  const listRef = useRef<HTMLDivElement>(null);
  const [isUserNearBottom, setIsUserNearBottom] = useState<boolean>(true);
  const isScrollingProgrammatically = useRef<boolean>(false);
  const prevMessagesLength = useRef<number>(0);

  // Check if user is near bottom
  const checkIfNearBottom = () => {
    const container = listRef.current;
    if (!container) return;

    const { scrollTop, scrollHeight, clientHeight } = container;
    const distanceFromBottom = scrollHeight - scrollTop - clientHeight;
    
    // Consider "near bottom" if within 100px of the bottom
    setIsUserNearBottom(distanceFromBottom < 100);
  };

  // Scroll detection - Track if user is near bottom
  useEffect(() => {
    const container = listRef.current;
    if (!container) return;

    const handleScroll = () => {
      if (isScrollingProgrammatically.current) return;
      checkIfNearBottom();
    };

    container.addEventListener("scroll", handleScroll);
    return () => container.removeEventListener("scroll", handleScroll);
  }, []);

  // Handle window resize - recheck scroll position
  useEffect(() => {
    const handleResize = () => {
      checkIfNearBottom();
    };

    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  // Auto-scroll to bottom when new messages arrive (only if near bottom)
  useEffect(() => {
    if (messages.length > prevMessagesLength.current && isUserNearBottom) {
      const container = listRef.current;
      if (container) {
        isScrollingProgrammatically.current = true;
        container.scrollTo({
          top: container.scrollHeight,
          behavior: "smooth"
        });
        
        // Reset flag after scroll completes
        setTimeout(() => {
          isScrollingProgrammatically.current = false;
        }, 300);
      }
    }
    prevMessagesLength.current = messages.length;
  }, [messages, isUserNearBottom]);

  return (
    <div ref={listRef} className="messages-container">
      {messages.length === 0 ? (
        <div className="empty-state">
          <div className="empty-icon">💭</div>
          <div className="empty-text">No messages yet. Start a conversation!</div>
          <div className="empty-subtext">
            You are chatting as <strong>{currentUsername}</strong>
          </div>
        </div>
      ) : (
        messages.map((msg) => {
          const isCurrentUser = msg.sender === currentUsername;
          const isSystem = msg.type === "system";

          if (isSystem) {
            return (
              <div key={msg.id} className="system-message">
                {msg.text}
              </div>
            );
          }

          return (
            <div
              key={msg.id}
              className={`message-wrapper ${
                isCurrentUser ? "message-right" : "message-left"
              }`}
            >
              {!isCurrentUser && (
                <div className="message-sender">{msg.sender}</div>
              )}

              <div
                className={`message-bubble ${
                  isCurrentUser ? "message-sent" : "message-received"
                }`}
              >
                {msg.text}
              </div>

              <div className="message-timestamp">{msg.timestamp}</div>
            </div>
          );
        })
      )}

      {!isUserNearBottom && messages.length > 0 && (
        <button
          className="scroll-to-bottom-btn"
          onClick={() => {
            if (listRef.current) {
              isScrollingProgrammatically.current = true;
              listRef.current.scrollTo({
                top: listRef.current.scrollHeight,
                behavior: "smooth"
              });
              setTimeout(() => {
                isScrollingProgrammatically.current = false;
                setIsUserNearBottom(true);
              }, 300);
            }
          }}
          aria-label="Scroll to bottom"
        >
          <span className="new-messages-indicator">↓ New messages</span>
        </button>
      )}
    </div>
  );
}