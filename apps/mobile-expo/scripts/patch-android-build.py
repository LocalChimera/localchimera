#!/usr/bin/env python3
"""Patch app/build.gradle for APK size optimization."""
import sys

build_file = sys.argv[1]
with open(build_file, 'r') as f:
    content = f.read()

if 'splits' not in content:
    splits_block = """    splits {
        abi {
            enable true
            reset()
            include "arm64-v8a", "armeabi-v7a"
            universalApk false
        }
        density {
            enable true
            reset()
            include "mdpi", "hdpi", "xhdpi", "xxhdpi", "xxxhdpi"
            compatibleScreens 'small', 'normal', 'large', 'xlarge'
        }
    }"""
    content = content.replace('android {', 'android {\n' + splits_block, 1)

if 'packagingOptions' not in content:
    pkg = """    packagingOptions {
        jniLibs {
            useLegacyPackaging true
        }
    }
"""
    content = content.replace('    buildTypes {', pkg + '    buildTypes {', 1)

with open(build_file, 'w') as f:
    f.write(content)
