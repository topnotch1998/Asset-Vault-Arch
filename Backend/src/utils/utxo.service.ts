import axios from "axios";
import { fetchMempoolUtxo } from "./utils.service";
import RuneDataModal from "../model/RuneData";
import { GOMAESTRO_URL, GOMAESTRO_PRIVATE_KEY } from "../config/config";

export const fetchTxStatus = async (txid: string) => {
  try {
    const url = `https://mempool.space/testnet4/api/tx/${txid}/status`;
    const res = await axios.get(url);
    return res.data.confirmed;
  } catch (error) {
    console.log(error);
    return false;
  }
};

export const isUTXOSpent = async (txid: string, vout: number) => {
  try {
    const url = `https://mempool.space/testnet4/api/tx/${txid}/outspend/${vout}`;
    const res = await axios.get(url);
    return res.data.spent;
  } catch (error) {
    console.error(`Error checking UTXO spent status: ${txid}:${vout}`, error);
    return true;
  }
};

export const validateUTXO = async (txid: string, vout: number) => {
  try {
    const [isConfirmed, spent] = await Promise.all([
      fetchTxStatus(txid),
      isUTXOSpent(txid, vout),
    ]);

    return isConfirmed && !spent;
  } catch (error) {
    console.error(`UTXO validation failed: ${txid}:${vout}`, error);
    return false;
  }
};

export const fetchBTCUtxo = async (address: string) => {
  try {
    const url = `${GOMAESTRO_URL}/mempool/addresses/${address}/utxos`;
    let cursor = "";
    let res;
    const utxos = [];

    const config = {
      headers: {
        "api-key": GOMAESTRO_PRIVATE_KEY,
      },
    };

    while (1) {
      if (cursor !== "") {
        res = await axios.get(url, { ...config, params: { cursor } });
      } else {
        res = await axios.get(url, { ...config });
      }

      const utxoPromises = (res.data.data as any[])
        .filter(
          (utxo) => utxo.runes.length === 0 && Number(utxo.satoshis) >= 10000
        )
        .map(async (utxo) => {
          const confirmed = await validateUTXO(utxo.txid, utxo.vout);
          return confirmed
            ? {
                scriptpubkey: utxo.script_pubkey,
                txid: utxo.txid,
                value: Number(utxo.satoshis),
                vout: utxo.vout,
              }
            : null;
        });

      // Wait for all UTXO status checks to resolve
      const resolvedUtxos = await Promise.all(utxoPromises);
      utxos.push(...resolvedUtxos.filter((utxo) => utxo !== null));

      cursor = res.data.next_cursor;

      if (cursor === null) break;
    }

    return utxos;
  } catch (error) {
    console.log(error);
    return [];
  }
};

export const fetchRuneUTXO = async (address: string, runeId: string) => {
  try {
    const url = `${GOMAESTRO_URL}/addresses/${address}/runes/${runeId}`;
    let cursor = "";
    const utxos = [];

    const config = {
      headers: {
        "api-key": GOMAESTRO_PRIVATE_KEY,
      },
    };

    do {
      const res = await axios.get(url, {
        ...config,
        params: cursor ? { cursor } : {},
      });

      const utxoPromises = res.data.data.map(async (utxo: any) => {
        const confirmed = await validateUTXO(utxo.txid, utxo.vout);
        return confirmed
          ? {
              txid: utxo.txid,
              vout: utxo.vout,
              amount: utxo.rune_amount,
              value: Number(utxo.satoshis),
            }
          : null;
      });

      // Wait for all UTXO status checks to resolve
      const resolvedUtxos = await Promise.all(utxoPromises);
      utxos.push(...resolvedUtxos.filter((utxo) => utxo !== null));

      cursor = res.data.next_cursor;
    } while (cursor !== null);

    return utxos;
  } catch (error) {
    console.error("Error fetching UTXOs: ", error);
    return [];
  }
};

export const fetchInscriptionUTXO = async (
  address: string,
  inscriptionId: string
) => {
  try {
    const url = `${GOMAESTRO_URL}/addresses/${address}/inscriptions`;
    let cursor = "";
    let res;
    const utxos = [];

    const config = {
      headers: {
        "api-key": GOMAESTRO_PRIVATE_KEY,
      },
    };

    while (1) {
      if (cursor !== "") {
        res = await axios.get(url, { ...config, params: { cursor } });
      } else {
        res = await axios.get(url, { ...config });
      }

      const utxoPromises = (res.data.data as any[])
        .filter((utxo) => utxo.inscription_id === inscriptionId)
        .map(async (utxo) => {
          const confirmed = await validateUTXO(utxo.utxo_txid, utxo.utxo_vout);
          return confirmed
            ? {
                txid: utxo.utxo_txid,
                vout: utxo.utxo_vout,
                value: Number(utxo.satoshis),
              }
            : null;
        });

      // Wait for all UTXO status checks to resolve
      const resolvedUtxos = await Promise.all(utxoPromises);
      console.log(resolvedUtxos);
      utxos.push(...resolvedUtxos.filter((utxo) => utxo !== null));

      cursor = res.data.next_cursor;

      if (cursor === null) break;
    }

    return utxos;
  } catch (error) {
    console.log(error);
    return [];
  }
};

export const fetchDBRuneUtxo = async (runeAmount: number, runeId: string) => {
  try {
    let sum = 0;
    const utxos = [];
    const dbData = await RuneDataModal.find();

    for (const item of dbData) {
      const txStatus = await validateUTXO(item.txid, item.vout);
      if (txStatus) {
        sum += item.runeAmount;
        utxos.push({
          txid: item.txid,
          vout: item.vout,
          amount: item.runeAmount,
          value: 546,
        });
      }

      if (sum >= runeAmount) break;
    }

    const url = `${GOMAESTRO_URL}/assets/runes/${runeId}`;

    const config = {
      headers: {
        "api-key": GOMAESTRO_PRIVATE_KEY,
      },
    };

    const res = await axios.get(url, { ...config });

    return {
      runeUtxos: utxos,
      remainAmount: sum - runeAmount,
      divisibility: res.data.data.divisibility,
    };
  } catch (error) {
    console.log(error);
    return {
      runeUtxos: [],
      remainAmount: 0,
      divisibility: 0,
    };
  }
};

export const fetchComfortableRuneUTXO = async (
  address: string,
  runeId: string,
  runeAmount: number
) => {
  try {
    let sum = 0;
    let cursor = "";
    let res;
    const url = `${GOMAESTRO_URL}/addresses/${address}/runes/${runeId}`;
    const utxos = [];

    const config = {
      headers: {
        "api-key": GOMAESTRO_PRIVATE_KEY,
      },
    };

    const divUrl = `${GOMAESTRO_URL}/assets/runes/${runeId}`;

    const divRes = await axios.get(divUrl, { ...config });

    const dbData = await RuneDataModal.find({ runeID: runeId });

    for (const item of dbData) {
      if (sum >= runeAmount) break;

      const filteredData = utxos.filter(
        (utxo) => utxo.txid === item.txid && utxo.vout === item.vout
      );
      if (filteredData.length === 0) {
        const confirmed = await validateUTXO(item.txid, item.vout);
        if (confirmed) {
          sum += Number(item.runeAmount);
          utxos.push({
            txid: item.txid,
            vout: item.vout,
            amount: item.runeAmount,
            value: 546,
          });
        }
      }
    }

    while (1) {
      if (cursor !== "") {
        res = await axios.get(url, { ...config, params: { cursor } });
      } else {
        res = await axios.get(url, { ...config });
      }

      for (const item of res.data.data) {
        if (sum >= runeAmount) break;

        const confirmed = await validateUTXO(item.txid, item.vout);
        if (confirmed) {
          sum += Number(item.rune_amount);
          utxos.push({
            txid: item.txid,
            vout: item.vout,
            amount: item.rune_amount,
            value: Number(item.satoshis),
          });
        }
      }

      // Check if the sum is >= runeAmount after processing the data
      if (sum >= runeAmount) {
        break; // Exit the while loop
      }

      cursor = res.data.next_cursor;

      if (cursor === null) break;
    }

    if (utxos.length === 0)
      return {
        totalAmount: 0,
        utxos: [],
        divisibility: 0,
      };

    return {
      totalAmount: sum,
      utxos: utxos,
      divisibility: divRes.data.data.divisibility,
    };
  } catch (error) {
    console.log(error);
    return {
      totalAmount: 0,
      utxos: [],
      divisibility: 0,
    };
  }
};
