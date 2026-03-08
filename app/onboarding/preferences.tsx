import { FontAwesome, Ionicons } from '@expo/vector-icons';
import { router, Stack } from 'expo-router';
import { useState, useMemo } from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View, Dimensions, TextInput, Alert } from 'react-native';
import { GradientButton } from '../../components/ui/GradientButton';
import { auth } from '../../firebaseconfig';
import { ensurePushPermissionAndSave } from '../../lib/notifications';
import { getUserProfile, savePartialProfile } from '../../lib/profile';
import { Colors } from '../../constants/Colors';
import { LinearGradient } from 'expo-linear-gradient';
import { ACTIVITIES } from '../../constants/Activities';

const { width } = Dimensions.get('window');

type Gen = 'hommes' | 'femmes' | 'autres';

// bornes & défaut pour initialiser la tranche à la création
const boundsForAge = (age?: number) => {
  const base = (!age || age < 18) ? 18 : age;
  const min = Math.max(18, base - 10);
  const max = base + 10;
  return { min, max };
};

const defaultRangeForAge = (age?: number) => {
  const b = boundsForAge(age);
  if (!age) return b;
  const min = Math.max(b.min, Math.min((age ?? b.min) - 1, b.max));
  const max = Math.max(min, Math.min((age ?? b.min) + 1, b.max));
  return { min, max };
};

export default function PreferencesStep() {
  const [interests, setInterests] = useState<string[]>([]);
  const [genders, setGenders] = useState<Gen[]>([]);
  const [genderIdentity, setGenderIdentity] = useState<Gen | null>(null);
  const [search, setSearch] = useState('');
  const C = Colors['dark'];

  const selectSingle = <T extends string>(arr: T[], v: T, set: (x: T[]) => void) =>
    set(arr.includes(v) ? [] : [v]);

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

  const displayedActivities = useMemo(() => {
      if (!search.trim()) {
          // Afficher les populaires et ceux déjà sélectionnés pour qu'ils restent visibles
          return ACTIVITIES.filter(a => a.popular || interests.includes(a.id));
      }
      const s = search.toLowerCase();
      return ACTIVITIES.filter(a => a.label.toLowerCase().includes(s));
  }, [search, interests]);

  const finish = async () => {
    const uid = auth.currentUser?.uid;
    if (!uid) return;

    const prof = await getUserProfile(uid);
    const def = defaultRangeForAge(prof?.age);

    const patch: any = { interests, genders };
    if (genderIdentity) patch.genderIdentity = genderIdentity;
    if (typeof prof?.desiredMinAge !== 'number') patch.desiredMinAge = def.min;
    if (typeof prof?.desiredMaxAge !== 'number') patch.desiredMaxAge = def.max;

    await savePartialProfile(uid, patch);
    await ensurePushPermissionAndSave();

    router.replace('/onboarding/add-photo' as any);
  };

  const disabled = interests.length === 0 || genders.length === 0 || !genderIdentity;

  const ActivityChip = ({ label, icon, selected, onPress }: { label: string, icon: any, selected: boolean, onPress: () => void }) => (
      <TouchableOpacity 
        onPress={onPress} 
        activeOpacity={0.8}
        style={[
            s.chip, 
            selected && s.chipSelected
        ]}
      >
          <FontAwesome name={icon} size={16} color={selected ? '#fff' : 'rgba(255,255,255,0.6)'} style={{ marginRight: 8 }} />
          <Text style={[s.chipLabel, selected && { color: '#fff' }]}>{label}</Text>
      </TouchableOpacity>
  );

  const MiniOption = ({ label, icon, selected, onPress }: { label: string, icon: any, selected: boolean, onPress: () => void }) => (
    <TouchableOpacity 
        onPress={onPress} 
        style={[s.miniOption, selected && s.miniOptionSelected]}
    >
        <FontAwesome name={icon} size={20} color={selected ? C.text : 'rgba(255,255,255,0.4)'} style={{ marginBottom: 8 }} />
        <Text style={[s.miniLabel, selected && { color: C.text }]}>{label}</Text>
    </TouchableOpacity>
  );

  return (
    <>
      <Stack.Screen options={{ headerShown: false, gestureEnabled: false }} />
      <LinearGradient colors={[C.background, C.panel]} style={{ flex: 1 }}>
        <View style={s.container}>
            <View style={s.glow} />
            
            <View style={s.header}>
                <Text style={s.stepIndicator}>Étape 4 sur 5</Text>
                <Text style={s.title}>Tes préférences</Text>
            </View>

            <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: 100 }} showsVerticalScrollIndicator={false}>
                
                <Text style={s.sectionTitle}>Centres d&apos;intérêt (max 10)</Text>
                
                <View style={s.searchContainer}>
                    <FontAwesome name="search" size={16} color="rgba(255,255,255,0.4)" style={{ marginRight: 10 }} />
                    <TextInput 
                        style={s.searchInput}
                        placeholder="Rechercher (ex: Tennis, Cuisine...)"
                        placeholderTextColor="rgba(255,255,255,0.4)"
                        value={search}
                        onChangeText={setSearch}
                    />
                    {search.length > 0 && (
                        <TouchableOpacity onPress={() => setSearch('')}>
                            <FontAwesome name="times-circle" size={16} color="rgba(255,255,255,0.4)" />
                        </TouchableOpacity>
                    )}
                </View>

                <View style={s.chipsContainer}>
                    {displayedActivities.map(act => (
                        <ActivityChip 
                            key={act.id} 
                            label={act.label} 
                            icon={act.icon} 
                            selected={interests.includes(act.id)} 
                            onPress={() => toggleInterest(act.id)} 
                        />
                    ))}
                    {displayedActivities.length === 0 && (
                        <Text style={{ color: 'rgba(255,255,255,0.4)', fontStyle: 'italic', marginTop: 10 }}>Aucune activité trouvée</Text>
                    )}
                </View>

                <Text style={s.sectionTitle}>Ton genre</Text>
                <View style={s.horizontalGroup}>
                    <MiniOption label="Homme" icon="mars" selected={genderIdentity === 'hommes'} onPress={() => setGenderIdentity(cur => (cur === 'hommes' ? null : 'hommes'))} />
                    <MiniOption label="Femme" icon="venus" selected={genderIdentity === 'femmes'} onPress={() => setGenderIdentity(cur => (cur === 'femmes' ? null : 'femmes'))} />
                    <MiniOption label="Autre" icon="transgender" selected={genderIdentity === 'autres'} onPress={() => setGenderIdentity(cur => (cur === 'autres' ? null : 'autres'))} />
                </View>

                <Text style={s.sectionTitle}>Tu veux voir qui ?</Text>
                <View style={s.horizontalGroup}>
                    <MiniOption label="Hommes" icon="mars" selected={genders.includes('hommes')} onPress={() => selectSingle<Gen>(genders, 'hommes', setGenders)} />
                    <MiniOption label="Femmes" icon="venus" selected={genders.includes('femmes')} onPress={() => selectSingle<Gen>(genders, 'femmes', setGenders)} />
                    <MiniOption label="Les deux" icon="venus-mars" selected={genders.includes('autres')} onPress={() => selectSingle<Gen>(genders, 'autres', setGenders)} />
                </View>

            </ScrollView>

            <View style={s.footer}>
                <GradientButton label="Continuer" onPress={finish} disabled={disabled} />
            </View>
        </View>
      </LinearGradient>
    </>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, paddingHorizontal: 24, paddingTop: 60 },
  glow: { position: 'absolute', top: 50, right: -100, width: 300, height: 300, borderRadius: 150, backgroundColor: 'rgba(236, 72, 153, 0.15)' },
  header: { marginBottom: 24 },
  stepIndicator: { color: '#EC4899', fontWeight: '700', fontSize: 14, marginBottom: 16, letterSpacing: 1, textTransform: 'uppercase' },
  title: { fontSize: 36, fontWeight: '900', color: Colors.dark.text, lineHeight: 40 },
  
  sectionTitle: { fontSize: 18, fontWeight: '700', color: Colors.dark.text, marginTop: 32, marginBottom: 16 },
  
  chipsContainer: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  chip: { 
      flexDirection: 'row', 
      alignItems: 'center', 
      backgroundColor: 'rgba(255,255,255,0.05)', 
      paddingVertical: 10, 
      paddingHorizontal: 16, 
      borderRadius: 25, 
      borderWidth: 1, 
      borderColor: 'rgba(255,255,255,0.1)' 
  },
  chipSelected: { 
      backgroundColor: Colors.dark.tint, 
      borderColor: Colors.dark.tint 
  },
  chipLabel: { fontSize: 14, fontWeight: '600', color: 'rgba(255,255,255,0.6)' },

  horizontalGroup: { flexDirection: 'row', gap: 12 },
  miniOption: { flex: 1, backgroundColor: 'rgba(255,255,255,0.05)', borderRadius: 16, padding: 16, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)', height: 100 },
  miniOptionSelected: { backgroundColor: Colors.dark.overlay, borderColor: Colors.dark.tint },
  miniLabel: { fontSize: 14, fontWeight: '600', color: 'rgba(255,255,255,0.6)' },

  footer: { position: 'absolute', bottom: 40, left: 24, right: 24 },

  searchContainer: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: 'rgba(255,255,255,0.05)',
      borderRadius: 12,
      paddingHorizontal: 12,
      paddingVertical: 10,
      marginBottom: 16,
      borderWidth: 1,
      borderColor: 'rgba(255,255,255,0.1)',
  },
  searchInput: {
      flex: 1,
      color: Colors.dark.text,
      fontSize: 14,
      fontWeight: '600',
  },
});
