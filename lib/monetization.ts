import dayjs from 'dayjs';
import { increment } from 'firebase/firestore';
import type { UserProfile } from "./profile";

export type SubscriptionTier = 'FREE' | 'PLUS' | 'PRO';export const SUBSCRIPTION_TIERS: Record<SubscriptionTier, SubscriptionTier> = {
  FREE: 'FREE',
  PLUS: 'PLUS',
  PRO: 'PRO',
};

export const COIN_PACKS = [
  { id: 'coins_30', amount: 30, price: 0.49, label: '30 Pins' },
  { id: 'coins_120', amount: 120, price: 0.99, label: '120 Pins', popular: true },
  { id: 'coins_300', amount: 300, price: 1.99, label: '300 Pins' },
  { id: 'coins_1000', amount: 1000, price: 4.99, label: '1000 Pins', bestValue: true },
  { id: 'coins_3500', amount: 3500, price: 14.99, label: '3500 Pins' },
];

export const SUBSCRIPTION_PLANS = {
  PLUS: [
    { id: 'plus_1m', durationMonths: 1, price: 4.99, label: '1 mois' },
    { id: 'plus_1y', durationMonths: 12, price: 29.99, label: '1 an', savings: '50%' }, // ≈ 2.50/mois
  ],
  PRO: [
    { id: 'pro_1m', durationMonths: 1, price: 9.99, label: '1 mois' },
    { id: 'pro_1y', durationMonths: 12, price: 59.99, label: '1 an', savings: '50%' }, // ≈ 5/mois
  ]
};

export const FEATURE_COSTS = {
  INVITE: 60,
  INVITE_BUNDLE_5: 250,
  INVITE_BUNDLE_15: 650,

  SUPER_INVITE: 120,
  SUPER_INVITE_BUNDLE_5: 500,
  SUPER_INVITE_BUNDLE_15: 1100,

  BOOST: 300,
  BOOST_BUNDLE_5: 1200,

  UNLOCK_LIKE: 30,
  UNLOCK_LIKE_BUNDLE_10: 250,

  UNDO: 20,
  SEND_PHOTO: 10,
};

export type UsageLimits = {
  invitesPerDay: number;
  invitesPerWeek: number;
  undoPerDay: number;
  boostPerWeek: number;
  superInvitesPerWeek: number;
  groupCreationPerMonth: number;
  showLikesDetails: boolean; // false = flouté, true = clair
  canCreateGroup: boolean;
  canInvite: boolean;
  filters: 'basic' | 'advanced' | 'all';
};

export function getLimits(tier: SubscriptionTier = 'FREE'): UsageLimits {
  switch (tier) {
    case 'PRO':
      return {
        invitesPerDay: Infinity,
        invitesPerWeek: 0,
        undoPerDay: Infinity,
        boostPerWeek: 3,
        superInvitesPerWeek: 3,
        groupCreationPerMonth: Infinity,
        showLikesDetails: true,
        canCreateGroup: true,
        canInvite: true,
        filters: 'all',
      };
    case 'PLUS':
      return {
        invitesPerDay: 3,
        invitesPerWeek: 0,
        undoPerDay: 3,
        boostPerWeek: 1,
        superInvitesPerWeek: 0,
        groupCreationPerMonth: 1,
        showLikesDetails: false,
        canCreateGroup: true,
        canInvite: true,
        filters: 'advanced', // Interests only, no age
      };
    case 'FREE':
    default:
      return {
        invitesPerDay: 0,
        invitesPerWeek: 0,
        undoPerDay: 0,
        boostPerWeek: 0,
        superInvitesPerWeek: 0,
        groupCreationPerMonth: 0,
        showLikesDetails: false,
        canCreateGroup: false,
        canInvite: false,
        filters: 'basic',
      };
  }
}

export type ActionType = 'INVITE' | 'UNDO' | 'BOOST' | 'SUPER_INVITE' | 'CREATE_GROUP' | 'UNLOCK_LIKE' | 'SEND_PHOTO';

export type ActionResult = {
  allowed: boolean;
  reason?: 'limit_reached' | 'subscription_required' | 'coins_required' | 'insufficient_coins';
  cost?: number;
  remaining?: number; // Remaining daily/weekly limit
  nextReset?: number;
  updates?: Partial<UserProfile>; // Fields to update in Firestore
};

// Check if user can perform action (read-only check)
export function canPerformAction(
  user: UserProfile, 
  action: ActionType
): ActionResult {
  const tier = user.subscription || 'FREE';
  const limits = getLimits(tier);
  const coins = user.pins || 0;

  switch (action) {
    case 'INVITE':
      // 0. Check Bonus Inventory
      if ((user.bonusInvites || 0) > 0) return { allowed: true };

      // Check limits based on tier
      if (limits.invitesPerDay === Infinity) return { allowed: true };

      if (limits.invitesPerDay > 0 && (user.invitesUsedToday || 0) < limits.invitesPerDay) {
          return { allowed: true, remaining: limits.invitesPerDay - (user.invitesUsedToday || 0) };
      }
      
      // Fallback to coins (Additional Invite)
      if (coins >= FEATURE_COSTS.INVITE) {
        return { allowed: true, cost: FEATURE_COSTS.INVITE };
      }
      
      // If we are here, limit reached and not enough coins
      return { allowed: false, reason: 'insufficient_coins' };
    
    case 'UNDO':
      // 0. Check Bonus Inventory
      if ((user.bonusUndos || 0) > 0) return { allowed: true };

      if (limits.undoPerDay === Infinity) return { allowed: true };
      
      if (limits.undoPerDay > 0 && (user.undoUsedToday || 0) < limits.undoPerDay) {
        return { allowed: true, remaining: limits.undoPerDay - (user.undoUsedToday || 0) };
      }
      
      // Fallback to coins (UNDO)
      if (coins >= FEATURE_COSTS.UNDO) {
        return { allowed: true, cost: FEATURE_COSTS.UNDO };
      }

      if (limits.undoPerDay === 0 && tier === 'FREE') return { allowed: false, reason: 'subscription_required' };
      
      return { allowed: false, reason: 'insufficient_coins' };

    case 'BOOST':
      // 0. Check Bonus Inventory
      if ((user.bonusBoosts || 0) > 0) return { allowed: true };

      if (limits.boostPerWeek > 0 && (user.boostsUsedThisWeek || 0) < limits.boostPerWeek) {
         return { allowed: true, remaining: limits.boostPerWeek - (user.boostsUsedThisWeek || 0) };
      }
      // Fallback to coins
      if (coins >= FEATURE_COSTS.BOOST) {
        return { allowed: true, cost: FEATURE_COSTS.BOOST };
      }
      return { allowed: false, reason: 'insufficient_coins' };
      
    case 'SUPER_INVITE':
      // 0. Check Bonus Inventory
      if ((user.bonusSuperInvites || 0) > 0) return { allowed: true };

      if (limits.superInvitesPerWeek > 0 && (user.superInvitesUsedThisWeek || 0) < limits.superInvitesPerWeek) {
         return { allowed: true, remaining: limits.superInvitesPerWeek - (user.superInvitesUsedThisWeek || 0) };
      }
      // Fallback to coins
      if (coins >= FEATURE_COSTS.SUPER_INVITE) {
        return { allowed: true, cost: FEATURE_COSTS.SUPER_INVITE };
      }
      return { allowed: false, reason: 'insufficient_coins' };

    case 'CREATE_GROUP':
      if (!limits.canCreateGroup) return { allowed: false, reason: 'subscription_required' };
      if (limits.groupCreationPerMonth === Infinity || (user.groupsCreatedThisMonth || 0) < limits.groupCreationPerMonth) {
        return { allowed: true };
      }
      return { allowed: false, reason: 'limit_reached' };

    case 'UNLOCK_LIKE':
      // 0. Check Bonus Inventory
      if ((user.bonusUnlockLikes || 0) > 0) return { allowed: true };

      // Always costs coins unless PRO (PRO has showLikesDetails=true, so they shouldn't call this)
      if (limits.showLikesDetails) return { allowed: true, cost: 0 }; 
      if (coins >= FEATURE_COSTS.UNLOCK_LIKE) {
        return { allowed: true, cost: FEATURE_COSTS.UNLOCK_LIKE };
      }
      return { allowed: false, reason: 'insufficient_coins' };
    
    case 'SEND_PHOTO':
      if (tier === 'PLUS' || tier === 'PRO') return { allowed: true, cost: 0 };
      if (coins >= FEATURE_COSTS.SEND_PHOTO) {
        return { allowed: true, cost: FEATURE_COSTS.SEND_PHOTO };
      }
      return { allowed: false, reason: 'insufficient_coins' };
  }
  
}

// Calculate the updates needed to perform the action
export function performActionUpdates(
  user: UserProfile,
  action: ActionType
): ActionResult {
  const check = canPerformAction(user, action);
  if (!check.allowed) return check;

  const updates: Partial<UserProfile> = {};
  const tier = user.subscription || 'FREE';

  if (check.cost && check.cost > 0) {
    // @ts-ignore: increment is compatible with number but TypeScript complains in Partial<UserProfile>
    updates.pins = increment(-check.cost);
  } else {
    // Increment usage counters if we didn't spend coins (meaning we used a subscription limit)
    // UNLESS cost was 0 because we are PRO (e.g. UNLOCK_LIKE for PRO)
    // OR we used a bonus item
    
    switch (action) {
      case 'INVITE':
        if ((user.bonusInvites || 0) > 0) {
            updates.bonusInvites = (user.bonusInvites || 0) - 1;
        } else if (tier === 'PLUS') {
            updates.invitesUsedThisWeek = (user.invitesUsedThisWeek || 0) + 1;
            updates.invitesUsedToday = (user.invitesUsedToday || 0) + 1; 
        } else {
            updates.invitesUsedToday = (user.invitesUsedToday || 0) + 1;
            updates.invitesUsedThisWeek = (user.invitesUsedThisWeek || 0) + 1;
        }
        break;
      case 'UNDO':
        if ((user.bonusUndos || 0) > 0) {
            updates.bonusUndos = (user.bonusUndos || 0) - 1;
        } else {
            updates.undoUsedToday = (user.undoUsedToday || 0) + 1;
        }
        break;
      case 'BOOST':
        if ((user.bonusBoosts || 0) > 0) {
            updates.bonusBoosts = (user.bonusBoosts || 0) - 1;
        } else {
            updates.boostsUsedThisWeek = (user.boostsUsedThisWeek || 0) + 1;
        }
        break;
      case 'SUPER_INVITE':
        if ((user.bonusSuperInvites || 0) > 0) {
            updates.bonusSuperInvites = (user.bonusSuperInvites || 0) - 1;
        } else {
            updates.superInvitesUsedThisWeek = (user.superInvitesUsedThisWeek || 0) + 1;
        }
        break;
      case 'CREATE_GROUP':
        updates.groupsCreatedThisMonth = (user.groupsCreatedThisMonth || 0) + 1;
        break;
      case 'UNLOCK_LIKE':
        if ((user.bonusUnlockLikes || 0) > 0) {
            updates.bonusUnlockLikes = (user.bonusUnlockLikes || 0) - 1;
        }
        break;
    }
  }

  return { ...check, updates };
}

// Function to check and reset limits if needed
export function checkAndResetLimits(user: UserProfile): Partial<UserProfile> | null {
    const now = dayjs();
    const updates: Partial<UserProfile> = {};
    let changed = false;

    // Daily Reset
    const lastDaily = user.lastDailyReset ? dayjs(user.lastDailyReset) : null;
    if (!lastDaily || !lastDaily.isSame(now, 'day')) {
        updates.invitesUsedToday = 0;
        updates.undoUsedToday = 0;
        updates.lastDailyReset = now.valueOf();
        changed = true;
    }

    // Weekly Reset
    const lastWeekly = user.lastWeeklyReset ? dayjs(user.lastWeeklyReset) : null;
    if (!lastWeekly || !lastWeekly.isSame(now, 'week')) {
        updates.invitesUsedThisWeek = 0;
        updates.boostsUsedThisWeek = 0;
        updates.superInvitesUsedThisWeek = 0;
        updates.lastWeeklyReset = now.valueOf();
        changed = true;
    }

    // Monthly Reset
    const lastMonthly = user.lastMonthlyReset ? dayjs(user.lastMonthlyReset) : null;
    if (!lastMonthly || !lastMonthly.isSame(now, 'month')) {
        updates.groupsCreatedThisMonth = 0;
        updates.lastMonthlyReset = now.valueOf();
        changed = true;
    }

    return changed ? updates : null;
}
