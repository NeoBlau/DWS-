import { useEffect, useMemo, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { Sky, Environment } from '@react-three/drei'
import * as THREE from 'three'
import { glowSprite } from '../../utils/geom'
import { AIM, DEST, GS_ANGLE, RWY, AC } from './fdm'
import { FS, useFlight } from './state'

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
  return (
    <mesh rotation-x={-Math.PI / 2} position={[0, -0.02, 0]} receiveShadow material={mat}>
      <planeGeometry args={[SIZE, SIZE]} />
    </mesh>
  )
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
    const y = 0.06
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
      <mesh position={[x0 + RWY.len / 2, 0.03, 0]} rotation-x={-Math.PI / 2} material={rwMat} receiveShadow>
        <planeGeometry args={[RWY.len, RWY.width]} />
      </mesh>
      {/* shoulders */}
      <mesh position={[x0 + RWY.len / 2, 0.02, 0]} rotation-x={-Math.PI / 2} receiveShadow>
        <planeGeometry args={[RWY.len + 120, RWY.width + 16]} />
        <meshStandardMaterial color="#6d6f6a" roughness={0.95} polygonOffset polygonOffsetFactor={-0.5} />
      </mesh>
      <primitive object={markMesh} />
      <mesh position={[x0 + 62, 0.07, 0]} rotation={[-Math.PI / 2, 0, -Math.PI / 2]}>
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
function Airport({ x0 }: { x0: number }) {
  const concrete = useMemo(() => new THREE.MeshStandardMaterial({ color: '#8f918d', roughness: 0.9, polygonOffset: true, polygonOffsetFactor: -1 }), [])
  const glass = useMemo(() => new THREE.MeshPhysicalMaterial({ color: '#3a5068', roughness: 0.08, metalness: 0.4, clearcoat: 1 }), [])
  const wall = useMemo(() => new THREE.MeshStandardMaterial({ color: '#d8d6cf', roughness: 0.7 }), [])
  const roof = useMemo(() => new THREE.MeshStandardMaterial({ color: '#7f868d', roughness: 0.5, metalness: 0.6 }), [])
  return (
    <group position={[x0, 0, 0]}>
      <mesh position={[1100, 0.025, -260]} rotation-x={-Math.PI / 2} material={concrete} receiveShadow><planeGeometry args={[900, 220]} /></mesh>
      {[600, 1600, 2600].map((x) => <mesh key={x} position={[x, 0.025, -95]} rotation-x={-Math.PI / 2} material={concrete} receiveShadow><planeGeometry args={[23, 150]} /></mesh>)}
      <mesh position={[1100, 0.025, -90]} rotation-x={-Math.PI / 2} material={concrete} receiveShadow><planeGeometry args={[2600, 23]} /></mesh>
      <mesh position={[1100, 9, -420]} material={wall} castShadow receiveShadow><boxGeometry args={[520, 18, 70]} /></mesh>
      <mesh position={[1100, 12, -383]} material={glass}><boxGeometry args={[500, 9, 1]} /></mesh>
      <mesh position={[1100, 18.5, -420]} material={roof}><boxGeometry args={[530, 1.2, 76]} /></mesh>
      {[330, 470].map((x) => (
        <group key={x} position={[x, 0, -410]}>
          <mesh position={[0, 9, 0]} material={wall} castShadow receiveShadow><boxGeometry args={[110, 18, 70]} /></mesh>
          {/* barrel roof: a half cylinder lying along z */}
          <mesh position={[0, 18, 0]} rotation={[Math.PI / 2, 0, 0]} scale={[1, 1, 0.22]} material={roof} castShadow><cylinderGeometry args={[55, 55, 70, 32, 1, false, -Math.PI / 2, Math.PI]} /></mesh>
        </group>
      ))}
      <group position={[1750, 0, -300]}>
        <mesh position={[0, 22, 0]} material={wall} castShadow><cylinderGeometry args={[3.5, 5, 44, 20]} /></mesh>
        <mesh position={[0, 47, 0]} material={glass} castShadow><cylinderGeometry args={[8, 6.5, 6, 12]} /></mesh>
        <mesh position={[0, 50.6, 0]} material={roof}><cylinderGeometry args={[8.6, 8.6, 1.2, 12]} /></mesh>
      </group>
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
        <Airport x0={0} />
        <Airport x0={DEST} />
        <Forests />
        <Clouds />
        <GlidePath />
      </group>
    </>
  )
}
