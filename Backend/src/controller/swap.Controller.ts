import { none, RuneId, Runestone } from "runelib";
import * as Bitcoin from "bitcoinjs-lib";
import * as borsh from "borsh";
import * as btc from "@scure/btc-signer";
import * as ecc from "tiny-secp256k1";
import { ECPairFactory } from "ecpair";
import axios from "axios";
import { hexToBytes, bytesToHex } from "@noble/hashes/utils";
import {
  RpcConnection,
  PubkeyUtil,
  ArchConnection,
  type Instruction,
} from "@saturnbtcio/arch-sdk";
import * as CustomBitcoin from "../service/bitcoinjs-lib/src/index";
import {
  SMART_CONTRACT_PUBKEY,
  RPC_URL,
  MAX_RETRIES,
  ACCOUNT_PUBKEY,
  BURN_PUBKEY,
} from "../config/config";
import { SwapSchema } from "../config/schema";
import { GOMAESTRO_PRIVATE_KEY, GOMAESTRO_URL } from "../config/config";
import { transferDataToSmartContract } from "../utils/arch.service";
import { getAccountData, getRandomNumber } from "../utils/utils.service";
import { fetchBTCUtxo, fetchInscriptionUTXO } from "../utils/utxo.service";

const ECPair = ECPairFactory(ecc);
CustomBitcoin.initEccLib(ecc);
const rpc = ArchConnection(new RpcConnection(RPC_URL));

export const TESTNET4_NETWORK: typeof btc.NETWORK = {
  bech32: "tb", // Bech32 prefix for addresses on testnet4
  pubKeyHash: 0x1c,
  scriptHash: 0x16,
  wif: 0x3f,
};

export const preSwap = async (
  inscriptionId: string,
  userAddress: string,
  userPubkey: string
) => {
  try {
    const fee = 1000;

    const burnAccountPubkey = Buffer.from(BURN_PUBKEY, "hex");

    const burnAddress = await rpc.getAccountAddress(
      new Uint8Array(burnAccountPubkey)
    );

    const burnOutScript = btc.OutScript.encode(
      btc.Address(TESTNET4_NETWORK).decode(burnAddress)
    );

    const userWallet = btc.p2tr(
      Uint8Array.from(Buffer.from(userPubkey, "hex").slice(1, 33)),
      undefined,
      TESTNET4_NETWORK
    );

    const btcUtxos = await fetchBTCUtxo(userAddress);

    const tx = new btc.Transaction({
      allowUnknownOutputs: true,
      allowUnknownInputs: true,
    });

    //Inscription send
    const inscriptionUtxos = await fetchInscriptionUTXO(
      userAddress,
      inscriptionId
    );

    console.log(inscriptionUtxos);

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
      sighashType: btc.SigHash.ALL_ANYONECANPAY,
    });

    tx.addOutput({
      script: burnOutScript,
      amount: BigInt(inscriptionUtxos[0].value),
    });

    const accountData = await getAccountData();

    if (accountData.ticket_list.length !== 0)
      throw "Ticket Is Not Distributed Yet";
    if (accountData.deposit_utxo_list.length === 0) throw "Pool is Empty";

    const rng = await getRandomNumber(0, accountData.deposit_utxo_list.length);

    if (accountData.deposit_utxo_list[rng].rune_id !== "") {
      const url = `${GOMAESTRO_URL}/assets/runes/${accountData.deposit_utxo_list[rng].rune_id}`;

      const config = {
        headers: {
          "api-key": GOMAESTRO_PRIVATE_KEY,
        },
      };
      const res = await axios.get(url, { ...config });

      // Rune Send Part
      const edicts: any = [];

      edicts.push({
        id: new RuneId(
          Number(accountData.deposit_utxo_list[rng].rune_id.split(":")[0]),
          Number(accountData.deposit_utxo_list[rng].rune_id.split(":")[1])
        ),
        amount:
          accountData.deposit_utxo_list[rng].rune_amount *
          10 ** res.data.data.divisibility,
        output: 2,
      });

      const transferStone = new Runestone(edicts, none(), none(), none());

      tx.addOutput({
        script: Uint8Array.from(transferStone.encipher()),
        amount: BigInt(0),
      });

      tx.addOutput({
        script: userWallet.script,
        amount: BigInt(accountData.deposit_utxo_list[rng].satoshi),
      });
    } else {
      tx.addOutput({
        script: userWallet.script,
        amount: BigInt(accountData.deposit_utxo_list[rng].satoshi),
      });
    }

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
          sighashType: btc.SigHash.ALL_ANYONECANPAY,
        });
      }
    }

    tx.addOutput({
      script: userWallet.script,
      amount: BigInt(amount - fee - 546),
    });

    // Remove signing attempt - wallet handles this externally
    const psbt = tx.toPSBT();
    const hexPsbt = bytesToHex(psbt);

    console.log(hexPsbt, rng);

    return { hexPsbt, rng };
  } catch (error) {
    console.log(error);
    throw error;
  }
};

export const swap = async (
  hexPsbt: string,
  signedHexPsbt: string,
  rng: number
) => {
  try {
    const client = new RpcConnection(RPC_URL);

    const accountData = await getAccountData();

    const psbt = CustomBitcoin.Psbt.fromHex(hexPsbt);
    const signedPsbt = CustomBitcoin.Psbt.fromHex(signedHexPsbt);
    psbt.combine(signedPsbt);
    psbt.finalizeAllInputs();
    const tx = psbt.extractTransaction();
    const hexData = hexToBytes(tx.toHex());

    // Prepare instruction data
    const sendValue = {
      txid: accountData.deposit_utxo_list[rng].txid,
      vout: accountData.deposit_utxo_list[rng].vout,
      swap_tx: hexData,
    };

    // Create key pair from private key
    const keyPair = ECPair.fromPrivateKey(
      Buffer.from(process.env.ARCH_PRIVATE_KEY!, "hex"),
      {
        compressed: true,
        network: Bitcoin.networks.testnet,
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

    const encoded = borsh.serialize(SwapSchema, sendValue);
    const instructionData = new Uint8Array(encoded.length + 1);
    instructionData[0] = 2;
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
