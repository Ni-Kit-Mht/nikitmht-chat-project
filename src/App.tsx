// App.tsx
// Root container with view switching and call notifications

import { useState, useEffect, useRef } from 'react';
import ChatHeader from "./components/ChatHeader";
import MessagesContainer from "./components/MessagesContainer";
import MessageInput from "./components/MessageInput";
import UserManagerModal from "./components/UserManagerModal";
import EditUserModal from "./components/EditUserModal";
import { CallUsersComponent } from "./components/CallUsersComponent";
import { useWebSocketChat } from "./hooks/useWebSocketChat";
import './App.css';
import './index.css';

type ViewMode = 'chat' | 'call';

interface CallState {
  callId: string | null;
  status: 'idle' | 'calling' | 'incoming' | 'active' | 'ending' | 'reconnecting';
  callType: 'audio' | 'video';
  remoteUserId: string | null;
  remoteUsername: string | null;
}

function App() {
  const chat = useWebSocketChat();
  const [viewMode, setViewMode] = useState<ViewMode>('chat');
  const [hasIncomingCall, setHasIncomingCall] = useState(false);
  const [unreadMessages, setUnreadMessages] = useState(0);
  const [callState, setCallState] = useState<CallState>({
    callId: null,
    status: 'idle',
    callType: 'video',
    remoteUserId: null,
    remoteUsername: null,
  });
  
  // Store call state in ref to use in WebSocket handler
  const callStateRef = useRef(callState);
  useEffect(() => {
    callStateRef.current = callState;
  }, [callState]);

  // Listen for incoming calls and call-related messages
  useEffect(() => {
    const ws = chat.ws;
    if (!ws) return;

    const handleMessage = (event: MessageEvent) => {
      try {
        const data = JSON.parse(event.data);
        
        // Detect incoming call
        if (data.type === 'call_incoming') {
          setHasIncomingCall(true);
          setCallState({
            callId: data.callId,
            status: 'incoming',
            callType: data.callType,
            remoteUserId: data.from,
            remoteUsername: data.fromUsername,
          });
          
          // Auto-switch to call view if not already there
          // if (viewMode === 'chat') {
          //   // Optional: Auto-switch or just show notification
          //   // setViewMode('call');
          // }
        }
        
        // Reset incoming call flag when call ends
        if (data.type === 'call_ended' || data.type === 'call_rejected' || data.type === 'call_error') {
          setHasIncomingCall(false);
          setCallState(prev => ({
            ...prev,
            status: 'idle',
            callId: null,
            remoteUserId: null,
            remoteUsername: null,
          }));
        }
        
        // Handle call answered
        if (data.type === 'call_answered') {
          setHasIncomingCall(false);
          setCallState(prev => ({
            ...prev,
            status: 'active',
          }));
        }

        // Handle call initiation response
        if (data.type === 'call_initiated') {
          setCallState({
            callId: data.callId,
            status: 'calling',
            callType: data.callType,
            remoteUserId: data.to,
            remoteUsername: data.toUsername,
          });
        }

        // Track unread messages when in call view
        if (data.text && data.from && viewMode === 'call') {
          setUnreadMessages(prev => prev + 1);
        }
      } catch (error) {
        console.error('Error parsing message:', error);
      }
    };

    ws.addEventListener('message', handleMessage);

    return () => {
      ws?.removeEventListener('message', handleMessage);
    };
  }, [chat.ws, viewMode]);

  // Clear unread when switching to chat
  const handleViewChange = (mode: ViewMode) => {
    setViewMode(mode);
    if (mode === 'chat') {
      setUnreadMessages(0);
    }
    if (mode === 'call') {
      setHasIncomingCall(false);
    }
  };

  // Function to update call state from child components
  const updateCallState = (newState: Partial<CallState>) => {
    setCallState(prev => ({ ...prev, ...newState }));
  };

  // Reset call state completely
  const resetCallState = () => {
    setCallState({
      callId: null,
      status: 'idle',
      callType: 'video',
      remoteUserId: null,
      remoteUsername: null,
    });
    setHasIncomingCall(false);
  };

  return (
    <div className={`app-container ${chat.getResponsiveClass()}`}>
      {/* View Toggle Navigation with Notifications */}
      <div className="view-toggle-bar">
        <button
          className={`toggle-btn ${viewMode === 'chat' ? 'active' : ''}`}
          onClick={() => handleViewChange('chat')}
        >
          💬 Chat
          {unreadMessages > 0 && viewMode === 'call' && (
            <span className="notification-badge">{unreadMessages}</span>
          )}
        </button>
        <button
          className={`toggle-btn ${viewMode === 'call' ? 'active' : ''} ${hasIncomingCall ? 'incoming-call-pulse' : ''}`}
          onClick={() => handleViewChange('call')}
        >
          📞 Calls
          {hasIncomingCall && viewMode === 'chat' && (
            <span className="notification-badge incoming">!</span>
          )}
        </button>
      </div>

      {/* Conditional Rendering based on View Mode */}
      {viewMode === 'chat' ? (
        <div className="chat-view">
          <ChatHeader {...chat} />
          <MessagesContainer
            messages={chat.messages}
            currentUsername={chat.currentUsername}
            currentUserId={chat.currentUserId}
            typingIndicators={chat.typingIndicators}
            getUsernameById={chat.getUsernameById}
          />
          <MessageInput {...chat} />
          <UserManagerModal {...chat} />
          <EditUserModal {...chat} />
          
          {/* Show incoming call notification in chat view */}
          {callState.status === 'incoming' && (
            <div className="incoming-call-notification">
              <div className="notification-content">
                <p>📞 Incoming call from {callState.remoteUsername}</p>
                <button 
                  className="btn-switch-to-call"
                  onClick={() => {
                    handleViewChange('call');
                  }}
                >
                  Answer Call
                </button>
              </div>
            </div>
          )}
        </div>
      ) : (
        <div className="call-view">
          {/* Pass the shared WebSocket, state, and call state to CallUsersComponent */}
          <CallUsersComponent 
            ws={chat.ws}
            currentUserId={chat.currentUserId}
            users={(chat.users ?? []).map(u => ({ id: u.id, username: u.username, online: !!u.online }))}
            setCurrentUserId={chat.setCurrentUserId}
            connectionStatus={chat.connectionStatus}
            // Pass call state and handlers
            callState={callState}
            updateCallState={updateCallState}
            resetCallState={resetCallState}
          />
        </div>
      )}
    </div>
  );
}

export default App;