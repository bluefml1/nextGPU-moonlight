use common::api_bindings::HostKeyboardLocks;

/// Read host Caps Lock / Num Lock toggle state (Windows only).
pub fn read_host_keyboard_locks() -> Option<HostKeyboardLocks> {
    read_host_keyboard_locks_impl()
}

#[cfg(windows)]
fn read_host_keyboard_locks_impl() -> Option<HostKeyboardLocks> {
    use windows_sys::Win32::UI::Input::KeyboardAndMouse::{GetKeyState, VK_CAPITAL, VK_NUMLOCK};

    unsafe {
        Some(HostKeyboardLocks {
            caps_lock: GetKeyState(VK_CAPITAL as i32) & 1 != 0,
            num_lock: GetKeyState(VK_NUMLOCK as i32) & 1 != 0,
        })
    }
}

#[cfg(not(windows))]
fn read_host_keyboard_locks_impl() -> Option<HostKeyboardLocks> {
    None
}

/// Locks for general-channel query (non-Windows returns off).
pub fn host_keyboard_locks_for_query() -> HostKeyboardLocks {
    read_host_keyboard_locks().unwrap_or(HostKeyboardLocks {
        caps_lock: false,
        num_lock: false,
    })
}
