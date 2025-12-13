 export type WebSocketReceivedMessage = {
    typing: undefined;
    text: string;
    users: any;
    type: 'message' | 'system' | 'user_list';
    messageId: string;
    from: string;
    fromUsername: string;
    to: string;
    content?: string;
    timestamp?: number;
    // ... any other properties you expect
  };