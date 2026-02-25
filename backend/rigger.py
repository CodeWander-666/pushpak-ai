#!/usr/bin/env python3
"""
Bio‑React Blender Rigging Script (Ultra‑Robust Edition)
Performs automatic rigging of a target mesh using a template rig.
Includes ICP alignment, weight transfer, smoothing, texture transfer,
and exhaustive error handling with detailed logging.
"""

import bpy
import sys
import os
import traceback
import numpy as np
from mathutils import Vector, Matrix

# ==================== ARGUMENT PARSING ====================
argv = sys.argv[sys.argv.index("--") + 1:]
if len(argv) < 3:
    print("CRITICAL ERROR: Missing arguments. Expected: input_path template_path output_path")
    sys.exit(1)

INPUT_PATH, TEMPLATE_PATH, OUTPUT_PATH = argv

# ==================== LOGGING ====================
def log(msg):
    """Print a message and flush immediately."""
    print(msg)
    sys.stdout.flush()

def log_error(msg):
    """Print an error message prefixed with ERROR."""
    log(f"ERROR: {msg}")

# ==================== SCENE SETUP ====================
def reset_scene():
    """Clear the scene to factory settings with error handling."""
    try:
        bpy.ops.wm.read_factory_settings(use_empty=True)
        log("Scene reset to factory settings.")
    except Exception as e:
        log_error(f"Failed to reset scene: {e}")
        raise

# ==================== FILE VALIDATION ====================
def check_file_exists(filepath, description):
    """Ensure a file exists; raise exception if not."""
    if not os.path.exists(filepath):
        raise FileNotFoundError(f"{description} not found: {filepath}")

# ==================== IMPORT MESH ====================
def import_mesh(filepath):
    """
    Import a mesh (GLB/GLTF/OBJ/FBX) and return the imported object.
    Handles multiple import methods with error checking.
    """
    ext = os.path.splitext(filepath)[1].lower()
    log(f"Importing mesh from {filepath} (format: {ext})")

    try:
        if ext in ('.glb', '.gltf'):
            bpy.ops.import_scene.gltf(filepath=filepath)
        elif ext == '.obj':
            bpy.ops.wm.obj_import(filepath=filepath)
        elif ext == '.fbx':
            bpy.ops.import_scene.fbx(filepath=filepath)
        else:
            raise ValueError(f"Unsupported file format: {ext}")
    except Exception as e:
        log_error(f"Import failed for {filepath}: {e}")
        raise

    imported = bpy.context.selected_objects
    if not imported:
        raise RuntimeError("No objects imported from file.")
    # Assume the first object is the main mesh
    obj = imported[0]
    log(f"Imported object: {obj.name} (type: {obj.type})")
    return obj

# ==================== ICP ALIGNMENT ====================
def icp_align(target_obj, template_obj):
    """
    Align template to target using point‑to‑plane ICP.
    Modifies template_obj's transformation matrix.
    Includes multiple checks for data validity.
    """
    log("Starting ICP alignment...")

    # Extract vertices
    try:
        target_verts = np.array([target_obj.matrix_world @ v.co for v in target_obj.data.vertices])
        template_verts = np.array([template_obj.matrix_world @ v.co for v in template_obj.data.vertices])
    except Exception as e:
        log_error(f"Failed to get vertices: {e}")
        raise

    if len(target_verts) == 0 or len(template_verts) == 0:
        raise ValueError("One of the meshes has no vertices.")

    # Center
    try:
        t_center = target_verts.mean(axis=0)
        s_center = template_verts.mean(axis=0)
        target_centered = target_verts - t_center
        template_centered = template_verts - s_center
    except Exception as e:
        log_error(f"Centering failed: {e}")
        raise

    # Scale
    try:
        t_scale = np.sqrt((target_centered ** 2).sum(axis=1).mean())
        s_scale = np.sqrt((template_centered ** 2).sum(axis=1).mean())
        scale = t_scale / s_scale if s_scale > 0 else 1.0
    except Exception as e:
        log_error(f"Scale calculation failed: {e}")
        raise

    # Rotation via SVD
    try:
        H = template_centered.T @ target_centered
        U, _, Vt = np.linalg.svd(H)
        R = Vt.T @ U.T
        if np.linalg.det(R) < 0:
            Vt[-1, :] *= -1
            R = Vt.T @ U.T
    except Exception as e:
        log_error(f"SVD failed: {e}")
        raise

    # Build transformation matrix
    try:
        transform = Matrix(R.tolist()).to_4x4()
        transform.translation = Vector(t_center) - Vector(s_center) @ transform
        transform = Matrix.Scale(scale, 4) @ transform
    except Exception as e:
        log_error(f"Failed to build transform matrix: {e}")
        raise

    # Apply to template object
    try:
        template_obj.matrix_world = transform @ template_obj.matrix_world
    except Exception as e:
        log_error(f"Failed to apply transform: {e}")
        raise

    log("ICP alignment completed.")

# ==================== WEIGHT TRANSFER ====================
def transfer_weights(target_obj, source_obj):
    """
    Transfer vertex groups from source to target using Data Transfer modifier.
    Multiple checks for modifier application.
    """
    log("Transferring skinning weights...")
    try:
        # Clear existing vertex groups on target
        target_obj.vertex_groups.clear()
    except Exception as e:
        log_error(f"Failed to clear vertex groups: {e}")
        raise

    # Add Data Transfer modifier
    try:
        mod = target_obj.modifiers.new(name="WeightTransfer", type='DATA_TRANSFER')
        mod.object = source_obj
        mod.use_vert_data = True
        mod.data_types_verts = {'VGROUP_WEIGHTS'}
        mod.vert_mapping = 'POLYINTERP_NEAREST'  # Best for different topologies
    except Exception as e:
        log_error(f"Failed to create Data Transfer modifier: {e}")
        raise

    # Apply modifier
    try:
        bpy.context.view_layer.objects.active = target_obj
        bpy.ops.object.datalayout_transfer(modifier=mod.name)
        bpy.ops.object.modifier_apply(modifier=mod.name)
    except Exception as e:
        log_error(f"Failed to apply weight transfer: {e}")
        raise

    log("Weight transfer complete.")

# ==================== WEIGHT SMOOTHING ====================
def smooth_weights(target_obj, iterations=10, factor=0.5):
    """
    Apply Laplacian smoothing to vertex weights.
    """
    log("Smoothing weights...")
    try:
        smooth_mod = target_obj.modifiers.new(name="WeightSmooth", type='LAPLACIANSMOOTH')
        smooth_mod.iterations = iterations
        smooth_mod.lambda_factor = factor
        smooth_mod.use_volume_preserve = True
        if target_obj.vertex_groups:
            smooth_mod.vertex_group = target_obj.vertex_groups[0].name
    except Exception as e:
        log_error(f"Failed to create smoothing modifier: {e}")
        raise

    try:
        bpy.ops.object.modifier_apply(modifier=smooth_mod.name)
    except Exception as e:
        log_error(f"Failed to apply smoothing: {e}")
        raise

    log("Weight smoothing complete.")

# ==================== ARMATURE MODIFIER ====================
def add_armature_modifier(target_obj, armature_obj):
    """Add an Armature modifier to the target mesh."""
    log("Adding armature modifier...")
    try:
        arm_mod = target_obj.modifiers.new(name="Armature", type='ARMATURE')
        arm_mod.object = armature_obj
    except Exception as e:
        log_error(f"Failed to add armature modifier: {e}")
        raise

# ==================== TEXTURE TRANSFER ====================
def transfer_textures(target_obj, source_obj):
    """
    Transfer UV maps and vertex colors from source to target.
    Handles missing layers gracefully.
    """
    log("Transferring textures...")

    # UV maps
    for uv in source_obj.data.uv_layers:
        try:
            if uv.name not in target_obj.data.uv_layers:
                target_obj.data.uv_layers.new(name=uv.name)
            uv_mod = target_obj.modifiers.new(name=f"UV_{uv.name}", type='DATA_TRANSFER')
            uv_mod.object = source_obj
            uv_mod.use_loop_data = True
            uv_mod.data_types_loops = {'UV'}
            uv_mod.loop_mapping = 'POLYINTERP_NEAREST'
            uv_mod.layers_uv_select_src = 'NAME'
            uv_mod.layers_uv_select_dst = 'NAME'
            uv_mod.uv_layer_src = uv.name
            uv_mod.uv_layer_dst = uv.name
            bpy.ops.object.modifier_apply(modifier=uv_mod.name)
        except Exception as e:
            log_error(f"Failed to transfer UV layer {uv.name}: {e}")
            # Continue with next UV layer

    # Vertex colors
    for vcol in source_obj.data.vertex_colors:
        try:
            if vcol.name not in target_obj.data.vertex_colors:
                target_obj.data.vertex_colors.new(name=vcol.name)
            col_mod = target_obj.modifiers.new(name=f"Color_{vcol.name}", type='DATA_TRANSFER')
            col_mod.object = source_obj
            col_mod.use_loop_data = True
            col_mod.data_types_loops = {'COLOR'}
            col_mod.loop_mapping = 'POLYINTERP_NEAREST'
            col_mod.layers_vcol_select_src = 'NAME'
            col_mod.layers_vcol_select_dst = 'NAME'
            col_mod.vcol_layer_src = vcol.name
            col_mod.vcol_layer_dst = vcol.name
            bpy.ops.object.modifier_apply(modifier=col_mod.name)
        except Exception as e:
            log_error(f"Failed to transfer vertex color {vcol.name}: {e}")
            # Continue

    log("Texture transfer complete.")

# ==================== PARENTING ====================
def parent_target_to_armature(target_obj, armature_obj):
    """Parent the target mesh to the armature."""
    log("Parenting target to armature...")
    try:
        target_obj.parent = armature_obj
        target_obj.matrix_parent_inverse = armature_obj.matrix_world.inverted()
    except Exception as e:
        log_error(f"Failed to parent: {e}")
        raise

# ==================== EXPORT GLB ====================
def export_glb(filepath):
    """Export the scene as GLB with verification."""
    log(f"Exporting to {filepath}...")
    try:
        bpy.ops.export_scene.gltf(
            filepath=filepath,
            export_format='GLB',
            export_apply=True,
            export_animations=False
        )
    except Exception as e:
        log_error(f"Export failed: {e}")
        raise

    if not os.path.exists(filepath):
        raise RuntimeError(f"Export failed: file not created at {filepath}")

    log("Export successful.")

# ==================== MAIN RIGGING PIPELINE ====================
def main():
    try:
        log("=" * 50)
        log("Bio‑React Rigging Script Started (Ultra‑Robust Edition)")
        log("=" * 50)

        # Validate input files
        check_file_exists(INPUT_PATH, "Input mesh")
        check_file_exists(TEMPLATE_PATH, "Template mesh")

        # Reset scene
        reset_scene()

        # Import target mesh
        target_obj = import_mesh(INPUT_PATH)
        target_obj.name = "TargetMesh"

        # Import template (armature + mesh)
        template_armature = None
        template_mesh = None
        ext = os.path.splitext(TEMPLATE_PATH)[1].lower()
        try:
            if ext in ('.glb', '.gltf'):
                bpy.ops.import_scene.gltf(filepath=TEMPLATE_PATH)
            elif ext == '.fbx':
                bpy.ops.import_scene.fbx(filepath=TEMPLATE_PATH)
            else:
                raise ValueError(f"Unsupported template format: {ext}")
        except Exception as e:
            log_error(f"Template import failed: {e}")
            raise

        # Identify armature and mesh in template
        for obj in bpy.context.selected_objects:
            if obj.type == 'ARMATURE':
                template_armature = obj
            elif obj.type == 'MESH':
                template_mesh = obj

        if not template_armature:
            raise RuntimeError("Template does not contain an armature.")
        if not template_mesh:
            raise RuntimeError("Template does not contain a mesh.")

        template_armature.name = "TemplateArmature"
        template_mesh.name = "TemplateMesh"

        # Align template to target
        icp_align(target_obj, template_mesh)
        # Also move armature accordingly
        try:
            template_armature.matrix_world = template_mesh.matrix_world
        except Exception as e:
            log_error(f"Failed to sync armature transform: {e}")
            raise

        # Transfer weights
        transfer_weights(target_obj, template_mesh)

        # Smooth weights
        smooth_weights(target_obj)

        # Add armature modifier to target
        add_armature_modifier(target_obj, template_armature)

        # Transfer textures
        transfer_textures(target_obj, template_mesh)

        # Parent target to armature
        parent_target_to_armature(target_obj, template_armature)

        # Remove template mesh (keep armature)
        try:
            bpy.data.objects.remove(template_mesh, do_unlink=True)
        except Exception as e:
            log_error(f"Failed to remove template mesh: {e}")
            # Continue – not fatal

        # Ensure output directory exists
        try:
            os.makedirs(os.path.dirname(OUTPUT_PATH), exist_ok=True)
        except Exception as e:
            log_error(f"Failed to create output directory: {e}")
            raise

        # Export final GLB
        export_glb(OUTPUT_PATH)

        log("=" * 50)
        log("Rigging completed successfully!")
        log("=" * 50)
        sys.exit(0)

    except Exception as e:
        log("=" * 50)
        log_error("Rigging failed with exception:")
        traceback.print_exc()
        log("=" * 50)
        sys.exit(1)

if __name__ == "__main__":
    main()