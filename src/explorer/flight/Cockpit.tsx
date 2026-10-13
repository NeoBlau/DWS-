import { useEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { fusR, fusY } from '../../models/aircraftLayout'
import { applyFinish } from '../surface'
import { DEG, DEST, confAt, type Sim } from './fdm'
import { FS } from './state'

/*
 * A320-style flight deck seen from the captain's seat, built in the drawing frame of aircraftLayout
 * (x to the nose, y up, ground at y = 0, +z = right). The windows are real openings in an interior shell,
 * so the outside world is seen through tinted, reflecting glass; the six display units are drawn live.
 */

/* ------------------------------------------------------------------ window panes (shared with the outside) */
// [x0, x1, a0, a1] with a = angle around the fuselage axis from the crown (+ toward the right wing)
export const PANES: [number, number, number, number][] = [
  [17.2, 18.15, 0.05, 0.82], // front windshield, right
  [17.2, 18.15, -0.82, -0.05], // front windshield, left
  [16.5, 17.12, 0.86, 1.28], // sliding side window, right
  [16.5, 17.12, -1.28, -0.86],
  [15.85, 16.42, 0.9, 1.24], // aft side window
  [15.85, 16.42, -1.24, -0.9],
]
const inPane = (x: number, a: number, m = 0) => PANES.some(([x0, x1, a0, a1]) => x > x0 - m && x < x1 + m && a > a0 - m * 0.3 && a < a1 + m * 0.3)
/** a patch of the fuselage surface between x0..x1 and a0..a1, lifted by `off`; normals point outward */
export function surfacePatch(x0: number, x1: number, a0: number, a1: number, off: number, N = 10, M = 10) {
  const pos: number[] = [], idx: number[] = [], uv: number[] = []
  for (let i = 0; i <= N; i++) for (let j = 0; j <= M; j++) {
    const x = x0 + ((x1 - x0) * i) / N, a = a0 + ((a1 - a0) * j) / M, r = fusR(x) + off
    pos.push(x, fusY(x) + Math.cos(a) * r, Math.sin(a) * r); uv.push(j / M, i / N)
  }
  for (let i = 0; i < N; i++) for (let j = 0; j < M; j++) { const p = i * (M + 1) + j; idx.push(p, p + 1, p + M + 1, p + 1, p + M + 2, p + M + 1) }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setIndex(idx); g.computeVertexNormals()
  return g
}

/* ------------------------------------------------------------------ live display units */
type Draw = (g: CanvasRenderingContext2D, s: Sim) => void
const GREEN = '#36e07a', CYAN = '#5cd8ff', AMBER = '#ffb02e', WHITE = '#f2f4f6', MAG = '#ff5ce6'
const drawPFD: Draw = (g, s) => {
  const d = s.d, W = 256
  g.fillStyle = '#05070a'; g.fillRect(0, 0, W, W)
  g.save(); g.beginPath(); g.rect(52, 34, 152, 170); g.clip()
  g.translate(128, 120); g.rotate(-(d.phi ?? 0)); g.translate(0, (d.theta ?? 0) / DEG * 4)
  g.fillStyle = '#2a74c9'; g.fillRect(-300, -600, 600, 600); g.fillStyle = '#8a5730'; g.fillRect(-300, 0, 600, 600)
  g.strokeStyle = WHITE; g.lineWidth = 1.5; g.beginPath(); g.moveTo(-300, 0); g.lineTo(300, 0); g.stroke()
  for (const p of [-20, -10, 10, 20]) { g.beginPath(); g.moveTo(-22, -p * 4); g.lineTo(22, -p * 4); g.stroke() }
  g.restore()
  g.fillStyle = '#ffe14d'; g.fillRect(84, 118, 28, 4); g.fillRect(144, 118, 28, 4); g.fillRect(126, 117, 5, 5)
  g.font = '15px monospace'; g.fillStyle = GREEN; g.textAlign = 'center'
  g.fillStyle = '#1b2029'; g.fillRect(6, 34, 42, 170); g.fillRect(208, 34, 42, 170)
  g.fillStyle = GREEN; g.fillText(String(Math.round(d.ias ?? 0)), 27, 125); g.fillText(String(Math.round((d.alt ?? 0) - 10)), 229, 125)
  g.font = '11px monospace'; g.fillStyle = s.ctl.law === 'direct' ? AMBER : GREEN; g.fillText(s.ctl.law === 'direct' ? 'DIRECT' : s.airborne ? 'NORMAL' : 'GROUND', 128, 22)
  g.fillStyle = CYAN; g.fillText(`CONF ${d.confId ?? '0'}`, 210, 22)
  g.fillStyle = WHITE; g.fillText(`${String(Math.round((((d.psi ?? 0) / DEG + 90 + 360) % 360))).padStart(3, '0')}`, 128, 228)
  if (d.stall && s.airborne) { g.fillStyle = '#ff4a3d'; g.font = 'bold 22px monospace'; g.fillText('STALL', 128, 170) }
}
const drawND: Draw = (g, s) => {
  const W = 256, d = s.d
  g.fillStyle = '#05070a'; g.fillRect(0, 0, W, W)
  const cx = 128, cy = 200, R = 160
  const hdg = (d.psi ?? 0)
  g.strokeStyle = WHITE; g.lineWidth = 1.2; g.beginPath(); g.arc(cx, cy, R, Math.PI * 1.15, Math.PI * 1.85); g.stroke()
  g.font = '10px monospace'; g.fillStyle = WHITE; g.textAlign = 'center'
  for (let k = -40; k <= 40; k += 10) {
    const hd = Math.round(((hdg / DEG + 90 + k) % 360 + 360) % 360)
    const a = -Math.PI / 2 + k * DEG
    g.fillText(String(Math.round(hd / 10)).padStart(2, '0'), cx + Math.cos(a) * (R + 10), cy + Math.sin(a) * (R + 10) + 4)
  }
  // route: the destination runway straight ahead along +x (40 NM range)
  const scale = R / (40 * 1852)
  const rel = (x: number, z: number) => { const dx = x - s.pos.x, dz = z - s.pos.z; const ang = Math.atan2(dz, dx) - hdg, r = Math.hypot(dx, dz) * scale; return [cx + Math.sin(ang) * r, cy - Math.cos(ang) * r] }
  g.strokeStyle = GREEN; g.lineWidth = 2; g.beginPath(); const a = rel(0, 0), b = rel(DEST, 0); g.moveTo(a[0], a[1]); g.lineTo(b[0], b[1]); g.stroke()
  g.fillStyle = MAG; const [rx, ry] = rel(DEST, 0); g.fillRect(rx - 3, ry - 3, 6, 6)
  g.fillStyle = '#ffe14d'; g.beginPath(); g.moveTo(cx, cy - 10); g.lineTo(cx - 7, cy + 6); g.lineTo(cx + 7, cy + 6); g.fill()
  g.fillStyle = GREEN; g.textAlign = 'left'; g.fillText(`GS ${Math.round(d.gs ?? 0)}  TAS ${Math.round(d.tas ?? 0)}`, 6, 14)
  g.fillStyle = WHITE; g.textAlign = 'right'; g.fillText(`${Math.max(0, (DEST - s.pos.x) / 1852).toFixed(1)} NM`, 250, 14)
}
const drawEWD: Draw = (g, s) => {
  g.fillStyle = '#05070a'; g.fillRect(0, 0, 256, 256)
  g.font = '13px monospace'; g.textAlign = 'center'
  s.n1.forEach((n, i) => {
    const cx = 70 + i * 116, cy = 70
    g.strokeStyle = '#3b4350'; g.lineWidth = 4; g.beginPath(); g.arc(cx, cy, 40, Math.PI * 0.8, Math.PI * 2.2); g.stroke()
    const a = Math.PI * 0.8 + (Math.min(105, n) / 105) * Math.PI * 1.4
    g.strokeStyle = GREEN; g.lineWidth = 3; g.beginPath(); g.moveTo(cx, cy); g.lineTo(cx + Math.cos(a) * 38, cy + Math.sin(a) * 38); g.stroke()
    g.fillStyle = s.eng[i].state === 'failed' ? '#ff4a3d' : GREEN; g.fillText(s.eng[i].state === 'failed' ? 'FAIL' : n.toFixed(1), cx, cy + 34)
    g.fillStyle = WHITE; g.font = '11px monospace'; g.fillText(`EGT ${Math.round(s.d.egt?.[i] ?? 0)}`, cx, cy + 56); g.font = '13px monospace'
  })
  g.fillStyle = CYAN; g.fillText(`FOB ${Math.round(s.fuel)} KG`, 128, 170)
  const c = confAt(s.srf.conf, s.spec.confs)
  g.fillStyle = WHITE; g.fillText(`S ${Math.round(c.slat)}  F ${Math.round(c.flap)}`, 128, 196)
  g.fillStyle = GREEN; g.fillText(s.spec.confs[Math.round(s.srf.conf)].id, 128, 220)
}
const drawSD: Draw = (g, s) => {
  g.fillStyle = '#05070a'; g.fillRect(0, 0, 256, 256)
  g.font = '12px monospace'; g.textAlign = 'center'; g.fillStyle = WHITE; g.fillText('WHEEL', 128, 20)
  const col = s.srf.gear > 0.99 ? GREEN : s.srf.gear > 0.01 ? '#ff4a3d' : '#3b4350'
  ;[[128, 70], [80, 140], [176, 140]].forEach(([x, y], i) => {
    g.fillStyle = s.dmg.legs[i] ? '#ff4a3d' : col; g.beginPath(); g.moveTo(x - 16, y - 10); g.lineTo(x + 16, y - 10); g.lineTo(x, y + 12); g.fill()
  })
  g.fillStyle = s.ctl.parkBrake ? AMBER : '#5b6573'; g.fillText(s.ctl.parkBrake ? 'PARK BRK' : 'BRK', 128, 196)
  g.fillStyle = GREEN; g.fillText(`GW ${(s.d.mass / 1000).toFixed(1)} T`, 128, 226)
}
function useDisplay(draw: Draw) {
  const { tex, ctx } = useMemo(() => {
    const c = document.createElement('canvas'); c.width = c.height = 256
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4
    return { tex: t, ctx: c.getContext('2d')! }
  }, [])
  const acc = useRef(0)
  useFrame((_, dt) => { acc.current += dt; if (acc.current > 0.08) { acc.current = 0; draw(ctx, FS.sim); tex.needsUpdate = true } })
  useEffect(() => () => tex.dispose(), [tex])
  return tex
}
function DU({ draw, position, rotation }: { draw: Draw; position: [number, number, number]; rotation: [number, number, number] }) {
  const tex = useDisplay(draw)
  return (
    <group position={position} rotation={rotation}>
      <mesh position={[0, 0, -0.006]}><boxGeometry args={[0.215, 0.215, 0.012]} /><meshStandardMaterial color="#1a1d22" roughness={0.6} /></mesh>
      <mesh><planeGeometry args={[0.18, 0.18]} /><meshBasicMaterial map={tex} toneMapped={false} /></mesh>
    </group>
  )
}

/* ------------------------------------------------------------------ the flight deck */
function lever(ref: React.RefObject<THREE.Group | null>, angle: number) { if (ref.current) ref.current.rotation.z = angle }
export function Cockpit() {
  const mats = useMemo(() => {
    const m = (p: THREE.MeshPhysicalMaterialParameters, fin?: 'paint' | 'rubber' | 'machined') => { const x = new THREE.MeshPhysicalMaterial(p); if (fin) applyFinish(x, fin); return x }
    const buttons = document.createElement('canvas'); buttons.width = buttons.height = 256
    const b = buttons.getContext('2d')!
    b.fillStyle = '#3a4048'; b.fillRect(0, 0, 256, 256)
    for (let y = 8; y < 256; y += 22) for (let x = 6; x < 256; x += 20) {
      b.fillStyle = '#1e2227'; b.fillRect(x, y, 14, 12)
      const r = Math.random(); if (r < 0.12) { b.fillStyle = '#e6ecef'; b.fillRect(x + 2, y + 2, 10, 3) } else if (r < 0.18) { b.fillStyle = '#ffb02e'; b.fillRect(x + 2, y + 7, 10, 3) }
    }
    b.strokeStyle = '#f2f4f6'; b.globalAlpha = 0.5; for (let y = 4; y < 256; y += 66) { b.strokeRect(3, y, 250, 60) }
    const bt = new THREE.CanvasTexture(buttons); bt.colorSpace = THREE.SRGBColorSpace
    return {
      shell: m({ color: '#56606b', roughness: 0.85, metalness: 0, side: THREE.BackSide }, 'paint'),
      panel: m({ color: '#4a5058', roughness: 0.7, metalness: 0.05 }, 'paint'),
      dark: m({ color: '#1c1f24', roughness: 0.6 }),
      glare: m({ color: '#22262c', roughness: 0.9 }, 'rubber'),
      seat: m({ color: '#2a2e35', roughness: 0.95, sheen: 0.6, sheenColor: new THREE.Color('#556070') }, 'rubber'),
      metal: m({ color: '#b8bfc6', roughness: 0.25, metalness: 0.9 }, 'machined'),
      grip: m({ color: '#121417', roughness: 0.7 }, 'rubber'),
      overhead: new THREE.MeshStandardMaterial({ map: bt, roughness: 0.6 }),
      // glass seen from inside: almost clear, faint green tint, strong grazing reflections
      glassIn: new THREE.MeshPhysicalMaterial({ color: '#d8efe6', transparent: true, opacity: 0.1, roughness: 0.03, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.02, envMapIntensity: 1.6, side: THREE.BackSide, depthWrite: false }),
      frame: m({ color: '#2d3238', roughness: 0.55, metalness: 0.2 }),
    }
  }, [])
  // interior shell: the fuselage skin seen from inside, with the window openings left out
  const shell = useMemo(() => {
    const pos: number[] = [], idx: number[] = []
    const NX = 60, NA = 96, x0 = 14.4, x1 = 18.9
    for (let i = 0; i <= NX; i++) for (let j = 0; j <= NA; j++) {
      const x = x0 + ((x1 - x0) * i) / NX, a = -Math.PI + (2 * Math.PI * j) / NA, r = fusR(x) - 0.06
      pos.push(x, fusY(x) + Math.cos(a) * r, Math.sin(a) * r)
    }
    for (let i = 0; i < NX; i++) for (let j = 0; j < NA; j++) {
      const xm = x0 + ((x1 - x0) * (i + 0.5)) / NX, am = -Math.PI + (2 * Math.PI * (j + 0.5)) / NA
      if (inPane(xm, am)) continue
      const p = i * (NA + 1) + j
      idx.push(p, p + 1, p + NA + 1, p + 1, p + NA + 2, p + NA + 1)
    }
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx); g.computeVertexNormals()
    return g
  }, [])
  const glassIn = useMemo(() => PANES.map(([a, b, c, d]) => surfacePatch(a, b, Math.min(c, d), Math.max(c, d), -0.03)), [])
  // window frames: thin posts around each pane
  const frames = useMemo(() => {
    const list: { p: THREE.Vector3; q: THREE.Quaternion; l: number }[] = []
    const P = (x: number, a: number) => { const r = fusR(x) - 0.045; return new THREE.Vector3(x, fusY(x) + Math.cos(a) * r, Math.sin(a) * r) }
    for (const [x0, x1, a0, a1] of PANES) {
      const edges: [THREE.Vector3, THREE.Vector3][] = [[P(x0, a0), P(x1, a0)], [P(x0, a1), P(x1, a1)], [P(x0, a0), P(x0, a1)], [P(x1, a0), P(x1, a1)]]
      for (const [u, v] of edges) {
        const dir = v.clone().sub(u); const l = dir.length()
        list.push({ p: u.clone().add(v).multiplyScalar(0.5), q: new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize()), l })
      }
    }
    return list
  }, [])
  const thr = useRef<THREE.Group>(null), thr2 = useRef<THREE.Group>(null), flapL = useRef<THREE.Group>(null), sbL = useRef<THREE.Group>(null)
  const stickC = useRef<THREE.Group>(null), stickF = useRef<THREE.Group>(null)
  useFrame(() => {
    const c = FS.sim.ctl
    const la = 0.55 - c.lever * 0.9 - (c.rev ? -0.35 : 0) // levers swing forward with thrust
    lever(thr, la); lever(thr2, la)
    lever(flapL, 0.4 - (c.flapLever / 4) * 0.8)
    lever(sbL, 0.3 - c.speedbrake * 0.6)
    for (const st of [stickC.current, stickF.current]) if (st) { st.rotation.z = -c.stickY * 0.28; st.rotation.x = c.stickX * 0.28 }
  })
  // displays: tilted panel facing the pilots
  const panelX = 17.18
  return (
    <group>
      <mesh geometry={shell} material={mats.shell} />
      {glassIn.map((g, i) => <mesh key={i} geometry={g} material={mats.glassIn} renderOrder={5} />)}
      {frames.map((f, i) => <mesh key={i} position={f.p} quaternion={f.q} material={mats.frame}><boxGeometry args={[0.035, f.l, 0.03]} /></mesh>)}
      {/* floor */}
      <mesh position={[16.4, 3.0, 0]} rotation-x={-Math.PI / 2} material={mats.dark}><planeGeometry args={[3.6, 2.6]} /></mesh>
      {/* main instrument panel, leaning away from the pilots, with the display units on its face */}
      <group position={[panelX, 3.52, 0]} rotation={[0, 0, -0.22]}>
        <mesh position={[0.04, 0, 0]} material={mats.panel}><boxGeometry args={[0.06, 0.46, 2.5]} /></mesh>
        {[[-0.86, drawPFD], [-0.6, drawND], [0.6, drawND], [0.86, drawPFD]].map(([z, dr], i) => <DU key={i} draw={dr as Draw} position={[0.0, 0.02, z as number]} rotation={[0, -Math.PI / 2, 0]} />)}
        <DU draw={drawEWD} position={[0.0, 0.05, 0]} rotation={[0, -Math.PI / 2, 0]} />
      </group>
      {/* glareshield with the FCU (autopilot control unit) */}
      <mesh position={[panelX - 0.07, 3.8, 0]} material={mats.glare}><boxGeometry args={[0.36, 0.06, 2.5]} /></mesh>
      <mesh position={[panelX - 0.25, 3.795, 0]} material={mats.dark}><boxGeometry args={[0.07, 0.06, 1.3]} /></mesh>
      <pointLight position={[16.4, 4.3, 0]} intensity={0.6} distance={3} color="#ffe9cc" />
      {/* pedestal */}
      <mesh position={[16.4, 3.25, 0]} material={mats.panel}><boxGeometry args={[1.25, 0.42, 0.5]} /></mesh>
      <group position={[16.98, 3.4, 0]} rotation={[0, 0, -0.9]}>
        <mesh position={[0.03, 0, 0]} material={mats.panel}><boxGeometry args={[0.05, 0.36, 0.5]} /></mesh>
        <DU draw={drawSD} position={[0, 0, 0]} rotation={[0, -Math.PI / 2, 0]} />
      </group>
      {/* thrust levers */}
      {[-0.07, 0.07].map((z, i) => (
        <group key={z} position={[16.3, 3.47, z]} ref={i ? thr2 : thr}>
          <mesh position={[0, 0.12, 0]} material={mats.metal}><boxGeometry args={[0.025, 0.24, 0.03]} /></mesh>
          <mesh position={[0, 0.25, 0]} material={mats.grip}><boxGeometry args={[0.07, 0.05, 0.045]} /></mesh>
        </group>
      ))}
      <group position={[16.25, 3.47, 0.2]} ref={flapL}><mesh position={[0, 0.09, 0]} material={mats.metal}><boxGeometry args={[0.02, 0.18, 0.02]} /></mesh><mesh position={[0, 0.19, 0]} material={mats.grip}><boxGeometry args={[0.06, 0.03, 0.05]} /></mesh></group>
      <group position={[16.25, 3.47, -0.2]} ref={sbL}><mesh position={[0, 0.08, 0]} material={mats.metal}><boxGeometry args={[0.02, 0.16, 0.02]} /></mesh><mesh position={[0, 0.17, 0]} material={mats.dark}><boxGeometry args={[0.05, 0.03, 0.04]} /></mesh></group>
      {/* side consoles with sidesticks */}
      {[-1, 1].map((sd) => (
        <group key={sd}>
          <mesh position={[16.35, 3.38, sd * 1.12]} material={mats.panel}><boxGeometry args={[1.1, 0.3, 0.32]} /></mesh>
          <group position={[16.55, 3.54, sd * 1.12]} ref={sd < 0 ? stickC : stickF}>
            <mesh position={[0, 0.06, 0]} rotation={[0, 0, 0.25]} material={mats.grip}><cylinderGeometry args={[0.02, 0.025, 0.14, 12]} /></mesh>
            <mesh position={[0.02, 0.14, 0]} material={mats.dark}><boxGeometry args={[0.03, 0.02, 0.03]} /></mesh>
          </group>
        </group>
      ))}
      {/* seats */}
      {[-0.52, 0.52].map((z) => (
        <group key={z} position={[15.95, 3.0, z]}>
          <mesh position={[0, 0.45, 0]} material={mats.seat}><boxGeometry args={[0.5, 0.12, 0.5]} /></mesh>
          <mesh position={[-0.26, 0.9, 0]} rotation={[0, 0, 0.12]} material={mats.seat}><boxGeometry args={[0.12, 0.85, 0.5]} /></mesh>
          <mesh position={[-0.3, 1.42, 0]} material={mats.seat}><boxGeometry args={[0.1, 0.22, 0.3]} /></mesh>
          <mesh position={[0, 0.2, 0]} material={mats.metal}><cylinderGeometry args={[0.05, 0.08, 0.4, 12]} /></mesh>
        </group>
      ))}
      {/* overhead panel */}
      <mesh position={[16.3, 4.48, 0]} rotation={[0, 0, 0.35]} material={mats.overhead}><boxGeometry args={[1.3, 0.04, 0.9]} /></mesh>
    </group>
  )
}

/** eye point of the captain (drawing frame) and look offsets driven by the mouse */
export const EYE: [number, number, number] = [16.45, 4.12, -0.52]
export const LOOK = { yaw: 0, pitch: -12 * DEG }
