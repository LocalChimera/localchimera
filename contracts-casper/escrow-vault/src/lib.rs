#![no_std]
#[macro_use]
extern crate alloc;

use alloc::string::{String, ToString};
use alloc::vec::Vec;
use casper_contract::contract_api::{account, runtime, storage, system};
use casper_contract::unwrap_or_revert::UnwrapOrRevert;
use casper_types::{
    account::AccountHash,
    addressable_entity::{
        EntityEntryPoint, EntryPointAccess, EntryPointPayment, EntryPointType, EntryPoints,
        Parameter,
    },
    bytesrepr::{FromBytes, ToBytes},
    contracts::{ContractHash, NamedKeys},
    AccessRights, ApiError, CLType, CLTyped, CLValue, Key, RuntimeArgs, URef, U512,
};

const COMPUTE_REGISTRY: &str = "compute_registry";
const REPUTATION: &str = "reputation";
const OWNER: &str = "owner";
const PROTOCOL_FEE_RECIPIENT: &str = "protocol_fee_recipient";
const PROTOCOL_FEES: &str = "protocol_fees";
const JOBS_DICT: &str = "jobs_dict";
const JOB_ID_TO_ADDRESS: &str = "job_id_to_address";
const CONSUMER_JOBS: &str = "consumer_jobs";
const PROVIDER_JOBS: &str = "provider_jobs";
const PENDING_JOBS: &str = "pending_jobs";
const CONTRACT_PURSE: &str = "contract_purse";
const CHALLENGES_DICT: &str = "challenges_dict";
const PROTOCOL_FEE_BPS: &str = "protocol_fee_bps";

const STATE_PENDING: u8 = 0;
const STATE_ASSIGNED: u8 = 1;
const STATE_IN_PROGRESS: u8 = 2;
const STATE_PROVIDER_DONE: u8 = 3;
const STATE_CONSUMER_CONFIRM: u8 = 4;
const STATE_SETTLED: u8 = 5;
const STATE_REFUNDED: u8 = 6;
const STATE_DISPUTED: u8 = 7;
const STATE_DISPUTE_CONSUMER_WON: u8 = 8;
const STATE_DISPUTE_PROVIDER_WON: u8 = 9;

fn get_dict(name: &str) -> URef {
    runtime::get_key(name)
        .unwrap_or_revert_with(ApiError::MissingKey)
        .into_uref()
        .unwrap_or_revert()
}

fn read_dict<T: CLTyped + FromBytes>(dict: URef, key: &str) -> Option<T> {
    storage::dictionary_get(dict, key).unwrap_or_revert()
}

fn write_dict<T: CLTyped + ToBytes>(dict: URef, key: &str, value: T) {
    storage::dictionary_put(dict, key, value);
}

fn require_owner() {
    let owner: AccountHash = runtime::get_key(OWNER)
        .unwrap_or_revert()
        .into_account()
        .unwrap_or_revert();
    if runtime::get_caller() != owner {
        runtime::revert(ApiError::User(10));
    }
}

fn create_entry_points() -> EntryPoints {
    let mut eps = EntryPoints::new();

    eps.add_entry_point(EntityEntryPoint::new(
        "create_job",
        vec![
            Parameter::new("consumer", AccountHash::cl_type()),
            Parameter::new("provider", AccountHash::cl_type()),
            Parameter::new("amount", U512::cl_type()),
            Parameter::new("provider_fee_bps", CLType::U64),
            Parameter::new("order_id", CLType::String),
        ],
        CLType::Unit,
        EntryPointAccess::Public,
        EntryPointType::Called,
        EntryPointPayment::Caller,
    ));

    eps.add_entry_point(EntityEntryPoint::new(
        "provider_ack",
        vec![Parameter::new("job_id", CLType::String)],
        CLType::Unit,
        EntryPointAccess::Public,
        EntryPointType::Called,
        EntryPointPayment::Caller,
    ));

    eps.add_entry_point(EntityEntryPoint::new(
        "provider_complete",
        vec![
            Parameter::new("job_id", CLType::String),
            Parameter::new("response_hash", CLType::String),
        ],
        CLType::Unit,
        EntryPointAccess::Public,
        EntryPointType::Called,
        EntryPointPayment::Caller,
    ));

    eps.add_entry_point(EntityEntryPoint::new(
        "consumer_confirm",
        vec![
            Parameter::new("job_id", CLType::String),
            Parameter::new("rating", CLType::U64),
        ],
        CLType::Unit,
        EntryPointAccess::Public,
        EntryPointType::Called,
        EntryPointPayment::Caller,
    ));

    eps.add_entry_point(EntityEntryPoint::new(
        "claim_payment",
        vec![Parameter::new("job_id", CLType::String)],
        CLType::Unit,
        EntryPointAccess::Public,
        EntryPointType::Called,
        EntryPointPayment::Caller,
    ));

    eps.add_entry_point(EntityEntryPoint::new(
        "claim_resolution",
        vec![Parameter::new("job_id", CLType::String)],
        CLType::Unit,
        EntryPointAccess::Public,
        EntryPointType::Called,
        EntryPointPayment::Caller,
    ));

    eps.add_entry_point(EntityEntryPoint::new(
        "withdraw_protocol_fees",
        vec![Parameter::new("amount", U512::cl_type())],
        CLType::Unit,
        EntryPointAccess::Public,
        EntryPointType::Called,
        EntryPointPayment::Caller,
    ));

    eps.add_entry_point(EntityEntryPoint::new(
        "dispute_job",
        vec![
            Parameter::new("job_id", CLType::String),
            Parameter::new("evidence_hash", CLType::String),
        ],
        CLType::Unit,
        EntryPointAccess::Public,
        EntryPointType::Called,
        EntryPointPayment::Caller,
    ));

    eps.add_entry_point(EntityEntryPoint::new(
        "resolve_dispute",
        vec![
            Parameter::new("job_id", CLType::String),
            Parameter::new("consumer_payout_pct", CLType::U64),
            Parameter::new("provider_payout_pct", CLType::U64),
        ],
        CLType::Unit,
        EntryPointAccess::Public,
        EntryPointType::Called,
        EntryPointPayment::Caller,
    ));

    eps.add_entry_point(EntityEntryPoint::new(
        "refund_job",
        vec![Parameter::new("job_id", CLType::String)],
        CLType::Unit,
        EntryPointAccess::Public,
        EntryPointType::Called,
        EntryPointPayment::Caller,
    ));

    eps.add_entry_point(EntityEntryPoint::new(
        "auto_release",
        vec![Parameter::new("job_id", CLType::String)],
        CLType::Unit,
        EntryPointAccess::Public,
        EntryPointType::Called,
        EntryPointPayment::Caller,
    ));

    eps.add_entry_point(EntityEntryPoint::new(
        "get_job",
        vec![Parameter::new("job_id", CLType::String)],
        CLType::String,
        EntryPointAccess::Public,
        EntryPointType::Called,
        EntryPointPayment::Caller,
    ));

    eps.add_entry_point(EntityEntryPoint::new(
        "submit_evidence",
        vec![
            Parameter::new("job_id", CLType::String),
            Parameter::new("evidence_hash", CLType::String),
        ],
        CLType::Unit,
        EntryPointAccess::Public,
        EntryPointType::Called,
        EntryPointPayment::Caller,
    ));

    eps.add_entry_point(EntityEntryPoint::new(
        "set_protocol_fee_bps",
        vec![Parameter::new("fee_bps", CLType::U64)],
        CLType::Unit,
        EntryPointAccess::Public,
        EntryPointType::Called,
        EntryPointPayment::Caller,
    ));

    eps.add_entry_point(EntityEntryPoint::new(
        "issue_challenge",
        vec![
            Parameter::new("file_id", CLType::String),
            Parameter::new("challenge_hash", CLType::String),
        ],
        CLType::Unit,
        EntryPointAccess::Public,
        EntryPointType::Called,
        EntryPointPayment::Caller,
    ));

    eps.add_entry_point(EntityEntryPoint::new(
        "verify_challenge",
        vec![
            Parameter::new("challenge_id", CLType::String),
            Parameter::new("passed", CLType::Bool),
        ],
        CLType::Unit,
        EntryPointAccess::Public,
        EntryPointType::Called,
        EntryPointPayment::Caller,
    ));

    eps.add_entry_point(EntityEntryPoint::new(
        "submit_kleros_verdict",
        vec![
            Parameter::new("job_id", CLType::String),
            Parameter::new("kleros_dispute_id", CLType::U64),
            Parameter::new("ruling", CLType::U64),
        ],
        CLType::Unit,
        EntryPointAccess::Public,
        EntryPointType::Called,
        EntryPointPayment::Caller,
    ));

    eps.add_entry_point(EntityEntryPoint::new(
        "create_session",
        vec![
            Parameter::new("consumer_pubkey", CLType::String),
            Parameter::new("max_duration_sec", CLType::U64),
            Parameter::new("max_data_mb", CLType::U64),
            Parameter::new("amount", U512::cl_type()),
        ],
        CLType::Unit,
        EntryPointAccess::Public,
        EntryPointType::Called,
        EntryPointPayment::Caller,
    ));

    eps.add_entry_point(EntityEntryPoint::new(
        "create_allocation",
        vec![
            Parameter::new("data_shards", CLType::U64),
            Parameter::new("parity_shards", CLType::U64),
            Parameter::new("size_mb", CLType::U64),
            Parameter::new("expiry_ms", CLType::U64),
            Parameter::new("amount", U512::cl_type()),
        ],
        CLType::Unit,
        EntryPointAccess::Public,
        EntryPointType::Called,
        EntryPointPayment::Caller,
    ));

    eps.add_entry_point(EntityEntryPoint::new(
        "store_file",
        vec![
            Parameter::new("alloc_id", CLType::String),
            Parameter::new("file_hash", CLType::String),
            Parameter::new("size_mb", CLType::U64),
            Parameter::new("amount", U512::cl_type()),
        ],
        CLType::Unit,
        EntryPointAccess::Public,
        EntryPointType::Called,
        EntryPointPayment::Caller,
    ));

    eps.add_entry_point(EntityEntryPoint::new(
        "create_demand",
        vec![
            Parameter::new("task_type", CLType::String),
            Parameter::new("runtime", CLType::String),
            Parameter::new("max_cost", U512::cl_type()),
            Parameter::new("duration_sec", CLType::U64),
            Parameter::new("requires_gpu", CLType::Bool),
            Parameter::new("min_vram_mb", CLType::U64),
        ],
        CLType::Unit,
        EntryPointAccess::Public,
        EntryPointType::Called,
        EntryPointPayment::Caller,
    ));

    eps.add_entry_point(EntityEntryPoint::new(
        "remove_file",
        vec![Parameter::new("file_id", CLType::String)],
        CLType::Unit,
        EntryPointAccess::Public,
        EntryPointType::Called,
        EntryPointPayment::Caller,
    ));

    eps.add_entry_point(EntityEntryPoint::new(
        "cancel_allocation",
        vec![Parameter::new("alloc_id", CLType::String)],
        CLType::Unit,
        EntryPointAccess::Public,
        EntryPointType::Called,
        EntryPointPayment::Caller,
    ));

    eps.add_entry_point(EntityEntryPoint::new(
        "cancel_demand",
        vec![Parameter::new("demand_id", CLType::String)],
        CLType::Unit,
        EntryPointAccess::Public,
        EntryPointType::Called,
        EntryPointPayment::Caller,
    ));

    eps.add_entry_point(EntityEntryPoint::new(
        "cancel_job",
        vec![Parameter::new("job_id", CLType::String)],
        CLType::Unit,
        EntryPointAccess::Public,
        EntryPointType::Called,
        EntryPointPayment::Caller,
    ));

    eps.add_entry_point(EntityEntryPoint::new(
        "close_session",
        vec![Parameter::new("session_id", CLType::String)],
        CLType::Unit,
        EntryPointAccess::Public,
        EntryPointType::Called,
        EntryPointPayment::Caller,
    ));

    eps.add_entry_point(EntityEntryPoint::new(
        "rate_provider",
        vec![
            Parameter::new("file_id", CLType::String),
            Parameter::new("session_id", CLType::String),
            Parameter::new("agreement_id", CLType::String),
            Parameter::new("rating", CLType::U64),
        ],
        CLType::Unit,
        EntryPointAccess::Public,
        EntryPointType::Called,
        EntryPointPayment::Caller,
    ));

    eps.add_entry_point(EntityEntryPoint::new(
        "dispute_session",
        vec![
            Parameter::new("session_id", CLType::String),
            Parameter::new("evidence_hash", CLType::String),
        ],
        CLType::Unit,
        EntryPointAccess::Public,
        EntryPointType::Called,
        EntryPointPayment::Caller,
    ));

    eps.add_entry_point(EntityEntryPoint::new(
        "dispute_file",
        vec![
            Parameter::new("file_id", CLType::String),
            Parameter::new("evidence_hash", CLType::String),
        ],
        CLType::Unit,
        EntryPointAccess::Public,
        EntryPointType::Called,
        EntryPointPayment::Caller,
    ));

    eps.add_entry_point(EntityEntryPoint::new(
        "dispute_agreement",
        vec![
            Parameter::new("agreement_id", CLType::String),
            Parameter::new("evidence_hash", CLType::String),
        ],
        CLType::Unit,
        EntryPointAccess::Public,
        EntryPointType::Called,
        EntryPointPayment::Caller,
    ));


    eps
}

fn get_contract_purse() -> URef {
    runtime::get_key(CONTRACT_PURSE)
        .unwrap_or_revert_with(ApiError::MissingKey)
        .into_uref()
        .unwrap_or_revert()
}

#[no_mangle]
pub extern "C" fn create_job() {
    let consumer: AccountHash = runtime::get_named_arg("consumer");
    let provider: AccountHash = runtime::get_named_arg("provider");
    let amount: U512 = runtime::get_named_arg("amount");
    let provider_fee_bps: u64 = runtime::get_named_arg("provider_fee_bps");
    let order_id: String = runtime::get_named_arg("order_id");

    let now: u64 = Into::<u64>::into(runtime::get_blocktime());
    let valid_until = now + 3_600_000;
    let task_type: u64 = 0;

    // Auto-increment per-consumer nonce
    let jobs_dict = get_dict(JOBS_DICT);
    let nonce_key = format!("nonce:{}", consumer.to_string());
    let nonce: u64 = read_dict(jobs_dict, &nonce_key).unwrap_or(0);
    let next_nonce = nonce + 1;
    write_dict(jobs_dict, &nonce_key, next_nonce);

    let job_id = format!("job:{}:{}", consumer.to_string(), nonce);

    // Clear stale lifecycle fields from any previous use of this job_id
    write_dict(jobs_dict, &format!("{}:acked_at", job_id), 0u64);
    write_dict(jobs_dict, &format!("{}:response_hash", job_id), "".to_string());
    write_dict(jobs_dict, &format!("{}:rating", job_id), 0u64);
    write_dict(jobs_dict, &format!("{}:consumer_confirmed", job_id), false);
    write_dict(jobs_dict, &format!("{}:dispute_initiator", job_id), AccountHash::default());
    write_dict(jobs_dict, &format!("{}:dispute_timestamp", job_id), 0u64);
    write_dict(jobs_dict, &format!("{}:resolution_payout_pct", job_id), 0u64);
    write_dict(jobs_dict, &format!("{}:protocol_fee", job_id), U512::from(0));
    write_dict(jobs_dict, &format!("{}:auto_released_at", job_id), 0u64);

    write_dict(jobs_dict, &format!("{}:consumer", job_id), consumer);
    write_dict(jobs_dict, &format!("{}:provider", job_id), provider);
    write_dict(jobs_dict, &format!("{}:request_hash", job_id), order_id.clone());
    write_dict(jobs_dict, &format!("{}:nonce", job_id), nonce);
    write_dict(jobs_dict, &format!("{}:task_type", job_id), task_type);
    write_dict(jobs_dict, &format!("{}:valid_until", job_id), valid_until);
    write_dict(jobs_dict, &format!("{}:amount", job_id), amount.clone());
    write_dict(jobs_dict, &format!("{}:provider_fee_bps", job_id), provider_fee_bps);
    write_dict(jobs_dict, &format!("{}:created_at", job_id), now);

    // Auto-assign: if provider is all zeros, query compute registry for a registered provider
    let is_auto_assign = provider == AccountHash::default();
    let mut assigned_provider = provider;
    if is_auto_assign {
        // Call compute registry to get list of registered providers
        let cr_key = runtime::get_key(COMPUTE_REGISTRY)
            .unwrap_or_revert_with(ApiError::MissingKey);
        let cr_hash = cr_key.into_hash_addr().unwrap_or_revert_with(ApiError::User(20));
        let cr_contract_hash = ContractHash::new(cr_hash);
        let providers_str: String = runtime::call_contract(cr_contract_hash, "get_providers", RuntimeArgs::new());
        if !providers_str.is_empty() {
            // Pick the first provider from the list
            let first = providers_str.split(',').next().unwrap_or("");
            if !first.is_empty() {
                // Parse account hash from string format "account-hash-xxxx"
                let hex = first.strip_prefix("account-hash-").unwrap_or(first);
                let mut bytes = [0u8; 32];
                let hex_bytes = hex.as_bytes();
                for i in 0..32 {
                    let hi = (hex_bytes[i * 2] as char).to_digit(16).unwrap_or(0) as u8;
                    let lo = (hex_bytes[i * 2 + 1] as char).to_digit(16).unwrap_or(0) as u8;
                    bytes[i] = (hi << 4) | lo;
                }
                assigned_provider = AccountHash::new(bytes);
                // Update the provider field with the assigned provider
                write_dict(jobs_dict, &format!("{}:provider", job_id), assigned_provider);
            }
        }
        write_dict(jobs_dict, &format!("{}:state", job_id), STATE_ASSIGNED);
        write_dict(jobs_dict, &format!("{}:acked_at", job_id), now);

        // Add to assigned provider's job list
        let provider_jobs_dict = get_dict(PROVIDER_JOBS);
        let mut provider_list: Vec<String> = read_dict(provider_jobs_dict, &assigned_provider.to_string())
            .unwrap_or_default();
        if !provider_list.contains(&job_id) {
            provider_list.push(job_id.clone());
            write_dict(provider_jobs_dict, &assigned_provider.to_string(), provider_list);
        }
    } else {
        write_dict(jobs_dict, &format!("{}:state", job_id), STATE_PENDING);
    }

    // Add to pending list (bridge polls this for both pending and auto-assigned jobs)
    let pending_dict = get_dict(PENDING_JOBS);
    let mut pending: Vec<String> = read_dict(pending_dict, "list").unwrap_or_default();
    if !pending.contains(&job_id) {
        pending.push(job_id.clone());
        write_dict(pending_dict, "list", pending);
    }

    let consumer_jobs_dict = get_dict(CONSUMER_JOBS);
    let mut consumer_list: Vec<String> = read_dict(consumer_jobs_dict, &consumer.to_string())
        .unwrap_or_default();
    if !consumer_list.contains(&job_id) {
        consumer_list.push(job_id.clone());
        write_dict(consumer_jobs_dict, &consumer.to_string(), consumer_list);
    }
}

#[no_mangle]
pub extern "C" fn provider_ack() {
    let caller = runtime::get_caller();
    let job_id: String = runtime::get_named_arg("job_id");
    let jobs_dict = get_dict(JOBS_DICT);

    let provider: AccountHash = read_dict(jobs_dict, &format!("{}:provider", job_id))
        .unwrap_or_revert_with(ApiError::User(2));
    if provider != caller {
        runtime::revert(ApiError::User(3));
    }

    let state: u8 = read_dict(jobs_dict, &format!("{}:state", job_id))
        .unwrap_or(STATE_REFUNDED);
    if state != STATE_PENDING {
        runtime::revert(ApiError::User(4));
    }

    let now: u64 = Into::<u64>::into(runtime::get_blocktime());
    write_dict(jobs_dict, &format!("{}:state", job_id), STATE_ASSIGNED);
    write_dict(jobs_dict, &format!("{}:acked_at", job_id), now);

    let provider_jobs_dict = get_dict(PROVIDER_JOBS);
    let mut provider_list: Vec<String> = read_dict(provider_jobs_dict, &provider.to_string())
        .unwrap_or_default();
    if !provider_list.contains(&job_id) {
        provider_list.push(job_id.clone());
        write_dict(provider_jobs_dict, &provider.to_string(), provider_list);
    }
}

#[no_mangle]
pub extern "C" fn provider_complete() {
    let caller = runtime::get_caller();
    let job_id: String = runtime::get_named_arg("job_id");
    let response_hash: String = runtime::get_named_arg("response_hash");
    let jobs_dict = get_dict(JOBS_DICT);

    let provider: AccountHash = read_dict(jobs_dict, &format!("{}:provider", job_id))
        .unwrap_or_revert_with(ApiError::User(2));

    // Auto-assign: if provider is zero (default), any provider can complete the job
    // and becomes the assigned provider for payment purposes
    let is_auto_assign = provider == AccountHash::default();
    if !is_auto_assign && provider != caller {
        runtime::revert(ApiError::User(3));
    }

    let state: u8 = read_dict(jobs_dict, &format!("{}:state", job_id))
        .unwrap_or(STATE_REFUNDED);
    if state != STATE_ASSIGNED && state != STATE_IN_PROGRESS {
        runtime::revert(ApiError::User(4));
    }

    // For auto-assigned jobs, set the provider to the caller so payment goes to them
    if is_auto_assign {
        write_dict(jobs_dict, &format!("{}:provider", job_id), caller);

        // Add to provider's job list
        let provider_jobs_dict = get_dict(PROVIDER_JOBS);
        let mut provider_list: Vec<String> = read_dict(provider_jobs_dict, &caller.to_string())
            .unwrap_or_default();
        if !provider_list.contains(&job_id) {
            provider_list.push(job_id.clone());
            write_dict(provider_jobs_dict, &caller.to_string(), provider_list);
        }
    }

    let now: u64 = Into::<u64>::into(runtime::get_blocktime());
    write_dict(jobs_dict, &format!("{}:state", job_id), STATE_PROVIDER_DONE);
    write_dict(jobs_dict, &format!("{}:response_hash", job_id), response_hash);
    write_dict(jobs_dict, &format!("{}:completed_at", job_id), now);
}

#[no_mangle]
pub extern "C" fn consumer_confirm() {
    let caller = runtime::get_caller();
    let job_id: String = runtime::get_named_arg("job_id");
    let _rating: u64 = runtime::get_named_arg("rating");
    let jobs_dict = get_dict(JOBS_DICT);

    let consumer: AccountHash = read_dict(jobs_dict, &format!("{}:consumer", job_id))
        .unwrap_or_revert_with(ApiError::User(2));
    if consumer != caller {
        runtime::revert(ApiError::User(3));
    }

    let state: u8 = read_dict(jobs_dict, &format!("{}:state", job_id))
        .unwrap_or(STATE_REFUNDED);
    if state != STATE_PROVIDER_DONE {
        runtime::revert(ApiError::User(4));
    }

    let now: u64 = Into::<u64>::into(runtime::get_blocktime());
    write_dict(jobs_dict, &format!("{}:state", job_id), STATE_SETTLED);
    write_dict(jobs_dict, &format!("{}:settled_at", job_id), now);
    write_dict(jobs_dict, &format!("{}:rating", job_id), _rating);
    // Provider pulls payment via claim_payment()
}

#[no_mangle]
pub extern "C" fn claim_payment() {
    let caller = runtime::get_caller();
    let job_id: String = runtime::get_named_arg("job_id");
    let jobs_dict = get_dict(JOBS_DICT);

    let provider: AccountHash = read_dict(jobs_dict, &format!("{}:provider", job_id))
        .unwrap_or_revert_with(ApiError::User(2));
    if provider != caller {
        runtime::revert(ApiError::User(3));
    }

    let state: u8 = read_dict(jobs_dict, &format!("{}:state", job_id)).unwrap_or(STATE_REFUNDED);
    if state != STATE_SETTLED {
        runtime::revert(ApiError::User(4));
    }

    let claimed: bool = read_dict(jobs_dict, &format!("{}:provider_claimed", job_id)).unwrap_or(false);
    if claimed {
        runtime::revert(ApiError::User(5));
    }

    let amount: U512 = read_dict(jobs_dict, &format!("{}:amount", job_id)).unwrap_or_default();
    let provider_fee_bps: u64 = read_dict(jobs_dict, &format!("{}:provider_fee_bps", job_id)).unwrap_or_default();
    let protocol_fee = amount * U512::from(provider_fee_bps) / U512::from(10000);
    let provider_payout = amount - protocol_fee;

    let contract_purse = get_contract_purse();

    // Transfer provider payout from contract purse to provider
    system::transfer_from_purse_to_account(contract_purse, provider, provider_payout, None)
        .unwrap_or_revert();

    // Transfer protocol fee from contract purse to fee recipient
    if protocol_fee > U512::from(0) {
        let fee_recipient: AccountHash = runtime::get_key(PROTOCOL_FEE_RECIPIENT)
            .unwrap_or_revert()
            .into_account()
            .unwrap_or_revert();
        system::transfer_from_purse_to_account(contract_purse, fee_recipient, protocol_fee, None)
            .unwrap_or_revert();
    }

    write_dict(jobs_dict, &format!("{}:provider_claimed", job_id), true);
    write_dict(jobs_dict, &format!("{}:provider_payout", job_id), provider_payout);
}

#[no_mangle]
pub extern "C" fn withdraw_protocol_fees() {
    require_owner();
    let amount: U512 = runtime::get_named_arg("amount");
    let fees_uref: URef = runtime::get_key(PROTOCOL_FEES)
        .unwrap_or_revert()
        .into_uref()
        .unwrap_or_revert();
    let fees: U512 = storage::read(fees_uref).unwrap_or_revert().unwrap_or_default();
    if fees == U512::from(0) || amount > fees {
        runtime::revert(ApiError::User(1));
    }
    let contract_purse = get_contract_purse();
    let owner: AccountHash = runtime::get_key(OWNER)
        .unwrap_or_revert()
        .into_account()
        .unwrap_or_revert();
    system::transfer_from_purse_to_account(contract_purse, owner, amount, None)
        .unwrap_or_revert();
    storage::write(fees_uref, fees - amount);
}

#[no_mangle]
pub extern "C" fn dispute_job() {
    let caller = runtime::get_caller();
    let job_id: String = runtime::get_named_arg("job_id");
    let evidence_hash: String = runtime::get_named_arg("evidence_hash");
    let jobs_dict = get_dict(JOBS_DICT);

    let consumer: AccountHash = read_dict(jobs_dict, &format!("{}:consumer", job_id))
        .unwrap_or_revert_with(ApiError::User(2));
    if consumer != caller {
        runtime::revert(ApiError::User(3));
    }

    let state: u8 = read_dict(jobs_dict, &format!("{}:state", job_id))
        .unwrap_or(STATE_REFUNDED);
    if state != STATE_PROVIDER_DONE && state != STATE_CONSUMER_CONFIRM {
        runtime::revert(ApiError::User(4));
    }

    write_dict(jobs_dict, &format!("{}:state", job_id), STATE_DISPUTED);
    write_dict(jobs_dict, &format!("{}:evidence_hash", job_id), evidence_hash);
}

#[no_mangle]
pub extern "C" fn resolve_dispute() {
    require_owner();
    let job_id: String = runtime::get_named_arg("job_id");
    let consumer_payout_pct: u64 = runtime::get_named_arg("consumer_payout_pct");
    let _provider_payout_pct: u64 = runtime::get_named_arg("provider_payout_pct");
    let consumer_wins = consumer_payout_pct > 50;
    let jobs_dict = get_dict(JOBS_DICT);

    let state: u8 = read_dict(jobs_dict, &format!("{}:state", job_id))
        .unwrap_or(STATE_REFUNDED);
    if state != STATE_DISPUTED {
        runtime::revert(ApiError::User(4));
    }

    if consumer_wins {
        write_dict(jobs_dict, &format!("{}:state", job_id), STATE_DISPUTE_CONSUMER_WON);
    } else {
        write_dict(jobs_dict, &format!("{}:state", job_id), STATE_DISPUTE_PROVIDER_WON);
    }
    write_dict(jobs_dict, &format!("{}:consumer_payout_pct", job_id), consumer_payout_pct);
    // Winner pulls funds via claim_resolution()
}

#[no_mangle]
pub extern "C" fn claim_resolution() {
    let caller = runtime::get_caller();
    let job_id: String = runtime::get_named_arg("job_id");
    let jobs_dict = get_dict(JOBS_DICT);

    let state: u8 = read_dict(jobs_dict, &format!("{}:state", job_id)).unwrap_or(STATE_REFUNDED);

    if state == STATE_DISPUTE_CONSUMER_WON {
        let consumer: AccountHash = read_dict(jobs_dict, &format!("{}:consumer", job_id))
            .unwrap_or_revert_with(ApiError::User(2));
        if consumer != caller {
            runtime::revert(ApiError::User(3));
        }
        let amount: U512 = read_dict(jobs_dict, &format!("{}:amount", job_id)).unwrap_or_default();
        let contract_purse = get_contract_purse();
        system::transfer_from_purse_to_account(contract_purse, consumer, amount, None)
            .unwrap_or_revert();
        write_dict(jobs_dict, &format!("{}:state", job_id), STATE_REFUNDED);
    } else if state == STATE_DISPUTE_PROVIDER_WON {
        let provider: AccountHash = read_dict(jobs_dict, &format!("{}:provider", job_id))
            .unwrap_or_revert_with(ApiError::User(2));
        if provider != caller {
            runtime::revert(ApiError::User(3));
        }
        write_dict(jobs_dict, &format!("{}:state", job_id), STATE_SETTLED);
    } else {
        runtime::revert(ApiError::User(4));
    }
}

#[no_mangle]
pub extern "C" fn refund_job() {
    let caller = runtime::get_caller();
    let job_id: String = runtime::get_named_arg("job_id");
    let jobs_dict = get_dict(JOBS_DICT);

    let consumer: AccountHash = read_dict(jobs_dict, &format!("{}:consumer", job_id))
        .unwrap_or_revert_with(ApiError::User(2));
    if consumer != caller {
        runtime::revert(ApiError::User(3));
    }

    let state: u8 = read_dict(jobs_dict, &format!("{}:state", job_id))
        .unwrap_or(STATE_REFUNDED);
    if state != STATE_PENDING {
        runtime::revert(ApiError::User(4));
    }

    let amount: U512 = read_dict(jobs_dict, &format!("{}:amount", job_id)).unwrap_or_default();
    let contract_purse = get_contract_purse();
    system::transfer_from_purse_to_account(contract_purse, consumer, amount, None)
        .unwrap_or_revert();
    write_dict(jobs_dict, &format!("{}:state", job_id), STATE_REFUNDED);
}

#[no_mangle]
pub extern "C" fn auto_release() {
    let job_id: String = runtime::get_named_arg("job_id");
    let jobs_dict = get_dict(JOBS_DICT);

    let state: u8 = read_dict(jobs_dict, &format!("{}:state", job_id))
        .unwrap_or(STATE_REFUNDED);
    // Auto-release only allowed after provider has completed the job
    if state != STATE_PROVIDER_DONE {
        runtime::revert(ApiError::User(4));
    }

    let completed_at: u64 = read_dict(jobs_dict, &format!("{}:completed_at", job_id))
        .unwrap_or_default();
    let now: u64 = Into::<u64>::into(runtime::get_blocktime());
    // Consumer has 1 hour from provider_complete to confirm or dispute
    if now < completed_at + 3_600_000 {
        runtime::revert(ApiError::User(5));
    }

    let provider: AccountHash = read_dict(jobs_dict, &format!("{}:provider", job_id))
        .unwrap_or_revert_with(ApiError::User(2));
    let amount: U512 = read_dict(jobs_dict, &format!("{}:amount", job_id)).unwrap_or_default();
    let provider_fee_bps: u64 = read_dict(jobs_dict, &format!("{}:provider_fee_bps", job_id)).unwrap_or_default();
    let protocol_fee = amount * U512::from(provider_fee_bps) / U512::from(10000);
    let provider_payout = amount - protocol_fee;

    let contract_purse = get_contract_purse();
    system::transfer_from_purse_to_account(contract_purse, provider, provider_payout, None)
        .unwrap_or_revert();

    if protocol_fee > U512::from(0) {
        let fee_recipient: AccountHash = runtime::get_key(PROTOCOL_FEE_RECIPIENT)
            .unwrap_or_revert()
            .into_account()
            .unwrap_or_revert();
        system::transfer_from_purse_to_account(contract_purse, fee_recipient, protocol_fee, None)
            .unwrap_or_revert();
    }

    write_dict(jobs_dict, &format!("{}:state", job_id), STATE_SETTLED);
    write_dict(jobs_dict, &format!("{}:auto_released_at", job_id), now);
    write_dict(jobs_dict, &format!("{}:provider_claimed", job_id), true);
    write_dict(jobs_dict, &format!("{}:provider_payout", job_id), provider_payout);
}

#[no_mangle]
pub extern "C" fn submit_evidence() {
    let caller = runtime::get_caller();
    let job_id: String = runtime::get_named_arg("job_id");
    let evidence_hash: String = runtime::get_named_arg("evidence_hash");
    let jobs_dict = get_dict(JOBS_DICT);

    let provider: AccountHash = read_dict(jobs_dict, &format!("{}:provider", job_id))
        .unwrap_or_revert_with(ApiError::User(2));
    if provider != caller {
        runtime::revert(ApiError::User(3));
    }

    let state: u8 = read_dict(jobs_dict, &format!("{}:state", job_id))
        .unwrap_or(STATE_REFUNDED);
    if state != STATE_DISPUTED {
        runtime::revert(ApiError::User(4));
    }

    write_dict(jobs_dict, &format!("{}:provider_evidence", job_id), evidence_hash);
    write_dict(jobs_dict, &format!("{}:provider_evidence_at", job_id), Into::<u64>::into(runtime::get_blocktime()));
}

#[no_mangle]
pub extern "C" fn set_protocol_fee_bps() {
    require_owner();
    let fee_bps: u64 = runtime::get_named_arg("fee_bps");
    if fee_bps > 10000 {
        runtime::revert(ApiError::User(1));
    }
    let fee_uref = runtime::get_key(PROTOCOL_FEE_BPS)
        .unwrap_or_revert()
        .into_uref()
        .unwrap_or_revert();
    storage::write(fee_uref, fee_bps);
}

#[no_mangle]
pub extern "C" fn issue_challenge() {
    require_owner();
    let file_id: String = runtime::get_named_arg("file_id");
    let challenge_hash: String = runtime::get_named_arg("challenge_hash");
    let challenges_dict = get_dict(CHALLENGES_DICT);
    let now: u64 = Into::<u64>::into(runtime::get_blocktime());

    let challenge_id = format!("challenge:{}:{}", file_id, now);
    write_dict(challenges_dict, &format!("{}:file_id", challenge_id), file_id);
    write_dict(challenges_dict, &format!("{}:challenge_hash", challenge_id), challenge_hash);
    write_dict(challenges_dict, &format!("{}:issued_at", challenge_id), now);
    write_dict(challenges_dict, &format!("{}:status", challenge_id), "pending");
}

#[no_mangle]
pub extern "C" fn verify_challenge() {
    require_owner();
    let challenge_id: String = runtime::get_named_arg("challenge_id");
    let passed: bool = runtime::get_named_arg("passed");
    let challenges_dict = get_dict(CHALLENGES_DICT);

    let status: String = read_dict(challenges_dict, &format!("{}:status", challenge_id))
        .unwrap_or_default();
    if status != "pending" {
        runtime::revert(ApiError::User(4));
    }

    write_dict(challenges_dict, &format!("{}:status", challenge_id), if passed { "passed" } else { "failed" });
    write_dict(challenges_dict, &format!("{}:verified_at", challenge_id), Into::<u64>::into(runtime::get_blocktime()));
}

#[no_mangle]
pub extern "C" fn submit_kleros_verdict() {
    let job_id: String = runtime::get_named_arg("job_id");
    let kleros_dispute_id: u64 = runtime::get_named_arg("kleros_dispute_id");
    let ruling: u64 = runtime::get_named_arg("ruling");
    let jobs_dict = get_dict(JOBS_DICT);

    let state: u8 = read_dict(jobs_dict, &format!("{}:state", job_id))
        .unwrap_or(STATE_REFUNDED);
    if state != STATE_DISPUTED {
        runtime::revert(ApiError::User(4));
    }

    let consumer: AccountHash = read_dict(jobs_dict, &format!("{}:consumer", job_id))
        .unwrap_or_revert_with(ApiError::User(2));
    let provider: AccountHash = read_dict(jobs_dict, &format!("{}:provider", job_id))
        .unwrap_or_revert_with(ApiError::User(2));
    let amount: U512 = read_dict(jobs_dict, &format!("{}:amount", job_id))
        .unwrap_or_revert_with(ApiError::User(2));

    write_dict(jobs_dict, &format!("{}:kleros_dispute_id", job_id), kleros_dispute_id);
    write_dict(jobs_dict, &format!("{}:kleros_ruling", job_id), ruling);
    write_dict(jobs_dict, &format!("{}:kleros_verdict_at", job_id), Into::<u64>::into(runtime::get_blocktime()));

    let contract_purse = get_contract_purse();

    if ruling == 1 {
        // Consumer wins — full refund from escrow
        system::transfer_from_purse_to_account(contract_purse, consumer, amount, None)
            .unwrap_or_revert_with(ApiError::User(5));
        write_dict(jobs_dict, &format!("{}:state", job_id), STATE_DISPUTE_CONSUMER_WON);
        write_dict(jobs_dict, &format!("{}:consumer_refunded", job_id), true);
    } else if ruling == 2 {
        // Provider wins — full payout from escrow
        system::transfer_from_purse_to_account(contract_purse, provider, amount, None)
            .unwrap_or_revert_with(ApiError::User(5));
        write_dict(jobs_dict, &format!("{}:state", job_id), STATE_DISPUTE_PROVIDER_WON);
        write_dict(jobs_dict, &format!("{}:provider_paid", job_id), true);
    } else {
        // Ruling 0 (refused) — split escrow 50/50
        let half = amount / U512::from(2);
        let other_half = amount - half;
        system::transfer_from_purse_to_account(contract_purse, consumer, half, None)
            .unwrap_or_revert_with(ApiError::User(5));
        system::transfer_from_purse_to_account(contract_purse, provider, other_half, None)
            .unwrap_or_revert_with(ApiError::User(5));
        write_dict(jobs_dict, &format!("{}:state", job_id), STATE_REFUNDED);
        write_dict(jobs_dict, &format!("{}:split_refund", job_id), true);
    }
}

// ============ RESOURCE CREATION ENTRY POINTS ============

#[no_mangle]
pub extern "C" fn create_session() {
    let consumer_pubkey: String = runtime::get_named_arg("consumer_pubkey");
    let max_duration_sec: u64 = runtime::get_named_arg("max_duration_sec");
    let max_data_mb: u64 = runtime::get_named_arg("max_data_mb");
    let amount: U512 = runtime::get_named_arg("amount");
    let caller = runtime::get_caller();
    let now: u64 = Into::<u64>::into(runtime::get_blocktime());
    let jobs_dict = get_dict(JOBS_DICT);

    let nonce_key = format!("nonce:{}", caller.to_string());
    let nonce: u64 = read_dict(jobs_dict, &nonce_key).unwrap_or(0);
    let next_nonce = nonce + 1;
    write_dict(jobs_dict, &nonce_key, next_nonce);

    let session_id = format!("session:{}:{}", caller.to_string(), nonce);
    write_dict(jobs_dict, &format!("{}:consumer", session_id), caller);
    write_dict(jobs_dict, &format!("{}:amount", session_id), amount);
    write_dict(jobs_dict, &format!("{}:state", session_id), STATE_PENDING);
    write_dict(jobs_dict, &format!("{}:created_at", session_id), now);
    write_dict(jobs_dict, &format!("{}:max_duration_sec", session_id), max_duration_sec);
    write_dict(jobs_dict, &format!("{}:max_data_mb", session_id), max_data_mb);
    write_dict(jobs_dict, &format!("{}:consumer_pubkey", session_id), consumer_pubkey);
    write_dict(jobs_dict, &format!("{}:resource_type", session_id), "bandwidth");

    let pending_dict = get_dict(PENDING_JOBS);
    let mut pending: Vec<String> = read_dict(pending_dict, "list").unwrap_or_default();
    if !pending.contains(&session_id) {
        pending.push(session_id.clone());
        write_dict(pending_dict, "list", pending);
    }
}

#[no_mangle]
pub extern "C" fn create_allocation() {
    let data_shards: u64 = runtime::get_named_arg("data_shards");
    let parity_shards: u64 = runtime::get_named_arg("parity_shards");
    let size_mb: u64 = runtime::get_named_arg("size_mb");
    let expiry_ms: u64 = runtime::get_named_arg("expiry_ms");
    let amount: U512 = runtime::get_named_arg("amount");
    let caller = runtime::get_caller();
    let now: u64 = Into::<u64>::into(runtime::get_blocktime());
    let jobs_dict = get_dict(JOBS_DICT);

    let nonce_key = format!("nonce:{}", caller.to_string());
    let nonce: u64 = read_dict(jobs_dict, &nonce_key).unwrap_or(0);
    let next_nonce = nonce + 1;
    write_dict(jobs_dict, &nonce_key, next_nonce);

    let alloc_id = format!("alloc:{}:{}", caller.to_string(), nonce);
    write_dict(jobs_dict, &format!("{}:consumer", alloc_id), caller);
    write_dict(jobs_dict, &format!("{}:amount", alloc_id), amount);
    write_dict(jobs_dict, &format!("{}:state", alloc_id), STATE_PENDING);
    write_dict(jobs_dict, &format!("{}:created_at", alloc_id), now);
    write_dict(jobs_dict, &format!("{}:data_shards", alloc_id), data_shards);
    write_dict(jobs_dict, &format!("{}:parity_shards", alloc_id), parity_shards);
    write_dict(jobs_dict, &format!("{}:size_mb", alloc_id), size_mb);
    write_dict(jobs_dict, &format!("{}:expiry_ms", alloc_id), expiry_ms);
    write_dict(jobs_dict, &format!("{}:resource_type", alloc_id), "storage");

    let pending_dict = get_dict(PENDING_JOBS);
    let mut pending: Vec<String> = read_dict(pending_dict, "list").unwrap_or_default();
    if !pending.contains(&alloc_id) {
        pending.push(alloc_id.clone());
        write_dict(pending_dict, "list", pending);
    }
}

#[no_mangle]
pub extern "C" fn store_file() {
    let alloc_id: String = runtime::get_named_arg("alloc_id");
    let file_hash: String = runtime::get_named_arg("file_hash");
    let size_mb: u64 = runtime::get_named_arg("size_mb");
    let amount: U512 = runtime::get_named_arg("amount");
    let caller = runtime::get_caller();
    let now: u64 = Into::<u64>::into(runtime::get_blocktime());
    let jobs_dict = get_dict(JOBS_DICT);

    let file_id = format!("file:{}:{}", alloc_id, now);
    write_dict(jobs_dict, &format!("{}:consumer", file_id), caller);
    write_dict(jobs_dict, &format!("{}:amount", file_id), amount);
    write_dict(jobs_dict, &format!("{}:state", file_id), STATE_PENDING);
    write_dict(jobs_dict, &format!("{}:created_at", file_id), now);
    write_dict(jobs_dict, &format!("{}:alloc_id", file_id), alloc_id);
    write_dict(jobs_dict, &format!("{}:file_hash", file_id), file_hash);
    write_dict(jobs_dict, &format!("{}:size_mb", file_id), size_mb);
    write_dict(jobs_dict, &format!("{}:resource_type", file_id), "storage");
}

#[no_mangle]
pub extern "C" fn create_demand() {
    let task_type: String = runtime::get_named_arg("task_type");
    let runtime_str: String = runtime::get_named_arg("runtime");
    let max_cost: U512 = runtime::get_named_arg("max_cost");
    let duration_sec: u64 = runtime::get_named_arg("duration_sec");
    let requires_gpu: bool = runtime::get_named_arg("requires_gpu");
    let min_vram_mb: u64 = runtime::get_named_arg("min_vram_mb");
    let caller = runtime::get_caller();
    let now: u64 = Into::<u64>::into(runtime::get_blocktime());
    let jobs_dict = get_dict(JOBS_DICT);

    let nonce_key = format!("nonce:{}", caller.to_string());
    let nonce: u64 = read_dict(jobs_dict, &nonce_key).unwrap_or(0);
    let next_nonce = nonce + 1;
    write_dict(jobs_dict, &nonce_key, next_nonce);

    let demand_id = format!("demand:{}:{}", caller.to_string(), nonce);
    write_dict(jobs_dict, &format!("{}:consumer", demand_id), caller);
    write_dict(jobs_dict, &format!("{}:amount", demand_id), max_cost);
    write_dict(jobs_dict, &format!("{}:state", demand_id), STATE_PENDING);
    write_dict(jobs_dict, &format!("{}:created_at", demand_id), now);
    write_dict(jobs_dict, &format!("{}:task_type", demand_id), task_type);
    write_dict(jobs_dict, &format!("{}:runtime", demand_id), runtime_str);
    write_dict(jobs_dict, &format!("{}:duration_sec", demand_id), duration_sec);
    write_dict(jobs_dict, &format!("{}:requires_gpu", demand_id), requires_gpu);
    write_dict(jobs_dict, &format!("{}:min_vram_mb", demand_id), min_vram_mb);
    write_dict(jobs_dict, &format!("{}:resource_type", demand_id), "compute");

    let pending_dict = get_dict(PENDING_JOBS);
    let mut pending: Vec<String> = read_dict(pending_dict, "list").unwrap_or_default();
    if !pending.contains(&demand_id) {
        pending.push(demand_id.clone());
        write_dict(pending_dict, "list", pending);
    }
}

// ============ CANCEL / CLOSE ENTRY POINTS ============

#[no_mangle]
pub extern "C" fn remove_file() {
    let caller = runtime::get_caller();
    let file_id: String = runtime::get_named_arg("file_id");
    let jobs_dict = get_dict(JOBS_DICT);

    let consumer: AccountHash = read_dict(jobs_dict, &format!("{}:consumer", file_id))
        .unwrap_or_revert_with(ApiError::User(2));
    if consumer != caller {
        runtime::revert(ApiError::User(3));
    }

    let state: u8 = read_dict(jobs_dict, &format!("{}:state", file_id))
        .unwrap_or(STATE_REFUNDED);
    if state == STATE_SETTLED || state == STATE_REFUNDED {
        runtime::revert(ApiError::User(4));
    }

    let amount: U512 = read_dict(jobs_dict, &format!("{}:amount", file_id)).unwrap_or_default();
    if amount > U512::from(0) {
        let contract_purse = get_contract_purse();
        system::transfer_from_purse_to_account(contract_purse, consumer, amount, None)
            .unwrap_or_revert();
    }
    write_dict(jobs_dict, &format!("{}:state", file_id), STATE_REFUNDED);
    let now: u64 = Into::<u64>::into(runtime::get_blocktime());
    write_dict(jobs_dict, &format!("{}:removed_at", file_id), now);
}

#[no_mangle]
pub extern "C" fn cancel_allocation() {
    let caller = runtime::get_caller();
    let alloc_id: String = runtime::get_named_arg("alloc_id");
    let jobs_dict = get_dict(JOBS_DICT);

    let consumer: AccountHash = read_dict(jobs_dict, &format!("{}:consumer", alloc_id))
        .unwrap_or_revert_with(ApiError::User(2));
    if consumer != caller {
        runtime::revert(ApiError::User(3));
    }

    let state: u8 = read_dict(jobs_dict, &format!("{}:state", alloc_id))
        .unwrap_or(STATE_REFUNDED);
    if state != STATE_PENDING {
        runtime::revert(ApiError::User(4));
    }

    let amount: U512 = read_dict(jobs_dict, &format!("{}:amount", alloc_id)).unwrap_or_default();
    if amount > U512::from(0) {
        let contract_purse = get_contract_purse();
        system::transfer_from_purse_to_account(contract_purse, consumer, amount, None)
            .unwrap_or_revert();
    }
    write_dict(jobs_dict, &format!("{}:state", alloc_id), STATE_REFUNDED);
    write_dict(jobs_dict, &format!("{}:cancelled_at", alloc_id), Into::<u64>::into(runtime::get_blocktime()));
}

#[no_mangle]
pub extern "C" fn cancel_demand() {
    let caller = runtime::get_caller();
    let demand_id: String = runtime::get_named_arg("demand_id");
    let jobs_dict = get_dict(JOBS_DICT);

    let consumer: AccountHash = read_dict(jobs_dict, &format!("{}:consumer", demand_id))
        .unwrap_or_revert_with(ApiError::User(2));
    if consumer != caller {
        runtime::revert(ApiError::User(3));
    }

    let state: u8 = read_dict(jobs_dict, &format!("{}:state", demand_id))
        .unwrap_or(STATE_REFUNDED);
    if state != STATE_PENDING {
        runtime::revert(ApiError::User(4));
    }

    let amount: U512 = read_dict(jobs_dict, &format!("{}:amount", demand_id)).unwrap_or_default();
    if amount > U512::from(0) {
        let contract_purse = get_contract_purse();
        system::transfer_from_purse_to_account(contract_purse, consumer, amount, None)
            .unwrap_or_revert();
    }
    write_dict(jobs_dict, &format!("{}:state", demand_id), STATE_REFUNDED);
    write_dict(jobs_dict, &format!("{}:cancelled_at", demand_id), Into::<u64>::into(runtime::get_blocktime()));
}

#[no_mangle]
pub extern "C" fn cancel_job() {
    let caller = runtime::get_caller();
    let job_id: String = runtime::get_named_arg("job_id");
    let jobs_dict = get_dict(JOBS_DICT);

    let consumer: AccountHash = read_dict(jobs_dict, &format!("{}:consumer", job_id))
        .unwrap_or_revert_with(ApiError::User(2));
    if consumer != caller {
        runtime::revert(ApiError::User(3));
    }

    let state: u8 = read_dict(jobs_dict, &format!("{}:state", job_id))
        .unwrap_or(STATE_REFUNDED);
    if state != STATE_PENDING {
        runtime::revert(ApiError::User(4));
    }

    let amount: U512 = read_dict(jobs_dict, &format!("{}:amount", job_id)).unwrap_or_default();
    if amount > U512::from(0) {
        let contract_purse = get_contract_purse();
        system::transfer_from_purse_to_account(contract_purse, consumer, amount, None)
            .unwrap_or_revert();
    }
    write_dict(jobs_dict, &format!("{}:state", job_id), STATE_REFUNDED);
    write_dict(jobs_dict, &format!("{}:cancelled_at", job_id), Into::<u64>::into(runtime::get_blocktime()));
}

#[no_mangle]
pub extern "C" fn close_session() {
    let caller = runtime::get_caller();
    let session_id: String = runtime::get_named_arg("session_id");
    let jobs_dict = get_dict(JOBS_DICT);

    let consumer: AccountHash = read_dict(jobs_dict, &format!("{}:consumer", session_id))
        .unwrap_or_revert_with(ApiError::User(2));
    if consumer != caller {
        runtime::revert(ApiError::User(3));
    }

    let state: u8 = read_dict(jobs_dict, &format!("{}:state", session_id))
        .unwrap_or(STATE_REFUNDED);
    if state == STATE_SETTLED || state == STATE_REFUNDED {
        runtime::revert(ApiError::User(4));
    }

    write_dict(jobs_dict, &format!("{}:state", session_id), STATE_SETTLED);
    write_dict(jobs_dict, &format!("{}:closed_at", session_id), Into::<u64>::into(runtime::get_blocktime()));
}

// ============ RATE PROVIDER ============

#[no_mangle]
pub extern "C" fn rate_provider() {
    let caller = runtime::get_caller();
    let file_id: String = runtime::get_named_arg("file_id");
    let session_id: String = runtime::get_named_arg("session_id");
    let agreement_id: String = runtime::get_named_arg("agreement_id");
    let rating: u64 = runtime::get_named_arg("rating");
    let jobs_dict = get_dict(JOBS_DICT);

    let ref_id = if !file_id.is_empty() { file_id }
        else if !session_id.is_empty() { session_id }
        else { agreement_id };

    let consumer: AccountHash = read_dict(jobs_dict, &format!("{}:consumer", ref_id))
        .unwrap_or_revert_with(ApiError::User(2));
    if consumer != caller {
        runtime::revert(ApiError::User(3));
    }

    write_dict(jobs_dict, &format!("{}:provider_rating", ref_id), rating);
    write_dict(jobs_dict, &format!("{}:rated_at", ref_id), Into::<u64>::into(runtime::get_blocktime()));
}

// ============ DISPUTE ENTRY POINTS ============

#[no_mangle]
pub extern "C" fn dispute_session() {
    let caller = runtime::get_caller();
    let session_id: String = runtime::get_named_arg("session_id");
    let evidence_hash: String = runtime::get_named_arg("evidence_hash");
    let jobs_dict = get_dict(JOBS_DICT);

    let consumer: AccountHash = read_dict(jobs_dict, &format!("{}:consumer", session_id))
        .unwrap_or_revert_with(ApiError::User(2));
    if consumer != caller {
        runtime::revert(ApiError::User(3));
    }

    let state: u8 = read_dict(jobs_dict, &format!("{}:state", session_id))
        .unwrap_or(STATE_REFUNDED);
    if state == STATE_REFUNDED || state == STATE_SETTLED {
        runtime::revert(ApiError::User(4));
    }

    write_dict(jobs_dict, &format!("{}:state", session_id), STATE_DISPUTED);
    write_dict(jobs_dict, &format!("{}:evidence_hash", session_id), evidence_hash);
    write_dict(jobs_dict, &format!("{}:dispute_initiator", session_id), caller);
    write_dict(jobs_dict, &format!("{}:dispute_timestamp", session_id), Into::<u64>::into(runtime::get_blocktime()));
}

#[no_mangle]
pub extern "C" fn dispute_file() {
    let caller = runtime::get_caller();
    let file_id: String = runtime::get_named_arg("file_id");
    let evidence_hash: String = runtime::get_named_arg("evidence_hash");
    let jobs_dict = get_dict(JOBS_DICT);

    let consumer: AccountHash = read_dict(jobs_dict, &format!("{}:consumer", file_id))
        .unwrap_or_revert_with(ApiError::User(2));
    if consumer != caller {
        runtime::revert(ApiError::User(3));
    }

    let state: u8 = read_dict(jobs_dict, &format!("{}:state", file_id))
        .unwrap_or(STATE_REFUNDED);
    if state == STATE_REFUNDED || state == STATE_SETTLED {
        runtime::revert(ApiError::User(4));
    }

    write_dict(jobs_dict, &format!("{}:state", file_id), STATE_DISPUTED);
    write_dict(jobs_dict, &format!("{}:evidence_hash", file_id), evidence_hash);
    write_dict(jobs_dict, &format!("{}:dispute_initiator", file_id), caller);
    write_dict(jobs_dict, &format!("{}:dispute_timestamp", file_id), Into::<u64>::into(runtime::get_blocktime()));
}

#[no_mangle]
pub extern "C" fn dispute_agreement() {
    let caller = runtime::get_caller();
    let agreement_id: String = runtime::get_named_arg("agreement_id");
    let evidence_hash: String = runtime::get_named_arg("evidence_hash");
    let jobs_dict = get_dict(JOBS_DICT);

    let consumer: AccountHash = read_dict(jobs_dict, &format!("{}:consumer", agreement_id))
        .unwrap_or_revert_with(ApiError::User(2));
    if consumer != caller {
        runtime::revert(ApiError::User(3));
    }

    let state: u8 = read_dict(jobs_dict, &format!("{}:state", agreement_id))
        .unwrap_or(STATE_REFUNDED);
    if state == STATE_REFUNDED || state == STATE_SETTLED {
        runtime::revert(ApiError::User(4));
    }

    write_dict(jobs_dict, &format!("{}:state", agreement_id), STATE_DISPUTED);
    write_dict(jobs_dict, &format!("{}:evidence_hash", agreement_id), evidence_hash);
    write_dict(jobs_dict, &format!("{}:dispute_initiator", agreement_id), caller);
    write_dict(jobs_dict, &format!("{}:dispute_timestamp", agreement_id), Into::<u64>::into(runtime::get_blocktime()));
}

#[no_mangle]
pub extern "C" fn get_job() {
    let job_id: String = runtime::get_named_arg("job_id");
    let jobs_dict = get_dict(JOBS_DICT);

    let consumer: AccountHash = read_dict(jobs_dict, &format!("{}:consumer", job_id))
        .unwrap_or_revert_with(ApiError::User(2));
    let provider: AccountHash = read_dict(jobs_dict, &format!("{}:provider", job_id))
        .unwrap_or_default();
    let amount: U512 = read_dict(jobs_dict, &format!("{}:amount", job_id))
        .unwrap_or_default();
    let state: u8 = read_dict(jobs_dict, &format!("{}:state", job_id))
        .unwrap_or(STATE_REFUNDED);
    let valid_until: u64 = read_dict(jobs_dict, &format!("{}:valid_until", job_id))
        .unwrap_or_default();
    let created_at: u64 = read_dict(jobs_dict, &format!("{}:created_at", job_id))
        .unwrap_or_default();

    let state_str = match state {
        0 => "pending",
        1 => "assigned",
        2 => "in_progress",
        3 => "provider_done",
        4 => "consumer_confirm",
        5 => "settled",
        6 => "refunded",
        7 => "disputed",
        8 => "consumer_won",
        9 => "provider_won",
        _ => "unknown",
    };

    let result = format!(
        "job_id={}&consumer={}&provider={}&amount={}&state={}&valid_until={}&created_at={}",
        job_id,
        consumer.to_string(),
        provider.to_string(),
        amount.to_string(),
        state_str,
        valid_until,
        created_at,
    );
    runtime::ret(CLValue::from_t(result).unwrap_or_revert());
}

#[no_mangle]
pub extern "C" fn call() {
    let compute_registry_hash: [u8; 32] = runtime::get_named_arg("compute_registry");
    let compute_registry: casper_types::HashAddr = compute_registry_hash;
    let reputation: AccountHash = runtime::get_named_arg("reputation");
    let owner: AccountHash = runtime::get_named_arg("owner");
    let protocol_fee_recipient: AccountHash = runtime::get_named_arg("protocol_fee_recipient");
    let contract_name: String = runtime::get_named_arg("contract_name");

    let dict_keys = [
        "ev2_jobs",
        "ev2_job_id_to_address",
        "ev2_consumer_jobs",
        "ev2_provider_jobs",
        "ev2_pending_jobs",
        "ev2_challenges",
        "ev4_jobs",
        "ev4_job_id_to_address",
        "ev4_consumer_jobs",
        "ev4_provider_jobs",
        "ev4_pending_jobs",
        "ev4_challenges",
        "escrow_vault",
        "escrow_vault_hash",
        "escrow_vault_package",
        "escrow_vault_v2",
        "escrow_vault_v2_hash",
        "escrow_vault_v2_package",
        "inference_market",
        "inference_market_hash",
        "inference_market_package",
        "storage_market",
        "storage_market_hash",
        "storage_market_package",
        "compute_market",
        "compute_market_hash",
        "compute_market_package",
        "bandwidth_market",
        "bandwidth_market_hash",
        "bandwidth_market_package",
        "compute_registry",
        "reputation",
        "owner",
        "protocol_fee_recipient",
        "protocol_fees",
        "contract_purse",
        "contract_purse_add",
        "protocol_fee_bps",
    ];
    for key in dict_keys.iter() {
        if runtime::has_key(key) {
            runtime::remove_key(key);
        }
    }
    // Clean up any existing keys for this specific contract_name
    let hash_key_name = format!("{}_hash", contract_name);
    let package_key_name = format!("{}_package", contract_name);
    if runtime::has_key(&hash_key_name) {
        runtime::remove_key(&hash_key_name);
    }
    if runtime::has_key(&package_key_name) {
        runtime::remove_key(&package_key_name);
    }
    if runtime::has_key(&contract_name) {
        runtime::remove_key(&contract_name);
    }

    let mut named_keys = NamedKeys::new();
    named_keys.insert(COMPUTE_REGISTRY.to_string(), Key::Hash(compute_registry));
    named_keys.insert(REPUTATION.to_string(), Key::Account(reputation));
    named_keys.insert(OWNER.to_string(), Key::Account(owner));
    named_keys.insert(PROTOCOL_FEE_RECIPIENT.to_string(), Key::Account(protocol_fee_recipient));
    named_keys.insert(PROTOCOL_FEES.to_string(), storage::new_uref(U512::from(0)).into());

    let contract_purse = system::create_purse();
    named_keys.insert(CONTRACT_PURSE.to_string(), contract_purse.into());
    let add_only_purse = URef::new(contract_purse.addr(), AccessRights::ADD);
    named_keys.insert("contract_purse_add".to_string(), add_only_purse.into());

    named_keys.insert(JOBS_DICT.to_string(), storage::new_dictionary("ev4_jobs").unwrap_or_revert().into());
    named_keys.insert(JOB_ID_TO_ADDRESS.to_string(), storage::new_dictionary("ev4_job_id_to_address").unwrap_or_revert().into());
    named_keys.insert(CONSUMER_JOBS.to_string(), storage::new_dictionary("ev4_consumer_jobs").unwrap_or_revert().into());
    named_keys.insert(PROVIDER_JOBS.to_string(), storage::new_dictionary("ev4_provider_jobs").unwrap_or_revert().into());
    named_keys.insert(PENDING_JOBS.to_string(), storage::new_dictionary("ev4_pending_jobs").unwrap_or_revert().into());
    named_keys.insert(CHALLENGES_DICT.to_string(), storage::new_dictionary("ev4_challenges").unwrap_or_revert().into());
    named_keys.insert(PROTOCOL_FEE_BPS.to_string(), storage::new_uref(0u64).into());

    let hash_name = format!("{}_hash", contract_name);
    let (contract_hash, _) = storage::new_contract(
        create_entry_points(),
        Some(named_keys),
        Some(contract_name.clone()),
        Some(hash_name.clone()),
        None,
    );
    runtime::put_key(&hash_name, contract_hash.into());
}
