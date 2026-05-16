// Smoke test of the same portable-pty stack the app uses.
use portable_pty::{CommandBuilder, NativePtySystem, PtySize, PtySystem};
use std::io::Read;
use std::time::{Duration, Instant};

fn main() {
    let pty = NativePtySystem::default();
    let pair = pty.openpty(PtySize { rows: 24, cols: 80, pixel_width: 0, pixel_height: 0 }).unwrap();
    let mut cmd = CommandBuilder::new("bash");
    cmd.arg("-lc");
    cmd.arg("echo HELLO_FROM_PTY; echo CWD=$(pwd); echo CLAUDE=$(command -v claude); echo PATH=$PATH; sleep 0.3");
    // inherit env (the real fix from the review)
    for (k, v) in std::env::vars() { cmd.env(k, v); }
    cmd.env("TERM", "xterm-256color");
    let mut child = pair.slave.spawn_command(cmd).unwrap();
    drop(pair.slave);
    let mut reader = pair.master.try_clone_reader().unwrap();
    let started = Instant::now();
    let mut buf = vec![0u8; 4096];
    let mut out = Vec::new();
    while started.elapsed() < Duration::from_secs(3) {
        match reader.read(&mut buf) {
            Ok(0) => break,
            Ok(n) => out.extend_from_slice(&buf[..n]),
            Err(_) => break,
        }
        if !child.try_wait().unwrap().is_none() && out.len() > 0 { break; }
    }
    let _ = child.kill();
    println!("--- captured {} bytes ---", out.len());
    println!("{}", String::from_utf8_lossy(&out));
}
