import React, { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Modal, View, Text, StyleSheet, Pressable, Dimensions } from 'react-native';
import { BlurView } from 'expo-blur';
import { Colors } from '../constants/Colors';
import { GradientButton } from './ui/GradientButton';

// Liste des étapes éducatives possibles
export type TutorialStep = 
  | 'welcome_home'       // Premier arrivée sur la Home
  | 'first_chat_open'    // Ouverture d'une conversation
  | 'first_store_visit'; // Visite du store

interface TutorialContextType {
  // Demande d'afficher une étape. 
  // Si une autre étape est déjà en cours ou si celle-ci a déjà été vue, elle sera ignorée ou mise en file d'attente.
  triggerStep: (step: TutorialStep) => void;
}

const TutorialContext = createContext<TutorialContextType | null>(null);

const STORAGE_PREFIX = 'tutorial_seen:';

const STEPS_CONTENT: Record<TutorialStep, { title: string; message: string; icon: string }> = {
  welcome_home: {
    title: "Bienvenue sur Frensy !",
    message: "Découvre les personnes autour de toi. Tape sur un profil pour en savoir plus ou discuter.",
    icon: "👋"
  },
  first_chat_open: {
    title: "Sécurité avant tout",
    message: "Si un profil te semble suspect ou demande de l'argent, signale-le immédiatement via les options en haut à droite. Reste prudent !",
    icon: "🛡️"
  },
  first_store_visit: {
    title: "Boost tes rencontres",
    message: "Utilise tes Pins pour envoyer des messages directs ou te mettre en avant.",
    icon: "💎"
  }
};

export function TutorialProvider({ children }: { children: ReactNode }) {
  const [currentStep, setCurrentStep] = useState<TutorialStep | null>(null);
  const [queue, setQueue] = useState<TutorialStep[]>([]);
  const [seenSteps, setSeenSteps] = useState<Set<TutorialStep>>(new Set());
  const C = Colors['dark'];

  // Charger l'état "déjà vu" au démarrage
  useEffect(() => {
    (async () => {
      const keys = Object.keys(STEPS_CONTENT) as TutorialStep[];
      const seen = new Set<TutorialStep>();
      for (const k of keys) {
        const val = await AsyncStorage.getItem(STORAGE_PREFIX + k);
        if (val) seen.add(k);
      }
      setSeenSteps(seen);
    })();
  }, []);

  // Traiter la file d'attente
  useEffect(() => {
    if (!currentStep && queue.length > 0) {
      const next = queue[0];
      setQueue(prev => prev.slice(1));
      setCurrentStep(next);
    }
  }, [currentStep, queue]);

  const triggerStep = (step: TutorialStep) => {
    if (seenSteps.has(step)) return;
    
    // Si déjà en cours ou dans la file, on ignore pour éviter les doublons
    if (currentStep === step || queue.includes(step)) return;

    setQueue(prev => [...prev, step]);
  };

  const markAsSeen = async () => {
    if (!currentStep) return;
    const step = currentStep;
    
    try {
      await AsyncStorage.setItem(STORAGE_PREFIX + step, '1');
      setSeenSteps(prev => new Set(prev).add(step));
    } catch (e) {
      console.warn('Failed to save tutorial step', e);
    }
    setCurrentStep(null);
  };

  const content = currentStep ? STEPS_CONTENT[currentStep] : null;

  return (
    <TutorialContext.Provider value={{ triggerStep }}>
      {children}
      
      {currentStep && content && (
        <Modal visible transparent animationType="fade" onRequestClose={markAsSeen}>
          <View style={s.overlay}>
             <BlurView intensity={20} tint="dark" style={StyleSheet.absoluteFill} />
             <View style={[s.card, { backgroundColor: '#1c1c1e', borderColor: '#333' }]}>
                <Text style={s.icon}>{content.icon}</Text>
                <Text style={[s.title, { color: '#fff' }]}>{content.title}</Text>
                <Text style={[s.message, { color: '#ccc' }]}>{content.message}</Text>
                
                <View style={s.footer}>
                    <GradientButton label="Compris" onPress={markAsSeen} />
                </View>
             </View>
          </View>
        </Modal>
      )}
    </TutorialContext.Provider>
  );
}

export const useTutorial = () => {
  const ctx = useContext(TutorialContext);
  if (!ctx) throw new Error("useTutorial must be used within TutorialProvider");
  return ctx;
};

const { width } = Dimensions.get('window');

const s = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24
  },
  card: {
    width: '100%',
    maxWidth: 340,
    borderRadius: 24,
    padding: 24,
    alignItems: 'center',
    borderWidth: 1,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.5,
    shadowRadius: 20,
    elevation: 10
  },
  icon: {
    fontSize: 48,
    marginBottom: 16
  },
  title: {
    fontSize: 22,
    fontWeight: '800',
    textAlign: 'center',
    marginBottom: 12
  },
  message: {
    fontSize: 16,
    textAlign: 'center',
    lineHeight: 22,
    marginBottom: 24
  },
  footer: {
    width: '100%'
  }
});
