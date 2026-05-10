const IS_DEV = process.env.APP_VARIANT === 'development';

/** @type {import('expo/config').ExpoConfig} */
const config = {
  name: 'mobile',
  slug: 'mobile',
  version: '1.0.0',
  orientation: 'portrait',
  icon: './assets/images/icon.png',
  scheme: 'mobile',
  userInterfaceStyle: 'automatic',
  newArchEnabled: true,
  ios: {
    supportsTablet: true,
    bundleIdentifier: 'com.anonymous.mobile',
  },
  android: {
    package: 'com.anonymous.mobile',
    adaptiveIcon: {
      backgroundColor: '#E6F4FE',
      foregroundImage: './assets/images/android-icon-foreground.png',
      backgroundImage: './assets/images/android-icon-background.png',
      monochromeImage: './assets/images/android-icon-monochrome.png',
    },
    edgeToEdgeEnabled: true,
    predictiveBackGestureEnabled: false,
  },
  web: {
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
        dark: {
          backgroundColor: '#000000',
        },
      },
    ],
    'expo-secure-store',
    [
      '@config-plugins/react-native-webrtc',
      {
        cameraPermission: 'Allow $(PRODUCT_NAME) to access your camera.',
        microphonePermission: 'Allow $(PRODUCT_NAME) to access your microphone.',
      },
    ],
  ],
  experiments: {
    typedRoutes: true,
    reactCompiler: true,
  },
  extra: {
    apiBaseUrl: process.env.API_BASE_URL || (IS_DEV
      ? 'http://192.168.50.39:3000/api'
      : 'http://192.168.50.51/api'),
  },
};

module.exports = config;
