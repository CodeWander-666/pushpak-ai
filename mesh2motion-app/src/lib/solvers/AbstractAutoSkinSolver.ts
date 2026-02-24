import { BufferGeometry, Object3D, type Bone } from 'three'
import { type SkeletonType } from '../enums/SkeletonType.js'
import BoneTesterData from '../interfaces/BoneTesterData.js'
import { Utility } from '../Utilities.js'

export abstract class AbstractAutoSkinSolver {
  protected bones_master_data: Bone[] = []
  protected geometry: BufferGeometry = new BufferGeometry()
  protected show_debug: boolean = false
  protected bone_idx_test: number = -1
  protected skeleton_type: SkeletonType | null = null
  protected debugging_scene_object: Object3D = new Object3D()

  constructor (bone_hier: Object3D, skeleton_type: SkeletonType) {
    this.set_skeleton_type(skeleton_type)
    this.bones_master_data = Utility.bone_list_from_hierarchy(bone_hier)
  }

  // calculation that will bring back the skin indices and weights
  public abstract calculate_indexes_and_weights (): number[][]

  public set_geometry (geom: BufferGeometry): void {
    this.geometry = geom
  }

  public get_geometry (): BufferGeometry {
    return this.geometry
  }

  public set_show_debug (debug_value: boolean): void {
    this.show_debug = debug_value
  }

  public set_bone_index_to_test (bone_idx: number): void {
    this.bone_idx_test = bone_idx
  }

  public set_debugging_scene_object (scene_object: Object3D): void {
    this.debugging_scene_object = scene_object
  }

  public set_skeleton_type (skinning_type: SkeletonType): void {
    this.skeleton_type = skinning_type
  }

  public get_bone_master_data (): Bone[] {
    return this.bones_master_data
  }

  protected geometry_vertex_count (): number {
    if (this.geometry === null) {
      console.error('Geometry is null. cannot get vertex count')
      return -1
    }

    return this.geometry.attributes.position.array.length / 3
  }
}
