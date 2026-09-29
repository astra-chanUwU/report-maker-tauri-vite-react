//! S09 license validation (placeholder checksum — see docs/licensing.md).
//! Format: RM-XXXX-XXXX-XXXX, A-Z0-9, sum(values) % 36 == 0.

use serde::Serialize;

#[derive(Serialize)]
pub struct LicenseStatus {
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

pub fn check_key(key: &str) -> LicenseStatus {
    let k = key.trim().to_uppercase();
    let parts: Vec<&str> = k.split('-').collect();
    if parts.len() != 4 || parts[0] != "RM" {
        return LicenseStatus {
            valid: false,
            key: k,
            reason: "Expected format RM-XXXX-XXXX-XXXX.".into(),
        };
    }
    let payload: String = parts[1..].concat();
    if payload.len() != 12 || !payload.chars().all(|c| c.is_ascii_alphanumeric()) {
        return LicenseStatus {
            valid: false,
            key: k,
            reason: "Payload must be 12 A-Z0-9 chars.".into(),
        };
    }
    let sum: u32 = payload.chars().filter_map(char_value).sum();
    if sum % 36 != 0 {
        return LicenseStatus {
            valid: false,
            key: k,
            reason: "Checksum mismatch.".into(),
        };
    }
    LicenseStatus {
        valid: true,
        key: k,
        reason: "Valid perpetual key (v1 checksum).".into(),
    }
}

#[tauri::command]
pub fn validate_license(key: String) -> LicenseStatus {
    check_key(&key)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accepts_known_good_key() {
        // AAAA... sum = 10*12 = 120, 120 % 36 = 12 -> invalid; use zeros: sum 0 -> valid
        let s = check_key("RM-0000-0000-0000");
        assert!(s.valid);
    }

    #[test]
    fn rejects_bad_format() {
        assert!(!check_key("hello").valid);
        assert!(!check_key("RM-AAAA-AAAA-AAAB").valid);
    }
}
