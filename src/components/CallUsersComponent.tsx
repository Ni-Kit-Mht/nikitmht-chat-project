import { useEffect, useRef, useState } from "react";
import CallUsers from "./CallUsers";

// CallUsersComponent.tsx
interface User {
  id: string;
  username: string;
  online: boolean;
}

interface CallState {
  callId: string | null;
  status: 'idle' | 'calling' | 'incoming' | 'active' | 'reconnecting' | 'ending';
  callType: 'audio' | 'video';
  remoteUserId: string | null;
  remoteUsername: string | null;
  isPeerDisconnected?: boolean;
  reconnectAttempts?: number;
}

// First, update the interface to include answerCall
interface CallUsersComponentProps {
  ws: WebSocket | null;
  currentUserId: string;
  users: User[];
  setCurrentUserId: (userId: string) => void;
  connectionStatus: 'connecting' | 'connected' | 'disconnected';
  callState: CallState;
  updateCallState: (state: Partial<CallState>) => void;
  resetCallState: () => void;
}

export const CallUsersComponent: React.FC<CallUsersComponentProps> = ({
  ws,
  currentUserId,
  users,
  setCurrentUserId,
  connectionStatus,
}) => {
  const heartbeatIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pendingMessagesRef = useRef<any[]>([]);
  // Initialize call state properly
const [callState, setCallState] = useState<CallState>({
  callId: null,
  status: 'idle',
  callType: 'audio',
  remoteUserId: null,
  remoteUsername: null,
  isPeerDisconnected: false,
  reconnectAttempts: 0
});


// Update call state function
const updateCallState = (updates: Partial<CallState>) => {
  setCallState(prev => ({ ...prev, ...updates }));
  console.log(`📞 Call state updated:`, { ...callState, ...updates });
};
// Reset call state function
const resetCallState = () => {
  console.log('🔄 Resetting call state');
  setCallState({
    callId: null,
    status: 'idle',
    callType: 'audio',
    remoteUserId: null,
    remoteUsername: null,
    isPeerDisconnected: false,
    reconnectAttempts: 0
  });
};

// Add this useEffect to listen for call state changes
useEffect(() => {
  console.log(`📞 Current call state:`, callState);
}, [callState]);


  // Handle WebSocket reconnection
  useEffect(() => {
    if (!ws) return;

    const handleOpen = () => {
      console.log('🔄 WebSocket reconnected');
      
      if (callState.callId && callState.status !== 'idle') {
        ws.send(JSON.stringify({
          type: 'call_reconnected',
          callId: callState.callId
        }));

        if (pendingMessagesRef.current.length > 0) {
          console.log(`📤 Resending ${pendingMessagesRef.current.length} pending messages`);
          pendingMessagesRef.current.forEach(msg => {
            setTimeout(() => ws.send(JSON.stringify(msg)), 100);
          });
          pendingMessagesRef.current = [];
        }
      }
    };

    ws.addEventListener('open', handleOpen);
    return () => ws.removeEventListener('open', handleOpen);
  }, [ws, callState.callId, callState.status]);

// Handle incoming WebSocket messages for reconnection
useEffect(() => {
  if (!ws) return;

  const handleMessage = (event: MessageEvent) => {
    try {
      const data = JSON.parse(event.data);
      console.log(`📨 Received WebSocket message:`, data);

      switch (data.type) {
        case 'call_initiated':
          console.log('✅ Call initiated confirmed by server');
          updateCallState({
            callId: data.callId,
            status: 'calling' // Keep as calling until answered
          });
          break;

        case 'call_incoming':
          console.log(`📞 Incoming call from ${data.fromUsername}`);
          updateCallState({
            callId: data.callId,
            status: 'incoming',
            callType: data.callType,
            remoteUserId: data.from,
            remoteUsername: data.fromUsername,
          });
          break;

        case 'call_answered':
          console.log('✅ Call answered by recipient');
          // Note: Actual active state will be set when WebRTC connects
          break;

        // ... rest of your cases ...
      }
    } catch (error) {
      console.error('Error handling WebSocket message:', error);
    }
  };

  ws.addEventListener('message', handleMessage);
  return () => ws.removeEventListener('message', handleMessage);
}, [ws, callState.callId, callState.status]);


  // Start heartbeat for active calls
  useEffect(() => {
    if (callState.status === 'active' && callState.callId) {
      console.log('💓 Starting heartbeat interval');
      
      heartbeatIntervalRef.current = setInterval(() => {
        sendMessage({
          type: 'call_heartbeat',
          callId: callState.callId
        });
      }, 15000);

      return () => {
        if (heartbeatIntervalRef.current) {
          clearInterval(heartbeatIntervalRef.current);
          heartbeatIntervalRef.current = null;
        }
      };
    }
  }, [callState.status, callState.callId]);

  // Send message with retry logic
  const sendMessage = (message: any, retries = 3): boolean => {
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      if (callState.status === 'reconnecting' || connectionStatus === 'connecting') {
        console.log('📦 Storing message for later delivery');
        pendingMessagesRef.current.push(message);
        return false;
      }
      return false;
    }

    try {
      ws.send(JSON.stringify(message));
      return true;
    } catch (error) {
      console.error('Error sending message:', error);
      
      if (retries > 0) {
        setTimeout(() => sendMessage(message, retries - 1), 1000);
      } else {
        pendingMessagesRef.current.push(message);
      }
      return false;
    }
  };

  // Switch to another user
  const switchUser = (userId: string) => {
    if (callState.status !== 'idle') {
      alert('Cannot switch users during an active call');
      return;
    }

    setCurrentUserId(userId);
    resetCallState();
    pendingMessagesRef.current = [];
  };

 // Initiate call with retry logic
const initiateCall = (to: string, type: 'audio' | 'video') => {
  if (!ws) {
    alert('WebSocket not initialized');
    return;
  }

  if (ws.readyState !== WebSocket.OPEN) {
    alert('WebSocket not connected. Please wait...');
    return;
  }

  const targetUser = users.find((u) => u.id === to);
  if (!targetUser) {
    alert('User not found');
    return;
  }

  if (!targetUser.online) {
    alert('User is offline');
    return;
  }

  if (callState.status !== 'idle') {
    alert('You are already in a call');
    return;
  }

  // CRITICAL: Update call state immediately
  updateCallState({
    status: 'calling',
    callType: type,
    remoteUserId: to,
    remoteUsername: targetUser.username,
    callId: null // Will be set by server response
  });

  console.log(`📞 Initiating ${type} call to ${targetUser.username}`);

  const success = sendMessage({
    type: 'call_initiate',
    to: to,
    callType: type,
  });

  if (!success) {
    console.warn('Failed to send call initiate, will retry...');
    // Reset state if failed to send
    setTimeout(() => {
      if (callState.status === 'calling' && !callState.callId) {
        updateCallState({ status: 'idle' });
      }
    }, 3000);
  }
};


  const availableUsers = users.filter((u) => u.id !== currentUserId);
  const onlineUsers = availableUsers.filter((u) => u.online);
  const currentUser = users.find((u) => u.id === currentUserId);

  const getConnectionDisplay = () => {
    if (connectionStatus === 'connected') {
      return { text: '● Connected to WebSocket', className: 'connected' };
    } else if (connectionStatus === 'connecting') {
      return { text: '● Connecting...', className: 'connecting' };
    } else {
      return { text: '○ Disconnected', className: 'disconnected' };
    }
  };

  const connectionDisplay = getConnectionDisplay();

  const getCallStatusDisplay = () => {
    if (callState.status === 'idle') return null;

    const statusText = {
      calling: '📞 Calling...',
      incoming: '📱 Incoming call',
      active: callState.isPeerDisconnected ? '⏳ Peer reconnecting...' : '✅ Call active',
      reconnecting: '🔄 Reconnecting...',
      ending: '🔴 Ending call...'
    }[callState.status] || '';

    const statusClass = callState.status === 'reconnecting' || callState.isPeerDisconnected 
      ? 'warning' 
      : callState.status === 'active' 
      ? 'success' 
      : 'info';

    return (
      <div className={`call-status-banner ${statusClass}`}>
        <span>{statusText}</span>
        {callState.remoteUsername && (
          <span className="remote-user"> with {callState.remoteUsername}</span>
        )}
      </div>
    );
  };

  return (
    <div className="call-demo-app">
      <div className="demo-header">
        <h1>📞 WebRTC Video Call Demo</h1>
        <p className="subtitle">Test end-to-end calling between users with reconnection support</p>
      </div>

      <div className="connection-status">
        <span className={`status-indicator ${connectionDisplay.className}`}>
          {connectionDisplay.text}
        </span>
        <span className="user-count">
          {users.length} user{users.length !== 1 ? 's' : ''} registered
        </span>
        {connectionStatus === 'connecting' && (
          <span className="reconnect-info">Attempting to reconnect...</span>
        )}
      </div>

      {getCallStatusDisplay()}

      <div className="demo-container">
        <div className="section current-user-section">
          <h2>🎭 Current User</h2>
          <div className="user-card current">
            <div className="user-avatar">{currentUserId}</div>
            <div className="user-info">
              <h3>{currentUser?.username}</h3>
              <span className="status online">● Online</span>
            </div>
          </div>

          <div className="switch-user">
            <label>Switch to another user:</label>
            <div className="user-buttons">
              {['1', '2', '3', '4'].map((id) => (
                <button
                  key={id}
                  className={`user-btn ${currentUserId === id ? 'active' : ''}`}
                  onClick={() => switchUser(id)}
                  disabled={currentUserId === id || callState.status !== 'idle'}
                  title={callState.status !== 'idle' ? 'Cannot switch during call' : ''}
                >
                  User {id}
                </button>
              ))}
            </div>
            {callState.status !== 'idle' && (
              <p className="switch-disabled-info">End the current call to switch users</p>
            )}
          </div>
        </div>

        <div className="section users-section">
          <h2>👥 Available Users</h2>
          <div className="users-grid">
            {availableUsers.map((user) => (
              <div key={user.id} className={`user-card ${user.online ? 'online' : 'offline'}`}>
                <div className="user-avatar">{user.id}</div>
                <div className="user-info">
                  <h3>{user.username}</h3>
                  <span className={`status ${user.online ? 'online' : 'offline'}`}>
                    {user.online ? '● Online' : '○ Offline'}
                  </span>
                </div>
                {user.online && (
                  <div className="call-actions">
                    <button
                      className="call-btn video"
                      onClick={() => initiateCall(user.id, 'video')}
                      title="Video Call"
                      disabled={callState.status !== 'idle' || connectionStatus !== 'connected'}
                    >
                      🎥 Video
                    </button>
                    <button
                      className="call-btn audio"
                      onClick={() => initiateCall(user.id, 'audio')}
                      title="Audio Call"
                      disabled={callState.status !== 'idle' || connectionStatus !== 'connected'}
                    >
                      📞 Audio
                    </button>
                  </div>
                )}
                {callState.status !== 'idle' && (
                  <div className="call-disabled-overlay">In call</div>
                )}
              </div>
            ))}
          </div>

          {onlineUsers.length === 0 && (
            <div className="no-users">
              <p>No other users online.</p>
              <p className="hint">Open this page in multiple tabs or devices to test calling.</p>
            </div>
          )}
        </div>
      </div>

      {(callState.status === 'reconnecting' || callState.isPeerDisconnected) && (
        <div className="reconnection-panel">
          <div className="reconnection-content">
            <div className="spinner"></div>
            <div className="reconnection-text">
              <h3>
                {callState.isPeerDisconnected 
                  ? '⏳ Waiting for peer to reconnect...' 
                  : '🔄 Reconnecting to call...'}
              </h3>
              <p>
                {callState.isPeerDisconnected
                  ? 'The other person temporarily lost connection. The call will resume when they reconnect.'
                  : 'Your connection was interrupted. Attempting to restore the call...'}
              </p>
              <div className="reconnection-timer">Grace period: 30 seconds</div>
            </div>
          </div>
        </div>
      )}
<div className="debug-panel" style={{
  position: 'fixed',
  bottom: '10px',
  right: '10px',
  background: 'rgba(0,0,0,0.8)',
  color: '#0f0',
  padding: '10px',
  fontSize: '12px',
  fontFamily: 'monospace',
  zIndex: 1000,
  maxWidth: '300px',
  borderRadius: '5px'
}}>
  <div style={{ fontWeight: 'bold', marginBottom: '5px' }}>Debug Info:</div>
  <div>WS Status: {ws?.readyState === WebSocket.OPEN ? 'Open' : 'Closed'}</div>
  <div>Call Status: {callState.status}</div>
  <div>Call ID: {callState.callId || 'None'}</div>
  <div>Remote: {callState.remoteUsername || 'None'}</div>
  <button 
    onClick={() => console.log('Call State:', callState)}
    style={{ marginTop: '5px', padding: '2px 5px', fontSize: '10px' }}
  >
    Log State
  </button>
</div>
      <CallUsers
      ws={ws} 
      currentUserId={currentUserId} 
      users={users} 
      callState={callState}
      updateCallState={updateCallState}
      resetCallState={resetCallState}
      sendMessage={sendMessage}
      // Remove the answerCall prop since CallUsers handles it internally
    />
    </div>
  );
};