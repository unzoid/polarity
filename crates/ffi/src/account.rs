//! What the Apple TV takes from the account's settings document (`profile_settings.data`, laid
//! out by `src/lib/account/settingsDoc.ts`): its add-ons, its TMDB key and the language of titles.
//! The app fetches the document with supabase-swift and hands the answer over as it came, so the
//! reading is here, tested with the rest of the core.

use serde_json::Value;

/// A profile's settings, as far as the Apple TV uses them.
#[derive(Debug, Clone, Default, PartialEq, uniffi::Record)]
pub struct AccountSettings {
    /// Add-on manifest links, in the order the other apps keep them (sorted, no repeats).
    pub addons: Vec<String>,
    pub tmdb_key: Option<String>,
    /// Settings → Browsing → "Titles and descriptions" (`en-US` when the profile never changed it).
    pub language: Option<String>,
    /// Keys and add-on links are sealed with a passphrase, which the TV doesn't ask for yet: then
    /// `addons` and `tmdb_key` are empty and the app says to set them up on another device.
    pub sealed: bool,
}

/// Reads the server's answer to `select data from profile_settings where profile_id = …`: a JSON
/// list of rows (none when the profile never saved a setting), or the document alone. Anything
/// that doesn't fit is left out, as the other apps do (critique M9).
#[uniffi::export]
pub fn account_settings(answer: String) -> AccountSettings {
    let Ok(value) = serde_json::from_str::<Value>(&answer) else { return AccountSettings::default() };
    let doc = match &value {
        Value::Array(rows) => rows.first().and_then(|r| r.get("data")),
        Value::Object(o) if o.contains_key("data") => o.get("data"),
        other => Some(other),
    };
    doc.map(read).unwrap_or_default()
}

fn read(doc: &Value) -> AccountSettings {
    let text =
        |v: Option<&Value>| v.and_then(Value::as_str).map(str::trim).filter(|s| !s.is_empty()).map(str::to_owned);
    let language = text(doc.pointer("/settings/language"));
    // A `sealed` field wins over a `secrets` one, as in settingsDoc.ts's fromWire.
    if doc.get("sealed").is_some_and(Value::is_string) {
        return AccountSettings { language, sealed: true, ..AccountSettings::default() };
    }
    let mut addons: Vec<String> = doc
        .pointer("/secrets/addons")
        .and_then(Value::as_array)
        .map(|list| list.iter().filter_map(|v| text(Some(v))).collect())
        .unwrap_or_default();
    addons.sort();
    addons.dedup();
    AccountSettings { addons, tmdb_key: text(doc.pointer("/secrets/keys/tmdbKey")), language, sealed: false }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_addons_key_and_language_from_a_row() {
        let answer = r#"[{"data": {
            "settings": {"language": "de-DE", "startPage": "library"},
            "keybinds": {}, "prefs": {},
            "secrets": {
                "keys": {"tmdbKey": "TOKEN", "omdbKey": "xxx"},
                "addons": ["https://addons.example.org/b/manifest.json", "https://addons.example.com/a/manifest.json",
                           "https://addons.example.org/b/manifest.json", 7, ""]
            }
        }}]"#;
        assert_eq!(
            account_settings(answer.into()),
            AccountSettings {
                addons: vec![
                    "https://addons.example.com/a/manifest.json".into(),
                    "https://addons.example.org/b/manifest.json".into()
                ],
                tmdb_key: Some("TOKEN".into()),
                language: Some("de-DE".into()),
                sealed: false,
            }
        );
    }

    #[test]
    fn a_profile_without_settings_has_none() {
        assert_eq!(account_settings("[]".into()), AccountSettings::default());
        assert_eq!(account_settings(r#"[{"data": null}]"#.into()), AccountSettings::default());
        assert_eq!(account_settings("not json".into()), AccountSettings::default());
    }

    #[test]
    fn sealed_keys_are_not_read() {
        let answer = r#"{"data": {"settings": {}, "sealed": "v1.xxx", "secrets": {"keys": {"tmdbKey": "TOKEN"}, "addons": ["https://addons.example.com/manifest.json"]}}}"#;
        assert_eq!(account_settings(answer.into()), AccountSettings { sealed: true, ..AccountSettings::default() });
    }

    #[test]
    fn keys_from_before_secrets_are_not_taken() {
        // Documents from before I-009 kept add-ons and keys among the settings.
        let doc = r#"{"settings": {"tmdbKey": "TOKEN", "addons": ["https://addons.example.com/manifest.json"]}}"#;
        assert_eq!(account_settings(doc.into()), AccountSettings::default());
    }

    #[test]
    fn a_blank_key_or_language_is_none() {
        let doc = r#"{"settings": {"language": " "}, "secrets": {"keys": {"tmdbKey": ""}, "addons": []}}"#;
        assert_eq!(account_settings(doc.into()), AccountSettings::default());
    }
}
