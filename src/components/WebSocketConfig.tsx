import React, { createContext, useContext, useState } from "react";

type WebSocketContextType = {
  websocketUrl: string;
  setWebsocketUrl: (url: string) => void;
  reconnectTrigger: number; // Add reconnect counter
  triggerReconnect: () => void; // Add reconnect function
};

const WebSocketContext = createContext<WebSocketContextType | undefined>(
  undefined
);

export const WebSocketProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const [websocketUrl, setWebsocketUrl] = useState("wss://olympics-climbing-algebra-workstation.trycloudflare.com");
  const [reconnectTrigger, setReconnectTrigger] = useState(0); // Add reconnect trigger state

  // Function to manually trigger a reconnection
  const triggerReconnect = () => {
    console.log("WebSocketConfig: Triggering reconnection...");
    setReconnectTrigger(prev => prev + 1);
  };

  return (
    <WebSocketContext.Provider 
      value={{ 
        websocketUrl, 
        setWebsocketUrl,
        reconnectTrigger, // Include in context
        triggerReconnect // Include in context
      }}
    >
      {children}
    </WebSocketContext.Provider>
  );
};

export const useWebSocketConfig = () => {
  const ctx = useContext(WebSocketContext);
  if (!ctx) {
    throw new Error("useWebSocketConfig must be used inside WebSocketProvider");
  }
  return ctx;
};