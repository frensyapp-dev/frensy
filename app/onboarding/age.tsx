import dayjs from 'dayjs';
import 'dayjs/locale/fr';
import customParseFormat from 'dayjs/plugin/customParseFormat';
import { LinearGradient } from 'expo-linear-gradient';
import { router, Stack } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Alert, Animated, BackHandler, Dimensions, Easing, Modal, Pressable, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { GradientButton } from '../../components/ui/GradientButton';
import { auth } from '../../firebaseconfig';
import { getUserProfile, savePartialProfile } from '../../lib/profile';

dayjs.extend(customParseFormat);
dayjs.locale('fr');

function computeRange(age: number) {
  if (age < 18) return null;
  // Default range: -10 to +10 years, but min 18
  const min = Math.max(18, age - 10);
  const max = age + 10;
  return { min, max };
}

const MONTHS = [
  'Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin',
  'Juillet', 'Août', 'Septembre', 'Octobre', 'Novembre', 'Décembre'
];

export default function AgeStep() {
  const [day, setDay] = useState<string>('');
  const [month, setMonth] = useState<string>('');
  const [year, setYear] = useState<string>('');
  const [accountType, setAccountType] = useState<'individual' | 'group'>('individual');
  
  const [modalVisible, setModalVisible] = useState(false);
  const [modalType, setModalType] = useState<'day' | 'month' | 'year' | null>(null);

  const [sending, setSending] = useState(false);
  const slideAnim = useRef(new Animated.Value(Dimensions.get('window').height)).current;

  useEffect(() => {
    const loadProfile = async () => {
        const uid = auth.currentUser?.uid;
        if (uid) {
            const profile = await getUserProfile(uid);
            if (profile?.accountType) {
                setAccountType(profile.accountType);
            }
        }
    }
    loadProfile();
  }, []);

  useEffect(() => {
    if (modalVisible) {
      slideAnim.setValue(Dimensions.get('window').height);
      Animated.timing(slideAnim, {
        toValue: 0,
        duration: 300,
        useNativeDriver: true,
        easing: Easing.out(Easing.cubic),
      }).start();
    }
  }, [modalVisible]);

  const closeModal = () => {
    Animated.timing(slideAnim, {
      toValue: Dimensions.get('window').height,
      duration: 250,
      useNativeDriver: true,
      easing: Easing.in(Easing.cubic),
    }).start(() => setModalVisible(false));
  };

  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => true);
    return () => sub.remove();
  }, []);

  const getDays = () => {
    return Array.from({ length: 31 }, (_, i) => String(i + 1).padStart(2, '0'));
  };

  const getYears = () => {
    const currentYear = new Date().getFullYear();
    return Array.from({ length: 100 }, (_, i) => String(currentYear - 13 - i)); // Min 13 ans
  };

  const openModal = (type: 'day' | 'month' | 'year') => {
    setModalType(type);
    setModalVisible(true);
  };

  const selectItem = (item: string, index?: number) => {
    if (modalType === 'day') setDay(item);
    if (modalType === 'month') setMonth((index! + 1).toString());
    if (modalType === 'year') setYear(item);
    closeModal();
  };

  const calculateAge = () => {
    if (!day || !month || !year) return null;
    // Format YYYY-MM-DD standard (avec zéros) pour éviter les erreurs de parsing strict
    const d = day.padStart(2, '0');
    const m = month.padStart(2, '0');
    const birthDate = dayjs(`${year}-${m}-${d}`, 'YYYY-MM-DD');
    if (!birthDate.isValid()) return null;
    return dayjs().diff(birthDate, 'year');
  };

  const next = async () => {
    const age = calculateAge();
    
    if (age === null || !Number.isFinite(age)) {
        Alert.alert('Date invalide', 'Veuillez sélectionner une date de naissance valide.');
        return;
    }

    const bounds = computeRange(age);
    if (!bounds) {
      Alert.alert(
        'Âge invalide',
        'Tu dois avoir au moins 18 ans pour utiliser Frensy.\n\nLes personnes de moins de 18 ans ne peuvent pas utiliser l’application et nous ne nous tenons pas responsables en cas de fausse déclaration.'
      );
      return;
    }

    const uid = auth.currentUser?.uid;
    if (!uid) return;

    const birthDate = dayjs(`${year}-${month}-${day}`, 'YYYY-M-D').format('YYYY-MM-DD');

    try {
      setSending(true);
      await savePartialProfile(uid, {
        birthDate, 
        age,       
        ageLock: 'adult',
        desiredMinAge: bounds.min,
        desiredMaxAge: bounds.max,
      });
      router.replace('/onboarding/preferences'); 
    } catch (e: any) {
      const msg = e?.message || String(e);
      const isPerm = /permission/i.test(msg) || /PERMISSION_DENIED/i.test(msg);
      Alert.alert(
        'Erreur',
        isPerm
          ? "Impossible d’enregistrer l’âge. Si un âge existait déjà, tu ne peux pas le modifier directement dans l’application."
          : 'Une erreur est survenue. Réessaie dans un instant.'
      );
    } finally {
      setSending(false);
    }
  };

  const renderModalContent = () => {
    let data: string[] = [];
    if (modalType === 'day') data = getDays();
    if (modalType === 'month') data = MONTHS;
    if (modalType === 'year') data = getYears();

    return (
      <>
        <Text style={[s.modalTitle, { color: '#fff' }]}>
            Sélectionner {modalType === 'day' ? 'le jour' : modalType === 'month' ? 'le mois' : "l'année"}
        </Text>
        <ScrollView style={{ maxHeight: 300, width: '100%' }}>
            {data.map((item, index) => (
                <TouchableOpacity 
                    key={index} 
                    style={s.modalItem} 
                    onPress={() => selectItem(item, index)}
                >
                    <Text style={[s.modalItemText, { color: '#fff' }]}>{item}</Text>
                </TouchableOpacity>
            ))}
        </ScrollView>
        <TouchableOpacity style={s.closeButton} onPress={closeModal}>
            <Text style={s.closeButtonText}>Fermer</Text>
        </TouchableOpacity>
      </>
    );
  };

  const getMonthName = (m: string) => {
      const idx = parseInt(m) - 1;
      return MONTHS[idx] || '';
  };

  return (
    <>
      <Stack.Screen options={{ headerShown: false, gestureEnabled: false }} />

      <LinearGradient colors={['#000000', '#111827']} style={{ flex: 1 }}>
        <View style={s.container}>
            
            {/* Glow */}
            <View style={s.glow} />

            <View style={s.content}>
                <Text style={s.stepIndicator}>Étape 3 sur 5</Text>
                <Text style={s.title}>
                    {accountType === 'group' ? "Âge du créateur" : "C'est quand ton anniversaire ?"}
                </Text>
                <Text style={s.subtitle}>
                    {accountType === 'group' 
                        ? "Le créateur du groupe doit être majeur." 
                        : "Ton âge sera visible sur ton profil."}
                </Text>
                
                <View style={s.dateContainer}>
                    <TouchableOpacity style={s.dateBlock} onPress={() => openModal('day')}>
                        <Text style={s.dateLabel}>JOUR</Text>
                        <Text style={[s.dateValue, !day && { color: '#666' }]}>{day || '01'}</Text>
                    </TouchableOpacity>

                    <TouchableOpacity style={[s.dateBlock, { flex: 1.5 }]} onPress={() => openModal('month')}>
                        <Text style={s.dateLabel}>MOIS</Text>
                        <Text style={[s.dateValue, !month && { color: '#666' }]}>{month ? getMonthName(month).substring(0, 3).toUpperCase() : 'JAN'}</Text>
                    </TouchableOpacity>

                    <TouchableOpacity style={s.dateBlock} onPress={() => openModal('year')}>
                        <Text style={s.dateLabel}>ANNÉE</Text>
                        <Text style={[s.dateValue, !year && { color: '#666' }]}>{year || '2002'}</Text>
                    </TouchableOpacity>
                </View>
            </View>

            <View style={s.footer}>
                 <GradientButton label={sending ? "Enregistrement..." : "Continuer"} onPress={next} disabled={!day || !month || !year || sending} />
            </View>
        </View>
      </LinearGradient>

      {/* Modal */}
      <Modal visible={modalVisible} transparent animationType="none" onRequestClose={closeModal}>
        <View style={{ flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.6)' }}>
            <Pressable style={StyleSheet.absoluteFill} onPress={closeModal} />
            <Animated.View style={[s.modalContent, { transform: [{ translateY: slideAnim }] }]}>
                {renderModalContent()}
            </Animated.View>
        </View>
      </Modal>
    </>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, paddingHorizontal: 24, paddingVertical: 60, justifyContent: 'space-between' },
  glow: { position: 'absolute', top: 100, left: -100, width: 300, height: 300, borderRadius: 150, backgroundColor: 'rgba(124, 58, 237, 0.15)' },
  content: { flex: 1, justifyContent: 'center' },
  stepIndicator: { color: '#A855F7', fontWeight: '700', fontSize: 14, marginBottom: 16, letterSpacing: 1, textTransform: 'uppercase' },
  title: { fontSize: 40, fontWeight: '900', color: '#fff', marginBottom: 12, lineHeight: 44 },
  subtitle: { color: 'rgba(255,255,255,0.6)', fontSize: 16, marginBottom: 40, lineHeight: 24 },
  
  dateContainer: { flexDirection: 'row', gap: 12 },
  dateBlock: { flex: 1, backgroundColor: 'rgba(255,255,255,0.05)', borderRadius: 20, padding: 16, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)' },
  dateLabel: { color: 'rgba(255,255,255,0.4)', fontSize: 10, fontWeight: '700', marginBottom: 4, letterSpacing: 1 },
  // Valeur affichée (ex: "2002")
  dateValue: { color: '#fff', fontSize: 20, fontWeight: '800' },

  footer: { width: '100%' },

  // Modal
  modalContent: { backgroundColor: '#1c1c1e', borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 24, paddingBottom: 40, borderTopWidth: 1, borderColor: '#333' },
  modalTitle: { fontSize: 20, fontWeight: '800', marginBottom: 16, textAlign: 'center' },
  modalItem: { paddingVertical: 16, borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.1)' },
  modalItemText: { fontSize: 18, textAlign: 'center' },
  closeButton: { marginTop: 16, padding: 16, backgroundColor: '#333', borderRadius: 12, alignItems: 'center' },
  closeButtonText: { color: '#fff', fontWeight: '600' },
});
