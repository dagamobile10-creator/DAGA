import type { CapacitorConfig } from '@capacitor/cli';

const appUrl = process.env.DAGA_APP_URL || 'https://daga-app-staging.dagamobile10.workers.dev';

const config: CapacitorConfig = {
  appId: 'com.dagamobile10.daga',
  appName: 'DAGA',
  webDir: 'www',
  server: {
    url: appUrl,
    cleartext: false,
    allowNavigation: [
      'daga-app-staging.dagamobile10.workers.dev',
      'daga-voice.dagamobile10.workers.dev'
    ]
  },
  android: {
    allowMixedContent: false
  }
};

export default config;
