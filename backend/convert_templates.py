#!/usr/bin/env python3
"""
Convert all FBX template files in the templates folder to GLB.
Diagnoses common issues and provides clear error messages.
"""

import os
import subprocess
import sys
import shutil

TEMPLATE_DIR = os.path.join(os.path.dirname(__file__), 'templates')

def check_blender():
    """Check if Blender is installed and accessible."""
    blender_path = shutil.which('blender')
    if not blender_path:
        print("❌ Blender not found in PATH.")
        print("   Please install Blender: sudo apt update && sudo apt install blender")
        return False
    try:
        result = subprocess.run(['blender', '--version'], capture_output=True, text=True)
        if result.returncode == 0:
            version = result.stdout.split('\n')[0]
            print(f"✅ Blender found: {version}")
            return True
        else:
            print("❌ Blender command failed to run.")
            return False
    except Exception as e:
        print(f"❌ Error checking Blender: {e}")
        return False

def convert_fbx_to_glb(fbx_path):
    """Convert a single FBX file to GLB using Blender headless."""
    glb_path = fbx_path.rsplit('.', 1)[0] + '.glb'
    if os.path.exists(glb_path):
        print(f"⏩ {os.path.basename(glb_path)} already exists, skipping.")
        return True

    print(f"🔄 Converting {os.path.basename(fbx_path)} to GLB...")

    # Simple Blender Python script for conversion
    blender_script = """
import bpy
import sys

fbx_file = sys.argv[5]
glb_file = sys.argv[6]

# Clear scene
bpy.ops.wm.read_factory_settings(use_empty=True)

# Import FBX
try:
    bpy.ops.import_scene.fbx(filepath=fbx_file)
except Exception as e:
    print(f"FBX import error: {e}")
    sys.exit(1)

# Export as GLB
try:
    bpy.ops.export_scene.gltf(
        filepath=glb_file,
        export_format='GLB',
        export_apply=True
    )
except Exception as e:
    print(f"GLB export error: {e}")
    sys.exit(1)

print("Conversion successful")
"""

    script_path = os.path.join(os.path.dirname(__file__), '_temp_convert.py')
    with open(script_path, 'w') as f:
        f.write(blender_script)

    try:
        cmd = ['blender', '--background', '--python', script_path, '--', fbx_path, glb_path]
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=120)
        if result.returncode != 0:
            print(f"❌ Conversion failed for {os.path.basename(fbx_path)}")
            print("--- Blender stderr ---")
            print(result.stderr)
            print("----------------------")
            return False
        print(f"✅ Converted to {os.path.basename(glb_path)}")
        return True
    except subprocess.TimeoutExpired:
        print("❌ Blender process timed out (over 2 minutes).")
        return False
    except Exception as e:
        print(f"❌ Unexpected error: {e}")
        return False
    finally:
        if os.path.exists(script_path):
            os.remove(script_path)

def main():
    print("=" * 50)
    print("FBX to GLB Converter for Auto‑Rig Templates")
    print("=" * 50)

    # Check Blender
    if not check_blender():
        sys.exit(1)

    # Check templates folder
    if not os.path.exists(TEMPLATE_DIR):
        print(f"📁 Creating templates folder: {TEMPLATE_DIR}")
        os.makedirs(TEMPLATE_DIR, exist_ok=True)

    # Find FBX files
    fbx_files = [f for f in os.listdir(TEMPLATE_DIR) if f.lower().endswith('.fbx')]
    if not fbx_files:
        print("⚠️  No FBX files found in templates/ folder.")
        print("   Please place your Mixamo FBX file (e.g., human.fbx) in:")
        print(f"   {TEMPLATE_DIR}")
        sys.exit(1)

    print(f"📄 Found FBX files: {', '.join(fbx_files)}")

    # Convert each
    success = True
    for fbx_file in fbx_files:
        fbx_path = os.path.join(TEMPLATE_DIR, fbx_file)
        if not convert_fbx_to_glb(fbx_path):
            success = False

    if success:
        print("\n🎉 All conversions completed successfully!")
        print("   You can now start the server with: python server.py")
    else:
        print("\n⚠️  Some conversions failed. Check the errors above.")

if __name__ == '__main__':
    main()