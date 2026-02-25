#!/usr/bin/env python3
import os
import subprocess
import sys

TEMPLATE_DIR = os.path.join(os.path.dirname(__file__), 'templates')

def convert_fbx_to_glb(fbx_path):
    glb_path = fbx_path.rsplit('.', 1)[0] + '.glb'
    if os.path.exists(glb_path):
        print(f"✅ {os.path.basename(glb_path)} already exists, skipping.")
        return True

    print(f"🔄 Converting {os.path.basename(fbx_path)} to GLB...")
    script = """
import bpy
import sys
fbx_file = sys.argv[5]
glb_file = sys.argv[6]
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.fbx(filepath=fbx_file)
bpy.ops.export_scene.gltf(filepath=glb_file, export_format='GLB', export_apply=True)
"""
    script_path = os.path.join(os.path.dirname(__file__), '_temp_convert.py')
    with open(script_path, 'w') as f:
        f.write(script)
    try:
        cmd = ['blender', '--background', '--python', script_path, '--', fbx_path, glb_path]
        subprocess.run(cmd, check=True, capture_output=True, text=True)
        print(f"✅ Converted to {os.path.basename(glb_path)}")
        return True
    except subprocess.CalledProcessError as e:
        print(f"❌ Conversion failed: {e.stderr}")
        return False
    finally:
        if os.path.exists(script_path):
            os.remove(script_path)

def main():
    if not os.path.exists(TEMPLATE_DIR):
        os.makedirs(TEMPLATE_DIR)
    fbx_files = [f for f in os.listdir(TEMPLATE_DIR) if f.lower().endswith('.fbx')]
    if not fbx_files:
        print("No FBX files found in templates/ folder.")
        return
    for fbx in fbx_files:
        convert_fbx_to_glb(os.path.join(TEMPLATE_DIR, fbx))
    print("All conversions completed.")

if __name__ == '__main__':
    main()