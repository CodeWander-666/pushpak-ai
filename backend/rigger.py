import bpy
import sys
import numpy as np
from mathutils import Vector, Matrix
import traceback

argv = sys.argv[sys.argv.index("--") + 1:]
if len(argv) < 3:
    print("ERROR: Missing arguments")
    sys.exit(1)
input_path, template_path, output_path = argv

def log(msg):
    print(msg)
    sys.stdout.flush()

try:
    # ---------- clean scene ----------
    bpy.ops.wm.read_factory_settings(use_empty=True)

    # ---------- import target mesh ----------
    log(f"Importing target: {input_path}")
    if input_path.endswith('.obj'):
        bpy.ops.wm.obj_import(filepath=input_path)
    else:
        bpy.ops.import_scene.gltf(filepath=input_path)
    target_obj = bpy.context.selected_objects[0]
    target_obj.name = "Target"

    # Validate target mesh
    if len(target_obj.data.vertices) == 0:
        raise Exception("Target mesh has no vertices")
    if len(target_obj.data.polygons) == 0:
        raise Exception("Target mesh has no faces")

    # ---------- import template ----------
    log(f"Importing template: {template_path}")
    bpy.ops.import_scene.gltf(filepath=template_path)
    template_armature = None
    template_mesh = None
    for obj in bpy.context.selected_objects:
        if obj.type == 'ARMATURE':
            template_armature = obj
        elif obj.type == 'MESH':
            template_mesh = obj
    if not template_armature or not template_mesh:
        raise Exception("Template must contain one armature and one mesh")
    template_mesh.name = "TemplateMesh"
    template_armature.name = "TemplateArmature"

    # ---------- ICP alignment (robust Procrustes) ----------
    log("Aligning template to target...")
    target_verts = np.array([target_obj.matrix_world @ v.co for v in target_obj.data.vertices])
    template_verts = np.array([template_mesh.matrix_world @ v.co for v in template_mesh.data.vertices])

    # Center
    t_center = target_verts.mean(axis=0)
    s_center = template_verts.mean(axis=0)
    target_centered = target_verts - t_center
    template_centered = template_verts - s_center

    # Scale
    t_scale = np.sqrt((target_centered ** 2).sum(axis=1).mean())
    s_scale = np.sqrt((template_centered ** 2).sum(axis=1).mean())
    scale = t_scale / s_scale if s_scale > 0 else 1.0

    # Optimal rotation via SVD
    H = template_centered.T @ target_centered
    U, _, Vt = np.linalg.svd(H)
    R = Vt.T @ U.T
    if np.linalg.det(R) < 0:
        Vt[-1, :] *= -1
        R = Vt.T @ U.T

    # Build transformation matrix
    transform = Matrix(R.tolist()).to_4x4()
    transform.translation = Vector(t_center) - Vector(s_center) @ transform
    transform = Matrix.Scale(scale, 4) @ transform

    # Apply to template objects
    template_mesh.matrix_world = transform @ template_mesh.matrix_world
    template_armature.matrix_world = transform @ template_armature.matrix_world
    log("Alignment complete")

    # ---------- transfer vertex groups (weights) ----------
    log("Transferring skinning weights...")
    target_obj.vertex_groups.clear()

    mod = target_obj.modifiers.new(name="WeightTransfer", type='DATA_TRANSFER')
    mod.object = template_mesh
    mod.use_vert_data = True
    mod.data_types_verts = {'VGROUP_WEIGHTS'}
    mod.vert_mapping = 'POLYINTERP_NEAREST'  # best for different topologies

    bpy.context.view_layer.objects.active = target_obj
    bpy.ops.object.datalayout_transfer(modifier=mod.name)
    bpy.ops.object.modifier_apply(modifier=mod.name)

    # ---------- smooth weights ----------
    log("Smoothing weights...")
    smooth_mod = target_obj.modifiers.new(name="WeightSmooth", type='LAPLACIANSMOOTH')
    smooth_mod.iterations = 10
    smooth_mod.lambda_factor = 0.5
    smooth_mod.use_volume_preserve = True
    if target_obj.vertex_groups:
        smooth_mod.vertex_group = target_obj.vertex_groups[0].name
    bpy.ops.object.modifier_apply(modifier=smooth_mod.name)

    # ---------- add armature modifier ----------
    arm_mod = target_obj.modifiers.new(name="Armature", type='ARMATURE')
    arm_mod.object = template_armature

    # ---------- transfer UVs and vertex colors ----------
    log("Transferring textures...")
    # UV maps
    for uv in template_mesh.data.uv_layers:
        if uv.name not in target_obj.data.uv_layers:
            target_obj.data.uv_layers.new(name=uv.name)
        uv_mod = target_obj.modifiers.new(name=f"UV_{uv.name}", type='DATA_TRANSFER')
        uv_mod.object = template_mesh
        uv_mod.use_loop_data = True
        uv_mod.data_types_loops = {'UV'}
        uv_mod.loop_mapping = 'POLYINTERP_NEAREST'
        uv_mod.layers_uv_select_src = 'NAME'
        uv_mod.layers_uv_select_dst = 'NAME'
        uv_mod.uv_layer_src = uv.name
        uv_mod.uv_layer_dst = uv.name
        bpy.ops.object.modifier_apply(modifier=uv_mod.name)

    # Vertex colors
    for vcol in template_mesh.data.vertex_colors:
        if vcol.name not in target_obj.data.vertex_colors:
            target_obj.data.vertex_colors.new(name=vcol.name)
        col_mod = target_obj.modifiers.new(name=f"Color_{vcol.name}", type='DATA_TRANSFER')
        col_mod.object = template_mesh
        col_mod.use_loop_data = True
        col_mod.data_types_loops = {'COLOR'}
        col_mod.loop_mapping = 'POLYINTERP_NEAREST'
        col_mod.layers_vcol_select_src = 'NAME'
        col_mod.layers_vcol_select_dst = 'NAME'
        col_mod.vcol_layer_src = vcol.name
        col_mod.vcol_layer_dst = vcol.name
        bpy.ops.object.modifier_apply(modifier=col_mod.name)

    # ---------- parent target to armature ----------
    target_obj.parent = template_armature
    target_obj.matrix_parent_inverse = template_armature.matrix_world.inverted()

    # Remove template mesh (keep armature)
    bpy.data.objects.remove(template_mesh, do_unlink=True)

    # ---------- export GLB ----------
    log("Exporting rigged model...")
    bpy.ops.export_scene.gltf(
        filepath=output_path,
        export_format='GLB',
        export_apply=True,
        export_animations=False
    )
    log(f"SUCCESS: {output_path}")
    sys.exit(0)

except Exception as e:
    log(f"ERROR: {str(e)}")
    traceback.print_exc()
    sys.exit(1)