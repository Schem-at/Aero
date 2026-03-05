use crate::compression::compress_packet;
use crate::logging::{LogCategory, LogLevel};
use crate::protocol::handler::{HandlerContext, PacketHandler, PacketResult};
use crate::protocol::types::read_string;
use crate::world;

pub struct ChatCommandHandler;

impl PacketHandler for ChatCommandHandler {
    fn handle(&self, payload: &[u8], ctx: &mut HandlerContext) -> PacketResult {
        let (command, _) = read_string(payload);
        let username = ctx
            .login_data
            .as_ref()
            .map(|d| d.username.as_str())
            .unwrap_or("Unknown");
        ctx.log(
            LogLevel::Info,
            LogCategory::Chat,
            &format!("<{}> /{}", username, command),
        );

        let threshold = ctx.compression_threshold.unwrap_or(256);
        let parts: Vec<&str> = command.splitn(2, ' ').collect();
        let cmd = parts[0];
        let args = if parts.len() > 1 { parts[1] } else { "" };

        match cmd {
            "speed" => handle_speed(args, ctx, threshold),
            "fly" => handle_fly(ctx, threshold),
            "time" => handle_time(args, ctx, threshold),
            "tp" => handle_tp(args, ctx, threshold),
            "gamemode" | "gm" => handle_gamemode(args, ctx, threshold),
            "help" => handle_help(ctx, threshold),
            _ => {
                let msg = format!("Unknown command: /{}", cmd);
                let chat = compress_packet(0x77, &world::build_system_chat_payload(&msg), threshold);
                PacketResult::RawResponse(chat)
            }
        }
    }

    fn name(&self) -> &'static str {
        "Chat Command"
    }
}

fn handle_speed(args: &str, ctx: &mut HandlerContext, threshold: i32) -> PacketResult {
    let value: f32 = match args.trim().parse() {
        Ok(v) => v,
        Err(_) => {
            let msg = "Usage: /speed <0.0-10.0>";
            let chat = compress_packet(0x77, &world::build_system_chat_payload(msg), threshold);
            return PacketResult::RawResponse(chat);
        }
    };

    let clamped = value.clamp(0.0, 10.0);
    // Minecraft fly speed: 0.05 is default, max is ~1.0 in vanilla
    // We divide by 20 to convert user-friendly 1.0=default, 10.0=fast to protocol values
    let protocol_speed = clamped * 0.05;
    *ctx.fly_speed = protocol_speed;

    let mut response = Vec::new();
    // Send updated Player Abilities
    response.extend_from_slice(&compress_packet(
        0x3E,
        &world::build_player_abilities(protocol_speed, *ctx.is_flying),
        threshold,
    ));
    // Confirm with chat
    let msg = format!("Flight speed set to {:.1}", clamped);
    ctx.log(LogLevel::Info, LogCategory::Chat, &format!("[Server] {}", msg));
    response.extend_from_slice(&compress_packet(0x77, &world::build_system_chat_payload(&msg), threshold));
    PacketResult::RawResponse(response)
}

fn handle_fly(ctx: &mut HandlerContext, threshold: i32) -> PacketResult {
    *ctx.is_flying = !*ctx.is_flying;

    let mut response = Vec::new();
    response.extend_from_slice(&compress_packet(
        0x3E,
        &world::build_player_abilities(*ctx.fly_speed, *ctx.is_flying),
        threshold,
    ));
    let msg = if *ctx.is_flying { "Flying enabled" } else { "Flying disabled" };
    ctx.log(LogLevel::Info, LogCategory::Chat, &format!("[Server] {}", msg));
    response.extend_from_slice(&compress_packet(0x77, &world::build_system_chat_payload(msg), threshold));
    PacketResult::RawResponse(response)
}

fn handle_time(args: &str, ctx: &mut HandlerContext, threshold: i32) -> PacketResult {
    let time: i64 = match args.trim() {
        "day" => 1000,
        "night" => 13000,
        "noon" => 6000,
        "midnight" => 18000,
        s => match s.parse::<i64>() {
            Ok(t) => t.clamp(0, 24000),
            Err(_) => {
                let msg = "Usage: /time <day|night|noon|midnight|ticks>";
                let chat = compress_packet(0x77, &world::build_system_chat_payload(msg), threshold);
                return PacketResult::RawResponse(chat);
            }
        },
    };

    let mut response = Vec::new();
    response.extend_from_slice(&compress_packet(
        0x6F,
        &world::build_set_time(0, time, true),
        threshold,
    ));
    let msg = format!("Time set to {}", time);
    ctx.log(LogLevel::Info, LogCategory::Chat, &format!("[Server] {}", msg));
    response.extend_from_slice(&compress_packet(0x77, &world::build_system_chat_payload(&msg), threshold));
    PacketResult::RawResponse(response)
}

fn teleport_to_coords(x: f64, y: f64, z: f64, ctx: &mut HandlerContext, threshold: i32) -> PacketResult {
    *ctx.player_x = x;
    *ctx.player_y = y;
    *ctx.player_z = z;
    *ctx.position_dirty = true;

    let chunk_x = (x.floor() as i32) >> 4;
    let chunk_z = (z.floor() as i32) >> 4;
    *ctx.player_chunk_x = chunk_x;
    *ctx.player_chunk_z = chunk_z;
    *ctx.pending_chunk_center = Some((chunk_x, chunk_z));
    *ctx.awaiting_chunks = true;

    let mut response = Vec::new();
    let mut view_pos = Vec::new();
    view_pos.extend_from_slice(&crate::protocol::types::write_varint(chunk_x));
    view_pos.extend_from_slice(&crate::protocol::types::write_varint(chunk_z));
    response.extend_from_slice(&compress_packet(0x5C, &view_pos, threshold));
    response.extend_from_slice(&compress_packet(
        0x46,
        &world::build_sync_player_position_at(x, y, z, *ctx.player_yaw, *ctx.player_pitch),
        threshold,
    ));
    let msg = format!("Teleported to {:.1} {:.1} {:.1}", x, y, z);
    ctx.log(LogLevel::Info, LogCategory::Chat, &format!("[Server] {}", msg));
    response.extend_from_slice(&compress_packet(0x77, &world::build_system_chat_payload(&msg), threshold));
    PacketResult::RawResponse(response)
}

fn handle_tp(args: &str, ctx: &mut HandlerContext, threshold: i32) -> PacketResult {
    let parts: Vec<&str> = args.trim().split_whitespace().collect();

    match parts.len() {
        // /tp <player> — deferred to JS worker for cross-connection lookup
        1 => {
            let target = parts[0];
            // If it parses as a number, it's not a player name
            if target.parse::<f64>().is_ok() {
                let msg = "Usage: /tp <player> or /tp <x> <y> <z>";
                let chat = compress_packet(0x77, &world::build_system_chat_payload(msg), threshold);
                return PacketResult::RawResponse(chat);
            }
            // Store for the JS worker to resolve
            *ctx.pending_tp_target = Some(target.to_string());
            PacketResult::None
        }
        // /tp <x> <y> <z>
        3 => {
            let x: f64 = match parts[0].parse() {
                Ok(v) => v,
                Err(_) => {
                    let msg = "Usage: /tp <player> or /tp <x> <y> <z>";
                    let chat = compress_packet(0x77, &world::build_system_chat_payload(msg), threshold);
                    return PacketResult::RawResponse(chat);
                }
            };
            let y: f64 = match parts[1].parse() {
                Ok(v) => v,
                Err(_) => {
                    let msg = "Usage: /tp <player> or /tp <x> <y> <z>";
                    let chat = compress_packet(0x77, &world::build_system_chat_payload(msg), threshold);
                    return PacketResult::RawResponse(chat);
                }
            };
            let z: f64 = match parts[2].parse() {
                Ok(v) => v,
                Err(_) => {
                    let msg = "Usage: /tp <player> or /tp <x> <y> <z>";
                    let chat = compress_packet(0x77, &world::build_system_chat_payload(msg), threshold);
                    return PacketResult::RawResponse(chat);
                }
            };
            teleport_to_coords(x, y, z, ctx, threshold)
        }
        _ => {
            let msg = "Usage: /tp <player> or /tp <x> <y> <z>";
            let chat = compress_packet(0x77, &world::build_system_chat_payload(msg), threshold);
            PacketResult::RawResponse(chat)
        }
    }
}

fn handle_gamemode(args: &str, ctx: &mut HandlerContext, threshold: i32) -> PacketResult {
    let gm = match args.trim() {
        "survival" | "s" | "0" => 0u8,
        "creative" | "c" | "1" => 1,
        "adventure" | "a" | "2" => 2,
        "spectator" | "sp" | "3" => 3,
        _ => {
            let msg = "Usage: /gamemode <survival|creative|adventure|spectator>";
            let chat = compress_packet(0x77, &world::build_system_chat_payload(msg), threshold);
            return PacketResult::RawResponse(chat);
        }
    };

    *ctx.gamemode = gm;
    *ctx.health = 20.0;

    let mut response = Vec::new();

    // Game Event: Change Game Mode (event=3, value=gamemode)
    response.extend_from_slice(&compress_packet(
        0x26,
        &world::build_game_event(3, gm as f32),
        threshold,
    ));

    // Update Player Abilities based on gamemode
    let (allow_fly, invulnerable) = match gm {
        0 => (false, false), // Survival
        1 => (true, true),   // Creative
        2 => (false, false), // Adventure
        3 => (true, true),   // Spectator
        _ => (false, false),
    };
    let flags: u8 = if invulnerable { 0x01 } else { 0 }
        | if *ctx.is_flying && allow_fly { 0x02 } else { 0 }
        | if allow_fly { 0x04 } else { 0 }
        | if gm == 1 { 0x08 } else { 0 }; // creative = instant break

    // Build Player Abilities packet manually (flags, fly_speed, walk_speed)
    let mut abilities = Vec::new();
    abilities.push(flags);
    abilities.extend_from_slice(&ctx.fly_speed.to_be_bytes());
    abilities.extend_from_slice(&0.1f32.to_be_bytes()); // walk speed
    response.extend_from_slice(&compress_packet(0x3E, &abilities, threshold));

    // If switching to survival, disable flying
    if !allow_fly && *ctx.is_flying {
        *ctx.is_flying = false;
    }

    // Send health update for survival
    let health_payload = world::build_set_health_payload(*ctx.health, 20, 5.0);
    response.extend_from_slice(&compress_packet(0x66, &health_payload, threshold));

    let gm_name = match gm {
        0 => "Survival",
        1 => "Creative",
        2 => "Adventure",
        3 => "Spectator",
        _ => "Unknown",
    };
    let msg = format!("Game mode set to {}", gm_name);
    ctx.log(LogLevel::Info, LogCategory::Chat, &format!("[Server] {}", msg));
    response.extend_from_slice(&compress_packet(0x77, &world::build_system_chat_payload(&msg), threshold));
    PacketResult::RawResponse(response)
}

fn handle_help(ctx: &mut HandlerContext, threshold: i32) -> PacketResult {
    let msg = "Commands: /speed <0-10>, /fly, /tp <player|x y z>, /time <day|night|noon|midnight|ticks>, /gamemode <survival|creative>, /help";
    ctx.log(LogLevel::Info, LogCategory::Chat, &format!("[Server] {}", msg));
    let chat = compress_packet(0x77, &world::build_system_chat_payload(msg), threshold);
    PacketResult::RawResponse(chat)
}
