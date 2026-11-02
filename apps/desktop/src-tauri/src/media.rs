//! What is playing on the PC, read from Windows' media controls (SMTC) for the closed notch, and its three controls.
//! The contract is `@ledge/protocol`'s media.ts: the `now_playing` command, the `ledge://now-playing` event (the state
//! or `null`) and the `media_command` command. Every player that publishes a media session counts; the one reported is
//! the one playing (Windows' current session first), else Windows' current one. Outside Windows nothing ever plays.

use std::sync::Mutex;

use serde::Serialize;
use tauri::{AppHandle, State};

/// Emitted on every change of the state: `NowPlaying` or `null`.
pub const NOW_PLAYING_EVENT: &str = "ledge://now-playing";
/// The largest artwork sent, in bytes before encoding (protocol `ARTWORK_MAX_BYTES`); a bigger one is left out.
pub const ARTWORK_MAX_BYTES: usize = 512 * 1024;

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct NowPlaying {
    pub title: String,
    pub artist: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub album: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub artwork: Option<String>,
    pub playing: bool,
    pub can: Controls,
    pub player: Player,
}

#[derive(Debug, Clone, Copy, Serialize, PartialEq)]
pub struct Controls {
    pub previous: bool,
    #[serde(rename = "playPause")]
    pub play_pause: bool,
    pub next: bool,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct Player {
    pub id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Command { Previous, PlayPause, Next }

impl Command {
    pub fn parse(s: &str) -> Option<Command> {
        match s { "previous" => Some(Command::Previous), "play_pause" => Some(Command::PlayPause), "next" => Some(Command::Next), _ => None }
    }
}

/// One media session as the choice sees it.
#[derive(Debug, Clone, PartialEq)]
pub struct Candidate { pub playing: bool, pub current: bool }

/// The session to report: the current one when it plays, else the first that plays, else the current one, else the first.
pub fn pick(cands: &[Candidate]) -> Option<usize> {
    cands.iter().position(|c| c.current && c.playing)
        .or_else(|| cands.iter().position(|c| c.playing))
        .or_else(|| cands.iter().position(|c| c.current))
        .or(if cands.is_empty() { None } else { Some(0) })
}

/// The artwork as a data URL: the player's content type when it is an image one, else the bytes' own signature. Empty,
/// too big, or not an image: none.
pub fn data_url(content_type: &str, bytes: &[u8]) -> Option<String> {
    if bytes.is_empty() || bytes.len() > ARTWORK_MAX_BYTES { return None; }
    let declared = content_type.trim().to_ascii_lowercase();
    let mime = if declared.starts_with("image/") && declared.len() > 6 && !declared.contains([';', ',', ' ']) { declared } else { sniff(bytes)?.to_string() };
    Some(format!("data:{mime};base64,{}", base64(bytes)))
}

fn sniff(b: &[u8]) -> Option<&'static str> {
    if b.starts_with(&[0x89, b'P', b'N', b'G']) { Some("image/png") }
    else if b.starts_with(&[0xFF, 0xD8, 0xFF]) { Some("image/jpeg") }
    else if b.starts_with(b"GIF8") { Some("image/gif") }
    else if b.starts_with(b"BM") { Some("image/bmp") }
    else if b.len() >= 12 && &b[0..4] == b"RIFF" && &b[8..12] == b"WEBP" { Some("image/webp") }
    else { None }
}

/// Standard base64 with padding.
pub fn base64(bytes: &[u8]) -> String {
    const T: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = String::with_capacity(bytes.len().div_ceil(3) * 4);
    for chunk in bytes.chunks(3) {
        let n = (chunk[0] as u32) << 16 | (*chunk.get(1).unwrap_or(&0) as u32) << 8 | *chunk.get(2).unwrap_or(&0) as u32;
        out.push(T[(n >> 18) as usize & 63] as char);
        out.push(T[(n >> 12) as usize & 63] as char);
        out.push(if chunk.len() > 1 { T[(n >> 6) as usize & 63] as char } else { '=' });
        out.push(if chunk.len() > 2 { T[n as usize & 63] as char } else { '=' });
    }
    out
}

/// The last state read, what `now_playing` answers and the player `media_command` drives.
#[derive(Default)]
pub struct Media(pub Mutex<Option<NowPlaying>>);

/// The state as it stands (`null`: nothing plays, or not Windows).
#[tauri::command]
pub fn now_playing(media: State<Media>) -> Option<NowPlaying> {
    media.0.lock().ok().and_then(|s| s.clone())
}

/// Sends `previous`, `play_pause` or `next` to the reported player: true when it took it. The new state follows by the event.
#[tauri::command]
pub async fn media_command(media: State<'_, Media>, command: String) -> Result<bool, String> {
    let cmd = Command::parse(&command).ok_or_else(|| format!("unknown media command: {command}"))?;
    let Some(player) = media.0.lock().ok().and_then(|s| s.as_ref().map(|n| n.player.id.clone())) else { return Ok(false) };
    tauri::async_runtime::spawn_blocking(move || platform::command(&player, cmd)).await.map_err(|e| e.to_string())
}

/// Starts watching the media sessions (Windows); a no-op elsewhere.
pub fn start(app: AppHandle) { platform::start(app); }

#[cfg(not(windows))]
mod platform {
    use super::Command;
    pub fn start(_app: tauri::AppHandle) {}
    pub fn command(_player: &str, _cmd: Command) -> bool { false }
}

#[cfg(windows)]
mod platform {
    use std::collections::HashMap;
    use std::sync::mpsc;
    use std::time::Duration;

    use tauri::{AppHandle, Emitter, Manager};
    use windows::core::HSTRING;
    use windows::ApplicationModel::AppInfo;
    use windows::Foundation::{EventRegistrationToken, TypedEventHandler};
    use windows::Media::Control::{
        GlobalSystemMediaTransportControlsSession as Session, GlobalSystemMediaTransportControlsSessionManager as SessionManager,
        GlobalSystemMediaTransportControlsSessionMediaProperties as Properties, GlobalSystemMediaTransportControlsSessionPlaybackStatus as Status,
    };
    use windows::Storage::Streams::DataReader;
    use windows::Win32::System::Com::{CoInitializeEx, COINIT_MULTITHREADED};

    use super::{data_url, pick, Candidate, Command, Controls, Media, NowPlaying, Player, NOW_PLAYING_EVENT};

    /// A read even when no event comes: a player that publishes no change notice is still followed.
    const POLL: Duration = Duration::from_secs(2);
    /// Events come in bursts (title, then artist, then thumbnail): one read after the burst settles.
    const SETTLE: Duration = Duration::from_millis(80);
    /// Retries of a missing thumbnail for the same track before giving up on it.
    const ARTWORK_TRIES: u32 = 10;
    /// Waits before asking again for the session manager when Windows refuses it.
    const RETRY: Duration = Duration::from_secs(10);

    fn mta() { unsafe { let _ = CoInitializeEx(None, COINIT_MULTITHREADED); } }

    fn manager() -> windows::core::Result<SessionManager> { SessionManager::RequestAsync()?.get() }

    fn id_of(s: &Session) -> String { s.SourceAppUserModelId().map(|h| h.to_string()).unwrap_or_default() }

    pub fn start(app: AppHandle) {
        let spawned = std::thread::Builder::new().name("ledge-media".into()).spawn(move || {
            mta();
            let mgr = loop {
                match manager() { Ok(m) => break m, Err(_) => std::thread::sleep(RETRY) }
            };
            watch(app, mgr);
        });
        if let Err(e) = spawned { eprintln!("media: watcher not started: {e}"); }
    }

    /// The track the artwork belongs to, its data URL when read, and how many reads came back without one.
    struct Artwork { key: (String, String, String, String), url: Option<String>, tries: u32 }

    fn watch(app: AppHandle, mgr: SessionManager) {
        let (tx, rx) = mpsc::channel::<()>();
        let t = tx.clone();
        let _ = mgr.SessionsChanged(&TypedEventHandler::new(move |_, _| { let _ = t.send(()); Ok(()) }));
        let t = tx.clone();
        let _ = mgr.CurrentSessionChanged(&TypedEventHandler::new(move |_, _| { let _ = t.send(()); Ok(()) }));
        let mut watched: Vec<(Session, String, EventRegistrationToken, EventRegistrationToken)> = Vec::new();
        let mut names: HashMap<String, Option<String>> = HashMap::new();
        let mut artwork: Option<Artwork> = None;
        let mut last: Option<Option<NowPlaying>> = None;
        loop {
            let sessions: Vec<Session> = mgr.GetSessions().map(|v| v.into_iter().collect()).unwrap_or_default();
            let ids: Vec<String> = sessions.iter().map(id_of).collect();
            if watched.iter().map(|w| &w.1).ne(ids.iter()) {
                for (s, _, a, b) in watched.drain(..) { let _ = s.RemoveMediaPropertiesChanged(a); let _ = s.RemovePlaybackInfoChanged(b); }
                for (s, id) in sessions.iter().zip(&ids) {
                    let (t1, t2) = (tx.clone(), tx.clone());
                    let a = s.MediaPropertiesChanged(&TypedEventHandler::new(move |_, _| { let _ = t1.send(()); Ok(()) }));
                    let b = s.PlaybackInfoChanged(&TypedEventHandler::new(move |_, _| { let _ = t2.send(()); Ok(()) }));
                    if let (Ok(a), Ok(b)) = (a, b) { watched.push((s.clone(), id.clone(), a, b)); }
                }
            }
            let state = read(&mgr, &sessions, &ids, &mut names, &mut artwork);
            if last.as_ref() != Some(&state) {
                if let Some(media) = app.try_state::<Media>() { if let Ok(mut s) = media.0.lock() { *s = state.clone(); } }
                let _ = app.emit(NOW_PLAYING_EVENT, &state);
                last = Some(state);
            }
            match rx.recv_timeout(POLL) {
                Ok(()) => { std::thread::sleep(SETTLE); while rx.try_recv().is_ok() {} }
                Err(mpsc::RecvTimeoutError::Timeout) => {}
                Err(mpsc::RecvTimeoutError::Disconnected) => return,
            }
        }
    }

    fn read(mgr: &SessionManager, sessions: &[Session], ids: &[String], names: &mut HashMap<String, Option<String>>, artwork: &mut Option<Artwork>) -> Option<NowPlaying> {
        let current = mgr.GetCurrentSession().ok().map(|s| id_of(&s));
        let cands: Vec<Candidate> = sessions.iter().zip(ids).map(|(s, id)| Candidate {
            playing: s.GetPlaybackInfo().and_then(|i| i.PlaybackStatus()).map(|st| st == Status::Playing).unwrap_or(false),
            current: current.as_deref() == Some(id.as_str()),
        }).collect();
        let i = pick(&cands)?;
        let (s, id) = (&sessions[i], &ids[i]);
        let props = s.TryGetMediaPropertiesAsync().ok()?.get().ok()?;
        let title = props.Title().map(|h| h.to_string()).unwrap_or_default();
        if title.trim().is_empty() || id.is_empty() { return None; }
        let artist = props.Artist().map(|h| h.to_string()).unwrap_or_default();
        let album = props.AlbumTitle().map(|h| h.to_string()).ok().filter(|a| !a.trim().is_empty());
        let controls = s.GetPlaybackInfo().and_then(|i| i.Controls()).ok();
        let flag = |f: &dyn Fn(&windows::Media::Control::GlobalSystemMediaTransportControlsSessionPlaybackControls) -> windows::core::Result<bool>| controls.as_ref().and_then(|c| f(c).ok()).unwrap_or(false);
        let can = Controls {
            previous: flag(&|c| c.IsPreviousEnabled()),
            play_pause: flag(&|c| c.IsPlayPauseToggleEnabled()) || flag(&|c| c.IsPlayEnabled()) || flag(&|c| c.IsPauseEnabled()),
            next: flag(&|c| c.IsNextEnabled()),
        };
        let key = (id.clone(), title.clone(), artist.clone(), album.clone().unwrap_or_default());
        let fresh = !matches!(artwork, Some(a) if a.key == key);
        if fresh { *artwork = Some(Artwork { key, url: None, tries: 0 }); }
        let art = artwork.as_mut().expect("set above");
        if art.url.is_none() && art.tries < ARTWORK_TRIES {
            art.url = thumbnail(&props);
            if art.url.is_none() { art.tries += 1; }
        }
        let name = names.entry(id.clone()).or_insert_with(|| display_name(id)).clone();
        Some(NowPlaying {
            title, artist, album, artwork: art.url.clone(), playing: cands[i].playing, can,
            player: Player { id: id.clone(), name },
        })
    }

    fn thumbnail(props: &Properties) -> Option<String> {
        let stream = props.Thumbnail().ok()?.OpenReadAsync().ok()?.get().ok()?;
        let size = stream.Size().ok()?;
        if size == 0 || size > super::ARTWORK_MAX_BYTES as u64 { return None; }
        let content_type = stream.ContentType().map(|h| h.to_string()).unwrap_or_default();
        let reader = DataReader::CreateDataReader(&stream).ok()?;
        let loaded = reader.LoadAsync(size as u32).ok()?.get().ok()? as usize;
        let mut bytes = vec![0u8; loaded];
        reader.ReadBytes(&mut bytes).ok()?;
        data_url(&content_type, &bytes)
    }

    /// The player's name as Windows shows it (a packaged app, or one it registered); none for a plain exe it cannot name.
    fn display_name(id: &str) -> Option<String> {
        let name = AppInfo::GetFromAppUserModelId(&HSTRING::from(id)).ok()?.DisplayInfo().ok()?.DisplayName().ok()?.to_string();
        let name = name.trim().to_string();
        if name.is_empty() { None } else { Some(name) }
    }

    /// One read as the watcher makes it, for the live test.
    #[cfg(test)]
    pub fn snapshot() -> Option<NowPlaying> {
        mta();
        let mgr = manager().ok()?;
        let sessions: Vec<Session> = mgr.GetSessions().map(|v| v.into_iter().collect()).unwrap_or_default();
        let ids: Vec<String> = sessions.iter().map(id_of).collect();
        read(&mgr, &sessions, &ids, &mut HashMap::new(), &mut None)
    }

    pub fn command(player: &str, cmd: Command) -> bool {
        mta();
        let Ok(mgr) = manager() else { return false };
        let sessions: Vec<Session> = mgr.GetSessions().map(|v| v.into_iter().collect()).unwrap_or_default();
        let Some(s) = sessions.into_iter().find(|s| id_of(s) == player) else { return false };
        let op = match cmd {
            Command::Previous => s.TrySkipPreviousAsync(),
            Command::PlayPause => s.TryTogglePlayPauseAsync(),
            Command::Next => s.TrySkipNextAsync(),
        };
        op.and_then(|o| o.get()).unwrap_or(false)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn base64_matches_the_standard_alphabet_and_padding() {
        assert_eq!(base64(b""), "");
        assert_eq!(base64(b"f"), "Zg==");
        assert_eq!(base64(b"fo"), "Zm8=");
        assert_eq!(base64(b"foo"), "Zm9v");
        assert_eq!(base64(b"foobar"), "Zm9vYmFy");
        assert_eq!(base64(&[0xFF, 0xFE, 0xFD]), "//79");
    }

    #[test]
    fn artwork_takes_the_declared_image_type_else_the_bytes_signature() {
        let png = [0x89, b'P', b'N', b'G', 0x0D, 0x0A];
        assert_eq!(data_url("image/jpeg", &png).unwrap(), format!("data:image/jpeg;base64,{}", base64(&png)));
        assert!(data_url("", &png).unwrap().starts_with("data:image/png;base64,"));
        assert!(data_url("application/octet-stream", &[0xFF, 0xD8, 0xFF, 0xE0]).unwrap().starts_with("data:image/jpeg;"));
        assert!(data_url("image/png; charset=x", &png).unwrap().starts_with("data:image/png;base64,"));
        assert_eq!(data_url("", b"not an image"), None);
        assert_eq!(data_url("image/png", &[]), None);
        assert_eq!(data_url("image/png", &vec![0u8; ARTWORK_MAX_BYTES + 1]), None);
    }

    #[test]
    fn the_reported_session_is_the_one_playing_windows_current_first() {
        let c = |playing, current| Candidate { playing, current };
        assert_eq!(pick(&[]), None);
        assert_eq!(pick(&[c(false, false), c(true, false), c(true, true)]), Some(2));
        assert_eq!(pick(&[c(false, true), c(true, false)]), Some(1));
        assert_eq!(pick(&[c(false, false), c(false, true)]), Some(1));
        assert_eq!(pick(&[c(false, false), c(false, false)]), Some(0));
    }

    /// Reads this PC's media session for real: `cargo test -- --ignored live_media --nocapture` while something plays.
    #[cfg(windows)]
    #[test]
    #[ignore]
    fn live_media_read() {
        let state = platform::snapshot();
        let json = serde_json::to_string(&state).unwrap();
        println!("now playing: {}", json.chars().take(400).collect::<String>());
    }

    #[test]
    fn commands_are_the_three_the_protocol_names() {
        assert_eq!(Command::parse("previous"), Some(Command::Previous));
        assert_eq!(Command::parse("play_pause"), Some(Command::PlayPause));
        assert_eq!(Command::parse("next"), Some(Command::Next));
        assert_eq!(Command::parse("stop"), None);
    }

    #[test]
    fn the_state_serializes_as_the_protocol_reads_it() {
        let np = NowPlaying {
            title: "Teardrop".into(), artist: "".into(), album: None, artwork: None, playing: false,
            can: Controls { previous: true, play_pause: true, next: false }, player: Player { id: "MSEdge".into(), name: None },
        };
        assert_eq!(serde_json::to_string(&np).unwrap(),
            r#"{"title":"Teardrop","artist":"","playing":false,"can":{"previous":true,"playPause":true,"next":false},"player":{"id":"MSEdge"}}"#);
        assert_eq!(serde_json::to_string(&None::<NowPlaying>).unwrap(), "null");
    }
}
