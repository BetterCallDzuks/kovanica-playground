import { useState } from "react";
import {
  type RecoveredOnetimeSpendKey,
  type StealthKeypair,
  type StealthOnetime,
  type StealthScanMatch,
  deriveOnetimeAddress,
  deriveOnetimeSpendKey,
  deriveStealthKeypairFromMnemonic,
  generateStealthKeypair,
  importStealthKeypair,
  matchStealthAnnouncement,
  parseScalarHex,
  signSighashWithStealthScalar,
  verifyStealthSignature,
} from "../stealth";

type KeyMode = "generate" | "import" | "mnemonic";

const SAMPLE_SIGHASH_HEX =
  "a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90";

export function StealthStudio() {
  // --- Identity / Keypair state ---
  const [keyMode, setKeyMode] = useState<KeyMode>("generate");
  const [keypair, setKeypair] = useState<StealthKeypair | null>(null);
  const [importScanPriv, setImportScanPriv] = useState("");
  const [importSpendPriv, setImportSpendPriv] = useState("");
  const [mnemonicInput, setMnemonicInput] = useState("");
  const [showSecrets, setShowSecrets] = useState(false);
  const [identityError, setIdentityError] = useState<string | null>(null);

  // --- Sender state ---
  const [senderMetaInput, setSenderMetaInput] = useState("");
  const [ephemeralScalarHex, setEphemeralScalarHex] = useState("");
  const [derivedOnetime, setDerivedOnetime] = useState<StealthOnetime | null>(null);
  const [senderError, setSenderError] = useState<string | null>(null);

  // --- Receiver state ---
  const [scanPrivInput, setScanPrivInput] = useState("");
  const [spendPubInput, setSpendPubInput] = useState("");
  const [spendPrivInput, setSpendPrivInput] = useState("");
  const [annEphemeralInput, setAnnEphemeralInput] = useState("");
  const [annViewTagInput, setAnnViewTagInput] = useState("");
  const [annAddressInput, setAnnAddressInput] = useState("");
  const [scanResult, setScanResult] = useState<StealthScanMatch | null>(null);
  const [recoveredSpend, setRecoveredSpend] = useState<RecoveredOnetimeSpendKey | null>(null);
  const [showRecoveredScalar, setShowRecoveredScalar] = useState(false);
  const [sigCheck, setSigCheck] = useState<{
    signatureHex: string;
    valid: boolean;
  } | null>(null);
  const [receiverError, setReceiverError] = useState<string | null>(null);

  const [copiedLabel, setCopiedLabel] = useState<string | null>(null);

  const handleCopy = (value: string, label: string) => {
    if (navigator.clipboard?.writeText) {
      void navigator.clipboard.writeText(value);
    }
    setCopiedLabel(label);
    setTimeout(() => setCopiedLabel(null), 1800);
  };

  const applyKeypair = (kp: StealthKeypair) => {
    setKeypair(kp);
    setIdentityError(null);
    setScanPrivInput(kp.scanPrivkeyHex);
    setSpendPubInput(kp.spendPubkeyHex);
    setSpendPrivInput(kp.spendPrivkeyHex);
    if (!senderMetaInput) {
      setSenderMetaInput(kp.metaAddress);
    }
  };

  const handleGenerateKeypair = () => {
    try {
      applyKeypair(generateStealthKeypair());
    } catch (err) {
      setIdentityError(err instanceof Error ? err.message : String(err));
    }
  };

  const handleImportKeypair = () => {
    try {
      applyKeypair(importStealthKeypair(importScanPriv, importSpendPriv));
    } catch (err) {
      setIdentityError(err instanceof Error ? err.message : String(err));
    }
  };

  const handleDeriveFromMnemonic = () => {
    try {
      applyKeypair(deriveStealthKeypairFromMnemonic(mnemonicInput));
    } catch (err) {
      setIdentityError(err instanceof Error ? err.message : String(err));
    }
  };

  const handleDeriveOnetime = () => {
    setSenderError(null);
    try {
      const override = ephemeralScalarHex.trim()
        ? parseScalarHex(ephemeralScalarHex, "Ephemeral scalar")
        : undefined;
      const onetime = deriveOnetimeAddress(senderMetaInput, override);
      setDerivedOnetime(onetime);
    } catch (err) {
      setDerivedOnetime(null);
      setSenderError(err instanceof Error ? err.message : String(err));
    }
  };

  const handleLoadAnnouncementIntoReceiver = () => {
    if (!derivedOnetime) return;
    setAnnEphemeralInput(derivedOnetime.ephemeralPubkeyHex);
    setAnnViewTagInput(derivedOnetime.viewTag);
    setAnnAddressInput(derivedOnetime.address);
    setScanResult(null);
    setRecoveredSpend(null);
    setSigCheck(null);
    setReceiverError(null);
  };

  const handleScanAnnouncement = () => {
    setReceiverError(null);
    setRecoveredSpend(null);
    setSigCheck(null);
    try {
      const res = matchStealthAnnouncement(scanPrivInput, spendPubInput, {
        ephemeralPubkeyHex: annEphemeralInput,
        viewTag: annViewTagInput.trim() || undefined,
        stealthAddress: annAddressInput.trim() || undefined,
      });
      setScanResult(res);
    } catch (err) {
      setScanResult(null);
      setReceiverError(err instanceof Error ? err.message : String(err));
    }
  };

  const handleRecoverSpendKey = () => {
    setReceiverError(null);
    setSigCheck(null);
    try {
      const recovered = deriveOnetimeSpendKey({
        scanPrivkeyHex: scanPrivInput,
        spendPrivkeyHex: spendPrivInput,
        ephemeralPubkeyHex: annEphemeralInput,
      });
      setRecoveredSpend(recovered);

      // Verify RFC 8032 Ed25519 signature compatibility locally
      const signed = signSighashWithStealthScalar(recovered.oneTimeScalarHex, SAMPLE_SIGHASH_HEX);
      const valid = verifyStealthSignature(
        signed.signatureHex,
        SAMPLE_SIGHASH_HEX,
        signed.publicKeyHex,
      );
      setSigCheck({ signatureHex: signed.signatureHex, valid });
    } catch (err) {
      setRecoveredSpend(null);
      setReceiverError(err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <section
      className="flex flex-col gap-6"
      data-testid="stealth-studio"
    >
      {/* Studio Header */}
      <div className="bg-surface rounded-xl border border-border p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-base font-semibold text-fg">KVP-103 Stealth Address Studio</h2>
              <span className="px-2 py-0.5 text-[11px] font-medium rounded-full bg-surface-2 border border-border text-gold">
                Dual-Key Ed25519 ECDH
              </span>
            </div>
            <p className="text-xs text-muted mt-1">
              Client-side stealth meta-address generation, one-time address derivation, watch-only view-tag
              scanning <code className="text-fg">(v, B)</code>, and RFC 8032 spend scalar recovery{" "}
              <code className="text-fg">p = (b + t) mod L</code>. All cryptographic operations stay local.
            </p>
          </div>
          {copiedLabel && (
            <span className="px-2.5 py-1 text-xs rounded-md bg-emerald-950/60 border border-emerald-700/50 text-emerald-300">
              Copied {copiedLabel}
            </span>
          )}
        </div>
      </div>

      {/* Section 1: Dual-Key Identity */}
      <div className="bg-surface rounded-xl border border-border p-6 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border pb-3">
          <div>
            <h3 className="text-sm font-semibold text-fg">1. Stealth Identity (Dual-Key Pair)</h3>
            <p className="text-xs text-muted mt-0.5">
              Generate, import, or deterministically derive a scan (view) key <code className="text-fg">(v, V)</code>{" "}
              and spend key <code className="text-fg">(b, B)</code>.
            </p>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {(
              [
                { id: "generate", label: "Generate Random" },
                { id: "import", label: "Import Hex Keys" },
                { id: "mnemonic", label: "From Mnemonic" },
              ] as const
            ).map((mode) => (
              <button
                key={mode.id}
                type="button"
                data-testid={`stealth-mode-${mode.id}`}
                onClick={() => {
                  setKeyMode(mode.id);
                  setIdentityError(null);
                }}
                className={`px-3 py-1.5 text-xs rounded-lg border transition-colors ${
                  keyMode === mode.id
                    ? "bg-gold/15 border-gold/50 text-gold font-semibold"
                    : "bg-surface-2 border-border text-muted hover:text-fg"
                }`}
              >
                {mode.label}
              </button>
            ))}
          </div>
        </div>

        {keyMode === "generate" && (
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              data-testid="stealth-generate-btn"
              onClick={handleGenerateKeypair}
              className="px-4 py-2 bg-gold hover:bg-gold/90 text-bg font-semibold rounded-lg text-xs transition-colors"
            >
              Generate Dual-Key Pair
            </button>
            <span className="text-xs text-muted">
              Samples two independent non-zero Ed25519 scalars using Web Crypto CSPRNG.
            </span>
          </div>
        )}

        {keyMode === "import" && (
          <div className="space-y-3">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div>
                <label
                  htmlFor="stealth-import-scan"
                  className="block text-xs font-medium text-muted mb-1"
                >
                  Scan (View) Private Key (64-hex)
                </label>
                <input
                  id="stealth-import-scan"
                  data-testid="stealth-import-scan-input"
                  type="text"
                  value={importScanPriv}
                  onChange={(e) => setImportScanPriv(e.target.value)}
                  placeholder="64 hex chars..."
                  className="w-full bg-surface-2 border border-border rounded-lg px-3 py-2 text-xs font-mono text-fg focus:outline-none focus:border-gold"
                />
              </div>
              <div>
                <label
                  htmlFor="stealth-import-spend"
                  className="block text-xs font-medium text-muted mb-1"
                >
                  Spend Private Key (64-hex)
                </label>
                <input
                  id="stealth-import-spend"
                  data-testid="stealth-import-spend-input"
                  type="text"
                  value={importSpendPriv}
                  onChange={(e) => setImportSpendPriv(e.target.value)}
                  placeholder="64 hex chars..."
                  className="w-full bg-surface-2 border border-border rounded-lg px-3 py-2 text-xs font-mono text-fg focus:outline-none focus:border-gold"
                />
              </div>
            </div>
            <button
              type="button"
              data-testid="stealth-import-btn"
              onClick={handleImportKeypair}
              className="px-4 py-2 bg-gold hover:bg-gold/90 text-bg font-semibold rounded-lg text-xs transition-colors"
            >
              Import Dual-Key Pair
            </button>
          </div>
        )}

        {keyMode === "mnemonic" && (
          <div className="space-y-3">
            <div>
              <label
                htmlFor="stealth-mnemonic-input"
                className="block text-xs font-medium text-muted mb-1"
              >
                Wallet Mnemonic (12 or 24 words)
              </label>
              <textarea
                id="stealth-mnemonic-input"
                data-testid="stealth-mnemonic-input"
                rows={2}
                value={mnemonicInput}
                onChange={(e) => setMnemonicInput(e.target.value)}
                placeholder="abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about"
                className="w-full bg-surface-2 border border-border rounded-lg px-3 py-2 text-xs font-mono text-fg focus:outline-none focus:border-gold"
              />
            </div>
            <button
              type="button"
              data-testid="stealth-mnemonic-btn"
              onClick={handleDeriveFromMnemonic}
              className="px-4 py-2 bg-gold hover:bg-gold/90 text-bg font-semibold rounded-lg text-xs transition-colors"
            >
              Derive from Mnemonic
            </button>
          </div>
        )}

        {identityError && (
          <div
            data-testid="stealth-identity-error"
            className="p-3 rounded-lg bg-red-950/40 border border-red-700/50 text-xs text-red-300"
          >
            {identityError}
          </div>
        )}

        {keypair && (
          <div
            data-testid="stealth-keypair-card"
            className="bg-surface-2 rounded-lg border border-border p-4 space-y-3"
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-xs font-semibold text-gold">KVP-103 Meta-Address</span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => handleCopy(keypair.metaAddress, "meta-address")}
                  className="px-2.5 py-1 text-[11px] rounded-md bg-surface hover:bg-border border border-border text-muted hover:text-fg transition-colors"
                >
                  Copy Meta-Address
                </button>
                <button
                  type="button"
                  data-testid="stealth-use-in-sender-btn"
                  onClick={() => setSenderMetaInput(keypair.metaAddress)}
                  className="px-2.5 py-1 text-[11px] rounded-md bg-gold/15 hover:bg-gold/25 border border-gold/40 text-gold transition-colors"
                >
                  Use in Sender Flow
                </button>
                <button
                  type="button"
                  onClick={() => setShowSecrets((prev) => !prev)}
                  className="px-2.5 py-1 text-[11px] rounded-md bg-surface hover:bg-border border border-border text-muted hover:text-fg transition-colors"
                >
                  {showSecrets ? "Hide Private Keys" : "Reveal Private Keys"}
                </button>
              </div>
            </div>
            <div
              data-testid="stealth-meta-address"
              className="p-2.5 rounded-md bg-bg border border-border text-xs font-mono text-fg break-all"
            >
              {keypair.metaAddress}
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 text-xs">
              <div className="p-3 rounded-md bg-bg/60 border border-border space-y-1.5">
                <div className="font-semibold text-fg">Scan (View) Key</div>
                <div className="text-[11px] text-muted">Public Key (V):</div>
                <div className="font-mono text-[11px] text-fg break-all" data-testid="stealth-scan-pub">
                  {keypair.scanPubkeyHex}
                </div>
                <div className="text-[11px] text-muted pt-1">Private Scalar (v):</div>
                <div className="font-mono text-[11px] text-amber-300 break-all" data-testid="stealth-scan-priv">
                  {showSecrets ? keypair.scanPrivkeyHex : "•".repeat(32)}
                </div>
              </div>

              <div className="p-3 rounded-md bg-bg/60 border border-border space-y-1.5">
                <div className="font-semibold text-fg">Spend Key</div>
                <div className="text-[11px] text-muted">Public Key (B):</div>
                <div className="font-mono text-[11px] text-fg break-all" data-testid="stealth-spend-pub">
                  {keypair.spendPubkeyHex}
                </div>
                <div className="text-[11px] text-muted pt-1">Private Scalar (b):</div>
                <div className="font-mono text-[11px] text-amber-300 break-all" data-testid="stealth-spend-priv">
                  {showSecrets ? keypair.spendPrivkeyHex : "•".repeat(32)}
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Section 2 & 3 Grid: Sender Flow + Receiver Flow */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">
        {/* Section 2: Sender Flow */}
        <div className="bg-surface rounded-xl border border-border p-6 space-y-4">
          <div className="border-b border-border pb-3">
            <h3 className="text-sm font-semibold text-fg">2. Sender Flow — Derive One-Time Address</h3>
            <p className="text-xs text-muted mt-0.5">
              Paste a recipient&apos;s <code className="text-fg">st:kvnc:…</code> meta-address to derive an
              unlinkable one-time <code className="text-fg">kvnc…dag</code> address, ephemeral pubkey{" "}
              <code className="text-fg">R</code>, and 2-byte view tag.
            </p>
          </div>

          <div className="space-y-3">
            <div>
              <label
                htmlFor="stealth-sender-meta"
                className="block text-xs font-medium text-muted mb-1"
              >
                Recipient KVP-103 Meta-Address
              </label>
              <textarea
                id="stealth-sender-meta"
                data-testid="stealth-sender-meta-input"
                rows={2}
                value={senderMetaInput}
                onChange={(e) => setSenderMetaInput(e.target.value)}
                placeholder="st:kvnc:<64-hex-scan-pubkey>:<64-hex-spend-pubkey>"
                className="w-full bg-surface-2 border border-border rounded-lg px-3 py-2 text-xs font-mono text-fg focus:outline-none focus:border-gold"
              />
            </div>

            <div>
              <label
                htmlFor="stealth-ephemeral-scalar"
                className="block text-xs font-medium text-muted mb-1"
              >
                Optional Ephemeral Scalar <code className="text-fg">r</code> (64-hex, leave blank for random)
              </label>
              <input
                id="stealth-ephemeral-scalar"
                data-testid="stealth-ephemeral-scalar-input"
                type="text"
                value={ephemeralScalarHex}
                onChange={(e) => setEphemeralScalarHex(e.target.value)}
                placeholder="Random CSPRNG scalar if blank"
                className="w-full bg-surface-2 border border-border rounded-lg px-3 py-2 text-xs font-mono text-fg focus:outline-none focus:border-gold"
              />
            </div>

            <button
              type="button"
              data-testid="stealth-derive-btn"
              onClick={handleDeriveOnetime}
              className="px-4 py-2 bg-gold hover:bg-gold/90 text-bg font-semibold rounded-lg text-xs transition-colors"
            >
              Derive One-Time Stealth Address
            </button>
          </div>

          {senderError && (
            <div
              data-testid="stealth-sender-error"
              className="p-3 rounded-lg bg-red-950/40 border border-red-700/50 text-xs text-red-300"
            >
              {senderError}
            </div>
          )}

          {derivedOnetime && (
            <div
              data-testid="stealth-sender-output"
              className="bg-surface-2 rounded-lg border border-border p-4 space-y-3 text-xs"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-semibold text-emerald-400">One-Time Announcement Ready</span>
                <button
                  type="button"
                  data-testid="stealth-send-to-receiver-btn"
                  onClick={handleLoadAnnouncementIntoReceiver}
                  className="px-2.5 py-1 text-[11px] rounded-md bg-gold/15 hover:bg-gold/25 border border-gold/40 text-gold transition-colors"
                >
                  Send to Receiver Scanner →
                </button>
              </div>

              <div>
                <div className="text-[11px] text-muted mb-0.5">One-Time Stealth Address (kvnc…dag)</div>
                <div
                  data-testid="stealth-derived-address"
                  className="p-2 rounded bg-bg border border-border font-mono text-fg break-all"
                >
                  {derivedOnetime.address}
                </div>
              </div>

              <div>
                <div className="text-[11px] text-muted mb-0.5">Ephemeral Public Key R = r·G (64-hex)</div>
                <div
                  data-testid="stealth-derived-ephemeral"
                  className="p-2 rounded bg-bg border border-border font-mono text-fg break-all"
                >
                  {derivedOnetime.ephemeralPubkeyHex}
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                <div>
                  <div className="text-[11px] text-muted mb-0.5">View Tag (2 bytes)</div>
                  <div
                    data-testid="stealth-derived-viewtag"
                    className="p-2 rounded bg-bg border border-border font-mono text-gold font-semibold"
                  >
                    {derivedOnetime.viewTag}
                  </div>
                </div>
                <div className="sm:col-span-2">
                  <div className="text-[11px] text-muted mb-0.5">One-Time Pubkey P (64-hex)</div>
                  <div className="p-2 rounded bg-bg border border-border font-mono text-fg truncate">
                    {derivedOnetime.addressHex}
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Section 3: Receiver Flow */}
        <div className="bg-surface rounded-xl border border-border p-6 space-y-4">
          <div className="border-b border-border pb-3">
            <h3 className="text-sm font-semibold text-fg">
              3. Receiver Flow — Scan &amp; Recover Spend Key
            </h3>
            <p className="text-xs text-muted mt-0.5">
              Verify ownership of an announcement with your view key <code className="text-fg">(v, B)</code>,
              then recover the one-time spend scalar <code className="text-fg">p = (b + t) mod L</code>.
            </p>
          </div>

          <div className="space-y-3">
            <div>
              <label
                htmlFor="stealth-ann-ephemeral"
                className="block text-xs font-medium text-muted mb-1"
              >
                Announcement Ephemeral Pubkey <code className="text-fg">R</code> (64-hex)
              </label>
              <input
                id="stealth-ann-ephemeral"
                data-testid="stealth-ann-ephemeral-input"
                type="text"
                value={annEphemeralInput}
                onChange={(e) => setAnnEphemeralInput(e.target.value)}
                placeholder="64-hex ephemeral public key R..."
                className="w-full bg-surface-2 border border-border rounded-lg px-3 py-2 text-xs font-mono text-fg focus:outline-none focus:border-gold"
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <label
                  htmlFor="stealth-ann-viewtag"
                  className="block text-xs font-medium text-muted mb-1"
                >
                  View Tag (4-hex)
                </label>
                <input
                  id="stealth-ann-viewtag"
                  data-testid="stealth-ann-viewtag-input"
                  type="text"
                  value={annViewTagInput}
                  onChange={(e) => setAnnViewTagInput(e.target.value)}
                  placeholder="e.g. 9f2a"
                  className="w-full bg-surface-2 border border-border rounded-lg px-3 py-2 text-xs font-mono text-fg focus:outline-none focus:border-gold"
                />
              </div>
              <div className="sm:col-span-2">
                <label
                  htmlFor="stealth-ann-address"
                  className="block text-xs font-medium text-muted mb-1"
                >
                  Stealth Address (<code className="text-fg">kvnc…dag</code> or 64-hex)
                </label>
                <input
                  id="stealth-ann-address"
                  data-testid="stealth-ann-address-input"
                  type="text"
                  value={annAddressInput}
                  onChange={(e) => setAnnAddressInput(e.target.value)}
                  placeholder="kvnc...dag"
                  className="w-full bg-surface-2 border border-border rounded-lg px-3 py-2 text-xs font-mono text-fg focus:outline-none focus:border-gold"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
              <div>
                <label
                  htmlFor="stealth-rx-scan-priv"
                  className="block text-xs font-medium text-muted mb-1"
                >
                  Receiver Scan Private Key <code className="text-fg">v</code> (64-hex)
                </label>
                <input
                  id="stealth-rx-scan-priv"
                  data-testid="stealth-rx-scan-priv-input"
                  type="password"
                  value={scanPrivInput}
                  onChange={(e) => setScanPrivInput(e.target.value)}
                  placeholder="64-hex scan private key..."
                  className="w-full bg-surface-2 border border-border rounded-lg px-3 py-2 text-xs font-mono text-fg focus:outline-none focus:border-gold"
                />
              </div>
              <div>
                <label
                  htmlFor="stealth-rx-spend-pub"
                  className="block text-xs font-medium text-muted mb-1"
                >
                  Receiver Spend Public Key <code className="text-fg">B</code> (64-hex)
                </label>
                <input
                  id="stealth-rx-spend-pub"
                  data-testid="stealth-rx-spend-pub-input"
                  type="text"
                  value={spendPubInput}
                  onChange={(e) => setSpendPubInput(e.target.value)}
                  placeholder="64-hex spend public key..."
                  className="w-full bg-surface-2 border border-border rounded-lg px-3 py-2 text-xs font-mono text-fg focus:outline-none focus:border-gold"
                />
              </div>
            </div>

            <div>
              <label
                htmlFor="stealth-rx-spend-priv"
                className="block text-xs font-medium text-muted mb-1"
              >
                Receiver Spend Private Key <code className="text-fg">b</code> (only needed for key recovery)
              </label>
              <input
                id="stealth-rx-spend-priv"
                data-testid="stealth-rx-spend-priv-input"
                type="password"
                value={spendPrivInput}
                onChange={(e) => setSpendPrivInput(e.target.value)}
                placeholder="64-hex spend private key (not required for watch-only scan)..."
                className="w-full bg-surface-2 border border-border rounded-lg px-3 py-2 text-xs font-mono text-fg focus:outline-none focus:border-gold"
              />
            </div>

            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                data-testid="stealth-scan-btn"
                onClick={handleScanAnnouncement}
                className="px-4 py-2 bg-surface-2 hover:bg-border text-fg border border-border font-semibold rounded-lg text-xs transition-colors"
              >
                Scan Announcement (Watch-Only)
              </button>
              <button
                type="button"
                data-testid="stealth-recover-btn"
                onClick={handleRecoverSpendKey}
                className="px-4 py-2 bg-gold hover:bg-gold/90 text-bg font-semibold rounded-lg text-xs transition-colors"
              >
                Recover One-Time Spend Key
              </button>
            </div>
          </div>

          {receiverError && (
            <div
              data-testid="stealth-receiver-error"
              className="p-3 rounded-lg bg-red-950/40 border border-red-700/50 text-xs text-red-300"
            >
              {receiverError}
            </div>
          )}

          {scanResult && (
            <div
              data-testid="stealth-scan-result"
              className={`p-4 rounded-lg border text-xs space-y-2 ${
                scanResult.matched
                  ? "bg-emerald-950/30 border-emerald-700/50 text-emerald-200"
                  : "bg-red-950/30 border-red-700/50 text-red-200"
              }`}
            >
              <div className="font-semibold" data-testid="stealth-scan-status">
                {scanResult.matched
                  ? "Ownership Verified — Announcement Matches Your View Key"
                  : "No Match — Announcement Does Not Belong to This View Key"}
              </div>
              {scanResult.matched ? (
                <>
                  <div className="text-[11px] text-emerald-300/90">
                    View Tag: <span className="font-mono font-semibold">{scanResult.viewTag}</span>
                  </div>
                  <div className="font-mono text-[11px] bg-bg/60 p-2 rounded border border-emerald-800/50 break-all">
                    {scanResult.address}
                  </div>
                </>
              ) : (
                <div className="text-[11px] text-red-300">
                  Announcement view tag, ephemeral key, or stealth address did not match this view key.
                </div>
              )}
            </div>
          )}

          {recoveredSpend && (
            <div
              data-testid="stealth-recovered-card"
              className="bg-surface-2 rounded-lg border border-gold/40 p-4 space-y-3 text-xs"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-semibold text-gold">Recovered One-Time Spend Key</span>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setShowRecoveredScalar((prev) => !prev)}
                    className="px-2 py-1 text-[11px] rounded bg-surface hover:bg-border border border-border text-muted hover:text-fg"
                  >
                    {showRecoveredScalar ? "Hide Scalar" : "Reveal Scalar"}
                  </button>
                  <button
                    type="button"
                    onClick={() => handleCopy(recoveredSpend.oneTimeScalarHex, "one-time spend scalar")}
                    className="px-2 py-1 text-[11px] rounded bg-surface hover:bg-border border border-border text-muted hover:text-fg"
                  >
                    Copy Scalar
                  </button>
                </div>
              </div>

              <div>
                <div className="text-[11px] text-muted mb-0.5">Derived Address (p·G)</div>
                <div
                  data-testid="stealth-recovered-address"
                  className="p-2 rounded bg-bg border border-border font-mono text-fg break-all"
                >
                  {recoveredSpend.address}
                </div>
              </div>

              <div>
                <div className="text-[11px] text-muted mb-0.5">One-Time Spend Scalar p = (b + t) mod L</div>
                <div
                  data-testid="stealth-recovered-scalar"
                  className="p-2 rounded bg-bg border border-border font-mono text-amber-300 break-all"
                >
                  {showRecoveredScalar ? recoveredSpend.oneTimeScalarHex : "•".repeat(32)}
                </div>
              </div>

              {sigCheck && (
                <div
                  data-testid="stealth-sig-check"
                  className="p-2.5 rounded bg-emerald-950/30 border border-emerald-700/40 text-[11px] text-emerald-300"
                >
                  RFC 8032 Ed25519 self-check:{" "}
                  <strong>{sigCheck.valid ? "VALID signature" : "INVALID signature"}</strong>{" "}
                  <span className="font-mono text-emerald-400/80">
                    ({sigCheck.signatureHex.slice(0, 16)}…)
                  </span>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
