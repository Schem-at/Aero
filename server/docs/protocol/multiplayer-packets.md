# Multiplayer Packets — Protocol 774 (Minecraft 1.21.11)

Reference sourced from [Pumpkin-MC/Pumpkin](https://github.com/Pumpkin-MC/Pumpkin) and
[PrismarineJS/minecraft-data](https://github.com/PrismarineJS/minecraft-data/tree/master/data/pc/1.21.11).

## Entity Type IDs

| Entity          | Type ID |
|-----------------|---------|
| minecraft:player | 155     |

---

## Spawn Entity (0x01) — `CSpawnEntity`

Sent when an entity enters the client's view range.

| # | Field      | Type     | Notes                                    |
|---|------------|----------|------------------------------------------|
| 1 | entity_id  | VarInt   |                                          |
| 2 | uuid       | UUID     | 16 bytes                                 |
| 3 | type       | VarInt   | Entity type registry ID (player = 155)   |
| 4 | x          | f64      |                                          |
| 5 | y          | f64      |                                          |
| 6 | z          | f64      |                                          |
| 7 | velocity   | lpVec3   | Packed velocity; `0x00` for zero vector  |
| 8 | pitch      | Angle    | u8, (degrees × 256 / 360)               |
| 9 | yaw        | Angle    | u8                                       |
| 10| head_yaw   | Angle    | u8                                       |
| 11| data       | VarInt   | 0 for players                            |

**Protocol change (≥773 / 1.21.9):** Velocity moved from 3×i16 after `data` to
lpVec3 before the angles.

### lpVec3 (Low-Precision Vector3)

Encodes three doubles in 1–8 bytes. Used in Spawn Entity and Entity Velocity.

**Zero vector:** Single byte `0x00`.

**Non-zero encoding (typically 6 bytes):**

```
Packed data (48 bits):
  bits  0– 1  scale_factor & 3
  bit   2     is_extended (1 if scale_factor > 3)
  bits  3–17  quantized X (15 bits)
  bits 18–32  quantized Y (15 bits)
  bits 33–47  quantized Z (15 bits)

Wire format:
  u16 LE  (low 16 bits)
  i32 BE  (bits 16–47)
  [VarInt  scale_factor >> 2, only if is_extended]

Quantize:
  scale = ceil(max(|x|, |y|, |z|))
  q(v)  = round((v / scale * 0.5 + 0.5) * 32766)

Dequantize:
  v = (min(q & 0x7FFF, 32766) * 2.0 / 32766.0 - 1.0) * scale
```

---

## Entity Teleport (0x7B) — `CTeleportEntity`

Absolute position update for entities.

| # | Field     | Type   | Notes                           |
|---|-----------|--------|---------------------------------|
| 1 | entity_id | VarInt |                                 |
| 2 | x         | f64    |                                 |
| 3 | y         | f64    |                                 |
| 4 | z         | f64    |                                 |
| 5 | yaw       | Angle  | u8                              |
| 6 | pitch     | Angle  | u8                              |
| 7 | on_ground | bool   |                                 |

Source: PrismarineJS `packet_entity_teleport` for 1.21.11.

> **Note:** Pumpkin's `CTeleportEntity` has additional delta/relatives fields and is
> documented as "only used for vehicle teleports." For general entity movement
> the vanilla server uses Entity Position Sync (0x23) which has deltas and f32 angles.

---

## Entity Position Sync (0x23)

Periodic full position synchronisation. Newer packet (added protocol 768 / 1.21.2).

| # | Field     | Type   | Notes                           |
|---|-----------|--------|---------------------------------|
| 1 | entity_id | VarInt |                                 |
| 2 | x         | f64    |                                 |
| 3 | y         | f64    |                                 |
| 4 | z         | f64    |                                 |
| 5 | dx        | f64    | Velocity delta                  |
| 6 | dy        | f64    |                                 |
| 7 | dz        | f64    |                                 |
| 8 | yaw       | f32    |                                 |
| 9 | pitch     | f32    |                                 |
| 10| on_ground | bool   |                                 |

---

## Set Head Rotation (0x51) — `CHeadRot`

| # | Field     | Type   |
|---|-----------|--------|
| 1 | entity_id | VarInt |
| 2 | head_yaw  | Angle  |

---

## Remove Entities (0x4B) — `CRemoveEntities`

| # | Field      | Type      |
|---|------------|-----------|
| 1 | count      | VarInt    |
| 2 | entity_ids | VarInt[]  |

---

## Entity Velocity (0x63) — `CEntityVelocity`

| # | Field     | Type     | Notes                          |
|---|-----------|----------|--------------------------------|
| 1 | entity_id | VarInt   |                                |
| 2 | velocity  | lpVec3   | Same packed format as above    |

**Legacy (protocol ≤ 772):** 3× i16 BE, each `(component.clamp(-3.9, 3.9) * 8000)`.

---

## Player Info Update (0x44) — `CPlayerInfoUpdate`

| # | Field   | Type          | Notes                  |
|---|---------|---------------|------------------------|
| 1 | actions | u8            | Bitmask of actions     |
| 2 | count   | VarInt        | Number of entries      |
| 3 | entries | PlayerEntry[] | Per-player data        |

### Action bitmask

| Bit | Value | Action              |
|-----|-------|---------------------|
| 0   | 0x01  | ADD_PLAYER          |
| 1   | 0x02  | INITIALIZE_CHAT     |
| 2   | 0x04  | UPDATE_GAME_MODE    |
| 3   | 0x08  | UPDATE_LISTED       |
| 4   | 0x10  | UPDATE_LATENCY      |
| 5   | 0x20  | UPDATE_DISPLAY_NAME |
| 6   | 0x40  | UPDATE_LIST_PRIORITY|
| 7   | 0x80  | UPDATE_HAT          |

### PlayerEntry

| Field      | Type                                       | Present when       |
|------------|--------------------------------------------|--------------------|
| uuid       | UUID                                       | Always             |
| name       | String                                     | ADD_PLAYER         |
| properties | VarInt count + {name, value, sig?}[]       | ADD_PLAYER         |
| game_mode  | VarInt                                     | UPDATE_GAME_MODE   |
| listed     | bool                                       | UPDATE_LISTED      |
| latency    | VarInt                                     | UPDATE_LATENCY     |

Fields appear in bitmask order. Only fields whose action bit is set are present.

---

## Player Info Remove (0x43) — `CRemovePlayerInfo`

| # | Field   | Type    |
|---|---------|---------|
| 1 | count   | VarInt  |
| 2 | uuids   | UUID[]  |

---

## System Chat Message (0x77) — `CSystemChatMessage`

| # | Field   | Type          | Notes                              |
|---|---------|--------------|------------------------------------|
| 1 | content | TextComponent | NBT-encoded (TAG_String for plain) |
| 2 | overlay | bool          | false = chat, true = action bar    |

---

## Angle Encoding

```
angle_byte = floor(degrees * 256.0 / 360.0) as u8
degrees    = angle_byte as f32 * 360.0 / 256.0
```
