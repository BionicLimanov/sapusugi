export interface Note {
  id: string;
  title: string;
  content: string;
  updated_at: string;
  created_at: string;
}

export interface ChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

export interface JupyterInfo {
  url: string;
  token: string;
}