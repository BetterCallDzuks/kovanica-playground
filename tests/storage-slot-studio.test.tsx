// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import {
  computeStorageSlotDerivation,
  StorageSlotStudioPanel,
} from "../src/components/StorageSlotStudioPanel";
import { encodeAddress } from "kovanica-sdk";
import {
  bytesToHex,
  concat,
  derivePrefixedStorageSlot,
  deriveStorageSlotHex,
  encodeBincodeStringVec,
  hexToBytes,
  type ReadContractStorageClient,
} from "../src/wallet-interop";

afterEach(() => {
  cleanup();
});

describe("StorageSlotStudioPanel", () => {
  it("derives canonical contract slots via deriveStorageSlotHex for UTF-8, u64, and 32-byte hex keys", () => {
    const nameRes = computeStorageSlotDerivation({
      mode: "canonical",
      canonicalContract: "name",
      canonicalKey: "Alice",
      prefix: "",
      prefixedKeyEncoding: "utf8",
      prefixedKey: "",
      rawSlotHex: "",
    });
    expect(nameRes.ok).toBe(true);
    if (nameRes.ok) {
      expect(nameRes.slotHex).toBe(`0x${deriveStorageSlotHex("name", "Alice")}`);
    }

    const mtxRes = computeStorageSlotDerivation({
      mode: "canonical",
      canonicalContract: "multisig_tx",
      canonicalKey: "42",
      prefix: "",
      prefixedKeyEncoding: "utf8",
      prefixedKey: "",
      rawSlotHex: "",
    });
    expect(mtxRes.ok).toBe(true);
    if (mtxRes.ok) {
      expect(mtxRes.slotHex).toBe(`0x${deriveStorageSlotHex("multisig_tx", 42n)}`);
    }

    const swapId = "ab".repeat(32);
    const htlcRes = computeStorageSlotDerivation({
      mode: "canonical",
      canonicalContract: "htlc",
      canonicalKey: `0x${swapId}`,
      prefix: "",
      prefixedKeyEncoding: "utf8",
      prefixedKey: "",
      rawSlotHex: "",
    });
    expect(htlcRes.ok).toBe(true);
    if (htlcRes.ok) {
      expect(htlcRes.slotHex).toBe(`0x${deriveStorageSlotHex("htlc", swapId)}`);
    }
  });

  it("derives prefixed UTF-8 and raw hex mapping slots and validates raw 32-byte hex slots", () => {
    const prefixedUtf8 = computeStorageSlotDerivation({
      mode: "prefixed",
      canonicalContract: "state",
      canonicalKey: "",
      prefix: "kvnc/v1/name/",
      prefixedKeyEncoding: "utf8",
      prefixedKey: "bob",
      rawSlotHex: "",
    });
    expect(prefixedUtf8.ok).toBe(true);
    if (prefixedUtf8.ok) {
      expect(prefixedUtf8.slotHex).toBe(
        `0x${bytesToHex(derivePrefixedStorageSlot("kvnc/v1/name/", "bob"))}`,
      );
    }

    const prefixedHex = computeStorageSlotDerivation({
      mode: "prefixed",
      canonicalContract: "state",
      canonicalKey: "",
      prefix: "kvnc/v1/custom/",
      prefixedKeyEncoding: "hex",
      prefixedKey: "0xdeadbeef",
      rawSlotHex: "",
    });
    expect(prefixedHex.ok).toBe(true);
    if (prefixedHex.ok) {
      expect(prefixedHex.slotHex).toBe(
        `0x${bytesToHex(derivePrefixedStorageSlot("kvnc/v1/custom/", hexToBytes("deadbeef")))}`,
      );
    }

    const invalidRaw = computeStorageSlotDerivation({
      mode: "raw",
      canonicalContract: "state",
      canonicalKey: "",
      prefix: "",
      prefixedKeyEncoding: "utf8",
      prefixedKey: "",
      rawSlotHex: "0x1234",
    });
    expect(invalidRaw.ok).toBe(false);
  });

  it("renders derived slot hex across modes and executes live readContractStorage with Bincode decoding", async () => {
    const contractAddr = encodeAddress(hexToBytes("44".repeat(32)), "kvnc");
    const ownerHex = "aa".repeat(32);
    const pubkeyHex = "bb".repeat(32);
    const encodedName = concat([
      hexToBytes(ownerHex),
      hexToBytes(pubkeyHex),
      encodeBincodeStringVec(["https://relay.kovanica.org"]),
    ]);

    const getStorageAt = vi.fn().mockResolvedValue(`0x${bytesToHex(encodedName)}`);
    const mockClient: ReadContractStorageClient = { getStorageAt };

    render(
      <StorageSlotStudioPanel
        client={mockClient}
        defaultContractAddress={contractAddr}
      />,
    );

    // Default mode is canonical "name" with key "alice"
    const expectedAliceSlot = `0x${deriveStorageSlotHex("name", "alice")}`;
    expect(screen.getByTestId("storage-slot-derived-hex").textContent).toBe(expectedAliceSlot);

    // Change canonical key to "charlie"
    fireEvent.change(screen.getByTestId("storage-slot-canonical-key"), {
      target: { value: "charlie" },
    });
    const expectedCharlieSlot = `0x${deriveStorageSlotHex("name", "charlie")}`;
    expect(screen.getByTestId("storage-slot-derived-hex").textContent).toBe(expectedCharlieSlot);

    // Execute live readContractStorage
    fireEvent.click(screen.getByTestId("storage-slot-read-btn"));

    await waitFor(() => {
      expect(screen.getByTestId("storage-slot-read-result")).toBeDefined();
    });

    expect(getStorageAt).toHaveBeenCalledTimes(1);
    expect(getStorageAt.mock.calls[0][0]).toBe(contractAddr);
    expect(getStorageAt.mock.calls[0][1]).toBe(expectedCharlieSlot);
    expect(screen.getByTestId("storage-slot-empty-badge").textContent).toContain("Populated");
    expect(screen.getByTestId("storage-slot-decoded-value").textContent).toContain(
      "https://relay.kovanica.org",
    );

    // Switch to Raw Hex mode and test empty slot response
    getStorageAt.mockResolvedValueOnce("0x");
    fireEvent.click(screen.getByTestId("storage-slot-mode-raw"));
    const customSlot = "0x" + "12".repeat(32);
    fireEvent.change(screen.getByTestId("storage-slot-raw-hex-input"), {
      target: { value: customSlot },
    });
    expect(screen.getByTestId("storage-slot-derived-hex").textContent).toBe(customSlot);

    fireEvent.click(screen.getByTestId("storage-slot-read-btn"));
    await waitFor(() => {
      expect(screen.getByTestId("storage-slot-empty-badge").textContent).toBe("Empty Slot");
    });
  });

  it("surfaces validation and RPC errors cleanly", async () => {
    const getStorageAt = vi.fn().mockRejectedValue(new Error("RPC node offline"));
    const mockClient: ReadContractStorageClient = { getStorageAt };

    render(<StorageSlotStudioPanel client={mockClient} />);

    // Missing contract address
    fireEvent.click(screen.getByTestId("storage-slot-read-btn"));
    expect(screen.getByTestId("storage-slot-read-error").textContent).toContain(
      "Contract address is required",
    );

    // Valid contract address but RPC rejects
    const contractAddr = encodeAddress(hexToBytes("55".repeat(32)), "kvnc");
    fireEvent.change(screen.getByTestId("storage-slot-contract-address"), {
      target: { value: contractAddr },
    });
    fireEvent.click(screen.getByTestId("storage-slot-read-btn"));

    await waitFor(() => {
      expect(screen.getByTestId("storage-slot-read-error").textContent).toContain(
        "RPC node offline",
      );
    });
  });
});
