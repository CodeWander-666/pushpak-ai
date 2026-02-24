import { type AnimationClip } from "three"

export interface AnimationWithState extends AnimationClip {
  isChecked?: boolean
  name: string
}
