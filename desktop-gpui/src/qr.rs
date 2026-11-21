//! Pairing QR code painted directly on a GPUI canvas (error correction M,
//! four-module quiet zone, like `QRCode.toDataURL(..., { margin: 4, errorCorrectionLevel: 'M' })`).

use gpui::{canvas, fill, point, prelude::*, px, rgb, size, Bounds, Pixels};
use qrcode::{Color, EcLevel, QrCode};

const QUIET: usize = 4;

pub fn qr(link: &str, side: Pixels) -> Option<impl IntoElement> {
    let code = QrCode::with_error_correction_level(link.as_bytes(), EcLevel::M).ok()?;
    let width = code.width();
    let colors = code.into_colors();
    Some(
        canvas(
            |_, _, _| (),
            move |bounds: Bounds<Pixels>, _, window, _| {
                window.paint_quad(fill(bounds, rgb(0xffffff)));
                let modules = (width + QUIET * 2) as f32;
                let cell = bounds.size.width / modules;
                for row in 0..width {
                    // One quad per horizontal run of dark modules.
                    let mut col = 0;
                    while col < width {
                        if colors[row * width + col] != Color::Dark {
                            col += 1;
                            continue;
                        }
                        let start = col;
                        while col < width && colors[row * width + col] == Color::Dark {
                            col += 1;
                        }
                        let origin = point(
                            bounds.left() + cell * (start + QUIET) as f32,
                            bounds.top() + cell * (row + QUIET) as f32,
                        );
                        // Slight overlap avoids hairline seams between rows at fractional scales.
                        window.paint_quad(fill(Bounds::new(origin, size(cell * (col - start) as f32, cell + px(0.25))), rgb(0x000000)));
                    }
                }
            },
        )
        .size(side),
    )
}
