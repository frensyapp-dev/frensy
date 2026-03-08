const ANDROID_KEY = process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY_ANDROID || process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY || '';
const IOS_KEY = process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY_IOS || process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY || '';

/** @type {import('expo/config').ExpoConfig} */
const config = {
  name: 'frensy',
  slug: 'frendzy',
  version: '1.0.0',
  orientation: 'portrait',
  icon: './assets/images/icon.png',
  scheme: 'frensy',
  userInterfaceStyle: 'automatic',
  newArchEnabled: true,
  jsEngine: 'hermes',
  platforms: ['ios', 'android', 'web'],
  ios: {
    supportsTablet: true,
    bundleIdentifier: 'com.math0.frensy',
    config: IOS_KEY ? { googleMapsApiKey: IOS_KEY } : {},
    infoPlist: {
      ITSAppUsesNonExemptEncryption: false,
      NSLocationWhenInUseUsageDescription: 'Frensy utilise votre position pour vous montrer les personnes autour de vous.',
      NSLocationAlwaysAndWhenInUseUsageDescription: 'Frensy utilise votre position en arrière-plan pour que vos amis puissent vous voir même quand l\'application est fermée.',
      NSLocationAlwaysUsageDescription: 'Frensy utilise votre position en arrière-plan pour que vos amis puissent vous voir même quand l\'application est fermée.',
      NSPhotoLibraryUsageDescription: 'Frensy a besoin d\'accéder à vos photos pour changer votre photo de profil ou envoyer des images.',
      NSCameraUsageDescription: 'Frensy a besoin d\'accéder à votre caméra pour prendre une photo de profil ou envoyer des snaps.',
      NSMicrophoneUsageDescription: 'Frensy a besoin d\'accéder à votre micro pour enregistrer des vidéos.',
    },
  },
  android: {
    adaptiveIcon: {
      foregroundImage: './assets/images/adaptive-icon.png',
      backgroundColor: '#ffffff',
    },
    permissions: [
      "ACCESS_COARSE_LOCATION",
      "ACCESS_FINE_LOCATION",
      "ACCESS_BACKGROUND_LOCATION",
      "FOREGROUND_SERVICE",
      "FOREGROUND_SERVICE_LOCATION"
    ],
    edgeToEdgeEnabled: true,
    package: 'com.math0.frensy',
    config: ANDROID_KEY ? { googleMaps: { apiKey: ANDROID_KEY } } : {},
  },
  web: {
    bundler: 'metro',
    output: 'static',
    favicon: './assets/images/favicon.png',
  },
  plugins: [
    'expo-router',
    [
      'expo-splash-screen',
      {
        image: './assets/images/splash-icon.png',
        imageWidth: 200,
        resizeMode: 'contain',
        backgroundColor: '#ffffff',
      },
    ],
    'expo-notifications',
    'expo-apple-authentication',
    [
      'expo-image-picker',
      {
        photosPermission: 'Frensy a besoin d\'accéder à vos photos pour changer votre photo de profil ou envoyer des images.',
        cameraPermission: 'Frensy a besoin d\'accéder à votre caméra pour prendre une photo de profil ou envoyer des snaps.'
      }
    ],
    [
      'expo-location',
      { isAndroidForegroundServiceEnabled: true },
    ],
  ],
  experiments: { typedRoutes: true },
  extra: {
    router: {},
    eas: { projectId: '0a9244fd-b83d-4e65-b107-aadcc3c2a424' },
    // TODO: Remplacez <username> et <repo> par votre nom d'utilisateur GitHub et le nom du dépôt
    privacyPolicyUrl: 'https://frensyapp-dev.github.io/frensy/privacy.html',
  },
  owner: 'math_0',
};

module.exports = config;
