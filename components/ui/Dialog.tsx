import { BlurView } from 'expo-blur';
import React, { createContext, useCallback, useContext, useRef, useState } from 'react';
import { ActivityIndicator, Animated, Modal, Platform, Pressable, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Colors } from '../../constants/Colors';
import GlassCard from './GlassCard';

type ButtonStyle = 'default' | 'cancel' | 'destructive';

interface DialogButton {
  text: string;
  onPress?: () => void | Promise<void>;
  style?: ButtonStyle;
}

interface DialogOptions {
  title: string;
  message?: string;
  buttons?: DialogButton[];
  verticalButtons?: boolean;
}

interface DialogContextData {
  showDialog: (options: DialogOptions) => void;
  hideDialog: () => void;
  alert: (title: string, message?: string, buttons?: DialogButton[]) => void;
  confirm: (title: string, message: string, onConfirm: () => void) => void;
}

const DialogContext = createContext<DialogContextData>({} as DialogContextData);

export const useDialog = () => useContext(DialogContext);

export const DialogProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [visible, setVisible] = useState(false);
  const [config, setConfig] = useState<DialogOptions | null>(null);
  
  const [executing, setExecuting] = useState(false);
  
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const scaleAnim = useRef(new Animated.Value(0.9)).current;

  const showDialog = useCallback((options: DialogOptions) => {
    setConfig(options);
    setVisible(true);
    setExecuting(false);
    
    // Reset animations
    fadeAnim.setValue(0);
    scaleAnim.setValue(0.9);

    Animated.parallel([
      Animated.timing(fadeAnim, {
        toValue: 1,
        duration: 200,
        useNativeDriver: true,
      }),
      Animated.spring(scaleAnim, {
        toValue: 1,
        friction: 7,
        tension: 40,
        useNativeDriver: true,
      }),
    ]).start();
  }, [fadeAnim, scaleAnim]);

  const hideDialog = useCallback(() => {
    Animated.parallel([
      Animated.timing(fadeAnim, {
        toValue: 0,
        duration: 150,
        useNativeDriver: true,
      }),
      Animated.timing(scaleAnim, {
        toValue: 0.9,
        duration: 150,
        useNativeDriver: true,
      }),
    ]).start(() => {
      setVisible(false);
      setConfig(null);
    });
  }, [fadeAnim, scaleAnim]);

  const alert = useCallback((title: string, message?: string, buttons?: DialogButton[]) => {
    showDialog({
      title,
      message,
      buttons: buttons || [{ text: 'OK', style: 'default' }]
    });
  }, [showDialog]);

  const confirm = useCallback((title: string, message: string, onConfirm: () => void) => {
    showDialog({
      title,
      message,
      buttons: [
        { text: 'Annuler', style: 'cancel' },
        { text: 'Confirmer', style: 'default', onPress: onConfirm }
      ]
    });
  }, [showDialog]);

  const C = Colors['dark'];

  return (
    <DialogContext.Provider value={{ showDialog, hideDialog, alert, confirm }}>
      {children}
      <Modal
        visible={visible}
        transparent
        animationType="none"
        onRequestClose={hideDialog}
        statusBarTranslucent
      >
        <View style={styles.overlay}>
          <Animated.View style={[StyleSheet.absoluteFill, { opacity: fadeAnim }]}>
            <BlurView intensity={Platform.OS === 'ios' ? 20 : 10} tint="dark" style={StyleSheet.absoluteFill} />
            <Pressable style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(0,0,0,0.6)' }]} onPress={hideDialog} />
          </Animated.View>

          <Animated.View style={[styles.dialogContainer, { opacity: fadeAnim, transform: [{ scale: scaleAnim }] }]}>
            <GlassCard style={styles.glassContent} intensity={80}>
              <Text style={styles.title}>{config?.title}</Text>
              {config?.message && <Text style={styles.message}>{config.message}</Text>}

              <View style={[styles.buttonContainer, config?.verticalButtons && { flexDirection: 'column' }]}>
                {config?.buttons?.map((btn, index) => {
                  const isCancel = btn.style === 'cancel';
                  const isDestructive = btn.style === 'destructive';
                  
                  return (
                    <TouchableOpacity
                      key={index}
                      disabled={executing}
                      onPress={async () => {
                        if (executing) return;
                        setExecuting(true);
                        try {
                          if (btn.onPress) await btn.onPress();
                          hideDialog();
                        } catch (e) {
                          setExecuting(false);
                          throw e;
                        }
                      }}
                      style={[
                        styles.button,
                        config.verticalButtons && { width: '100%', marginBottom: 8 },
                        isCancel && { backgroundColor: 'rgba(255,255,255,0.1)' },
                        isDestructive && { backgroundColor: 'rgba(239, 68, 68, 0.2)', borderWidth: 1, borderColor: 'rgba(239, 68, 68, 0.3)' },
                        !isCancel && !isDestructive && { backgroundColor: C.tint },
                        executing && { opacity: 0.5 }
                      ]}
                    >
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                        {executing && !isCancel && <ActivityIndicator size="small" color="#fff" />}
                        <Text style={[
                          styles.buttonText,
                          isCancel && { color: '#ccc' },
                          isDestructive && { color: '#ef4444' },
                          !isCancel && !isDestructive && { color: '#fff' },
                        ]}>
                          {btn.text}
                        </Text>
                      </View>
                    </TouchableOpacity>
                  );
                })}
              </View>
            </GlassCard>
          </Animated.View>
        </View>
      </Modal>
    </DialogContext.Provider>
  );
};

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  dialogContainer: {
    width: '100%',
    maxWidth: 340,
    borderRadius: 24,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.5,
    shadowRadius: 20,
    elevation: 20,
  },
  glassContent: {
    padding: 24,
    borderRadius: 24,
    backgroundColor: 'rgba(20,20,20,0.85)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
  },
  title: {
    fontSize: 20,
    fontWeight: '800',
    color: '#fff',
    textAlign: 'center',
    marginBottom: 12,
  },
  message: {
    fontSize: 16,
    color: 'rgba(255,255,255,0.7)',
    textAlign: 'center',
    marginBottom: 24,
    lineHeight: 22,
  },
  buttonContainer: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 12,
    flexWrap: 'wrap',
  },
  button: {
    flex: 1,
    minWidth: 100,
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonText: {
    fontSize: 16,
    fontWeight: '700',
  },
});
