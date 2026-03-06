import { BLOCK_CONSTANTS_WGSL } from "./generated/block-constants.wgsl";
export { BLOCK_CONSTANTS_WGSL as BLOCK_CONSTANTS };

/** Default shader code shown in the editor. */
export const DEFAULT_SHADER = `// Procedural terrain with hills, caves, ores, water & hex ceiling
// generate(x, y, z) → block state ID — y ranges from -64 to 319

// @param terrain_scale: slider(0.001, 0.02, 0.001) = 0.005
// @param terrain_detail: slider(0.01, 0.1, 0.005) = 0.02
// @param terrain_height: slider(20, 160, 1) = 80
// @param detail_height: slider(2, 40, 1) = 20
// @param base_offset: slider(-20, 80, 1) = 20
// @param sea_level: slider(0, 128, 1) = 62
// @param enable_caves: toggle = true
// @param ceiling_y: slider(128, 300, 1) = 200
// @param hex_size: slider(2, 20, 0.5) = 8

// ---- hash-based value noise ----
fn hash2(p: vec2<f32>) -> f32 {
  var q = fract(p * vec2<f32>(123.34, 456.21));
  q += dot(q, q + 45.32);
  return fract(q.x * q.y);
}

fn noise2(p: vec2<f32>) -> f32 {
  let i = floor(p);
  let f = fract(p);
  let u = f * f * (3.0 - 2.0 * f);
  let a = hash2(i);
  let b = hash2(i + vec2<f32>(1.0, 0.0));
  let c = hash2(i + vec2<f32>(0.0, 1.0));
  let d = hash2(i + vec2<f32>(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

fn hash3(p: vec3<f32>) -> f32 {
  var q = fract(p * vec3<f32>(123.34, 456.21, 789.53));
  q += dot(q, q + 45.32);
  return fract(q.x * q.y * q.z);
}

fn noise3(p: vec3<f32>) -> f32 {
  let i = floor(p);
  let f = fract(p);
  let u = f * f * (3.0 - 2.0 * f);
  let a = hash3(i);
  let b = hash3(i + vec3<f32>(1.0, 0.0, 0.0));
  let c = hash3(i + vec3<f32>(0.0, 1.0, 0.0));
  let d = hash3(i + vec3<f32>(1.0, 1.0, 0.0));
  let e = hash3(i + vec3<f32>(0.0, 0.0, 1.0));
  let f2 = hash3(i + vec3<f32>(1.0, 0.0, 1.0));
  let g = hash3(i + vec3<f32>(0.0, 1.0, 1.0));
  let h = hash3(i + vec3<f32>(1.0, 1.0, 1.0));
  let z0 = mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
  let z1 = mix(mix(e, f2, u.x), mix(g, h, u.x), u.y);
  return mix(z0, z1, u.z);
}

fn fbm2(p: vec2<f32>) -> f32 {
  var v = 0.0;  var a = 0.5;  var pos = p;
  for (var i = 0; i < 5; i++) {
    v += a * noise2(pos);  pos *= 2.0;  a *= 0.5;
  }
  return v;
}

fn fbm3(p: vec3<f32>) -> f32 {
  var v = 0.0;  var a = 0.5;  var pos = p;
  for (var i = 0; i < 4; i++) {
    v += a * noise3(pos);  pos *= 2.0;  a *= 0.5;
  }
  return v;
}

// ---- hexagonal tiling ----
// returns (hex_center, distance_to_edge) for pointy-top hexagons
fn hex_dist(p: vec2<f32>, size: f32) -> vec2<f32> {
  let s = size;
  // hex grid coordinates
  let q_basis = vec2<f32>(2.0 / 3.0, 0.0) / s;
  let r_basis = vec2<f32>(-1.0 / 3.0, sqrt(3.0) / 3.0) / s;
  let qf = dot(p, vec2<f32>(q_basis.x, q_basis.y));
  let rf = dot(p, vec2<f32>(r_basis.x, r_basis.y));
  // cube coordinates
  let cf = vec3<f32>(qf, rf, -qf - rf);
  var cr = vec3<f32>(round(cf.x), round(cf.y), round(cf.z));
  let diff = abs(cr - cf);
  if (diff.x > diff.y && diff.x > diff.z) {
    cr.x = -cr.y - cr.z;
  } else if (diff.y > diff.z) {
    cr.y = -cr.x - cr.z;
  } else {
    cr.z = -cr.x - cr.y;
  }
  // back to world coords
  let cx = s * (3.0 / 2.0 * cr.x);
  let cz = s * (sqrt(3.0) * (cr.y + cr.x / 2.0));
  let dx = p.x - cx;
  let dz = p.y - cz;
  // distance to nearest edge (hex SDF)
  let ax = abs(dx) / s;
  let az = abs(dz) / s;
  let edge_dist = max(ax * 0.5 + az * (sqrt(3.0) / 2.0), ax);
  // hash for this hex cell
  let cell_hash = hash2(vec2<f32>(cr.x * 17.3 + 5.7, cr.y * 31.1 + 9.3));
  return vec2<f32>(cell_hash, edge_dist);
}

// ---- terrain parameters (driven by @param uniforms) ----

fn terrain_height(x: i32, z: i32) -> i32 {
  let p = vec2<f32>(f32(x), f32(z));
  let h = fbm2(p * u.terrain_scale) * u.terrain_height
        + fbm2(p * u.terrain_detail + 100.0) * u.detail_height
        + fbm2(p * 0.05 + 300.0) * 6.0;
  return i32(h) + i32(u.base_offset);
}

// hex ceiling: colored glass pattern with glowstone frame
fn ceiling_block(x: i32, z: i32, y: i32) -> u32 {
  let p = vec2<f32>(f32(x), f32(z));
  let hex = hex_dist(p, u.hex_size);
  let cell = hex.x;
  let edge = hex.y;

  let ceil_y = i32(u.ceiling_y);

  // frame (edges of hexagons)
  if (edge > 0.85) {
    if (y == ceil_y) { return GLOWSTONE; }
    return OBSIDIAN;
  }

  // only one layer thick for the colored fill
  if (y != ceil_y) { return AIR; }

  // pick color per hex cell
  let c = u32(cell * 16.0);
  switch c {
    case 0u:  { return WHITE_CONCRETE; }
    case 1u:  { return ORANGE_CONCRETE; }
    case 2u:  { return MAGENTA_CONCRETE; }
    case 3u:  { return LIGHT_BLUE_CONCRETE; }
    case 4u:  { return YELLOW_CONCRETE; }
    case 5u:  { return LIME_CONCRETE; }
    case 6u:  { return PINK_CONCRETE; }
    case 7u:  { return CYAN_CONCRETE; }
    case 8u:  { return PURPLE_CONCRETE; }
    case 9u:  { return BLUE_CONCRETE; }
    case 10u: { return EMERALD_BLOCK; }
    case 11u: { return DIAMOND_BLOCK; }
    case 12u: { return GOLD_BLOCK; }
    case 13u: { return IRON_BLOCK; }
    case 14u: { return LAPIS_BLOCK; }
    default:  { return RED_CONCRETE; }
  }
}

fn generate(x: i32, y: i32, z: i32) -> u32 {
  // ---- hex ceiling ----
  let ceiling = i32(u.ceiling_y);
  if (y >= ceiling && y <= ceiling + 1) {
    let cb = ceiling_block(x, z, y);
    if (cb != AIR) { return cb; }
  }

  let height = terrain_height(x, z);

  // bedrock floor with random top
  if (y == -64) { return BEDROCK; }
  if (y < -60 && hash3(vec3<f32>(f32(x), f32(y), f32(z))) < 0.4) {
    return BEDROCK;
  }

  // above terrain — air or water
  if (y > height) {
    if (y <= i32(u.sea_level)) { return WATER; }
    return AIR;
  }

  // caves (toggle-controlled)
  if (u.enable_caves > 0.5) {
    let cave = fbm3(vec3<f32>(f32(x), f32(y), f32(z)) * 0.04);
    let cave2 = noise3(vec3<f32>(f32(x), f32(y), f32(z)) * 0.08);
    if (cave > 0.55 && cave2 > 0.4 && y > -50 && y < height - 4) {
      if (y <= i32(u.sea_level)) { return WATER; }
      return AIR;
    }
  }

  // deep underground (below y=0): deepslate + ores
  if (y < 0) {
    let r = hash3(vec3<f32>(f32(x) * 1.1, f32(y) * 1.3, f32(z) * 0.9));
    if (r < 0.004) { return DIAMOND_ORE; }
    if (r < 0.010) { return GOLD_ORE; }
    if (r < 0.020) { return LAPIS_ORE; }
    if (r < 0.035) { return EMERALD_ORE; }
    return DEEPSLATE;
  }

  // underground stone + ores
  if (y < height - 4) {
    let r = hash3(vec3<f32>(f32(x) * 0.7, f32(y) * 1.1, f32(z) * 0.8));
    if (r < 0.008) { return COAL_ORE; }
    if (r < 0.014) { return IRON_ORE; }
    if (r < 0.018) { return GOLD_ORE; }
    let v = hash3(vec3<f32>(f32(x) * 0.3, f32(y) * 0.5, f32(z) * 0.3));
    if (v < 0.06) { return GRANITE; }
    if (v < 0.12) { return DIORITE; }
    if (v < 0.18) { return ANDESITE; }
    if (v < 0.20) { return GRAVEL; }
    return STONE;
  }

  // beaches near sea level
  let sl = i32(u.sea_level);
  let is_beach = height <= sl + 2 && height >= sl - 3;
  if (is_beach) {
    if (y >= height - 3) { return SAND; }
    if (y >= height - 5) { return SANDSTONE; }
    return STONE;
  }

  // sub-surface dirt
  if (y < height - 1) {
    if (y >= height - 4) { return DIRT; }
    return STONE;
  }

  // surface block — varies with altitude
  if (height > 95) { return SNOW_BLOCK; }
  if (height > 85) { return STONE; }
  return GRASS_BLOCK;
}
`;

import type { ShaderParam } from "./params";

/** Wraps user WGSL code in a compute shader with the boilerplate. */
export function buildComputeShader(userCode: string, params: ShaderParam[] = []): string {
  const BLOCK_CONSTANTS = BLOCK_CONSTANTS_WGSL;
  const paramFields = params.map((p) => `  ${p.name}: f32,`).join("\n");
  const uniformsStruct = params.length > 0
    ? `struct Uniforms {\n  chunk_x: i32,\n  chunk_z: i32,\n${paramFields}\n};`
    : `struct Uniforms {\n  chunk_x: i32,\n  chunk_z: i32,\n};`;

  return `
${uniformsStruct}

@group(0) @binding(0) var<uniform> u: Uniforms;
@group(0) @binding(1) var<storage, read_write> output: array<u32>;

${BLOCK_CONSTANTS}

// --- User code ---
${userCode}
// --- End user code ---

@compute @workgroup_size(1, 1, 1)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let local_x = i32(gid.x);
  let local_z = i32(gid.y);
  let x = u.chunk_x * 16 + local_x;
  let z = u.chunk_z * 16 + local_z;
  for (var y_off: i32 = 0; y_off < 384; y_off++) {
    let y = y_off - 64;
    output[u32(y_off) * 256u + gid.y * 16u + gid.x] = generate(x, y, z);
  }
}
`;
}
