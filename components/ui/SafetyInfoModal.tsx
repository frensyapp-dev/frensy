import React, { useState, useEffect } from 'react';
import { Modal, View, Text, StyleSheet, TouchableOpacity, Dimensions } from 'react-native';
import { Colors } from '../../constants/Colors';
import { GradientButton } from './GradientButton';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import AsyncStorage from '@react-native-async-storage/async-storage';

const { width, height } = Dimensions.get('window');

const SLIDES = [
  {
    title: 'Ta sécurité, notre priorité',
    description: 'Frensy floute ta position par défaut (~1km). Personne ne voit où tu te trouves exactement.',
    icon: 'shield',
    color: '#3BA55D'
  },
  {
    title: 'Le Partage Live 📡',
    description: 'N’active le partage précis que via la boussole dans le chat, et seulement avec des personnes de confiance.',
    icon: 'compass',
    color: '#3B82F6'
  },
  {
    title: 'Mode Fantôme 👻',
    description: 'Tu ne veux pas apparaître ? Active le mode fantôme via le bouton en bas à gauche pour devenir invisible instantanément.',
    icon: 'ghost',
    color: '#A855F7'
  }
];

export function SafetyInfoModal() {
  const [visible, setVisible] = useState(false);
  const [step, setStep] = useState(0);
  const C = Colors['dark'];

  useEffect(() => {
    checkVisibility();
  }, []);

  const checkVisibility = async () => {
    try {
      const hasSeen = await AsyncStorage.getItem('hasSeenSafetyInfo_v1');
      if (!hasSeen) {
        setVisible(true);
      }
    } catch (e) {}
  };

  const onFinish = async () => {
    try {
      await AsyncStorage.setItem('hasSeenSafetyInfo_v1', 'true');
      setVisible(false);
    } catch (e) {}
  };

  const next = () => {
    if (step < SLIDES.length - 1) {
      setStep(step + 1);
    } else {
      onFinish();
    }
  };

  if (!visible) return null;

  const current = SLIDES[step];

  return (
    <Modal transparent visible={visible} animationType="fade">
      <View style={s.overlay}>
        <View style={[s.card, { backgroundColor: C.card }]}>
          <View style={[s.iconBg, { backgroundColor: current.color + '20' }]}>
            <FontAwesome name={current.icon as any} size={40} color={current.color} />
          </View>
          
          <Text style={s.title}>{current.title}</Text>
          <Text style={s.desc}>{current.description}</Text>

          <View style={s.pagination}>
            {SLIDES.map((_, i) => (
              <View key={i} style={[s.dot, { backgroundColor: i === step ? current.color : 'rgba(255,255,255,0.1)' }]} />
            ))}
          </View>

          <TouchableOpacity onPress={next} style={[s.btn, { backgroundColor: current.color }]}>
            <Text style={s.btnText}>{step === SLIDES.length - 1 ? 'C’est compris !' : 'Suivant'}</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

const s = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.85)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 30
  },
  card: {
    width: '100%',
    borderRadius: 32,
    padding: 30,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)'
  },
  iconBg: {
    width: 80,
    height: 80,
    borderRadius: 40,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 20
  },
  title: {
    color: '#FFF',
    fontSize: 20,
    fontWeight: '800',
    textAlign: 'center',
    marginBottom: 12
  },
  desc: {
    color: 'rgba(255,255,255,0.7)',
    fontSize: 15,
    textAlign: 'center',
    lineHeight: 22,
    marginBottom: 24
  },
  pagination: {
    flexDirection: 'row',
    gap: 6,
    marginBottom: 24
  },
  dot: {
    width: 12,
    height: 4,
    borderRadius: 2
  },
  btn: {
    width: '100%',
    height: 50,
    borderRadius: 25,
    justifyContent: 'center',
    alignItems: 'center'
  },
  btnText: {
    color: '#FFF',
    fontWeight: '800',
    fontSize: 16
  }
});
