import { Redirect } from 'expo-router';

export default function Index() {
  // For now, immediately redirect to the auth flow
  // Later we can add a splash screen and check Auth state using Zustand here
  return <Redirect href="/(auth)/login" />;
}
