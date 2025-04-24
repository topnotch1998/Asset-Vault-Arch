use arch_program::{
    account::AccountInfo, entrypoint, msg, program_error::ProgramError, pubkey::Pubkey,
};
use deposit::deposit;
use swap::swap;
use ticket::ticket;
pub mod deposit;
pub mod state;
pub mod swap;
pub mod ticket;

#[cfg(not(feature = "no-entrypoint"))]
entrypoint!(process_instruction);
pub fn process_instruction(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    instruction_data: &[u8],
) -> Result<(), ProgramError> {
    msg!("Test Logs are here");
    msg!("Instruction Data {:?}", instruction_data[0]);
    match instruction_data[0] {
        0 => {
            // Deposit Utxo

            msg!("Deposit Utxo");

            deposit(accounts, program_id, instruction_data)
        }
        1 => {
            // Ticket
            msg!("Ticket Part");

            ticket(accounts, program_id, instruction_data)
        }
        2 => {
            // Swap
            msg!("Swap Part");

            swap(accounts, program_id, instruction_data)
        }
        _ => {
            msg!("Invalid argument provided !");
            return Err(ProgramError::InvalidArgument);
        }
    }
}
