import type { CapacitorConfig } from '@capacitor/cli';

/**
 * Capacitor Android wrapper config (brief 9.7). The built PWA (dist/) is the
 * web asset root, so the same offline bundle ships inside the native shell -
 * no runtime network calls, matching the web/Playables targets.
 *
 * Build steps (see README "Android / Capacitor"):
 *   1. npm run build:release            # produce dist/
 *   2. npx cap add android              # one-time: scaffold android/
 *   3. npx cap sync android             # copy dist/ + plugins into the project
 *   4. npx cap open android             # open in Android Studio, or:
 *      cd android && ./gradlew assembleDebug   # build an APK headless
 *
 * A full APK build needs the Android SDK + Gradle, which are not installed in
 * this sandbox; `npx cap sync` validates this config and the web assets without
 * requiring the SDK.
 */
const config: CapacitorConfig = {
  appId: 'com.squadofone.game',
  appName: 'Squad of One',
  webDir: 'dist',
  // No `server.url`: the app loads the BUNDLED assets from the APK, so it runs
  // fully offline with zero network calls (same rule as the web PWA/Playables).
  android: {
    // Fullscreen, immersive game shell.
    backgroundColor: '#0b0f1a',
    allowMixedContent: false,
  },
  backgroundColor: '#0b0f1a',
};

export default config;
