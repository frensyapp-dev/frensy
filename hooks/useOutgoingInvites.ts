import { useState, useEffect } from 'react';
import { ChatRequest } from '../lib/chat/types';
import { listenMyOutgoingInvitations } from '../lib/chat/remoteSync';

export function useOutgoingInvites() {
  const [outgoing, setOutgoing] = useState<ChatRequest[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const unsub = listenMyOutgoingInvitations((reqs) => {
      setOutgoing(reqs);
      setLoading(false);
    });
    return () => unsub();
  }, []);

  const hasPendingInvite = (targetUid: string) => {
    return outgoing.some(req => req.to === targetUid && req.status === 'pending');
  };

  return { outgoing, loading, hasPendingInvite };
}
