const { getDefaultConfig } = require('@expo/metro-config');

const defaultConfig = getDefaultConfig(__dirname);
defaultConfig.resolver.sourceExts.push('cjs');

// Ajout de la configuration pour résoudre l'erreur PlatformConstants
defaultConfig.resolver.extraNodeModules = {
  ...defaultConfig.resolver.extraNodeModules,
  'react-native': __dirname + '/node_modules/react-native',
  'expo-modules-core': __dirname + '/node_modules/expo-modules-core'
};

module.exports = defaultConfig;