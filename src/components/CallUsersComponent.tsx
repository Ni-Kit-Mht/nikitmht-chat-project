import CallUsers from "./CallUsers";

interface User {
  id: string;
  username: string;
  online: boolean;
}

interface CallUsersComponentProps {
  ws: WebSocket | null;
  currentUserId: string;
  users: User[];
  setCurrentUserId: (userId: string) => void;
  connectionStatus: 'connecting' | 'connected' | 'disconnected';
}

export const CallUsersComponent: React.FC<CallUsersComponentProps> = ({
  ws,
  currentUserId,
  users,
  setCurrentUserId,
  connectionStatus
}) => {
  const currentUser = users.find(u => u.id === currentUserId);
  const otherUsers = users.filter(u => u.id !== currentUserId);

  return (
    <div className="call-demo-app">
      <div className="demo-header">
        <h1>📞 WebRTC Call Demo</h1>
        <p className="subtitle">Simple peer-to-peer calling</p>
      </div>

      <div className="connection-status">
        <span className={`status-indicator ${connectionStatus}`}>
          {connectionStatus === 'connected' ? '● Connected' : 
           connectionStatus === 'connecting' ? '● Connecting...' : 
           '○ Disconnected'}
        </span>
        <span className="user-count">
          {users.length} users online
        </span>
      </div>

      <div className="demo-container">
        <div className="section current-user-section">
          <h2>🎭 You: {currentUser?.username}</h2>
          
          <div className="switch-user">
            <label>Switch user:</label>
            <div className="user-buttons">
              {['1', '2', '3', '4'].map(id => (
                <button
                  key={id}
                  className={currentUserId === id ? 'active' : ''}
                  onClick={() => setCurrentUserId(id)}
                  disabled={currentUserId === id}
                >
                  User {id}
                </button>
              ))}
            </div>
          </div>

          <CallUsers ws={ws} currentUserId={currentUserId} users={users} />
        </div>

        <div className="section users-section">
          <h2>👥 Other Users</h2>
          <div className="users-grid">
            {otherUsers.map(user => (
              <div key={user.id} className={`user-card ${user.online ? 'online' : 'offline'}`}>
                <div className="user-avatar">{user.id}</div>
                <div className="user-info">
                  <h3>{user.username}</h3>
                  <span className={`status ${user.online ? 'online' : 'offline'}`}>
                    {user.online ? '● Online' : '○ Offline'}
                  </span>
                </div>
              </div>
            ))}
          </div>

          {otherUsers.filter(u => u.online).length === 0 && (
            <div className="no-users">
              <p>No other users online</p>
              <p className="hint">Open in multiple tabs to test</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};