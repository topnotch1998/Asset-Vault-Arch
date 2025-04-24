import { none, RuneId, Runestone } from "runelib";
import * as btc from "@scure/btc-signer";
import * as bitcoin from "bitcoinjs-lib";
import * as ecc from "tiny-secp256k1";
import { ECPairFactory } from "ecpair";
import * as borsh from "borsh";
import axios from "axios";
import {
  RpcConnection,
  PubkeyUtil,
  ArchConnection,
  type Instruction,
} from "@saturnbtcio/arch-sdk";
import { bytesToHex } from "@noble/hashes/utils";
import {
  SMART_CONTRACT_PUBKEY,
  RPC_URL,
  MAX_RETRIES,
  ACCOUNT_PUBKEY,
  ADMIN_ADDRESS,
} from "../config/config";
import { DepositSchema } from "../config/schema";
import { transferDataToSmartContract } from "../utils/arch.service";
import { DepositType } from "../config/constant";
import {
  fetchBTCUtxo,
  fetchRuneUTXO,
  fetchInscriptionUTXO,
} from "../utils/utxo.service";
import { analyzeRuneInfo } from "../utils/utils.service";
import { pushRawTx } from "../utils/psbt.service";

const ECPair = ECPairFactory(ecc);
bitcoin.initEccLib(ecc);
const rpc = ArchConnection(new RpcConnection(RPC_URL));

export const TESTNET4_NETWORK: typeof btc.NETWORK = {
  bech32: "tb", // Bech32 prefix for addresses on testnet4
  pubKeyHash: 0x1c,
  scriptHash: 0x16,
  wif: 0x3f,
};

export const initData = async () => {
  try {
    const client = new RpcConnection(RPC_URL);

    // Prepare instruction data
    const sendValue = {
      instruction: DepositType.INIT,
      txid: "",
      vout: 0,
      satoshi: 546,
      rune_id: "",
      rune_amount: 0,
      inscription_id: "",
    };

    // Create key pair from private key
    const keyPair = ECPair.fromPrivateKey(
      Buffer.from(process.env.ARCH_PRIVATE_KEY!, "hex"),
      {
        compressed: true,
        network: bitcoin.networks.testnet,
      }
    );

    const pubkeyHex = Buffer.from(keyPair.publicKey.slice(1, 33)).toString(
      "hex"
    );

    // Get Account Address
    const accountAddress = await client.getAccountAddress(
      PubkeyUtil.fromHex(pubkeyHex)
    );
    console.log("Account Address : ", accountAddress);

    const encoded = borsh.serialize(DepositSchema, sendValue);
    const instructionData = new Uint8Array(encoded.length + 1);
    instructionData[0] = 0;
    instructionData.set(encoded, 1);
    console.log(instructionData);
    // Init instruction
    const instruction: Instruction = {
      program_id: PubkeyUtil.fromHex(SMART_CONTRACT_PUBKEY),
      accounts: [
        {
          pubkey: PubkeyUtil.fromHex(pubkeyHex),
          is_signer: true,
          is_writable: true,
        },
      ],
      data: instructionData,
    };

    const archTxid = (await transferDataToSmartContract(
      keyPair,
      instruction
    )) as string;
    console.log("Arch Result", archTxid);

    const getProceedDataSchema = {
      jsonrpc: "2.0",
      id: 1,
      method: "get_processed_transaction",
      params: archTxid,
    };

    let i = 0;
    let result = "error";

    while (1) {
      try {
        await new Promise((resolve) => setTimeout(resolve, 10000));

        const res = await axios.post(RPC_URL, getProceedDataSchema);
        console.log(res.data);

        if (res.data.result.status) {
          result = res.data.result.status;
          break;
        }
      } catch (error) {
        console.log("Finally Bug Here");
        if (i === MAX_RETRIES - 1) throw error;
      }
      i++;
    }

    console.log(result);

    return { txid: archTxid };
    // return swapResult;
  } catch (error) {
    console.error("Transaction error:", error);
    throw error;
  }
};

export const preDepositUtxoAsset = async (
  assetType: number,
  runeId: string,
  runeAmount: number,
  inscriptionId: string,
  btcAmount: number,
  userAddress: string,
  userPubkey: string
) => {
  try {
    // if (userAddress !== ADMIN_ADDRESS) throw "You Are Not Owner";
    const fee = 1000;

    const smartcontractAccountPubkey = Buffer.from(ACCOUNT_PUBKEY, "hex");

    const smartContractAddress = await rpc.getAccountAddress(
      new Uint8Array(smartcontractAccountPubkey)
    );

    const smartContractOutScript = btc.OutScript.encode(
      btc.Address(TESTNET4_NETWORK).decode(smartContractAddress)
    );

    const userWallet = btc.p2tr(
      Uint8Array.from(Buffer.from(userPubkey, "hex").slice(1, 33)),
      undefined,
      TESTNET4_NETWORK
    );

    const btcUtxos = await fetchBTCUtxo(userAddress);
    console.log(btcUtxos);

    const tx = new btc.Transaction({ allowUnknownOutputs: true });

    if (assetType === 0) {
      // Rune Send
      const runeUtxos = await fetchRuneUTXO(userAddress, runeId);

      const { runeTotalAmount, divisibility } = await analyzeRuneInfo(
        runeUtxos,
        runeId
      );

      if (
        runeTotalAmount * 10 ** divisibility <
        runeAmount * 10 ** divisibility
      )
        throw "Invaild Rune Amount";

      // Rune Send Part
      const edicts: any = [];

      edicts.push({
        id: new RuneId(
          Number(runeId.split(":")[0]),
          Number(runeId.split(":")[1])
        ),
        amount: runeAmount * 10 ** divisibility,
        output: 1,
      });
      edicts.push({
        id: new RuneId(
          Number(runeId.split(":")[0]),
          Number(runeId.split(":")[1])
        ),
        amount:
          runeTotalAmount * 10 ** divisibility -
          runeAmount * 10 ** divisibility,
        output: 2,
      });

      const transferStone = new Runestone(edicts, none(), none(), none());

      for (let i = 0; i < runeUtxos.length; i++) {
        tx.addInput({
          txid: runeUtxos[i].txid,
          index: runeUtxos[i].vout,
          witnessUtxo: {
            amount: BigInt(runeUtxos[i].value),
            script: userWallet.script,
          },
          tapInternalKey: Uint8Array.from(
            Buffer.from(userPubkey, "hex").slice(1, 33)
          ),
        });
      }

      tx.addOutput({
        script: Uint8Array.from(transferStone.encipher()),
        amount: BigInt(0),
      });

      tx.addOutput({
        script: smartContractOutScript,
        amount: BigInt(546),
      });

      tx.addOutput({
        script: userWallet.script,
        amount: BigInt(546),
      });

      let amount = 0;

      for (let i = 0; i < btcUtxos.length; i++) {
        if (amount < fee) {
          amount += btcUtxos[i].value;
          tx.addInput({
            txid: btcUtxos[i].txid,
            index: btcUtxos[i].vout,
            witnessUtxo: {
              amount: BigInt(btcUtxos[i].value),
              script: userWallet.script,
            },
            tapInternalKey: Uint8Array.from(
              Buffer.from(userPubkey, "hex").slice(1, 33)
            ),
          });
        }
      }

      tx.addOutput({
        script: userWallet.script,
        amount: BigInt(amount - 546 * 2 - fee),
      });

      const psbt = tx.toPSBT();

      const hexPsbt = bytesToHex(psbt);

      console.log(hexPsbt, 1, 546, runeId, runeAmount, inscriptionId);

      return {
        hexPsbt,
        vout: 1,
        satoshi: 546,
        runeId,
        runeAmount,
        inscriptionId,
      };
    } else if (assetType === 1) {
      //Inscription send
      const inscriptionUtxos = await fetchInscriptionUTXO(
        userAddress,
        inscriptionId
      );
      tx.addInput({
        index: inscriptionUtxos[0].vout,
        txid: inscriptionUtxos[0].txid,
        witnessUtxo: {
          amount: BigInt(inscriptionUtxos[0].value),
          script: userWallet.script,
        },
        tapInternalKey: Uint8Array.from(
          Buffer.from(userPubkey, "hex").slice(1, 33)
        ),
      });

      tx.addOutput({
        script: smartContractOutScript,
        amount: BigInt(inscriptionUtxos[0].value),
      });

      let amount = 0;

      for (let i = 0; i < btcUtxos.length; i++) {
        if (amount < fee) {
          amount += btcUtxos[i].value;
          tx.addInput({
            txid: btcUtxos[i].txid,
            index: btcUtxos[i].vout,
            witnessUtxo: {
              amount: BigInt(btcUtxos[i].value),
              script: userWallet.script,
            },
            tapInternalKey: Uint8Array.from(
              Buffer.from(userPubkey, "hex").slice(1, 33)
            ),
          });
        }
      }

      tx.addOutput({
        script: userWallet.script,
        amount: BigInt(amount - fee),
      });

      const psbt = tx.toPSBT();

      const hexPsbt = bytesToHex(psbt);

      console.log(
        hexPsbt,
        0,
        inscriptionUtxos[0].value,
        runeId,
        runeAmount,
        inscriptionId
      );

      return {
        hexPsbt,
        vout: 0,
        satoshi: inscriptionUtxos[0].value,
        runeId,
        runeAmount,
        inscriptionId,
      };
    } else if (assetType === 2) {
      let amount = 0;

      for (let i = 0; i < btcUtxos.length; i++) {
        if (amount < fee + btcAmount) {
          amount += btcUtxos[i].value;
          tx.addInput({
            txid: btcUtxos[i].txid,
            index: btcUtxos[i].vout,
            witnessUtxo: {
              amount: BigInt(btcUtxos[i].value),
              script: userWallet.script,
            },
            tapInternalKey: Uint8Array.from(
              Buffer.from(userPubkey, "hex").slice(1, 33)
            ),
          });
        }
      }

      tx.addOutput({
        script: smartContractOutScript,
        amount: BigInt(btcAmount),
      });

      tx.addOutput({
        script: userWallet.script,
        amount: BigInt(amount - fee - btcAmount),
      });

      const psbt = tx.toPSBT();

      const hexPsbt = bytesToHex(psbt);

      console.log(hexPsbt, 0, btcAmount, runeId, runeAmount, inscriptionId);

      return {
        hexPsbt,
        vout: 0,
        satoshi: btcAmount,
        runeId,
        runeAmount,
        inscriptionId,
      };
    }
  } catch (error) {
    console.log(error);
    throw "Can Not Make Deposit Asset Utxo";
  }
};

export const depositUtxoAsset = async (
  hexedPsbt: string,
  signedHexPsbt: string,
  vout: number,
  runeId: string,
  runeAmount: number,
  inscriptionId: string,
  satoshi: number
) => {
  try {
    const psbt = bitcoin.Psbt.fromHex(hexedPsbt);
    const signedPsbt = bitcoin.Psbt.fromHex(signedHexPsbt);
    psbt.combine(signedPsbt);
    const tx = psbt.extractTransaction();
    const txHex = tx.toHex();

    const txId = await pushRawTx(txHex);
    console.log(txId);

    const txVerifyUrl = `http://mempool.space/testnet4/api/tx/${txId}`;
    let i = 0;

    while (1) {
      try {
        await new Promise((resolve) => setTimeout(resolve, 5000));

        const res = await axios.get(txVerifyUrl);

        if (res.data.version) {
          break;
        }
      } catch (error) {
        console.log("Finally Bug Here");
        if (i === MAX_RETRIES - 1) throw error;
      }
      i++;
    }

    const txResult = await depositAsset(
      txId,
      vout,
      satoshi,
      runeId,
      runeAmount,
      inscriptionId
    );

    return txResult;
  } catch (error) {
    console.log(error);
    throw error;
  }
};

export const depositAsset = async (
  txid: string,
  vout: number,
  satoshi: number,
  rune_id: string,
  rune_amount: number,
  inscription_id: string
) => {
  try {
    const client = new RpcConnection(RPC_URL);

    // Prepare instruction data
    const sendValue = {
      instruction: DepositType.ADD,
      txid: txid,
      vout: vout,
      satoshi: satoshi,
      rune_id: rune_id,
      rune_amount: rune_amount,
      inscription_id: inscription_id,
    };

    // Create key pair from private key
    const keyPair = ECPair.fromPrivateKey(
      Buffer.from(process.env.ARCH_PRIVATE_KEY!, "hex"),
      {
        compressed: true,
        network: bitcoin.networks.testnet,
      }
    );

    const pubkeyHex = Buffer.from(keyPair.publicKey.slice(1, 33)).toString(
      "hex"
    );

    // Get Account Address
    const accountAddress = await client.getAccountAddress(
      PubkeyUtil.fromHex(pubkeyHex)
    );
    console.log("Account Address : ", accountAddress);

    const encoded = borsh.serialize(DepositSchema, sendValue);
    const instructionData = new Uint8Array(encoded.length + 1);
    instructionData[0] = 0;
    instructionData.set(encoded, 1);
    console.log(instructionData);
    // Init instruction
    const instruction: Instruction = {
      program_id: PubkeyUtil.fromHex(SMART_CONTRACT_PUBKEY),
      accounts: [
        {
          pubkey: PubkeyUtil.fromHex(pubkeyHex),
          is_signer: true,
          is_writable: true,
        },
      ],
      data: instructionData,
    };

    const archTxid = (await transferDataToSmartContract(
      keyPair,
      instruction
    )) as string;
    console.log("Arch Result", archTxid);

    const getProceedDataSchema = {
      jsonrpc: "2.0",
      id: 1,
      method: "get_processed_transaction",
      params: archTxid,
    };

    let i = 0;
    let result = "error";

    while (1) {
      try {
        await new Promise((resolve) => setTimeout(resolve, 10000));

        const res = await axios.post(RPC_URL, getProceedDataSchema);
        console.log(res.data);

        if (res.data.result.status) {
          result = res.data.result.status;
          break;
        }
      } catch (error) {
        console.log("Finally Bug Here");
        if (i === MAX_RETRIES - 1) throw error;
      }
      i++;
    }

    console.log(result);

    return { txid: archTxid };
    // return swapResult;
  } catch (error) {
    console.error("Transaction error:", error);
    throw error;
  }
};
