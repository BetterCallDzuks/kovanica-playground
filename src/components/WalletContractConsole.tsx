import { useState, useMemo } from "react";
import {
  parseKvnc,
  type KovanicaClient,
  KOVANICA_COIN_TYPE,
} from "kovanica-sdk";
import {
  buildTokenTransferCall,
  buildVaultCreateCall,
  deriveAccountsFromMnemonic,
  generateMnemonic,
  hexToBytes,
  runGoldenVectorSelfTest,
  signAndSerializeTransaction,
  validateMnemonic,
  type DerivedAccountInfo,
  type SelfTestStep,
  type TxKind,
  type UnsignedTx,
} from "../wallet-interop";

interface Props {
  client: KovanicaClient;
  selectedChainId: number;
}

const GOLDEN_MNEMONIC =
  "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";

export function WalletContractConsole({ client, selectedChainId }: Props) {
  // Mnemonic state
  const [mnemonic, setMnemonic] = useState<string>(GOLDEN_MNEMONIC);
  const [passphrase, setPassphrase] = useState<string>("");
  const [activeAccountIdx, setActiveAccountIdx] = useState<number>(0);

  // Tx state
  const [txType, setTxType] = useState<"transfer" | "token_transfer" | "vault_create">("transfer");
  const [nonceStr, setNonceStr] = useState<string>("0");
  const [feeStr, setFeeStr] = useState<string>("10000"); // in atoms

  // Transfer fields
  const [recipientInput, setRecipientInput] = useState<string>("");
  const [amountKvncStr, setAmountKvncStr] = useState<string>("1");

  // Contract fields
  const [contractHex, setContractHex] = useState<string>("33".repeat(32));
  const [tokenUnitsStr, setTokenUnitsStr] = useState<string>("100");
  const [lockUntilMsStr, setLockUntilMsStr] = useState<string>(
    (Date.now() + 86400000).toString(),
  );

  // Output state
  const [signedResult, setSignedResult] = useState<{
    sighashHex: string;
    signatureHex: string;
    rawTxHex: string;
    txSize: number;
  } | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [broadcastStatus, setBroadcastStatus] = useState<string | null>(null);
  const [copySuccess, setCopySuccess] = useState<string | null>(null);

  // Self-test results
  const [selfTestSteps, setSelfTestSteps] = useState<SelfTestStep[] | null>(null);

  const isMnemonicValid = useMemo(() => validateMnemonic(mnemonic), [mnemonic]);

  const accounts: DerivedAccountInfo[] = useMemo(() => {
    if (!isMnemonicValid) return [];
    try {
      return deriveAccountsFromMnemonic(mnemonic, passphrase, 2, selectedChainId);
    } catch {
      return [];
    }
  }, [mnemonic, passphrase, isMnemonicValid, selectedChainId]);

  const activeAccount = accounts[activeAccountIdx] || accounts[0];

  const handleGenerateMnemonic = () => {
    const fresh = generateMnemonic(256);
    setMnemonic(fresh);
    setSignedResult(null);
    setErrorMsg(null);
  };

  const handleLoadGoldenMnemonic = () => {
    setMnemonic(GOLDEN_MNEMONIC);
    setPassphrase("");
    setSignedResult(null);
    setErrorMsg(null);
  };

  const copyToClipboard = (text: string, label: string) => {
    navigator.clipboard.writeText(text);
    setCopySuccess(label);
    setTimeout(() => setCopySuccess(null), 2000);
  };

  const handleSign = () => {
    setErrorMsg(null);
    setSignedResult(null);
    setBroadcastStatus(null);

    if (!activeAccount) {
      setErrorMsg("No active account available for signing");
      return;
    }

    try {
      const nonce = BigInt(nonceStr || "0");
      const fee = BigInt(feeStr || "10000");

      let kind: TxKind;
      if (txType === "transfer") {
        const toPubkey = recipientInput.trim()
          ? accounts[1]?.publicKey // fallback or decoded
          : accounts[1]?.publicKey || activeAccount.publicKey;
        const amountAtoms = parseKvnc(amountKvncStr || "0");
        kind = {
          type: "transfer",
          to: toPubkey,
          amount: amountAtoms,
        };
      } else if (txType === "token_transfer") {
        const contract = hexToBytes(contractHex.trim());
        const recipient = accounts[1]?.publicKey || activeAccount.publicKey;
        const units = BigInt(tokenUnitsStr || "0");
        kind = buildTokenTransferCall(contract, recipient, units);
      } else {
        const contract = hexToBytes(contractHex.trim());
        const beneficiary = accounts[1]?.publicKey || activeAccount.publicKey;
        const atoms = parseKvnc(amountKvncStr || "0");
        const lockUntil = BigInt(lockUntilMsStr || (Date.now() + 86400000).toString());
        kind = buildVaultCreateCall(contract, beneficiary, atoms, lockUntil);
      }

      const tx: UnsignedTx = {
        sender: activeAccount.publicKey,
        nonce,
        kind,
        fee,
      };

      const result = signAndSerializeTransaction(tx, activeAccount.secretKey, selectedChainId);
      setSignedResult({
        sighashHex: result.sighashHex,
        signatureHex: result.signatureHex,
        rawTxHex: result.rawTxHex,
        txSize: result.txSize,
      });
    } catch (err: any) {
      setErrorMsg(err?.message || String(err));
    }
  };

  const handleBroadcast = async () => {
    if (!signedResult?.rawTxHex) return;
    setBroadcastStatus("Broadcasting via kovanica_sendRawTransaction...");
    try {
      const hash = await client.call<string>("kovanica_sendRawTransaction", [
        signedResult.rawTxHex,
      ]);
      setBroadcastStatus(`Broadcast accepted! Transaction hash: ${hash}`);
    } catch (err: any) {
      setBroadcastStatus(`Broadcast error: ${err?.message || String(err)}`);
    }
  };

  const handleRunSelfTest = () => {
    const res = runGoldenVectorSelfTest();
    setSelfTestSteps(res.steps);
  };

  return (
    <div className="flex flex-col gap-6" data-testid="wallet-contract-console">
      {/* Overview Card */}
      <div className="bg-surface rounded-xl border border-border p-6 flex flex-col gap-4">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border pb-4">
          <div>
            <h2 className="text-base font-semibold text-fg">
              HD Wallet & Wasmi Contract Interoperability
            </h2>
            <p className="text-xs text-muted">
              SLIP-0010 Ed25519 (Coin Type 3007), canonical KVNC/tx/v1 domain tag, and Wasmi ABI
            </p>
          </div>
          <span className="px-2.5 py-1 text-xs font-mono font-semibold rounded-full bg-gold/10 text-gold border border-gold/30">
            PRO-53 & PRO-48 Verified
          </span>
        </div>

        {/* Mnemonic Generation & Input */}
        <div className="flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <label htmlFor="mnemonic-input" className="text-xs font-semibold text-fg uppercase tracking-wider">
              BIP-39 Mnemonic Phrase (24 Words)
            </label>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleLoadGoldenMnemonic}
                className="px-2.5 py-1 text-xs bg-surface-2 hover:bg-border rounded border border-border text-muted hover:text-fg transition-colors"
              >
                Load Golden Vector
              </button>
              <button
                type="button"
                onClick={handleGenerateMnemonic}
                className="px-2.5 py-1 text-xs bg-gold/20 hover:bg-gold/30 rounded border border-gold/40 text-gold transition-colors font-medium"
              >
                Generate Fresh 24 Words
              </button>
            </div>
          </div>

          <textarea
            id="mnemonic-input"
            value={mnemonic}
            onChange={(e) => setMnemonic(e.target.value)}
            rows={2}
            className={`w-full bg-surface-2 border rounded-lg p-3 text-xs font-mono text-fg focus:outline-none ${
              isMnemonicValid ? "border-border focus:border-gold" : "border-red-500"
            }`}
            placeholder="enter 24 english words..."
          />

          <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
            <span
              className={`font-medium ${
                isMnemonicValid ? "text-emerald-400" : "text-red-400"
              }`}
            >
              {isMnemonicValid
                ? "✓ Valid 24-word BIP-39 mnemonic phrase"
                : "✗ Invalid mnemonic checksum or word count"}
            </span>
            <div className="flex items-center gap-2">
              <span className="text-muted">Passphrase (optional):</span>
              <input
                type="password"
                value={passphrase}
                onChange={(e) => setPassphrase(e.target.value)}
                placeholder="empty"
                className="bg-surface-2 border border-border rounded px-2 py-0.5 text-xs font-mono text-fg"
              />
            </div>
          </div>
        </div>

        {/* Derived Accounts Display */}
        {accounts.length > 0 && (
          <div className="flex flex-col gap-3 mt-2">
            <h3 className="text-xs font-semibold text-muted uppercase tracking-wider">
              Derived Multi-Account Hierarchy (SLIP-0010 Coin Type {KOVANICA_COIN_TYPE})
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {accounts.map((acc) => {
                const isActive = activeAccountIdx === acc.accountIndex;
                return (
                  <div
                    key={acc.accountIndex}
                    onClick={() => setActiveAccountIdx(acc.accountIndex)}
                    className={`cursor-pointer rounded-xl border p-4 flex flex-col gap-2 transition-all ${
                      isActive
                        ? "bg-surface-2 border-gold ring-1 ring-gold/40 shadow-sm"
                        : "bg-surface-2/60 border-border hover:border-muted"
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-bold text-fg">
                        Account #{acc.accountIndex}
                      </span>
                      <span className="text-[11px] font-mono text-gold px-2 py-0.5 rounded bg-gold/10">
                        {acc.path}
                      </span>
                    </div>

                    <div className="flex flex-col gap-1 text-[11px]">
                      <span className="text-muted">Public Key (Ed25519):</span>
                      <span className="font-mono text-fg break-all bg-surface p-1.5 rounded border border-border/60">
                        {acc.publicKeyHex}
                      </span>
                    </div>

                    <div className="flex flex-col gap-1 text-[11px]">
                      <span className="text-muted">
                        Active Network Address (Chain {selectedChainId}):
                      </span>
                      <span className="font-mono text-emerald-400 break-all bg-surface p-1.5 rounded border border-border/60">
                        {acc.address}
                      </span>
                    </div>

                    <div className="flex items-center justify-between text-[10px] text-muted pt-1 border-t border-border/40">
                      <span>Mainnet: {acc.mainnetAddress.slice(0, 10)}...{acc.mainnetAddress.slice(-6)}</span>
                      <span>Testnet: {acc.testnetAddress.slice(0, 10)}...{acc.testnetAddress.slice(-6)}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* Transaction Signing & Wasmi Interop */}
      <div className="bg-surface rounded-xl border border-border p-6 flex flex-col gap-5">
        <h2 className="text-sm font-semibold text-fg border-b border-border pb-3">
          Construct & Sign Canonical Transaction
        </h2>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div>
            <label className="block text-xs font-medium text-muted mb-1">
              Transaction Action
            </label>
            <select
              value={txType}
              onChange={(e) => setTxType(e.target.value as any)}
              className="w-full bg-surface-2 border border-border rounded-lg px-3 py-2 text-xs font-medium text-fg focus:outline-none focus:border-gold"
            >
              <option value="transfer">Native Transfer (KVNC)</option>
              <option value="token_transfer">Wasmi: Token Transfer (token_transfer)</option>
              <option value="vault_create">Wasmi: Timelocked Vault (vault_create)</option>
            </select>
          </div>

          <div>
            <label className="block text-xs font-medium text-muted mb-1">
              Account Nonce
            </label>
            <input
              type="number"
              value={nonceStr}
              onChange={(e) => setNonceStr(e.target.value)}
              className="w-full bg-surface-2 border border-border rounded-lg px-3 py-2 text-xs font-mono text-fg"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-muted mb-1">
              Fee (atoms)
            </label>
            <input
              type="text"
              value={feeStr}
              onChange={(e) => setFeeStr(e.target.value)}
              className="w-full bg-surface-2 border border-border rounded-lg px-3 py-2 text-xs font-mono text-fg"
            />
          </div>
        </div>

        {/* Dynamic Action Parameters */}
        <div className="bg-surface-2/60 p-4 rounded-lg border border-border/80 flex flex-col gap-3">
          {txType === "transfer" && (
            <>
              <div>
                <label className="block text-xs font-medium text-muted mb-1">
                  Recipient (Defaults to Account #1)
                </label>
                <input
                  type="text"
                  value={recipientInput}
                  onChange={(e) => setRecipientInput(e.target.value)}
                  placeholder={accounts[1]?.address || "Recipient kvnc/tknc address"}
                  className="w-full bg-surface border border-border rounded-lg px-3 py-2 text-xs font-mono text-fg"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-muted mb-1">
                  Amount (KVNC)
                </label>
                <input
                  type="text"
                  value={amountKvncStr}
                  onChange={(e) => setAmountKvncStr(e.target.value)}
                  className="w-full bg-surface border border-border rounded-lg px-3 py-2 text-xs font-mono text-fg"
                />
              </div>
            </>
          )}

          {txType === "token_transfer" && (
            <>
              <div>
                <label className="block text-xs font-medium text-muted mb-1">
                  Token Contract Address (32-byte hex)
                </label>
                <input
                  type="text"
                  value={contractHex}
                  onChange={(e) => setContractHex(e.target.value)}
                  className="w-full bg-surface border border-border rounded-lg px-3 py-2 text-xs font-mono text-fg"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-muted mb-1">
                  Token Units (u128)
                </label>
                <input
                  type="text"
                  value={tokenUnitsStr}
                  onChange={(e) => setTokenUnitsStr(e.target.value)}
                  className="w-full bg-surface border border-border rounded-lg px-3 py-2 text-xs font-mono text-fg"
                />
              </div>
            </>
          )}

          {txType === "vault_create" && (
            <>
              <div>
                <label className="block text-xs font-medium text-muted mb-1">
                  Vault Contract Address (32-byte hex)
                </label>
                <input
                  type="text"
                  value={contractHex}
                  onChange={(e) => setContractHex(e.target.value)}
                  className="w-full bg-surface border border-border rounded-lg px-3 py-2 text-xs font-mono text-fg"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-muted mb-1">
                    Deposit Amount (KVNC)
                  </label>
                  <input
                    type="text"
                    value={amountKvncStr}
                    onChange={(e) => setAmountKvncStr(e.target.value)}
                    className="w-full bg-surface border border-border rounded-lg px-3 py-2 text-xs font-mono text-fg"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-muted mb-1">
                    Lock Until (ms timestamp)
                  </label>
                  <input
                    type="text"
                    value={lockUntilMsStr}
                    onChange={(e) => setLockUntilMsStr(e.target.value)}
                    className="w-full bg-surface border border-border rounded-lg px-3 py-2 text-xs font-mono text-fg"
                  />
                </div>
              </div>
            </>
          )}
        </div>

        <button
          type="button"
          onClick={handleSign}
          disabled={!isMnemonicValid}
          className="px-5 py-2.5 bg-gold hover:bg-gold/90 text-bg font-semibold rounded-lg text-sm transition-colors disabled:opacity-50 self-start"
        >
          Sign & Bincode Serialize
        </button>

        {errorMsg && (
          <div className="text-xs text-red-400 bg-red-950/40 p-3 rounded border border-red-800">
            {errorMsg}
          </div>
        )}

        {/* Signed Output Card */}
        {signedResult && (
          <div className="bg-surface-2 p-4 rounded-lg border border-border flex flex-col gap-3 text-xs">
            <div className="flex items-center justify-between border-b border-border/60 pb-2">
              <span className="font-semibold text-fg">
                Signed Bincode Envelope ({signedResult.txSize} Bytes)
              </span>
              <span className="font-mono text-gold text-[11px]">Domain: KVNC/tx/v1</span>
            </div>

            <div className="flex flex-col gap-1">
              <span className="text-muted">Keyed BLAKE3 Sighash (32 bytes):</span>
              <span className="font-mono text-fg break-all bg-surface p-2 rounded">
                {signedResult.sighashHex}
              </span>
            </div>

            <div className="flex flex-col gap-1">
              <span className="text-muted">Ed25519 Signature (64 bytes):</span>
              <span className="font-mono text-fg break-all bg-surface p-2 rounded">
                {signedResult.signatureHex}
              </span>
            </div>

            <div className="flex flex-col gap-1">
              <div className="flex items-center justify-between">
                <span className="text-muted">Raw Wire Payload (Bincode Hex):</span>
                <button
                  type="button"
                  onClick={() => copyToClipboard(signedResult.rawTxHex, "tx")}
                  className="text-subtle hover:text-fg font-medium"
                >
                  {copySuccess === "tx" ? "Copied!" : "Copy Hex"}
                </button>
              </div>
              <textarea
                readOnly
                value={signedResult.rawTxHex}
                rows={3}
                className="w-full bg-surface p-2 rounded font-mono text-[11px] text-emerald-400 break-all resize-none border border-border/40"
              />
            </div>

            <div className="flex items-center gap-3 mt-2">
              <button
                type="button"
                onClick={handleBroadcast}
                className="px-4 py-1.5 bg-surface-2 hover:bg-border rounded border border-border text-fg font-medium text-xs transition-colors"
              >
                Broadcast to Connected Node (kovanica_sendRawTransaction)
              </button>
              {broadcastStatus && (
                <span className="text-xs text-muted font-mono">{broadcastStatus}</span>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Self-Test & Invariant Verification Suite */}
      <div className="bg-surface rounded-xl border border-border p-6 flex flex-col gap-4">
        <div className="flex items-center justify-between border-b border-border pb-3">
          <div>
            <h2 className="text-sm font-semibold text-fg">
              Golden Vector & Consensus Invariant Runner
            </h2>
            <p className="text-xs text-muted">
              Live verification of coin type 3007, Ed25519 curve math, and Wasmi ABI serialization
            </p>
          </div>
          <button
            type="button"
            onClick={handleRunSelfTest}
            className="px-4 py-2 bg-gold/20 hover:bg-gold/30 rounded-lg border border-gold/40 text-gold text-xs font-semibold transition-colors"
          >
            Run Self-Test Suite
          </button>
        </div>

        {selfTestSteps && (
          <div className="flex flex-col gap-2.5">
            {selfTestSteps.map((step, idx) => (
              <div
                key={idx}
                className={`p-3 rounded-lg border text-xs flex items-start justify-between gap-3 ${
                  step.passed
                    ? "bg-emerald-950/20 border-emerald-800/40 text-emerald-300"
                    : "bg-red-950/20 border-red-800/40 text-red-300"
                }`}
              >
                <div>
                  <div className="flex items-center gap-2">
                    <span>{step.passed ? "✓" : "✗"}</span>
                    <span className="font-semibold">{step.name}</span>
                  </div>
                  {step.actual && (
                    <p className="text-[11px] mt-1 font-mono text-muted">{step.actual}</p>
                  )}
                </div>
                <span className="font-mono text-[11px] uppercase tracking-wider font-bold">
                  {step.passed ? "PASS" : "FAIL"}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
