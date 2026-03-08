export type ChatMessage = {
  id: string;
  senderId: string;
  text: string | null;
  createdAt: number; // ms
  imageUrl?: string | null;
  imageW?: number | null;
  imageH?: number | null;
  replyTo?: {
    id: string;
    text: string | null;
    senderName: string;
  } | null;
};

export type Conversation = {
  id: string;
  title: string; // display name
  lastMessageText?: string;
  lastMessageAt?: number;
  lastSenderId?: string;
  avatar?: string;
  noteText?: string; // optionnel: courte note affichée en bulle
  pinned?: boolean; // épinglé en haut de la liste
  partnerUid: string;
  partnerName?: string;
  partnerAvatar?: string;
  imageUrl?: string | null;
  imageW?: number | null;
  imageH?: number | null;
  readStatus?: Record<string, any>;
  hasMessages?: boolean;
};

export type ChatRequest = {
  id: string;
  from: string;
  to: string;
  status: 'pending' | 'accepted' | 'rejected';
  createdAt?: any;
  updatedAt?: any;
  messageText?: string; // texte optionnel inclus dans l'invitation
  imageUrl?: string;
  imageW?: number;
  imageH?: number;
  isSuper?: boolean;
};

export type MatchSummary = { 
  id: string; 
  users: string[]; 
  createdAt?: any; 
  lastMessageAt?: any; 
  lastMessageText?: string; 
  lastSenderId?: string;
  readStatus?: Record<string, any>;
};

export type FirestoreChatStatus = {
  typing?: boolean;
  readAt?: any; // Firestore Timestamp
  updatedAt?: any; // Firestore Timestamp
};
