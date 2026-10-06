import { createContext, useContext, useEffect, useMemo, useRef, type ReactNode } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { getApp } from '../store'
import type { SystemId, VehicleDef } from '../data/types'

export const VehicleCtx = createContext<{ def: VehicleDef | null; showcase: boolean }>({ def: null, showcase: false })
export const useVehicle = () => useContext(VehicleCtx)

/** section plane used by CUTAWAY: removes everything on the viewer's (+Z) side */
export const CUT_PLANE = new THREE.Plane(new THREE.Vector3(0, 0, -1), 0)

export type MatKind = 'paint' | 'glass' | 'metal' | 'steel' | 'dark' | 'rubber' | 'casing' | 'accent' | 'interior' | 'tank' | 'light' | 'screen' | 'white'

const HIGHLIGHT = new THREE.Color('#8fd6ff')

export function makeMaterial(kind: MatKind, color?: string): THREE.MeshPhysicalMaterial {
  const m = new THREE.MeshPhysicalMaterial({ transparent: true })
  const c = (d: string) => new THREE.Color(color ?? d)
  switch (kind) {
    case 'paint': Object.assign(m, { color: c('#5b636b'), metalness: 0.55, roughness: 0.3, clearcoat: 1, clearcoatRoughness: 0.06 }); m.side = THREE.DoubleSide; break
    case 'white': Object.assign(m, { color: c('#d5dbe1'), metalness: 0.15, roughness: 0.35, clearcoat: 0.6, clearcoatRoughness: 0.2 }); m.side = THREE.DoubleSide; break
    case 'glass': Object.assign(m, { color: c('#0c141b'), metalness: 0.2, roughness: 0.04, opacity: 0.62 }); m.side = THREE.DoubleSide; break
    case 'metal': Object.assign(m, { color: c('#a9b2ba'), metalness: 0.9, roughness: 0.28 }); break
    case 'steel': Object.assign(m, { color: c('#58616a'), metalness: 0.75, roughness: 0.42 }); break
    case 'dark': Object.assign(m, { color: c('#1a1e23'), metalness: 0.25, roughness: 0.65 }); break
    case 'rubber': Object.assign(m, { color: c('#0e1012'), metalness: 0, roughness: 0.92 }); break
    case 'interior': Object.assign(m, { color: c('#3a4049'), metalness: 0.05, roughness: 0.8 }); break
    case 'casing': Object.assign(m, { color: c('#9fb6c8'), metalness: 0.3, roughness: 0.15, opacity: 0.2, depthWrite: false }); m.side = THREE.DoubleSide; break
    case 'tank': Object.assign(m, { color: c('#ff8a3d'), metalness: 0.1, roughness: 0.3, opacity: 0.38, depthWrite: false, emissive: c('#ff8a3d'), emissiveIntensity: 0.25 }); m.side = THREE.DoubleSide; break
    case 'accent': Object.assign(m, { color: c('#8fd6ff'), metalness: 0.45, roughness: 0.35, emissive: c('#8fd6ff'), emissiveIntensity: 0.08 }); break
    case 'light': Object.assign(m, { color: c('#ffffff'), emissive: c('#ffffff'), emissiveIntensity: 0.2, roughness: 0.2 }); break
    case 'screen': Object.assign(m, { color: c('#0d1a26'), emissive: c('#3a7bd5'), emissiveIntensity: 0.6, roughness: 0.2 }); break
  }
  m.userData.base = m.opacity
  m.userData.baseEmissive = m.emissiveIntensity
  m.userData.baseEmissiveColor = m.emissive.clone()
  return m
}

interface PartProps {
  comp?: string | string[]
  system?: SystemId
  layer?: string
  kind?: MatKind
  color?: string
  /** outer skin: fades away in X-RAY and when looking at internals */
  shell?: boolean
  /** affected by CUTAWAY section plane */
  clip?: boolean
  opacity?: number
  emissive?: string
  emissiveIntensity?: number
  side?: 1 | -1
  children: ReactNode
  position?: [number, number, number]
  rotation?: [number, number, number]
  scale?: number | [number, number, number]
  groupRef?: React.Ref<THREE.Group>
  /** mutate material each frame (heat glow, lights) */
  onMat?: (m: THREE.MeshPhysicalMaterial, t: number) => void
}

/**
 * Every visible piece of a machine is a Part. A Part owns one material and decides each frame
 * how bright / transparent it should be from global state (selection, x-ray, flow isolation,
 * cutaway, exploded view). This keeps models declarative and data driven.
 */
export function Part({ comp, system, layer, kind = 'steel', color, shell, clip, opacity, emissive, emissiveIntensity, side, children, position, rotation, scale, groupRef, onMat }: PartProps) {
  const { def, showcase } = useVehicle()
  const g = useRef<THREE.Group>(null!)
  const mat = useMemo(() => {
    const m = makeMaterial(kind, color)
    if (opacity !== undefined) { m.opacity = opacity; m.userData.base = opacity }
    if (emissive) { m.emissive.set(emissive); m.userData.baseEmissiveColor = m.emissive.clone() }
    if (emissiveIntensity !== undefined) { m.emissiveIntensity = emissiveIntensity; m.userData.baseEmissive = emissiveIntensity }
    return m
  }, [kind, color, opacity, emissive, emissiveIntensity])
  const comps = useMemo(() => (comp ? (Array.isArray(comp) ? comp : [comp]) : []), [comp])
  const base = useMemo(() => new THREE.Vector3(...(position ?? [0, 0, 0])), [position])
  const layerDef = def?.layers.find((l) => l.id === layer)
  const sgn = side ?? (Math.sign(position?.[2] ?? 0) || 1)
  const clipOn = useRef(false)

  useEffect(() => {
    g.current.traverse((o) => {
      const m = o as THREE.Mesh
      if (m.isMesh && !m.userData.keepMat) { m.material = mat; m.userData.keepMat = true; m.userData.part = { comps, system } }
    })
  })
  useEffect(() => () => mat.dispose(), [mat])

  const tmp = useMemo(() => new THREE.Vector3(), [])
  useFrame((state, dt) => {
    const s = getApp()
    const k = 1 - Math.exp(-dt * 6)
    const sel = s.selected
    const isSel = !!sel && comps.includes(sel)
    const inSys = !!s.focusSystem && system === s.focusSystem
    const hidden = !!layer && s.hiddenLayers.includes(layer)
    g.current.visible = !hidden
    if (hidden) return
    const zone = def?.walk.find((w) => w.id === s.walkZone)
    let target = mat.userData.base as number
    if (!showcase) {
      if (shell) {
        const lookingInside = s.xray || s.flowIsolate || !!sel || !!s.focusSystem || !!zone?.xray || !!s.learn
        if (lookingInside && !s.cutaway) target = kind === 'glass' ? 0.05 : 0.09
        else if (lookingInside && s.cutaway) target = Math.min(target, 0.55)
      } else if (s.flowIsolate) target = Math.min(target, 0.08)
      else if ((s.focusSystem || sel) && !isSel && !inSys) target = target * 0.3
    }
    mat.opacity += (target - mat.opacity) * k
    mat.depthWrite = mat.opacity > 0.6 && kind !== 'casing' && kind !== 'tank'

    // highlight
    const glow = isSel ? 0.55 + Math.sin(state.clock.elapsedTime * 3.2) * 0.25 : inSys && !showcase ? 0.18 : 0
    if (glow > 0) {
      mat.emissive.copy(HIGHLIGHT)
      mat.emissiveIntensity += (glow - mat.emissiveIntensity) * k
    } else {
      mat.emissive.copy(mat.userData.baseEmissiveColor)
      mat.emissiveIntensity += ((mat.userData.baseEmissive as number) - mat.emissiveIntensity) * k
    }
    onMat?.(mat, state.clock.elapsedTime)

    // cutaway
    const wantClip = !!clip && s.cutaway && !showcase
    if (wantClip !== clipOn.current) {
      clipOn.current = wantClip
      mat.clippingPlanes = wantClip ? [CUT_PLANE] : null
      mat.needsUpdate = true
    }

    // exploded / lift
    tmp.copy(base)
    if (layerDef && s.exploded && !showcase) {
      tmp.x += layerDef.offset[0]; tmp.y += layerDef.offset[1]; tmp.z += layerDef.offset[2]
      if (layerDef.outward) tmp.z += sgn * layerDef.outward
    }
    if (zone?.lift && (layer === 'body' || layer === 'interior')) tmp.y += 1.7 * (def?.scale ?? 1)
    g.current.position.lerp(tmp, 1 - Math.exp(-dt * 3.2))
  })

  return (
    <group ref={(o) => { g.current = o!; if (typeof groupRef === 'function') groupRef(o); else if (groupRef) (groupRef as React.MutableRefObject<THREE.Group | null>).current = o }} position={position} rotation={rotation} scale={scale}>
      {children}
    </group>
  )
}
