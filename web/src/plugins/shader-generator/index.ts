import type { WorldGenerator, ChunkData } from "@/types/plugin";
import { buildComputeShader, DEFAULT_SHADER } from "./boilerplate";

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

  get shaderCode(): string {
    return this._shaderCode;
  }

  get lastError(): string | null {
    return this._lastError;
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

    // Create buffers
    // Uniform: 2 x i32 (chunk_x, chunk_z) = 8 bytes
    this.uniformBuffer = this.device.createBuffer({
      size: 8,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

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

    // Compile default shader
    await this.setShaderCode(this._shaderCode);
  }

  async setShaderCode(code: string): Promise<void> {
    this._shaderCode = code;
    this._lastError = null;

    if (!this.device) {
      this._lastError = "WebGPU not initialized";
      return;
    }

    const fullShader = buildComputeShader(code);

    try {
      const shaderModule = this.device.createShaderModule({ code: fullShader });

      // Check for compilation errors
      const info = await shaderModule.getCompilationInfo();
      const errors = info.messages.filter((m: GPUCompilationMessage) => m.type === "error");
      if (errors.length > 0) {
        this._lastError = errors.map((e: GPUCompilationMessage) => `Line ${e.lineNum}: ${e.message}`).join("\n");
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
  }

  async generate(cx: number, cz: number): Promise<ChunkData> {
    if (!this.device || !this.pipeline || !this.bindGroup) {
      // Fallback: return empty chunk
      return { blockStates: new Uint16Array(98304) };
    }

    // Write uniforms
    this.device.queue.writeBuffer(
      this.uniformBuffer!,
      0,
      new Int32Array([cx, cz])
    );

    // Dispatch compute
    const encoder = this.device.createCommandEncoder();
    const pass = encoder.beginComputePass();
    pass.setPipeline(this.pipeline);
    pass.setBindGroup(0, this.bindGroup);
    pass.dispatchWorkgroups(16, 16, 1); // 16x16 columns
    pass.end();

    // Copy output to read buffer
    encoder.copyBufferToBuffer(
      this.outputBuffer!,
      0,
      this.readBuffer!,
      0,
      98304 * 4
    );

    this.device.queue.submit([encoder.finish()]);

    // Read back results
    await this.readBuffer!.mapAsync(GPUMapMode.READ);
    const data = new Uint32Array(this.readBuffer!.getMappedRange().slice(0));
    this.readBuffer!.unmap();

    // Convert u32 → u16
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
