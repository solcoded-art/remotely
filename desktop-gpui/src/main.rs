//! Mac Remote desktop companion, GPUI build. Milestone 1: sign-in and devices.
//! See ../docs/gpui-desktop.md.

mod account;
mod app;
mod commands;
mod connection;
mod driver;
mod encoder;
#[cfg(feature = "e2e")]
mod e2e;
mod log;
mod identity;
mod peer;
mod platform;
mod qr;
mod signaling;
mod store;
mod text_input;
mod theme;
mod trust;
mod vault;

use gpui::{actions, prelude::*, px, size, App, Application, Bounds, KeyBinding, Menu, MenuItem, TitlebarOptions, WindowBounds, WindowOptions};

actions!(mac_remote, [Quit]);

fn main() {
    // ureq and tungstenite share rustls; pick one crypto provider for the process.
    let _ = rustls::crypto::ring::default_provider().install_default();
    log::log(concat!("Mac Remote GPUI ", env!("CARGO_PKG_VERSION"), " started"));
    Application::new().run(|cx: &mut App| {
        text_input::bind_keys(cx);
        cx.on_action(|_: &Quit, cx| cx.quit());
        cx.bind_keys([KeyBinding::new("cmd-q", Quit, None)]);
        cx.set_menus(vec![Menu { name: "Mac Remote".into(), items: vec![MenuItem::action("Quit Mac Remote", Quit)] }]);
        cx.on_window_closed(|cx| cx.quit()).detach();

        let bounds = Bounds::centered(None, size(px(1180.), px(820.)), cx);
        let window = cx.open_window(
            WindowOptions {
                window_bounds: Some(WindowBounds::Windowed(bounds)),
                window_min_size: Some(size(px(620.), px(580.))),
                titlebar: Some(TitlebarOptions { title: Some("Mac Remote".into()), ..Default::default() }),
                ..Default::default()
            },
            |window, cx| cx.new(|cx| app::MacRemote::new(window, cx)),
        )
        .expect("open the Mac Remote window");
        #[cfg(feature = "e2e")]
        if let Ok(view) = window.update(cx, |_, _, cx| cx.entity()) {
            e2e::attach(view, cx);
        }
        let _ = window;
        cx.activate(true);
    });
}
