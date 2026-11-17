<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## Android APK Release Policy (Mandatory on Big/Major Changes)
Whenever any new commit includes big or major changes (new features, major UI/UX redesigns, or multi-screen enhancements):
1. Bump `versionCode` (+1) and `versionName` (next semver, e.g. `1.0.3` -> `1.0.4`) in `firefly-web/android/app/build.gradle`.
2. Commit and push to `origin main` so the `Build Android APK` GitHub Actions workflow builds the new APK.
3. Publish/verify the new versioned GitHub Release (`v<versionName>`) with `Wallet-Android.apk` and `Wallet-Android-v<versionName>.apk` attached and clear release notes, and keep `latest-apk` updated.
