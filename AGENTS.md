# Project Memory & Agent Rules

## Android APK Release Policy (Mandatory on Big/Major Changes)
During iterative testing/feedback rounds, keep changes local without committing, pushing, or triggering APK builds after every edit. Once the user confirms all changes are done (or asks to commit/release) and the commit includes big or major changes (new features, major UI/UX redesigns, or multi-screen enhancements):
1. Bump `versionCode` (+1) and `versionName` (next semver, e.g. `1.0.3` -> `1.0.4`) in `firefly-web/android/app/build.gradle`.
2. Commit and push to `origin main` so the `Build Android APK` GitHub Actions workflow builds the new APK.
3. Publish/verify the new versioned GitHub Release (`v<versionName>`) with `Wallet-Android.apk` and `Wallet-Android-v<versionName>.apk` attached and clear release notes, and keep `latest-apk` updated.
