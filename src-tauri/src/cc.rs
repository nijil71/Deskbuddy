// Claude Code → buddy. Like clawd-on-desk / OpenPets: the buddy tells you when Claude finishes or
// needs you, so you can work in another window meanwhile.
//
// Claude Code hooks run `deskbud.exe --cc <prompt|stop|notify>` with the hook's JSON on stdin.
// That process never starts the app: it appends one line to claude-events.jsonl and exits
// (see main.rs). The running buddy tails the file and emits "claude-event" to the UI.
// No server, no port. "Connect Claude Code" in Settings adds the hooks to ~/.claude/settings.json.

use serde_json::{json, Value};
use std::io::{Read, Seek, SeekFrom, Write};
use std::path::{Path, PathBuf};
use std::time::Duration;
use tauri::{AppHandle, Emitter};

const EVENTS: &[(&str, &str)] = &[("UserPromptSubmit", "prompt"), ("Stop", "stop"), ("Notification", "notify")];

fn events_file() -> PathBuf {
    let base = std::env::var_os("APPDATA").map(PathBuf::from).unwrap_or_else(std::env::temp_dir);
    base.join("com.deskbud.app").join("claude-events.jsonl")
}

fn now_ms() -> u64 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0)
}

/// Hook mode: record the event and return. Never prints (Claude Code would show it).
pub fn hook_main(event: &str) {
    let mut raw = Vec::new();
    let _ = std::io::stdin().take(1 << 20).read_to_end(&mut raw);
    let line = event_line(event, &String::from_utf8_lossy(&raw), now_ms());
    let path = events_file();
    if let Some(dir) = path.parent() {
        let _ = std::fs::create_dir_all(dir);
    }
    if let Ok(mut f) = std::fs::OpenOptions::new().create(true).append(true).open(&path) {
        let _ = writeln!(f, "{line}");
    }
}

/// The one line we store per hook call. Only what the buddy shows: no prompts, no transcripts.
fn event_line(event: &str, input: &str, ts: u64) -> Value {
    let v: Value = serde_json::from_str(input.trim_start_matches('\u{feff}').trim()).unwrap_or(Value::Null);
    let project = v["cwd"].as_str().map(|c| project_name(Path::new(c))).unwrap_or_default();
    json!({
        "event": event,
        "project": project,
        "session": v["session_id"].as_str().unwrap_or(""),
        "message": v["message"].as_str().unwrap_or(""),
        "ts": ts,
    })
}

/// The repo's folder name (Claude's cwd moves into subfolders like src-tauri\target\debug);
/// falls back to the cwd's own name outside a git repo.
fn project_name(cwd: &Path) -> String {
    let root = cwd.ancestors().find(|d| d.join(".git").exists()).unwrap_or(cwd);
    root.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default()
}

/// Tail the events file and forward new lines to the UI.
pub fn worker(app: AppHandle) {
    std::thread::spawn(move || {
        let path = events_file();
        // Start at the end (old events are stale); trim the file if it has grown big.
        let mut pos = std::fs::metadata(&path).map(|m| m.len()).unwrap_or(0);
        if pos > 512 * 1024 {
            let _ = std::fs::write(&path, b"");
            pos = 0;
        }
        loop {
            std::thread::sleep(Duration::from_millis(400));
            let Ok(len) = std::fs::metadata(&path).map(|m| m.len()) else { continue };
            if len < pos {
                pos = 0; // truncated
            }
            if len == pos {
                continue;
            }
            let Ok(mut f) = std::fs::File::open(&path) else { continue };
            if f.seek(SeekFrom::Start(pos)).is_err() {
                continue;
            }
            let mut buf = String::new();
            if f.take(len - pos).read_to_string(&mut buf).is_err() {
                continue;
            }
            // Only consume complete lines; a half-written one is picked up next round.
            let done = buf.rfind('\n').map(|i| i + 1).unwrap_or(0);
            pos += done as u64;
            for l in buf[..done].lines() {
                if let Ok(v) = serde_json::from_str::<Value>(l) {
                    let _ = app.emit_to("main", "claude-event", v);
                }
            }
        }
    });
}

// ------------------------------------------------------------------ hook setup

fn settings_path() -> Result<PathBuf, String> {
    let home = std::env::var_os("USERPROFILE").ok_or("Can't find your home folder")?;
    Ok(PathBuf::from(home).join(".claude").join("settings.json"))
}

fn is_ours(entry: &Value) -> bool {
    entry["hooks"].as_array().is_some_and(|hs| {
        hs.iter().any(|h| h["command"].as_str().is_some_and(|c| c.contains(" --cc ") && c.to_ascii_lowercase().contains("deskbud")))
    })
}

fn command_for(event: &str) -> Result<String, String> {
    let exe = std::env::current_exe().map_err(|e| e.to_string())?;
    // Forward slashes work in both cmd and Git Bash, which Claude Code may use to run hooks.
    Ok(format!("\"{}\" --cc {event}", exe.to_string_lossy().replace('\\', "/")))
}

/// Add (install = true) or remove our hooks, leaving everything else in the file untouched.
pub fn set_hooks(install: bool) -> Result<(), String> {
    set_hooks_at(&settings_path()?, install)
}

fn set_hooks_at(path: &Path, install: bool) -> Result<(), String> {
    let mut root: Value = match std::fs::read_to_string(path) {
        Ok(s) if !s.trim().is_empty() => serde_json::from_str(&s)
            .map_err(|e| format!("~/.claude/settings.json isn't valid JSON ({e}); fix it first"))?,
        _ => json!({}),
    };
    if !root.is_object() {
        return Err("~/.claude/settings.json isn't a JSON object".into());
    }
    if path.is_file() {
        let bak = path.with_extension("json.deskbud-backup");
        if !bak.exists() {
            let _ = std::fs::copy(path, &bak);
        }
    }
    if !root["hooks"].is_object() {
        root["hooks"] = json!({});
    }
    for (name, short) in EVENTS {
        let list = root["hooks"][*name].as_array().cloned().unwrap_or_default();
        let mut list: Vec<Value> = list.into_iter().filter(|e| !is_ours(e)).collect();
        if install {
            list.push(json!({ "hooks": [{ "type": "command", "command": command_for(short)? }] }));
        }
        if list.is_empty() {
            root["hooks"].as_object_mut().unwrap().remove(*name);
        } else {
            root["hooks"][*name] = Value::Array(list);
        }
    }
    if root["hooks"].as_object().is_some_and(|o| o.is_empty()) {
        root.as_object_mut().unwrap().remove("hooks");
    }
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    }
    let text = serde_json::to_string_pretty(&root).map_err(|e| e.to_string())?;
    std::fs::write(path, text + "\n").map_err(|e| format!("Couldn't save Claude Code settings: {e}"))
}

/// Are our hooks installed (all three events)?
pub fn hooks_installed() -> bool {
    let Ok(path) = settings_path() else { return false };
    let Ok(root) = std::fs::read_to_string(path).map(|s| serde_json::from_str::<Value>(&s).unwrap_or(Value::Null)) else { return false };
    EVENTS.iter().all(|(name, _)| root["hooks"][*name].as_array().is_some_and(|l| l.iter().any(is_ours)))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn event_line_keeps_only_what_we_show() {
        let input = r#"{"session_id":"t1","cwd":"C:\\Users\\x\\proj-demo","message":"Needs permission","prompt":"SECRET"}"#;
        let v = event_line("notify", input, 5);
        assert_eq!(v, json!({"event":"notify","project":"proj-demo","session":"t1","message":"Needs permission","ts":5}));
        assert!(!v.to_string().contains("SECRET"));
    }

    #[test]
    fn project_is_the_repo_not_the_subfolder() {
        let root = std::env::temp_dir().join("deskbud-cc-proj").join("MyRepo");
        let _ = std::fs::remove_dir_all(root.parent().unwrap());
        std::fs::create_dir_all(root.join(".git")).unwrap();
        std::fs::create_dir_all(root.join("src-tauri/target/debug")).unwrap();
        assert_eq!(project_name(&root.join("src-tauri/target/debug")), "MyRepo");
        assert_eq!(project_name(&root), "MyRepo");
        assert_eq!(project_name(Path::new("C:\\no-repo-here\\xyz")), "xyz");
    }

    #[test]
    fn install_and_remove_keeps_other_settings() {
        let dir = std::env::temp_dir().join("deskbud-cc-test");
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let p = dir.join("settings.json");
        let mine = json!({ "hooks": [{ "type": "command", "command": "echo hi" }] });
        std::fs::write(&p, json!({ "model": "opus", "hooks": { "Stop": [mine.clone()] } }).to_string()).unwrap();

        set_hooks_at(&p, true).unwrap();
        set_hooks_at(&p, true).unwrap(); // idempotent
        let v: Value = serde_json::from_str(&std::fs::read_to_string(&p).unwrap()).unwrap();
        assert_eq!(v["model"], "opus");
        let stop = v["hooks"]["Stop"].as_array().unwrap();
        assert_eq!(stop.len(), 2, "user's hook kept, ours added once");
        assert!(stop[1]["hooks"][0]["command"].as_str().unwrap().ends_with("--cc stop"));
        assert_eq!(v["hooks"]["Notification"].as_array().unwrap().len(), 1);
        assert!(dir.join("settings.json.deskbud-backup").is_file());

        set_hooks_at(&p, false).unwrap();
        let v: Value = serde_json::from_str(&std::fs::read_to_string(&p).unwrap()).unwrap();
        assert_eq!(v["hooks"]["Stop"], json!([mine]));
        assert!(v["hooks"].get("Notification").is_none());

        std::fs::write(&p, "{ broken").unwrap();
        assert!(set_hooks_at(&p, true).is_err(), "never overwrite a file we can't parse");
    }
}
