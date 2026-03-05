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

fn handle_help(ctx: &mut HandlerContext, threshold: i32) -> PacketResult {
    let msg = "Commands: /speed <0-10>, /fly, /time <day|night|noon|midnight|ticks>, /help";
    ctx.log(LogLevel::Info, LogCategory::Chat, &format!("[Server] {}", msg));
    let chat = compress_packet(0x77, &world::build_system_chat_payload(msg), threshold);
    PacketResult::RawResponse(chat)
}
