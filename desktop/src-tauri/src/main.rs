use std::fs;
use std::path::PathBuf;
use std::sync::Mutex;
use std::thread;
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};
use tauri::menu::{Menu, MenuItem};
use tauri::tray::TrayIconBuilder;
use tauri::{AppHandle, Emitter, LogicalPosition, LogicalSize, Manager, Monitor, State, WebviewWindow, WindowEvent};
use tauri_plugin_global_shortcut::{Code, Modifiers, Shortcut, ShortcutState};

const COLLAPSED: f64 = 44.0;
const EXPANDED: f64 = 320.0;
const TRAY: &str = "rail";
// Grace period before folding back, so brushing past the edge doesn't flicker it.
const LINGER: Duration = Duration::from_millis(400);
// macOS moves windows around when displays sleep or are rearranged; re-pinning this
// often puts the rail back on its monitor without anyone touching it.
const REPIN_EVERY: Duration = Duration::from_secs(2);
// How often to look whether the menu bar is showing on the notch screen.
const MENU_EVERY: Duration = Duration::from_millis(800);
// The notch pill reaches this far past each side of the notch while the menu bar shows,
// and hovering this zone (notch plus wings) is what drops the panel in every notch state.
const WING: f64 = 56.0;
// Dropping within this distance of the notch, measured from its centre and from the
// top of the screen, docks the rail into it.
const NOTCH_SNAP: (f64, f64) = (220.0, 140.0);
// The dropped panel: the screen minus this margin on each side, and this share of its height.
const PANEL_MARGIN: f64 = 24.0;
const PANEL_HEIGHT: f64 = 0.815;

#[derive(Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
enum Edge {
    Left,
    Right,
    Notch,
}

// Where the rail lives, saved across launches. Monitors are matched by name plus
// origin because two identical displays report the same name.
#[derive(Clone, Serialize, Deserialize)]
struct Placement {
    monitor: Option<String>,
    origin: (i32, i32),
    edge: Edge,
    // Vertical centre of the rail as a fraction of the work area height.
    y: f64,
}

impl Default for Placement {
    fn default() -> Self {
        Placement { monitor: None, origin: (0, 0), edge: Edge::Right, y: 0.5 }
    }
}

// All geometry is in logical points. On macOS tauri reports each monitor scaled by
// its own factor, the window by the window's and the cursor by the main display's,
// so with a Retina screen beside a 1x one the physical values don't share a space:
// a right-edge x of the Retina screen lands on the screen next to it.
#[derive(Clone, Copy, PartialEq)]
struct Rect {
    x: f64,
    y: f64,
    w: f64,
    h: f64,
}

impl Rect {
    fn contains(&self, (x, y): (f64, f64)) -> bool {
        x >= self.x && x < self.x + self.w && y >= self.y && y < self.y + self.h
    }
}

// A screen with a camera housing, both rects in the same logical space as `bounds`.
#[derive(Clone, Copy)]
struct Notch {
    screen: Rect,
    notch: Rect,
}

#[derive(Clone)]
struct Rail {
    expanded: bool,
    // Opened from the keyboard: stays down until Esc, the shortcut again, or a click
    // elsewhere, instead of folding when the cursor leaves it.
    pinned: bool,
    height: f64,
    dragging: bool,
    placement: Placement,
    notches: Vec<Notch>,
    // The menu bar is hidden on the notch screen (an app in full screen), so the whole
    // black strip beside the notch is free for the bar.
    full: bool,
    // What the window shows right now: a Notch placement falls back to the right edge
    // while no screen has a notch (lid closed, external display as main).
    shown: Edge,
    // The notch screen and the hover zone of the current layout, when shown in the notch.
    notch_screen: Option<Rect>,
    notch_zone: Option<Rect>,
}

fn placement_file(app: &AppHandle) -> Option<PathBuf> {
    app.path().app_config_dir().ok().map(|dir| dir.join("placement.json"))
}

fn load_placement(app: &AppHandle) -> Placement {
    placement_file(app)
        .and_then(|f| fs::read_to_string(f).ok())
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}

fn save_placement(app: &AppHandle, p: &Placement) {
    let Some(file) = placement_file(app) else { return };
    if let Some(dir) = file.parent() {
        let _ = fs::create_dir_all(dir);
    }
    if let Ok(json) = serde_json::to_string_pretty(p) {
        let _ = fs::write(file, json);
    }
}

fn work_area(m: &Monitor) -> Rect {
    let (a, s) = (m.work_area(), m.scale_factor());
    Rect { x: a.position.x as f64 / s, y: a.position.y as f64 / s, w: a.size.width as f64 / s, h: a.size.height as f64 / s }
}

fn bounds(m: &Monitor) -> Rect {
    let s = m.scale_factor();
    Rect {
        x: m.position().x as f64 / s,
        y: m.position().y as f64 / s,
        w: m.size().width as f64 / s,
        h: m.size().height as f64 / s,
    }
}

fn origin(m: &Monitor) -> (i32, i32) {
    let b = bounds(m);
    (b.x.round() as i32, b.y.round() as i32)
}

fn window_rect(win: &WebviewWindow) -> Option<Rect> {
    let (pos, size, s) = (win.outer_position().ok()?, win.outer_size().ok()?, win.scale_factor().ok()?);
    Some(Rect { x: pos.x as f64 / s, y: pos.y as f64 / s, w: size.width as f64 / s, h: size.height as f64 / s })
}

fn cursor(win: &WebviewWindow) -> Option<(f64, f64)> {
    let c = win.cursor_position().ok()?;
    let s = win.primary_monitor().ok().flatten()?.scale_factor();
    Some((c.x / s, c.y / s))
}

fn monitors_in_order(win: &WebviewWindow) -> Vec<Monitor> {
    let mut all = win.available_monitors().unwrap_or_default();
    all.sort_by_key(origin);
    all
}

fn notch_of(notches: &[Notch], m: &Monitor) -> Option<Rect> {
    let b = bounds(m);
    notches
        .iter()
        .find(|n| (n.screen.x - b.x).abs() < 1.0 && (n.screen.y - b.y).abs() < 1.0)
        .map(|n| n.notch)
}

// NSScreen is main-thread only, so this runs there and the result is cached in Rail.
#[cfg(target_os = "macos")]
fn read_notches() -> Option<Vec<Notch>> {
    use objc2_app_kit::NSScreen;
    let mtm = objc2::MainThreadMarker::new()?;
    let screens = NSScreen::screens(mtm);
    // AppKit puts the origin at the bottom-left of the first screen, tauri at its top-left.
    let top = screens.firstObject()?.frame().size.height;
    Some(
        screens
            .iter()
            .filter_map(|s| {
                let f = s.frame();
                let h = s.safeAreaInsets().top;
                if h <= 0.0 {
                    return None;
                }
                let (left, right) = (s.auxiliaryTopLeftArea().size.width, s.auxiliaryTopRightArea().size.width);
                let screen = Rect { x: f.origin.x, y: top - f.origin.y - f.size.height, w: f.size.width, h: f.size.height };
                let notch = Rect { x: screen.x + left, y: screen.y, w: screen.w - left - right, h };
                Some(Notch { screen, notch })
            })
            .collect(),
    )
}

#[cfg(not(target_os = "macos"))]
fn read_notches() -> Option<Vec<Notch>> {
    Some(Vec::new())
}

fn refresh_notches(app: &AppHandle) {
    if let Some(notches) = read_notches() {
        app.state::<Mutex<Rail>>().lock().unwrap().notches = notches;
    }
}

// The menu bar is a Window Server window per screen that only exists while it shows,
// so its absence on a screen means an app is in full screen there. Owner and bounds
// are readable without the screen recording permission; window names are not.
#[cfg(target_os = "macos")]
fn menu_bar_showing(screen: Rect) -> bool {
    use objc2::runtime::AnyObject;
    use objc2_core_graphics::{kCGNullWindowID, CGWindowListCopyWindowInfo, CGWindowListOption};
    use objc2_foundation::{ns_string, NSArray, NSDictionary, NSNumber, NSString};
    type Dict = NSDictionary<NSString, AnyObject>;
    let Some(info) = CGWindowListCopyWindowInfo(CGWindowListOption::OptionOnScreenOnly, kCGNullWindowID) else {
        return true;
    };
    // CFArray of CFDictionary is toll-free bridged to NSArray of NSDictionary.
    let windows: &NSArray<Dict> = unsafe { &*(&*info as *const _ as *const NSArray<Dict>) };
    let number = |d: &Dict, key: &NSString| -> Option<f64> {
        d.objectForKey(key)?.downcast::<NSNumber>().ok().map(|n| n.as_f64())
    };
    windows.iter().any(|w| {
        let owner = w.objectForKey(ns_string!("kCGWindowOwnerName")).and_then(|o| o.downcast::<NSString>().ok());
        let Some(b) = w.objectForKey(ns_string!("kCGWindowBounds")) else { return false };
        let b: &Dict = unsafe { &*(&*b as *const AnyObject as *const Dict) };
        let (Some(x), Some(y), Some(width)) =
            (number(b, ns_string!("X")), number(b, ns_string!("Y")), number(b, ns_string!("Width")))
        else {
            return false;
        };
        number(&w, ns_string!("kCGWindowLayer")) == Some(24.0)
            && owner.is_some_and(|o| o.to_string() == "Window Server")
            && (y - screen.y).abs() < 1.0
            && x < screen.x + screen.w
            && x + width > screen.x
    })
}

#[cfg(not(target_os = "macos"))]
fn menu_bar_showing(_screen: Rect) -> bool {
    true
}

fn is_saved(m: &Monitor, p: &Placement) -> bool {
    p.monitor.is_some() && m.name() == p.monitor.as_ref()
}

// The saved monitor if it is still connected, otherwise the main one (the display
// with the menu bar). Never the monitor the window happens to be on, which is how
// the rail used to wander to another screen.
fn target_monitor(win: &WebviewWindow, p: &Placement) -> Option<Monitor> {
    let all = win.available_monitors().unwrap_or_default();
    all.iter()
        .find(|m| is_saved(m, p) && origin(m) == p.origin)
        .or_else(|| all.iter().find(|m| is_saved(m, p)))
        .cloned()
        .or(win.primary_monitor().ok().flatten())
}

struct Shown {
    edge: Edge,
    notch_screen: Option<Rect>,
    notch_zone: Option<Rect>,
}

// Collapsed it is a black bar the height of the notch: the whole strip when the menu
// bar is hidden, wings beside the notch when it shows. Expanded it drops a panel of
// nearly the whole screen from it. It sits over the menu bar, which the status window
// level of the panel already allows.
fn layout_notch(win: &WebviewWindow, rail: &Rail, notch: Rect, screen: Rect) -> tauri::Result<Shown> {
    let wings = Rect { x: notch.x - WING, y: notch.y, w: notch.w + 2.0 * WING, h: notch.h };
    let frame = if rail.expanded {
        Rect {
            x: screen.x + PANEL_MARGIN,
            y: screen.y,
            w: screen.w - 2.0 * PANEL_MARGIN,
            h: (screen.h * PANEL_HEIGHT).round(),
        }
    } else if rail.full {
        Rect { x: screen.x, y: screen.y, w: screen.w, h: notch.h }
    } else {
        wings
    };
    win.set_size(LogicalSize::new(frame.w, frame.h))?;
    win.set_position(LogicalPosition::new(frame.x, frame.y))?;
    Ok(Shown { edge: Edge::Notch, notch_screen: Some(screen), notch_zone: Some(wings) })
}

// Pinned to an edge of the work area (below the menu bar, beside the Dock). macOS
// has no API to reserve screen space, so it floats over whatever is there.
fn layout(win: &WebviewWindow, rail: &Rail) -> tauri::Result<Shown> {
    let Some(monitor) = target_monitor(win, &rail.placement) else {
        return Ok(Shown { edge: rail.shown, notch_screen: rail.notch_screen, notch_zone: rail.notch_zone });
    };
    let mut edge = rail.placement.edge;
    if edge == Edge::Notch {
        match notch_of(&rail.notches, &monitor) {
            Some(notch) => return layout_notch(win, rail, notch, bounds(&monitor)),
            None => edge = Edge::Right,
        }
    }
    let area = work_area(&monitor);
    let width = if rail.expanded { EXPANDED } else { COLLAPSED };
    let height = rail.height.clamp(40.0, area.h);
    win.set_size(LogicalSize::new(width, height))?;
    let x = if edge == Edge::Left { area.x } else { area.x + area.w - width };
    let y = (area.y + area.h * rail.placement.y - height / 2.0).clamp(area.y, area.y + area.h - height);
    win.set_position(LogicalPosition::new(x, y))?;
    Ok(Shown { edge, notch_screen: None, notch_zone: None })
}

// Window calls from a non-main thread wait on the main thread, so the lock is never
// held across them: a command running on the main thread may be waiting for it.
fn update(win: &WebviewWindow, rail: &Mutex<Rail>, change: impl FnOnce(&mut Rail)) {
    let snapshot = {
        let mut r = rail.lock().unwrap();
        change(&mut r);
        r.clone()
    };
    if snapshot.dragging {
        return;
    }
    let Ok(shown) = layout(win, &snapshot) else { return };
    {
        let mut r = rail.lock().unwrap();
        r.shown = shown.edge;
        r.notch_screen = shown.notch_screen;
        r.notch_zone = shown.notch_zone;
    }
    if shown.edge != snapshot.shown {
        let _ = win.emit("rail-edge", shown.edge);
    }
}

fn place(app: &AppHandle, win: &WebviewWindow, placement: Placement) {
    save_placement(app, &placement);
    update(win, &app.state::<Mutex<Rail>>(), |r| r.placement = placement);
}

fn set_expanded(app: &AppHandle, win: &WebviewWindow, expanded: bool, pinned: bool) {
    let rail = app.state::<Mutex<Rail>>();
    update(win, &rail, |r| {
        r.expanded = expanded;
        r.pinned = expanded && pinned;
    });
    let _ = win.emit("rail-expanded", expanded);
    #[cfg(target_os = "macos")]
    {
        let w = win.clone();
        if expanded && pinned {
            let _ = app.run_on_main_thread(move || take_focus(&w));
        } else if !expanded {
            let _ = app.run_on_main_thread(move || give_focus_back(&w));
        }
    }
}

#[tauri::command]
fn rail_height(win: WebviewWindow, rail: State<Mutex<Rail>>, height: f64) {
    update(&win, &rail, |r| r.height = height);
    if !win.is_visible().unwrap_or(false) {
        #[cfg(target_os = "macos")]
        show_without_focus(&win);
        #[cfg(not(target_os = "macos"))]
        let _ = win.show();
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct EdgeState {
    edge: Edge,
    full: bool,
    notch_width: f64,
}

#[tauri::command]
fn rail_edge(rail: State<Mutex<Rail>>) -> EdgeState {
    let r = rail.lock().unwrap();
    let notch_width = r.notch_zone.map_or(0.0, |z| z.w - 2.0 * WING);
    EdgeState { edge: r.shown, full: r.full, notch_width }
}

#[tauri::command]
fn rail_collapse(app: AppHandle, win: WebviewWindow) {
    set_expanded(&app, &win, false, false);
}

#[cfg(target_os = "macos")]
fn mouse_down() -> bool {
    objc2_app_kit::NSEvent::pressedMouseButtons() & 1 != 0
}

#[cfg(not(target_os = "macos"))]
fn mouse_down() -> bool {
    false
}

// The window follows the cursor while the button is held, then snaps to the nearest
// side of whichever monitor it was dropped on, or into the notch when dropped by it.
// Done by hand rather than with a native window drag so the drop is known exactly and
// the rail never takes focus.
#[tauri::command]
fn rail_drag(app: AppHandle, win: WebviewWindow) {
    let (Some(start), Some(frame)) = (cursor(&win), window_rect(&win)) else { return };
    let grab = (start.0 - frame.x, start.1 - frame.y);
    app.state::<Mutex<Rail>>().lock().unwrap().dragging = true;
    thread::spawn(move || {
        while mouse_down() {
            if let Some(c) = cursor(&win) {
                let _ = win.set_position(LogicalPosition::new(c.0 - grab.0, c.1 - grab.1));
            }
            thread::sleep(Duration::from_millis(12));
        }
        let rail = app.state::<Mutex<Rail>>();
        let (mut placement, notches) = {
            let r = rail.lock().unwrap();
            (r.placement.clone(), r.notches.clone())
        };
        if let (Some(c), Some(frame)) = (cursor(&win), window_rect(&win)) {
            let all = win.available_monitors().unwrap_or_default();
            let dropped = all.into_iter().find(|m| bounds(m).contains(c));
            if let Some(m) = dropped.or_else(|| target_monitor(&win, &placement)) {
                let area = work_area(&m);
                let by_notch = notch_of(&notches, &m).is_some_and(|n| {
                    (c.0 - (n.x + n.w / 2.0)).abs() < NOTCH_SNAP.0 && c.1 - n.y < NOTCH_SNAP.1
                });
                let edge = if by_notch {
                    Edge::Notch
                } else if c.0 < area.x + area.w / 2.0 {
                    Edge::Left
                } else {
                    Edge::Right
                };
                placement = Placement {
                    monitor: m.name().cloned(),
                    origin: origin(&m),
                    edge,
                    y: if by_notch {
                        placement.y
                    } else {
                        ((frame.y + frame.h / 2.0 - area.y) / area.h).clamp(0.0, 1.0)
                    },
                };
            }
        }
        rail.lock().unwrap().dragging = false;
        place(&app, &win, placement);
    });
}

#[tauri::command]
fn set_tray_title(app: AppHandle, title: String) {
    if let Some(tray) = app.tray_by_id(TRAY) {
        let _ = tray.set_title(Some(title));
    }
}

fn flip_edge(app: &AppHandle, win: &WebviewWindow) {
    let mut p = app.state::<Mutex<Rail>>().lock().unwrap().placement.clone();
    p.edge = if p.edge == Edge::Right { Edge::Left } else { Edge::Right };
    place(app, win, p);
}

fn next_monitor(app: &AppHandle, win: &WebviewWindow) {
    let mut p = app.state::<Mutex<Rail>>().lock().unwrap().placement.clone();
    let all = monitors_in_order(win);
    let Some(current) = target_monitor(win, &p) else { return };
    let i = all.iter().position(|m| origin(m) == origin(&current)).unwrap_or(0);
    let Some(next) = all.get((i + 1) % all.len().max(1)) else { return };
    p.monitor = next.name().cloned();
    p.origin = origin(next);
    place(app, win, p);
}

// Into the notch of the first screen that has one, or back out to its right edge.
fn toggle_notch(app: &AppHandle, win: &WebviewWindow) {
    refresh_notches(app);
    let rail = app.state::<Mutex<Rail>>();
    let (mut p, notches) = {
        let r = rail.lock().unwrap();
        (r.placement.clone(), r.notches.clone())
    };
    if p.edge == Edge::Notch {
        p.edge = Edge::Right;
    } else {
        let Some(m) = monitors_in_order(win).into_iter().find(|m| notch_of(&notches, m).is_some()) else { return };
        p.monitor = m.name().cloned();
        p.origin = origin(&m);
        p.edge = Edge::Notch;
    }
    place(app, win, p);
}

fn toggle_from_keyboard(app: &AppHandle) {
    let Some(win) = app.get_webview_window("rail") else { return };
    let expanded = app.state::<Mutex<Rail>>().lock().unwrap().expanded;
    set_expanded(app, &win, !expanded, true);
}

// Polled instead of DOM hover: the webview of a window that isn't key doesn't get
// reliable mouse-enter events, and the rail is never meant to take focus.
fn watch_hover(app: AppHandle) {
    thread::spawn(move || {
        let mut outside_since: Option<Instant> = None;
        let mut pinned_at = Instant::now();
        let mut menu_at = Instant::now();
        let mut over = false;
        loop {
            thread::sleep(Duration::from_millis(120));
            let Some(win) = app.get_webview_window("rail") else { continue };
            if !win.is_visible().unwrap_or(false) {
                continue;
            }
            let rail = app.state::<Mutex<Rail>>();
            let r = rail.lock().unwrap().clone();
            if r.dragging {
                continue;
            }
            if let (Edge::Notch, Some(screen)) = (r.shown, r.notch_screen) {
                if menu_at.elapsed() >= MENU_EVERY {
                    menu_at = Instant::now();
                    // The menu bar check still covers "always hide the menu bar" on a desktop.
                    let full = full_screen_space().unwrap_or(false) || !menu_bar_showing(screen);
                    if full != r.full {
                        update(&win, &rail, |r| r.full = full);
                        let _ = win.emit("rail-full", full);
                    }
                }
            }
            let (Some(c), Some(frame)) = (cursor(&win), window_rect(&win)) else { continue };
            // The full-width bar would drop the panel every time the cursor went up for
            // the menu of a full-screen app; only the notch and its wings open it.
            let zone = if r.shown == Edge::Notch && !r.expanded { r.notch_zone.unwrap_or(frame) } else { frame };
            let inside = zone.contains(c);
            let now_over = frame.contains(c);
            if now_over != over {
                over = now_over;
                let _ = win.emit("rail-hover", over);
            }
            if r.pinned {
                continue;
            }
            let want = if inside {
                outside_since = None;
                true
            } else {
                r.expanded && outside_since.get_or_insert_with(Instant::now).elapsed() < LINGER
            };
            if want != r.expanded {
                if !want {
                    outside_since = None;
                }
                set_expanded(&app, &win, want, false);
            } else if !r.expanded && pinned_at.elapsed() >= REPIN_EVERY {
                pinned_at = Instant::now();
                let handle = app.clone();
                let _ = app.run_on_main_thread(move || refresh_notches(&handle));
                update(&win, &rail, |_| {});
            }
        }
    });
}

#[cfg(target_os = "macos")]
fn ns_window(win: &WebviewWindow) -> Option<&objc2_app_kit::NSWindow> {
    let ptr = win.ns_window().ok()?;
    Some(unsafe { &*(ptr as *const objc2_app_kit::NSWindow) })
}

// A borderless window can't become key, so the panel would never get the arrow keys
// and Esc; this subclass says it can. Still non-activating, so taking the keyboard
// doesn't bring the app forward or take the menu bar from the app you were in.
#[cfg(target_os = "macos")]
objc2::define_class!(
    #[unsafe(super(objc2_app_kit::NSPanel, objc2_app_kit::NSWindow, objc2_app_kit::NSResponder, objc2_foundation::NSObject))]
    #[thread_kind = objc2::MainThreadOnly]
    #[name = "AgentBoardPanel"]
    struct KeyPanel;

    impl KeyPanel {
        #[unsafe(method(canBecomeKeyWindow))]
        fn can_become_key_window(&self) -> bool {
            true
        }
    }
);

// A plain NSWindow from another app never shows over a full-screen Space; a
// non-activating NSPanel does, and clicking it doesn't steal focus from your app.
#[cfg(target_os = "macos")]
fn make_panel(win: &WebviewWindow) {
    use objc2::ClassType;
    use objc2_app_kit::{NSStatusWindowLevel, NSWindowCollectionBehavior as B, NSWindowStyleMask};
    let Some(ns) = ns_window(win) else { return };
    unsafe {
        objc2::ffi::object_setClass(ns as *const _ as *mut objc2::runtime::AnyObject, KeyPanel::class());
    }
    ns.setStyleMask(ns.styleMask() | NSWindowStyleMask::NonactivatingPanel);
    ns.setHidesOnDeactivate(false);
    ns.setCollectionBehavior(B::CanJoinAllSpaces | B::FullScreenAuxiliary | B::Stationary | B::IgnoresCycle);
    ns.setLevel(NSStatusWindowLevel);
    PANEL_WINDOW.store(ns.windowNumber() as u32, std::sync::atomic::Ordering::Relaxed);
}

#[cfg(target_os = "macos")]
static PANEL_WINDOW: std::sync::atomic::AtomicU32 = std::sync::atomic::AtomicU32::new(0);

// Whether the Space showing on the panel's display is an app in full screen. The
// Menubar window can't tell: Window Server keeps listing it, on screen and opaque,
// while it is hidden over a full-screen app. There is no public API for Space types,
// so this asks SkyLight, as yabai and AeroSpace do; None when it can't be loaded.
#[cfg(target_os = "macos")]
fn full_screen_space() -> Option<bool> {
    use std::ffi::{c_char, c_int, c_void, CStr};
    use std::sync::OnceLock;
    type MainConnection = unsafe extern "C" fn() -> c_int;
    type DisplayForWindow = unsafe extern "C" fn(c_int, u32) -> *const c_void;
    type CurrentSpace = unsafe extern "C" fn(c_int, *const c_void) -> u64;
    type SpaceType = unsafe extern "C" fn(c_int, u64) -> c_int;
    struct SkyLight {
        main: MainConnection,
        display: DisplayForWindow,
        current: CurrentSpace,
        kind: SpaceType,
    }
    extern "C" {
        fn dlopen(path: *const c_char, mode: c_int) -> *mut c_void;
        fn dlsym(handle: *mut c_void, symbol: *const c_char) -> *mut c_void;
    }
    #[link(name = "CoreFoundation", kind = "framework")]
    extern "C" {
        fn CFRelease(cf: *const c_void);
    }
    const FULL_SCREEN: c_int = 4;
    static SKYLIGHT: OnceLock<Option<SkyLight>> = OnceLock::new();
    let sl = SKYLIGHT
        .get_or_init(|| unsafe {
            let lib = c"/System/Library/PrivateFrameworks/SkyLight.framework/SkyLight";
            let h = dlopen(lib.as_ptr(), 1);
            if h.is_null() {
                return None;
            }
            let sym = |name: &CStr| {
                let p = dlsym(h, name.as_ptr());
                (!p.is_null()).then_some(p)
            };
            Some(SkyLight {
                main: std::mem::transmute::<*mut c_void, MainConnection>(sym(c"SLSMainConnectionID")?),
                display: std::mem::transmute::<*mut c_void, DisplayForWindow>(sym(c"SLSCopyManagedDisplayForWindow")?),
                current: std::mem::transmute::<*mut c_void, CurrentSpace>(sym(c"SLSManagedDisplayGetCurrentSpace")?),
                kind: std::mem::transmute::<*mut c_void, SpaceType>(sym(c"SLSSpaceGetType")?),
            })
        })
        .as_ref()?;
    let wid = PANEL_WINDOW.load(std::sync::atomic::Ordering::Relaxed);
    if wid == 0 {
        return None;
    }
    unsafe {
        let cid = (sl.main)();
        let display = (sl.display)(cid, wid);
        if display.is_null() {
            return None;
        }
        let space = (sl.current)(cid, display);
        CFRelease(display);
        Some((sl.kind)(cid, space) == FULL_SCREEN)
    }
}

#[cfg(not(target_os = "macos"))]
fn full_screen_space() -> Option<bool> {
    None
}

#[cfg(target_os = "macos")]
fn show_without_focus(win: &WebviewWindow) {
    if let Some(ns) = ns_window(win) {
        ns.orderFrontRegardless();
    }
}

#[cfg(target_os = "macos")]
fn take_focus(win: &WebviewWindow) {
    if let Some(ns) = ns_window(win) {
        ns.makeKeyAndOrderFront(None);
    }
}

// Ordering the panel out and back drops its key status, and the app that was active
// all along gets the keyboard again.
#[cfg(target_os = "macos")]
fn give_focus_back(win: &WebviewWindow) {
    if let Some(ns) = ns_window(win) {
        if ns.isKeyWindow() {
            ns.orderOut(None);
            ns.orderFrontRegardless();
        }
    }
}

fn main() {
    // A global hotkey wins over app shortcuts: while the rail runs, ⌘⇧A no longer reaches
    // Chromium's tab search, Slack's unreads or Finder's Applications folder.
    let toggle_key = Shortcut::new(Some(Modifiers::SUPER | Modifiers::SHIFT), Code::KeyA);
    tauri::Builder::default()
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(move |app, shortcut, event| {
                    if *shortcut == toggle_key && event.state() == ShortcutState::Pressed {
                        toggle_from_keyboard(app);
                    }
                })
                .build(),
        )
        .invoke_handler(tauri::generate_handler![rail_height, rail_edge, rail_drag, rail_collapse, set_tray_title])
        .on_window_event(|win, event| {
            if let WindowEvent::Focused(false) = event {
                let app = win.app_handle();
                let r = app.state::<Mutex<Rail>>().lock().unwrap().clone();
                if r.expanded && r.pinned {
                    if let Some(w) = app.get_webview_window("rail") {
                        set_expanded(app, &w, false, false);
                    }
                }
            }
        })
        .setup(move |app| {
            let placement = load_placement(app.handle());
            let notches = read_notches().unwrap_or_default();
            app.manage(Mutex::new(Rail {
                expanded: false,
                pinned: false,
                height: 120.0,
                dragging: false,
                placement,
                notches,
                full: false,
                shown: Edge::Right,
                notch_screen: None,
                notch_zone: None,
            }));

            #[cfg(target_os = "macos")]
            app.set_activation_policy(tauri::ActivationPolicy::Accessory);
            #[cfg(target_os = "macos")]
            make_panel(&app.get_webview_window("rail").expect("rail window"));

            {
                use tauri_plugin_global_shortcut::GlobalShortcutExt;
                if let Err(e) = app.global_shortcut().register(toggle_key) {
                    eprintln!("could not register ⌘⇧A, the panel opens on hover only: {e}");
                }
            }

            let toggle = MenuItem::with_id(app, "toggle", "Mostrar / ocultar riel", true, None::<&str>)?;
            let edge = MenuItem::with_id(app, "edge", "Pasar al otro borde", true, None::<&str>)?;
            let monitor = MenuItem::with_id(app, "monitor", "Pasar al siguiente monitor", true, None::<&str>)?;
            let notch = MenuItem::with_id(app, "notch", "Entrar / salir del notch", true, None::<&str>)?;
            let quit = MenuItem::with_id(app, "quit", "Salir", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&toggle, &edge, &monitor, &notch, &quit])?;
            TrayIconBuilder::with_id(TRAY)
                .title("AB")
                .menu(&menu)
                .show_menu_on_left_click(true)
                .on_menu_event(|app, e| {
                    let Some(w) = app.get_webview_window("rail") else { return };
                    match e.id().as_ref() {
                        "toggle" => {
                            if w.is_visible().unwrap_or(false) {
                                let _ = w.hide();
                            } else {
                                #[cfg(target_os = "macos")]
                                show_without_focus(&w);
                                #[cfg(not(target_os = "macos"))]
                                let _ = w.show();
                            }
                        }
                        "edge" => flip_edge(app, &w),
                        "monitor" => next_monitor(app, &w),
                        "notch" => toggle_notch(app, &w),
                        "quit" => app.exit(0),
                        _ => {}
                    }
                })
                .build(app)?;

            watch_hover(app.handle().clone());
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running the rail");
}
