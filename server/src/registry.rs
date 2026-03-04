/// Builds all required Registry Data packets (0x07) for Configuration state.
///
/// Returns concatenated compressed packets for all required registries.

use crate::compression::compress_packet;
use crate::nbt::NbtWriter;
use crate::protocol::types::{write_string, write_varint};

/// Build a single Registry Data packet (0x07) payload.
fn build_registry_packet(registry_id: &str, entries: &[(&str, Option<Vec<u8>>)]) -> Vec<u8> {
    let mut payload = Vec::new();
    payload.extend_from_slice(&write_string(registry_id));
    payload.extend_from_slice(&write_varint(entries.len() as i32));

    for (entry_id, data) in entries {
        payload.extend_from_slice(&write_string(entry_id));
        if let Some(nbt_data) = data {
            payload.push(1); // has_data = true
            payload.extend_from_slice(nbt_data);
        } else {
            payload.push(0); // has_data = false
        }
    }

    payload
}

/// Build an empty registry packet (0 entries).
fn build_empty_registry(registry_id: &str) -> Vec<u8> {
    build_registry_packet(registry_id, &[])
}

fn build_dimension_type_registry() -> Vec<u8> {
    let mut nbt = NbtWriter::new();
    nbt.byte("has_skylight", 1);
    nbt.byte("has_ceiling", 0);
    nbt.byte("ultrawarm", 0);
    nbt.byte("natural", 1);
    nbt.double("coordinate_scale", 1.0);
    nbt.byte("bed_works", 1);
    nbt.byte("respawn_anchor_works", 0);
    nbt.int("min_y", -64);
    nbt.int("height", 384);
    nbt.int("logical_height", 384);
    nbt.string("infiniburn", "#minecraft:infiniburn_overworld");
    nbt.string("effects", "minecraft:overworld");
    nbt.float("ambient_light", 0.0);
    nbt.byte("piglin_safe", 0);
    nbt.byte("has_raids", 1);
    nbt.int("monster_spawn_light_level", 0);
    nbt.int("monster_spawn_block_light_limit", 0);
    let nbt_data = nbt.finish();

    build_registry_packet("minecraft:dimension_type", &[
        ("minecraft:overworld", Some(nbt_data)),
    ])
}

fn build_biome_registry() -> Vec<u8> {
    let mut nbt = NbtWriter::new();
    nbt.byte("has_precipitation", 1);
    nbt.float("temperature", 0.8);
    nbt.float("downfall", 0.4);
    nbt.begin_compound("effects");
    nbt.int("fog_color", 12638463);
    nbt.int("water_color", 4159204);
    nbt.int("water_fog_color", 329011);
    nbt.int("sky_color", 7907327);
    nbt.int("grass_color", 7842607);    // 0x77AB2F — plains grass
    nbt.int("foliage_color", 4764952);  // 0x48B518 — plains foliage
    nbt.begin_compound("mood_sound");
    nbt.string("sound", "minecraft:ambient.cave");
    nbt.int("tick_delay", 6000);
    nbt.double("offset", 2.0);
    nbt.int("block_search_extent", 8);
    nbt.end_compound(); // mood_sound
    nbt.end_compound(); // effects
    let nbt_data = nbt.finish();

    build_registry_packet("minecraft:worldgen/biome", &[
        ("minecraft:plains", Some(nbt_data)),
    ])
}

fn build_damage_type_entry(message_id: &str, exhaustion: f32, scaling: &str) -> Vec<u8> {
    let mut nbt = NbtWriter::new();
    nbt.string("message_id", message_id);
    nbt.float("exhaustion", exhaustion);
    nbt.string("scaling", scaling);
    nbt.finish()
}

fn build_damage_type_registry() -> Vec<u8> {
    let damage_types: Vec<(&str, &str, f32, &str)> = vec![
        ("minecraft:generic", "generic", 0.0, "when_caused_by_living_non_player"),
        ("minecraft:generic_kill", "genericKill", 0.0, "never"),
        ("minecraft:in_fire", "inFire", 0.1, "when_caused_by_living_non_player"),
        ("minecraft:on_fire", "onFire", 0.0, "never"),
        ("minecraft:lava", "lava", 0.1, "when_caused_by_living_non_player"),
        ("minecraft:hot_floor", "hotFloor", 0.1, "when_caused_by_living_non_player"),
        ("minecraft:in_wall", "inWall", 0.0, "never"),
        ("minecraft:cramming", "cramming", 0.0, "never"),
        ("minecraft:drown", "drown", 0.0, "never"),
        ("minecraft:starve", "starve", 0.0, "never"),
        ("minecraft:cactus", "cactus", 0.1, "when_caused_by_living_non_player"),
        ("minecraft:fall", "fall", 0.0, "when_caused_by_living_non_player"),
        ("minecraft:fly_into_wall", "flyIntoWall", 0.0, "never"),
        ("minecraft:out_of_world", "outOfWorld", 0.0, "never"),
        ("minecraft:magic", "magic", 0.0, "never"),
        ("minecraft:dry_out", "dryOut", 0.1, "never"),
        ("minecraft:freeze", "freeze", 0.0, "never"),
        ("minecraft:lightning_bolt", "lightningBolt", 0.1, "when_caused_by_living_non_player"),
        ("minecraft:sweet_berry_bush", "sweetBerryBush", 0.1, "when_caused_by_living_non_player"),
        ("minecraft:outside_border", "outsideBorder", 0.0, "never"),
        ("minecraft:stalagmite", "stalagmite", 0.0, "when_caused_by_living_non_player"),
        ("minecraft:campfire", "campfire", 0.1, "when_caused_by_living_non_player"),
        ("minecraft:wither", "wither", 0.0, "never"),
        ("minecraft:dragon_breath", "dragonBreath", 0.0, "never"),
        ("minecraft:ender_pearl", "fall", 0.0, "when_caused_by_living_non_player"),
    ];

    let entries: Vec<(&str, Option<Vec<u8>>)> = damage_types
        .iter()
        .map(|(id, msg, exh, scaling)| {
            (*id, Some(build_damage_type_entry(msg, *exh, scaling)))
        })
        .collect();

    build_registry_packet("minecraft:damage_type", &entries)
}

fn build_painting_variant_registry() -> Vec<u8> {
    let mut nbt = NbtWriter::new();
    nbt.string("asset_id", "minecraft:kebab");
    nbt.int("width", 1);
    nbt.int("height", 1);
    let nbt_data = nbt.finish();

    build_registry_packet("minecraft:painting_variant", &[
        ("minecraft:kebab", Some(nbt_data)),
    ])
}

// --- Animal variant registries (must be non-empty in protocol 774) ---

const TAG_COMPOUND: u8 = 0x0A;

/// Helper: build a simple mob variant with asset_id + empty spawn_conditions
fn build_simple_variant(asset_id: &str) -> Vec<u8> {
    let mut nbt = NbtWriter::new();
    nbt.string("asset_id", asset_id);
    nbt.begin_list("spawn_conditions", TAG_COMPOUND, 0);
    nbt.finish()
}

/// Helper: build a mob variant with asset_id, model, + empty spawn_conditions
fn build_model_variant(asset_id: &str, model: &str) -> Vec<u8> {
    let mut nbt = NbtWriter::new();
    nbt.string("asset_id", asset_id);
    nbt.string("model", model);
    nbt.begin_list("spawn_conditions", TAG_COMPOUND, 0);
    nbt.finish()
}

fn build_cat_variant_registry() -> Vec<u8> {
    build_registry_packet("minecraft:cat_variant", &[
        ("minecraft:tabby", Some(build_simple_variant("minecraft:entity/cat/tabby"))),
    ])
}

fn build_chicken_variant_registry() -> Vec<u8> {
    build_registry_packet("minecraft:chicken_variant", &[
        ("minecraft:temperate", Some(build_model_variant("minecraft:entity/chicken/temperate", "normal"))),
    ])
}

fn build_cow_variant_registry() -> Vec<u8> {
    build_registry_packet("minecraft:cow_variant", &[
        ("minecraft:temperate", Some(build_model_variant("minecraft:entity/cow/temperate", "normal"))),
    ])
}

fn build_frog_variant_registry() -> Vec<u8> {
    build_registry_packet("minecraft:frog_variant", &[
        ("minecraft:temperate", Some(build_simple_variant("minecraft:entity/frog/temperate"))),
    ])
}

fn build_pig_variant_registry() -> Vec<u8> {
    build_registry_packet("minecraft:pig_variant", &[
        ("minecraft:temperate", Some(build_model_variant("minecraft:entity/pig/temperate", "normal"))),
    ])
}

fn build_wolf_variant_registry() -> Vec<u8> {
    let mut nbt = NbtWriter::new();
    nbt.begin_compound("assets");
    nbt.string("wild", "minecraft:entity/wolf/wolf");
    nbt.string("tame", "minecraft:entity/wolf/wolf_tame");
    nbt.string("angry", "minecraft:entity/wolf/wolf_angry");
    nbt.end_compound();
    nbt.begin_list("spawn_conditions", TAG_COMPOUND, 0);
    let nbt_data = nbt.finish();

    build_registry_packet("minecraft:wolf_variant", &[
        ("minecraft:pale", Some(nbt_data)),
    ])
}

fn build_wolf_sound_variant_registry() -> Vec<u8> {
    let mut nbt = NbtWriter::new();
    nbt.string("ambient_sound", "minecraft:entity.wolf.ambient");
    nbt.string("death_sound", "minecraft:entity.wolf.death");
    nbt.string("growl_sound", "minecraft:entity.wolf.growl");
    nbt.string("hurt_sound", "minecraft:entity.wolf.hurt");
    nbt.string("pant_sound", "minecraft:entity.wolf.pant");
    nbt.string("whine_sound", "minecraft:entity.wolf.whine");
    let nbt_data = nbt.finish();

    build_registry_packet("minecraft:wolf_sound_variant", &[
        ("minecraft:classic", Some(nbt_data)),
    ])
}

fn build_zombie_nautilus_variant_registry() -> Vec<u8> {
    build_registry_packet("minecraft:zombie_nautilus_variant", &[
        ("minecraft:default", Some(build_model_variant("minecraft:entity/zombie_nautilus/default", "normal"))),
    ])
}

/// Build all registry data as concatenated compressed packets.
pub fn build_all_registry_packets(threshold: i32) -> Vec<u8> {
    let mut result = Vec::new();

    let registries = vec![
        build_dimension_type_registry(),
        build_biome_registry(),
        build_damage_type_registry(),
        build_painting_variant_registry(),
        // Animal variant registries (must be non-empty in protocol 774)
        build_cat_variant_registry(),
        build_chicken_variant_registry(),
        build_cow_variant_registry(),
        build_frog_variant_registry(),
        build_pig_variant_registry(),
        build_wolf_variant_registry(),
        build_wolf_sound_variant_registry(),
        build_zombie_nautilus_variant_registry(),
        // Empty registries — required to be sent but can have 0 entries
        build_empty_registry("minecraft:banner_pattern"),
        build_empty_registry("minecraft:chat_type"),
        build_empty_registry("minecraft:enchantment"),
        build_empty_registry("minecraft:instrument"),
        build_empty_registry("minecraft:jukebox_song"),
        build_empty_registry("minecraft:trim_material"),
        build_empty_registry("minecraft:trim_pattern"),
    ];

    for payload in registries {
        result.extend_from_slice(&compress_packet(0x07, &payload, threshold));
    }

    result
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::protocol::types::read_varint;

    #[test]
    fn test_empty_registry_packet() {
        let payload = build_empty_registry("minecraft:test");
        // Should contain: string "minecraft:test" + varint 0
        let (name, name_end) = crate::protocol::types::read_string(&payload);
        assert_eq!(name, "minecraft:test");
        let (count, _) = read_varint(&payload[name_end..]);
        assert_eq!(count, 0);
    }

    #[test]
    fn test_dimension_type_has_one_entry() {
        let payload = build_dimension_type_registry();
        let (name, name_end) = crate::protocol::types::read_string(&payload);
        assert_eq!(name, "minecraft:dimension_type");
        let (count, _) = read_varint(&payload[name_end..]);
        assert_eq!(count, 1);
    }

    #[test]
    fn test_damage_type_has_25_entries() {
        let payload = build_damage_type_registry();
        let (name, name_end) = crate::protocol::types::read_string(&payload);
        assert_eq!(name, "minecraft:damage_type");
        let (count, _) = read_varint(&payload[name_end..]);
        assert_eq!(count, 25);
    }

    #[test]
    fn test_all_registries_produce_bytes() {
        let result = build_all_registry_packets(256);
        // Should be non-empty — contains at least 14 registry packets
        assert!(result.len() > 100);
    }
}
