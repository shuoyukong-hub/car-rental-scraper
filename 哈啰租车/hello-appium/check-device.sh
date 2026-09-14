#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/env.sh"

echo "Java:"
java -version
echo

echo "ADB:"
adb version
echo

echo "Devices:"
adb devices -l

