//! Production license client.
//!
//! The desktop app treats the control plane as the authority. It keeps the
//! device signing key in the OS keychain and only accepts leases whose
//! Ed25519 signature, device binding, and offline expiry all verify locally.
//! The old checksum validator remains available only through the explicit
//! `validate_license_dev` command for local development.

use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
use chrono::{DateTime, Duration, Utc};
use ed25519_dalek::{Signature, Signer, SigningKey, Verifier, VerifyingKey};
use keyring::{Entry, Error as KeyringError};
use rand_core::{OsRng, RngCore};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::collections::BTreeMap;

const KEYCHAIN_SERVICE: &str = "com.reportmaker.app.license";
const DEVICE_KEY_USER: &str = "device-ed25519-v1";
const LEASE_USER: &str = "signed-lease-v1";
const ACTIVATION_USER: &str = "activation-id-v1";
const DEFAULT_CONTROL_PLANE_URL: &str = "https://control.reportmaker.app";
// Set this at release time; keeping it out of source prevents a private key
// from accidentally being bundled with the application.
const VERIFYING_KEY_B64: Option<&str> = option_env!("REPORT_MAKER_LICENSE_PUBLIC_KEY");

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Lease {
    pub lease_version: u32,
    pub key_id: String,
    pub license_id: String,
    pub activation_id: String,
    pub device_public_key: String,
    pub plan: String,
    pub features: BTreeMap<String, bool>,
    pub issued_at: String,
    pub offline_until: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct SignedLeaseResponse {
    activation_id: String,
    lease: Lease,
    signature: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DeviceIdentity {
    pub public_key: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LicenseStatus {
    pub valid: bool,
    #[serde(default)]
    pub key: String,
    pub reason: String,
    pub activation_id: Option<String>,
    pub lease: Option<Lease>,
    pub signature: Option<String>,
    /// Base64url canonical lease bytes used in authenticated control-plane headers.
    pub lease_encoded: Option<String>,
    pub device_public_key: Option<String>,
    pub checked_at: String,
    /// True only for the development checksum compatibility path.
    pub dev: bool,
}

fn now_string() -> String {
    Utc::now().to_rfc3339()
}

fn keyring_entry(user: &str) -> Result<Entry, String> {
    Entry::new(KEYCHAIN_SERVICE, user).map_err(|e| format!("OS keychain unavailable: {e}"))
}

fn load_signing_key() -> Result<SigningKey, String> {
    let entry = keyring_entry(DEVICE_KEY_USER)?;
    match entry.get_password() {
        Ok(encoded) => {
            let bytes = URL_SAFE_NO_PAD
                .decode(encoded)
                .map_err(|_| "Stored device key is corrupt.".to_string())?;
            let bytes: [u8; 32] = bytes
                .try_into()
                .map_err(|_| "Stored device key has an invalid length.".to_string())?;
            Ok(SigningKey::from_bytes(&bytes))
        }
        Err(KeyringError::NoEntry) => {
            let signing = SigningKey::generate(&mut OsRng);
            entry
                .set_password(&URL_SAFE_NO_PAD.encode(signing.to_bytes()))
                .map_err(|e| format!("Unable to store device key in OS keychain: {e}"))?;
            Ok(signing)
        }
        Err(error) => Err(format!("Unable to read device key from OS keychain: {error}")),
    }
}

fn device_identity() -> Result<DeviceIdentity, String> {
    let signing = load_signing_key()?;
    Ok(DeviceIdentity {
        public_key: URL_SAFE_NO_PAD.encode(signing.verifying_key().to_bytes()),
    })
}

fn lease_entry() -> Result<Entry, String> {
    keyring_entry(LEASE_USER)
}

fn activation_entry() -> Result<Entry, String> {
    keyring_entry(ACTIVATION_USER)
}

fn save_signed_lease(response: &SignedLeaseResponse) -> Result<(), String> {
    lease_entry()?
        .set_password(
            &serde_json::to_string(response)
                .map_err(|e| format!("Unable to serialize signed lease: {e}"))?,
        )
        .map_err(|e| format!("Unable to store signed lease: {e}"))?;
    activation_entry()?
        .set_password(&response.activation_id)
        .map_err(|e| format!("Unable to store activation id: {e}"))
}

fn load_signed_lease() -> Result<Option<SignedLeaseResponse>, String> {
    match lease_entry()?.get_password() {
        Ok(raw) => serde_json::from_str(&raw)
            .map(Some)
            .map_err(|e| format!("Stored signed lease is corrupt: {e}")),
        Err(_) => Ok(None),
    }
}

fn clear_signed_lease() -> Result<(), String> {
    let _ = lease_entry()?.delete_credential();
    let _ = activation_entry()?.delete_credential();
    Ok(())
}

fn canonical_value(value: &Value) -> Value {
    match value {
        Value::Object(object) => {
            let sorted: BTreeMap<String, Value> = object
                .iter()
                .map(|(key, value)| (key.clone(), canonical_value(value)))
                .collect();
            serde_json::to_value(sorted).expect("JSON values are serializable")
        }
        Value::Array(items) => Value::Array(items.iter().map(canonical_value).collect()),
        other => other.clone(),
    }
}

fn canonical_json_bytes(value: &Value) -> Result<Vec<u8>, String> {
    serde_json::to_vec(&canonical_value(value))
        .map_err(|e| format!("Unable to canonicalize JSON: {e}"))
}

fn canonical_lease(lease: &Lease) -> Result<Vec<u8>, String> {
    let value = serde_json::to_value(lease).map_err(|e| format!("Unable to canonicalize lease: {e}"))?;
    canonical_json_bytes(&value)
}

fn lease_encoded(lease: &Lease) -> Result<String, String> {
    Ok(URL_SAFE_NO_PAD.encode(canonical_lease(lease)?))
}

fn request_id() -> String {
    let mut bytes = [0u8; 16];
    OsRng.fill_bytes(&mut bytes);
    URL_SAFE_NO_PAD.encode(bytes)
}

fn sign_device_payload(payload: Value) -> Result<String, String> {
    let signing = load_signing_key()?;
    let bytes = canonical_json_bytes(&payload)?;
    Ok(URL_SAFE_NO_PAD.encode(signing.sign(&bytes).to_bytes()))
}

fn verifying_key() -> Result<VerifyingKey, String> {
    let encoded = VERIFYING_KEY_B64.ok_or_else(|| {
        "License verification key is not configured in this build.".to_string()
    })?;
    let bytes = URL_SAFE_NO_PAD
        .decode(encoded)
        .map_err(|_| "Configured license verification key is invalid.".to_string())?;
    let bytes: [u8; 32] = bytes
        .try_into()
        .map_err(|_| "Configured license verification key has an invalid length.".to_string())?;
    VerifyingKey::from_bytes(&bytes).map_err(|_| "Configured license verification key is invalid.".to_string())
}

fn verify_signed_lease(response: &SignedLeaseResponse, expected_device: &str) -> Result<(), String> {
    let signature_bytes = URL_SAFE_NO_PAD
        .decode(&response.signature)
        .map_err(|_| "Lease signature is not valid base64url.".to_string())?;
    let signature = Signature::from_slice(&signature_bytes)
        .map_err(|_| "Lease signature has an invalid length.".to_string())?;
    verifying_key()?
        .verify(&canonical_lease(&response.lease)?, &signature)
        .map_err(|_| "Lease signature verification failed.".to_string())?;
    if response.lease.device_public_key != expected_device {
        return Err("Lease belongs to a different device.".to_string());
    }
    let until = DateTime::parse_from_rfc3339(&response.lease.offline_until)
        .map_err(|_| "Lease expiry is not a valid RFC3339 timestamp.".to_string())?
        .with_timezone(&Utc);
    let issued = DateTime::parse_from_rfc3339(&response.lease.issued_at)
        .map_err(|_| "Lease issue time is not a valid RFC3339 timestamp.".to_string())?
        .with_timezone(&Utc);
    if issued > Utc::now() + Duration::minutes(5) {
        return Err("Lease issue time is in the future.".to_string());
    }
    if until <= Utc::now() {
        return Err("Offline lease expired — refresh while online.".to_string());
    }
    Ok(())
}

fn status_from_response(response: &SignedLeaseResponse, key: String) -> LicenseStatus {
    let device_public_key = device_identity().ok().map(|d| d.public_key);
    match device_public_key {
        Some(device) => match verify_signed_lease(response, &device) {
            Ok(()) => LicenseStatus {
                valid: true,
                key,
                reason: "Signed lease verified for this device.".into(),
                activation_id: Some(response.activation_id.clone()),
                lease: Some(response.lease.clone()),
                signature: Some(response.signature.clone()),
                lease_encoded: lease_encoded(&response.lease).ok(),
                device_public_key: Some(device),
                checked_at: now_string(),
                dev: false,
            },
            Err(reason) => LicenseStatus {
                valid: false,
                key,
                reason,
                activation_id: Some(response.activation_id.clone()),
                lease: Some(response.lease.clone()),
                signature: Some(response.signature.clone()),
                lease_encoded: lease_encoded(&response.lease).ok(),
                device_public_key: Some(device),
                checked_at: now_string(),
                dev: false,
            },
        },
        None => LicenseStatus {
            valid: false,
            key,
            reason: "Unable to access this device's keychain key.".into(),
            activation_id: Some(response.activation_id.clone()),
            lease: Some(response.lease.clone()),
            signature: Some(response.signature.clone()),
            lease_encoded: lease_encoded(&response.lease).ok(),
            device_public_key: None,
            checked_at: now_string(),
            dev: false,
        },
    }
}

fn current_status() -> Result<LicenseStatus, String> {
    let Some(response) = load_signed_lease()? else {
        return Ok(LicenseStatus {
            valid: false,
            key: String::new(),
            reason: "No activated device.".into(),
            activation_id: None,
            lease: None,
            signature: None,
            lease_encoded: None,
            device_public_key: Some(device_identity()?.public_key),
            checked_at: now_string(),
            dev: false,
        });
    };
    Ok(status_from_response(&response, String::new()))
}

fn control_plane_url() -> String {
    option_env!("REPORT_MAKER_CONTROL_PLANE_URL")
        .unwrap_or(DEFAULT_CONTROL_PLANE_URL)
        .trim_end_matches('/')
        .to_string()
}

fn platform() -> &'static str {
    if cfg!(target_os = "macos") {
        "macos"
    } else if cfg!(target_os = "windows") {
        "windows"
    } else if cfg!(target_os = "linux") {
        "linux"
    } else {
        "other"
    }
}

async fn post_json<T: Serialize>(path: &str, body: &T) -> Result<SignedLeaseResponse, String> {
    let response = reqwest::Client::new()
        .post(format!("{}{}", control_plane_url(), path))
        .json(body)
        .send()
        .await
        .map_err(|e| format!("Control plane request failed: {e}"))?;
    let status = response.status();
    let value: Value = response
        .json()
        .await
        .map_err(|e| format!("Control plane returned invalid JSON: {e}"))?;
    if !status.is_success() {
        let message = value
            .pointer("/error/message")
            .and_then(Value::as_str)
            .unwrap_or("Control plane rejected the request.");
        return Err(message.to_string());
    }
    serde_json::from_value(value).map_err(|e| format!("Control plane lease response is invalid: {e}"))
}

#[derive(Serialize)]
struct ActivationRequest {
    license_key: String,
    device_public_key: String,
    app_version: String,
    platform: &'static str,
    device_proof: String,
}

#[derive(Serialize)]
struct RefreshRequest {
    device_signature: String,
    request_id: String,
    requested_at: String,
}

#[derive(Serialize)]
struct RevokeRequest {
    device_signature: String,
    request_id: String,
}

#[tauri::command]
pub fn device_identity_command() -> Result<DeviceIdentity, String> {
    device_identity()
}

#[tauri::command]
pub fn license_status() -> Result<LicenseStatus, String> {
    current_status()
}

#[tauri::command]
pub fn get_control_plane_url() -> String {
    control_plane_url()
}

#[tauri::command]
pub fn sign_control_plane_request(
    action: String,
    activation_id: String,
    request_id: String,
    payload_hash: String,
) -> Result<String, String> {
    sign_device_payload(serde_json::json!({
        "action": action,
        "activation_id": activation_id,
        "request_id": request_id,
        "payload_hash": payload_hash,
    }))
}

#[tauri::command]
pub async fn activate_license(license_key: String) -> Result<LicenseStatus, String> {
    let key = license_key.trim().to_string();
    if key.is_empty() {
        return Err("Enter a license key.".into());
    }
    let identity = device_identity()?;
    let app_version = env!("CARGO_PKG_VERSION").to_string();
    let platform = platform();
    let proof = serde_json::json!({
        "action": "activate",
        "license_key_hash": Sha256::digest(key.as_bytes()).iter().map(|byte| format!("{byte:02x}")).collect::<String>(),
        "device_public_key": identity.public_key,
        "app_version": app_version,
        "platform": platform,
    });
    let response = post_json(
        "/v1/activations",
        &ActivationRequest {
            license_key: key.clone(),
            device_public_key: identity.public_key,
            app_version,
            platform,
            device_proof: sign_device_payload(proof)?,
        },
    )
    .await?;
    verify_signed_lease(&response, &device_identity()?.public_key)?;
    save_signed_lease(&response)?;
    Ok(status_from_response(&response, key))
}

#[tauri::command]
pub async fn refresh_license() -> Result<LicenseStatus, String> {
    let response = load_signed_lease()?.ok_or_else(|| "No activated device.".to_string())?;
    let path = format!("/v1/activations/{}/refresh", response.activation_id);
    let id = request_id();
    let requested_at = now_string();
    let proof = serde_json::json!({
        "action": "refresh",
        "activation_id": response.activation_id,
        "request_id": id,
        "requested_at": requested_at,
    });
    let refreshed = post_json(&path, &RefreshRequest {
        device_signature: sign_device_payload(proof)?,
        request_id: id,
        requested_at,
    }).await?;
    verify_signed_lease(&refreshed, &device_identity()?.public_key)?;
    save_signed_lease(&refreshed)?;
    Ok(status_from_response(&refreshed, String::new()))
}

#[tauri::command]
pub async fn deactivate_license() -> Result<LicenseStatus, String> {
    let response = load_signed_lease()?.ok_or_else(|| "No activated device.".to_string())?;
    let id = request_id();
    let proof = serde_json::json!({
        "action": "revoke",
        "activation_id": response.activation_id,
        "request_id": id,
    });
    let result = reqwest::Client::new()
        .delete(format!("{}/v1/activations/{}", control_plane_url(), response.activation_id))
        .json(&RevokeRequest { device_signature: sign_device_payload(proof)?, request_id: id })
        .send()
        .await
        .map_err(|e| format!("Control plane request failed: {e}"))?;
    if !result.status().is_success() && result.status().as_u16() != 404 {
        return Err(format!("Control plane rejected deactivation (HTTP {}).", result.status()));
    }
    clear_signed_lease()?;
    current_status()
}

/// Development-only compatibility validator. Production activation never calls it.
#[derive(Serialize)]
pub struct DevLicenseStatus {
    pub valid: bool,
    pub key: String,
    pub reason: String,
}

fn char_value(c: char) -> Option<u32> {
    if c.is_ascii_digit() {
        Some(c as u32 - '0' as u32)
    } else if c.is_ascii_uppercase() {
        Some(c as u32 - 'A' as u32 + 10)
    } else {
        None
    }
}

pub fn check_key(key: &str) -> DevLicenseStatus {
    let k = key.trim().to_uppercase();
    let parts: Vec<&str> = k.split('-').collect();
    if parts.len() != 4 || parts[0] != "RM" {
        return DevLicenseStatus { valid: false, key: k, reason: "Expected format RM-XXXX-XXXX-XXXX.".into() };
    }
    let payload: String = parts[1..].concat();
    if payload.len() != 12 || !payload.chars().all(|c| c.is_ascii_alphanumeric()) {
        return DevLicenseStatus { valid: false, key: k, reason: "Payload must be 12 A-Z0-9 chars.".into() };
    }
    let sum: u32 = payload.chars().filter_map(char_value).sum();
    if sum % 36 != 0 {
        return DevLicenseStatus { valid: false, key: k, reason: "Checksum mismatch.".into() };
    }
    DevLicenseStatus { valid: true, key: k, reason: "Valid development checksum key.".into() }
}

#[tauri::command]
pub fn validate_license_dev(key: String) -> DevLicenseStatus {
    check_key(&key)
}

#[cfg(test)]
mod tests {
    use super::*;
    use ed25519_dalek::Signer;

    #[test]
    fn canonical_lease_is_stable_and_device_bound() {
        let lease = Lease {
            lease_version: 1,
            key_id: "lease-dev-1".into(),
            license_id: "lic_1".into(),
            activation_id: "act_1".into(),
            device_public_key: "device".into(),
            plan: "perpetual".into(),
            features: BTreeMap::from([("core_export".into(), true), ("hosted_ai".into(), false)]),
            issued_at: "2026-10-03T00:00:00Z".into(),
            offline_until: "2099-10-03T00:00:00Z".into(),
        };
        let bytes = canonical_lease(&lease).unwrap();
        assert_eq!(String::from_utf8(bytes).unwrap(), r#"{"activation_id":"act_1","device_public_key":"device","features":{"core_export":true,"hosted_ai":false},"issued_at":"2026-10-03T00:00:00Z","key_id":"lease-dev-1","lease_version":1,"license_id":"lic_1","offline_until":"2099-10-03T00:00:00Z","plan":"perpetual"}"#);
    }

    #[test]
    fn development_checksum_is_explicit() {
        assert!(check_key("RM-0000-0000-0000").valid);
        assert!(!check_key("RM-AAAA-AAAA-AAAB").valid);
    }

    #[test]
    fn signing_key_round_trip_and_signature_verify() {
        let signing = SigningKey::generate(&mut OsRng);
        let message = b"lease";
        let signature = signing.sign(message);
        signing.verifying_key().verify(message, &signature).unwrap();
    }
}
