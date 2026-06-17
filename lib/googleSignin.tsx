import Constants, { ExecutionEnvironment } from 'expo-constants';
import { Platform, StyleSheet, Text, TouchableOpacity } from 'react-native';

// Default mock implementations
const isWeb = Platform.OS === 'web';
const isExpoGo = Constants.executionEnvironment === ExecutionEnvironment.StoreClient;
const mockSignInErrorMessage = isWeb
  ? "Google Sign-In n’est pas supporté sur le web."
  : isExpoGo
    ? "Google Sign-In ne fonctionne pas dans Expo Go. Utilisez un Development Build pour tester la connexion réelle."
    : "Google Sign-In est indisponible sur cet environnement.";

let GoogleSignin: any = {
  configure: (_options: any) => {
  },
  hasPlayServices: async (_options: any) => {
    return true;
  },
  signIn: async () => {
    throw new Error(mockSignInErrorMessage);
  },
  signOut: async () => {
  },
  isSignedIn: async () => false,
  getCurrentUser: async () => null,
  getTokens: async () => ({ idToken: 'mock-id-token', accessToken: 'mock-access-token' }),
};

let GoogleSigninButton: any = (props: any) => {
  return (
    <TouchableOpacity 
      style={[styles.mockButton, props.style]} 
      onPress={props.onPress}
      disabled={props.disabled}
    >
      <Text style={styles.mockButtonText}>Google Sign-In (Dev Build Only)</Text>
    </TouchableOpacity>
  );
};

// Mock static properties for GoogleSigninButton
GoogleSigninButton.Size = {
  Icon: 0,
  Standard: 1,
  Wide: 2,
};

GoogleSigninButton.Color = {
  Dark: 0,
  Light: 1,
};

let statusCodes: any = {
  SIGN_IN_CANCELLED: 'SIGN_IN_CANCELLED',
  IN_PROGRESS: 'IN_PROGRESS',
  PLAY_SERVICES_NOT_AVAILABLE: 'PLAY_SERVICES_NOT_AVAILABLE',
  SIGN_IN_REQUIRED: 'SIGN_IN_REQUIRED',
};

if (!isWeb && !isExpoGo) {
  try {
    // Try to require the actual module
    // We use require to avoid static import hoisting which would crash in Expo Go
    const actualModule = require('@react-native-google-signin/google-signin');
    GoogleSignin = actualModule.GoogleSignin;
    GoogleSigninButton = actualModule.GoogleSigninButton;
    statusCodes = actualModule.statusCodes;
  } catch (e) {
    console.warn('Failed to load @react-native-google-signin/google-signin, falling back to mock.', e);
  }
}

export { GoogleSignin, GoogleSigninButton, statusCodes };

const styles = StyleSheet.create({
  mockButton: {
    backgroundColor: '#4285F4',
    padding: 10,
    borderRadius: 5,
    alignItems: 'center',
    justifyContent: 'center',
    height: 48,
  },
  mockButtonText: {
    color: 'white',
    fontWeight: 'bold',
  }
});
