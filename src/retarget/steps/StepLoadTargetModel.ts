import { type Bone, Box3, type Group, type Object3DEventMap, type Scene, type SkinnedMesh, Vector3 } from 'three'
import { type Mesh2MotionEngine } from '../Mesh2MotionEngine.ts'
import { ModalDialog } from '../../lib/ModalDialog.ts'
import { RetargetUtils } from '../RetargetUtils.ts'

/**
 * Handles loading the target model (user-uploaded model) for retargeting
 */
export class StepLoadTargetModel extends EventTarget {
  private readonly mesh2motion_engine: Mesh2MotionEngine
  private file_input: HTMLInputElement | null = null
  private load_model_button: HTMLLabelElement | null = null

  private retargetable_meshes: Scene | null = null

  constructor (mesh2motion_engine: Mesh2MotionEngine) {
    super()
    this.mesh2motion_engine = mesh2motion_engine
  }

  public begin (): void {
    this.add_event_listeners()
  }

  public get_retargetable_meshes (): Scene | null {
    return this.retargetable_meshes
  }

  private add_event_listeners (): void {
    // Get DOM elements
    this.file_input = document.getElementById('upload-file') as HTMLInputElement
    this.load_model_button = document.getElementById('load-model-button') as HTMLLabelElement

    if (this.file_input === null) {
      console.error('Could not find file input element')
      return
    }

    // Add event listener for file selection
    this.file_input.addEventListener('change', (event) => {
      console.log('File input changed', event)
      this.handle_file_select(event)
    })
  }

  private handle_file_select (event: Event): void {
    const target = event.target as HTMLInputElement
    if (target.files !== null && target.files.length > 0) {
      const file = target.files[0]
      console.log('File selected:', file.name, 'Size:', file.size, 'Type:', file.type)

      // Get file extension
      const file_name = file.name.toLowerCase()
      let file_extension = ''
      if (file_name.endsWith('.glb')) {
        file_extension = 'glb'
      } else if (file_name.endsWith('.fbx')) {
        file_extension = 'fbx'
      } else if (file_name.endsWith('.zip')) {
        file_extension = 'zip'
      } else {
        new ModalDialog('Unsupported file type. Please select a GLB, FBX, or ZIP file.', 'Error').show()
        return
      }

      // Configure the model loader to preserve all objects (bones, etc.)
      this.mesh2motion_engine.load_model_step.set_preserve_skinned_mesh(true)

      // Create a URL for the file and load it
      const file_url = URL.createObjectURL(file)

      try {
        this.mesh2motion_engine.load_model_step.load_model_file(file_url, file_extension)

        this.mesh2motion_engine.load_model_step.addEventListener('modelLoadedForRetargeting', () => {
          console.log('Model loaded for retargeting successfully.')
          URL.revokeObjectURL(file_url) // Revoke the object URL after loading is complete

          // read in mesh2motion engine's retargetable model data (this is the target)
          const retargetable_meshes: Scene = this.mesh2motion_engine.load_model_step.get_final_retargetable_model_data()
          const is_valid_skinned_mesh = RetargetUtils.validate_skinned_mesh_has_bones(retargetable_meshes)
          if (is_valid_skinned_mesh) {
            // we have valid skinned mesh(s). The could be very large though,
            // we let's check to see how large everything is
            const bounding_box = new Box3().setFromObject(retargetable_meshes)
            const size = new Vector3()
            bounding_box.getSize(size)
            // console.log('Retargetable meshes bounding box size:', size)
            // console.log('Skinned mesh data to inspect:', retargetable_meshes)

            RetargetUtils.reset_skinned_mesh_to_rest_pose(retargetable_meshes)
            this.mesh2motion_engine.get_scene().add(retargetable_meshes)
            const largest_dimension: number = this.calculate_max_mesh_dimension(retargetable_meshes)

            // if the largest dimension is over 20, scale the entire scene down to be 
            const target_height: number = 1.5 // in meters
            if (largest_dimension > 20) {
              // calculate scale factor
              const scale_factor = target_height / largest_dimension
              console.log('scaling model down because of ', largest_dimension)
              new ModalDialog('Large Rig Warning',
                `The model you imported is large (${largest_dimension.toFixed(1)} meters). Mesh2Motion expects 1 unit = 1 meter. Your model will be scaled down. This will affect the retargeted animation results. This warning will go away whenever the developer can figure out how to correctly handle issues with.`).show()
              retargetable_meshes.scale.set(scale_factor, scale_factor, scale_factor) // common case with 3d creation tools that use 1 cm = 1 unit
            }

            // need to compare skeletons. for some reason the GLBs scale down fine, but the FBX bones are not looking right
            console.log('Final retargetable meshes after potential scaling:', retargetable_meshes)

            // Add skeleton helper
            this.add_skeleton_helper(retargetable_meshes)

            // Save the final retargetable meshes and dispatch event
            this.retargetable_meshes = retargetable_meshes
            this.dispatchEvent(new CustomEvent('target-model-loaded'))
          }
        }, { once: true })
      } catch (error) {
        console.error('Error loading model:', error)
        new ModalDialog('Error loading model file.', 'Error').show()
        URL.revokeObjectURL(file_url) // Clean up the URL
      }
    }
  }

  private fix_fbx_mixamo_bones (): void {
    // TODO: The FBX files for Mixamo do something weird with the bone hieararchy in three.js.
    // The root bone is is the "hips" bone, and the first child of the hips bone is also named "hips".
    // This is messing up stuff like the skeleton helper and probably the animations by assigning keyframes in the wrong way.
    // The root hips bone is not in the "bones list" with the skeleton data, so I am not sure why that is there. I might have to look into the FBX loader
    // class to see what is going on.
  }

  private add_skeleton_helper (retargetable_meshes: Scene): void {
    retargetable_meshes.traverse((child) => {
      if (child.type === 'SkinnedMesh') {
        const skinned_mesh = child as SkinnedMesh
        this.mesh2motion_engine.regenerate_skeleton_helper(skinned_mesh.skeleton, 'Retarget Skeleton Helper')
      }
    })
  }

  // gets max dimension of the model for scaling
  // returns a unitless number representing the largest dimension
  private calculate_max_mesh_dimension (retargetable_meshes: Scene): number {
    const bounding_box = new Box3().setFromObject(retargetable_meshes)
    const size = new Vector3()
    bounding_box.getSize(size)
    return Math.max(size.x, size.y, size.z)
  }
}
