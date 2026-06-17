# ✅ Vérification Finale de l’Application

Objectif : faire une **dernière review complète** avant release 🚀  
Pages à vérifier : **Home (Map) – Discover – Chat – Profil**

---

# 🗺️ Page 1 — HOME (MAP)

## 🎯 Affichage des profils
- Les profils autour de nous s’affichent correctement selon :
  - le **rayon en km choisi**
  - les **filtres actifs**
- ⚠️ Les **filtres âge et goûts** sont accessibles uniquement avec abonnement.

## 👤 Gestion du floutage
- Les personnes **non connues** :
  - Profil **flouté**
  - **Localisation non précise**
- Les **amis** :
  - Profil **non flouté**
  - Localisation **visible mais approximative**

## 🧭 Fonction Boussole (Partage localisation précise)
- La localisation devient **précise uniquement si :**
  - l’autre utilisateur **active la boussole**
  - ET qu’il **n’a pas activé le mode fantôme**

👉 Signification de la boussole :  
> “J’accepte de partager ma localisation précise.”

## 👻 Mode Fantôme
- Si activé :
  - aucune localisation précise visible
  - désactivation automatique du partage précis

## 📍 Persistance de la zone après déconnexion
- Lorsqu’un utilisateur **choisit une zone du moment**, celle-ci reste **active pendant 24 heures** la zone est demandé lors de connexion assez espacées
- Même si l’utilisateur :
  - quitte l’application
  - se déconnecte
  - ferme son téléphone

👉 Il reste **visible dans cette zone pendant 24h**

⚠️ Exception :
- Si l’utilisateur **refuse de sélectionner une zone**,  
  → il **n’est pas visible sur la map**

---

# 🔎 Page 2 — DISCOVER

## ❤️ Swipe des profils
- Swipe basé sur :
  - **Zone géographique**
  - **Filtres actifs** (identiques à la map)

## 👥 Types de profils
- Distinction claire entre :
  - **Profils groupes**
  - **Profils uniques**

## 🧪 Vérifications techniques
- Aucun **bug d’affichage**
- Le **retour arrière sur un profil fonctionne**
- Chargement fluide des profils

## 💬 Groupes de chat
- Vérifier :
  - **Comptage exact des membres**
  - Bonne mise à jour si quelqu’un rejoint / quitte
  - **Pas de bug lors de la création / suppression d’un groupe**
  - Vérifier le **fonctionnement des votes** (upvote / downvote)

---

# 💬 Page 3 — CHAT

## ✔️ Vérification rapide globale
- Envoi / réception messages OK
- Chargement conversations OK

## 🧭 Fonction Boussole
- Vérifier :
  - Activation correcte
  - Désactivation automatique si **mode fantôme activé**
  - Synchronisation avec la map

---

# 👤 Page 4 — PROFIL

## 🌍 Profil Public
(Celui visible par les autres utilisateurs)

- Infos correctement affichées
- Possibilité :
  - **d’envoyer une invitation**
- Distinction visible :
  - **Profil groupe**
  - **Profil unique**

## 🔒 Profil Privé
(Celui visible uniquement par l’utilisateur)

- Accès aux paramètres personnels
- Modification infos OK
- Rien de bloquant à signaler

---

# ✅ Conclusion Review

- Vérifier la **cohérence globale Map / Discover / Chat**
- Vérifier la **logique Mode Fantôme ↔ Boussole**
- Vérifier la **persistance zone 24h**
- Vérifier les **filtres abonnement**
- Vérifier les **types de profils (groupe / unique)**

👉 Si tout est validé → **App prête pour release 🚀**