//! Browser bindings for [vtracer](https://crates.io/crates/vtracer).
//!
//! vtracer is MIT/Apache-2.0 and compiles cleanly to `wasm32-unknown-unknown`,
//! so the app compiles it from source rather than depending on the npm
//! `vtracer-wasm` package, which declares no licence at all. The obvious
//! alternative, potrace, is GPL-2.0 and would force the whole app to GPL.

use vtracer::{ColorImage, ColorMode, Config, Hierarchical};
use visioncortex::PathSimplifyMode;
use wasm_bindgen::prelude::*;

/// Tracing parameters, mirroring vtracer's own config with friendlier names.
///
/// A plain struct with public Copy fields so wasm-bindgen can generate
/// getters and setters, which keeps serde out of the dependency tree.
#[wasm_bindgen]
#[derive(Clone, Copy, Debug)]
pub struct TraceOptions {
    /// Discard shapes smaller than this many pixels. The speckle filter.
    pub filter_speckle: usize,
    /// Colour quantisation: lower keeps fewer, flatter colours.
    pub color_precision: i32,
    /// How different two layers must be before they are kept apart.
    pub layer_difference: i32,
    /// Corner angle threshold, in degrees.
    pub corner_threshold: i32,
    /// Minimum segment length before a corner is considered.
    pub length_threshold: f64,
    /// How aggressively adjacent curves are spliced together.
    pub splice_threshold: i32,
    /// Curve-fitting iteration cap.
    pub max_iterations: usize,
    /// Decimal places kept in path coordinates.
    pub path_precision: u32,
    /// Fit smooth splines rather than emitting raw polygons.
    pub spline: bool,
    /// Cut shapes out of one another instead of stacking them.
    pub cutout: bool,
    /// Trace as black and white rather than colour.
    pub binary: bool,
}

impl Default for TraceOptions {
    fn default() -> Self {
        // vtracer's own defaults, which are a sensible starting point for logos.
        Self {
            filter_speckle: 4,
            color_precision: 6,
            layer_difference: 16,
            corner_threshold: 60,
            length_threshold: 4.0,
            splice_threshold: 45,
            max_iterations: 10,
            path_precision: 2,
            spline: true,
            cutout: false,
            binary: false,
        }
    }
}

#[wasm_bindgen]
impl TraceOptions {
    #[wasm_bindgen(constructor)]
    pub fn new() -> TraceOptions {
        TraceOptions::default()
    }
}

impl From<TraceOptions> for Config {
    fn from(o: TraceOptions) -> Config {
        Config {
            color_mode: if o.binary { ColorMode::Binary } else { ColorMode::Color },
            hierarchical: if o.cutout { Hierarchical::Cutout } else { Hierarchical::Stacked },
            filter_speckle: o.filter_speckle,
            color_precision: o.color_precision,
            layer_difference: o.layer_difference,
            mode: if o.spline { PathSimplifyMode::Spline } else { PathSimplifyMode::Polygon },
            corner_threshold: o.corner_threshold,
            length_threshold: o.length_threshold,
            max_iterations: o.max_iterations,
            splice_threshold: o.splice_threshold,
            path_precision: Some(o.path_precision),
        }
    }
}

/// Traces an RGBA raster into an SVG document.
///
/// `rgba` must be exactly `width * height * 4` bytes, as produced by
/// `CanvasRenderingContext2D.getImageData`.
#[wasm_bindgen]
pub fn trace(
    rgba: &[u8],
    width: usize,
    height: usize,
    options: &TraceOptions,
) -> Result<String, JsError> {
    let expected = width
        .checked_mul(height)
        .and_then(|p| p.checked_mul(4))
        .ok_or_else(|| JsError::new("Image dimensions overflow"))?;

    if rgba.len() != expected {
        return Err(JsError::new(&format!(
            "Expected {expected} bytes for {width}x{height}, got {}",
            rgba.len()
        )));
    }
    if width == 0 || height == 0 {
        return Err(JsError::new("Image has no pixels"));
    }

    let image = ColorImage {
        pixels: rgba.to_vec(),
        width,
        height,
    };

    vtracer::convert(image, (*options).into())
        .map(|svg| svg.to_string())
        .map_err(|e| JsError::new(&e))
}
