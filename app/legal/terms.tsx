import { router } from 'expo-router';
import { View, Text, TouchableOpacity, StyleSheet, ScrollView } from 'react-native';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import { Colors } from '../../constants/Colors';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

export default function TermsOfService() {
  const C = Colors['dark'];
  const insets = useSafeAreaInsets();

  return (
    <View style={{ flex: 1, backgroundColor: C.background, paddingTop: insets.top }}>
      <View style={s.header}>
        <TouchableOpacity onPress={() => router.back()} style={{ padding: 6 }}>
          <FontAwesome name="chevron-left" size={18} color={C.text} />
        </TouchableOpacity>
        <Text style={[s.title, { color: C.text }]}>Conditions Générales</Text>
        <View style={{ width: 24 }} />
      </View>

      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 16, gap: 14 }}>
        <Text style={{ color: C.muted, marginBottom: 8 }}>
          Dernière mise à jour : 25 décembre 2025
        </Text>

        <Section title="1. Objet et Acceptation" C={C}>
          <Text style={{ color: C.text }}>
            Frensy est une application de rencontre et de messagerie sociale. En créant un compte ou en utilisant l’application, tu acceptes sans réserve les présentes Conditions Générales d&apos;Utilisation (CGU).
          </Text>
        </Section>

        <Section title="2. Éligibilité et Inscription" C={C}>
          <Text style={{ color: C.text }}>
            Tu dois avoir au moins 18 ans pour utiliser Frensy.
            Tu t&apos;engages à fournir des informations exactes lors de ton inscription. Les faux profils ou l&apos;usurpation d&apos;identité sont strictement interdits.
          </Text>
        </Section>

        <Section title="3. Code de Conduite" C={C}>
          <Text style={{ color: C.text }}>
            Frensy se veut un espace sûr et respectueux. Il est strictement interdit de :
            {'\n'}• Harceler, intimider ou menacer d&apos;autres utilisateurs.
            {'\n'}• Publier des contenus haineux, racistes, sexistes ou discriminatoires.
            {'\n'}• Partager des contenus pornographiques, violents ou illégaux.
            {'\n'}• Utiliser l&apos;application à des fins de spam, d&apos;escroquerie ou commerciales non autorisées.
          </Text>
        </Section>

        <Section title="4. Contenu Utilisateur" C={C}>
          <Text style={{ color: C.text }}>
            Tu restes propriétaire des photos et messages que tu publies. Toutefois, en les publiant sur Frensy, tu nous accordes une licence mondiale, non exclusive et gratuite pour les héberger, les afficher et les distribuer dans le cadre du fonctionnement du service.
            Tu garantis que ton contenu ne viole aucun droit de tiers (droit à l&apos;image, droit d&apos;auteur, vie privée).
          </Text>
        </Section>

        <Section title="5. Modération et Sanctions" C={C}>
          <Text style={{ color: C.text }}>
            Nous nous réservons le droit de modérer, supprimer tout contenu ou suspendre/bannir tout compte ne respectant pas ces CGU, à notre seule discrétion et sans préavis.
            Les utilisateurs peuvent signaler tout comportement inapproprié via les outils de signalement intégrés.
          </Text>
        </Section>
        
        <Section title="6. Achats et Abonnements" C={C}>
          <Text style={{ color: C.text }}>
            Certaines fonctionnalités (ex: abonnements PRO, achats de Pins) sont payantes. Les conditions de paiement et de renouvellement sont gérées par les plateformes d&apos;achat (App Store / Google Play). Aucun remboursement n&apos;est garanti par Frensy sauf obligation légale.
          </Text>
        </Section>

        <Section title="7. Responsabilité" C={C}>
          <Text style={{ color: C.text }}>
            Frensy fournit le service &quot;tel quel&quot;. Nous ne garantissons pas que l&apos;application sera toujours ininterrompue ou exempte d&apos;erreurs.
            Nous ne sommes pas responsables des actions des utilisateurs hors de l&apos;application. Sois prudent lors de tes rencontres réelles.
          </Text>
        </Section>

        <Section title="8. Modifications" C={C}>
          <Text style={{ color: C.text }}>
            Nous pouvons modifier ces CGU à tout moment. L&apos;utilisation continue de l&apos;application après modification vaut acceptation des nouvelles conditions.
          </Text>
        </Section>

        <Section title="9. Contact" C={C}>
          <Text style={{ color: C.text }}>
            Pour toute question concernant ces conditions, contactez-nous à : frensy.app@gmail.com
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
