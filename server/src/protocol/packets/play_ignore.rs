//! Generic silent/logging handlers for Play C→S packets we don't need to respond to.

use crate::protocol::handler::{HandlerContext, PacketHandler, PacketResult};

/// A handler that logs the packet name but takes no action.
pub struct LogHandler {
    pub name: &'static str,
}

impl PacketHandler for LogHandler {
    fn handle(&self, _payload: &[u8], _ctx: &mut HandlerContext) -> PacketResult {
        PacketResult::None
    }
    fn name(&self) -> &'static str {
        self.name
    }
}

/// A handler that silently ignores the packet (no log entry in packet inspector).
pub struct SilentHandler {
    pub name: &'static str,
}

impl PacketHandler for SilentHandler {
    fn handle(&self, _payload: &[u8], _ctx: &mut HandlerContext) -> PacketResult {
        PacketResult::None
    }
    fn name(&self) -> &'static str {
        self.name
    }
    fn silent(&self) -> bool {
        true
    }
}
