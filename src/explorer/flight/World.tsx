import { useEffect, useMemo, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { Sky, Environment } from '@react-three/drei'
import * as THREE from 'three'
import { glowSprite } from '../../utils/geom'
import { AIM, DEST, GS_ANGLE, RWY, AC } from './fdm'
import { FS, useFlight } from './state'
import { AIRPORTS, STAND_STOP, TERMINAL_Z, type Airport as AirportDef } from './airports'

/*
 * The world is drawn around a floating origin: the aircraft always sits at x = z = 0 and the world
 * group is shifted by −position every frame, so 80 km of terrain never costs float precision.
 */
export const SUN = new THREE.Vector3(-0.42, 0.62, 0.66).normalize()
const HAZE = '#c3d3e4'

function rng(seed: number) {
  return () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296 }
}
function canvas(w: number, h: number, draw: (g: CanvasRenderingContext2D) => void, repeat = true) {
  const c = document.createElement('canvas'); c.width = w; c.height = h
  draw(c.getContext('2d')!)
  const t = new THREE.CanvasTexture(c)
  t.colorSpace = THREE.SRGBColorSpace
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping
  t.anisotropy = 8
  return t
}
function noise(g: CanvasRenderingContext2D, w: number, h: number, n: number, a: number, r: () => number, light = false) {
  for (let i = 0; i < n; i++) { const v = light ? 255 : 0; g.fillStyle = `rgba(${v},${v},${v},${r() * a})`; g.fillRect(r() * w, r() * h, 1 + r() * 2, 1 + r() * 2) }
}

/* ------------------------------------------------------------------ sky, sun, environment reflections */
function SkyAndLight() {
  const { scene } = useThree()
  const sun = useRef<THREE.DirectionalLight>(null!)
  const quality = useFlight((s) => s.cam) // re-render not needed; just keep hook order stable
  void quality
  useEffect(() => {
    scene.fog = new THREE.FogExp2(HAZE, 0.000038)
    return () => { scene.fog = null }
  }, [scene])
  useFrame(() => {
    const y = FS.sim.pos.y
    sun.current.position.set(SUN.x * 300, y + SUN.y * 300, SUN.z * 300)
    sun.current.target.position.set(0, y, 0)
    sun.current.target.updateMatrixWorld()
  })
  const sunPos: [number, number, number] = [SUN.x * 1000, SUN.y * 1000, SUN.z * 1000]
  return (
    <>
      <Sky distance={450000} sunPosition={sunPos} turbidity={4.5} rayleigh={1.1} mieCoefficient={0.004} mieDirectionalG={0.82} />
      <Environment resolution={256} frames={1} environmentIntensity={0.6}>
        <Sky distance={450000} sunPosition={sunPos} turbidity={4.5} rayleigh={1.1} mieCoefficient={0.004} mieDirectionalG={0.82} />
        <mesh rotation-x={-Math.PI / 2} position={[0, -40, 0]} scale={2000}><planeGeometry /><meshBasicMaterial color="#5d6b4f" /></mesh>
      </Environment>
      <hemisphereLight args={['#bcd4f2', '#4d5642', 0.45]} />
      <directionalLight ref={sun} intensity={2.3} color="#fff0d8" castShadow
        shadow-mapSize={[4096, 4096]} shadow-bias={-0.0002} shadow-normalBias={0.04}
        shadow-camera-left={-42} shadow-camera-right={42} shadow-camera-top={42} shadow-camera-bottom={-42} shadow-camera-near={10} shadow-camera-far={700} />
    </>
  )
}

/* ------------------------------------------------------------------ ground: farmland patchwork that scrolls under the aircraft */
const TILE = 2400
function Ground() {
  const tex = useMemo(() => canvas(2048, 2048, (g) => {
    const r = rng(7)
    g.fillStyle = '#6f7f4c'; g.fillRect(0, 0, 2048, 2048)
    const fields = ['#7b8a4f', '#8d9354', '#6a7a45', '#a39a5f', '#5f7342', '#8c8a57', '#768a52', '#9a9d63', '#62703f', '#b0a46a']
    // patchwork of fields with slightly rotated rows
    for (let i = 0; i < 260; i++) {
      const w = 80 + r() * 260, h = 60 + r() * 220, x = r() * 2048, y = r() * 2048
      g.save(); g.translate(x, y); g.rotate((r() - 0.5) * 0.25)
      g.fillStyle = fields[Math.floor(r() * fields.length)]; g.fillRect(-w / 2, -h / 2, w, h)
      g.globalAlpha = 0.12; g.strokeStyle = '#3e4a2c'
      for (let k = -h / 2; k < h / 2; k += 5) { g.beginPath(); g.moveTo(-w / 2, k); g.lineTo(w / 2, k); g.stroke() }
      g.restore(); g.globalAlpha = 1
    }
    // woods
    for (let i = 0; i < 120; i++) { g.fillStyle = `rgba(${40 + r() * 15},${58 + r() * 15},${32 + r() * 10},0.9)`; g.beginPath(); g.ellipse(r() * 2048, r() * 2048, 20 + r() * 90, 15 + r() * 70, r() * 3, 0, 7); g.fill() }
    // country roads
    g.strokeStyle = 'rgba(170,160,140,0.8)'; g.lineWidth = 3
    for (let i = 0; i < 9; i++) { g.beginPath(); g.moveTo(r() * 2048, 0); g.bezierCurveTo(r() * 2048, 700, r() * 2048, 1300, r() * 2048, 2048); g.stroke() }
    noise(g, 2048, 2048, 90000, 0.12, r)
  }), [])
  const mat = useMemo(() => {
    const m = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.97, metalness: 0 })
    // a second, much larger sample of the same texture breaks the tiling seen from altitude
    m.onBeforeCompile = (sh) => {
      sh.fragmentShader = sh.fragmentShader.replace('#include <map_fragment>', `#include <map_fragment>
        vec3 macro = texture2D(map, vMapUv * 0.083 + 0.31).rgb;
        diffuseColor.rgb *= 0.72 + 0.56 * macro.g;
        // close-up grain: the same texture at ~40x frequency reads as grass and soil
        float fine = texture2D(map, vMapUv * 41.0).g;
        diffuseColor.rgb *= 0.86 + 0.28 * fine;`)
    }
    return m
  }, [tex])
  const SIZE = 180000
  tex.repeat.set(SIZE / TILE, SIZE / TILE)
  useFrame(() => {
    tex.offset.set(FS.sim.pos.x / TILE, -FS.sim.pos.z / TILE)
  })
  // concentric rings: small triangles near the aircraft keep depth precise, big ones far away keep the count low
  const geo = useMemo(() => {
    const radii = [0, 25, 60, 120, 250, 500, 1000, 2000, 4000, 8000, 16000, 32000, 60000, SIZE / 2]
    const A = 72, pos: number[] = [], uv: number[] = [], idx: number[] = []
    radii.forEach((r) => { for (let j = 0; j <= A; j++) { const a = (j / A) * Math.PI * 2, x = Math.cos(a) * r, z = Math.sin(a) * r; pos.push(x, 0, z); uv.push(x / SIZE + 0.5, -z / SIZE + 0.5) } })
    for (let i = 0; i < radii.length - 1; i++) for (let j = 0; j < A; j++) { const p = i * (A + 1) + j, q = p + A + 1; idx.push(p, p + 1, q, p + 1, q + 1, q) }
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setIndex(idx); g.computeVertexNormals()
    return g
  }, [])
  return <mesh geometry={geo} position={[0, -0.12, 0]} receiveShadow material={mat} />
}

/* ------------------------------------------------------------------ runway with markings, lights, PAPI */
function useInstances(geo: THREE.BufferGeometry, mat: THREE.Material, list: [number, number, number, number, number][]) {
  // [x, y, z, length (x), width (z)]
  return useMemo(() => {
    const im = new THREE.InstancedMesh(geo, mat, list.length)
    const o = new THREE.Object3D()
    list.forEach(([x, y, z, l, w], i) => { o.position.set(x, y, z); o.scale.set(l, 1, w); o.updateMatrix(); im.setMatrixAt(i, o.matrix) })
    im.receiveShadow = true
    return im
  }, [geo, mat, list])
}
function Runway({ x0, approachLights }: { x0: number; approachLights?: boolean }) {
  const asphalt = useMemo(() => {
    const t = canvas(512, 512, (g) => {
      const r = rng(3)
      g.fillStyle = '#3d3f42'; g.fillRect(0, 0, 512, 512)
      noise(g, 512, 512, 40000, 0.25, r); noise(g, 512, 512, 20000, 0.12, r, true)
      g.fillStyle = 'rgba(20,20,22,0.35)'
      for (let i = 0; i < 5; i++) g.fillRect(0, 150 + r() * 200, 512, 6 + r() * 12) // rubber deposits
    })
    t.repeat.set(RWY.len / 60, 1)
    return t
  }, [])
  const rwMat = useMemo(() => new THREE.MeshStandardMaterial({ map: asphalt, roughness: 0.92, polygonOffset: true, polygonOffsetFactor: -1 }), [asphalt])
  const paint = useMemo(() => new THREE.MeshStandardMaterial({ color: '#f1f1ec', roughness: 0.75, polygonOffset: true, polygonOffsetFactor: -2 }), [])
  const quad = useMemo(() => { const g = new THREE.PlaneGeometry(1, 1); g.rotateX(-Math.PI / 2); return g }, [])
  const marks = useMemo(() => {
    const L: [number, number, number, number, number][] = []
    const y = 0.11
    for (let i = 0; i < 8; i++) { const z = 3 + i * 2.4; L.push([x0 + 21, y, z, 30, 1.8], [x0 + 21, y, -z, 30, 1.8]) } // threshold "piano keys"
    for (let x = 120; x < RWY.len - 120; x += 50) L.push([x0 + x, y, 0, 30, 0.9]) // centreline
    L.push([x0 + RWY.len / 2, y, 21.6, RWY.len, 0.9], [x0 + RWY.len / 2, y, -21.6, RWY.len, 0.9]) // edge stripes
    L.push([x0 + 322, y, 9.5, 45, 7], [x0 + 322, y, -9.5, 45, 7]) // aiming point
    for (const [d, n] of [[150, 3], [450, 2], [600, 2], [750, 1], [900, 1]] as const) for (let k = 0; k < n; k++) { const z = 6 + k * 3; L.push([x0 + d + 11, y, z, 22, 1.8], [x0 + d + 11, y, -z, 22, 1.8]) } // touchdown zone
    return L
  }, [x0])
  const markMesh = useInstances(quad, paint, marks)
  const number = useMemo(() => canvas(256, 128, (g) => { g.fillStyle = '#f1f1ec'; g.font = 'bold 110px Arial'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('09', 128, 66) }, false), [])
  // lights: edge (white), threshold (green), end (red), approach lighting
  const lights = useMemo(() => {
    const pts: { p: THREE.Vector3; c: THREE.Color }[] = []
    const W = new THREE.Color('#fff4d8'), Gr = new THREE.Color('#52ff7a'), R = new THREE.Color('#ff3b2e')
    for (let x = 0; x <= RWY.len; x += 60) { pts.push({ p: new THREE.Vector3(x0 + x, 0.35, 23.5), c: W }, { p: new THREE.Vector3(x0 + x, 0.35, -23.5), c: W }) }
    for (let z = -21; z <= 21; z += 3) { pts.push({ p: new THREE.Vector3(x0 - 1, 0.35, z), c: Gr }, { p: new THREE.Vector3(x0 + RWY.len + 1, 0.35, z), c: R }) }
    if (approachLights) for (let d = 30; d <= 900; d += 30) for (let k = -2; k <= 2; k++) pts.push({ p: new THREE.Vector3(x0 - d, 1.2, k * 1.1), c: W })
    if (approachLights) for (let k = -7; k <= 7; k++) if (Math.abs(k) > 2) pts.push({ p: new THREE.Vector3(x0 - 300, 1.2, k * 1.6), c: W })
    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pts.flatMap(({ p }) => [p.x, p.y, p.z]), 3))
    geo.setAttribute('color', new THREE.Float32BufferAttribute(pts.flatMap(({ c }) => [c.r, c.g, c.b]), 3))
    const m = new THREE.PointsMaterial({ size: 2.2, map: glowSprite(), vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, sizeAttenuation: true })
    return new THREE.Points(geo, m)
  }, [x0, approachLights])
  return (
    <group>
      <mesh position={[x0 + RWY.len / 2, 0.06, 0]} rotation-x={-Math.PI / 2} material={rwMat} receiveShadow>
        <planeGeometry args={[RWY.len, RWY.width]} />
      </mesh>
      {/* shoulders */}
      <mesh position={[x0 + RWY.len / 2, 0.0, 0]} rotation-x={-Math.PI / 2} receiveShadow>
        <planeGeometry args={[RWY.len + 120, RWY.width + 16]} />
        <meshStandardMaterial color="#6d6f6a" roughness={0.95} polygonOffset polygonOffsetFactor={-0.5} />
      </mesh>
      <primitive object={markMesh} />
      <mesh position={[x0 + 62, 0.11, 0]} rotation={[-Math.PI / 2, 0, -Math.PI / 2]}>
        <planeGeometry args={[18, 9]} />
        <meshStandardMaterial map={number} transparent roughness={0.75} polygonOffset polygonOffsetFactor={-2} />
      </mesh>
      <primitive object={lights} />
    </group>
  )
}

/** PAPI: four lights left of the aiming point; white above their angle, red below */
function Papi() {
  const refs = useRef<THREE.Sprite[]>([])
  const mats = useMemo(() => [0, 1, 2, 3].map(() => new THREE.SpriteMaterial({ map: glowSprite(), color: '#ffffff', transparent: true, depthWrite: false, blending: THREE.AdditiveBlending })), [])
  const angles = [3.5, 3.17, 2.83, 2.5].map((a) => (a * Math.PI) / 180) // outer unit first
  useFrame(() => {
    const s = FS.sim
    const eyeY = s.pos.y + 1.5, dx = AIM - s.pos.x
    const ang = Math.atan2(eyeY, Math.max(1, dx))
    mats.forEach((m, i) => m.color.set(ang > angles[i] ? '#fff6e8' : '#ff2a1a'))
  })
  return (
    <group>
      {mats.map((m, i) => (
        <group key={i} position={[AIM, 1, -(RWY.width / 2 + 15 + i * 9)]}>
          <mesh position={[0, -0.4, 0]}><boxGeometry args={[1.2, 0.8, 2.2]} /><meshStandardMaterial color="#d9d3bf" roughness={0.6} /></mesh>
          <sprite ref={(o) => { if (o) refs.current[i] = o }} material={m} scale={5} />
        </group>
      ))}
    </group>
  )
}

/* ------------------------------------------------------------------ airport buildings, forests, villages */
function Airport({ ap }: { ap: AirportDef }) {
  const x0 = ap.x0
  const mats = useMemo(() => {
    const asphalt = canvas(256, 256, (g) => { const r = rng(17); g.fillStyle = '#4a4c4f'; g.fillRect(0, 0, 256, 256); noise(g, 256, 256, 14000, 0.25, r); noise(g, 256, 256, 6000, 0.1, r, true) })
    asphalt.repeat.set(1, 1)
    const conc = canvas(256, 256, (g) => {
      const r = rng(23); g.fillStyle = '#9a9b97'; g.fillRect(0, 0, 256, 256); noise(g, 256, 256, 9000, 0.12, r)
      g.strokeStyle = 'rgba(60,60,58,0.5)'; g.lineWidth = 1; for (let i = 0; i <= 256; i += 64) { g.beginPath(); g.moveTo(i, 0); g.lineTo(i, 256); g.stroke(); g.beginPath(); g.moveTo(0, i); g.lineTo(256, i); g.stroke() } // slab joints
      g.fillStyle = 'rgba(30,30,30,0.18)'; for (let i = 0; i < 5; i++) { g.beginPath(); g.ellipse(r() * 256, r() * 256, 10 + r() * 30, 6 + r() * 14, r() * 3, 0, 7); g.fill() } // oil stains
    })
    return {
      taxi: new THREE.MeshStandardMaterial({ map: asphalt, roughness: 0.92, polygonOffset: true, polygonOffsetFactor: -1 }),
      apron: new THREE.MeshStandardMaterial({ map: conc, roughness: 0.88, polygonOffset: true, polygonOffsetFactor: -1 }),
      yellow: new THREE.MeshStandardMaterial({ color: '#e8b923', roughness: 0.7, polygonOffset: true, polygonOffsetFactor: -3 }),
      glass: new THREE.MeshPhysicalMaterial({ color: '#2f4458', roughness: 0.06, metalness: 0.5, clearcoat: 1 }),
      wall: new THREE.MeshStandardMaterial({ color: '#d9d7d0', roughness: 0.7 }),
      roof: new THREE.MeshStandardMaterial({ color: '#7f868d', roughness: 0.5, metalness: 0.6 }),
      bridge: new THREE.MeshStandardMaterial({ color: '#b8bcc0', roughness: 0.45, metalness: 0.5 }),
      board: new THREE.MeshBasicMaterial({ color: '#ffcf3a' }),
    }
  }, [])
  const quad = useMemo(() => { const g = new THREE.PlaneGeometry(1, 1); g.rotateX(-Math.PI / 2); return g }, [])
  // paved areas (runway is drawn separately)
  const paved = ap.rects.filter((r) => r.kind !== 'runway')
  // yellow centrelines, stop bars and runway-holding positions as one instanced mesh
  const lines = useMemo(() => {
    const L: [number, number, number, number, number, number][] = [] // x, z, length, width, angle
    for (const pl of ap.taxiCentre) for (let i = 0; i < pl.length - 1; i++) {
      const [ax, az] = pl[i], [bx, bz] = pl[i + 1]
      L.push([(ax + bx) / 2, (az + bz) / 2, Math.hypot(bx - ax, bz - az), 0.35, -Math.atan2(bz - az, bx - ax), 0])
    }
    for (const st of ap.stands) L.push([st.x, STAND_STOP, 7, 0.5, 0, 0]) // stop line across the lead-in
    for (const x of [30, 1500, 2950]) for (const dz of [-62, -63, -65, -66]) L.push([x0 + x, dz, 23, 0.3, 0, 0]) // holding position
    const im = new THREE.InstancedMesh(quad, mats.yellow, L.length), o = new THREE.Object3D()
    L.forEach(([x, z, l, w, a], i) => { o.position.set(x - x0, 0.1, z); o.rotation.set(0, a, 0); o.scale.set(l, 1, w); o.updateMatrix(); im.setMatrixAt(i, o.matrix) })
    im.receiveShadow = true
    return im
  }, [ap, quad, mats, x0])
  // taxiway edge lights (blue) and centreline lights (green)
  const lights = useMemo(() => {
    const pos: number[] = [], col: number[] = []
    const B = new THREE.Color('#3d7bff'), Gn = new THREE.Color('#3dff8a')
    for (const r of paved.filter((q) => q.kind === 'taxiway')) {
      const along = r.x1 - r.x0 > r.z1 - r.z0
      if (along) for (let x = r.x0; x <= r.x1; x += 40) { pos.push(x - x0, 0.3, r.z0 - 1, x - x0, 0.3, r.z1 + 1); col.push(B.r, B.g, B.b, B.r, B.g, B.b) }
      else for (let z = r.z0; z <= r.z1; z += 40) { pos.push(r.x0 - 1 - x0, 0.3, z, r.x1 + 1 - x0, 0.3, z); col.push(B.r, B.g, B.b, B.r, B.g, B.b) }
    }
    for (const pl of ap.taxiCentre) for (let i = 0; i < pl.length - 1; i++) {
      const [ax, az] = pl[i], [bx, bz] = pl[i + 1], n = Math.floor(Math.hypot(bx - ax, bz - az) / 15)
      for (let k = 0; k <= n; k++) { pos.push(ax + ((bx - ax) * k) / n - x0, 0.12, az + ((bz - az) * k) / n); col.push(Gn.r, Gn.g, Gn.b) }
    }
    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3))
    return new THREE.Points(geo, new THREE.PointsMaterial({ size: 1.3, map: glowSprite(), vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }))
  }, [ap, paved, x0])
  const standNumber = (id: string) => canvas(128, 128, (g) => { g.fillStyle = '#e8b923'; g.font = 'bold 96px Arial'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(id, 64, 68) }, false)
  return (
    <group position={[x0, 0, 0]}>
      {paved.map((r, i) => (
        <mesh key={i} position={[(r.x0 + r.x1) / 2 - x0, r.kind === 'apron' ? 0.03 : 0.045, (r.z0 + r.z1) / 2]} rotation-x={-Math.PI / 2} material={r.kind === 'apron' ? mats.apron : mats.taxi} receiveShadow>
          <planeGeometry args={[r.x1 - r.x0, r.z1 - r.z0]} />
        </mesh>
      ))}
      <primitive object={lines} />
      <primitive object={lights} />
      {ap.stands.map((st) => (
        <group key={st.id}>
          <mesh position={[st.x - x0 + 4.5, 0.1, STAND_STOP + 8]} rotation-x={-Math.PI / 2}><planeGeometry args={[5, 5]} /><meshStandardMaterial map={standNumber(st.id)} transparent polygonOffset polygonOffsetFactor={-3} /></mesh>
          {/* jet bridge from the terminal to the forward left door */}
          <JetBridge from={[st.x - x0 - 14, TERMINAL_Z + 2]} to={[st.x - x0 - 3.2, STAND_STOP + 8]} mat={mats.bridge} />
          {/* docking guidance board on the terminal facade */}
          <mesh position={[st.x - x0, 9, TERMINAL_Z + 0.6]} material={mats.board}><boxGeometry args={[2.2, 1.1, 0.2]} /></mesh>
        </group>
      ))}
      {/* terminal */}
      <mesh position={[1450, 10, TERMINAL_Z - 35]} material={mats.wall} castShadow receiveShadow><boxGeometry args={[900, 20, 70]} /></mesh>
      <mesh position={[1450, 11, TERMINAL_Z - 0.2]} material={mats.glass}><boxGeometry args={[880, 12, 0.8]} /></mesh>
      <mesh position={[1450, 20.6, TERMINAL_Z - 35]} material={mats.roof} castShadow><boxGeometry args={[915, 1.2, 78]} /></mesh>
      {[600, 2400].map((x) => (
        <group key={x} position={[x, 0, -420]}>
          <mesh position={[0, 9, 0]} material={mats.wall} castShadow receiveShadow><boxGeometry args={[110, 18, 70]} /></mesh>
          <mesh position={[0, 18, 0]} rotation={[Math.PI / 2, 0, 0]} scale={[1, 1, 0.22]} material={mats.roof} castShadow><cylinderGeometry args={[55, 55, 70, 32, 1, false, -Math.PI / 2, Math.PI]} /></mesh>
        </group>
      ))}
      <group position={[2300, 0, -300]}>
        <mesh position={[0, 22, 0]} material={mats.wall} castShadow><cylinderGeometry args={[3.5, 5, 44, 20]} /></mesh>
        <mesh position={[0, 47, 0]} material={mats.glass} castShadow><cylinderGeometry args={[8, 6.5, 6, 12]} /></mesh>
        <mesh position={[0, 50.6, 0]} material={mats.roof}><cylinderGeometry args={[8.6, 8.6, 1.2, 12]} /></mesh>
      </group>
    </group>
  )
}
function JetBridge({ from, to, mat }: { from: [number, number]; to: [number, number]; mat: THREE.Material }) {
  const dx = to[0] - from[0], dz = to[1] - from[1], len = Math.hypot(dx, dz)
  return (
    <group position={[(from[0] + to[0]) / 2, 0, (from[1] + to[1]) / 2]} rotation={[0, -Math.atan2(dz, dx), 0]}>
      <mesh position={[0, 4.6, 0]} material={mat} castShadow><boxGeometry args={[len, 2.8, 2.6]} /></mesh>
      <mesh position={[len / 2 - 6, 1.6, 0]} material={mat}><boxGeometry args={[0.6, 3.2, 0.6]} /></mesh>
      <mesh position={[len / 2 - 6, 0.4, 0]} material={mat}><boxGeometry args={[1.6, 0.8, 2.8]} /></mesh>
    </group>
  )
}

function Forests() {
  const trees = useMemo(() => {
    const r = rng(11)
    const geo = new THREE.ConeGeometry(1, 1, 7); geo.translate(0, 0.5, 0)
    const mat = new THREE.MeshStandardMaterial({ color: '#2f4527', roughness: 1 })
    const N = 5200
    const im = new THREE.InstancedMesh(geo, mat, N)
    const o = new THREE.Object3D(), c = new THREE.Color()
    let n = 0
    const clusters: [number, number][] = []
    for (let i = 0; i < 90; i++) clusters.push([(r() < 0.5 ? 0 : DEST) + (r() - 0.3) * 7000, (r() - 0.5) * 9000])
    while (n < N) {
      const [cx, cz] = clusters[Math.floor(r() * clusters.length)]
      const x = cx + (r() - 0.5) * 700, z = cz + (r() - 0.5) * 700
      if (Math.abs(z) < 320 && ((x > -1400 && x < RWY.len + 400) || (x > DEST - 1400 && x < DEST + RWY.len + 400))) continue
      if (z < -150 && z > -700 && ((x > 0 && x < RWY.len) || (x > DEST && x < DEST + RWY.len))) continue
      const h = 9 + r() * 14
      o.position.set(x, 0, z); o.scale.set(h * 0.28, h, h * 0.28); o.rotation.y = r() * 6; o.updateMatrix()
      im.setMatrixAt(n, o.matrix); im.setColorAt(n, c.setHSL(0.27 + r() * 0.06, 0.35, 0.16 + r() * 0.08)); n++
    }
    im.castShadow = false; im.receiveShadow = false
    return im
  }, [])
  const houses = useMemo(() => {
    const r = rng(5)
    const geo = new THREE.BoxGeometry(1, 1, 1); geo.translate(0, 0.5, 0)
    const mat = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.8 })
    const N = 900, im = new THREE.InstancedMesh(geo, mat, N), o = new THREE.Object3D(), c = new THREE.Color()
    const roofs = ['#8e3b2c', '#6f6a64', '#9b5136', '#55606b']
    for (let i = 0; i < N; i++) {
      const v = Math.floor(i / 60), vr = rng(100 + v)
      const vx = (v % 2 ? DEST : 0) + (vr() - 0.2) * 9000, vz = (vr() < 0.5 ? -1 : 1) * (1500 + vr() * 4000)
      o.position.set(vx + (r() - 0.5) * 400, 0, vz + (r() - 0.5) * 400); o.scale.set(9 + r() * 8, 5 + r() * 4, 8 + r() * 6); o.rotation.y = r() * 3; o.updateMatrix()
      im.setMatrixAt(i, o.matrix); im.setColorAt(i, c.set(r() < 0.6 ? '#e2ddd2' : roofs[Math.floor(r() * roofs.length)]))
    }
    return im
  }, [])
  return <group><primitive object={trees} /><primitive object={houses} /></group>
}

/* ------------------------------------------------------------------ clouds: soft billboard puffs */
function Clouds() {
  const tex = useMemo(() => canvas(256, 256, (g) => {
    const r = rng(9)
    for (let i = 0; i < 26; i++) {
      const x = 60 + r() * 136, y = 80 + r() * 100, rad = 30 + r() * 60
      const gr = g.createRadialGradient(x, y, 0, x, y, rad)
      gr.addColorStop(0, 'rgba(255,255,255,0.55)'); gr.addColorStop(1, 'rgba(255,255,255,0)')
      g.fillStyle = gr; g.fillRect(0, 0, 256, 256)
    }
  }, false), [])
  const group = useMemo(() => {
    const r = rng(21), grp = new THREE.Group()
    const mats = [0, 1, 2].map((i) => new THREE.SpriteMaterial({ map: tex, color: new THREE.Color().setHSL(0.6, 0.15, 0.92 - i * 0.06), transparent: true, depthWrite: false, fog: true, opacity: 0.9 }))
    for (let c = 0; c < 150; c++) {
      const cx = -15000 + r() * 125000, cz = (r() - 0.5) * 30000, cy = 1500 + r() * 1300
      for (let k = 0; k < 8; k++) {
        const s = new THREE.Sprite(mats[Math.floor(r() * 3)])
        const sc = 160 + r() * 260
        s.position.set(cx + (r() - 0.5) * 520, cy + (r() - 0.3) * 90, cz + (r() - 0.5) * 360)
        s.scale.set(sc * 1.6, sc, 1)
        grp.add(s)
      }
    }
    return grp
  }, [tex])
  return <primitive object={group} />
}

/* ------------------------------------------------------------------ distant hills on the horizon */
function Hills() {
  const geo = useMemo(() => {
    const r = rng(4), N = 360, R0 = 52000, pos: number[] = [], idx: number[] = []
    const hs: number[] = []
    let h = 600
    for (let i = 0; i <= N; i++) { h = Math.max(150, Math.min(2200, h + (r() - 0.5) * 380)); hs.push(h) }
    hs[N] = hs[0]
    for (let i = 0; i <= N; i++) {
      const a = (i / N) * Math.PI * 2
      pos.push(Math.cos(a) * R0, -60, Math.sin(a) * R0, Math.cos(a) * (R0 + 4000), hs[i], Math.sin(a) * (R0 + 4000))
      if (i < N) { const b = i * 2; idx.push(b, b + 1, b + 2, b + 1, b + 3, b + 2) }
    }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx); g.computeVertexNormals()
    return g
  }, [])
  const ref = useRef<THREE.Mesh>(null!)
  useFrame(() => { ref.current.position.y = 0 })
  return <mesh ref={ref} geometry={geo}><meshStandardMaterial color="#56664f" roughness={1} side={THREE.DoubleSide} /></mesh>
}

/* ------------------------------------------------------------------ glide-path gates (training aid) */
function GlidePath() {
  const on = useFlight((s) => s.path)
  const group = useMemo(() => {
    const grp = new THREE.Group()
    const m = new THREE.MeshBasicMaterial({ color: '#ff4fd8', transparent: true, opacity: 0.55, depthWrite: false, fog: false })
    const bar = (w: number, h: number) => new THREE.BoxGeometry(0.6, h, w)
    const W = 46, Hh = 26
    for (let d = 600; d <= 22000; d += 900) {
      const y = Math.tan(GS_ANGLE) * d + AC.cgLayout.y
      const g = new THREE.Group(); g.position.set(AIM - d, y, 0)
      const top = new THREE.Mesh(bar(W, 0.6), m); top.position.y = Hh / 2
      const bot = new THREE.Mesh(bar(W, 0.6), m); bot.position.y = -Hh / 2
      const l = new THREE.Mesh(bar(0.6, Hh), m); l.position.z = -W / 2
      const rr = new THREE.Mesh(bar(0.6, Hh), m); rr.position.z = W / 2
      g.add(top, bot, l, rr); grp.add(g)
    }
    return grp
  }, [])
  return on ? <primitive object={group} /> : null
}

/* ------------------------------------------------------------------ world root */
export function World() {
  const anchored = useRef<THREE.Group>(null!)
  useFrame(() => { anchored.current.position.set(-FS.sim.pos.x, 0, -FS.sim.pos.z) })
  return (
    <>
      <SkyAndLight />
      <Ground />
      <Hills />
      <group ref={anchored}>
        <Runway x0={0} />
        <Runway x0={DEST} approachLights />
        <Papi />
        {AIRPORTS.map((ap) => <Airport key={ap.id} ap={ap} />)}
        <Forests />
        <Clouds />
        <GlidePath />
      </group>
    </>
  )
}
