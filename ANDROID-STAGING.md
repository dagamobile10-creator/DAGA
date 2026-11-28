# DAGA Android staging wrapper

This wrapper intentionally points to the existing, user-tested DAGA staging Worker. It does not change the web UI or move credentials into the Android package.

## Build

The GitHub Actions workflow `.github/workflows/android-staging-apk.yml` verifies the staging routes, generates the Capacitor Android project, adds microphone/camera manifest permissions, builds a debug APK, and uploads it as a workflow artifact.

## Important

- This is a staging-only debug build, not a production release.
- The app requires network access to the staging Worker.
- Microphone/camera access still requires device permission and end-to-end testing in the installed app.
- Do not place API keys, Cloudflare tokens, email credentials, or signing keys in this repository or APK.
- Before a production build, change the remote URL only after the production Worker, database migrations, authentication, and all app routes have passed release checks.
- A signed release APK/AAB requires a protected signing keystore and a separate controlled release workflow.
