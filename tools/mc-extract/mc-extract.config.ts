export default {
  version: "1.21.11",
  projectRoot: "../../",
  outputs: {
    rustPacketIds: "server/src/protocol/packet_ids.rs",
    rustEntityIds: "server/src/protocol/entity_ids.rs",
    tsItemBlockMap: "web/src/lib/generated/item-block-map.ts",
    tsBlockIds: "web/src/lib/generated/block-ids.ts",
    wgslBlockConstants: "web/src/plugins/shader-generator/generated/block-constants.wgsl.ts",
    tsProtocolMeta: "web/src/lib/generated/protocol-meta.ts",
    rustBlockRegistry: "server/src/block_registry.rs",
    tsPacketNames: "web/src/lib/generated/packet-names.ts",
    tsPacketSchemas: "web/src/lib/generated/packet-schemas.ts",
  },
};
