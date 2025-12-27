// App.tsx
// Simple root container - ONLY handles view switching between chat and call

import { useState, useEffect } from 'react';
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

function App() {
  const chat = useWebSocketChat();
  const [viewMode, setViewMode] = useState<ViewMode>('chat');
  const [unreadMessages, setUnreadMessages] = useState(0);
  const [hasIncomingCall, setHasIncomingCall] = useState(false);
  const [incomingCallInfo, setIncomingCallInfo] = useState<{
    from: string;
    callType: 'audio' | 'video';
  } | null>(null);

  // Listen ONLY for incoming call notifications to show badge
  useEffect(() => {
    const ws = chat.ws;
    if (!ws) return;

    const handleMessage = (event: MessageEvent) => {
      try {
        const data = JSON.parse(event.data);
        
        // Track incoming calls for notification badge
        if (data.type === 'call_incoming') {
          console.log('📞 App.tsx - Incoming call detected (for notification only)');
          setHasIncomingCall(true);
          setIncomingCallInfo({
            from: data.fromUsername,
            callType: data.callType
          });
        }
        
        // Clear notification when call ends
        if (data.type === 'call_ended' || data.type === 'call_rejected') {
          console.log('🔴 App.tsx - Call ended (clearing notification)');
          setHasIncomingCall(false);
          setIncomingCallInfo(null);
        }
        
        // Track unread chat messages when in call view
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

  // Handle view switching
  const handleViewChange = (mode: ViewMode) => {
    console.log(`🔄 Switching view to: ${mode}`);
    setViewMode(mode);
    
    if (mode === 'chat') {
      setUnreadMessages(0);
    }
    
    if (mode === 'call') {
      // Don't clear hasIncomingCall here - let CallUsersComponent handle the actual call
    }
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
          className={`toggle-btn ${viewMode === 'call' ? 'active' : ''} ${hasIncomingCall && viewMode === 'chat' ? 'incoming-call-pulse' : ''}`}
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
          {hasIncomingCall && incomingCallInfo && (
            <div className="incoming-call-notification">
              <div className="notification-content">
                <p>📞 Incoming {incomingCallInfo.callType} call from {incomingCallInfo.from}</p>
                <button 
                  className="btn-switch-to-call"
                  onClick={() => handleViewChange('call')}
                >
                  Go to Calls
                </button>
              </div>
            </div>
          )}
        </div>
      ) : (
        <div className="call-view">
          {/* CallUsersComponent manages ALL call state internally */}
          <CallUsersComponent 
            ws={chat.ws}
            currentUserId={chat.currentUserId}
            users={(chat.users ?? []).map(u => ({ 
              id: u.id, 
              username: u.username, 
              online: !!u.online 
            }))}
            setCurrentUserId={chat.setCurrentUserId}
            connectionStatus={chat.connectionStatus}
          />
        </div>
      )}
    </div>
  );
}

export default App;