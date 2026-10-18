/// Opens a web URL in the default browser through the shell (`rundll32 url.dll,FileProtocolHandler`, which takes `&`
/// and `?` as they are, unlike `cmd /C start`): the overlay's webview must never navigate away. Only http(s) is accepted.
pub fn open_url(url: &str) -> Result<(), String> {
    if !(url.starts_with("http://") || url.starts_with("https://")) { return Err("not a web url".into()); }
    #[cfg(windows)]
    let spawned = std::process::Command::new("rundll32").args(["url.dll,FileProtocolHandler", url]).spawn();
    #[cfg(not(windows))]
    let spawned = std::process::Command::new("xdg-open").arg(url).spawn();
    spawned.map(|_| ()).map_err(|e| format!("open url: {e}"))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test] fn only_web_urls_are_opened() { assert_eq!(open_url("file:///etc/passwd"), Err("not a web url".into())); assert_eq!(open_url("ftp://x"), Err("not a web url".into())); }
}
