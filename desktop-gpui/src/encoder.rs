//! Hardware H.264 encoding with VideoToolbox. Captured frames (BGRA at native
//! resolution) are scaled and converted on the GPU by a pixel-transfer session
//! into the encoder's own buffer pool, then encoded as real-time Baseline H.264
//! without B-frames. Output is Annex B (start codes, SPS/PPS before every IDR),
//! which webrtc-rs packetises for the phone.
//!
//! Using Apple's encoder (instead of a bundled software encoder) keeps CPU low
//! and relies on Apple's H.264 licence.

use std::{
    ffi::c_void,
    ptr,
    sync::{
        atomic::{AtomicBool, Ordering},
        Mutex,
    },
    time::{Duration, Instant},
};

use anyhow::{anyhow, bail, Result};
use core_foundation::{
    base::{kCFAllocatorDefault, CFAllocatorRef, CFRelease, CFTypeRef, TCFType},
    boolean::CFBoolean,
    dictionary::{CFDictionary, CFDictionaryRef},
    number::CFNumber,
    string::{CFString, CFStringRef},
};

type OSStatus = i32;
type Session = *mut c_void;
pub type PixelBufferRef = *mut c_void;
type SampleBufferRef = *mut c_void;

#[repr(C)]
#[derive(Clone, Copy)]
struct CMTime {
    value: i64,
    timescale: i32,
    flags: u32,
    epoch: i64,
}
const INVALID_TIME: CMTime = CMTime { value: 0, timescale: 0, flags: 0, epoch: 0 };
const H264: u32 = u32::from_be_bytes(*b"avc1");

type OutputCallback = extern "C" fn(*mut c_void, *mut c_void, OSStatus, u32, SampleBufferRef);

#[link(name = "VideoToolbox", kind = "framework")]
unsafe extern "C" {
    fn VTCompressionSessionCreate(
        allocator: CFAllocatorRef,
        width: i32,
        height: i32,
        codec: u32,
        encoder_specification: CFDictionaryRef,
        source_attributes: CFDictionaryRef,
        compressed_allocator: CFAllocatorRef,
        callback: OutputCallback,
        refcon: *mut c_void,
        out: *mut Session,
    ) -> OSStatus;
    fn VTSessionSetProperty(session: *mut c_void, key: CFStringRef, value: CFTypeRef) -> OSStatus;
    fn VTCompressionSessionPrepareToEncodeFrames(session: Session) -> OSStatus;
    fn VTCompressionSessionEncodeFrame(
        session: Session,
        image: PixelBufferRef,
        pts: CMTime,
        duration: CMTime,
        properties: CFDictionaryRef,
        source_refcon: *mut c_void,
        flags_out: *mut u32,
    ) -> OSStatus;
    fn VTCompressionSessionCompleteFrames(session: Session, until: CMTime) -> OSStatus;
    fn VTCompressionSessionInvalidate(session: Session);
    fn VTCompressionSessionGetPixelBufferPool(session: Session) -> *mut c_void;
    fn VTPixelTransferSessionCreate(allocator: CFAllocatorRef, out: *mut *mut c_void) -> OSStatus;
    fn VTPixelTransferSessionTransferImage(session: *mut c_void, source: PixelBufferRef, destination: PixelBufferRef) -> OSStatus;
    fn VTPixelTransferSessionInvalidate(session: *mut c_void);

    static kVTCompressionPropertyKey_RealTime: CFStringRef;
    static kVTCompressionPropertyKey_ProfileLevel: CFStringRef;
    static kVTProfileLevel_H264_Baseline_AutoLevel: CFStringRef;
    static kVTCompressionPropertyKey_AllowFrameReordering: CFStringRef;
    static kVTCompressionPropertyKey_MaxKeyFrameInterval: CFStringRef;
    static kVTCompressionPropertyKey_MaxKeyFrameIntervalDuration: CFStringRef;
    static kVTCompressionPropertyKey_AverageBitRate: CFStringRef;
    static kVTCompressionPropertyKey_ExpectedFrameRate: CFStringRef;
    static kVTEncodeFrameOptionKey_ForceKeyFrame: CFStringRef;
}

#[link(name = "CoreMedia", kind = "framework")]
unsafe extern "C" {
    fn CMSampleBufferGetDataBuffer(sample: SampleBufferRef) -> *mut c_void;
    fn CMBlockBufferGetDataLength(buffer: *mut c_void) -> usize;
    fn CMBlockBufferCopyDataBytes(buffer: *mut c_void, offset: usize, length: usize, destination: *mut c_void) -> OSStatus;
    fn CMSampleBufferGetFormatDescription(sample: SampleBufferRef) -> *mut c_void;
    fn CMVideoFormatDescriptionGetH264ParameterSetAtIndex(
        description: *mut c_void,
        index: usize,
        pointer: *mut *const u8,
        size: *mut usize,
        count: *mut usize,
        header_length: *mut i32,
    ) -> OSStatus;
}

#[link(name = "CoreVideo", kind = "framework")]
unsafe extern "C" {
    fn CVPixelBufferPoolCreatePixelBuffer(allocator: CFAllocatorRef, pool: *mut c_void, out: *mut PixelBufferRef) -> i32;
    fn CVPixelBufferLockBaseAddress(buffer: PixelBufferRef, flags: u64) -> i32;
    fn CVPixelBufferUnlockBaseAddress(buffer: PixelBufferRef, flags: u64) -> i32;
    fn CVPixelBufferGetPlaneCount(buffer: PixelBufferRef) -> usize;
    fn CVPixelBufferGetBaseAddressOfPlane(buffer: PixelBufferRef, plane: usize) -> *mut u8;
    fn CVPixelBufferGetBytesPerRowOfPlane(buffer: PixelBufferRef, plane: usize) -> usize;
    fn CVPixelBufferGetHeightOfPlane(buffer: PixelBufferRef, plane: usize) -> usize;
    fn CVPixelBufferGetWidthOfPlane(buffer: PixelBufferRef, plane: usize) -> usize;
}

/// One encoded access unit in Annex B form.
pub struct EncodedFrame {
    pub data: Vec<u8>,
    #[cfg_attr(not(test), allow(dead_code))]
    pub keyframe: bool,
    /// Time since the previous frame, for RTP timestamps.
    pub duration: Duration,
}

type Sink = Box<dyn Fn(EncodedFrame) + Send + Sync>;

struct CallbackState {
    sink: Sink,
    last: Mutex<Option<Instant>>,
}

pub struct Encoder {
    session: Session,
    transfer: *mut c_void,
    state: *mut CallbackState,
    started: Instant,
    force_keyframe: AtomicBool,
    /// Serialises encode calls and frame pacing.
    gate: Mutex<Option<Instant>>,
    frame_interval: Duration,
}

// VideoToolbox sessions may be used from any thread; calls are serialised by `gate`.
unsafe impl Send for Encoder {}
unsafe impl Sync for Encoder {}

/// Fits `width × height` inside `max_w × max_h`, keeping the aspect ratio, with even sides.
pub fn fit(width: u32, height: u32, max_w: u32, max_h: u32) -> (u32, u32) {
    let scale = (max_w as f64 / width.max(1) as f64).min(max_h as f64 / height.max(1) as f64).min(1.0);
    let even = |v: f64| ((v.round() as u32) & !1).max(2);
    (even(width as f64 * scale), even(height as f64 * scale))
}

fn check(status: OSStatus, what: &str) -> Result<()> {
    if status == 0 { Ok(()) } else { Err(anyhow!("{what} failed ({status}).")) }
}

impl Encoder {
    pub fn new(width: u32, height: u32, fps: u32, bitrate: u32, sink: Sink) -> Result<Self> {
        let state = Box::into_raw(Box::new(CallbackState { sink, last: Mutex::new(None) }));
        let mut session: Session = ptr::null_mut();
        let status = unsafe {
            VTCompressionSessionCreate(
                kCFAllocatorDefault,
                width as i32,
                height as i32,
                H264,
                ptr::null(),
                ptr::null(),
                kCFAllocatorDefault,
                output_callback,
                state as *mut c_void,
                &mut session,
            )
        };
        if status != 0 || session.is_null() {
            unsafe { drop(Box::from_raw(state)) };
            bail!("The video encoder could not start ({status}).");
        }
        let mut encoder = Self {
            session,
            transfer: ptr::null_mut(),
            state,
            started: Instant::now(),
            force_keyframe: AtomicBool::new(false),
            gate: Mutex::new(None),
            frame_interval: Duration::from_secs_f64(1.0 / fps.max(1) as f64),
        };
        unsafe {
            let set = |key: CFStringRef, value: CFTypeRef, what: &str| check(VTSessionSetProperty(session, key, value), what);
            set(kVTCompressionPropertyKey_RealTime, CFBoolean::true_value().as_CFTypeRef(), "Real-time encoding")?;
            set(kVTCompressionPropertyKey_ProfileLevel, kVTProfileLevel_H264_Baseline_AutoLevel as CFTypeRef, "H.264 Baseline profile")?;
            set(kVTCompressionPropertyKey_AllowFrameReordering, CFBoolean::false_value().as_CFTypeRef(), "Disabling B-frames")?;
            set(kVTCompressionPropertyKey_MaxKeyFrameInterval, CFNumber::from((fps * 2) as i32).as_CFTypeRef(), "Keyframe interval")?;
            set(kVTCompressionPropertyKey_MaxKeyFrameIntervalDuration, CFNumber::from(2.0f64).as_CFTypeRef(), "Keyframe duration")?;
            set(kVTCompressionPropertyKey_AverageBitRate, CFNumber::from(bitrate as i32).as_CFTypeRef(), "Bit rate")?;
            set(kVTCompressionPropertyKey_ExpectedFrameRate, CFNumber::from(fps as i32).as_CFTypeRef(), "Frame rate")?;
            check(VTCompressionSessionPrepareToEncodeFrames(session), "Preparing the video encoder")?;
            check(VTPixelTransferSessionCreate(kCFAllocatorDefault, &mut encoder.transfer), "Starting the video scaler")?;
        }
        Ok(encoder)
    }

    /// Requests an IDR frame next (the phone sent PLI/FIR, or a new viewer joined).
    pub fn request_keyframe(&self) {
        self.force_keyframe.store(true, Ordering::Relaxed);
    }

    /// A buffer from the encoder's pool (its preferred format and size), or None.
    fn pool_buffer(&self) -> Option<PixelBufferRef> {
        unsafe {
            let pool = VTCompressionSessionGetPixelBufferPool(self.session);
            if pool.is_null() {
                return None;
            }
            let mut buffer = ptr::null_mut();
            (CVPixelBufferPoolCreatePixelBuffer(kCFAllocatorDefault, pool, &mut buffer) == 0 && !buffer.is_null()).then_some(buffer)
        }
    }

    /// Paces to the frame rate, scales `source` into a pool buffer and encodes it.
    /// Frames that arrive faster than the frame rate are dropped.
    pub fn encode(&self, source: PixelBufferRef) -> Result<()> {
        let mut gate = self.gate.lock().unwrap();
        let now = Instant::now();
        if gate.is_some_and(|last| now.duration_since(last) < self.frame_interval.mul_f64(0.9)) {
            return Ok(());
        }
        let Some(target) = self.pool_buffer() else { bail!("The video encoder has no buffers.") };
        let result = unsafe { check(VTPixelTransferSessionTransferImage(self.transfer, source, target), "Scaling the screen image") }
            .and_then(|()| self.encode_buffer(target, now));
        unsafe { CFRelease(target as CFTypeRef) };
        if result.is_ok() {
            *gate = Some(now);
        }
        result
    }

    fn encode_buffer(&self, buffer: PixelBufferRef, now: Instant) -> Result<()> {
        let micros = now.duration_since(self.started).as_micros() as i64;
        let pts = CMTime { value: micros, timescale: 1_000_000, flags: 1, epoch: 0 };
        let force = self.force_keyframe.swap(false, Ordering::Relaxed);
        let properties = force.then(|| unsafe {
            CFDictionary::from_CFType_pairs(&[(CFString::wrap_under_get_rule(kVTEncodeFrameOptionKey_ForceKeyFrame).as_CFType(), CFBoolean::true_value().as_CFType())])
        });
        let status = unsafe {
            VTCompressionSessionEncodeFrame(
                self.session,
                buffer,
                pts,
                INVALID_TIME,
                properties.as_ref().map_or(ptr::null(), |p| p.as_concrete_TypeRef()),
                ptr::null_mut(),
                ptr::null_mut(),
            )
        };
        check(status, "Encoding a video frame")
    }

    /// Test pattern for automated tests, where Screen Recording cannot be granted:
    /// a moving bar over a gradient, written straight into a pool buffer.
    #[cfg_attr(not(feature = "e2e"), allow(dead_code))]
    pub fn encode_test_pattern(&self, frame: u64) -> Result<()> {
        let mut gate = self.gate.lock().unwrap();
        let Some(buffer) = self.pool_buffer() else { bail!("The video encoder has no buffers.") };
        unsafe {
            CVPixelBufferLockBaseAddress(buffer, 0);
            let planes = CVPixelBufferGetPlaneCount(buffer).max(1);
            for plane in 0..planes {
                let base = CVPixelBufferGetBaseAddressOfPlane(buffer, plane);
                let stride = CVPixelBufferGetBytesPerRowOfPlane(buffer, plane);
                let (w, h) = (CVPixelBufferGetWidthOfPlane(buffer, plane), CVPixelBufferGetHeightOfPlane(buffer, plane));
                if base.is_null() {
                    continue;
                }
                for y in 0..h {
                    let row = std::slice::from_raw_parts_mut(base.add(y * stride), stride);
                    if plane == 0 {
                        let bar = (frame as usize * 8) % w.max(1);
                        for (x, value) in row.iter_mut().take(w).enumerate() {
                            *value = if x.abs_diff(bar) < 24 { 235 } else { 16 + (x * 200 / w.max(1)) as u8 };
                        }
                    } else {
                        row.iter_mut().take(w * 2).for_each(|v| *v = 128);
                    }
                }
            }
            CVPixelBufferUnlockBaseAddress(buffer, 0);
        }
        let now = Instant::now();
        let result = self.encode_buffer(buffer, now);
        unsafe { CFRelease(buffer as CFTypeRef) };
        *gate = Some(now);
        result
    }
}

impl Drop for Encoder {
    fn drop(&mut self) {
        unsafe {
            VTCompressionSessionCompleteFrames(self.session, INVALID_TIME);
            VTCompressionSessionInvalidate(self.session);
            CFRelease(self.session as CFTypeRef);
            if !self.transfer.is_null() {
                VTPixelTransferSessionInvalidate(self.transfer);
                CFRelease(self.transfer as CFTypeRef);
            }
            // No callbacks run after invalidation.
            drop(Box::from_raw(self.state));
        }
    }
}

extern "C" fn output_callback(refcon: *mut c_void, _source: *mut c_void, status: OSStatus, _flags: u32, sample: SampleBufferRef) {
    if status != 0 || sample.is_null() || refcon.is_null() {
        return;
    }
    let state = unsafe { &*(refcon as *const CallbackState) };
    let Some((data, keyframe)) = (unsafe { annex_b(sample) }) else { return };
    let now = Instant::now();
    let duration = {
        let mut last = state.last.lock().unwrap();
        let duration = last.map_or(Duration::from_millis(33), |l| now.duration_since(l));
        *last = Some(now);
        duration
    };
    (state.sink)(EncodedFrame { data, keyframe, duration });
}

/// Converts VideoToolbox's length-prefixed (AVCC) output to Annex B, adding SPS/PPS before IDR frames.
unsafe fn annex_b(sample: SampleBufferRef) -> Option<(Vec<u8>, bool)> {
    unsafe {
        let block = CMSampleBufferGetDataBuffer(sample);
        if block.is_null() {
            return None;
        }
        let length = CMBlockBufferGetDataLength(block);
        let mut avcc = vec![0u8; length];
        if CMBlockBufferCopyDataBytes(block, 0, length, avcc.as_mut_ptr() as *mut c_void) != 0 {
            return None;
        }
        let units = split_avcc(&avcc)?;
        let keyframe = units.iter().any(|unit| unit.first().is_some_and(|b| b & 0x1f == 5));
        let mut out = Vec::with_capacity(length + 64);
        if keyframe {
            let description = CMSampleBufferGetFormatDescription(sample);
            let mut count = 0usize;
            let mut header = 0i32;
            let mut index = 0;
            loop {
                let (mut pointer, mut size) = (ptr::null(), 0usize);
                if CMVideoFormatDescriptionGetH264ParameterSetAtIndex(description, index, &mut pointer, &mut size, &mut count, &mut header) != 0 {
                    break;
                }
                out.extend_from_slice(&[0, 0, 0, 1]);
                out.extend_from_slice(std::slice::from_raw_parts(pointer, size));
                index += 1;
                if index >= count {
                    break;
                }
            }
        }
        for unit in units {
            out.extend_from_slice(&[0, 0, 0, 1]);
            out.extend_from_slice(unit);
        }
        Some((out, keyframe))
    }
}

/// Splits 4-byte big-endian length-prefixed NAL units.
fn split_avcc(mut data: &[u8]) -> Option<Vec<&[u8]>> {
    let mut units = Vec::new();
    while !data.is_empty() {
        if data.len() < 4 {
            return None;
        }
        let size = u32::from_be_bytes([data[0], data[1], data[2], data[3]]) as usize;
        let unit = data.get(4..4 + size)?;
        units.push(unit);
        data = &data[4 + size..];
    }
    Some(units)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn fits_inside_1080p_with_even_sides() {
        assert_eq!(fit(3024, 1964, 1920, 1080), (1662, 1080));
        assert_eq!(fit(5120, 2880, 1920, 1080), (1920, 1080));
        assert_eq!(fit(1280, 800, 1920, 1080), (1280, 800));
        assert_eq!(fit(1001, 777, 1920, 1080), (1000, 776));
    }

    #[test]
    fn splits_length_prefixed_units() {
        let data = [0, 0, 0, 2, 0x65, 1, 0, 0, 0, 1, 0x41];
        assert_eq!(split_avcc(&data).unwrap(), vec![&[0x65, 1][..], &[0x41][..]]);
        assert!(split_avcc(&[0, 0, 0, 9, 1]).is_none());
    }

    /// Runs the real hardware encoder on a few test-pattern frames.
    #[test]
    fn encodes_h264_with_parameter_sets() {
        let frames = std::sync::Arc::new(Mutex::new(Vec::<EncodedFrame>::new()));
        let sink = frames.clone();
        let encoder = Encoder::new(640, 360, 30, 1_000_000, Box::new(move |f| sink.lock().unwrap().push(f))).unwrap();
        for i in 0..5 {
            encoder.encode_test_pattern(i).unwrap();
            std::thread::sleep(Duration::from_millis(34));
        }
        drop(encoder); // completes pending frames
        let frames = frames.lock().unwrap();
        assert!(!frames.is_empty());
        let first = &frames[0];
        assert!(first.keyframe);
        assert_eq!(&first.data[..4], &[0, 0, 0, 1]);
        assert_eq!(first.data[4] & 0x1f, 7, "SPS first");
        assert_eq!(first.data[5], 66, "Baseline profile");
    }
}
