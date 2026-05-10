import { Stack } from 'expo-router';

export default function RootLayout() {
  return (
    <Stack>
      {/* Hide the header for the main index and auth flow */}
      <Stack.Screen name="index" options={{ headerShown: false }} />
      <Stack.Screen name="(auth)" options={{ headerShown: false }} />
      {/* Hide the top header for the tabs layout to prevent the large white space */}
      <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
      {/* Hide the default header for the ticket detail screen */}
      <Stack.Screen name="ticket/[id]" options={{ headerShown: false }} />
    </Stack>
  );
}
