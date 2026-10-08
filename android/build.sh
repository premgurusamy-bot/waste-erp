#!/usr/bin/env bash
# Build the GreenCycle ERP Android app (APK) without Android Studio.
# Needs (Ubuntu/Debian): sudo apt install openjdk-17-jdk aapt android-sdk-platform-23 dalvik-exchange apksigner zipalign
#
# Signing: the same keystore must be used for every release, or phones cannot update the app.
#   KEYSTORE=/path/release.jks KEYSTORE_PASS=secret ./build.sh
# If KEYSTORE does not exist it is created (keep it safe; never commit it).
set -euo pipefail
cd "$(dirname "$0")"

SDK=${ANDROID_SDK:-/usr/lib/android-sdk}
ANDROID_JAR=${ANDROID_JAR:-$SDK/platforms/android-23/android.jar}
KEYSTORE=${KEYSTORE:-$HOME/.greencycle/greencycle-release.jks}
KEYSTORE_PASS=${KEYSTORE_PASS:?Set KEYSTORE_PASS to the keystore password}
OUT=${OUT:-../public/downloads/GreenCycle-ERP.apk}

rm -rf build && mkdir -p build/gen build/classes

aapt package -f -m -J build/gen -M AndroidManifest.xml -S res -I "$ANDROID_JAR" -F build/unsigned.apk

javac -nowarn -Xlint:-options -source 8 -target 8 -encoding UTF-8 \
  -bootclasspath "$ANDROID_JAR" -d build/classes \
  $(find src build/gen -name '*.java')

dalvik-exchange --dex --output=build/classes.dex build/classes
(cd build && aapt add -f unsigned.apk classes.dex >/dev/null)

zipalign -f -p 4 build/unsigned.apk build/aligned.apk

if [ ! -f "$KEYSTORE" ]; then
  mkdir -p "$(dirname "$KEYSTORE")"
  keytool -genkeypair -keystore "$KEYSTORE" -storepass "$KEYSTORE_PASS" -keypass "$KEYSTORE_PASS" \
    -alias greencycle -keyalg RSA -keysize 3072 -validity 10000 -dname "CN=GreenCycle ERP, O=GreenCycle, C=IN"
  echo "Created new signing keystore at $KEYSTORE - back it up!"
fi

mkdir -p "$(dirname "$OUT")"
apksigner sign --ks "$KEYSTORE" --ks-pass "pass:$KEYSTORE_PASS" --ks-key-alias greencycle --out "$OUT" build/aligned.apk
apksigner verify "$OUT"
rm -f "$OUT.idsig"
echo "Built $OUT ($(du -h "$OUT" | cut -f1))"
