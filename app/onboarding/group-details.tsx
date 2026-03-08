import { View, Text, StyleSheet, TouchableOpacity, BackHandler, Dimensions, Pressable } from 'react-native';
import { useEffect, useState } from 'react';
import { auth } from '../../firebaseconfig';
import { savePartialProfile } from '../../lib/profile';
import { router, Stack } from 'expo-router';
import { Colors } from '../../constants/Colors';
import { GradientButton } from '../../components/ui/GradientButton';
import { LinearGradient } from 'expo-linear-gradient';
import { FontAwesome5, Ionicons } from '@expo/vector-icons';

const { width } = Dimensions.get('window');

export default function GroupDetailsStep() {
  const [males, setMales] = useState(0);
  const [females, setFemales] = useState(0);
  const [others, setOthers] = useState(0);

  const C = Colors['dark'];

  // 🔒 Bloque le bouton back Android
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => true);
    return () => sub.remove();
  }, []);

  const totalMembers = males + females + others;
  const canContinue = totalMembers >= 2;

  const next = async () => {
    const uid = auth.currentUser?.uid;
    if (!uid) return;

    if (!canContinue) {
      alert("Un groupe doit contenir au moins 2 personnes.");
      return;
    }

    await savePartialProfile(uid, { 
      groupMembers: totalMembers,
      groupComposition: { males, females, others }
    });
    router.replace('/onboarding/name');
  };

  const Counter = ({ label, icon, value, setValue }: { label: string, icon: string, value: number, setValue: (v: number) => void }) => (
    <View style={s.counterRow}>
       <View style={s.counterLabelContainer}>
          <View style={s.iconBadge}>
            <FontAwesome5 name={icon} size={16} color="#fff" />
          </View>
          <Text style={s.counterLabel}>{label}</Text>
       </View>
       
       <View style={s.counterControls}>
          <TouchableOpacity 
            onPress={() => setValue(Math.max(0, value - 1))}
            style={[s.controlBtn, value === 0 && s.controlBtnDisabled]}
            disabled={value === 0}
          >
             <FontAwesome5 name="minus" size={14} color={value === 0 ? '#666' : '#fff'} />
          </TouchableOpacity>
          
          <View style={s.valueContainer}>
             <Text style={s.valueText}>{value}</Text>
          </View>

          <TouchableOpacity 
            onPress={() => setValue(Math.min(10, value + 1))}
            style={s.controlBtn}
          >
             <FontAwesome5 name="plus" size={14} color="#fff" />
          </TouchableOpacity>
       </View>
    </View>
  );

  return (
    <>
      <Stack.Screen options={{ headerShown: false, gestureEnabled: false }} />
      <LinearGradient colors={['#000000', '#111827']} style={{ flex: 1 }}>
        <View style={s.container}>
            
            {/* Background Glow */}
            <View style={s.glow} />

            <View style={s.content}>
                <Text style={s.stepIndicator}>Étape 1b sur 5</Text>
                <Text style={s.title}>Composition du groupe</Text>
                <Text style={s.subtitle}>Indiquez combien vous êtes dans le groupe.</Text>
                
                <View style={s.countersContainer}>
                    <Counter label="Garçons" icon="male" value={males} setValue={setMales} />
                    <Counter label="Filles" icon="female" value={females} setValue={setFemales} />
                    <Counter label="Autres" icon="user" value={others} setValue={setOthers} />
                </View>

                <View style={s.summary}>
                   <Text style={s.summaryText}>Total : {totalMembers} personnes</Text>
                   {!canContinue && totalMembers > 0 && (
                     <Text style={s.errorText}>Minimum 2 personnes requises</Text>
                   )}
                </View>
            </View>

            <View style={s.footer}>
                <GradientButton label="Continuer" onPress={next} disabled={!canContinue} />
                <TouchableOpacity onPress={() => router.replace('/onboarding/account-type')} style={s.backBtn}>
                   <Text style={s.backText}>Changer type de compte</Text>
                </TouchableOpacity>
            </View>

        </View>
      </LinearGradient>
    </>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, paddingHorizontal: 24, paddingTop: 60, paddingBottom: 20 },
  glow: { position: 'absolute', top: -150, right: -100, width: 400, height: 400, borderRadius: 200, backgroundColor: 'rgba(249, 115, 22, 0.1)' },
  content: { flex: 1, marginTop: 40 },
  stepIndicator: { color: '#F97316', fontWeight: '700', fontSize: 14, marginBottom: 16, letterSpacing: 1, textTransform: 'uppercase' },
  title: { fontSize: 32, fontWeight: '900', color: '#fff', marginBottom: 12, lineHeight: 40 },
  subtitle: { color: 'rgba(255,255,255,0.6)', fontSize: 16, marginBottom: 40, lineHeight: 24 },
  
  countersContainer: { gap: 16 },
  counterRow: {
     flexDirection: 'row',
     alignItems: 'center',
     justifyContent: 'space-between',
     backgroundColor: 'rgba(255,255,255,0.05)',
     padding: 16,
     borderRadius: 16,
     borderWidth: 1,
     borderColor: 'rgba(255,255,255,0.1)',
  },
  counterLabelContainer: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  iconBadge: { 
     width: 32, height: 32, borderRadius: 16, backgroundColor: 'rgba(249, 115, 22, 0.2)', 
     alignItems: 'center', justifyContent: 'center' 
  },
  counterLabel: { color: '#fff', fontSize: 16, fontWeight: '600' },
  
  counterControls: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  controlBtn: {
     width: 36, height: 36, borderRadius: 12, backgroundColor: '#333',
     alignItems: 'center', justifyContent: 'center',
     borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)',
  },
  controlBtnDisabled: { opacity: 0.5, backgroundColor: '#222' },
  valueContainer: { minWidth: 24, alignItems: 'center' },
  valueText: { color: '#fff', fontSize: 18, fontWeight: '700' },

  summary: { marginTop: 30, alignItems: 'center' },
  summaryText: { color: 'rgba(255,255,255,0.8)', fontSize: 16, fontWeight: '600' },
  errorText: { color: '#EF4444', fontSize: 14, marginTop: 8 },

  footer: { width: '100%', marginTop: 'auto', gap: 16 },
  backBtn: { alignItems: 'center', padding: 10 },
  backText: { color: 'rgba(255,255,255,0.5)', fontSize: 14 },
});