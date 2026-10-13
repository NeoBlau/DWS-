import * as THREE from 'three'

/*
 * Procedural surface finish for PBR materials. Instead of image textures (which would need UVs that our
 * procedural solids don't have consistently), the fragment shader evaluates 3D noise in object space and
 * uses it for micro-relief (bump) and roughness variation. Object space keeps the pattern glued to moving parts.
 */

export type Finish = 'cast' | 'machined' | 'paint' | 'rubber' | 'none'

interface FinishParams { freq: number; amp: number; roughVar: number; smudge: number; streak: number }
const PARAMS: Record<Exclude<Finish, 'none'>, FinishParams> = {
  // sand-cast iron / aluminium: coarse grain, strongly varying roughness
  cast: { freq: 420, amp: 0.00035, roughVar: 0.35, smudge: 0.18, streak: 0 },
  // turned / ground steel: fine directional marks, satin smudges
  machined: { freq: 1600, amp: 0.00009, roughVar: 0.25, smudge: 0.35, streak: 1 },
  // painted or coated: very soft orange peel
  paint: { freq: 160, amp: 0.00012, roughVar: 0.12, smudge: 0.1, streak: 0 },
  // rubber: fine matte grain
  rubber: { freq: 900, amp: 0.00025, roughVar: 0.15, smudge: 0.05, streak: 0 },
}

const NOISE = /* glsl */ `
varying vec3 vFinPos;
uniform float finFreq, finAmp, finRoughVar, finSmudge, finStreak;
float finHash(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float finNoise(vec3 x) {
  vec3 i = floor(x); vec3 f = fract(x); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(finHash(i + vec3(0,0,0)), finHash(i + vec3(1,0,0)), f.x), mix(finHash(i + vec3(0,1,0)), finHash(i + vec3(1,1,0)), f.x), f.y),
             mix(mix(finHash(i + vec3(0,0,1)), finHash(i + vec3(1,0,1)), f.x), mix(finHash(i + vec3(0,1,1)), finHash(i + vec3(1,1,1)), f.x), f.y), f.z);
}
float finFbm(vec3 p) { float a = 0.5, s = 0.0; for (int i = 0; i < 3; i++) { s += a * finNoise(p); p *= 2.07; a *= 0.5; } return s; }
float finHeight(vec3 p) {
  // directional streaks for machined parts: stretch the noise along the part's local X
  vec3 q = finStreak > 0.5 ? vec3(p.x * 0.08, p.y, p.z) : p;
  return finFbm(q * finFreq);
}
vec3 finPerturb(vec3 pos, vec3 n, float h, float faceDir) {
  vec3 sx = dFdx(pos), sy = dFdy(pos);
  vec3 r1 = cross(sy, n), r2 = cross(n, sx);
  float det = dot(sx, r1) * faceDir;
  vec3 grad = sign(det) * (dFdx(h) * r1 + dFdy(h) * r2);
  return normalize(abs(det) * n - grad);
}
`

/** attach the finish to a material; returns the material for chaining */
export function applyFinish(m: THREE.MeshPhysicalMaterial, finish: Finish) {
  if (finish === 'none') return m
  const P = PARAMS[finish]
  m.customProgramCacheKey = () => `fin-${finish}`
  m.onBeforeCompile = (sh) => {
    sh.uniforms.finFreq = { value: P.freq }
    sh.uniforms.finAmp = { value: P.amp }
    sh.uniforms.finRoughVar = { value: P.roughVar }
    sh.uniforms.finSmudge = { value: P.smudge }
    sh.uniforms.finStreak = { value: P.streak }
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vFinPos;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvFinPos = transformed;')
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\n' + NOISE)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
  {
    float sm = finFbm(vFinPos * 9.0);
    float gr = finFbm(vFinPos * finFreq * 0.5);
    roughnessFactor = clamp(roughnessFactor * (1.0 + (gr - 0.5) * finRoughVar + (sm - 0.5) * finSmudge), 0.04, 1.0);
  }`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
  {
    // fade the relief out when a noise cell gets smaller than a pixel, otherwise it sparkles
    float cell = length(fwidth(vFinPos)) * finFreq;
    float fade = 1.0 - smoothstep(0.35, 1.2, cell);
    if (fade > 0.001) {
      float h = finHeight(vFinPos) * finAmp * fade;
      normal = finPerturb(-vViewPosition, normal, h, faceDirection); // normal is in view space
    }
  }`)
  }
  m.needsUpdate = true
  return m
}

/** pick a finish from the PBR parameters when none is given */
export function inferFinish(o: { metal?: number; rough?: number; casing?: boolean; clear?: number; opacity?: number; emissiveIntensity?: number }): Finish {
  const metal = o.metal ?? 0.7, rough = o.rough ?? 0.35
  if (o.opacity !== undefined && o.opacity < 1) return 'none'
  if (metal < 0.1 && rough > 0.75) return 'rubber'
  if ((o.clear ?? 0) > 0) return 'paint'
  if (o.casing && metal < 0.8) return 'cast'
  if (metal >= 0.8) return 'machined'
  return 'paint'
}
