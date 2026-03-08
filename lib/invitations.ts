import { createChatRequestRemote as createChatRequest } from './chat/remoteSync';
import { performActionUpdates } from './monetization';
import { getUserProfile, applyUserUpdates } from './profile';
import { auth } from '../firebaseconfig';
import { validateMessage } from './moderation';

export async function sendInvitation(targetUid: string, message?: string, isSuper: boolean = false) {
  const uid = auth.currentUser?.uid;
  if (!uid) throw new Error('Not authenticated');

  if (message) {
    const valid = validateMessage(message);
    if (!valid.valid) {
      throw new Error(valid.error);
    }
  }

  const profile = await getUserProfile(uid);
  if (!profile) throw new Error('Profile not found');

  const action = isSuper ? 'SUPER_INVITE' : 'INVITE';
  const check = performActionUpdates(profile, action);
  if (!check.allowed) {
    throw new Error(`ACTION_DENIED:${check.reason}`);
  }

  await createChatRequest(targetUid, message, undefined, undefined, undefined, isSuper);

  if (check.updates) {
    await applyUserUpdates(uid, check.updates);
  }
}
