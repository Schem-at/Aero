import type { WorldGenerator, ChunkData } from "@/types/plugin";
import { buildComputeShader, DEFAULT_SHADER } from "./boilerplate";
import { parseShaderParams, type ShaderParam } from "./params";

/** Round up to next multiple of 16 (WebGPU uniform buffer alignment). */
function align16(n: number): number {
  return Math.ceil(n / 16) * 16;
}

export class ShaderGenerator implements WorldGenerator {
  id = "shader";
  name = "WebGPU Shader";

  private device: GPUDevice | null = null;
  private pipeline: GPUComputePipeline | null = null;
  private uniformBuffer: GPUBuffer | null = null;
  private outputBuffer: GPUBuffer | null = null;
  private readBuffer: GPUBuffer | null = null;
  private bindGroup: GPUBindGroup | null = null;

  private _shaderCode: string = DEFAULT_SHADER;
  private _lastError: string | null = null;
  private _params: ShaderParam[] = [];
  private _paramValues: Map<string, number> = new Map();

  /** Called when params list changes (after setShaderCode). */
  onParamsChanged: ((params: ShaderParam[], values: Map<string, number>) => void) | null = null;

  get shaderCode(): string {
    return this._shaderCode;
  }

  get lastError(): string | null {
    return this._lastError;
  }

  get params(): ShaderParam[] {
    return this._params;
  }

  get paramValues(): Map<string, number> {
    return this._paramValues;
  }

  async init(): Promise<void> {
    if (this.device) return;

    if (!navigator.gpu) {
      throw new Error("WebGPU is not supported in this browser");
    }

    const adapter = await navigator.gpu.requestAdapter();
    if (!adapter) {
      throw new Error("No WebGPU adapter found");
    }

    this.device = await adapter.requestDevice();

    // Output: 98304 x u32 = 393216 bytes
    const outputSize = 98304 * 4;
    this.outputBuffer = this.device.createBuffer({
      size: outputSize,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
    });

    this.readBuffer = this.device.createBuffer({
      size: outputSize,
      usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
    });

    // Compile default shader (this creates the uniform buffer)
    await this.setShaderCode(this._shaderCode);
  }

  async setShaderCode(code: string): Promise<void> {
    this._shaderCode = code;
    this._lastError = null;

    if (!this.device) {
      this._lastError = "WebGPU not initialized";
      return;
    }

    // Parse params from code
    const newParams = parseShaderParams(code);

    // Merge values: keep existing for same-name params, use defaults for new ones
    const newValues = new Map<string, number>();
    for (const p of newParams) {
      newValues.set(p.name, this._paramValues.get(p.name) ?? p.defaultValue);
    }
    this._params = newParams;
    this._paramValues = newValues;

    // Recreate uniform buffer sized for chunk coords + params
    // Layout: [chunk_x: i32, chunk_z: i32, param0: f32, param1: f32, ...]
    const uniformSize = align16(8 + 4 * newParams.length);
    this.uniformBuffer?.destroy();
    this.uniformBuffer = this.device.createBuffer({
      size: uniformSize,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    const fullShader = buildComputeShader(code, newParams);

    try {
      const shaderModule = this.device.createShaderModule({ code: fullShader });

      // Check for compilation errors
      const info = await shaderModule.getCompilationInfo();
      const errors = info.messages.filter((m: GPUCompilationMessage) => m.type === "error");
      if (errors.length > 0) {
        this._lastError = errors.map((e: GPUCompilationMessage) => `Line ${e.lineNum}: ${e.message}`).join("\n");
        this.onParamsChanged?.(this._params, this._paramValues);
        return;
      }

      this.pipeline = this.device.createComputePipeline({
        layout: "auto",
        compute: {
          module: shaderModule,
          entryPoint: "main",
        },
      });

      this.bindGroup = this.device.createBindGroup({
        layout: this.pipeline.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: { buffer: this.uniformBuffer! } },
          { binding: 1, resource: { buffer: this.outputBuffer! } },
        ],
      });
    } catch (err) {
      this._lastError = err instanceof Error ? err.message : String(err);
    }

    this.onParamsChanged?.(this._params, this._paramValues);
  }

  setParamValue(name: string, value: number): void {
    this._paramValues.set(name, value);
  }

  async generate(cx: number, cz: number): Promise<ChunkData> {
    if (!this.device || !this.pipeline || !this.bindGroup) {
      return { blockStates: new Uint16Array(98304) };
    }

    // Build uniform data: [chunk_x: i32, chunk_z: i32, ...params: f32]
    const paramCount = this._params.length;
    const bufferSize = align16(8 + 4 * paramCount);
    const buf = new ArrayBuffer(bufferSize);
    const i32View = new Int32Array(buf, 0, 2);
    i32View[0] = cx;
    i32View[1] = cz;

    if (paramCount > 0) {
      const f32View = new Float32Array(buf, 8, paramCount);
      for (let i = 0; i < paramCount; i++) {
        const p = this._params[i];
        f32View[i] = this._paramValues.get(p.name) ?? p.defaultValue;
      }
    }

    this.device.queue.writeBuffer(this.uniformBuffer!, 0, buf);

    // Dispatch compute
    const encoder = this.device.createCommandEncoder();
    const pass = encoder.beginComputePass();
    pass.setPipeline(this.pipeline);
    pass.setBindGroup(0, this.bindGroup);
    pass.dispatchWorkgroups(16, 16, 1);
    pass.end();

    encoder.copyBufferToBuffer(
      this.outputBuffer!,
      0,
      this.readBuffer!,
      0,
      98304 * 4
    );

    this.device.queue.submit([encoder.finish()]);

    await this.readBuffer!.mapAsync(GPUMapMode.READ);
    const data = new Uint32Array(this.readBuffer!.getMappedRange().slice(0));
    this.readBuffer!.unmap();

    const blockStates = new Uint16Array(98304);
    for (let i = 0; i < 98304; i++) {
      blockStates[i] = data[i] & 0xFFFF;
    }

    return { blockStates };
  }

  dispose(): void {
    this.uniformBuffer?.destroy();
    this.outputBuffer?.destroy();
    this.readBuffer?.destroy();
    this.device?.destroy();
    this.device = null;
    this.pipeline = null;
    this.bindGroup = null;
  }
}
