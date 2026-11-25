// Local self-update: `npm run release` builds a new installer and copies it into <project>/releases;
// the running buddy notices the higher version and offers to install it. No server, no signing —
// the folder is baked in at compile time (independent of where Cargo keeps its build cache).

use serde::Serialize;
use std::os::windows::process::CommandExt;
use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime};

const BUNDLE_DIR: &str = concat!(env!("CARGO_MANIFEST_DIR"), "\\..\\releases");

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct LocalUpdate {
    pub version: String,
    pub current: String,
    pub path: String,
}

/// "1.2.3" → (1, 2, 3); ignores any pre-release suffix.
fn ver(s: &str) -> Option<(u64, u64, u64)> {
    let mut it = s.split(['-', '+']).next()?.split('.').map(|p| p.parse::<u64>().ok());
    Some((it.next()??, it.next().flatten().unwrap_or(0), it.next().flatten().unwrap_or(0)))
}

/// `Deskbud_1.0.3_x64-setup.exe` → "1.0.3"
fn installer_version(name: &str) -> Option<&str> {
    let rest = name.strip_suffix("-setup.exe")?;
    let mut parts = rest.split('_');
    parts.next()?; // product name
    let v = parts.next()?;
    ver(v).map(|_| v)
}

pub fn find(current: &str) -> Option<LocalUpdate> {
    find_in(Path::new(BUNDLE_DIR), current)
}

fn find_in(dir: &Path, current: &str) -> Option<LocalUpdate> {
    let cur = ver(current)?;
    let mut best: Option<((u64, u64, u64), String, PathBuf)> = None;
    for e in std::fs::read_dir(dir).ok()?.flatten() {
        let name = e.file_name().to_string_lossy().into_owned();
        let Some(v) = installer_version(&name) else { continue };
        let Some(vt) = ver(v) else { continue };
        if vt <= cur || best.as_ref().is_some_and(|b| vt <= b.0) {
            continue;
        }
        // Skip an installer that's still being written by a build in progress.
        let fresh = e.metadata().ok().and_then(|m| m.modified().ok())
            .and_then(|t| SystemTime::now().duration_since(t).ok())
            .is_none_or(|age| age < Duration::from_secs(10));
        if fresh {
            continue;
        }
        best = Some((vt, v.to_string(), e.path()));
    }
    best.map(|(_, version, path)| LocalUpdate { version, current: current.to_string(), path: path.to_string_lossy().into_owned() })
}

/// Run the installer the way tauri-plugin-updater does (passive UI, update mode, relaunch after).
/// The caller exits the app right after, so the installer can replace the exe.
pub fn launch_installer(path: &str) -> Result<(), String> {
    let p = Path::new(path);
    if !p.is_file() || installer_version(&p.file_name().unwrap_or_default().to_string_lossy()).is_none() {
        return Err("That installer is gone — rebuild and try again".into());
    }
    if !p.starts_with(BUNDLE_DIR) {
        return Err("Refusing to run an installer from outside the build folder".into());
    }
    const DETACHED_PROCESS: u32 = 0x0000_0008;
    std::process::Command::new(p)
        .args(["/P", "/UPDATE", "/R"])
        .creation_flags(DETACHED_PROCESS)
        .spawn()
        .map(|_| ())
        .map_err(|e| format!("Couldn't start the installer: {e}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_installer_names() {
        assert_eq!(installer_version("Deskbud_1.0.3_x64-setup.exe"), Some("1.0.3"));
        assert_eq!(installer_version("Deskbud_1.10.0_x64-setup.exe"), Some("1.10.0"));
        assert_eq!(installer_version("Deskbud_1.0.3_x64_en-US.msi"), None);
        assert_eq!(installer_version("random-setup.exe"), None);
        assert!(ver("1.10.0") > ver("1.9.9"));
    }

    #[test]
    fn picks_highest_newer_finished_installer() {
        let d = std::env::temp_dir().join("deskbud-update-test");
        let _ = std::fs::remove_dir_all(&d);
        std::fs::create_dir_all(&d).unwrap();
        let old = SystemTime::now() - Duration::from_secs(60);
        for n in ["Deskbud_1.0.0_x64-setup.exe", "Deskbud_1.0.2_x64-setup.exe", "Deskbud_1.0.10_x64-setup.exe", "Deskbud_1.0.11_x64-setup.exe"] {
            let f = std::fs::File::create(d.join(n)).unwrap();
            if n != "Deskbud_1.0.11_x64-setup.exe" { f.set_modified(old).unwrap(); } // 1.0.11 is "still building"
        }
        let u = find_in(&d, "1.0.1").unwrap();
        assert_eq!(u.version, "1.0.10");
        assert!(find_in(&d, "1.0.10").is_none());
        assert!(find_in(&d, "2.0.0").is_none());
    }
}
