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

/// The session to report, by index among `playing` (each session's play state): Windows' current session (`current`, found
/// by COM identity, never by app id: several tabs of one browser share it) when it plays, else the first that plays, else
/// the current one, else the first.
pub fn pick(playing: &[bool], current: Option<usize>) -> Option<usize> {
    let current = current.filter(|&c| c < playing.len());
    current.filter(|&c| playing[c])
        .or_else(|| playing.iter().position(|&p| p))
        .or(current)
        .or(if playing.is_empty() { None } else { Some(0) })
}

/// How a play/pause is sent: the player's toggle when it has one, else the separate play or pause it accepts now.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PlayPauseOp { Toggle, Play, Pause }

/// The play/pause operation the player takes in its state (`None`: it takes none, the control is off).
pub fn play_pause_op(playing: bool, toggle: bool, play: bool, pause: bool) -> Option<PlayPauseOp> {
    if toggle { Some(PlayPauseOp::Toggle) }
    else if playing && pause { Some(PlayPauseOp::Pause) }
    else if !playing && play { Some(PlayPauseOp::Play) }
    else { None }
}

/// Reads of a missing thumbnail on plain polls, for one track, before waiting for the player's next change notice.
pub const ARTWORK_TRIES: u32 = 10;

/// Whether this pass reads the thumbnail: always for a new track, and after the player said its properties changed (a
/// cover published late, corrected or replaced under the same title); on a plain poll, only while it is missing and
/// tries remain.
pub fn should_read_artwork(new_track: bool, props_changed: bool, has: bool, tries: u32) -> bool {
    new_track || props_changed || (!has && tries < ARTWORK_TRIES)
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

/// The last state sent, what `now_playing` answers; `media_command` drives the session it was read from.
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
    if media.0.lock().map(|s| s.is_none()).unwrap_or(true) { return Ok(false); }
    tauri::async_runtime::spawn_blocking(move || platform::command(cmd)).await.map_err(|e| e.to_string())
}

/// Starts watching the media sessions (Windows); a no-op elsewhere.
pub fn start(app: AppHandle) { platform::start(app); }

#[cfg(not(windows))]
mod platform {
    use super::Command;
    pub fn start(_app: tauri::AppHandle) {}
    pub fn command(_cmd: Command) -> bool { false }
}

#[cfg(windows)]
mod platform {
    use std::collections::HashMap;
    use std::sync::{mpsc, Mutex};
    use std::time::Duration;

    use tauri::{AppHandle, Emitter, Manager};
    use windows::core::{IUnknown, Interface, HSTRING};
    use windows::ApplicationModel::AppInfo;
    use windows::Foundation::{EventRegistrationToken, TypedEventHandler};
    use windows::Media::Control::{
        GlobalSystemMediaTransportControlsSession as Session, GlobalSystemMediaTransportControlsSessionManager as SessionManager,
        GlobalSystemMediaTransportControlsSessionMediaProperties as Properties, GlobalSystemMediaTransportControlsSessionPlaybackControls as Controls_,
        GlobalSystemMediaTransportControlsSessionPlaybackStatus as Status,
    };
    use windows::Storage::Streams::DataReader;
    use windows::Win32::System::Com::{CoInitializeEx, COINIT_MULTITHREADED};

    use super::{data_url, pick, play_pause_op, should_read_artwork, Command, Controls, Media, NowPlaying, PlayPauseOp, Player, NOW_PLAYING_EVENT};

    /// A read even when no event comes: a player that publishes no change notice is still followed.
    const POLL: Duration = Duration::from_secs(2);
    /// Events come in bursts (title, then artist, then thumbnail): one read after the burst settles.
    const SETTLE: Duration = Duration::from_millis(80);
    /// Waits before asking again for the session manager when Windows refuses it.
    const RETRY: Duration = Duration::from_secs(10);

    /// The session the last read reported: commands go to this very session, not to the first one of its app.
    static SELECTED: Mutex<Option<Session>> = Mutex::new(None);

    /// What woke the watcher: a session's properties (title, artist, thumbnail) changed, or anything else.
    #[derive(Clone, Copy, PartialEq)]
    enum Signal { Properties, Other }

    /// COM identity: the same session object, whatever interface pointer each side holds.
    fn same(a: &Session, b: &Session) -> bool {
        match (a.cast::<IUnknown>(), b.cast::<IUnknown>()) { (Ok(x), Ok(y)) => x == y, _ => false }
    }

    fn sessions_of(mgr: &SessionManager) -> Vec<Session> { mgr.GetSessions().map(|v| v.into_iter().collect()).unwrap_or_default() }

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
        let (tx, rx) = mpsc::channel::<Signal>();
        let t = tx.clone();
        let _ = mgr.SessionsChanged(&TypedEventHandler::new(move |_, _| { let _ = t.send(Signal::Other); Ok(()) }));
        let t = tx.clone();
        let _ = mgr.CurrentSessionChanged(&TypedEventHandler::new(move |_, _| { let _ = t.send(Signal::Other); Ok(()) }));
        let mut watched: Vec<(Session, String, EventRegistrationToken, EventRegistrationToken)> = Vec::new();
        let mut names: HashMap<String, Option<String>> = HashMap::new();
        let mut artwork: Option<Artwork> = None;
        let mut last: Option<Option<NowPlaying>> = None;
        let mut props_changed = false;
        loop {
            let sessions = sessions_of(&mgr);
            let ids: Vec<String> = sessions.iter().map(id_of).collect();
            if watched.iter().map(|w| &w.1).ne(ids.iter()) {
                for (s, _, a, b) in watched.drain(..) { let _ = s.RemoveMediaPropertiesChanged(a); let _ = s.RemovePlaybackInfoChanged(b); }
                for (s, id) in sessions.iter().zip(&ids) {
                    let (t1, t2) = (tx.clone(), tx.clone());
                    let a = s.MediaPropertiesChanged(&TypedEventHandler::new(move |_, _| { let _ = t1.send(Signal::Properties); Ok(()) }));
                    let b = s.PlaybackInfoChanged(&TypedEventHandler::new(move |_, _| { let _ = t2.send(Signal::Other); Ok(()) }));
                    if let (Ok(a), Ok(b)) = (a, b) { watched.push((s.clone(), id.clone(), a, b)); }
                }
            }
            let (state, selected) = read(&mgr, &sessions, &ids, &mut names, &mut artwork, props_changed);
            if let Ok(mut s) = SELECTED.lock() { *s = selected; }
            if last.as_ref() != Some(&state) {
                if let Some(media) = app.try_state::<Media>() { if let Ok(mut s) = media.0.lock() { *s = state.clone(); } }
                let _ = app.emit(NOW_PLAYING_EVENT, &state);
                last = Some(state);
            }
            props_changed = false;
            match rx.recv_timeout(POLL) {
                Ok(first) => {
                    std::thread::sleep(SETTLE);
                    props_changed = first == Signal::Properties;
                    while let Ok(next) = rx.try_recv() { props_changed |= next == Signal::Properties; }
                }
                Err(mpsc::RecvTimeoutError::Timeout) => {}
                Err(mpsc::RecvTimeoutError::Disconnected) => return,
            }
        }
    }

    /// The state to report and the session it comes from.
    fn read(mgr: &SessionManager, sessions: &[Session], ids: &[String], names: &mut HashMap<String, Option<String>>, artwork: &mut Option<Artwork>, props_changed: bool) -> (Option<NowPlaying>, Option<Session>) {
        let current = mgr.GetCurrentSession().ok().and_then(|c| sessions.iter().position(|s| same(s, &c)));
        let playing: Vec<bool> = sessions.iter()
            .map(|s| s.GetPlaybackInfo().and_then(|i| i.PlaybackStatus()).map(|st| st == Status::Playing).unwrap_or(false)).collect();
        let Some(i) = pick(&playing, current) else { return (None, None) };
        let (s, id) = (&sessions[i], &ids[i]);
        (state_of(s, id, playing[i], names, artwork, props_changed), Some(s.clone()))
    }

    fn state_of(s: &Session, id: &str, playing: bool, names: &mut HashMap<String, Option<String>>, artwork: &mut Option<Artwork>, props_changed: bool) -> Option<NowPlaying> {
        let props = s.TryGetMediaPropertiesAsync().ok()?.get().ok()?;
        let title = props.Title().map(|h| h.to_string()).unwrap_or_default();
        if title.trim().is_empty() || id.is_empty() { return None; }
        let artist = props.Artist().map(|h| h.to_string()).unwrap_or_default();
        let album = props.AlbumTitle().map(|h| h.to_string()).ok().filter(|a| !a.trim().is_empty());
        let controls = s.GetPlaybackInfo().and_then(|i| i.Controls()).ok();
        let flag = |f: &dyn Fn(&Controls_) -> windows::core::Result<bool>| controls.as_ref().and_then(|c| f(c).ok()).unwrap_or(false);
        let can = Controls {
            previous: flag(&|c| c.IsPreviousEnabled()),
            play_pause: play_pause_op(playing, flag(&|c| c.IsPlayPauseToggleEnabled()), flag(&|c| c.IsPlayEnabled()), flag(&|c| c.IsPauseEnabled())).is_some(),
            next: flag(&|c| c.IsNextEnabled()),
        };
        let key = (id.to_string(), title.clone(), artist.clone(), album.clone().unwrap_or_default());
        let new_track = !matches!(artwork, Some(a) if a.key == key);
        if new_track { *artwork = Some(Artwork { key, url: None, tries: 0 }); }
        let art = artwork.as_mut().expect("set above");
        if should_read_artwork(new_track, props_changed, art.url.is_some(), art.tries) {
            // A cover read replaces the one shown; a failed read keeps it (the thumbnail stream is briefly unreadable
            // while the player swaps it) and counts as a try while there is none.
            match thumbnail(&props) {
                Some(url) => { art.url = Some(url); art.tries = 0; }
                None => if art.url.is_none() { art.tries += 1; },
            }
        }
        let name = names.entry(id.to_string()).or_insert_with(|| display_name(id)).clone();
        Some(NowPlaying {
            title, artist, album, artwork: art.url.clone(), playing, can,
            player: Player { id: id.to_string(), name },
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
        let sessions = sessions_of(&mgr);
        let ids: Vec<String> = sessions.iter().map(id_of).collect();
        let (state, selected) = read(&mgr, &sessions, &ids, &mut HashMap::new(), &mut None, false);
        if let Ok(mut s) = SELECTED.lock() { *s = selected; }
        state
    }

    /// Sends the command to the session last reported. Play/pause uses what the player accepts now (its toggle, or a
    /// separate play or pause): true when the player took it.
    pub fn command(cmd: Command) -> bool {
        mta();
        let Some(s) = SELECTED.lock().ok().and_then(|s| s.clone()) else { return false };
        let op = match cmd {
            Command::Previous => s.TrySkipPreviousAsync(),
            Command::Next => s.TrySkipNextAsync(),
            Command::PlayPause => {
                let Ok(info) = s.GetPlaybackInfo() else { return false };
                let playing = info.PlaybackStatus().map(|st| st == Status::Playing).unwrap_or(false);
                let c = info.Controls().ok();
                let flag = |f: &dyn Fn(&Controls_) -> windows::core::Result<bool>| c.as_ref().and_then(|c| f(c).ok()).unwrap_or(false);
                match play_pause_op(playing, flag(&|c| c.IsPlayPauseToggleEnabled()), flag(&|c| c.IsPlayEnabled()), flag(&|c| c.IsPauseEnabled())) {
                    Some(PlayPauseOp::Toggle) => s.TryTogglePlayPauseAsync(),
                    Some(PlayPauseOp::Play) => s.TryPlayAsync(),
                    Some(PlayPauseOp::Pause) => s.TryPauseAsync(),
                    None => return false,
                }
            }
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
        assert_eq!(pick(&[], None), None);
        assert_eq!(pick(&[false, true, true], Some(2)), Some(2));
        assert_eq!(pick(&[false, true], Some(0)), Some(1));
        assert_eq!(pick(&[false, false], Some(1)), Some(1));
        assert_eq!(pick(&[false, false], None), Some(0));
        assert_eq!(pick(&[true], Some(5)), Some(0));
    }

    #[test]
    fn two_tabs_of_one_browser_are_two_sessions() {
        // Both are `MSEdge`: the choice works on sessions, never on the app id, so the second tab, current and playing,
        // is the one reported (and the one commands then go to), not the first tab of the same app.
        assert_eq!(pick(&[true, true], Some(1)), Some(1));
        assert_eq!(pick(&[false, true], Some(0)), Some(1));
    }

    #[test]
    fn play_pause_uses_what_the_player_accepts() {
        assert_eq!(play_pause_op(true, true, false, false), Some(PlayPauseOp::Toggle));
        // no toggle: the separate command for the state it is in
        assert_eq!(play_pause_op(true, false, true, true), Some(PlayPauseOp::Pause));
        assert_eq!(play_pause_op(false, false, true, true), Some(PlayPauseOp::Play));
        // playing with only Play offered, paused with only Pause: nothing it would take, the control is off
        assert_eq!(play_pause_op(true, false, true, false), None);
        assert_eq!(play_pause_op(false, false, false, true), None);
    }

    #[test]
    fn the_cover_is_read_again_when_the_player_changes_it() {
        // a new track, and a properties notice for the same track (a late, corrected or replaced cover)
        assert!(should_read_artwork(true, false, false, ARTWORK_TRIES));
        assert!(should_read_artwork(false, true, true, 0));
        assert!(should_read_artwork(false, true, false, ARTWORK_TRIES));
        // a plain poll: only while missing and tries remain
        assert!(should_read_artwork(false, false, false, ARTWORK_TRIES - 1));
        assert!(!should_read_artwork(false, false, false, ARTWORK_TRIES));
        assert!(!should_read_artwork(false, false, true, 0));
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

    /// Drives this PC's player for real, then reads it again: `LEDGE_MEDIA_CMD=next|play_pause|previous cargo test --
    /// --ignored live_media_command --nocapture`. Only with the user's go: it changes what plays.
    #[cfg(windows)]
    #[test]
    #[ignore]
    fn live_media_command() {
        let cmd = std::env::var("LEDGE_MEDIA_CMD").ok().and_then(|c| Command::parse(&c)).expect("LEDGE_MEDIA_CMD=next|play_pause|previous");
        let before = platform::snapshot().expect("nothing plays");
        let took = platform::command(cmd);
        std::thread::sleep(std::time::Duration::from_secs(2));
        let after = platform::snapshot();
        let line = |n: &Option<NowPlaying>| n.as_ref().map(|n| format!("{} — {} (playing: {}, artwork: {})", n.title, n.artist, n.playing, n.artwork.is_some())).unwrap_or("null".into());
        println!("player: {} {:?}\ncommand {cmd:?} taken: {took}\nbefore: {}\nafter:  {}", before.player.id, before.player.name, line(&Some(before.clone())), line(&after));
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
