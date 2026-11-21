//! Dark palette matching the Electron app's `backgroundColor: '#0a0a0c'` shell.

use gpui::{rgb, Hsla};

pub fn background() -> Hsla { rgb(0x0a0a0c).into() }
pub fn card() -> Hsla { rgb(0x14141a).into() }
pub fn border() -> Hsla { rgb(0x2a2a33).into() }
pub fn text() -> Hsla { rgb(0xf2f2f5).into() }
pub fn muted() -> Hsla { rgb(0x8d8d9b).into() }
pub fn accent() -> Hsla { rgb(0x8b9bff).into() }
pub fn accent_text() -> Hsla { rgb(0x0b0b10).into() }
pub fn danger() -> Hsla { rgb(0xff7a7a).into() }
pub fn success() -> Hsla { rgb(0x34d399).into() }
pub fn notice() -> Hsla { rgb(0x1b1b24).into() }
