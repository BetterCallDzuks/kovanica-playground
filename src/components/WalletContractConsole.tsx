import { useState, useMemo } from "react";
import {
  parseKvnc,
  type KovanicaClient,
  KOVANICA_COIN_TYPE,
} from "kovanica-sdk";
import {
  buildEscrowCreateCall,
  buildHtlcCreateCall,
  buildNameRegisterCall,
  buildNftMintCall,
  buildPlaygroundCallCurlSnippet,
  buildPlaygroundCallSdkSnippet,
  buildTokenTransferCall,
  buildVaultCreateCall,
  bytesToHex,
  decodeContractStateHex,
  deriveAccountsFromMnemonic,
  deriveContractStorageSlotHex,
  estimateContractCall,
  estimateContractCallBatch,
  fetchAndDecodeContractStorageSlot,
  generateMnemonic,
  hexToBytes,
  KovanicaDecodeError,
  runGoldenVectorSelfTest,
  signAndSerializeTransaction,
  validateMnemonic,
  type CallTxKind,
  type ContractDecoderKind,
  type DerivedAccountInfo,
  type PreparedContractCallBatch,
  type PreparedCallTransaction,
  type SelfTestStep,
  type TxKind,
  type UnsignedTx,
} from "../wallet-interop";

interface Props {
  client: KovanicaClient;
  selectedChainId: number;
  rpcUrl?: string;
}

const GOLDEN_MNEMONIC =
  "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";

export function WalletContractConsole({ client, selectedChainId, rpcUrl }: Props) {
  // Mnemonic state
  const [mnemonic, setMnemonic] = useState<string>(GOLDEN_MNEMONIC);
  const [passphrase, setPassphrase] = useState<string>("");
  const [activeAccountIdx, setActiveAccountIdx] = useState<number>(0);

  // Tx state
  const [txType, setTxType] = useState<
    | "transfer"
    | "token_transfer"
    | "vault_create"
    | "name_register"
    | "htlc_create"
    | "nft_mint"
    | "escrow_create"
  >("transfer");
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

  // Name Registry fields
  const [nameStr, setNameStr] = useState<string>("alice");
  const [namePubkeyHex, setNamePubkeyHex] = useState<string>("");
  const [relayEndpointsStr, setRelayEndpointsStr] = useState<string>(
    "https://relay1.kovanica.org\nhttps://relay2.kovanica.org",
  );

  // HTLC fields
  const [hashlockHex, setHashlockHex] = useState<string>("11".repeat(32));
  const [timelockStr, setTimelockStr] = useState<string>(
    (Date.now() + 86400000).toString(),
  );
  const [htlcRecipientHex, setHtlcRecipientHex] = useState<string>("");

  // NFT fields
  const [collectionHex, setCollectionHex] = useState<string>("77".repeat(32));
  const [nftToHex, setNftToHex] = useState<string>("");
  const [tokenIdStr, setTokenIdStr] = useState<string>("1");
  const [tokenUriStr, setTokenUriStr] = useState<string>(
    "ipfs://bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi",
  );

  // Escrow fields
  const [escrowPartiesStr, setEscrowPartiesStr] = useState<string>("");
  const [escrowThresholdStr, setEscrowThresholdStr] = useState<string>("2");
  const [escrowAmountStr, setEscrowAmountStr] = useState<string>("1000000000"); // 1 KVNC
  const [escrowDeadlineStr, setEscrowDeadlineStr] = useState<string>(
    (Date.now() + 172800000).toString(),
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

  // SDK v0.4.0 Fee & Nonce Estimation state
  const [isEstimating, setIsEstimating] = useState<boolean>(false);
  const [preparedEstimate, setPreparedEstimate] = useState<PreparedCallTransaction | null>(null);

  // Multi-Call Batch Estimator & Code Exporter state
  const [batchQueue, setBatchQueue] = useState<CallTxKind[]>([]);
  const [isEstimatingBatch, setIsEstimatingBatch] = useState<boolean>(false);
  const [batchEstimateResult, setBatchEstimateResult] = useState<PreparedContractCallBatch | null>(null);
  const [activeCodeSnippet, setActiveCodeSnippet] = useState<{
    kind: "curl" | "sdk";
    code: string;
  } | null>(null);

  // SDK v0.4.0 Contract State Bincode Decoder & Live Storage Slot Fetch state
  const [decoderKind, setDecoderKind] = useState<ContractDecoderKind>("name");
  const [storageContractAddr, setStorageContractAddr] = useState<string>("0x" + "33".repeat(32));
  const [customSlotPrefix, setCustomSlotPrefix] = useState<string>("");
  const [slotKeyInput, setSlotKeyInput] = useState<string>("alice");
  const [derivedSlotHex, setDerivedSlotHex] = useState<string | null>(null);
  const [decoderHexInput, setDecoderHexInput] = useState<string>("");
  const [decodedOutput, setDecodedOutput] = useState<string | null>(null);
  const [decoderError, setDecoderError] = useState<string | null>(null);
  const [storageEmptyMsg, setStorageEmptyMsg] = useState<string | null>(null);
  const [isFetchingStorage, setIsFetchingStorage] = useState<boolean>(false);

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
    if (typeof navigator !== "undefined" && navigator.clipboard) {
      navigator.clipboard.writeText(text);
    }
    setCopySuccess(label);
    setTimeout(() => setCopySuccess(null), 2000);
  };

  const buildActiveCallKind = (): CallTxKind => {
    if (!activeAccount) {
      throw new Error("No active account available");
    }
    const contract = hexToBytes(contractHex.trim());
    if (txType === "token_transfer") {
      const recipient = accounts[1]?.publicKey || activeAccount.publicKey;
      const units = BigInt(tokenUnitsStr || "0");
      return buildTokenTransferCall(contract, recipient, units);
    }
    if (txType === "vault_create") {
      const beneficiary = accounts[1]?.publicKey || activeAccount.publicKey;
      const atoms = parseKvnc(amountKvncStr || "0");
      const lockUntil = BigInt(lockUntilMsStr || (Date.now() + 86400000).toString());
      return buildVaultCreateCall(contract, beneficiary, atoms, lockUntil);
    }
    if (txType === "name_register") {
      const regPubkey = namePubkeyHex.trim()
        ? hexToBytes(namePubkeyHex.trim())
        : accounts[1]?.publicKey || activeAccount.publicKey;
      const endpoints = relayEndpointsStr
        .split("\n")
        .map((s) => s.trim())
        .filter((s) => s.length > 0);
      return {
        type: "call",
        contract,
        value: 0n,
        method: "name_register",
        args: buildNameRegisterCall(nameStr.trim(), regPubkey, endpoints),
        gasLimit: 100_000n,
      };
    }
    if (txType === "htlc_create") {
      const hashlock = hexToBytes(hashlockHex.trim());
      const timelock = BigInt(timelockStr.trim() || "0");
      const recipient = htlcRecipientHex.trim()
        ? hexToBytes(htlcRecipientHex.trim())
        : accounts[1]?.publicKey || activeAccount.publicKey;
      return {
        type: "call",
        contract,
        value: 0n,
        method: "htlc_create",
        args: buildHtlcCreateCall(hashlock, timelock, recipient),
        gasLimit: 100_000n,
      };
    }
    if (txType === "nft_mint") {
      const collection = hexToBytes(collectionHex.trim());
      const to = nftToHex.trim()
        ? hexToBytes(nftToHex.trim())
        : accounts[1]?.publicKey || activeAccount.publicKey;
      const tokenId = BigInt(tokenIdStr.trim() || "0");
      return {
        type: "call",
        contract,
        value: 0n,
        method: "nft_mint",
        args: buildNftMintCall(collection, to, tokenId, tokenUriStr.trim()),
        gasLimit: 100_000n,
      };
    }
    if (txType === "escrow_create") {
      const rawParties = escrowPartiesStr
        .split(/[\n,]/)
        .map((s) => s.trim())
        .filter((s) => s.length > 0);
      const parties =
        rawParties.length > 0
          ? rawParties.map((p) => hexToBytes(p))
          : [activeAccount.publicKey, accounts[1]?.publicKey || activeAccount.publicKey];
      const threshold = Number(escrowThresholdStr.trim() || "1");
      const amount = BigInt(escrowAmountStr.trim() || "0");
      const deadline = BigInt(escrowDeadlineStr.trim() || "0");
      return {
        type: "call",
        contract,
        value: 0n,
        method: "escrow_create",
        args: buildEscrowCreateCall(parties, threshold, amount, deadline),
        gasLimit: 100_000n,
      };
    }
    throw new Error(`Estimate is only supported for Wasmi contract call actions (got ${txType})`);
  };

  const resolvedRpcUrl = useMemo(() => {
    if (rpcUrl && rpcUrl.trim().length > 0) return rpcUrl.trim();
    const clientUrl = (client as unknown as { url?: string })?.url;
    if (typeof clientUrl === "string" && clientUrl.trim().length > 0) {
      return clientUrl.trim();
    }
    return "http://127.0.0.1:8545/rpc";
  }, [rpcUrl, client]);

  const handleEstimateCall = async () => {
    setErrorMsg(null);
    setPreparedEstimate(null);
    if (!activeAccount) {
      setErrorMsg("No active account available for fee estimation");
      return;
    }
    setIsEstimating(true);
    try {
      const callKind = buildActiveCallKind();
      const prepared = await estimateContractCall(client, callKind, {
        sender: activeAccount.address,
        chainId: selectedChainId,
      });
      setPreparedEstimate(prepared);
      setFeeStr(prepared.fee.toString());
      if (prepared.nonce !== undefined) {
        setNonceStr(prepared.nonce.toString());
      }
    } catch (err: any) {
      setErrorMsg(`Fee estimation failed: ${err?.message || String(err)}`);
    } finally {
      setIsEstimating(false);
    }
  };

  const handleQueueToBatch = () => {
    setErrorMsg(null);
    try {
      const callKind = buildActiveCallKind();
      setBatchQueue((prev) => [...prev, callKind]);
      setBatchEstimateResult(null);
    } catch (err: any) {
      setErrorMsg(`Cannot queue call to batch: ${err?.message || String(err)}`);
    }
  };

  const handleClearBatch = () => {
    setBatchQueue([]);
    setBatchEstimateResult(null);
  };

  const handleEstimateBatch = async () => {
    setErrorMsg(null);
    setBatchEstimateResult(null);
    if (!activeAccount) {
      setErrorMsg("No active account available for batch estimation");
      return;
    }
    setIsEstimatingBatch(true);
    try {
      const callsToEstimate =
        batchQueue.length > 0 ? batchQueue : [buildActiveCallKind()];
      if (batchQueue.length === 0) {
        setBatchQueue(callsToEstimate);
      }
      const batchRes = await estimateContractCallBatch(client, callsToEstimate, {
        sender: activeAccount.address,
        chainId: selectedChainId,
      });
      setBatchEstimateResult(batchRes);
    } catch (err: any) {
      setErrorMsg(`Batch estimation failed: ${err?.message || String(err)}`);
    } finally {
      setIsEstimatingBatch(false);
    }
  };

  const handleExportCurlSnippet = () => {
    setErrorMsg(null);
    try {
      const callKind = buildActiveCallKind();
      const snippet = buildPlaygroundCallCurlSnippet({
        rpcUrl: resolvedRpcUrl,
        call: callKind,
        sender: activeAccount?.address,
      });
      setActiveCodeSnippet({ kind: "curl", code: snippet });
      copyToClipboard(snippet, "curl-snippet");
    } catch (err: any) {
      setErrorMsg(`Failed to generate cURL snippet: ${err?.message || String(err)}`);
    }
  };

  const handleExportSdkSnippet = () => {
    setErrorMsg(null);
    try {
      const callKind = buildActiveCallKind();
      const snippet = buildPlaygroundCallSdkSnippet({
        rpcUrl: resolvedRpcUrl,
        call: callKind,
        sender: activeAccount?.address,
        chainId: selectedChainId,
      });
      setActiveCodeSnippet({ kind: "sdk", code: snippet });
      copyToClipboard(snippet, "sdk-snippet");
    } catch (err: any) {
      setErrorMsg(`Failed to generate SDK snippet: ${err?.message || String(err)}`);
    }
  };

  const handleDecodeState = () => {
    setDecoderError(null);
    setDecodedOutput(null);
    setStorageEmptyMsg(null);
    try {
      const decoded = decodeContractStateHex(decoderKind, decoderHexInput.trim());
      setDecodedOutput(
        JSON.stringify(
          decoded,
          (_key, value) => (typeof value === "bigint" ? value.toString() : value),
          2,
        ),
      );
    } catch (err: unknown) {
      if (err instanceof KovanicaDecodeError) {
        setDecoderError(
          `[${err.code}${err.offset !== undefined ? ` @ byte ${err.offset}` : ""}] ${err.message}`,
        );
      } else {
        setDecoderError(err instanceof Error ? err.message : String(err));
      }
    }
  };

  const handleDeriveSlot = () => {
    setDecoderError(null);
    setStorageEmptyMsg(null);
    try {
      const slot = deriveContractStorageSlotHex({
        kind: decoderKind,
        key: slotKeyInput,
        customPrefix: customSlotPrefix,
      });
      setDerivedSlotHex(slot);
    } catch (err: unknown) {
      if (err instanceof KovanicaDecodeError) {
        setDecoderError(`[${err.code}] ${err.message}`);
      } else {
        setDecoderError(err instanceof Error ? err.message : String(err));
      }
    }
  };

  const handleFetchAndDecodeStorage = async () => {
    setDecoderError(null);
    setDecodedOutput(null);
    setStorageEmptyMsg(null);
    setIsFetchingStorage(true);
    try {
      const result = await fetchAndDecodeContractStorageSlot(client, {
        contractAddress: storageContractAddr,
        kind: decoderKind,
        key: slotKeyInput,
        customPrefix: customSlotPrefix,
      });
      setDerivedSlotHex(result.slotHex);
      setDecoderHexInput(result.rawStorageHex);
      if (result.isEmpty) {
        setStorageEmptyMsg(
          `Storage slot 0x${result.slotHex} is empty (${result.rawStorageHex}) on contract ${result.contractAddress}.`,
        );
      } else {
        setDecodedOutput(
          JSON.stringify(
            result.decoded,
            (_key, value) => (typeof value === "bigint" ? value.toString() : value),
            2,
          ),
        );
      }
    } catch (err: unknown) {
      if (err instanceof KovanicaDecodeError) {
        setDecoderError(
          `[${err.code}${err.offset !== undefined ? ` @ byte ${err.offset}` : ""}] ${err.message}`,
        );
      } else {
        setDecoderError(err instanceof Error ? err.message : String(err));
      }
    } finally {
      setIsFetchingStorage(false);
    }
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
      } else if (txType === "vault_create") {
        const contract = hexToBytes(contractHex.trim());
        const beneficiary = accounts[1]?.publicKey || activeAccount.publicKey;
        const atoms = parseKvnc(amountKvncStr || "0");
        const lockUntil = BigInt(lockUntilMsStr || (Date.now() + 86400000).toString());
        kind = buildVaultCreateCall(contract, beneficiary, atoms, lockUntil);
      } else if (txType === "name_register") {
        const contract = hexToBytes(contractHex.trim());
        const regPubkey = namePubkeyHex.trim()
          ? hexToBytes(namePubkeyHex.trim())
          : accounts[1]?.publicKey || activeAccount.publicKey;
        const endpoints = relayEndpointsStr
          .split("\n")
          .map((s) => s.trim())
          .filter((s) => s.length > 0);
        const args = buildNameRegisterCall(nameStr.trim(), regPubkey, endpoints);
        kind = {
          type: "call",
          contract,
          value: 0n,
          method: "name_register",
          args,
          gasLimit: 100_000n,
        };
      } else if (txType === "htlc_create") {
        const contract = hexToBytes(contractHex.trim());
        const hashlock = hexToBytes(hashlockHex.trim());
        const timelock = BigInt(timelockStr.trim() || "0");
        const recipient = htlcRecipientHex.trim()
          ? hexToBytes(htlcRecipientHex.trim())
          : accounts[1]?.publicKey || activeAccount.publicKey;
        const args = buildHtlcCreateCall(hashlock, timelock, recipient);
        kind = {
          type: "call",
          contract,
          value: 0n,
          method: "htlc_create",
          args,
          gasLimit: 100_000n,
        };
      } else if (txType === "nft_mint") {
        const contract = hexToBytes(contractHex.trim());
        const collection = hexToBytes(collectionHex.trim());
        const to = nftToHex.trim()
          ? hexToBytes(nftToHex.trim())
          : accounts[1]?.publicKey || activeAccount.publicKey;
        const tokenId = BigInt(tokenIdStr.trim() || "0");
        const args = buildNftMintCall(collection, to, tokenId, tokenUriStr.trim());
        kind = {
          type: "call",
          contract,
          value: 0n,
          method: "nft_mint",
          args,
          gasLimit: 100_000n,
        };
      } else if (txType === "escrow_create") {
        const contract = hexToBytes(contractHex.trim());
        const rawParties = escrowPartiesStr
          .split(/[\n,]/)
          .map((s) => s.trim())
          .filter((s) => s.length > 0);
        const parties = rawParties.length > 0
          ? rawParties.map((p) => hexToBytes(p))
          : [activeAccount.publicKey, accounts[1]?.publicKey || activeAccount.publicKey];
        const threshold = Number(escrowThresholdStr.trim() || "1");
        const amount = BigInt(escrowAmountStr.trim() || "0");
        const deadline = BigInt(escrowDeadlineStr.trim() || "0");
        const args = buildEscrowCreateCall(parties, threshold, amount, deadline);
        kind = {
          type: "call",
          contract,
          value: 0n,
          method: "escrow_create",
          args,
          gasLimit: 100_000n,
        };
      } else {
        throw new Error(`Unknown transaction type: ${txType}`);
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
              <option value="name_register">Wasmi: Name Registry (name_register)</option>
              <option value="htlc_create">Wasmi: Hash Time Locked Contract (htlc_create)</option>
              <option value="nft_mint">Wasmi: NFT Mint (nft_mint)</option>
              <option value="escrow_create">Wasmi: Escrow Create (escrow_create)</option>
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

          {txType === "name_register" && (
            <>
              <div>
                <label className="block text-xs font-medium text-muted mb-1">
                  Name Registry Contract Address (32-byte hex)
                </label>
                <input
                  type="text"
                  value={contractHex}
                  onChange={(e) => setContractHex(e.target.value)}
                  className="w-full bg-surface border border-border rounded-lg px-3 py-2 text-xs font-mono text-fg"
                />
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-muted mb-1">
                    Registered Name
                  </label>
                  <input
                    type="text"
                    value={nameStr}
                    onChange={(e) => setNameStr(e.target.value)}
                    className="w-full bg-surface border border-border rounded-lg px-3 py-2 text-xs font-mono text-fg"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-muted mb-1">
                    Registered Public Key (32-byte hex)
                  </label>
                  <input
                    type="text"
                    value={namePubkeyHex}
                    onChange={(e) => setNamePubkeyHex(e.target.value)}
                    placeholder={accounts[1]?.publicKeyHex || "Defaults to Account #1"}
                    className="w-full bg-surface border border-border rounded-lg px-3 py-2 text-xs font-mono text-fg"
                  />
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-muted mb-1">
                  Relay Endpoints (one URL per line)
                </label>
                <textarea
                  rows={2}
                  value={relayEndpointsStr}
                  onChange={(e) => setRelayEndpointsStr(e.target.value)}
                  className="w-full bg-surface border border-border rounded-lg px-3 py-2 text-xs font-mono text-fg"
                />
              </div>
            </>
          )}

          {txType === "htlc_create" && (
            <>
              <div>
                <label className="block text-xs font-medium text-muted mb-1">
                  HTLC Contract Address (32-byte hex)
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
                  Hash Lock (32-byte hex)
                </label>
                <input
                  type="text"
                  value={hashlockHex}
                  onChange={(e) => setHashlockHex(e.target.value)}
                  className="w-full bg-surface border border-border rounded-lg px-3 py-2 text-xs font-mono text-fg"
                />
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-muted mb-1">
                    Timelock Expiry (u64 timestamp/height)
                  </label>
                  <input
                    type="text"
                    value={timelockStr}
                    onChange={(e) => setTimelockStr(e.target.value)}
                    className="w-full bg-surface border border-border rounded-lg px-3 py-2 text-xs font-mono text-fg"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-muted mb-1">
                    Recipient Public Key (32-byte hex)
                  </label>
                  <input
                    type="text"
                    value={htlcRecipientHex}
                    onChange={(e) => setHtlcRecipientHex(e.target.value)}
                    placeholder={accounts[1]?.publicKeyHex || "Defaults to Account #1"}
                    className="w-full bg-surface border border-border rounded-lg px-3 py-2 text-xs font-mono text-fg"
                  />
                </div>
              </div>
            </>
          )}

          {txType === "nft_mint" && (
            <>
              <div>
                <label className="block text-xs font-medium text-muted mb-1">
                  NFT Contract Address (32-byte hex)
                </label>
                <input
                  type="text"
                  value={contractHex}
                  onChange={(e) => setContractHex(e.target.value)}
                  className="w-full bg-surface border border-border rounded-lg px-3 py-2 text-xs font-mono text-fg"
                />
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-muted mb-1">
                    Collection Public Key (32-byte hex)
                  </label>
                  <input
                    type="text"
                    value={collectionHex}
                    onChange={(e) => setCollectionHex(e.target.value)}
                    className="w-full bg-surface border border-border rounded-lg px-3 py-2 text-xs font-mono text-fg"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-muted mb-1">
                    Recipient / To Public Key (32-byte hex)
                  </label>
                  <input
                    type="text"
                    value={nftToHex}
                    onChange={(e) => setNftToHex(e.target.value)}
                    placeholder={accounts[1]?.publicKeyHex || "Defaults to Account #1"}
                    className="w-full bg-surface border border-border rounded-lg px-3 py-2 text-xs font-mono text-fg"
                  />
                </div>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <div>
                  <label className="block text-xs font-medium text-muted mb-1">
                    Token ID (u128)
                  </label>
                  <input
                    type="text"
                    value={tokenIdStr}
                    onChange={(e) => setTokenIdStr(e.target.value)}
                    className="w-full bg-surface border border-border rounded-lg px-3 py-2 text-xs font-mono text-fg"
                  />
                </div>
                <div className="md:col-span-2">
                  <label className="block text-xs font-medium text-muted mb-1">
                    Token URI
                  </label>
                  <input
                    type="text"
                    value={tokenUriStr}
                    onChange={(e) => setTokenUriStr(e.target.value)}
                    className="w-full bg-surface border border-border rounded-lg px-3 py-2 text-xs font-mono text-fg"
                  />
                </div>
              </div>
            </>
          )}

          {txType === "escrow_create" && (
            <>
              <div>
                <label className="block text-xs font-medium text-muted mb-1">
                  Escrow Contract Address (32-byte hex)
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
                  Parties Public Keys (32-byte hexes, one per line or comma-separated)
                </label>
                <textarea
                  rows={2}
                  value={escrowPartiesStr}
                  onChange={(e) => setEscrowPartiesStr(e.target.value)}
                  placeholder={
                    accounts.length >= 2
                      ? `${accounts[0].publicKeyHex}\n${accounts[1].publicKeyHex}`
                      : "Defaults to Account #0 and #1"
                  }
                  className="w-full bg-surface border border-border rounded-lg px-3 py-2 text-xs font-mono text-fg"
                />
              </div>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <div>
                  <label className="block text-xs font-medium text-muted mb-1">
                    Threshold (u8)
                  </label>
                  <input
                    type="number"
                    min={1}
                    max={255}
                    value={escrowThresholdStr}
                    onChange={(e) => setEscrowThresholdStr(e.target.value)}
                    className="w-full bg-surface border border-border rounded-lg px-3 py-2 text-xs font-mono text-fg"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-muted mb-1">
                    Amount (atoms)
                  </label>
                  <input
                    type="text"
                    value={escrowAmountStr}
                    onChange={(e) => setEscrowAmountStr(e.target.value)}
                    className="w-full bg-surface border border-border rounded-lg px-3 py-2 text-xs font-mono text-fg"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-muted mb-1">
                    Deadline (u64 timestamp)
                  </label>
                  <input
                    type="text"
                    value={escrowDeadlineStr}
                    onChange={(e) => setEscrowDeadlineStr(e.target.value)}
                    className="w-full bg-surface border border-border rounded-lg px-3 py-2 text-xs font-mono text-fg"
                  />
                </div>
              </div>
            </>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={handleSign}
            disabled={!isMnemonicValid}
            className="px-5 py-2.5 bg-gold hover:bg-gold/90 text-bg font-semibold rounded-lg text-sm transition-colors disabled:opacity-50"
          >
            Sign & Bincode Serialize
          </button>

          {txType !== "transfer" && (
            <>
              <button
                type="button"
                data-testid="estimate-call-btn"
                onClick={handleEstimateCall}
                disabled={!isMnemonicValid || isEstimating}
                className="px-4 py-2.5 bg-surface-2 hover:bg-border text-fg font-medium rounded-lg text-xs border border-border transition-colors disabled:opacity-50"
              >
                {isEstimating ? "Estimating..." : "Estimate Fee & Nonce (SDK)"}
              </button>

              <button
                type="button"
                data-testid="queue-batch-call-btn"
                onClick={handleQueueToBatch}
                disabled={!isMnemonicValid}
                className="px-3.5 py-2.5 bg-surface-2 hover:bg-border text-fg font-medium rounded-lg text-xs border border-border transition-colors disabled:opacity-50"
              >
                Queue to Batch ({batchQueue.length})
              </button>

              <button
                type="button"
                data-testid="estimate-batch-btn"
                onClick={handleEstimateBatch}
                disabled={!isMnemonicValid || isEstimatingBatch}
                className="px-3.5 py-2.5 bg-gold/20 hover:bg-gold/30 text-gold font-semibold rounded-lg text-xs border border-gold/40 transition-colors disabled:opacity-50"
              >
                {isEstimatingBatch ? "Estimating Batch..." : "Estimate Batch"}
              </button>

              {batchQueue.length > 0 && (
                <button
                  type="button"
                  data-testid="clear-batch-btn"
                  onClick={handleClearBatch}
                  className="px-3 py-2.5 bg-surface-2 hover:bg-border text-muted hover:text-fg font-medium rounded-lg text-xs border border-border transition-colors"
                >
                  Clear Batch
                </button>
              )}

              <button
                type="button"
                data-testid="copy-curl-snippet-btn"
                onClick={handleExportCurlSnippet}
                disabled={!isMnemonicValid}
                className="px-3.5 py-2.5 bg-surface-2 hover:bg-border text-fg font-medium rounded-lg text-xs border border-border transition-colors disabled:opacity-50"
              >
                {copySuccess === "curl-snippet" ? "Copied cURL!" : "Copy JSON-RPC cURL"}
              </button>

              <button
                type="button"
                data-testid="copy-sdk-snippet-btn"
                onClick={handleExportSdkSnippet}
                disabled={!isMnemonicValid}
                className="px-3.5 py-2.5 bg-surface-2 hover:bg-border text-fg font-medium rounded-lg text-xs border border-border transition-colors disabled:opacity-50"
              >
                {copySuccess === "sdk-snippet" ? "Copied SDK!" : "Copy SDK Snippet"}
              </button>
            </>
          )}
        </div>

        {activeCodeSnippet && txType !== "transfer" && (
          <div
            data-testid="code-exporter-preview"
            className="bg-surface-2 border border-border rounded-lg p-3 flex flex-col gap-2 text-xs"
          >
            <div className="flex items-center justify-between">
              <span className="font-semibold text-fg">
                {activeCodeSnippet.kind === "curl"
                  ? "JSON-RPC cURL Command (kovanica_call)"
                  : "TypeScript kovanica-sdk Snippet (estimateAndBuildCall + dryRunCall)"}
              </span>
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={() =>
                    copyToClipboard(
                      activeCodeSnippet.code,
                      activeCodeSnippet.kind === "curl" ? "curl-snippet" : "sdk-snippet",
                    )
                  }
                  className="text-gold hover:underline font-medium"
                >
                  Copy
                </button>
                <button
                  type="button"
                  onClick={() => setActiveCodeSnippet(null)}
                  className="text-muted hover:text-fg"
                >
                  Hide
                </button>
              </div>
            </div>
            <pre
              data-testid="code-exporter-snippet"
              className="bg-surface border border-border/60 rounded p-2.5 font-mono text-[11px] text-emerald-400 overflow-x-auto"
            >
              {activeCodeSnippet.code}
            </pre>
          </div>
        )}

        {(batchQueue.length > 0 || batchEstimateResult) && txType !== "transfer" && (
          <div
            data-testid="batch-estimator-panel"
            className="bg-surface-2/80 border border-gold/30 rounded-lg p-3.5 flex flex-col gap-2.5 text-xs"
          >
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/60 pb-2">
              <span className="font-semibold text-fg">
                Multi-Call Batch Estimator ({batchEstimateResult ? batchEstimateResult.calls.length : batchQueue.length} Call{(batchEstimateResult ? batchEstimateResult.calls.length : batchQueue.length) === 1 ? "" : "s"})
              </span>
              {batchEstimateResult && (
                <div
                  data-testid="batch-estimate-totals"
                  className="font-mono flex flex-wrap gap-x-4 gap-y-1 text-muted"
                >
                  <span>
                    Total Size: <strong className="text-fg">{batchEstimateResult.totalEstimatedTxSize}B</strong>
                  </span>
                  <span>
                    Rate: <strong className="text-fg">{batchEstimateResult.feeRatePerByte.toString()} atoms/B</strong>
                  </span>
                  <span>
                    Total Fee (+20%): <strong className="text-gold">{batchEstimateResult.totalFee.toString()} atoms</strong>
                  </span>
                  <span>
                    Total Gas: <strong className="text-fg">{batchEstimateResult.totalGasLimit.toString()}</strong>
                  </span>
                  {batchEstimateResult.startNonce !== undefined && (
                    <span>
                      Start Nonce: <strong className="text-fg">{batchEstimateResult.startNonce.toString()}</strong>
                    </span>
                  )}
                </div>
              )}
            </div>

            {batchEstimateResult ? (
              <div className="flex flex-col gap-1.5 font-mono text-[11px]">
                {batchEstimateResult.calls.map((item: PreparedCallTransaction, idx: number) => (
                  <div
                    key={idx}
                    data-testid={`batch-call-row-${idx}`}
                    className="bg-surface border border-border/60 rounded px-2.5 py-1.5 flex flex-wrap items-center justify-between gap-2"
                  >
                    <span className="text-fg font-semibold">
                      #{idx + 1} {item.call.method}
                    </span>
                    <div className="flex flex-wrap gap-x-4 text-muted">
                      <span>
                        Nonce: <strong className="text-fg">{item.nonce !== undefined ? item.nonce.toString() : "—"}</strong>
                      </span>
                      <span>
                        Wire Size: <strong className="text-fg">{item.estimatedTxSize}B</strong>
                      </span>
                      <span>
                        Fee: <strong className="text-gold">{item.fee.toString()} atoms</strong>
                      </span>
                      <span>
                        Gas: <strong className="text-fg">{item.gasLimit.toString()}</strong>
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="flex flex-wrap gap-2 font-mono text-[11px] text-muted">
                {batchQueue.map((queued, idx) => (
                  <span
                    key={idx}
                    className="bg-surface border border-border/60 rounded px-2 py-1 text-fg"
                  >
                    #{idx + 1} {queued.method} ({bytesToHex(queued.args).slice(0, 12)}...)
                  </span>
                ))}
              </div>
            )}
          </div>
        )}

        {preparedEstimate && (
          <div
            data-testid="prepared-estimate-summary"
            className="bg-surface-2/80 border border-gold/30 rounded-lg p-3 text-xs font-mono flex flex-wrap gap-x-5 gap-y-1 text-muted"
          >
            <span>
              Size: <strong className="text-fg">{preparedEstimate.estimatedTxSize}B</strong>
            </span>
            {preparedEstimate.feeRatePerByte !== undefined && (
              <span>
                Rate: <strong className="text-fg">{preparedEstimate.feeRatePerByte.toString()} atoms/B</strong>
              </span>
            )}
            <span>
              Fee (+20%): <strong className="text-gold">{preparedEstimate.fee.toString()} atoms</strong>
            </span>
            <span>
              Gas Limit: <strong className="text-fg">{preparedEstimate.gasLimit.toString()}</strong>
            </span>
            {preparedEstimate.nonce !== undefined && (
              <span>
                Nonce: <strong className="text-fg">{preparedEstimate.nonce.toString()}</strong>
              </span>
            )}
          </div>
        )}

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

      {/* SDK v0.4.0 Contract State Bincode Decoder & Live Storage Slot Fetch */}
      <div className="bg-surface rounded-xl border border-border p-6 flex flex-col gap-4" data-testid="bincode-decoder-panel">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border pb-3">
          <div>
            <h2 className="text-sm font-semibold text-fg">
              Contract State Bincode Decoder (SDK v0.4.0)
            </h2>
            <p className="text-xs text-muted">
              Live Storage Slot Fetch (<code className="font-mono text-fg">kovanica_getStorageAt</code>), canonical BLAKE3 slot derivation, and typed Bincode 1.x decoding
            </p>
          </div>
          <span className="px-2 py-0.5 text-[11px] font-mono rounded bg-surface-2 border border-border text-gold">
            kovanica_getStorageAt
          </span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div>
            <label htmlFor="storage-contract-address" className="block text-xs font-medium text-muted mb-1">
              Contract Address (PRO-21 <code className="font-mono">kvnc...dag</code> / <code className="font-mono">tknc...dag</code> or 32-byte hex)
            </label>
            <input
              id="storage-contract-address"
              data-testid="storage-contract-address"
              type="text"
              value={storageContractAddr}
              onChange={(e) => setStorageContractAddr(e.target.value)}
              placeholder="kvnc...dag or 0x..."
              className="w-full bg-surface-2 border border-border rounded-lg px-3 py-2 text-xs font-mono text-fg focus:outline-none focus:border-gold"
            />
          </div>

          <div>
            <label htmlFor="decoder-kind-select" className="block text-xs font-medium text-muted mb-1">
              Contract Record Type & Typed Decoder
            </label>
            <select
              id="decoder-kind-select"
              data-testid="decoder-kind-select"
              value={decoderKind}
              onChange={(e) => setDecoderKind(e.target.value as ContractDecoderKind)}
              className="w-full bg-surface-2 border border-border rounded-lg px-3 py-2 text-xs font-mono text-fg focus:outline-none focus:border-gold"
            >
              <option value="name">NameRecord — decodeNameRecord (kvnc/v1/name/)</option>
              <option value="htlc">HtlcRecord — decodeHtlcRecord (kvnc/v1/htlc/)</option>
              <option value="escrow">EscrowRecord — decodeEscrowRecord (kvnc/v1/escrow/)</option>
              <option value="vault">VaultRecord — decodeVaultRecord (kvnc/v1/vault/)</option>
              <option value="token_metadata">TokenMetadata — decodeTokenMetadata (kvnc/v1/state)</option>
              <option value="nft_metadata">NftMetadata — decodeNftMetadata (kvnc/v1/state)</option>
              <option value="multisig">MultisigState — decodeMultisigState (kvnc/v1/state)</option>
            </select>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <div>
            <label htmlFor="decoder-custom-prefix" className="block text-xs font-medium text-muted mb-1">
              Custom Storage Prefix (optional override)
            </label>
            <input
              id="decoder-custom-prefix"
              data-testid="decoder-custom-prefix"
              type="text"
              value={customSlotPrefix}
              onChange={(e) => setCustomSlotPrefix(e.target.value)}
              placeholder="e.g. kvnc/v1/name/ (defaults to record prefix)"
              className="w-full bg-surface-2 border border-border rounded-lg px-3 py-2 text-xs font-mono text-fg focus:outline-none focus:border-gold"
            />
          </div>

          <div className="md:col-span-2 flex flex-wrap items-end gap-2">
            <div className="flex-1 min-w-[180px]">
              <label htmlFor="decoder-slot-key" className="block text-xs font-medium text-muted mb-1">
                Storage Slot Key (name / 32-byte hex ID; ignored for singleton <code className="font-mono">kvnc/v1/state</code> unless custom prefix set)
              </label>
              <input
                id="decoder-slot-key"
                data-testid="decoder-slot-key"
                type="text"
                value={slotKeyInput}
                onChange={(e) => setSlotKeyInput(e.target.value)}
                placeholder="alice or 64-char hex ID"
                className="w-full bg-surface-2 border border-border rounded-lg px-3 py-2 text-xs font-mono text-fg focus:outline-none focus:border-gold"
              />
            </div>
            <button
              type="button"
              data-testid="derive-slot-btn"
              onClick={handleDeriveSlot}
              className="px-3 py-2 bg-surface-2 hover:bg-border border border-border rounded-lg text-xs text-fg font-medium whitespace-nowrap transition-colors"
            >
              Derive Slot
            </button>
            <button
              type="button"
              data-testid="fetch-storage-slot-btn"
              onClick={handleFetchAndDecodeStorage}
              disabled={isFetchingStorage}
              className="px-3.5 py-2 bg-gold hover:bg-gold/90 text-bg rounded-lg text-xs font-semibold whitespace-nowrap transition-colors disabled:opacity-50"
            >
              {isFetchingStorage ? "Fetching Storage..." : "Live Fetch & Decode (kovanica_getStorageAt)"}
            </button>
          </div>
        </div>

        {derivedSlotHex && (
          <div
            data-testid="derived-slot-hex"
            className="bg-surface-2/80 border border-border rounded-lg px-3 py-2 text-xs font-mono text-emerald-400 break-all"
          >
            Derived BLAKE3 Slot (32B): 0x{derivedSlotHex}
          </div>
        )}

        <div>
          <label htmlFor="decoder-hex-input" className="block text-xs font-medium text-muted mb-1">
            Raw Storage Value (Hex)
          </label>
          <textarea
            id="decoder-hex-input"
            data-testid="decoder-hex-input"
            rows={2}
            value={decoderHexInput}
            onChange={(e) => setDecoderHexInput(e.target.value)}
            placeholder="0x..."
            className="w-full bg-surface-2 border border-border rounded-lg p-2.5 text-xs font-mono text-fg focus:outline-none focus:border-gold"
          />
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            data-testid="decode-bincode-btn"
            onClick={handleDecodeState}
            className="px-4 py-2 bg-gold/20 hover:bg-gold/30 rounded-lg border border-gold/40 text-gold text-xs font-semibold transition-colors"
          >
            Decode Bincode State
          </button>
        </div>

        {storageEmptyMsg && (
          <div
            data-testid="storage-empty-msg"
            className="text-xs font-mono text-amber-300 bg-amber-950/30 border border-amber-800/50 rounded-lg p-3"
          >
            {storageEmptyMsg}
          </div>
        )}

        {decoderError && (
          <div
            data-testid="decoder-error-msg"
            className="text-xs font-mono text-red-300 bg-red-950/40 border border-red-800/60 rounded-lg p-3"
          >
            {decoderError}
          </div>
        )}

        {decodedOutput && (
          <pre
            data-testid="decoded-json-output"
            className="bg-surface-2 border border-border rounded-lg p-3 text-xs font-mono text-fg overflow-x-auto"
          >
            {decodedOutput}
          </pre>
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
