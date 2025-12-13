// types/Message.ts
// Standard message interface used across the chat application

export interface Message {
  id: number;
  sender: string;
  text: string;
  timestamp: string;
  type?: "system" | "user";
}
