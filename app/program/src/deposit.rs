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
use borsh::{BorshDeserialize, BorshSerialize};

pub(crate) fn deposit(
    accounts: &[AccountInfo],
    program_id: &Pubkey,
    instruction_data: &[u8],
) -> Result<(), ProgramError> {
    msg!("Deposit!");
    let account_iter = &mut accounts.iter();
    let account = next_account_info(account_iter)?;

    let mut account_data = account
        .try_borrow_mut_data()
        .map_err(|_e| ProgramError::AccountBorrowFailed)?;

    let params: DepositParams =
        borsh::from_slice(&instruction_data[1..]).map_err(|_e| ProgramError::InvalidArgument)?;

    match params.instruction {
        0 => {
            msg!("Initilize");

            let initial_data = LuckySpinData::new();

            let serialized_deposit_data = borsh::to_vec(&initial_data)
                .map_err(|e| ProgramError::BorshIoError(e.to_string()))?;
            Ok(())
        }
        1 => {

            msg!(&format!("Current Data {:?}", account_data));
            msg!(&format!("Updated Data {:?}", serialized_lucky_data));
            account_data[..serialized_lucky_data.len()].copy_from_slice(&serialized_lucky_data);

            msg!(&format!(
                "Mutatit memory ! {:?}",
                serialized_lucky_data.len()
            ));

            Ok(())
        }
        _ => {
            return Err(ProgramError::InvalidArgument);
        }
    }
}

#[derive(Debug, Clone, BorshSerialize, BorshDeserialize)]
pub struct DepositParams {
    pub instruction: u8,
    pub txid: String,
    pub vout: u8,
    pub satoshi: u32,
    pub rune_id: String,
    pub rune_amount: u32,
    pub inscription_id: String,
}
