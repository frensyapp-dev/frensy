import { router } from 'expo-router';
import { View, Text, TouchableOpacity, StyleSheet, ScrollView } from 'react-native';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import { Colors } from '../../constants/Colors';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

export default function PrivacyPolicy() {
  const C = Colors['dark'];
  const insets = useSafeAreaInsets();

  return (
    <View style={{ flex: 1, backgroundColor: C.background, paddingTop: insets.top }}>
      <View style={s.header}>
        <TouchableOpacity onPress={() => router.back()} style={{ padding: 6 }}>
          <FontAwesome name="chevron-left" size={18} color={C.text} />
        </TouchableOpacity>
        <Text style={[s.title, { color: C.text }]}>Politique de Confidentialité</Text>
        <View style={{ width: 24 }} />
      </View>

      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 16, gap: 14 }}>
        <Text style={{ color: C.text, marginBottom: 16 }}>
          Chez Frensy, nous accordons une importance capitale à la confidentialité de vos données. Cette politique de confidentialité explique comment nous collectons, utilisons et protégeons vos informations lorsque vous utilisez notre application mobile et nos services.
        </Text>

        <Section title="1. Informations que nous collectons" C={C}>
          <Text style={{ color: C.text }}>
            Nous collectons les informations que vous nous fournissez directement, telles que :
            {'\n'}• Vos informations de profil (nom, âge, photos, intérêts, bio).
            {'\n'}• Vos préférences de découverte (tranche d&apos;âge, distance).
            {'\n'}• Les messages que vous envoyez et recevez.
          </Text>
          <Text style={{ color: C.text }}>
            Nous collectons également automatiquement certaines informations :
            {'\n'}• Votre localisation précise (si vous l&apos;autorisez) pour vous montrer des personnes à proximité.
            {'\n'}• Des données techniques sur votre appareil et votre utilisation de l&apos;application.
          </Text>
        </Section>

        <Section title="2. Utilisation de vos informations" C={C}>
          <Text style={{ color: C.text }}>
            Nous utilisons vos informations pour :
            {'\n'}• Vous fournir le service et vous mettre en relation avec d&apos;autres utilisateurs.
            {'\n'}• Améliorer et personnaliser votre expérience.
            {'\n'}• Assurer la sécurité de la communauté et modérer les contenus.
          </Text>
        </Section>

        <Section title="3. Partage des informations" C={C}>
          <Text style={{ color: C.text }}>
            Nous ne vendons pas vos données personnelles. Nous partageons vos informations uniquement dans les cas suivants :
            {'\n'}• Avec d&apos;autres utilisateurs (votre profil public).
            {'\n'}• Avec nos prestataires de services (hébergement, analyse).
            {'\n'}• Si la loi l&apos;exige ou pour protéger nos droits.
          </Text>
        </Section>
      </ScrollView>
    </View>
  );
}

function Section({ title, C, children }: { title: string; C: typeof Colors['light'] | typeof Colors['dark']; children: React.ReactNode }) {
  return (
    <View style={[s.card, { backgroundColor: C.card, borderColor: C.border }]}> 
      <Text style={[s.cardTitle, { color: C.text }]}>{title}</Text>
      {children}
    </View>
  );
}

const s = StyleSheet.create({
  header: { paddingHorizontal: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', height: 56 },
  title: { fontSize: 18, fontWeight: '900' },
  card: { borderWidth: 1, borderRadius: 16, padding: 14, gap: 8 },
  cardTitle: { fontSize: 16, fontWeight: '900', marginBottom: 6 },
});
