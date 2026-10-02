import { describe, expect, it, vi } from "vitest";
import { convertSp3Path } from "../mdb";

// Verifies the Channel wiring fix: convertSp3Path must always pass a
// Channel instance as `onProgress` to `export_mdb_csv`, otherwise the
// Rust command `on_progress: Channel<MdbExportProgress>` fails to
// deserialize (E0277: Option<Channel> trap) and `cargo check` breaks.
// The throttling itself lives in Rust (250ms / 2MiB), but the JS
// contract is what keeps the build green.

function encodeOctalForTest(values: number[]): string {
  const buf = new ArrayBuffer(values.length * 4);
  const view = new DataView(buf);
  values.forEach((v, i) => view.setFloat32(i * 4, v, true));
  const bytes = new Uint8Array(buf);
  return '"' + [...bytes].map((b) => "\\" + b.toString(8).padStart(3, "0")).join("") + '"';
}

function validHead(): number[] {
  const header =
    "DataID,PointID,DirectionID,NoLines,BandWidth,Unit,MeasDate,ValuePeakMaxV,FreqPeakMaxV,TotalRMSV,TotalRMSA,TotalPeakA,Specdata";
  const row = `1,7,1,4,0.5,"mm/s",45811.43,0.5,1.0,0.83,12.4,0.9,${encodeOctalForTest([0.1, 0.5, 0.2, 0.05])}`;
  return Array.from(new TextEncoder().encode(`${header}\n${row}\n`));
}

vi.mock("@tauri-apps/api/core", () => {
  class MockChannel<T> {
    onmessage: ((p: T) => void) | undefined;
    send = vi.fn();
  }
  return {
    invoke: vi.fn(async (_cmd: string, args: Record<string, unknown>) => {
      // Must receive a Channel instance, not undefined — the E0277 fix
      expect(args.onProgress).toBeInstanceOf(MockChannel);
      return {
        csvPath: "/tmp/report-maker-test.csv",
        rows: 1,
        bytes: 512,
        head: validHead(),
      };
    }),
    Channel: MockChannel,
  };
});

describe("mdb Channel wiring (import progress)", () => {
  it("always passes a Channel as onProgress to export_mdb_csv", async () => {
    const { Channel, invoke } = await import("@tauri-apps/api/core");
    const mockInvoke = vi.mocked(invoke);
    mockInvoke.mockClear();

    // Without explicit onProgress callback, a dummy Channel must still be sent
    await convertSp3Path("/tmp/foo.sp3", mockInvoke as unknown as typeof invoke);
    expect(mockInvoke).toHaveBeenCalledTimes(1);
    const args = mockInvoke.mock.calls[0][1] as Record<string, unknown>;
    expect(args.onProgress).toBeInstanceOf(Channel);
  });

  it("wires onProgress callback to Channel.onmessage", async () => {
    const { Channel, invoke } = await import("@tauri-apps/api/core");
    const mockInvoke = vi.mocked(invoke);
    mockInvoke.mockClear();
    const onProgress = vi.fn();

    await convertSp3Path("/tmp/bar.sp3", mockInvoke as unknown as typeof invoke, onProgress);
    const args = mockInvoke.mock.calls[0][1] as Record<string, unknown>;
    const ch = args.onProgress as InstanceType<typeof Channel<{ bytes: number; rows: number }>>;
    expect(ch.onmessage).toBe(onProgress);
  });
});
