#!/usr/bin/env bash
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/env.sh"

echo
echo "Java:"
java -version

echo
echo "ADB:"
adb version

echo
echo "Connected devices:"
adb devices

echo
echo "Appium:"
appium -v

echo
echo "Installed Appium drivers:"
appium driver list --installed
