use crate::state::LuckySpinData;
use arch_program::{
    account::AccountInfo,
    bitcoin::{self, absolute::LockTime, transaction::Version, Transaction},
    helper::add_state_transition,
    input_to_sign::InputToSign,
    msg,
    program::next_account_info,
    program::set_transaction_to_sign,
    program_error::ProgramError,
    pubkey::Pubkey,
    transaction_to_sign::TransactionToSign,
};
use bitcoin::{OutPoint, ScriptBuf, Sequence, TxIn, Txid, Witness};
use borsh::{BorshDeserialize, BorshSerialize};
use std::str::FromStr;

pub(crate) fn swap(
    accounts: &[AccountInfo],
    program_id: &Pubkey,
    instruction_data: &[u8],
) -> Result<(), ProgramError> {
    msg!("Swap!");
    let account_iter = &mut accounts.iter();
    let account = next_account_info(account_iter)?;

    let mut account_data = account
        .try_borrow_mut_data()
        .map_err(|_e| ProgramError::AccountBorrowFailed)?;

    let swap_tx: Transaction = bitcoin::consensus::deserialize(&params.swap_tx).unwrap();

    let mut tx = Transaction {
        version: Version::TWO,
        lock_time: LockTime::ZERO,
        input: vec![],
        output: vec![],
    };
    for (index, input) in swap_tx.input.iter().enumerate() {
        if index != 0 {
            tx.input.push(input.clone());
        }
    }

    tx.output = swap_tx.output.clone();

    drop(swap_tx);

    msg!("tx_to_sign{:?}", tx_to_sign);

    set_transaction_to_sign(accounts, tx_to_sign)
}

#[derive(Debug, Clone, BorshSerialize, BorshDeserialize)]
pub struct SwapParams {
    pub txid: String,
    pub vout: u8,
    pub swap_tx: Vec<u8>,
}
