// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { StealthStudio } from "../src/components/StealthStudio";

describe("StealthStudio", () => {
  afterEach(() => {
    cleanup();
  });

  it("runs the full interactive KVP-103 flow: generate -> derive -> watch-only scan -> recover spend key", () => {
    render(<StealthStudio />);

    // 1. Generate dual-key pair
    fireEvent.click(screen.getByTestId("stealth-generate-btn"));
    const metaAddr = screen.getByTestId("stealth-meta-address").textContent ?? "";
    expect(metaAddr).toMatch(/^st:kvnc:[0-9a-f]{64}:[0-9a-f]{64}$/);

    // 2. Derive one-time stealth address in Sender flow
    fireEvent.click(screen.getByTestId("stealth-derive-btn"));
    const derivedAddr = screen.getByTestId("stealth-derived-address").textContent ?? "";
    const derivedEph = screen.getByTestId("stealth-derived-ephemeral").textContent ?? "";
    const derivedTag = screen.getByTestId("stealth-derived-viewtag").textContent ?? "";
    expect(derivedAddr).toMatch(/^kvnc[a-z0-9]{57}dag$/);
    expect(derivedEph).toMatch(/^[0-9a-f]{64}$/);
    expect(derivedTag).toMatch(/^[0-9a-f]{4}$/);

    // 3. Send announcement to receiver scanner & run watch-only scan
    fireEvent.click(screen.getByTestId("stealth-send-to-receiver-btn"));
    fireEvent.click(screen.getByTestId("stealth-scan-btn"));
    expect(screen.getByTestId("stealth-scan-status").textContent).toMatch(/Ownership Verified/i);

    // 4. Recover one-time spend key and verify RFC 8032 self-check
    fireEvent.click(screen.getByTestId("stealth-recover-btn"));
    expect(screen.getByTestId("stealth-recovered-address").textContent).toBe(derivedAddr);
    expect(screen.getByTestId("stealth-sig-check").textContent).toMatch(/VALID signature/i);

    // 5. Negative test: tamper with view tag and confirm scan reports No Match
    const wrongTag = derivedTag === "0000" ? "ffff" : "0000";
    fireEvent.change(screen.getByTestId("stealth-ann-viewtag-input"), {
      target: { value: wrongTag },
    });
    fireEvent.click(screen.getByTestId("stealth-scan-btn"));
    expect(screen.getByTestId("stealth-scan-status").textContent).toMatch(/No Match/i);
  });

  it("supports deterministic mnemonic derivation and hex key import", () => {
    render(<StealthStudio />);

    // Derive from mnemonic
    fireEvent.click(screen.getByTestId("stealth-mode-mnemonic"));
    fireEvent.change(screen.getByTestId("stealth-mnemonic-input"), {
      target: {
        value:
          "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about",
      },
    });
    fireEvent.click(screen.getByTestId("stealth-mnemonic-btn"));
    const mnemonicMeta = screen.getByTestId("stealth-meta-address").textContent ?? "";
    expect(mnemonicMeta).toMatch(/^st:kvnc:[0-9a-f]{64}:[0-9a-f]{64}$/);

    // Switch to Import mode and import explicit 64-hex scalars
    fireEvent.click(screen.getByTestId("stealth-mode-import"));
    fireEvent.change(screen.getByTestId("stealth-import-scan-input"), {
      target: { value: "01" + "00".repeat(31) },
    });
    fireEvent.change(screen.getByTestId("stealth-import-spend-input"), {
      target: { value: "02" + "00".repeat(31) },
    });
    fireEvent.click(screen.getByTestId("stealth-import-btn"));
    const importedMeta = screen.getByTestId("stealth-meta-address").textContent ?? "";
    expect(importedMeta).toMatch(/^st:kvnc:[0-9a-f]{64}:[0-9a-f]{64}$/);
    expect(importedMeta).not.toBe(mnemonicMeta);
  });
});
