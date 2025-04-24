export interface IRuneUtxo {
  txid: string;
  vout: number;
  amount: number;
  value: number;
}

export interface IInscriptionUtxo {
  txid: string;
  vout: number;
  value: number;
}

export interface ISendValue {
  inscription_txid: string;
  inscription_vout: number;
  user_swap_psbt: Uint8Array;
}

export interface ITicket {
  inscription_id: string;
  txid: string;
  vout: number;
  satoshi: number;
}
