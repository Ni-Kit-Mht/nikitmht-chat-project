// hooks/useWebSocketChat.ts
// Centralized WebSocket + chat management logic with backend sync

import { useState, useEffect, useRef } from "react";
import type { Message } from "../types/Message";
import type { User } from "../types/Users";
import { useWebSocketConfig } from "../components/WebSocketConfig";

export function useWebSocketChat() {
  // ---------------------------
  // State
  // ---------------------------
  const [messages, setMessages] = useState<Message[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [currentUserId, setCurrentUserId] = useState<string>("1");
  const [toUserId, setToUserId] = useState<string>("2");
  const [text, setText] = useState<string>("");
  const [newUsername, setNewUsername] = useState("");
  const [showAddUserModal, setShowAddUserModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [editingUserId, setEditingUserId] = useState("");
  const [editUsername, setEditUsername] = useState("");
  const [connectionStatus, setConnectionStatus] =
    useState<"connecting" | "connected" | "disconnected">("connecting");
  const [typingIndicators, setTypingIndicators] = useState<Map<string, boolean>>(
    new Map()
  );
  const [isUserNearBottom] = useState<boolean>(true);
  const [windowWidth, setWindowWidth] = useState(window.innerWidth);
  const { websocketUrl } = useWebSocketConfig();

  // ---------------------------
  // Refs
  // ---------------------------
  const ws = useRef<WebSocket | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const typingTimeoutRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(
    new Map()
  );
  const myTypingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isConnecting = useRef<boolean>(false);
  const reconnectAttempts = useRef<number>(0);
  const maxReconnectAttempts = 5;
  const hasInitializedUserId = useRef<boolean>(false);

  // ---------------------------
  // Helpers
  // ---------------------------
  const getUsernameById = (id: string) => {
    return users.find((u) => u.id === id)?.username || `User ${id}`;
  };

  const currentUser = users.find((u) => u.id === currentUserId);
  const currentUsername = currentUser?.username || "Unknown";

  // Responsive class helper
  const getResponsiveClass = () => {
    if (windowWidth < 640) return "mobile";
    if (windowWidth < 1024) return "tablet";
    return "desktop";
  };

  // ---------------------------
  // Auto User ID Detection
  // ---------------------------
  const findNextAvailableUserId = (existingUsers: User[]): string => {
    let userId = 1;
    const existingIds = new Set(existingUsers.map(u => u.id));
    
    while (existingIds.has(userId.toString())) {
      userId++;
    }
    
    return userId.toString();
  };

  // ---------------------------
  // Initialize User ID on First User List Received
  // ---------------------------
  useEffect(() => {
    if (users.length > 0 && !hasInitializedUserId.current) {
      const nextId = findNextAvailableUserId(users);
      console.log(`Auto-detected next available user ID: ${nextId}`);
      setCurrentUserId(nextId);
      hasInitializedUserId.current = true;
      
      // Set toUserId to an existing user (preferably the first one)
      if (users.length > 0) {
        setToUserId(users[0].id);
      }
    }
  }, [users]);

  // ---------------------------
  // WebSocket Connection
  // ---------------------------
  const { reconnectTrigger } = useWebSocketConfig();

  useEffect(() => {
    // Prevent multiple connections in React Strict Mode
    if (isConnecting.current) {
      console.log("Already connecting, skipping...");
      return;
    }

    if (ws.current?.readyState === WebSocket.OPEN) {
      console.log("WebSocket already open, skipping connection");
      return;
    }

    isConnecting.current = true;
    console.log(`Connecting to WebSocket as user ${currentUserId}...`);
    
    const socket = new WebSocket(websocketUrl);
    setConnectionStatus("connecting");

    socket.onopen = () => {
      console.log("WebSocket connected successfully");
      setConnectionStatus("connected");
      reconnectAttempts.current = 0;

      // Default users if none exist yet
      const defaultUsers = [
        { id: "1", username: "User 1" },
        { id: "2", username: "User 2" },
        { id: "3", username: "User 3" },
        { id: "4", username: "User 4" }
      ];

      const registrationData = {
        userId: currentUserId,
        username: users.find(u => u.id === currentUserId)?.username || 
                  defaultUsers.find(u => u.id === currentUserId)?.username || 
                  `User ${currentUserId}`
      };
      
      console.log("Sending registration:", registrationData);
      socket.send(JSON.stringify(registrationData));
    };

    socket.onmessage = (event) => {
      try {
        const received = JSON.parse(event.data);
        console.log("Received message:", received);

        // User list sync from backend
        if (received.type === "user_list" && Array.isArray(received.users)) {
          console.log("Updating user list:", received.users);
          const updatedUsers = received.users.map((u: any) => ({
            id: String(u.id),
            username: u.username,
            online: u.online
          }));
          
          setUsers(updatedUsers);
          
          // Auto-select next available user for toUserId if current toUserId is not available
          const currentToUser = updatedUsers.find((u: User) => u.id === toUserId);
          if (!currentToUser || currentToUser.id === currentUserId) {
            const availableUsers = updatedUsers.filter((u: User) => u.id !== currentUserId);
            if (availableUsers.length > 0) {
              setToUserId(availableUsers[0].id);
            }
          }
          return;
        }

        // System messages
        if (received.type === "system") {
          setMessages((prev) => [
            ...prev,
            {
              id: Date.now() + Math.random(),
              sender: "System",
              text: received.text,
              timestamp: new Date().toLocaleTimeString([], {
                hour: "2-digit",
                minute: "2-digit"
              }),
              type: "system"
            }
          ]);
          return;
        }

        // Typing indicator - FIXED to match backend format
        if (received.type === "typing" && received.typing !== undefined) {
          const fromId = String(received.from);
          const isTyping = received.typing === true;

          setTypingIndicators((prev) => {
            const map = new Map(prev);
            map.set(fromId, isTyping);
            return map;
          });

          if (typingTimeoutRef.current.has(fromId)) {
            clearTimeout(typingTimeoutRef.current.get(fromId));
          }

          if (isTyping) {
            const timeoutId = setTimeout(() => {
              setTypingIndicators((prev) => {
                const map = new Map(prev);
                map.delete(fromId);
                return map;
              });
            }, 2000);
            typingTimeoutRef.current.set(fromId, timeoutId);
          }
          return;
        }

        // Incoming direct message
        if (received.text && received.from !== currentUserId) {
          const fromUsername = received.fromUsername || `User ${received.from}`;

          setMessages((prev) => [
            ...prev,
            {
              id: Date.now() + Math.random(),
              sender: fromUsername,
              text: received.text,
              timestamp: new Date().toLocaleTimeString([], {
                hour: "2-digit",
                minute: "2-digit"
              })
            }
          ]);
          return;
        }
      } catch (err) {
        console.error("Invalid WS message", err);
      }
    };

    socket.onclose = (event) => {
      console.log(`WebSocket closed - Code: ${event.code}, Reason: ${event.reason || 'None'}`);
      setConnectionStatus("disconnected");
      isConnecting.current = false;
      
      // Auto-reconnect logic (optional)
      if (reconnectAttempts.current < maxReconnectAttempts) {
        reconnectAttempts.current++;
        console.log(`Attempting to reconnect (${reconnectAttempts.current}/${maxReconnectAttempts})...`);
        setTimeout(() => {
          if (!isConnecting.current && ws.current?.readyState !== WebSocket.OPEN) {
            // Trigger reconnection by updating a dummy state
            setConnectionStatus("connecting");
          }
        }, 2000 * reconnectAttempts.current);
      }
    };

    socket.onerror = (error) => {
      console.error("WebSocket error:", error);
      isConnecting.current = false;
    };

    ws.current = socket;

    // Cleanup
    return () => {
      console.log("Cleanup: closing WebSocket");
      isConnecting.current = false;
      if (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING) {
        socket.close();
      }
    };
  }, [currentUserId, websocketUrl, reconnectTrigger]);

  // ---------------------------
  // Sending messages
  // ---------------------------
  const handleSendMessage = () => {
    if (!text.trim() || ws.current?.readyState !== WebSocket.OPEN) return;

    const msg = {
      from: currentUserId,
      to: toUserId,
      text: text.trim()
    };

    ws.current.send(JSON.stringify(msg));

    // Local add
    setMessages((prev) => [
      ...prev,
      {
        id: Date.now() + Math.random(),
        sender: currentUsername,
        text: text.trim(),
        timestamp: new Date().toLocaleTimeString([], {
          hour: "2-digit",
          minute: "2-digit"
        })
      }
    ]);

    setText("");
  };

  // Typing with debounce - FIXED
  const handleTyping = () => {
    if (ws.current?.readyState !== WebSocket.OPEN) return;
    
    // Send typing = true
    ws.current.send(
      JSON.stringify({ 
        from: currentUserId, 
        to: toUserId, 
        typing: true 
      })
    );

    // Clear existing timeout
    if (myTypingTimeoutRef.current) {
      clearTimeout(myTypingTimeoutRef.current);
    }

    // Set new timeout to send typing = false after 1 second of inactivity
    myTypingTimeoutRef.current = setTimeout(() => {
      if (ws.current?.readyState === WebSocket.OPEN) {
        ws.current.send(
          JSON.stringify({ 
            from: currentUserId, 
            to: toUserId, 
            typing: false 
          })
        );
      }
    }, 1000);
  };

  // ---------------------------
  // User Management (Backend Synced)
  // ---------------------------
  const handleAddUser = () => {
    if (!newUsername.trim()) return;

    const newId = String(Math.max(0, ...users.map((u) => Number(u.id) || 0)) + 1);
    const newUser: User = { id: newId, username: newUsername.trim() };

    // Send to backend
    if (ws.current?.readyState === WebSocket.OPEN) {
      ws.current.send(JSON.stringify({
        type: "user_action",
        action: "add",
        newUser: newUser
      }));
    }

    // Automatically set the new user as the chat recipient
    setToUserId(newId);

    setNewUsername("");
    setShowAddUserModal(false);
    
    // Backend will broadcast updated user list to all clients
  };

  const handleEditUser = (userId: string) => {
    const user = users.find((u) => u.id === userId);
    if (!user) return;
    setEditingUserId(userId);
    setEditUsername(user.username);
    setShowEditModal(true);
  };

  const handleSaveEdit = () => {
    if (!editUsername.trim()) return;

    // Send to backend
    if (ws.current?.readyState === WebSocket.OPEN) {
      ws.current.send(JSON.stringify({
        type: "user_action",
        action: "edit",
        userId: editingUserId,
        newUsername: editUsername.trim()
      }));
    }

    setShowEditModal(false);
    setEditingUserId("");
    setEditUsername("");
    
    // Backend will broadcast updated user list to all clients
  };

  const handleDeleteUser = (userId: string) => {
    if (users.length <= 2) return alert("At least 2 users required!");
    if (userId === currentUserId) return alert("Cannot delete the current user!");

    // Send to backend
    if (ws.current?.readyState === WebSocket.OPEN) {
      ws.current.send(JSON.stringify({
        type: "user_action",
        action: "delete",
        userId: userId
      }));
    }

    // Update toUserId if needed
    if (toUserId === userId) {
      const remaining = users.filter((u) => u.id !== userId && u.id !== currentUserId);
      if (remaining.length > 0) setToUserId(remaining[0].id);
    }
    
    // Backend will broadcast updated user list to all clients
  };

  // ---------------------------
  // Window resize
  // ---------------------------
  useEffect(() => {
    const handleResize = () => setWindowWidth(window.innerWidth);
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  // ---------------------------
  // Return full chat API + WebSocket
  // ---------------------------
  return {
    messages,
    users,
    currentUserId,
    currentUsername,
    toUserId,
    text,
    newUsername,
    showAddUserModal,
    showEditModal,
    editUsername,
    editingUserId,
    typingIndicators,
    connectionStatus,
    isUserNearBottom,
    listRef,
    ws: ws.current, // Export WebSocket instance for call component

    // actions
    setText,
    setToUserId,
    handleTyping,
    handleSendMessage,
    handleAddUser,
    setNewUsername,
    setShowAddUserModal,
    handleEditUser,
    handleSaveEdit,
    handleDeleteUser,
    setShowEditModal,
    setEditUsername,
    setCurrentUserId,

    getUsernameById,
    getResponsiveClass
  };
}