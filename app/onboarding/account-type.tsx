import { FontAwesome5, Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { router, Stack } from 'expo-router';
import { useEffect, useState } from 'react';
import { BackHandler, Dimensions, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { GradientButton } from '../../components/ui/GradientButton';
import { Colors } from '../../constants/Colors';
import { auth } from '../../firebaseconfig';
import { savePartialProfile } from '../../lib/profile';

const { width } = Dimensions.get('window');

export default function AccountTypeStep() {
  const [accountType, setAccountType] = useState<'individual' | 'group' | null>(null);
  const C = Colors['dark'];

  // 🔒 Bloque le bouton back Android
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => true);
    return () => sub.remove();
  }, []);

  const next = async () => {
    const uid = auth.currentUser?.uid;
    if (!uid || !accountType) return;

    await savePartialProfile(uid, { accountType });
    
    if (accountType === 'group') {
      router.replace('/onboarding/group-details');
    } else {
      router.replace('/onboarding/name');
    }
  };

  const OptionCard = ({ type, icon, title, subtitle }: { type: 'individual' | 'group', icon: string, title: string, subtitle: string }) => {
    const isSelected = accountType === type;
    return (
        <TouchableOpacity 
            onPress={() => setAccountType(type)}
            activeOpacity={0.9}
            style={[
                s.card, 
                isSelected && s.cardSelected
            ]}
        >
            <View style={[s.iconContainer, isSelected && s.iconContainerSelected]}>
                <FontAwesome5 name={icon} size={28} color={isSelected ? '#fff' : 'rgba(255,255,255,0.5)'} />
            </View>
            <View style={s.cardContent}>
                <Text style={[s.cardTitle, isSelected && s.cardTitleSelected]}>{title}</Text>
                <Text style={s.cardSubtitle}>{subtitle}</Text>
            </View>
            {isSelected && (
                <View style={s.checkIcon}>
                    <Ionicons name="checkmark-circle" size={24} color="#F97316" />
                </View>
            )}
        </TouchableOpacity>
    )
  }

  return (
    <>
      <Stack.Screen options={{ headerShown: false, gestureEnabled: false }} />
      <LinearGradient colors={['#000000', '#111827']} style={{ flex: 1 }}>
        <View style={s.container}>
            
            {/* Background Glow */}
            <View style={s.glow} />

            <View style={s.content}>
                <Text style={s.stepIndicator}>Étape 1 sur 5</Text>
                <Text style={s.title}>Quel type de compte ?</Text>
                <Text style={s.subtitle}>Choisis comment tu veux utiliser Frensy.</Text>
                
                <View style={s.optionsContainer}>
                    <OptionCard 
                        type="individual" 
                        icon="user" 
                        title="Compte Solo" 
                        subtitle="Je veux rencontrer des gens pour moi-même." 
                    />
                    
                    <OptionCard 
                        type="group" 
                        icon="users" 
                        title="Compte Groupe" 
                        subtitle="On est une bande de potes, on veut sortir ensemble." 
                    />
                </View>
            </View>

            <View style={s.footer}>
                <GradientButton label="Continuer" onPress={next} disabled={!accountType} />
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
  subtitle: { color: 'rgba(255,255,255,0.6)', fontSize: 16, marginBottom: 30, lineHeight: 24 },
  
  optionsContainer: { gap: 16 },
  card: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: 'rgba(255,255,255,0.05)',
      borderRadius: 16,
      padding: 20,
      borderWidth: 2,
      borderColor: 'transparent',
  },
  cardSelected: {
      borderColor: '#F97316',
      backgroundColor: 'rgba(249, 115, 22, 0.05)',
  },
  iconContainer: {
      width: 50,
      height: 50,
      borderRadius: 25,
      backgroundColor: 'rgba(255,255,255,0.1)',
      alignItems: 'center',
      justifyContent: 'center',
      marginRight: 16,
  },
  iconContainerSelected: {
      backgroundColor: '#F97316',
  },
  cardContent: {
      flex: 1,
  },
  cardTitle: {
      fontSize: 18,
      fontWeight: '700',
      color: 'rgba(255,255,255,0.8)',
      marginBottom: 4,
  },
  cardTitleSelected: {
      color: '#fff',
  },
  cardSubtitle: {
      fontSize: 13,
      color: 'rgba(255,255,255,0.5)',
      lineHeight: 18,
  },
  checkIcon: {
      marginLeft: 8,
  },

  footer: { width: '100%', marginTop: 'auto' },
});
