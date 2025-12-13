// types/User.ts
// User structure including optional extended fields

export interface User {
  id: string;
  username: string;
  isTyping?: boolean;
  avatar?: string;
  online?: boolean;
}