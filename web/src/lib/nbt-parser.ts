/** Lightweight browser-side NBT parser for network NBT (1.20.2+). */

export type NbtValue =
  | { type: "byte"; value: number }
  | { type: "short"; value: number }
  | { type: "int"; value: number }
  | { type: "long"; value: bigint }
  | { type: "float"; value: number }
  | { type: "double"; value: number }
  | { type: "byte_array"; value: number[] }
  | { type: "string"; value: string }
  | { type: "list"; elementType: string; value: NbtValue[] }
  | { type: "compound"; value: Record<string, NbtValue> }
  | { type: "int_array"; value: number[] }
  | { type: "long_array"; value: bigint[] };

const TAG_NAMES: Record<number, string> = {
  0: "end",
  1: "byte",
  2: "short",
  3: "int",
  4: "long",
  5: "float",
  6: "double",
  7: "byte_array",
  8: "string",
  9: "list",
  10: "compound",
  11: "int_array",
  12: "long_array",
};

class NbtReader {
  private view: DataView;
  private offset = 0;

  constructor(buffer: ArrayBuffer) {
    this.view = new DataView(buffer);
  }

  get remaining() {
    return this.view.byteLength - this.offset;
  }

  readByte(): number {
    const v = this.view.getInt8(this.offset);
    this.offset += 1;
    return v;
  }

  readUByte(): number {
    const v = this.view.getUint8(this.offset);
    this.offset += 1;
    return v;
  }

  readShort(): number {
    const v = this.view.getInt16(this.offset, false);
    this.offset += 2;
    return v;
  }

  readInt(): number {
    const v = this.view.getInt32(this.offset, false);
    this.offset += 4;
    return v;
  }

  readLong(): bigint {
    const v = this.view.getBigInt64(this.offset, false);
    this.offset += 8;
    return v;
  }

  readFloat(): number {
    const v = this.view.getFloat32(this.offset, false);
    this.offset += 4;
    return v;
  }

  readDouble(): number {
    const v = this.view.getFloat64(this.offset, false);
    this.offset += 8;
    return v;
  }

  readString(): string {
    const len = this.view.getUint16(this.offset, false);
    this.offset += 2;
    const bytes = new Uint8Array(this.view.buffer, this.offset, len);
    this.offset += len;
    return new TextDecoder().decode(bytes);
  }

  readPayload(tagType: number): NbtValue {
    switch (tagType) {
      case 1:
        return { type: "byte", value: this.readByte() };
      case 2:
        return { type: "short", value: this.readShort() };
      case 3:
        return { type: "int", value: this.readInt() };
      case 4:
        return { type: "long", value: this.readLong() };
      case 5:
        return { type: "float", value: this.readFloat() };
      case 6:
        return { type: "double", value: this.readDouble() };
      case 7: {
        const len = this.readInt();
        const arr: number[] = [];
        for (let i = 0; i < len; i++) arr.push(this.readByte());
        return { type: "byte_array", value: arr };
      }
      case 8:
        return { type: "string", value: this.readString() };
      case 9: {
        const elType = this.readUByte();
        const len = this.readInt();
        const items: NbtValue[] = [];
        for (let i = 0; i < len; i++) items.push(this.readPayload(elType));
        return { type: "list", elementType: TAG_NAMES[elType] ?? `tag_${elType}`, value: items };
      }
      case 10: {
        const entries: Record<string, NbtValue> = {};
        while (true) {
          const type = this.readUByte();
          if (type === 0) break;
          const name = this.readString();
          entries[name] = this.readPayload(type);
        }
        return { type: "compound", value: entries };
      }
      case 11: {
        const len = this.readInt();
        const arr: number[] = [];
        for (let i = 0; i < len; i++) arr.push(this.readInt());
        return { type: "int_array", value: arr };
      }
      case 12: {
        const len = this.readInt();
        const arr: bigint[] = [];
        for (let i = 0; i < len; i++) arr.push(this.readLong());
        return { type: "long_array", value: arr };
      }
      default:
        throw new Error(`Unknown NBT tag type: ${tagType}`);
    }
  }
}

/** Parse hex string (space-separated) into Uint8Array. */
function hexToBytes(hex: string): Uint8Array {
  const parts = hex.trim().split(/\s+/);
  const bytes = new Uint8Array(parts.length);
  for (let i = 0; i < parts.length; i++) {
    bytes[i] = parseInt(parts[i], 16);
  }
  return bytes;
}

/** Try to parse network NBT from a hex string. Returns null on failure. */
export function parseNbt(hexString: string): NbtValue | null {
  if (!hexString || hexString.trim().length === 0) return null;
  try {
    const bytes = hexToBytes(hexString);
    if (bytes.length < 2) return null;
    // Network NBT starts with 0x0A (TAG_Compound) — no name
    if (bytes[0] !== 0x0a) return null;
    const reader = new NbtReader(bytes.buffer as ArrayBuffer);
    reader.readUByte(); // skip 0x0A tag byte
    // Read compound contents directly (no name in network NBT)
    const entries: Record<string, NbtValue> = {};
    while (reader.remaining > 0) {
      const type = reader.readUByte();
      if (type === 0) break;
      const name = reader.readString();
      entries[name] = reader.readPayload(type);
    }
    return { type: "compound", value: entries };
  } catch {
    return null;
  }
}
