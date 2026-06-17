const ANDROID_KEY = process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY_ANDROID || process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY || '';
const REVENUECAT_APPLE = process.env.EXPO_PUBLIC_REVENUECAT_APPLE || '';
const REVENUECAT_GOOGLE = process.env.EXPO_PUBLIC_REVENUECAT_GOOGLE || '';
const asset = (p) => `./${p}`;

/** @type {import('expo/config').ExpoConfig} */
const config = {
  name: 'frensy',
  slug: 'frendzy',
  version: '1.1.0',
  orientation: 'portrait',
  icon: asset('assets/images/icon.png'),
  scheme: 'frensy',
  userInterfaceStyle: 'automatic',
  newArchEnabled: true,
  jsEngine: 'hermes',
  platforms: ['ios', 'android', 'web'],
  ios: {
    supportsTablet: true,
    bundleIdentifier: 'com.math0.frensy',
    usesAppleSignIn: true,
    googleServicesFile: './GoogleService-Info.plist',
    infoPlist: {
      ITSAppUsesNonExemptEncryption: false,
      CFBundleAllowMixedLocalizations: true,
      CFBundleLocalizations: ['fr', 'en'],
      CFBundleDevelopmentRegion: 'fr',
      UIBackgroundModes: ['location'],
      NSLocationWhenInUseUsageDescription: 'Frensy utilise votre position pour vous montrer les personnes autour de vous.',
      NSLocationAlwaysAndWhenInUseUsageDescription: 'Frensy peut utiliser votre position en arrière-plan uniquement pendant un check-in actif (carte), si vous activez l’option.',
      NSLocationAlwaysUsageDescription: 'Frensy peut utiliser votre position en arrière-plan uniquement pendant un check-in actif (carte), si vous activez l’option.',
      NSPhotoLibraryUsageDescription: 'Frensy a besoin d\'accéder à vos photos pour changer votre photo de profil ou envoyer des images.',
      NSCameraUsageDescription: 'Frensy a besoin d\'accéder à votre caméra pour prendre une photo de profil ou envoyer des snaps.',
      NSMicrophoneUsageDescription: 'Frensy a besoin d\'accéder à votre micro pour enregistrer des vidéos.',
    },
  },
  android: {
    adaptiveIcon: {
      foregroundImage: asset('assets/images/adaptive-icon.png'),
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
    googleServicesFile: './google-services.json',
    config: ANDROID_KEY ? { googleMaps: { apiKey: ANDROID_KEY } } : {},
  },
  web: {
    bundler: 'metro',
    output: 'static',
    favicon: asset('assets/images/favicon.png'),
  },
  plugins: [
    './plugins/withIosModularHeaders',
    'expo-router',
    'expo-font',
    [
      'expo-splash-screen',
      {
        image: asset('assets/images/splash-icon.png'),
        imageWidth: 200,
        resizeMode: 'contain',
        backgroundColor: '#ffffff',
      },
    ],
    'expo-notifications',
    'expo-apple-authentication',
    [
      '@react-native-google-signin/google-signin',
      {
        iosUrlScheme: 'com.googleusercontent.apps.591347173909-9v9tif71p1j4f594mevtjd7msdivfc22'
      }
    ],
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
    'expo-web-browser',
  ],
  experiments: { typedRoutes: true },
  extra: {
    router: {},
    eas: { projectId: '0a9244fd-b83d-4e65-b107-aadcc3c2a424' },
    privacyPolicyUrl: 'https://frensyapp-dev.github.io/frensy/privacy.html',
    revenuecatAppleApiKey: REVENUECAT_APPLE,
    revenuecatGoogleApiKey: REVENUECAT_GOOGLE,
  },
  owner: 'math_0',
};

module.exports = config;
