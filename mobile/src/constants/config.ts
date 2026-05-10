import Constants from 'expo-constants';

/**
 * API base URL resolved from app.config.js > extra.apiBaseUrl.
 *
 * To override at build/start time:
 *   API_BASE_URL=http://my-server/api npx expo start
 *
 * Falls back to the test server if expoConfig is unavailable.
 */
const expoExtra = Constants.expoConfig?.extra as { apiBaseUrl?: string } | undefined;

export const API_BASE_URL: string = expoExtra?.apiBaseUrl ?? 'http://192.168.50.51/api';
