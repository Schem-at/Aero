# mc-extract

Auto-generates typed protocol constants from [PrismarineJS minecraft-data](https://github.com/PrismarineJS/minecraft-data), keeping Minecraft protocol data in sync across the Rust server and TypeScript frontend.

## Quick Start

```bash
# Install dependencies (first time only)
cd tools/mc-extract && bun install

# Generate all files
./scripts/generate-protocol.sh

# Or with options
./scripts/generate-protocol.sh --version 1.21.11 --dry-run
./scripts/generate-protocol.sh --generators packets,entities
```

## Generated Files

| File | Description |
|------|-------------|
| `server/src/protocol/packet_ids.rs` | All packet IDs organized by `serverbound`/`clientbound` > state > constant |
| `server/src/protocol/entity_ids.rs` | Entity type ID constants (e.g., `PLAYER = 155`) |
| `web/src/lib/generated/block-ids.ts` | Block default state IDs as `BlockState` const object |
| `web/src/lib/generated/item-block-map.ts` | Item ID to block state ID mappings |
| `web/src/lib/generated/protocol-meta.ts` | `PROTOCOL_VERSION` and `MINECRAFT_VERSION` exports |
| `web/src/plugins/shader-generator/generated/block-constants.wgsl.ts` | WGSL `const` declarations for shader block IDs |

## CLI Options

```
bun run tools/mc-extract/src/cli.ts [options]

Options:
  --version <ver>       Minecraft version (default: from config)
  --dry-run             Show what would be generated without writing
  --generators <list>   Comma-separated generator names:
                        packets, entities, item-block-map,
                        block-ids, wgsl-blocks, protocol-meta
```

## Updating to a New Minecraft Version

1. Update `version` in `tools/mc-extract/mc-extract.config.ts`
2. Run `./scripts/generate-protocol.sh`
3. Run `cargo check` and `bun run build` to verify
4. Update any manual protocol changes not covered by the generator

## Architecture

```
tools/mc-extract/
  mc-extract.config.ts      # Output paths + default version
  src/
    cli.ts                  # CLI entry point
    data-loader.ts          # Loads minecraft-data npm package
    types.ts                # Shared TypeScript interfaces
    cli.test.ts             # Tests (bun test)
    generators/
      index.ts              # Registry + shared utilities
      rust-packet-ids.ts    # Parses ProtoDef protocol mappings
      rust-entity-ids.ts    # Iterates entity array
      ts-block-ids.ts       # Block defaultState constants
      ts-item-block-map.ts  # Cross-references items with blocks
      ts-protocol-meta.ts   # Version constants
      wgsl-block-constants.ts  # WGSL shader block IDs
```

## Naming Convention

Packet constant names come from PrismarineJS and use legacy Minecraft naming for backwards compatibility. Some names differ from the modern wiki (e.g., `ENCHANT_ITEM` = Close Container, `TAB_COMPLETE` = Command Suggestion). The numeric values are always correct for the specified protocol version.

## Tests

```bash
cd tools/mc-extract && bun test
```

Or via the project test runner:

```bash
./scripts/test.sh
```
