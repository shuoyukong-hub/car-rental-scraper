#!/usr/bin/env bash

export JAVA_HOME="/home/k/下载/pycharm-2025.3.2/jbr"
export ANDROID_HOME="/home/k/桌面/android-tools"
export ANDROID_SDK_ROOT="/home/k/桌面/android-tools"
export PATH="/home/k/桌面/android-tools/platform-tools:$JAVA_HOME/bin:$PATH"

echo "JAVA_HOME=$JAVA_HOME"
echo "ADB=$(command -v adb || true)"
echo "APPIUM=$(command -v appium || true)"
