//! The track Windows is playing (GSMTC), read once a second while the notch asks, and the three transport buttons.
//! Outside Windows every command is a no-op: nothing is polled, `media_now` is `null`.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::thread::{self, JoinHandle};
use std::time::Duration;

use base64::Engine;
use serde::Serialize;
use tauri::{AppHandle, Emitter};

pub const MEDIA_EVENT: &str = "ledge://media";
const COVER_MAX: usize = 512 * 1024;
const TICK: Duration = Duration::from_secs(1);

/// Same shape as `NowPlayingSchema` (`packages/protocol`). `cover` is a data URL, dropped past 512 KiB.
#[derive(Serialize, Clone, PartialEq, Debug)]
#[serde(rename_all = "camelCase")]
pub struct NowPlaying {
    pub title: String,
    pub artist: String,
    pub playing: bool,
    pub cover: Option<String>,
    pub can_prev: bool,
    pub can_next: bool,
    pub source: String,
}

struct Shared {
    current: Mutex<Option<NowPlaying>>,
}

struct Watch {
    stop: Arc<AtomicBool>,
    join: Option<JoinHandle<()>>,
}

pub struct MediaState {
    shared: Arc<Shared>,
    watch: Mutex<Option<Watch>>,
}

impl Default for MediaState {
    fn default() -> Self {
        Self { shared: Arc::new(Shared { current: Mutex::new(None) }), watch: Mutex::new(None) }
    }
}

impl MediaState {
    fn stop(&self) {
        let taken = self.watch.lock().unwrap().take();
        if let Some(mut watch) = taken {
            watch.stop.store(true, Ordering::Relaxed);
            if let Some(join) = watch.join.take() { let _ = join.join(); }
        }
    }

    #[cfg(windows)]
    fn start(&self, app: AppHandle) {
        let mut slot = self.watch.lock().unwrap();
        if slot.is_some() { return; }
        let shared = self.shared.clone();
        let stop = Arc::new(AtomicBool::new(false));
        let flag = stop.clone();
        let join = thread::spawn(move || {
            let mut covers = CoverCache::default();
            let mut last: Option<NowPlaying> = None;
            while !flag.load(Ordering::Relaxed) {
                let next = read_now(&mut covers);
                if next != last {
                    last = next.clone();
                    *shared.current.lock().unwrap() = next.clone();
                    let _ = app.emit(MEDIA_EVENT, &next);
                }
                let step = TICK / 10;
                for _ in 0..10 {
                    if flag.load(Ordering::Relaxed) { break; }
                    thread::sleep(step);
                }
            }
        });
        *slot = Some(Watch { stop, join: Some(join) });
    }
}

fn publish_cleared(app: &AppHandle, shared: &Shared) {
    *shared.current.lock().unwrap() = None;
    let _ = app.emit(MEDIA_EVENT, Option::<NowPlaying>::None);
}

/// `on` starts the one-second poll; `false` stops it and tells every window that nothing is playing. Idempotent.
#[tauri::command]
pub fn media_watch(app: AppHandle, state: tauri::State<MediaState>, on: bool) {
    if !on {
        state.stop();
        publish_cleared(&app, &state.shared);
        return;
    }
    #[cfg(windows)]
    state.start(app);
    #[cfg(not(windows))]
    { let _ = (app, state); }
}

/// The last track this process read. `null` when nothing is playing, or outside Windows.
#[tauri::command]
pub fn media_now(state: tauri::State<MediaState>) -> Option<NowPlaying> {
    state.shared.current.lock().unwrap().clone()
}

/// `prev`, `toggle` or `next` on the current session. Unknown, or outside Windows: an error the page swallows.
#[tauri::command]
pub fn media_control(action: String) -> Result<(), String> {
    match action.as_str() {
        "prev" | "toggle" | "next" => {}
        _ => return Err(format!("unknown media action: {action}")),
    }
    #[cfg(windows)]
    { send_control(&action) }
    #[cfg(not(windows))]
    { let _ = action; Err("media controls are only available on Windows".into()) }
}

/// The app name a user would recognise, from a window's App User Model ID or an executable path.
pub fn source_name(aumid: &str) -> String {
    let file = aumid.rsplit(['\\', '/']).next().unwrap_or(aumid);
    let named = match file.split_once('!') {
        Some((pkg, app)) if pkg.contains('.') || pkg.contains('_') => app,
        Some((pkg, _)) => pkg,
        None => file,
    };
    let stem = strip_exe(named);
    match stem.to_ascii_lowercase().as_str() {
        "chrome" => "Chrome".into(),
        "msedge" => "Edge".into(),
        "spotify" => "Spotify".into(),
        "308046b0af4a39cb" => "Firefox".into(),
        "firefox" => "Firefox".into(),
        "vlc" => "VLC".into(),
        "brave" => "Brave".into(),
        "opera" => "Opera".into(),
        _ => capitalize(stem),
    }
}

fn strip_exe(name: &str) -> &str {
    if name.to_ascii_lowercase().ends_with(".exe") { &name[..name.len() - 4] } else { name }
}

fn capitalize(name: &str) -> String {
    let mut chars = name.chars();
    match chars.next() {
        None => String::new(),
        Some(first) => first.to_uppercase().collect::<String>() + chars.as_str(),
    }
}

/// A data URL, or `None` when there are no bytes or more than 512 KiB. An empty mime is JPEG.
pub fn cover_data_url(mime: &str, bytes: &[u8]) -> Option<String> {
    if bytes.is_empty() || bytes.len() > COVER_MAX { return None; }
    let mime = if mime.is_empty() { "image/jpeg" } else { mime };
    Some(format!("data:{mime};base64,{}", base64::engine::general_purpose::STANDARD.encode(bytes)))
}

#[cfg(windows)]
#[derive(Default)]
struct CoverCache {
    key: String,
    url: Option<String>,
}

#[cfg(windows)]
fn read_now(covers: &mut CoverCache) -> Option<NowPlaying> {
    let manager = windows::Media::Control::GlobalSystemMediaTransportControlsSessionManager::RequestAsync().ok()?.get().ok()?;
    let session = manager.GetCurrentSession().ok()?;
    let props = session.TryGetMediaPropertiesAsync().ok()?.get().ok()?;
    let title = hstring_string(&props.Title().ok()?);
    let artist = props.Artist().ok().map(|h| hstring_string(&h)).unwrap_or_default();
    let info = session.GetPlaybackInfo().ok()?;
    let playing = info.PlaybackStatus().ok()? == windows::Media::Control::GlobalSystemMediaTransportControlsSessionPlaybackStatus::Playing;
    let controls = info.Controls().ok()?;
    let can_prev = controls.IsPreviousEnabled().unwrap_or(false);
    let can_next = controls.IsNextEnabled().unwrap_or(false);
    let source = session.SourceAppUserModelId().ok().map(|h| source_name(&hstring_string(&h))).unwrap_or_default();
    let key = format!("{title}\0{artist}");
    if covers.key != key {
        covers.key = key;
        covers.url = thumbnail(&props);
    }
    Some(NowPlaying { title, artist, playing, cover: covers.url.clone(), can_prev, can_next, source })
}

#[cfg(windows)]
fn hstring_string(value: &windows::core::HSTRING) -> String {
    value.to_string()
}

#[cfg(windows)]
fn thumbnail(props: &windows::Media::Control::GlobalSystemMediaTransportControlsSessionMediaProperties) -> Option<String> {
    let reference = props.Thumbnail().ok()?;
    let stream = reference.OpenReadAsync().ok()?.get().ok()?;
    let size = stream.Size().ok()?;
    if size == 0 || size > COVER_MAX as u64 { return None; }
    let reader = windows::Storage::Streams::DataReader::CreateDataReader(&stream).ok()?;
    reader.LoadAsync(size as u32).ok()?.get().ok()?;
    let mut bytes = vec![0u8; size as usize];
    reader.ReadBytes(&mut bytes).ok()?;
    let mime = stream.ContentType().ok().map(|h| hstring_string(&h)).unwrap_or_default();
    cover_data_url(&mime, &bytes)
}

#[cfg(windows)]
fn send_control(action: &str) -> Result<(), String> {
    let manager = windows::Media::Control::GlobalSystemMediaTransportControlsSessionManager::RequestAsync().map_err(|e| e.to_string())?.get().map_err(|e| e.to_string())?;
    let session = manager.GetCurrentSession().map_err(|e| e.to_string())?;
    let op = match action {
        "prev" => session.TrySkipPreviousAsync(),
        "toggle" => session.TryTogglePlayPauseAsync(),
        "next" => session.TrySkipNextAsync(),
        _ => return Err(format!("unknown media action: {action}")),
    }.map_err(|e| e.to_string())?;
    op.get().map_err(|e| e.to_string())?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{cover_data_url, source_name};

    #[test]
    fn source_names_read_like_the_app() {
        assert_eq!(source_name("Chrome"), "Chrome");
        assert_eq!(source_name("MSEdge"), "Edge");
        assert_eq!(source_name("Spotify.exe"), "Spotify");
        assert_eq!(source_name("308046B0AF4A39CB"), "Firefox");
        assert_eq!(source_name(r"C:\Program Files\VideoLAN\VLC\vlc.exe"), "VLC");
        assert_eq!(source_name("SpotifyAB.SpotifyMusic_zpdnekdrzrea0!Spotify"), "Spotify");
        assert_eq!(source_name("foobar2000.exe"), "Foobar2000");
    }

    #[test]
    fn cover_becomes_a_data_url() {
        assert_eq!(cover_data_url("image/png", &[1, 2, 3]).as_deref(), Some("data:image/png;base64,AQID"));
        assert_eq!(cover_data_url("", &[1]).as_deref(), Some("data:image/jpeg;base64,AQ=="));
    }

    #[test]
    fn cover_too_big_is_dropped() { assert_eq!(cover_data_url("image/jpeg", &vec![0; 512 * 1024 + 1]), None); }

    #[test]
    fn empty_cover_is_none() { assert_eq!(cover_data_url("image/png", &[]), None); }
}
