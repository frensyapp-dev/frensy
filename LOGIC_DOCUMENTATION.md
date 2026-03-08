# Documentation des Logiques Métier - Frendzy

Ce document détaille le fonctionnement technique et logique des fonctionnalités clés de l'application (Invitations, Messages, Matchs, Cadeaux, Abonnements). Il sert de référence pour éviter les régressions et comprendre les flux de données.

## 1. Invitations & Chat Requests

### Vue d'ensemble
Les invitations permettent aux utilisateurs d'initier une conversation. Elles passent par un état "pending" avant d'être acceptées ou refusées.

### Fichiers Concernés
- **Frontend**: `lib/invitations.ts`, `lib/monetization.ts`
- **Backend**: `functions/src/index.ts` (Trigger `onChatRequestWrite`)

### Logique Détaillée
1.  **Vérification des Droits (Client)** :
    - Avant d'envoyer, `canPerformAction` (`lib/monetization.ts`) vérifie si l'utilisateur a le droit (Abonnement ou Pins suffisants).
    - Si l'action coûte des Pins, ils sont déduits localement via `performActionUpdates`.
2.  **Envoi** :
    - Une entrée est créée dans la collection `chatRequests`.
3.  **Traitement Backend (`onChatRequestWrite`)** :
    - **Acceptation** : Si le statut passe à `accepted`, un document `matches` est créé automatiquement avec les deux utilisateurs.
    - **Rejet** : Si le statut passe à `rejected`, l'invitation est marquée comme telle.
    - **Anti-Spam** : Si une invitation reste `pending` mais est mise à jour trop fréquemment (< 90s), elle est auto-rejetée.
    - **Exclusion** : Les utilisateurs sont ajoutés à une liste d'exclusion mutuelle pour ne plus se voir dans le feed (`addExclusion`).
4.  **Notification** :
    - `sendPushOnChatInvitation` envoie une notification push au destinataire (si non bloqué).

---

## 2. Matchs & Likes

### Vue d'ensemble
Le système de match repose sur un "Double Opt-in" (les deux utilisateurs doivent se liker).

### Fichiers Concernés
- **Frontend**: `lib/matches.ts`, `app/likes.tsx`
- **Backend**: `functions/src/index.ts` (Trigger `onSwipeCreated`, `onMatchCreated`)

### Logique Détaillée
1.  **Action de Like (Swipe Right)** :
    - Le client écrit dans `likes/{userA_userB}` ET `swipes/{userA}/outgoing/{userB}` (`v=1`).
2.  **Détection de Match (Client & Serveur)** :
    - **Client** : `lib/matches.ts` vérifie immédiatement si `likes/{userB_userA}` existe. Si oui -> Création du document `matches/{id}`.
    - **Serveur (Redondance)** : Le trigger `onSwipeCreated` vérifie aussi la réciprocité. Si le match n'existe pas encore, il le crée.
3.  **Conséquences d'un Match** :
    - Création du document dans la collection `matches`.
    - `onMatchCreated` ajoute les utilisateurs aux exclusions mutuelles.
    - `sendPushOnNewMatch` envoie une notification "Nouveau Match" aux deux parties.

---

## 3. Messages & Chat

### Vue d'ensemble
Messagerie temps réel via Firestore avec support des images et nettoyage automatique.

### Fichiers Concernés
- **Frontend**: `lib/chat/realtime.ts`
- **Backend**: `functions/src/index.ts` (Trigger `sendPushOnNewMessage`, `cleanupOrphans`)

### Logique Détaillée
1.  **Envoi** :
    - Les messages sont ajoutés dans la sous-collection `matches/{matchId}/messages`.
2.  **Notifications** :
    - `sendPushOnNewMessage` écoute les nouveaux messages.
    - Vérifie si le destinataire a bloqué l'expéditeur (`isBlockedBetween`).
    - Envoie la notif si les préférences utilisateur l'autorisent.
3.  **Sécurité & Modération** :
    - `storageModerationOnFinalize` analyse les images (Google Vision API) pour détecter le contenu NSFW.
    - Si NSFW détecté : L'image est supprimée et une entrée est ajoutée dans `moderation_chats`.
4.  **Nettoyage (Cleanup)** :
    - `cleanupOrphans` (Scheduled) supprime les conversations dont le match a été supprimé ou dont un utilisateur n'existe plus.

---

## 4. Cadeaux Journaliers (Daily Rewards)

### Vue d'ensemble
Système de récompense progressive pour encourager la fidélité quotidienne.

### Fichiers Concernés
- **Backend**: `functions/src/index.ts` (Fonction `claimDailyReward`)

### Logique Détaillée
1.  **Réclamation** :
    - L'utilisateur appelle la fonction HTTPS `claimDailyReward`.
2.  **Calcul du Streak** :
    - Le backend compare la date actuelle avec `lastDailyRewardClaimedAt`.
    - **Même jour** : Rejet (Erreur).
    - **Jour suivant (J+1)** : Streak + 1.
    - **Plus tard (J+2 ou plus)** : Reset du Streak à 1.
3.  **Récompenses (Cycle de 7 jours)** :
    - Jour 1 : 5 Pins
    - Jour 2 : 1 Invitation Bonus
    - Jour 3 : 10 Pins
    - Jour 4 : 1 Undo Bonus
    - Jour 5 : 10 Pins
    - Jour 6 : 1 Révélation (Unlock Like)
    - Jour 7 : 1 Boost
4.  **Stockage** :
    - Les compteurs (pins, bonusInvites, etc.) sont incrémentés de manière atomique via `FieldValue.increment`.

---

## 5. Abonnements & Paiements

### Vue d'ensemble
Modèle Freemium avec abonnements (PLUS, PRO) et achats à l'acte (Packs de Pins).

### Fichiers Concernés
- **Frontend**: `lib/monetization.ts`, `lib/revenuecat.ts`
- **Backend**: `functions/src/index.ts` (Fonction `processPurchase`)

### Niveaux d'Abonnement (`lib/monetization.ts`)
| Fonctionnalité | FREE | PLUS | PRO |
| :--- | :--- | :--- | :--- |
| **Invites / jour** | 0 | 3 | Illimité |
| **Undo / jour** | 0 | 3 | Illimité |
| **Boost / semaine** | 0 | 1 | 3 |
| **Super Invites** | 0 | 0 | 3 / sem |
| **Création Groupe** | Non | 1 / mois | Illimité |
| **Voir Likes** | Flouté | Flouté | Clair |

### Sécurité des Paiements (IMPORTANT)
- **État Actuel** : La fonction `processPurchase` est en mode **"Test/Confiance Client"**. Elle prend un `itemId` (ex: `coins_100`) et crédite l'utilisateur sans vérifier le reçu auprès d'Apple/Google.
- **Risque** : Vulnérable aux attaques (n'importe qui peut appeler l'API pour se créditer).
- **Recommandation** : Implémenter les Webhooks RevenueCat ou la validation serveur des reçus pour la production.

### Logique d'Utilisation (`canPerformAction`)
- Le système vérifie d'abord les **Bonus** (inventaire gagné).
- Puis les **Limites d'Abonnement** (quotas journaliers/hebdo).
- Enfin, propose d'utiliser des **Pins** (monnaie virtuelle) si le quota est atteint.
