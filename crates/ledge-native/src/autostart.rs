/// The marker left once launch at login was switched on by default, so a later "off" in Settings sticks across restarts
/// and upgrades. It lives in the app's config dir (`%APPDATA%\<app identifier>`; the island's is `be.paradow.ledge`).
pub const MARKER: &str = "autostart-default";

/// Whether this start should switch launch at login on: the first start of an installed build only.
pub fn by_default(debug: bool, marker_exists: bool) -> bool {
    !debug && !marker_exists
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test] fn launch_at_login_is_switched_on_once_by_an_installed_build() {
        assert!(by_default(false, false));
        assert!(!by_default(false, true));
        assert!(!by_default(true, false));
    }
}
