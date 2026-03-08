// app/settings.tsx
import { useToast } from '@/components/ui/Toast';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import MultiSlider from '@ptomasroos/react-native-multi-slider';
import { router } from 'expo-router';
import { onAuthStateChanged, signOut } from 'firebase/auth';
import { useEffect, useMemo, useState } from 'react';
import {
  Alert, LayoutChangeEvent, Linking, Modal,
  ScrollView, StyleSheet, Switch, Text,
  TextInput, TouchableOpacity, View
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Collapsible } from '../components/Collapsible';
import { ACTIVITIES, ACTIVITY_LABELS } from '../constants/Activities';
import { Colors } from '../constants/Colors';
import { auth } from '../firebaseconfig';
import { deleteUserData, getUserProfile, savePartialProfile, UserProfile } from '../lib/profile';

/** Bornes d’âge pour une app 18+ (tous les comptes sont adultes) */
const boundsForAge = (age?: number) => {
  const base = (!age || age < 18) ? 18 : age;
  const min = Math.max(18, base - 10);
  const max = base + 10;
  return { min, max };
};

const defaultRangeForAge = (age?: number) => {
  const b = boundsForAge(age);
  if (!age) return { min: b.min, max: Math.min(b.min + 2, b.max) };
  const min = Math.max(b.min, Math.min(age - 1, b.max));
  const max = Math.max(min, Math.min(age + 1, b.max));
  return { min, max };
};

const clampRangeToIncludeAge = (
  min: number,
  max: number,
  age: number,
  b: { min: number; max: number }
) => {
  let A = Math.max(b.min, Math.min(min, b.max));
  let B = Math.max(A, Math.min(max, b.max));
  // la tranche doit inclure l'âge
  if (age < A) A = age;
  if (age > B) B = age;
  A = Math.max(b.min, Math.min(A, b.max));
  B = Math.max(A, Math.min(B, b.max));
  return { min: A, max: B };
};

const ALL_ACTIVITIES = Object.keys(ACTIVITY_LABELS);
const ALL_GENDERS   = ['hommes', 'femmes', 'autres'] as const;

export default function SettingsScreen() {
  const { showToast } = useToast();
  const [p, setP] = useState<UserProfile | null>(null);

  // lock & âge / tranche
  const [age, setAge] = useState('');
  const [minAge, setMinAge] = useState(18);
  const [maxAge, setMaxAge] = useState(25);
  const [minBound, setMinBound] = useState(18);
  const [maxBound, setMaxBound] = useState(25);
  const [trackWidth, setTrackWidth] = useState(0);

  // préférences
  const [interests, setInterests] = useState<string[]>([]);
  const [interestModalVisible, setInterestModalVisible] = useState(false);
  const [interestSearch, setInterestSearch] = useState('');

  const [genders, setGenders]     = useState<string[]>([]);
  const [genderIdentity, setGenderIdentity] = useState<string | null>(null);
  const [radiusKm, setRadiusKm]   = useState<number>(100);
  const [heightOpen, setHeightOpen] = useState(false);
  const [useStrictFilters, setUseStrictFilters] = useState(false);

  // contacts
  const [instagram, setInstagram] = useState('');
  const [tiktok, setTiktok]       = useState('');
  const [contactEmail, setContactEmail] = useState('');

  const C = Colors['dark'];
  const insets = useSafeAreaInsets();
  const isPremium = p?.subscription === 'PLUS' || p?.subscription === 'PRO';
  const isPro = p?.subscription === 'PRO';

  useEffect(() => {
    return onAuthStateChanged(auth, async (u) => {
      if (!u) return;
      const prof = await getUserProfile(u.uid);
      setP(prof);

      // init âge & bornes
      const curAge = prof?.age ?? 18;
      setAge(String(curAge));
      setGenderIdentity(prof?.genderIdentity ?? null);
      const b = boundsForAge(curAge);
      setMinBound(b.min); setMaxBound(b.max);

      // base range = profil existant sinon défaut autour de l’âge
      const hasRange = typeof prof?.desiredMinAge === 'number' && typeof prof?.desiredMaxAge === 'number';
      const base = hasRange
        ? { min: prof!.desiredMinAge!, max: prof!.desiredMaxAge! }
        : defaultRangeForAge(curAge);

      const clamped = clampRangeToIncludeAge(base.min, base.max, curAge, b);
      setMinAge(clamped.min); setMaxAge(clamped.max);

      // si range absente → sauvegarde immédiate
      const patch: any = {};
      if (prof?.ageLock !== 'adult') patch.ageLock = 'adult';
      if (!hasRange) {
        patch.desiredMinAge = clamped.min;
        patch.desiredMaxAge = clamped.max;
      }
      if (Object.keys(patch).length) await savePartialProfile(u.uid, patch);

      setInterests(prof?.interests ?? []);
      setGenders(prof?.genders ?? []);
      setRadiusKm(prof?.discoveryRadiusKm ?? 100);
      setUseStrictFilters(prof?.useStrictFilters ?? false);
      setInstagram(prof?.contacts?.instagram ?? '');
      setTiktok(prof?.contacts?.tiktok ?? '');
      setContactEmail(prof?.contacts?.email ?? (u.email ?? ''));
    });
  }, []);

  // bornes dynamiques quand l’âge change → la tranche doit inclure l’âge
  useEffect(() => {
    const n = parseInt(age, 10);
    if (!Number.isFinite(n)) return;
    const b = boundsForAge(n);
    setMinBound(b.min); setMaxBound(b.max);

    const clamped = clampRangeToIncludeAge(minAge, maxAge, n, b);
    setMinAge(clamped.min);
    setMaxAge(clamped.max);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [age]);

  const onTrackLayout = (e: LayoutChangeEvent) =>
    setTrackWidth(e.nativeEvent.layout.width || 0);

  // Sélection unique (radio) pour relations et genres
  const selectSingle = (arr: string[], value: string) =>
    arr.includes(value) ? [] : [value];

  const toggleMulti = (arr: string[], value: string) => 
    arr.includes(value) ? arr.filter(v => v !== value) : [...arr, value];

  const displayedActivities = useMemo(() => {
    const s = interestSearch.toLowerCase().trim();
    if (!s) return ACTIVITIES.filter(a => a.popular || interests.includes(a.id));
    return ACTIVITIES.filter(a => a.label.toLowerCase().includes(s));
  }, [interestSearch, interests]);

  const toggleInterest = (id: string) => {
    setInterests(prev => {
        if (prev.includes(id)) {
            return prev.filter(i => i !== id);
        } else {
            if (prev.length >= 10) {
                Alert.alert('Limite atteinte', 'Tu ne peux sélectionner que 10 centres d\'intérêt maximum.');
                return prev;
            }
            return [...prev, id];
        }
    });
  };

  const save = async () => {
    const uid = auth.currentUser?.uid;
    if (!uid) return;

    const ageNum = parseInt(age, 10);
    if (!Number.isFinite(ageNum)) {
      showToast('Erreur', 'Âge invalide : Renseigne un âge valide.', 'error');
      return;
    }

    // applique le verrou au moment de la sauvegarde (anti contournement)
    const b = boundsForAge(ageNum);
    const lockedAge = Math.max(b.min, Math.min(ageNum, b.max));
    const clamped = clampRangeToIncludeAge(minAge, maxAge, lockedAge, b);

    const contacts: any = {
      instagram: instagram?.trim() || undefined,
      tiktok:    tiktok?.trim() || undefined,
      email:     (contactEmail?.trim() || auth.currentUser?.email || '').trim() || undefined,
    };
    Object.keys(contacts).forEach(k => contacts[k] === undefined && delete contacts[k]);

    const patch: any = {
      age: lockedAge,
      ageLock: 'adult',
      desiredMinAge: clamped.min,
      desiredMaxAge: clamped.max,
      interests: interests,
      genders,
      ...(genderIdentity ? { genderIdentity } : {}),
      discoveryRadiusKm: radiusKm,
      useStrictFilters,
      ...(Object.keys(contacts).length ? { contacts } : {}),
    };

    // Persister la taille si renseignée
    const h = p?.heightCm;
    if (typeof h === 'number' && Number.isFinite(h)) {
      patch.heightCm = h;
    }

    try {
      await savePartialProfile(uid, patch);
      router.replace('/(tabs)/profile');
    } catch (e: any) {
      console.error('settings/save error:', e?.code, e?.message);
      Alert.alert('Erreur', 'Impossible d’enregistrer : ' + (e?.message ?? 'inconnue'));
    }
  };

  const cancelSubscription = async () => {
    Alert.alert(
      "Résilier l'abonnement",
      "Es-tu sûr de vouloir résilier tous tes abonnements et revenir au plan gratuit ? Cette action est immédiate.",
      [
        { text: "Annuler", style: "cancel" },
        {
          text: "Confirmer",
          style: "destructive",
          onPress: async () => {
             const uid = auth.currentUser?.uid;
             if (!uid) return;
             try {
               await savePartialProfile(uid, {
                 subscription: 'FREE',
                 subscriptionExpiryMs: 0,
                 boostExpiresAt: 0,
                 // Reset limits if needed, but usually 'FREE' implies limits will be re-checked/enforced.
                 // We keep consumables (pins) as they are distinct from subscription.
               });
               showToast('Succès', 'Abonnement résilié. Tu es maintenant membre Gratuit.', 'success');
               const prof = await getUserProfile(uid);
               setP(prof);
             } catch (e) {
               showToast('Erreur', "Impossible de résilier.", 'error');
             }
          }
        }
      ]
    );
  };

  const deleteAccount = async () => {
    Alert.alert(
      "Supprimer mon compte",
      "Es-tu sûr de vouloir supprimer définitivement ton compte ? Cette action est irréversible et toutes tes données seront perdues.",
      [
        { text: "Annuler", style: "cancel" },
        {
          text: "Supprimer",
          style: "destructive",
          onPress: async () => {
             const uid = auth.currentUser?.uid;
             const user = auth.currentUser;
             if (!uid || !user) return;
             
             try {
               await deleteUserData(uid);
               await user.delete();
               // User is now deleted and signed out
               router.replace('/');
               showToast('Adieu', 'Ton compte a été supprimé.', 'success');
             } catch (e: any) {
               console.error("Delete account error:", e);
               if (e.code === 'auth/requires-recent-login') {
                  Alert.alert("Sécurité", "Par mesure de sécurité, reconnecte-toi avant de supprimer ton compte.");
                  await signOut(auth);
                  router.replace('/');
               } else {
                  showToast('Erreur', "Impossible de supprimer le compte. Contacte le support.", 'error');
               }
             }
          }
        }
      ]
    );
  };

  const lockText =
    `Tous les profils sont 18+ : ta recherche reste entre ${minBound} et ${maxBound} ans.`;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: C.background, paddingTop: insets.top }}>
      {/* Header */}
      <View style={[styles.header, { paddingHorizontal: 16 }]}>
        <TouchableOpacity onPress={() => router.back()} style={{ padding: 6 }}>
          <FontAwesome name="chevron-left" size={18} color={C.text} />
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: C.text }]}>Paramètres</Text>
        <View style={{ width: 24 }} />
      </View>

      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 16, gap: 14 }}
      >
        {/* Préférences */}
        <Collapsible title="Préférences de rencontre" defaultOpen>
          <View style={[styles.card, { backgroundColor: C.card, borderColor: C.border }]}> 
          
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
             <View style={{ flex: 1, paddingRight: 10 }}>
               <Text style={{ color: C.text, fontWeight: '600', fontSize: 16 }}>Appliquer mes préférences</Text>
               <Text style={{ color: C.muted, fontSize: 12, marginTop: 2 }}>
                 N&apos;afficher que les profils correspondant strictement à mes critères (Relations & Genre).
               </Text>
             </View>
             <Switch 
                value={useStrictFilters} 
                onValueChange={(v) => {
                    if (v && !isPremium) {
                        Alert.alert(
                            'Fonctionnalité PLUS',
                            'Passez à Frensy PLUS pour filtrer strictement les profils par genre et type de relation.',
                            [
                                { text: 'Annuler', style: 'cancel' },
                                { text: 'Voir les offres', onPress: () => router.push({ pathname: '/store', params: { tab: 'subs' } } as any) }
                            ]
                        );
                        return;
                    }
                    setUseStrictFilters(v);
                }}
                trackColor={{ false: '#767577', true: C.tint }}
                thumbColor={'#f4f3f4'}
             />
          </View>
          {!isPremium && (
             <TouchableOpacity onPress={() => router.push({ pathname: '/store', params: { tab: 'subs' } } as any)} style={{ marginBottom: 16 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: 'rgba(236, 72, 153, 0.1)', padding: 8, borderRadius: 8 }}>
                   <FontAwesome name="lock" size={14} color={C.tint} />
                   <Text style={{ color: C.tint, fontSize: 12, fontWeight: 'bold' }}>Réservé aux membres PLUS</Text>
                </View>
             </TouchableOpacity>
          )}

          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
             <Label>Centres d&apos;intérêt</Label>
             <TouchableOpacity onPress={() => setInterestModalVisible(true)}>
                 <Text style={{ color: C.tint, fontSize: 12, fontWeight: 'bold' }}>+ Ajouter / Modifier</Text>
             </TouchableOpacity>
          </View>
          
          <ChipRow
            options={interests}
            values={interests}
            onToggle={(v) => toggleInterest(v)}
            getLabel={(v) => ACTIVITY_LABELS[v] || v}
            removable
          />
          {interests.length === 0 && (
             <Text style={{ color: C.muted, fontStyle: 'italic', fontSize: 12, marginTop: 4 }}>Aucun intérêt sélectionné</Text>
          )}

          <Label style={{ marginTop: 10 }}>Mon genre</Label>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 8 }}>
            {(ALL_GENDERS as unknown as string[]).map((v) => {
              const active = genderIdentity === v;
              return (
                <TouchableOpacity
                  key={v}
                  onPress={() => setGenderIdentity(prev => (prev === v ? null : v))}
                  style={[styles.chip, active ? [styles.chipOn, { backgroundColor: C.tint, borderColor: C.tint }] : styles.chipOff]}
                >
                  <Text style={[styles.chipTxt, active ? styles.chipTxtOn : [styles.chipTxtOff, { color: C.text }]]}>
                    {v.charAt(0).toUpperCase() + v.slice(1)}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>

          <Label style={{ marginTop: 10 }}>Intéressé·e par</Label>
          <ChipRow
            options={ALL_GENDERS as unknown as string[]}
            values={genders}
            onToggle={(v) => setGenders(prev => selectSingle(prev, v))}
            getLabel={(v) => v === 'autres' ? 'Les deux' : (v.charAt(0).toUpperCase() + v.slice(1))}
          />

          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 16 }}>
            <Label>Tranche d’âge souhaitée</Label>
            {!isPremium && (
              <TouchableOpacity onPress={() => router.push('/store?tab=subs')}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: 'rgba(236, 72, 153, 0.1)', paddingHorizontal: 8, paddingVertical: 4, borderRadius: 8 }}>
                   <FontAwesome name="lock" size={12} color={C.tint} />
                   <Text style={{ color: C.tint, fontSize: 10, fontWeight: 'bold' }}>PLUS / PRO</Text>
                </View>
              </TouchableOpacity>
            )}
          </View>
          <Text style={{ color: C.muted, marginTop: 2, fontSize: 12 }}>
            {lockText}
          </Text>

          <View 
            onLayout={onTrackLayout} 
            style={{ paddingHorizontal: 4, marginTop: 10, opacity: isPro ? 1 : 0.5 }}
            pointerEvents={isPro ? 'auto' : 'none'}
          >
            {trackWidth > 0 && (
              <MultiSlider
                values={[minAge, maxAge]}
                min={minBound}
                max={maxBound}
                step={1}
                sliderLength={trackWidth}
                allowOverlap={false}
                snapped
                selectedStyle={{ backgroundColor: isPro ? C.tint : C.muted }}
                unselectedStyle={{ backgroundColor: C.border }}
                trackStyle={{ height: 6, borderRadius: 999 }}
                markerStyle={{
                  height: 22, width: 22, borderRadius: 11,
                  backgroundColor: isPro ? C.tint : C.muted, borderWidth: 2, borderColor: C.text,
                }}
                pressedMarkerStyle={{ transform: [{ scale: 1.08 }] }}
                onValuesChangeFinish={([a, b]) => {
                  const n = parseInt(age, 10);
                  const curAge = Number.isFinite(n) ? n : minBound;
                  const b2 = boundsForAge(curAge);
                  const clamped2 = clampRangeToIncludeAge(a, b, curAge, b2);
                  setMinAge(clamped2.min); setMaxAge(clamped2.max);
                }}
              />
            )}
          </View>

          <View style={styles.rangeRow}>
            <Badge>{minAge} ans</Badge>
            <Text style={{ color: C.muted }}>—</Text>
            <Badge>{maxAge} ans</Badge>
          </View>
          
          {!isPro && (
             <TouchableOpacity onPress={() => router.push({ pathname: '/store', params: { tab: 'subs' } } as any)}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, justifyContent: 'center', marginTop: 12, backgroundColor: 'rgba(255, 215, 0, 0.1)', padding: 8, borderRadius: 8 }}>
                   <FontAwesome name="lock" size={14} color={Colors.dark.gold} />
                   <Text style={{ color: Colors.dark.gold, fontSize: 12, fontWeight: 'bold' }}>Filtre d&apos;âge réservé aux membres PRO</Text>
                </View>
             </TouchableOpacity>
          )}
          </View>
        </Collapsible>

        {/* Rayon de découverte */}
        <Collapsible title="Rayon de découverte" defaultOpen>
          <View style={[styles.card, { backgroundColor: C.card, borderColor: C.border }]}> 
          <Label>Distance maximale autour de toi</Label>
          <View style={{ paddingHorizontal: 4, marginTop: 10 }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 10 }}>
               <Text style={{ color: C.text, fontWeight: 'bold' }}>{radiusKm} km</Text>
               <Text style={{ color: C.muted }}>150 km</Text>
            </View>
            {trackWidth > 0 && (
              <MultiSlider
                values={[radiusKm]}
                min={0}
                max={150}
                step={1}
                sliderLength={trackWidth}
                selectedStyle={{ backgroundColor: C.tint }}
                unselectedStyle={{ backgroundColor: C.border }}
                trackStyle={{ height: 6, borderRadius: 999 }}
                markerStyle={{
                  height: 22, width: 22, borderRadius: 11,
                  backgroundColor: C.tint, borderWidth: 2, borderColor: C.text,
                }}
                pressedMarkerStyle={{ transform: [{ scale: 1.08 }] }}
                onValuesChangeFinish={([val]) => setRadiusKm(val)}
                onValuesChange={([val]) => setRadiusKm(val)}
              />
            )}
          </View>
          <Text style={{ color: C.muted, marginTop: 8, fontSize: 12 }}>
            Utilisé sur la carte et pour découvrir des personnes à proximité.
          </Text>
          </View>
        </Collapsible>

        {/* Infos de base */}
        <Collapsible title="Infos de base" defaultOpen>
          <View style={[styles.card, { backgroundColor: C.card, borderColor: C.border }]}> 
          <Label>Âge</Label>
          {p?.age ? (
            <View>
              <TextInput
                value={String(p.age)}
                editable={false}
                selectTextOnFocus={false}
                style={[styles.input, { color: C.muted, borderColor: C.border, backgroundColor: 'rgba(0,0,0,0.04)' }]}
              />
              <Text style={{ color: C.muted, fontSize: 12, marginTop: 4 }}>
                Âge défini à l’inscription. Contacte le support pour changer.
              </Text>
            </View>
          ) : (
            <TextInput
              value={age}
              onChangeText={(t) => {
                const digits = t.replace(/[^\d]/g, '');
                const n = parseInt(digits || '0', 10);
                const b = boundsForAge(n || undefined);
                const clamped = digits ? String(Math.max(b.min, Math.min(n, b.max))) : '';
                setAge(clamped);
              }}
              keyboardType="number-pad"
              placeholder={`${minBound}–${maxBound}`}
              placeholderTextColor={C.muted}
              style={[styles.input, { color: C.text, borderColor: C.border }]}
              maxLength={3}
            />
          )}

          <Label style={{ marginTop: 12 }}>Taille (cm)</Label>
          <TouchableOpacity
            onPress={() => setHeightOpen((o) => !o)}
            style={[
              styles.input,
              { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderColor: C.border },
            ]}
          >
            <Text style={{ color: p?.heightCm ? C.text : C.muted }}>
              {p?.heightCm ? `${p.heightCm}` : 'Sélectionner'}
            </Text>
            <FontAwesome name={heightOpen ? 'chevron-up' : 'chevron-down'} size={16} color={C.muted} />
          </TouchableOpacity>
          {heightOpen && (
            <View
              style={{
                borderWidth: 1,
                borderColor: C.border,
                borderRadius: 12,
                marginTop: 6,
                maxHeight: 220,
                backgroundColor: C.card,
              }}
            >
              <ScrollView style={{ maxHeight: 220 }}>
                {Array.from({ length: 81 }, (_, i) => 120 + i).map((h) => (
                  <TouchableOpacity
                    key={h}
                    onPress={() => {
                      setP((prev) => ({ ...(prev || {}), heightCm: h } as any));
                      setHeightOpen(false);
                    }}
                  >
                    <View style={{ paddingVertical: 10, paddingHorizontal: 12, flexDirection: 'row', justifyContent: 'space-between' }}>
                      <Text style={{ color: C.text, fontWeight: p?.heightCm === h ? '800' : '400' }}>{h} cm</Text>
                      {p?.heightCm === h && <FontAwesome name="check" size={16} color={C.tint} />}
                    </View>
                  </TouchableOpacity>
                ))}
              </ScrollView>
            </View>
          )}
          </View>
        </Collapsible>

        {/* Abonnements */}
        <Collapsible title="Abonnements & Achats" defaultOpen={false}>
          <View style={[styles.card, { backgroundColor: C.card, borderColor: C.border }]}> 
             <Text style={{color: C.text, marginBottom: 10}}>
               Plan actuel : <Text style={{fontWeight:'bold', color: C.tint}}>{p?.subscription || 'FREE'}</Text>
             </Text>
             <RowBtn 
               icon="times-circle" 
               text="Résilier tout et revenir à 0" 
               color={Colors.dark.danger} 
               bg={Colors.dark.danger + '22'} 
               onPress={cancelSubscription} 
             />
          </View>
        </Collapsible>

        {/* Plus */}
        <Collapsible title="Plus">
          <View style={[styles.card, { backgroundColor: C.card, borderColor: C.border }]}> 
          <RowBtn icon="ban" text="Utilisateurs bloqués" onPress={() => router.push('/settings/blocked-users' as any)} />
          <RowBtn icon="shield" text="Vie privée" onPress={() => router.push('/privacy' as any)} />
          <RowBtn icon="file" text="Politique de confidentialité" onPress={() => router.push('/legal/privacy' as any)} />
          <RowBtn icon="file-text" text="Conditions d'utilisation (CGU)" onPress={() => router.push('/legal/terms' as any)} />
          <RowBtn icon="star" text="Noter l’application" onPress={() => Linking.openURL('https://expo.dev')} />
          <RowBtn
            icon="sign-out"
            text="Se déconnecter"
            color={Colors.dark.danger}
            bg={Colors.dark.danger + '22'}
            onPress={async () => { 
              const uid = auth.currentUser?.uid;
              if (uid) {
                try {
                  const { deleteDoc, doc } = await import('firebase/firestore');
                  const { db } = await import('../firebaseconfig');
                  await deleteDoc(doc(db, 'positions', uid));
                } catch (e) { console.warn('Failed to clean position', e); }
              }
              await signOut(auth); 
              router.replace('/'); 
            }}
          />
          <RowBtn
            icon="trash"
            text="Supprimer mon compte"
            color={Colors.dark.danger}
            bg={Colors.dark.danger + '22'}
            onPress={deleteAccount}
          />
          </View>
        </Collapsible>

        {/* Save */}
        <TouchableOpacity onPress={save} style={[styles.saveBtn, { backgroundColor: C.tint }]}>
          <Text style={styles.saveTxt}>Enregistrer</Text>
        </TouchableOpacity>
      </ScrollView>
      <Modal
        visible={interestModalVisible}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setInterestModalVisible(false)}
      >
        <View style={{ flex: 1, backgroundColor: C.background, padding: 20 }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
                <Text style={{ color: C.text, fontSize: 20, fontWeight: 'bold' }}>Centres d&apos;intérêt</Text>
                <TouchableOpacity onPress={() => setInterestModalVisible(false)}>
                    <Text style={{ color: C.tint, fontWeight: 'bold' }}>Fermer</Text>
                </TouchableOpacity>
            </View>

            <View style={{ 
                flexDirection: 'row', 
                alignItems: 'center', 
                backgroundColor: 'rgba(255,255,255,0.05)', 
                borderRadius: 12, 
                paddingHorizontal: 12, 
                paddingVertical: 10,
                marginBottom: 16,
                borderWidth: 1,
                borderColor: 'rgba(255,255,255,0.1)',
            }}>
                <FontAwesome name="search" size={16} color={C.muted} style={{ marginRight: 10 }} />
                <TextInput 
                    style={{ flex: 1, color: C.text, fontSize: 16 }}
                    placeholder="Rechercher (ex: Tennis, Cuisine...)"
                    placeholderTextColor={C.muted}
                    value={interestSearch}
                    onChangeText={setInterestSearch}
                />
                {interestSearch.length > 0 && (
                    <TouchableOpacity onPress={() => setInterestSearch('')}>
                        <FontAwesome name="times-circle" size={16} color={C.muted} />
                    </TouchableOpacity>
                )}
            </View>

            <ScrollView showsVerticalScrollIndicator={false}>
                <Text style={{ color: C.muted, fontSize: 12, marginBottom: 10, textTransform: 'uppercase', fontWeight: 'bold' }}>
                    {interestSearch ? 'Résultats' : 'Populaires & Sélectionnés'}
                </Text>
                
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                    {displayedActivities.map((act) => {
                        const active = interests.includes(act.id);
                        return (
                            <TouchableOpacity
                                key={act.id}
                                onPress={() => toggleInterest(act.id)}
                                style={[
                                    styles.chip,
                                    active ? [styles.chipOn, { backgroundColor: C.tint, borderColor: C.tint }] : styles.chipOff,
                                ]}
                            >
                                <FontAwesome name={act.icon as any} size={14} color={active ? C.text : C.muted} style={{ marginRight: 6 }} />
                                <Text style={[styles.chipTxt, active ? styles.chipTxtOn : [styles.chipTxtOff, { color: C.text }]]}>
                                    {act.label}
                                </Text>
                            </TouchableOpacity>
                        );
                    })}
                    {displayedActivities.length === 0 && (
                        <Text style={{ color: C.muted, fontStyle: 'italic', marginTop: 10 }}>Aucune activité trouvée</Text>
                    )}
                </View>
                <View style={{ height: 40 }} />
            </ScrollView>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

/* --- UI helpers --- */
// Section supprimé au profit de Collapsible
function Label({ children, style }: { children: React.ReactNode; style?: any }) {
  const C = Colors['dark'];
  return (
    <Text style={[{ color: C.muted, fontSize: 12, fontWeight: '800', textTransform: 'uppercase' }, style]}>
      {children}
    </Text>
  );
}
function Badge({ children }: { children: React.ReactNode }) {
  return (
    <View style={styles.badge}>
      <Text style={styles.badgeTxt}>{children}</Text>
    </View>
  );
}
function ChipRow({
  options, values, onToggle, getLabel, removable
}: { options: string[]; values: string[]; onToggle: (v: string) => void, getLabel?: (v: string) => string, removable?: boolean }) {
  const C = Colors['dark'];
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 8 }}>
      {options.map((opt) => {
        const active = values.includes(opt);
        const label = getLabel ? getLabel(opt) : (opt.charAt(0).toUpperCase() + opt.slice(1));
        return (
          <TouchableOpacity
            key={opt}
            onPress={() => onToggle(opt)}
            style={[
              styles.chip,
              active ? [styles.chipOn, { backgroundColor: C.tint, borderColor: C.tint }] : styles.chipOff,
            ]}
          >
            <Text style={[styles.chipTxt, active ? styles.chipTxtOn : [styles.chipTxtOff, { color: C.text }]]}>
              {label}
            </Text>
            {removable && active && (
               <FontAwesome name="times" size={12} color={C.text} style={{ marginLeft: 6 }} />
            )}
          </TouchableOpacity>
        );
      })}
    </View>
  );
}
function RowBtn({
  icon, text, onPress, color, bg,
}: { icon: React.ComponentProps<typeof FontAwesome>['name']; text: string; onPress: () => void; color?: string; bg?: string; }) {
  const C = Colors['dark'];
  return (
    <TouchableOpacity onPress={onPress} style={[styles.rowBtn, { borderColor: C.border, backgroundColor: bg ?? C.card }]}>
      <FontAwesome name={icon} size={16} color={color ?? C.text} />
      <Text style={[styles.rowBtnTxt, { color: color ?? C.text }]}>{text}</Text>
    </TouchableOpacity>
  );
}

/* --- styles --- */
const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 },
  headerTitle: { fontSize: 18, fontWeight: '900' },

  card: { borderWidth: 1, borderRadius: 16, padding: 14, gap: 8 },
  cardTitle: { fontSize: 16, fontWeight: '900', marginBottom: 6 },
  input: { height: 46, borderRadius: 12, borderWidth: 1, paddingHorizontal: 12 },

  rangeRow: { marginTop: 6, flexDirection: 'row', alignItems: 'center', gap: 10 },
  badge: { backgroundColor: Colors.dark.panel, paddingVertical: 8, paddingHorizontal: 12, borderRadius: 999 },
  badgeTxt: { color: Colors.dark.text, fontWeight: '800' },

  rowBtn: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 12, borderWidth: 1, borderRadius: 12, marginTop: 8 },
  rowBtnTxt: { fontWeight: '800' },

  chip: { paddingHorizontal: 14, paddingVertical: 10, borderRadius: 20, borderWidth: 1, minWidth: 60, alignItems: 'center', flexDirection: 'row' },
  chipOn: { borderWidth: 1 },
  chipOff:{ backgroundColor: 'transparent', borderColor: Colors.dark.border },
  chipTxt: { fontWeight: '700', fontSize: 14 },
  chipTxtOn: { color: Colors.dark.text },
  chipTxtOff:{ color: Colors.dark.subtleText },

  saveBtn: { marginTop: 6, paddingVertical: 14, borderRadius: 14, alignItems: 'center' },
  saveTxt: { color: Colors.dark.text, fontWeight: '900' },
});
