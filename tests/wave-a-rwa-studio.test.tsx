// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { WaveARwaStudio } from "../src/components/WaveARwaStudio";

describe("WaveARwaStudio", () => {
  it("builds a 1-tx atomic RWA batch, EIP-1559 base fee, passkey address, scheduler, and bridge payloads", () => {
    render(<WaveARwaStudio />);
    fireEvent.click(screen.getByRole("button", { name: /Build 1-Tx RWA Batch/i }));
    const out = screen.getByTestId("wave-a-rwa-output").textContent ?? "";
    const parsed = JSON.parse(out);
    expect(parsed.batchTxBytes).toBeGreaterThan(100);
    expect(parsed.batchFeeAtoms).toBe("11000000000");
    expect(parsed.eip1559NextBaseFeeAtFullBlock).toBe("11");
    expect(parsed.passkeyAddressHex).toMatch(/^0x[0-9a-f]{16}\.\.\.$/);
    expect(parsed.schedulerCallBytes).toBeGreaterThan(64);
    expect(parsed.bridgeInitBytes).toBeGreaterThan(64);
  });
});
