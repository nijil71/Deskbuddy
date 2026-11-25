// Prevents an extra console window on Windows in release.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    // Claude Code hook: `deskbud.exe --cc stop` records the event and exits without starting the app.
    let args: Vec<String> = std::env::args().collect();
    if args.get(1).is_some_and(|a| a == "--cc") {
        deskbud_lib::cc_hook(args.get(2).map(String::as_str).unwrap_or(""));
        return;
    }
    deskbud_lib::run()
}
