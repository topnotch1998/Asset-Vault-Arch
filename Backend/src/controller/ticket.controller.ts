import * as bitcoin from "bitcoinjs-lib";
import * as btc from "@scure/btc-signer";
import * as borsh from "borsh";
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
import {
  SMART_CONTRACT_PUBKEY,
  RPC_URL,
  MAX_RETRIES,
  ADMIN_ADDRESS,
  ACCOUNT_PUBKEY,
  TICKET_LIST,
} from "../config/config";
import { TicketSchema } from "../config/schema";
import { transferDataToSmartContract } from "../utils/arch.service";
import { TicketType } from "../config/constant";
import { getAccountData } from "../utils/utils.service";
import type { ITicket } from "../types/type";
import { fetchBTCUtxo, fetchInscriptionUTXO } from "../utils/utxo.service";
import { pushRawTx } from "../utils/psbt.service";

const ECPair = ECPairFactory(ecc);
const rpc = ArchConnection(new RpcConnection(RPC_URL));

export const TESTNET4_NETWORK: typeof btc.NETWORK = {
  bech32: "tb", // Bech32 prefix for addresses on testnet4
  pubKeyHash: 0x1c,
  scriptHash: 0x16,
  wif: 0x3f,
};

export const preAddTicketsPsbt = async (
  inscriptionIds: string[],
  userAddress: string,
  userPubkey: string
) => {
  try {
    if (userAddress !== ADMIN_ADDRESS) throw "You Are Not Owner";
    const fee = 1000;
    const satoshis: number[] = [];

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

    const tx = new btc.Transaction({ allowUnknownOutputs: true });
    for (const inscriptionId of inscriptionIds) {
      if (!TICKET_LIST.includes(inscriptionId)) throw "Invalid Inscription Id";

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

      satoshis.push(inscriptionUtxos[0].value);
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
        });
      }
    }

    tx.addOutput({
      script: userWallet.script,
      amount: BigInt(amount - fee - 546 * inscriptionIds.length),
    });

    const psbt = tx.toPSBT();

    const hexPsbt = bytesToHex(psbt);

    console.log(hexPsbt, inscriptionIds, satoshis);

    return {
      hexPsbt,
      inscriptionIds,
      satoshis,
    };
  } catch (error) {
    console.log(error);
    throw error;
  }
};

export const addTicketsPsbt = async (
  hexedPsbt: string,
  signedHexPsbt: string,
  inscriptionIds: string[],
  satoshis: number[]
) => {
  try {
    const psbt = bitcoin.Psbt.fromHex(hexedPsbt);
    const signedPsbt = bitcoin.Psbt.fromHex(signedHexPsbt);
    psbt.combine(signedPsbt);
    const tx = psbt.extractTransaction();
    const txHex = tx.toHex();

    const txId = await pushRawTx(txHex);
    console.log(txId);

    const txIds: string[] = [];
    const vouts: number[] = [];

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

    for (let i = 0; i < inscriptionIds.length; i++) {
      txIds.push(txId);
      vouts.push(i);
    }

    const txResult = await addTickets(txIds, satoshis, vouts, inscriptionIds);

    return txResult;
  } catch (error) {
    console.log(error);
    throw error;
  }
};

export const addTickets = async (
  txid: string[],
  satoshi: number[],
  vout: number[],
  inscription_id: string[]
) => {
  try {
    const client = new RpcConnection(RPC_URL);

    // Prepare instruction data
    const sendValue = {
      instruction: TicketType.ADD,
      txid: txid,
      vout: vout,
      satoshi: satoshi,
      inscription_id: inscription_id,
      admin_send_tx: [],
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

    const encoded = borsh.serialize(TicketSchema, sendValue);
    const instructionData = new Uint8Array(encoded.length + 1);
    instructionData[0] = 1;
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

export const preSendTickets = async (
  inscriptionIds: string[],
  destinationAddresses: string[],
  userAddress: string,
  userPubkey: string
) => {
  try {
    if (userAddress !== ADMIN_ADDRESS) throw "You Are Not Owner";

    const fee = 1000;

    const userWallet = btc.p2tr(
      Uint8Array.from(Buffer.from(userPubkey, "hex").slice(1, 33)),
      undefined,
      TESTNET4_NETWORK
    );

    const btcUtxos = await fetchBTCUtxo(userAddress);

    const accountData = await getAccountData();

    const tx = new btc.Transaction({ allowUnknownOutputs: true });

    for (let i = 0; i < inscriptionIds.length; i++) {
      if (!TICKET_LIST.includes(inscriptionIds[i]))
        throw "Invalid Inscription Id";

      const destinationOutScript = btc.OutScript.encode(
        btc.Address(TESTNET4_NETWORK).decode(destinationAddresses[i])
      );

      const matchedTickets = accountData.ticket_list.filter(
        (ticket: ITicket) => ticket.inscription_id === inscriptionIds[i]
      );

      tx.addOutput({
        script: destinationOutScript,
        amount: BigInt(matchedTickets[0].satoshi),
      });
    }

    let amount = 0;

    for (let i = 0; i < btcUtxos.length; i++) {
      if (amount < fee + 546 * inscriptionIds.length) {
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
          sighashType:
            bitcoin.Transaction.SIGHASH_ALL |
            bitcoin.Transaction.SIGHASH_ANYONECANPAY,
        });
      }
    }

    tx.addOutput({
      script: userWallet.script,
      amount: BigInt(amount - fee - 546 * inscriptionIds.length),
    });

    const psbt = tx.toPSBT();

    const hexPsbt = bytesToHex(psbt);

    console.log(hexPsbt);

    return {
      hexPsbt,
    };
  } catch (error) {
    console.log(error);
    throw error;
  }
};

export const sendTickets = async (
  inscription_id: string[],
  signedPsbt: string
) => {
  try {
    const client = new RpcConnection(RPC_URL);

    const accountData = await getAccountData();

    const matchedTickets = accountData.ticket_list.filter((ticket: ITicket) =>
      inscription_id.includes(ticket.inscription_id)
    );

    // Separate the txid and vout lists
    const txidList = matchedTickets.map((ticket: ITicket) => ticket.txid);
    const voutList = matchedTickets.map((ticket: ITicket) => ticket.vout);
    const satoshiList = matchedTickets.map((ticket: ITicket) => ticket.satoshi);

    const psbt = bitcoin.Psbt.fromHex(signedPsbt);
    psbt.finalizeAllInputs();

    const hexData = hexToBytes(psbt.extractTransaction().toHex());

    // Prepare instruction data
    const sendValue = {
      instruction: TicketType.SEND,
      txid: txidList,
      vout: voutList,
      satoshi: satoshiList,
      inscription_id: inscription_id,
      admin_send_tx: hexData,
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

    const encoded = borsh.serialize(TicketSchema, sendValue);
    const instructionData = new Uint8Array(encoded.length + 1);
    instructionData[0] = 1;
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
