// lib/chat/realtime.ts
// Local-only realtime bus (no external services). Provides a simple publish/subscribe API.

export type RealtimeEvent<T = any> = {
  type: string;
  payload: T;
  ts: number;
};

class LocalBus {
  private channels = new Map<string, Set<(event: RealtimeEvent) => void>>();

  subscribe(channel: string, handler: (event: RealtimeEvent) => void): () => void {
    let set = this.channels.get(channel);
    if (!set) {
      set = new Set();
      this.channels.set(channel, set);
    }
    set.add(handler);
    return () => {
      set?.delete(handler);
      if (set && set.size === 0) this.channels.delete(channel);
    };
  }

  publish<T = any>(channel: string, type: string, payload: T) {
    const event: RealtimeEvent<T> = { type, payload, ts: Date.now() };
    const listeners = this.channels.get(channel);
    if (!listeners || listeners.size === 0) return;
    // Microtask to simulate async delivery
    Promise.resolve().then(() => {
      listeners.forEach((fn) => {
        try { fn(event); } catch (e) { /* no-op */ }
      });
    });
  }
}

export const bus = new LocalBus();

// Helpers for chat channels
export const chatChannel = (chatId: string) => `chat:${chatId}`;
export const CHAT_EVENT_NEW_MESSAGE = 'chat:new_message';