import {
  AnimationClip, Euler, type Object3D, Quaternion, QuaternionKeyframeTrack, Vector3,
  VectorKeyframeTrack, Scene, Group, type SkinnedMesh,
  Skeleton,
  type Bone
} from 'three'
import { RetargetUtils } from './RetargetUtils.ts'
import { TargetBoneMappingType } from './steps/StepBoneMapping.ts'
import { SkeletonType } from '../lib/enums/SkeletonType.ts'
import { Retargeter } from './human-retargeting/Retargeter.ts'
import { Rig } from './human-retargeting/Rig.ts'
import { HumanChainConfig } from './human-retargeting/HumanChainConfig.ts'

/**
 * Parsed animation track name containing bone name and property type
 */
export interface TrackNameParts {
  bone_name: string
  property: string
}
// AnimationRetargetService - Shared service for retargeting animations from one skeleton to another
// Used by both RetargetAnimationPreview and RetargetAnimationListing
export class AnimationRetargetService {
  private static instance: AnimationRetargetService | null = null

  // #region GETTER/SETTER
  /**
   * Get/set for the skeleton type. This will be the source of truth
   * for other classes to grab this data
   */
  private source_armature: Group = new Group()
  private skeleton_type: SkeletonType = SkeletonType.None
  private target_armature: Scene = new Scene()

  private target_skinned_meshes: SkinnedMesh[] = []
  private target_mapping_type: TargetBoneMappingType = TargetBoneMappingType.Custom
  private bone_mappings: Map<string, string> = new Map<string, string>()

  public set_bone_mappings (mappings: Map<string, string>): void {
    this.bone_mappings = mappings
  }

  public get_bone_mappings (): Map<string, string> {
    return this.bone_mappings
  }

  public set_source_armature (armature: Group): void {
    this.source_armature = armature
  }

  public get_source_armature (): Group {
    return this.source_armature
  }

  public set_target_armature (new_armature: Scene): void {
    this.target_armature = new_armature

    // re-calculate skinned meshes from target armature scene
    this.target_skinned_meshes = []
    this.target_armature.traverse((child) => {
      if (child.type === 'SkinnedMesh') {
        this.target_skinned_meshes.push(child as SkinnedMesh)
      }
    })
  }

  public get_target_skinned_meshes (): SkinnedMesh[] {
    return this.target_skinned_meshes
  }

  public get_target_armature (): Scene {
    return this.target_armature
  }

  public set_skeleton_type (type: SkeletonType): void {
    this.skeleton_type = type
  }

  public get_skeleton_type (): SkeletonType {
    return this.skeleton_type
  }

  public set_target_mapping_type (type: TargetBoneMappingType): void {
    this.target_mapping_type = type
  }

  public get_target_mapping_type (): TargetBoneMappingType {
    return this.target_mapping_type
  }

  // #endregion

  private constructor () {}

  // #region PUBLIC METHODS

  public static getInstance (): AnimationRetargetService {
    if (AnimationRetargetService.instance === null) {
      AnimationRetargetService.instance = new AnimationRetargetService()
    }
    return AnimationRetargetService.instance
  }

  /**
   * Retarget an animation clip using bone mappings
   * @param source_clip - The original animation clip from the source skeleton
   * @returns A new animation clip retargeted for the target skeleton
   */
  public retarget_animation_clip (source_clip: AnimationClip): AnimationClip {
    const new_tracks: any[] = [] // store new retargeted tracks

    // if there are no bone mappings, return the source clip as there is nothing to retarget
    if (this.bone_mappings.size === 0) {
      console.warn('No bone mappings available for retargeting. Returning source clip as-is.')
      return source_clip
    }

    // ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
    // if the source skeleton is of type human, try tuse the human retargeting system
    // we ignore Mesh2Motion type since that is identical to the source and does not need retargeting
    if (this.skeleton_type === SkeletonType.Human && this.target_mapping_type !== TargetBoneMappingType.Mesh2Motion) {
      console.log('Using Human Retargeter for retargeting animation clip:', source_clip.name, this.target_mapping_type)
      return this.apply_human_swing_twist_retargeting(source_clip, this.target_mapping_type)
    }

    // ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
    // Besides the above special case, the standard retargeting will just be bone mapping applied
    // Maybe in the future we can do other more advanced things.

    // Process each track in the source animation
    source_clip.tracks.forEach((track) => {
      // Parse the track name to get the bone name and property
      // Track names are typically in format: "boneName.property" or ".bones[boneName].property"
      const track_parts: TrackNameParts | null = this.parse_track_name_for_metadata(track.name)
      if (track_parts === null) {
        return
      }

      // Check if this bone is mapped to any target bones
      const target_bone_names = this.reverse_bone_mapping(this.bone_mappings).get(track_parts.bone_name)
      if (target_bone_names === undefined || target_bone_names.length === 0) {
        return // Skip unmapped bones
      }

      // Create a track for each target bone this source bone maps to. Will mostly just rename
      // a bone with the mapping
      target_bone_names.forEach((target_bone_name) => {
        const new_track_name = RetargetUtils.create_track_name(target_bone_name, track_parts.property)

        if (track_parts.property === 'quaternion') {
          const new_track = new QuaternionKeyframeTrack(new_track_name, track.times.slice(), track.values.slice())
          new_tracks.push(new_track)
        } else if (track_parts.property === 'position' || track_parts.property === 'scale') {
          const new_track = new VectorKeyframeTrack(new_track_name, track.times.slice(), track.values.slice())
          new_tracks.push(new_track)
        } else {
          console.warn('This track contains unsupported property for retargeting:', track_parts.property)
        }
      })
    })

    // Create the retargeted animation clip
    const retargeted_clip = new AnimationClip(`${source_clip.name}`, source_clip.duration, new_tracks)

    console.log(`Retargeted animation: ${source_clip.name} (${new_tracks.length} tracks)`)
    return retargeted_clip
  }

  // #endregion

  // #region PRIVATE METHODS

  private apply_human_swing_twist_retargeting (source_clip: AnimationClip, target_mapping_type: TargetBoneMappingType): AnimationClip {
    // the retargeter needs Skeleton inputs fot both source and target.
    // the source armature is a Group, so we need to convert to a THREE.Skeleton before we can continue
    const source_skeleton: Skeleton | null = this.create_skeleton_from_source(this.source_armature)
    if (source_skeleton === null) {
      console.error('Failed to extract source skeleton from source armature for Human Retargeter.')
      return source_clip
    }

    // create a custom "Rig" for the source and the target skeletons
    const source_rig: Rig = new Rig(source_skeleton)
    const target_rig: Rig = new Rig(this.target_skinned_meshes[0].skeleton)


    // if it is a known bone mapping, we can grab the preset config
    // if not, we will need to manually build the config from the bone mappings
    if (target_mapping_type === TargetBoneMappingType.Mixamo) {
      source_rig.fromConfig(HumanChainConfig.mesh2motion_config)
      target_rig.fromConfig(HumanChainConfig.mixamo_config)
    } else if (target_mapping_type === TargetBoneMappingType.Custom) {
      const custom_source_config = HumanChainConfig.build_custom_source_config(this.get_bone_mappings())
      const custom_target_config = HumanChainConfig.build_custom_target_config(custom_source_config, this.get_bone_mappings())

      // set the custom rigs from the generated configs
      source_rig.fromConfig(custom_source_config)
      target_rig.fromConfig(custom_target_config)
    }

    const retargeter: Retargeter = new Retargeter(source_rig, target_rig, source_clip)

    // TODO: experiment with the additives later with T-pose correction
    // retargeter.additives.push(
    //     (Ref.addAxis  = new AxisAdditive( 'armL', 'y', 0 * Math.PI / 180 )),
    //     (Ref.addTwist = new ChainTwistAdditive( 'armR', 0 * Math.PI / 180 )),
    // );

    // Initialize the retargeter with a small delta
    retargeter.update(0.001)

    // Bake the retargeted animation into keyframe tracks
    // 30 fps for input animations is usually sufficient for now
    const retargeted_tracks: Array<QuaternionKeyframeTrack | VectorKeyframeTrack> = retargeter.bake_animation_to_tracks(30)

    // Create and return the new retargeted animation clip
    const retargeted_clip = new AnimationClip(
      `${source_clip.name}_retargeted`,
      source_clip.duration,
      retargeted_tracks
    )

    console.log(`Swing-Twist retargeting complete: ${source_clip.name} -> ${retargeted_clip.name}`)
    console.log('getting source clip before bone correction:', source_clip.tracks)
    console.log('getting retargeted clip:', retargeted_clip.tracks)

    return retargeted_clip
  }

  /**
   * Utility: Convert a Group (with Armature and Bone hierarchy) to a THREE.Skeleton
   * @param group - The root Group containing the Armature and Bone hierarchy
   * @returns Skeleton or null if not found
   */
  private create_skeleton_from_source (group: Group): Skeleton | null {
    // Find the Armature child
    const armature = group.children.find(child => child.type === 'Object3D' &&
      child.name.toLowerCase().includes('armature'))

    if (armature === undefined) return null

    // Find the root Bone under the Armature
    const root_bone = armature.children.find(child => child.type === 'Bone') as Bone | undefined

    if (root_bone === undefined) return null

    const bones = this.collect_bones(root_bone)

    if (bones.length === 0) return null

    const skeleton = new Skeleton(bones)
    skeleton.calculateInverses()
    return skeleton
  }

  // Recursively collect all bones. part of extract_skeleton_from_group()
  private collect_bones (object: Object3D, bones: Bone[] = []): Bone[] {
    if (object.type === 'Bone') bones.push(object as Bone)
    object.children.forEach(child => this.collect_bones(child, bones))
    return bones
  }

  /**
   * Create a reverse mapping: source bone name -> array of target bone names
   */
  private reverse_bone_mapping (bone_mappings: Map<string, string>): Map<string, string[]> {
    const reverse_mappings = new Map<string, string[]>()
    bone_mappings.forEach((source_bone_name, target_bone_name) => {
      if (!reverse_mappings.has(source_bone_name)) {
        reverse_mappings.set(source_bone_name, [])
      }
      const target_list = reverse_mappings.get(source_bone_name)
      if (target_list !== undefined) {
        target_list.push(target_bone_name)
      }
    })
    return reverse_mappings
  }

  /**
   * Parse a track name to extract bone name and property (e.g., "quaternion", "position", "scale")
   * Handles various formats like "boneName.property" or ".bones[boneName].property"
   */
  private parse_track_name_for_metadata (track_name: string): TrackNameParts | null {
    // Try format: "boneName.property"
    const simple_match = track_name.match(/^([^.]+)\.(.+)$/)
    if (simple_match !== null) {
      return {
        bone_name: simple_match[1],
        property: simple_match[2]
      }
    }

    // Try format: ".bones[boneName].property"
    const bones_match = track_name.match(/\.bones\[([^\]]+)\]\.(.+)$/)
    if (bones_match !== null) {
      return {
        bone_name: bones_match[1],
        property: bones_match[2]
      }
    }

    return null
  }
  // #endregion
}
