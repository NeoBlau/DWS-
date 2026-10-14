import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { OrbitControls, Environment, Lightformer } from '@react-three/drei'
import { EffectComposer, Bloom, Vignette, N8AO, SMAA } from '@react-three/postprocessing'
import * as THREE from 'three'
import type { OrbitControls as OrbitImpl } from 'three-stdlib'
import { useExp, exp, withMode, live, activeAt, CLOCK, seek, PENDING, type ExplorerDef, type ManualMode, type Track } from './core'
import { S, CUT, PLAY, updateMaterials } from './materials'
import { useT, useLang, UI, T, type Txt } from './i18n'
import { useApp } from '../store'

/* ------------------------------------------------------------------ sky dome */
function Sky({ colors }: { colors: [string, string, string] }) {
  const mat = useMemo(() => new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false,
    uniforms: { top: { value: new THREE.Color(colors[0]) }, mid: { value: new THREE.Color(colors[1]) }, bot: { value: new THREE.Color(colors[2]) } },
    vertexShader: 'varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
    fragmentShader: 'uniform vec3 top; uniform vec3 mid; uniform vec3 bot; varying vec3 vP; void main(){ float h = vP.y; vec3 c = h > 0.0 ? mix(mid, top, pow(h, 0.6)) : mix(mid, bot, pow(-h, 0.5)); gl_FragColor = vec4(c, 1.0); }',
  }), [colors])
  return <mesh material={mat} scale={400}><sphereGeometry args={[1, 32, 16]} /></mesh>
}

/** studio lighting: soft boxes reflected by metals, the way product photography is lit */
function Env() {
  return (
    <Environment resolution={256} frames={1} environmentIntensity={0.9}>
      <color attach="background" args={['#15181d']} />
      <Lightformer form="rect" intensity={3.2} color="#fff4e6" position={[0, 6, 1]} rotation-x={Math.PI / 2} scale={[10, 5, 1]} />
      <Lightformer form="rect" intensity={1.6} color="#dfe9ff" position={[-6, 2, 3]} rotation-y={Math.PI / 2} scale={[8, 2.2, 1]} />
      <Lightformer form="rect" intensity={1.4} color="#ffe3c4" position={[6, 1.5, -2]} rotation-y={-Math.PI / 2} scale={[8, 1.6, 1]} />
      <Lightformer form="rect" intensity={0.9} color="#ffffff" position={[0, 1.2, 7]} scale={[12, 1, 1]} />
      <Lightformer form="ring" intensity={1.2} color="#ffffff" position={[3, 4, -5]} scale={2.5} />
      <mesh scale={30} position={[0, -10, 0]} rotation-x={-Math.PI / 2}><planeGeometry /><meshBasicMaterial color="#2a2b2e" /></mesh>
    </Environment>
  )
}

/** dark satin studio floor fading into the backdrop; catches the shadows */
function Floor({ y }: { y: number }) {
  const alpha = useMemo(() => {
    const c = document.createElement('canvas'); c.width = c.height = 256
    const g = c.getContext('2d')!, gr = g.createRadialGradient(128, 128, 10, 128, 128, 128)
    gr.addColorStop(0, '#fff'); gr.addColorStop(0.55, '#bbb'); gr.addColorStop(1, '#000')
    g.fillStyle = gr; g.fillRect(0, 0, 256, 256)
    return new THREE.CanvasTexture(c)
  }, [])
  return (
    <mesh rotation-x={-Math.PI / 2} position={[0, y, 0]} receiveShadow>
      <circleGeometry args={[9, 64]} />
      <meshStandardMaterial color="#202227" roughness={0.62} metalness={0.15} alphaMap={alpha} transparent depthWrite={false} />
    </mesh>
  )
}

/* ------------------------------------------------------------------ director: timeline → scene */
const lerp = (a: number, b: number, k: number) => a + (b - a) * k
function Director({ def, cutOpen, controls }: { def: ExplorerDef; cutOpen: number; controls: React.MutableRefObject<OrbitImpl | null> }) {
  const { camera, scene } = useThree()
  const tgt = useMemo(() => new THREE.Vector3(), [])
  const pos = useMemo(() => new THREE.Vector3(), [])
  const shadowed = useRef(false)
  useFrame((st, dtRaw) => {
    const dt = Math.min(dtRaw, 0.05)
    const e = exp()
    const track = def.tracks.find((k) => k.id === e.track) ?? def.tracks[0]
    const sp = e.playing ? e.speed * (e.slow ? 0.3 : 1) : 0
    PLAY.k = sp
    if (e.playing) {
      CLOCK.t += dt * sp
      if (CLOCK.t >= track.duration) { CLOCK.t = track.duration; e.set({ playing: false }) }
    }
    const s = withMode(track.state(CLOCK.t), e.mode as ManualMode, e.flowOff)
    const snap = CLOCK.snap > 0
    if (snap) CLOCK.snap--
    // big jumps on the timeline travel faster so the camera does not lag behind the story
    const boost = CLOCK.boost > 0 ? 2.4 : 1
    CLOCK.boost = Math.max(0, CLOCK.boost - dt)
    const K = (rate: number) => (snap ? 1 : 1 - Math.exp(-dt * rate * boost))
    const k = K(3.2)
    S.cut = lerp(S.cut, s.cut, k); S.xray = lerp(S.xray, s.xray, k); S.explode = lerp(S.explode, s.explode, K(2.4)); S.dim = lerp(S.dim, s.dim, k)
    S.rpm = lerp(S.rpm, s.rpm * (0.35 + e.throttle * 1.3), 1 - Math.exp(-dt * 1.6))
    const ids = new Set([...Object.keys(S.flows), ...Object.keys(s.flows)])
    ids.forEach((id) => { const f = id as keyof typeof S.flows; S.flows[f] = lerp(S.flows[f] ?? 0, s.flows[f] ?? 0, k) })
    S.focus = s.focus; S.labels = s.labels
    Object.keys(s.extra).forEach((x) => { S.extra[x] = lerp(S.extra[x] ?? s.extra[x], s.extra[x], k) })
    // section plane: far away when closed, through the model when cut
    CUT.constant = S.cut < 0.002 ? 50 : lerp(cutOpen + 1.6, cutOpen, Math.pow(S.cut, 0.7))
    updateMaterials(st.clock.elapsedTime)
    live.t = CLOCK.t
    if (!shadowed.current) {
      shadowed.current = true
      scene.traverse((o) => { const m = o as THREE.Mesh; if (m.isMesh && !(m.material as THREE.Material).stencilWrite) { m.castShadow = true; m.receiveShadow = true } })
    }
    // camera follows the process
    if (e.follow && controls.current) {
      const p = track.camera(CLOCK.t)
      pos.set(...p.pos); tgt.set(...p.target)
      const kc = K(2.6)
      camera.position.lerp(pos, kc)
      controls.current.target.lerp(tgt, kc)
      controls.current.update()
    }
  })
  return null
}

/* ------------------------------------------------------------------ labels: project anchors → DOM */
export const labelScreen = new Map<string, { x: number; y: number; vis: boolean }>()
function Projector({ def }: { def: ExplorerDef }) {
  const v = useMemo(() => new THREE.Vector3(), [])
  useFrame(({ camera, size }) => {
    def.labels.forEach((l) => {
      v.set(...l.anchor()).project(camera)
      labelScreen.set(l.id, { x: (v.x * 0.5 + 0.5) * size.width, y: (-v.y * 0.5 + 0.5) * size.height, vis: v.z < 1 && Math.abs(v.x) < 1.1 && Math.abs(v.y) < 1.1 })
    })
  })
  return null
}

function Labels({ def }: { def: ExplorerDef }) {
  const t = useT()
  const refs = useRef(new Map<string, { box: HTMLDivElement; line: SVGLineElement; dot: SVGCircleElement; sub: HTMLSpanElement | null }>())
  const lang = useLang((s) => s.lang)
  useEffect(() => {
    let raf = 0
    const tick = () => {
      refs.current.forEach((r, id) => {
        const p = labelScreen.get(id)
        const d = def.labels.find((l) => l.id === id)!
        const on = !!p && p.vis && S.labels.includes(id)
        const op = on ? 1 : 0
        r.box.style.opacity = String(op); r.line.style.opacity = String(op * 0.85); r.dot.style.opacity = String(op)
        if (!p) return
        const lx = p.x + (d.dx ?? 40), ly = p.y + (d.dy ?? -40)
        r.box.style.transform = `translate(${lx}px, ${ly}px) translate(${(d.dx ?? 40) < 0 ? '-100%' : '0'}, -50%)`
        r.line.setAttribute('x1', String(p.x)); r.line.setAttribute('y1', String(p.y)); r.line.setAttribute('x2', String(lx)); r.line.setAttribute('y2', String(ly))
        r.dot.setAttribute('cx', String(p.x)); r.dot.setAttribute('cy', String(p.y))
        if (r.sub && d.sub) r.sub.textContent = d.sub(live)[lang]
      })
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [def, lang])
  return (
    <div className="xl-layer" aria-hidden>
      <svg className="xl-svg">
        {def.labels.map((l) => (
          <g key={l.id}>
            <line ref={(el) => { if (el) { const r = refs.current.get(l.id) ?? ({} as never); refs.current.set(l.id, { ...r, line: el }) } }} />
            <circle r="3" ref={(el) => { if (el) { const r = refs.current.get(l.id) ?? ({} as never); refs.current.set(l.id, { ...r, dot: el }) } }} />
          </g>
        ))}
      </svg>
      {def.labels.map((l) => (
        <div key={l.id} className="xl" ref={(el) => { if (el) { const r = refs.current.get(l.id) ?? ({} as never); refs.current.set(l.id, { ...r, box: el }) } }}>
          <b>{t(l.title)}</b>
          {l.sub && <span ref={(el) => { const r = refs.current.get(l.id) ?? ({} as never); refs.current.set(l.id, { ...r, sub: el }) }} />}
        </div>
      ))}
    </div>
  )
}

/* ------------------------------------------------------------------ playback bar */
const fmt = (s: number) => s.toFixed(1)
/** re-render at ~12 fps with the current clock (never per animation frame) */
export function useClock() {
  const [v, setV] = useState(CLOCK.t)
  useEffect(() => { const id = setInterval(() => setV(CLOCK.t), 80); return () => clearInterval(id) }, [])
  return v
}

function Playback({ track }: { track: Track }) {
  const t = useT()
  const st = useExp()
  const now = useClock()
  const bar = useRef<HTMLDivElement>(null)
  const scrub = (clientX: number) => {
    const r = bar.current!.getBoundingClientRect()
    const k = Math.max(0, Math.min(1, (clientX - r.left) / r.width))
    seek(k * track.duration); st.set({ follow: true })
  }
  const [drag, setDrag] = useState(false)
  return (
    <div className="xp-bar glass">
      <div className="xp-row">
        <button className="btn sm" onClick={() => { if (!st.playing && CLOCK.t >= track.duration - 0.05) seek(0); st.set({ playing: !st.playing }) }}>{st.playing ? '❚❚ ' + t(UI.pause) : '▶ ' + t(UI.play)}</button>
        <button className="btn sm" onClick={() => { const next = track.chapters.find((c) => c.t > CLOCK.t + 0.05); seek(next ? next.t : track.duration); st.set({ playing: false, follow: true }) }}>{t(UI.step)} ⏭</button>
        <span className="xp-time mono">{fmt(now)} / {fmt(track.duration)} s</span>
        <span className="xp-grow" />
        <button className={`btn sm ${st.slow ? 'on' : ''}`} onClick={() => st.set({ slow: !st.slow })}>{t(UI.slow)}</button>
        <button className={`btn sm ${st.follow ? 'on' : ''}`} onClick={() => st.set({ follow: !st.follow })}>{t(UI.follow)}</button>
        <div className="seg xp-speed">{[0.5, 1, 1.5].map((v) => <button key={v} className={st.speed === v ? 'on' : ''} onClick={() => st.set({ speed: v })}>{v}×</button>)}</div>
      </div>
      <div className="xp-track" ref={bar}
        onPointerDown={(e) => { (e.target as HTMLElement).setPointerCapture?.(e.pointerId); setDrag(true); scrub(e.clientX) }}
        onPointerMove={(e) => { if (drag) scrub(e.clientX) }} onPointerUp={() => setDrag(false)} onPointerCancel={() => setDrag(false)}
        role="slider" aria-label="Timeline" aria-valuemin={0} aria-valuemax={track.duration} aria-valuenow={now} tabIndex={0}
        onKeyDown={(e) => { if (e.key === 'ArrowRight') seek(Math.min(track.duration, CLOCK.t + 1)); if (e.key === 'ArrowLeft') seek(Math.max(0, CLOCK.t - 1)) }}>
        <div className="xp-rail" />
        <div className="xp-fill" style={{ width: `${(now / track.duration) * 100}%` }} />
        {track.chapters.map((c) => <i key={c.id} className="xp-tick" style={{ left: `${(c.t / track.duration) * 100}%` }} />)}
        {(track.ticks ?? []).map((c) => <span key={c.t} className="xp-time-tick" style={{ left: `${(c.t / track.duration) * 100}%` }}>{c.t.toFixed(1)}s<br />{t(c.label)}</span>)}
        <b className="xp-knob" style={{ left: `${(now / track.duration) * 100}%` }} />
      </div>
      <div className="xp-markers">
        {track.markers.map((m) => <button key={m.t} style={{ left: `${(m.t / track.duration) * 100}%` }} onClick={() => { seek(m.t); st.set({ follow: true }) }}>{t(m.label)}</button>)}
      </div>
    </div>
  )
}

function ChapterNav({ track }: { track: Track }) {
  const t = useT()
  const now = useClock()
  const chapter = activeAt(track.chapters, now)
  return (
    <nav className="xp-chapters glass" aria-label="Chapters">
      {track.chapters.map((c) => <button key={c.id} className={chapter?.id === c.id ? 'on' : ''} onClick={() => { seek(c.t); exp().set({ follow: true, playing: true }) }}>{t(c.label)}</button>)}
    </nav>
  )
}

function Caption({ track }: { track: Track }) {
  const t = useT()
  const now = useClock()
  const chapter = activeAt(track.chapters, now)
  const cap = track.caption(now, live)
  if (!cap) return null
  return <div className="xp-caption glass" key={cap.ru}><b>{chapter ? t(chapter.label) : ''}</b> {t(cap)}</div>
}

/* ------------------------------------------------------------------ shell */
export function Explorer({ def, cutOpen, controlsPanel, children, cam, floorY }: {
  def: ExplorerDef; cutOpen: number; floorY?: number; controlsPanel?: ReactNode; children: ReactNode; cam: { fov: number; near: number; far: number }
}) {
  const t = useT()
  const lang = useLang((s) => s.lang)
  const setLang = useLang((s) => s.setLang)
  const st = useExp()
  const quality = useApp((s) => s.quality)
  const sound = useApp((s) => s.sound)
  const controls = useRef<OrbitImpl | null>(null)
  const track = def.tracks.find((k) => k.id === st.track) ?? def.tracks[0]
  useEffect(() => {
    // cleared after the tick so React's double-invoked effects in development see the same deep link
    const p = PENDING.start; setTimeout(() => { if (PENDING.start === p) PENDING.start = null }, 0)
    const tr = p && def.tracks.some((k) => k.id === p.track) ? p.track : def.tracks[0].id
    seek(p?.t ?? 0, true)
    st.set({ track: tr, playing: p?.playing ?? true, follow: true, mode: p?.mode ?? 'auto', flowOff: [] })
  }, [def]) // eslint-disable-line
  const p0 = useMemo(() => track.camera(0), [def]) // eslint-disable-line
  const modes: [ManualMode, Txt][] = [['auto', UI.auto], ['walk', UI.walk], ['cutaway', UI.cutaway], ['xray', UI.xray], ['flow', UI.flow], ['exploded', UI.exploded]]
  return (
    <div className="xp">
      <Canvas className="xp-canvas" shadows dpr={quality === 'high' ? [1, 2] : [1, 1.25]}
        gl={{ stencil: true, antialias: quality !== 'high', localClippingEnabled: true } as THREE.WebGLRendererParameters}
        camera={{ position: p0.pos, fov: cam.fov, near: cam.near, far: cam.far }}
        onCreated={({ gl }) => { gl.localClippingEnabled = true; gl.toneMapping = THREE.ACESFilmicToneMapping; gl.toneMappingExposure = 1.08; gl.shadowMap.type = THREE.PCFSoftShadowMap }}>
        <Sky colors={def.sky} />
        <Env />
        <hemisphereLight args={['#e8eefc', '#2f3036', 0.35]} />
        <directionalLight position={[4, 7, 5]} intensity={2.1} color="#fff1df" castShadow shadow-mapSize={quality === 'high' ? [4096, 4096] : [2048, 2048]} shadow-bias={-0.0003} shadow-normalBias={0.002}
          shadow-camera-left={-4} shadow-camera-right={4} shadow-camera-top={4} shadow-camera-bottom={-4} shadow-camera-near={0.5} shadow-camera-far={30} />
        <directionalLight position={[-5, 2.5, -4]} intensity={0.9} color="#a9c4ff" />
        {children}
        {floorY !== undefined && <group position={[-1, 0, 0]}><Floor y={floorY} /></group>}
        <Director def={def} cutOpen={cutOpen} controls={controls} />
        <Projector def={def} />
        <OrbitControls ref={controls as never} makeDefault enableDamping dampingFactor={0.08} target={p0.target} minDistance={0.04} maxDistance={40} zoomSpeed={1.2} onStart={() => exp().set({ follow: false })} />
        {quality === 'high' && (
          <EffectComposer multisampling={0} stencilBuffer>
            <N8AO aoRadius={def.ao ?? 0.08} distanceFalloff={0.6} intensity={2.4} quality="medium" halfRes />
            <SMAA />
            <Bloom mipmapBlur intensity={0.85} luminanceThreshold={0.78} luminanceSmoothing={0.2} radius={0.75} />
            <Vignette eskil={false} offset={0.25} darkness={0.6} />
          </EffectComposer>
        )}
      </Canvas>
      <Labels def={def} />
      <div className="xp-top">
        <div className="xp-title">
          <button className="btn sm" onClick={() => useApp.getState().set({ screen: 'landing' })}>← {t(UI.back)}</button>
          <div>
            <span className="eyebrow">{t(def.kicker)}</span>
            <h1>{t(def.title)}</h1>
            <p>{t(def.subtitle)}</p>
          </div>
        </div>
        <ChapterNav track={track} />
        <div className="xp-right">
          <div className="seg xp-lang"><button className={lang === 'ru' ? 'on' : ''} onClick={() => setLang('ru')}>RU</button><button className={lang === 'en' ? 'on' : ''} onClick={() => setLang('en')}>EN</button></div>
          <button className={`btn sm ${quality === 'high' ? 'on' : ''}`} title={t(T('Высокая чёткость: больше пикселей, тени и затенение', 'High definition: more pixels, shadows and occlusion'))} onClick={() => useApp.getState().set({ quality: quality === 'high' ? 'low' : 'high' })}>HD</button>
          <button className={`btn sm ${sound ? 'on' : ''}`} onClick={() => useApp.getState().set({ sound: !sound })}>{t(T('Звук', 'Sound'))}</button>
          <button className="btn sm" onClick={() => st.set({ follow: true, mode: 'auto' })}>{t(UI.reset)}</button>
        </div>
      </div>
      <aside className="xp-panel glass">
        {controlsPanel}
        <span className="eyebrow">{t(UI.scenario)}</span>
        <div className="xp-tracks">
          {def.tracks.map((k) => <button key={k.id} className={`btn sm ${k.id === track.id ? 'on' : ''}`} onClick={() => { seek(0); st.set({ track: k.id, playing: true, follow: true, mode: 'auto' }) }}>{t(k.title)}</button>)}
        </div>
        <span className="eyebrow">{t(UI.modes)}</span>
        <div className="xp-modes">{modes.map(([m, l]) => <button key={m} className={`btn sm ${st.mode === m ? 'on' : ''}`} onClick={() => st.set({ mode: m })}>{t(l)}</button>)}</div>
        <span className="eyebrow">{t(UI.flows)}</span>
        <div className="xp-modes">
          {def.flows.map((f) => {
            const off = st.flowOff.includes(f.id)
            return <button key={f.id} className={`btn sm ${off ? 'off' : ''}`} style={{ ['--c' as string]: f.color }} onClick={() => st.set({ flowOff: off ? st.flowOff.filter((x) => x !== f.id) : [...st.flowOff, f.id] })}><i className="dot" />{t(f.label)}</button>
          })}
        </div>
        <p className="xp-note">{t(def.note)}</p>
      </aside>
      <Caption track={track} />
      <p className="xp-zoom-hint">{t(T('Колесо — приблизить · тянуть — вращать · правая кнопка — сдвинуть · «Камера следует» — вернуть сценарий', 'Wheel — zoom · drag — orbit · right-drag — pan · “Follow camera” — back to the story'))}</p>
      <Playback track={track} />
    </div>
  )
}

export const SPEED_TXT = T('скорость', 'speed')
