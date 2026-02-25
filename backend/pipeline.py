#!/usr/bin/env python3
"""
Bio‑React Rigging Pipeline
Handles file conversion, rigging execution, and post‑processing.
Serves as the communication layer between the Flask server and Blender rigger.
"""

import os
import subprocess
import tempfile
import shutil
import json
import logging
from pathlib import Path

# Configure logging
logger = logging.getLogger(__name__)

# ----------------------------------------------------------------------
# Configuration
# ----------------------------------------------------------------------
BASE_DIR = os.path.dirname(__file__)
RIGGER_SCRIPT = os.path.join(BASE_DIR, 'rigger.py')
TEMPLATE_PATH = os.path.join(BASE_DIR, 'templates', 'human.glb')  # default template

# ----------------------------------------------------------------------
# Pre‑processing: convert any input to a clean GLB
# ----------------------------------------------------------------------
def prepare_for_rigging(input_path: str, output_dir: str) -> str:
    """
    Convert an uploaded mesh file to a standardized GLB suitable for rigging.
    Uses Blender in headless mode to:
      - Import the mesh
      - Triangulate
      - Apply rotation/scale transforms
      - Export as GLB with consistent settings
    Returns the path to the prepared GLB.
    """
    logger.info(f"Preparing file for rigging: {input_path}")

    # Create a temporary output filename
    base = os.path.basename(input_path)
    name, _ = os.path.splitext(base)
    output_path = os.path.join(output_dir, f"{name}_prepared.glb")

    # Blender Python script for preprocessing
    preprocess_script = """
import bpy
import sys

input_file = sys.argv[5]
output_file = sys.argv[6]

# Clear scene
bpy.ops.wm.read_factory_settings(use_empty=True)

# Import based on file extension
if input_file.endswith('.obj'):
    bpy.ops.wm.obj_import(filepath=input_file)
elif input_file.endswith('.fbx'):
    bpy.ops.import_scene.fbx(filepath=input_file)
else:  # glb/gltf
    bpy.ops.import_scene.gltf(filepath=input_file)

# Select all objects
bpy.ops.object.select_all(action='SELECT')

# Convert to mesh (if any curves, etc.)
bpy.ops.object.convert(target='MESH')

# Triangulate
bpy.ops.object.modifier_add(type='TRIANGULATE')
bpy.ops.object.modifier_apply(modifier='Triangulate')

# Apply transforms (rotation, scale)
bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)

# Join all meshes into one (optional – many riggers expect a single mesh)
if len(bpy.context.selected_objects) > 1:
    bpy.context.view_layer.objects.active = bpy.context.selected_objects[0]
    bpy.ops.object.join()

# Export as GLB
bpy.ops.export_scene.gltf(
    filepath=output_file,
    export_format='GLB',
    export_apply=True,
    export_animations=False
)
"""
    # Write temporary script
    script_path = os.path.join(tempfile.gettempdir(), 'preprocess_blender.py')
    with open(script_path, 'w') as f:
        f.write(preprocess_script)

    try:
        cmd = [
            'blender', '--background', '--python', script_path,
            '--', input_path, output_path
        ]
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=300)
        if result.returncode != 0:
            logger.error(f"Preprocessing failed: {result.stderr}")
            raise RuntimeError(f"Preprocessing failed: {result.stderr}")
        if not os.path.exists(output_path):
            raise RuntimeError("Preprocessing did not produce output file")
        logger.info(f"Preprocessed file saved to {output_path}")
        return output_path
    finally:
        if os.path.exists(script_path):
            os.remove(script_path)

# ----------------------------------------------------------------------
# Post‑processing: optimize rigged GLB for web
# ----------------------------------------------------------------------
def optimize_for_web(input_path: str, output_path: str) -> str:
    """
    Optimize a GLB file for web delivery:
      - Compress with draco (if available)
      - Remove unnecessary data
      - Ensure correct orientation
    Returns the path to the optimized file (same as output_path).
    """
    logger.info(f"Optimizing rigged model for web: {input_path}")

    # For now, we simply copy the file (no compression)
    # Future enhancement: use gltf-pipeline or similar
    shutil.copy2(input_path, output_path)
    logger.info(f"Optimized file saved to {output_path}")
    return output_path

# ----------------------------------------------------------------------
# Main pipeline function
# ----------------------------------------------------------------------
def run_pipeline(uploaded_file_path: str, output_dir: str, template_path: str = TEMPLATE_PATH) -> str:
    """
    Execute the full rigging pipeline:
      1. Prepare the uploaded file (preprocess)
      2. Run Blender rigging (rigger.py)
      3. Optimize the result
    Returns the path to the final rigged GLB.
    """
    # Step 1: Preprocess
    prepared_path = prepare_for_rigging(uploaded_file_path, output_dir)

    # Step 2: Rigging
    # The rigger.py script expects: input_path template_path output_path
    rigged_path = os.path.join(output_dir, 'rigged_temp.glb')
    cmd = [
        'blender', '--background', '--python', RIGGER_SCRIPT,
        '--', prepared_path, template_path, rigged_path
    ]
    logger.info(f"Running rigger: {' '.join(cmd)}")
    result = subprocess.run(cmd, capture_output=True, text=True, timeout=600)
    if result.returncode != 0:
        logger.error(f"Rigging failed: {result.stderr}")
        raise RuntimeError(f"Rigging failed: {result.stderr}")
    if not os.path.exists(rigged_path):
        raise RuntimeError("Rigging succeeded but output file missing")

    # Step 3: Optimize
    final_path = os.path.join(output_dir, 'final_rigged.glb')
    optimized_path = optimize_for_web(rigged_path, final_path)

    # Clean up intermediate files (optional)
    if os.path.exists(prepared_path):
        os.remove(prepared_path)
    if os.path.exists(rigged_path):
        os.remove(rigged_path)

    return optimized_path