import React, { createContext, useContext, useState, useCallback, useRef } from 'react';
import { View, Text, StyleSheet, Animated, Platform, TouchableOpacity, PanResponder } from 'react-native';
import { BlurView } from 'expo-blur';
import { FontAwesome } from '@expo/vector-icons';

type ToastType = 'success' | 'error' | 'info' | 'warning';

interface ToastMessage {
  id: string;
  title: string;
  message?: string;
  type: ToastType;
  duration?: number;
}

interface ToastContextData {
  showToast: (title: string, message?: string, type?: ToastType, duration?: number) => void;
  hideToast: () => void;
}

const ToastContext = createContext<ToastContextData>({} as ToastContextData);

export const useToast = () => useContext(ToastContext);

export const ToastProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [toast, setToast] = useState<ToastMessage | null>(null);
  const translateY = useRef(new Animated.Value(-150)).current;
  const scale = useRef(new Animated.Value(0.8)).current;
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const hideToast = useCallback(() => {
    Animated.parallel([
      Animated.timing(translateY, {
        toValue: -150,
        duration: 250,
        useNativeDriver: true,
      }),
      Animated.timing(scale, {
        toValue: 0.8,
        duration: 250,
        useNativeDriver: true,
      })
    ]).start(() => {
      setToast(null);
    });
  }, [translateY, scale]);

  const panResponder = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_, gestureState) => {
        return gestureState.dy < -5 || Math.abs(gestureState.dx) > 10;
      },
      onPanResponderMove: (_, gestureState) => {
        if (gestureState.dy < 0) {
            // Allow dragging up
            translateY.setValue((Platform.OS === 'ios' ? 60 : 40) + gestureState.dy);
        }
      },
      onPanResponderRelease: (_, gestureState) => {
        if (gestureState.dy < -30) {
            // Swiped up enough, dismiss
            hideToast();
        } else {
            // Reset position
             Animated.spring(translateY, {
                toValue: Platform.OS === 'ios' ? 60 : 40,
                useNativeDriver: true,
                friction: 6,
                tension: 50
              }).start();
        }
      },
    })
  ).current;

  const showToast = useCallback((title: string, message?: string, type: ToastType = 'info', duration = 3000) => {
    if (timerRef.current) clearTimeout(timerRef.current);
    
    setToast({ id: Date.now().toString(), title, message, type, duration });
    
    // Reset values
    translateY.setValue(-150);
    scale.setValue(0.8);

    Animated.parallel([
      Animated.spring(translateY, {
        toValue: Platform.OS === 'ios' ? 60 : 40,
        useNativeDriver: true,
        friction: 6,
        tension: 50
      }),
      Animated.spring(scale, {
        toValue: 1,
        useNativeDriver: true,
        friction: 6
      })
    ]).start();

    timerRef.current = setTimeout(hideToast, duration);
  }, [translateY, scale, hideToast]);

  const getIconName = (type: ToastType): keyof typeof FontAwesome.glyphMap => {
    switch (type) {
      case 'success': return 'check-circle';
      case 'error': return 'times-circle';
      case 'warning': return 'exclamation-triangle';
      default: return 'info-circle';
    }
  };

  const getColors = (type: ToastType) => {
    switch (type) {
      case 'success': return { icon: '#4ade80', bg: 'rgba(20, 20, 20, 0.8)', border: 'rgba(74, 222, 128, 0.3)' };
      case 'error': return { icon: '#f87171', bg: 'rgba(20, 20, 20, 0.8)', border: 'rgba(248, 113, 113, 0.3)' };
      case 'warning': return { icon: '#fbbf24', bg: 'rgba(20, 20, 20, 0.8)', border: 'rgba(251, 191, 36, 0.3)' };
      default: return { icon: '#60a5fa', bg: 'rgba(20, 20, 20, 0.8)', border: 'rgba(96, 165, 250, 0.3)' };
    }
  };

  return (
    <ToastContext.Provider value={{ showToast, hideToast }}>
      {children}
      {toast && (
        <Animated.View
          style={[
            styles.container,
            { transform: [{ translateY }, { scale }] }
          ]}
          {...panResponder.panHandlers}
        >
          <TouchableOpacity onPress={hideToast} activeOpacity={0.9} style={styles.touchable}>
            <BlurView intensity={60} tint="dark" style={[styles.blur, { borderColor: getColors(toast.type).border }]}>
               <View style={styles.contentContainer}>
                 <View style={styles.iconContainer}>
                   <FontAwesome name={getIconName(toast.type)} size={24} color={getColors(toast.type).icon} />
                 </View>
                 <View style={styles.textContainer}>
                   <Text style={styles.title}>{toast.title}</Text>
                   {toast.message && <Text style={styles.message}>{toast.message}</Text>}
                 </View>
               </View>
            </BlurView>
          </TouchableOpacity>
        </Animated.View>
      )}
    </ToastContext.Provider>
  );
};

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    top: 0,
    left: 16,
    right: 16,
    zIndex: 9999,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.5,
    shadowRadius: 15,
  },
  touchable: {
    width: '100%',
    maxWidth: 400,
    borderRadius: 20,
    overflow: 'hidden',
  },
  blur: {
    width: '100%',
    padding: 18,
    borderRadius: 20,
    borderWidth: 1.5,
  },
  contentContainer: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  iconContainer: {
    marginRight: 16,
    justifyContent: 'center',
    alignItems: 'center',
  },
  textContainer: {
    flex: 1,
    justifyContent: 'center',
  },
  title: {
    color: '#fff',
    fontSize: 17,
    fontWeight: '700',
    marginBottom: 4,
    letterSpacing: 0.3,
  },
  message: {
    color: '#ddd',
    fontSize: 15,
    lineHeight: 20,
    fontWeight: '500',
  },
});
