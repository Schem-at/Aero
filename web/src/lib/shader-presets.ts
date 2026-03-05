import { DEFAULT_SHADER } from "@/plugins/shader-generator/boilerplate";

export interface ShaderPreset {
  id: string;
  name: string;
  code: string;
  paramValues: Record<string, number>;
  builtIn: boolean;
  updatedAt: number;
}

const STORAGE_KEY = "aero-shader-presets";

// ---------------------------------------------------------------------------
// Built-in shader presets
// ---------------------------------------------------------------------------

const BUILTIN_PRESETS: { id: string; name: string; code: string }[] = [
  {
    id: "default",
    name: "Terrain (Default)",
    code: DEFAULT_SHADER,
  },
  {
    id: "floating-islands",
    name: "Floating Islands",
    code: `// Floating islands with waterfalls and lush tops
// generate(x, y, z) → block state ID

// @param island_scale: slider(0.005, 0.05, 0.001) = 0.015
// @param island_height: slider(10, 60, 1) = 30
// @param island_density: slider(0.2, 0.8, 0.05) = 0.45
// @param island_count: slider(1, 5, 1) = 3

fn hash2(p: vec2<f32>) -> f32 {
  var q = fract(p * vec2<f32>(123.34, 456.21));
  q += dot(q, q + 45.32);
  return fract(q.x * q.y);
}

fn noise2(p: vec2<f32>) -> f32 {
  let i = floor(p);
  let f = fract(p);
  let u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash2(i), hash2(i + vec2(1.0, 0.0)), u.x),
             mix(hash2(i + vec2(0.0, 1.0)), hash2(i + vec2(1.0, 1.0)), u.x), u.y);
}

fn hash3(p: vec3<f32>) -> f32 {
  var q = fract(p * vec3<f32>(123.34, 456.21, 789.53));
  q += dot(q, q + 45.32);
  return fract(q.x * q.y * q.z);
}

fn noise3(p: vec3<f32>) -> f32 {
  let i = floor(p);
  let f = fract(p);
  let uu = f * f * (3.0 - 2.0 * f);
  let a = hash3(i); let b = hash3(i + vec3(1.0,0.0,0.0));
  let c = hash3(i + vec3(0.0,1.0,0.0)); let d = hash3(i + vec3(1.0,1.0,0.0));
  let e = hash3(i + vec3(0.0,0.0,1.0)); let f2 = hash3(i + vec3(1.0,0.0,1.0));
  let g = hash3(i + vec3(0.0,1.0,1.0)); let h = hash3(i + vec3(1.0,1.0,1.0));
  return mix(mix(mix(a,b,uu.x), mix(c,d,uu.x), uu.y),
             mix(mix(e,f2,uu.x), mix(g,h,uu.x), uu.y), uu.z);
}

fn fbm2(p: vec2<f32>) -> f32 {
  var v = 0.0; var a = 0.5; var pos = p;
  for (var i = 0; i < 5; i++) { v += a * noise2(pos); pos *= 2.0; a *= 0.5; }
  return v;
}

// SDF for a single island blob — returns <0 if inside
fn island_sdf(p: vec3<f32>, center_y: f32, radius: f32) -> f32 {
  let xz = vec2<f32>(p.x, p.z);
  let shape = fbm2(xz * u.island_scale) * u.island_height;
  let blob_top = center_y + shape * 0.5;
  let blob_bottom = center_y - shape * 0.3 - 5.0;
  let xz_dist = length(xz * u.island_scale * 2.0);
  let falloff = smoothstep(radius, radius * 0.3, xz_dist);
  let mid = (blob_top + blob_bottom) * 0.5;
  let half_h = (blob_top - blob_bottom) * 0.5 * falloff;
  if (half_h < 1.0) { return 999.0; }
  return (abs(p.y - mid) - half_h);
}

fn generate(x: i32, y: i32, z: i32) -> u32 {
  let p = vec3<f32>(f32(x), f32(y), f32(z));

  if (y == -64) { return BEDROCK; }

  // Multiple island layers
  let layers = i32(u.island_count);
  for (var layer = 0; layer < 5; layer++) {
    if (layer >= layers) { break; }
    let center_y = 40.0 + f32(layer) * 60.0;
    let offset = vec2<f32>(f32(layer) * 137.0, f32(layer) * 251.0);
    let shifted = vec3<f32>(p.x + offset.x, p.y, p.z + offset.y);
    let d = island_sdf(shifted, center_y, u.island_density);
    if (d < 0.0) {
      // Inside an island
      let depth = -d;
      let surface_y = p.y + depth;
      if (depth < 1.5) {
        return GRASS_BLOCK;
      }
      if (depth < 5.0) { return DIRT; }
      if (hash3(p * 0.7) < 0.02) { return IRON_ORE; }
      return STONE;
    }
  }

  // Waterfall columns — thin water streams from bottom of islands
  let wx = f32(x);
  let wz = f32(z);
  let wn = fbm2(vec2<f32>(wx * 0.03, wz * 0.03));
  if (wn > 0.72 && y > 0 && y < 100) {
    let col_hash = hash2(floor(vec2<f32>(wx, wz) / 4.0));
    if (col_hash > 0.97) { return WATER; }
  }

  return AIR;
}`,
  },
  {
    id: "sdf-caves",
    name: "SDF Crystal Caves",
    code: `// Underground crystal cave system using SDF operations
// generate(x, y, z) → block state ID

// @param cave_scale: slider(0.01, 0.06, 0.005) = 0.03
// @param cave_size: slider(0.3, 0.7, 0.05) = 0.5
// @param crystal_chance: slider(0.0, 0.05, 0.005) = 0.015
// @param floor_level: slider(-40, 20, 1) = -10

fn hash3(p: vec3<f32>) -> f32 {
  var q = fract(p * vec3<f32>(123.34, 456.21, 789.53));
  q += dot(q, q + 45.32);
  return fract(q.x * q.y * q.z);
}

fn noise3(p: vec3<f32>) -> f32 {
  let i = floor(p);
  let f = fract(p);
  let uu = f * f * (3.0 - 2.0 * f);
  let a = hash3(i); let b = hash3(i + vec3(1.0,0.0,0.0));
  let c = hash3(i + vec3(0.0,1.0,0.0)); let d = hash3(i + vec3(1.0,1.0,0.0));
  let e = hash3(i + vec3(0.0,0.0,1.0)); let f2 = hash3(i + vec3(1.0,0.0,1.0));
  let g = hash3(i + vec3(0.0,1.0,1.0)); let h = hash3(i + vec3(1.0,1.0,1.0));
  return mix(mix(mix(a,b,uu.x), mix(c,d,uu.x), uu.y),
             mix(mix(e,f2,uu.x), mix(g,h,uu.x), uu.y), uu.z);
}

fn fbm3(p: vec3<f32>) -> f32 {
  var v = 0.0; var a = 0.5; var pos = p;
  for (var i = 0; i < 4; i++) { v += a * noise3(pos); pos *= 2.0; a *= 0.5; }
  return v;
}

// SDF: sphere at origin
fn sd_sphere(p: vec3<f32>, r: f32) -> f32 {
  return length(p) - r;
}

// SDF: smooth union
fn op_smooth_union(d1: f32, d2: f32, k: f32) -> f32 {
  let h = clamp(0.5 + 0.5 * (d2 - d1) / k, 0.0, 1.0);
  return mix(d2, d1, h) - k * h * (1.0 - h);
}

// Cave SDF — negative = inside cave
fn cave_sdf(p: vec3<f32>) -> f32 {
  let n1 = fbm3(p * u.cave_scale);
  let n2 = noise3(p * u.cave_scale * 2.5 + 100.0);
  // Worm-like caves
  let worm = sin(p.x * 0.05) * cos(p.z * 0.05) * 0.3 + n1;
  // Combine for cave shape — threshold determines cave size
  return worm - u.cave_size + n2 * 0.15;
}

fn generate(x: i32, y: i32, z: i32) -> u32 {
  let p = vec3<f32>(f32(x), f32(y), f32(z));
  let floor_y = i32(u.floor_level);

  if (y == -64) { return BEDROCK; }

  // Above ground — flat stone cap
  if (y > 80) { return AIR; }
  if (y > 75) {
    if (hash3(p * 0.5) < 0.3) { return AIR; }
    return STONE;
  }

  // Cave check
  let cave = cave_sdf(p);

  if (cave < 0.0) {
    // Inside a cave — air or water at low levels
    if (y <= floor_y) { return WATER; }

    // Crystal formations — grow from surfaces
    let near_wall = cave > -0.08;
    if (near_wall) {
      let r = hash3(p * 1.7);
      if (r < u.crystal_chance) {
        // Color based on depth
        if (y < 0) { return DIAMOND_BLOCK; }
        if (y < 20) { return EMERALD_BLOCK; }
        if (y < 40) { return PURPLE_CONCRETE; }
        return LIGHT_BLUE_CONCRETE;
      }
      if (r < u.crystal_chance * 3.0) { return GLOWSTONE; }
    }
    return AIR;
  }

  // Solid rock with ores
  if (y < -20) {
    let r = hash3(p * 0.9);
    if (r < 0.005) { return DIAMOND_ORE; }
    if (r < 0.015) { return GOLD_ORE; }
    if (r < 0.030) { return LAPIS_ORE; }
    return DEEPSLATE;
  }

  let r = hash3(p * 0.7);
  if (r < 0.008) { return COAL_ORE; }
  if (r < 0.016) { return IRON_ORE; }
  if (r < 0.05) { return GRANITE; }
  if (r < 0.09) { return DIORITE; }
  return STONE;
}`,
  },
  {
    id: "desert-pyramids",
    name: "Desert Pyramids",
    code: `// Infinite desert with procedural pyramids and oases
// generate(x, y, z) → block state ID

// @param dune_scale: slider(0.002, 0.02, 0.001) = 0.008
// @param dune_height: slider(5, 40, 1) = 15
// @param pyramid_freq: slider(0.001, 0.01, 0.001) = 0.004
// @param pyramid_size: slider(15, 60, 1) = 35
// @param oasis_chance: slider(0.0, 1.0, 0.1) = 0.3

fn hash2(p: vec2<f32>) -> f32 {
  var q = fract(p * vec2<f32>(123.34, 456.21));
  q += dot(q, q + 45.32);
  return fract(q.x * q.y);
}

fn noise2(p: vec2<f32>) -> f32 {
  let i = floor(p);
  let f = fract(p);
  let uu = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash2(i), hash2(i + vec2(1.0, 0.0)), uu.x),
             mix(hash2(i + vec2(0.0, 1.0)), hash2(i + vec2(1.0, 1.0)), uu.x), uu.y);
}

fn hash3(p: vec3<f32>) -> f32 {
  var q = fract(p * vec3<f32>(123.34, 456.21, 789.53));
  q += dot(q, q + 45.32);
  return fract(q.x * q.y * q.z);
}

fn fbm2(p: vec2<f32>) -> f32 {
  var v = 0.0; var a = 0.5; var pos = p;
  for (var i = 0; i < 4; i++) { v += a * noise2(pos); pos *= 2.0; a *= 0.5; }
  return v;
}

// SDF: pyramid — returns distance to surface
fn pyramid_sdf(px: f32, py: f32, pz: f32, size: f32) -> f32 {
  let ax = abs(px);
  let az = abs(pz);
  let chebyshev = max(ax, az);
  let height = size - chebyshev;
  if (height <= 0.0) { return 999.0; }
  return py - height;
}

fn generate(x: i32, y: i32, z: i32) -> u32 {
  let fx = f32(x);
  let fz = f32(z);
  let fy = f32(y);

  if (y == -64) { return BEDROCK; }

  // Dune terrain height
  let dunes = fbm2(vec2<f32>(fx, fz) * u.dune_scale) * u.dune_height
            + noise2(vec2<f32>(fx, fz) * u.dune_scale * 3.0) * u.dune_height * 0.3;
  let base_height = 60 + i32(dunes);

  // Check for nearby pyramid
  let grid = floor(vec2<f32>(fx, fz) * u.pyramid_freq);
  let cell_hash = hash2(grid * 17.3 + 5.7);

  var in_pyramid = false;
  if (cell_hash > 0.6) {
    let cell_center = (grid + 0.5) / u.pyramid_freq;
    let local_x = fx - cell_center.x;
    let local_z = fz - cell_center.y;
    let pyr_h = pyramid_sdf(local_x, fy - 61.0, local_z, u.pyramid_size);
    if (pyr_h < 0.0 && fy >= 61.0) {
      in_pyramid = true;
      // Hollow interior
      let inner = pyramid_sdf(local_x, fy - 62.0, local_z, u.pyramid_size - 3.0);
      if (inner < -1.0 && fy > 62.0) {
        // Treasure room
        if (fy == 63 && abs(local_x) < 3.0 && abs(local_z) < 3.0) {
          return GOLD_BLOCK;
        }
        if (fy == 63) { return SANDSTONE; }
        return AIR;
      }
      return SANDSTONE;
    }
  }

  // Oasis check (using different grid)
  let oasis_grid = floor(vec2<f32>(fx, fz) * 0.005);
  let oasis_hash = hash2(oasis_grid * 31.7 + 11.3);
  if (oasis_hash < u.oasis_chance) {
    let oasis_center = (oasis_grid + 0.5) / 0.005;
    let dist = length(vec2<f32>(fx, fz) - oasis_center);
    if (dist < 12.0) {
      let pool_depth = 3.0 * (1.0 - dist / 12.0);
      let water_level = 60;
      if (y <= water_level && y > water_level - i32(pool_depth)) {
        return WATER;
      }
      if (y == water_level - i32(pool_depth)) { return CLAY; }
      if (y == base_height && dist < 14.0) { return GRASS_BLOCK; }
    }
  }

  // Above terrain
  if (y > base_height) { return AIR; }

  // Surface
  if (y == base_height) { return SAND; }
  if (y > base_height - 4) { return SAND; }
  if (y > base_height - 8) { return SANDSTONE; }

  // Underground
  if (y < 0) {
    let r = hash3(vec3<f32>(fx * 0.7, fy, fz * 0.8));
    if (r < 0.006) { return GOLD_ORE; }
    return DEEPSLATE;
  }
  return STONE;
}`,
  },
  {
    id: "nether",
    name: "Nether Wastes",
    code: `// Nether-inspired terrain with lava seas and glowstone ceilings
// generate(x, y, z) → block state ID

// @param terrain_scale: slider(0.005, 0.04, 0.005) = 0.015
// @param lava_level: slider(20, 60, 1) = 32
// @param ceiling_height: slider(100, 200, 5) = 128
// @param glowstone_density: slider(0.0, 0.1, 0.01) = 0.04

fn hash2(p: vec2<f32>) -> f32 {
  var q = fract(p * vec2<f32>(123.34, 456.21));
  q += dot(q, q + 45.32);
  return fract(q.x * q.y);
}

fn noise2(p: vec2<f32>) -> f32 {
  let i = floor(p);
  let f = fract(p);
  let uu = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash2(i), hash2(i + vec2(1.0, 0.0)), uu.x),
             mix(hash2(i + vec2(0.0, 1.0)), hash2(i + vec2(1.0, 1.0)), uu.x), uu.y);
}

fn hash3(p: vec3<f32>) -> f32 {
  var q = fract(p * vec3<f32>(123.34, 456.21, 789.53));
  q += dot(q, q + 45.32);
  return fract(q.x * q.y * q.z);
}

fn noise3(p: vec3<f32>) -> f32 {
  let i = floor(p);
  let f = fract(p);
  let uu = f * f * (3.0 - 2.0 * f);
  let a = hash3(i); let b = hash3(i + vec3(1.0,0.0,0.0));
  let c = hash3(i + vec3(0.0,1.0,0.0)); let d = hash3(i + vec3(1.0,1.0,0.0));
  let e = hash3(i + vec3(0.0,0.0,1.0)); let f2 = hash3(i + vec3(1.0,0.0,1.0));
  let g = hash3(i + vec3(0.0,1.0,1.0)); let h = hash3(i + vec3(1.0,1.0,1.0));
  return mix(mix(mix(a,b,uu.x), mix(c,d,uu.x), uu.y),
             mix(mix(e,f2,uu.x), mix(g,h,uu.x), uu.y), uu.z);
}

fn fbm2(p: vec2<f32>) -> f32 {
  var v = 0.0; var a = 0.5; var pos = p;
  for (var i = 0; i < 5; i++) { v += a * noise2(pos); pos *= 2.0; a *= 0.5; }
  return v;
}

fn fbm3(p: vec3<f32>) -> f32 {
  var v = 0.0; var a = 0.5; var pos = p;
  for (var i = 0; i < 4; i++) { v += a * noise3(pos); pos *= 2.0; a *= 0.5; }
  return v;
}

fn generate(x: i32, y: i32, z: i32) -> u32 {
  let p = vec3<f32>(f32(x), f32(y), f32(z));
  let p2 = vec2<f32>(f32(x), f32(z));
  let ceil_y = i32(u.ceiling_height);
  let lava_y = i32(u.lava_level);

  if (y <= -64 + 3) { return BEDROCK; }

  // Floor terrain
  let floor_h = fbm2(p2 * u.terrain_scale) * 40.0 + 40.0;
  let floor_height = i32(floor_h);

  // Ceiling terrain (inverse)
  let ceil_h = fbm2(p2 * u.terrain_scale * 1.3 + 500.0) * 30.0;
  let ceil_start = ceil_y - i32(ceil_h);

  // Ceiling
  if (y >= ceil_start) {
    if (y >= ceil_y + 3) { return BEDROCK; }
    // Glowstone blobs on ceiling
    let gn = noise3(p * 0.1);
    if (gn > 1.0 - u.glowstone_density && y >= ceil_start && y < ceil_start + 3) {
      return GLOWSTONE;
    }
    return NETHERRACK;
  }

  // Nether caves (large open areas)
  let cave = fbm3(p * 0.02);
  let cave2 = noise3(p * 0.04 + 200.0);
  if (cave > 0.45 && cave2 > 0.35 && y > floor_height && y < ceil_start) {
    if (y <= lava_y) { return LAVA; }
    return AIR;
  }

  // Above floor terrain
  if (y > floor_height) {
    if (y <= lava_y) { return LAVA; }
    return AIR;
  }

  // Floor surface and underground
  if (y == floor_height) {
    let r = hash3(p * 0.5);
    if (r < 0.08) { return SOUL_SAND; }
    return NETHERRACK;
  }

  // Underground
  let r = hash3(p * 0.7);
  if (r < 0.003) { return GOLD_ORE; }
  if (r < 0.01) { return GLOWSTONE; }
  if (r < 0.05) { return SOUL_SAND; }
  return NETHERRACK;
}`,
  },
  {
    id: "pillars",
    name: "Stone Pillars",
    code: `// Massive stone pillars rising from a void with connecting bridges
// generate(x, y, z) → block state ID

// @param pillar_spacing: slider(20, 80, 5) = 40
// @param pillar_radius: slider(3, 20, 1) = 8
// @param pillar_top: slider(80, 200, 5) = 140
// @param bridge_width: slider(1, 6, 1) = 2
// @param water_level: slider(-60, 20, 5) = -20

fn hash2(p: vec2<f32>) -> f32 {
  var q = fract(p * vec2<f32>(123.34, 456.21));
  q += dot(q, q + 45.32);
  return fract(q.x * q.y);
}

fn noise2(p: vec2<f32>) -> f32 {
  let i = floor(p);
  let f = fract(p);
  let uu = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash2(i), hash2(i + vec2(1.0, 0.0)), uu.x),
             mix(hash2(i + vec2(0.0, 1.0)), hash2(i + vec2(1.0, 1.0)), uu.x), uu.y);
}

fn hash3(p: vec3<f32>) -> f32 {
  var q = fract(p * vec3<f32>(123.34, 456.21, 789.53));
  q += dot(q, q + 45.32);
  return fract(q.x * q.y * q.z);
}

// Find nearest pillar center and distance
fn nearest_pillar(px: f32, pz: f32) -> vec3<f32> {
  let spacing = u.pillar_spacing;
  let gx = round(px / spacing) * spacing;
  let gz = round(pz / spacing) * spacing;

  // Check 3x3 grid of candidates
  var best_dist = 9999.0;
  var best_x = gx;
  var best_z = gz;
  for (var dx = -1; dx <= 1; dx++) {
    for (var dz = -1; dz <= 1; dz++) {
      let cx = gx + f32(dx) * spacing;
      let cz = gz + f32(dz) * spacing;
      // Jitter center slightly
      let jx = cx + (hash2(vec2(cx, cz) * 0.1) - 0.5) * spacing * 0.3;
      let jz = cz + (hash2(vec2(cz, cx) * 0.1 + 77.0) - 0.5) * spacing * 0.3;
      let dist = length(vec2<f32>(px - jx, pz - jz));
      if (dist < best_dist) {
        best_dist = dist;
        best_x = jx;
        best_z = jz;
      }
    }
  }
  return vec3<f32>(best_x, best_z, best_dist);
}

fn generate(x: i32, y: i32, z: i32) -> u32 {
  let fx = f32(x);
  let fz = f32(z);
  let fy = f32(y);

  if (y == -64) { return BEDROCK; }
  if (y < -64) { return AIR; }

  let pillar = nearest_pillar(fx, fz);
  let pdist = pillar.z;
  let pcx = pillar.x;
  let pcz = pillar.y;

  // Pillar radius varies with height — wider at base, narrower at top
  let height_frac = (fy + 64.0) / (u.pillar_top + 64.0);
  let base_r = u.pillar_radius * (1.3 - 0.5 * height_frac);
  let r = base_r + noise2(vec2<f32>(fx, fz) * 0.1) * 2.0;

  // Pillar top height varies per pillar
  let pillar_hash = hash2(vec2<f32>(pcx, pcz) * 0.03);
  let top = i32(u.pillar_top * (0.6 + pillar_hash * 0.5));

  // Inside a pillar
  if (pdist < r && y <= top) {
    if (y == top) {
      // Flat top with grass
      if (pdist < r - 1.0) { return GRASS_BLOCK; }
      return STONE;
    }
    if (y > top - 3) { return DIRT; }
    if (y > top - 6) { return COBBLESTONE; }
    let rr = hash3(vec3<f32>(fx, fy, fz) * 0.5);
    if (rr < 0.03) { return IRON_ORE; }
    if (rr < 0.05) { return COAL_ORE; }
    return STONE;
  }

  // Bridges between adjacent pillars (at ~70% height)
  let bridge_y = i32(f32(top) * 0.7);
  if (abs(y - bridge_y) <= 0 && pdist >= r) {
    // Check bridge to each neighbor
    let spacing = u.pillar_spacing;
    let gx = round(fx / spacing) * spacing;
    let gz = round(fz / spacing) * spacing;
    for (var dx = -1; dx <= 1; dx++) {
      for (var dz = -1; dz <= 1; dz++) {
        if (dx == 0 && dz == 0) { continue; }
        let nx = gx + f32(dx) * spacing;
        let nz = gz + f32(dz) * spacing;
        let ncx = nx + (hash2(vec2(nx, nz) * 0.1) - 0.5) * spacing * 0.3;
        let ncz = nz + (hash2(vec2(nz, nx) * 0.1 + 77.0) - 0.5) * spacing * 0.3;
        let nh = hash2(vec2<f32>(ncx, ncz) * 0.03);
        if (nh < 0.3) { continue; } // Only some pillars have bridges
        // Line segment distance
        let a = vec2<f32>(pcx, pcz);
        let b = vec2<f32>(ncx, ncz);
        let p = vec2<f32>(fx, fz);
        let ab = b - a;
        let ap = p - a;
        let t = clamp(dot(ap, ab) / dot(ab, ab), 0.0, 1.0);
        let closest = a + t * ab;
        let line_dist = length(p - closest);
        if (line_dist < u.bridge_width) {
          return OAK_PLANKS;
        }
      }
    }
  }

  // Water at bottom
  if (y <= i32(u.water_level)) { return WATER; }

  return AIR;
}`,
  },
  {
    id: "checkerboard",
    name: "Infinite City",
    code: `// Procedural cityscape with buildings of varying heights
// generate(x, y, z) → block state ID

// @param block_size: slider(8, 32, 4) = 16
// @param street_width: slider(2, 6, 1) = 3
// @param max_height: slider(30, 200, 10) = 120
// @param min_height: slider(5, 30, 5) = 10

fn hash2(p: vec2<f32>) -> f32 {
  var q = fract(p * vec2<f32>(123.34, 456.21));
  q += dot(q, q + 45.32);
  return fract(q.x * q.y);
}

fn hash3(p: vec3<f32>) -> f32 {
  var q = fract(p * vec3<f32>(123.34, 456.21, 789.53));
  q += dot(q, q + 45.32);
  return fract(q.x * q.y * q.z);
}

fn generate(x: i32, y: i32, z: i32) -> u32 {
  let fx = f32(x);
  let fz = f32(z);
  let bs = u.block_size;
  let sw = u.street_width;

  // Grid cell
  let gx = floor(fx / bs);
  let gz = floor(fz / bs);
  let lx = ((fx % bs) + bs) % bs;
  let lz = ((fz % bs) + bs) % bs;

  if (y == -64) { return BEDROCK; }
  if (y < 60) { return STONE; }

  // Street
  let is_street = lx < sw || lz < sw;
  if (is_street) {
    if (y == 60) { return GRAY_CONCRETE; }
    if (y == 61 && (lx < 1.0 || lz < 1.0)) { return YELLOW_CONCRETE; } // Road markings
    return AIR;
  }

  // Building
  let cell = vec2<f32>(gx, gz);
  let bh_raw = hash2(cell * 7.13 + 3.7);
  let building_height = i32(u.min_height + bh_raw * (u.max_height - u.min_height)) + 60;
  let building_style = u32(hash2(cell * 13.7 + 9.1) * 4.0);

  if (y > building_height) {
    // Rooftop details
    if (y == building_height + 1) {
      let rx = lx - bs * 0.5;
      let rz = lz - bs * 0.5;
      if (abs(rx) < 2.0 && abs(rz) < 2.0) { return IRON_BLOCK; } // AC unit
    }
    return AIR;
  }

  // Building walls and interior
  let inner_x = lx - sw;
  let inner_z = lz - sw;
  let bw = bs - sw;
  let is_wall = inner_x < 1.0 || inner_z < 1.0 || inner_x > bw - 1.0 || inner_z > bw - 1.0;

  if (is_wall) {
    // Windows: every 4 blocks of height, offset 1
    let wy = (y - 62) % 4;
    if (wy >= 1 && wy <= 2 && y < building_height - 1) {
      let wx = (i32(inner_x) + i32(inner_z)) % 4;
      if (wx >= 1 && wx <= 2) {
        return LIGHT_BLUE_CONCRETE; // Window
      }
    }
    // Wall material varies by building
    switch building_style {
      case 0u: { return WHITE_CONCRETE; }
      case 1u: { return LIGHT_GRAY_CONCRETE; }
      case 2u: { return BROWN_CONCRETE; }
      default: { return GRAY_CONCRETE; }
    }
  }

  // Floors every 4 blocks
  if ((y - 61) % 4 == 0 && y > 61) { return OAK_PLANKS; }

  // Ground floor
  if (y == 61) { return OAK_PLANKS; }

  return AIR;
}`,
  },
];

function createBuiltIns(): ShaderPreset[] {
  return BUILTIN_PRESETS.map((bp) => ({
    id: bp.id,
    name: bp.name,
    code: bp.code,
    paramValues: {},
    builtIn: true,
    updatedAt: 0,
  }));
}

export function loadPresets(): ShaderPreset[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed: ShaderPreset[] = JSON.parse(raw);
      // Merge built-ins: ensure all exist, update code for built-ins
      const builtInIds = new Set(BUILTIN_PRESETS.map((b) => b.id));
      const userPresets = parsed.filter((p) => !p.builtIn && !builtInIds.has(p.id));
      return [...createBuiltIns(), ...userPresets];
    }
  } catch { /* ignore */ }
  return createBuiltIns();
}

export function savePresets(presets: ShaderPreset[]): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(presets));
}

export function createPreset(
  presets: ShaderPreset[],
  name: string,
  code: string,
  paramValues: Record<string, number>,
): ShaderPreset[] {
  const preset: ShaderPreset = {
    id: Date.now().toString(36),
    name,
    code,
    paramValues,
    builtIn: false,
    updatedAt: Date.now(),
  };
  const next = [...presets, preset];
  savePresets(next);
  return next;
}

export function updatePreset(
  presets: ShaderPreset[],
  id: string,
  code: string,
  paramValues: Record<string, number>,
): ShaderPreset[] {
  const next = presets.map((p) =>
    p.id === id ? { ...p, code, paramValues, updatedAt: Date.now() } : p,
  );
  savePresets(next);
  return next;
}

export function deletePreset(presets: ShaderPreset[], id: string): ShaderPreset[] {
  const next = presets.filter((p) => p.id !== id || p.builtIn);
  savePresets(next);
  return next;
}
