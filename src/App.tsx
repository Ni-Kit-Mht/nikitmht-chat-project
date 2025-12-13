// App.tsx
// Root container wiring the chat components together

import ChatHeader from "./components/ChatHeader";
import MessagesContainer from "./components/MessagesContainer";
import MessageInput from "./components/MessageInput";
import UserManagerModal from "./components/UserManagerModal";
import EditUserModal from "./components/EditUserModal";
import { useWebSocketChat } from "./hooks/useWebSocketChat";
import './App.css';

function App() {
  const chat = useWebSocketChat();

  return (
    <div className={`app-container ${chat.getResponsiveClass()}`}>
      <ChatHeader {...chat} />
      <MessagesContainer {...chat} />
      <MessageInput {...chat} />
      <UserManagerModal {...chat} />
      <EditUserModal {...chat} />
    </div>
  );
}

export default App;
