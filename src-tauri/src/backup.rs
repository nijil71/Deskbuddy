// Safety net for the buddy's long-term memory (deskbud.json: notes, mood, days together, activity,
// settings). On every start, before anything reads it:
//   • if it's healthy, keep one copy per day in backups\ (last 7 days)
//   • if it's missing, empty or corrupt, put back the newest healthy backup
// Runs before the store plugin loads the file, so a restore is picked up immediately.

use std::path::{Path, PathBuf};

const KEEP: usize = 7;

fn data_dir() -> Option<PathBuf> {
    Some(PathBuf::from(std::env::var_os("APPDATA")?).join("com.deskbud.app"))
}

/// A store file worth keeping: parses as a JSON object with something in it.
fn healthy(path: &Path) -> bool {
    std::fs::read(path)
        .ok()
        .and_then(|b| serde_json::from_slice::<serde_json::Value>(&b).ok())
        .is_some_and(|v| v.as_object().is_some_and(|o| !o.is_empty()))
}

/// "2026-11-25" (UTC; only used for one-backup-per-day file names).
fn today() -> String {
    let days = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_secs() / 86_400).unwrap_or(0) as i64;
    // civil-from-days (Howard Hinnant)
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let y = yoe + era * 400 + if m <= 2 { 1 } else { 0 };
    format!("{y:04}-{m:02}-{d:02}")
}

pub fn run() {
    if let Some(dir) = data_dir() {
        let _ = protect(&dir, &today());
    }
}

/// Returns what happened, for tests/logging.
fn protect(dir: &Path, day: &str) -> std::io::Result<&'static str> {
    let file = dir.join("deskbud.json");
    let backups = dir.join("backups");
    if healthy(&file) {
        std::fs::create_dir_all(&backups)?;
        let today = backups.join(format!("deskbud-{day}.json"));
        if !today.exists() {
            std::fs::copy(&file, &today)?;
        }
        // keep the newest KEEP (names sort by date)
        let mut all: Vec<PathBuf> = list(&backups);
        all.sort();
        let excess = all.len().saturating_sub(KEEP);
        for old in &all[..excess] {
            let _ = std::fs::remove_file(old);
        }
        return Ok("backed up");
    }
    // Missing or broken: restore the newest healthy backup (keep the broken file for inspection).
    let mut all = list(&backups);
    all.sort();
    let Some(good) = all.iter().rev().find(|p| healthy(p)) else { return Ok("nothing to restore") };
    if file.exists() {
        let _ = std::fs::rename(&file, dir.join("deskbud.json.broken"));
    }
    std::fs::copy(good, &file)?;
    Ok("restored")
}

fn list(dir: &Path) -> Vec<PathBuf> {
    std::fs::read_dir(dir)
        .map(|rd| rd.flatten().map(|e| e.path()).filter(|p| p.file_name().is_some_and(|n| n.to_string_lossy().starts_with("deskbud-"))).collect())
        .unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn backs_up_daily_keeps_seven_and_restores() {
        let dir = std::env::temp_dir().join("deskbud-backup-test");
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let file = dir.join("deskbud.json");

        assert_eq!(protect(&dir, "2026-01-01").unwrap(), "nothing to restore"); // first run ever
        std::fs::write(&file, r#"{"notes":[{"text":"day 1"}]}"#).unwrap();
        for d in 1..=9 {
            std::fs::write(&file, format!(r#"{{"notes":[{{"text":"day {d}"}}]}}"#)).unwrap();
            assert_eq!(protect(&dir, &format!("2026-01-{d:02}")).unwrap(), "backed up");
        }
        assert_eq!(list(&dir.join("backups")).len(), 7);
        assert!(!dir.join("backups/deskbud-2026-01-02.json").exists());

        // corrupt → newest backup comes back, broken file kept aside
        std::fs::write(&file, "{ half-writ").unwrap();
        assert_eq!(protect(&dir, "2026-01-10").unwrap(), "restored");
        assert!(std::fs::read_to_string(&file).unwrap().contains("day 9"));
        assert!(dir.join("deskbud.json.broken").exists());

        // deleted → restored too
        std::fs::remove_file(&file).unwrap();
        assert_eq!(protect(&dir, "2026-01-10").unwrap(), "restored");
        assert!(healthy(&file));
    }

    #[test]
    fn date_names() {
        assert_eq!(today().len(), 10);
        assert!(today().starts_with("20"));
    }
}
