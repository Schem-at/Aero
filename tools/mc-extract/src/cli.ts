import { resolve, dirname } from "path";
import { mkdirSync, writeFileSync } from "fs";
import { loadMinecraftData } from "./data-loader.js";
import config from "../mc-extract.config.js";
import {
  generateRustPacketIds,
  generateRustEntityIds,
  generateTsItemBlockMap,
  generateTsBlockIds,
  generateWgslBlockConstants,
  generateTsProtocolMeta,
  generateRustBlockRegistry,
  generateTsPacketNames,
} from "./generators/index.js";
import type { Generator } from "./generators/index.js";

const GENERATORS: Record<string, Generator> = {
  packets: generateRustPacketIds,
  entities: generateRustEntityIds,
  "item-block-map": generateTsItemBlockMap,
  "block-ids": generateTsBlockIds,
  "wgsl-blocks": generateWgslBlockConstants,
  "protocol-meta": generateTsProtocolMeta,
  "block-registry": generateRustBlockRegistry,
  "packet-names": generateTsPacketNames,
};

function parseArgs() {
  const args = process.argv.slice(2);
  let version = config.version;
  let dryRun = false;
  let generators: string[] | null = null;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--version" && args[i + 1]) {
      version = args[++i];
    } else if (args[i] === "--dry-run") {
      dryRun = true;
    } else if (args[i] === "--generators" && args[i + 1]) {
      generators = args[++i].split(",");
    }
  }

  return { version, dryRun, generators };
}

function main() {
  const { version, dryRun, generators: selectedGenerators } = parseArgs();
  const projectRoot = resolve(dirname(new URL(import.meta.url).pathname), "..", config.projectRoot);

  console.log(`mc-extract: Loading minecraft-data for ${version}...`);
  const data = loadMinecraftData(version);
  console.log(`  Protocol version: ${data.version.version}`);
  console.log(`  Blocks: ${data.blocksArray.length}, Entities: ${data.entitiesArray.length}, Items: ${data.itemsArray.length}`);

  const toRun = selectedGenerators
    ? Object.entries(GENERATORS).filter(([k]) => selectedGenerators.includes(k))
    : Object.entries(GENERATORS);

  for (const [key, generator] of toRun) {
    const result = generator(data, config);
    const outPath = resolve(projectRoot, result.path);

    if (dryRun) {
      console.log(`\n[dry-run] ${result.name} → ${outPath} (${result.content.length} bytes)`);
    } else {
      mkdirSync(dirname(outPath), { recursive: true });
      writeFileSync(outPath, result.content);
      console.log(`  ✓ ${result.name} → ${result.path}`);
    }
  }

  console.log("\nDone.");
}

main();
