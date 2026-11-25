import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.dagamobile10.daga',
  appName: 'DAGA Staging',
  webDir: 'www',
  server: {
    url: 'https://daga-app-staging.dagamobile10.workers.dev/',
    cleartext: false,
    androidScheme: 'https'
  },
  android: {
    allowMixedContent: false
  }
};

export default config;
