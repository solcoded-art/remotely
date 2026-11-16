import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.macremote.ios',
  appName: 'Mac Remote',
  webDir: 'dist',
  ios: { contentInset: 'never', preferredContentMode: 'mobile', backgroundColor: '#101113' },
};
export default config;
