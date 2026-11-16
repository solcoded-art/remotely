import Foundation
import CoreGraphics
import AppKit
import ApplicationServices

// Disable buffering on stdout
setbuf(stdout, nil)

var mainDisplay = CGMainDisplayID()
var heldButtons = Set<UInt32>()

func reply(_ json: [String: Any], _ values: [String: Any]) {
    var output = values
    output["action"] = json["action"]
    output["requestId"] = json["requestId"]
    if let data = try? JSONSerialization.data(withJSONObject: output), let text = String(data: data, encoding: .utf8) {
        print(text)
    }
}

func releaseButtons() {
    if heldButtons.isEmpty { return }
    let pos = getCursorPos()
    for (eventType, button) in [(CGEventType.leftMouseUp, CGMouseButton.left), (.rightMouseUp, .right)] {
        if heldButtons.contains(button.rawValue) {
            CGEvent(mouseEventSource: nil, mouseType: eventType, mouseCursorPosition: pos, mouseButton: button)?.post(tap: .cghidEventTap)
        }
    }
    heldButtons.removeAll()
}

func getDisplayBounds() -> CGRect {
    return CGDisplayBounds(mainDisplay)
}

func getCursorPos() -> CGPoint {
    if let event = CGEvent(source: nil) {
        return event.location
    }
    return CGPoint.zero
}

func clamp(pos: CGPoint, bounds: CGRect) -> CGPoint {
    let x = max(bounds.minX, min(pos.x, bounds.maxX - 1))
    let y = max(bounds.minY, min(pos.y, bounds.maxY - 1))
    return CGPoint(x: x, y: y)
}

func handleCommand(_ json: [String: Any]) {
    guard let action = json["action"] as? String else { return }
    let bounds = getDisplayBounds()

    switch action {
    case "setDisplay":
        if let id = (json["displayId"] as? NSNumber)?.uint32Value, CGDisplayIsActive(id) != 0 { mainDisplay = id }

    case "releaseAll":
        releaseButtons()

    case "status":
        reply(json, ["accessibility": AXIsProcessTrusted(), "screen": CGPreflightScreenCaptureAccess()])

    case "listApps":
        let frontmost = NSWorkspace.shared.frontmostApplication?.processIdentifier
        let apps = NSWorkspace.shared.runningApplications.filter { $0.activationPolicy == .regular && !$0.isTerminated }.map { app -> [String: Any] in
            return ["pid": app.processIdentifier, "name": app.localizedName ?? "Application", "bundleId": app.bundleIdentifier ?? "", "active": app.processIdentifier == frontmost]
        }.sorted { ($0["name"] as? String ?? "") < ($1["name"] as? String ?? "") }
        reply(json, ["apps": apps])

    case "activateApp":
        guard let pid = (json["pid"] as? NSNumber)?.int32Value,
              let app = NSRunningApplication(processIdentifier: pid), app.activationPolicy == .regular else {
            reply(json, ["error": "Application is no longer running."]); return
        }
        reply(json, ["ok": app.activate(options: [])])

    case "launchApp":
        let allowed = ["com.microsoft.VSCode", "com.todesktop.230313mzl4w4u92", "dev.zed.Zed", "com.apple.dt.Xcode", "com.apple.Terminal", "com.apple.finder", "com.apple.Safari", "com.google.Chrome"]
        guard let id = json["bundleId"] as? String, allowed.contains(id) else { return }
        guard NSWorkspace.shared.urlForApplication(withBundleIdentifier: id) != nil else { reply(json, ["error": "This app is not installed on your Mac."]); return }
        let process = Process()
        process.executableURL = URL(fileURLWithPath: "/usr/bin/open")
        process.arguments = ["-b", id]
        do { try process.run(); process.waitUntilExit(); reply(json, ["ok": process.terminationStatus == 0]) }
        catch { reply(json, ["error": "Could not launch application."]) }

    case "getBounds":
        let output = "{\"status\":\"ok\",\"action\":\"getBounds\",\"width\":\(bounds.width),\"height\":\(bounds.height)}\n"
        fputs(output, stdout)

    case "getPos":
        let pos = getCursorPos()
        let output = "{\"status\":\"ok\",\"action\":\"getPos\",\"x\":\(pos.x),\"y\":\(pos.y)}\n"
        fputs(output, stdout)

    case "move":
        guard let dx = (json["dx"] as? NSNumber)?.doubleValue,
              let dy = (json["dy"] as? NSNumber)?.doubleValue else { return }
        let current = getCursorPos()
        let target = clamp(pos: CGPoint(x: current.x + CGFloat(dx), y: current.y + CGFloat(dy)), bounds: bounds)
        if let moveEvt = CGEvent(mouseEventSource: nil, mouseType: .mouseMoved, mouseCursorPosition: target, mouseButton: .left) {
            moveEvt.post(tap: .cghidEventTap)
        }

    case "drag":
        guard let dx = (json["dx"] as? NSNumber)?.doubleValue,
              let dy = (json["dy"] as? NSNumber)?.doubleValue else { return }
        let current = getCursorPos()
        let target = clamp(pos: CGPoint(x: current.x + CGFloat(dx), y: current.y + CGFloat(dy)), bounds: bounds)
        if let dragEvt = CGEvent(mouseEventSource: nil, mouseType: .leftMouseDragged, mouseCursorPosition: target, mouseButton: .left) {
            dragEvt.post(tap: .cghidEventTap)
        }

    case "moveTo":
        guard let normX = (json["normX"] as? NSNumber)?.doubleValue,
              let normY = (json["normY"] as? NSNumber)?.doubleValue else { return }
        let targetX = bounds.minX + CGFloat(normX) * bounds.width
        let targetY = bounds.minY + CGFloat(normY) * bounds.height
        let target = clamp(pos: CGPoint(x: targetX, y: targetY), bounds: bounds)
        if let moveEvt = CGEvent(mouseEventSource: nil, mouseType: .mouseMoved, mouseCursorPosition: target, mouseButton: .left) {
            moveEvt.post(tap: .cghidEventTap)
        }

    case "click":
        let btn = (json["button"] as? String) ?? "left"
        let isDouble = (btn == "double")
        let actualBtn = isDouble ? "left" : btn
        let pos = getCursorPos()

        let downType: CGEventType = (actualBtn == "right") ? .rightMouseDown : .leftMouseDown
        let upType: CGEventType = (actualBtn == "right") ? .rightMouseUp : .leftMouseUp
        let mouseBtn: CGMouseButton = (actualBtn == "right") ? .right : .left

        if let down = CGEvent(mouseEventSource: nil, mouseType: downType, mouseCursorPosition: pos, mouseButton: mouseBtn),
           let up = CGEvent(mouseEventSource: nil, mouseType: upType, mouseCursorPosition: pos, mouseButton: mouseBtn) {
            if isDouble {
                down.setIntegerValueField(.mouseEventClickState, value: 1)
                up.setIntegerValueField(.mouseEventClickState, value: 1)
                down.post(tap: .cghidEventTap)
                up.post(tap: .cghidEventTap)
                usleep(50000) // 50ms between clicks
                down.setIntegerValueField(.mouseEventClickState, value: 2)
                up.setIntegerValueField(.mouseEventClickState, value: 2)
                down.post(tap: .cghidEventTap)
                up.post(tap: .cghidEventTap)
            } else {
                down.post(tap: .cghidEventTap)
                usleep(15000) // 15ms click duration
                up.post(tap: .cghidEventTap)
            }
        }

    case "down":
        let btn = (json["button"] as? String) ?? "left"
        let pos = getCursorPos()
        let downType: CGEventType = (btn == "right") ? .rightMouseDown : .leftMouseDown
        let mouseBtn: CGMouseButton = (btn == "right") ? .right : .left
        if let down = CGEvent(mouseEventSource: nil, mouseType: downType, mouseCursorPosition: pos, mouseButton: mouseBtn) {
            down.post(tap: .cghidEventTap)
            heldButtons.insert(mouseBtn.rawValue)
        }

    case "up":
        let btn = (json["button"] as? String) ?? "left"
        let pos = getCursorPos()
        let upType: CGEventType = (btn == "right") ? .rightMouseUp : .leftMouseUp
        let mouseBtn: CGMouseButton = (btn == "right") ? .right : .left
        if let up = CGEvent(mouseEventSource: nil, mouseType: upType, mouseCursorPosition: pos, mouseButton: mouseBtn) {
            up.post(tap: .cghidEventTap)
            heldButtons.remove(mouseBtn.rawValue)
        }

    case "scroll":
        let dx = Int32((json["dx"] as? NSNumber)?.intValue ?? 0)
        let dy = Int32((json["dy"] as? NSNumber)?.intValue ?? 0)
        // wheel1: Y (vertical scroll), wheel2: X (horizontal scroll)
        if let scrollEvt = CGEvent(scrollWheelEvent2Source: nil, units: .pixel, wheelCount: 2, wheel1: dy, wheel2: dx, wheel3: 0) {
            scrollEvt.post(tap: .cghidEventTap)
        }

    case "key":
        guard let code = (json["code"] as? NSNumber)?.uint16Value else { return }
        let modifiers = (json["modifiers"] as? [String]) ?? []

        if let down = CGEvent(keyboardEventSource: nil, virtualKey: code, keyDown: true),
           let up = CGEvent(keyboardEventSource: nil, virtualKey: code, keyDown: false) {
            var flags: CGEventFlags = []
            if modifiers.contains("cmd") { flags.insert(.maskCommand) }
            if modifiers.contains("shift") { flags.insert(.maskShift) }
            if modifiers.contains("alt") || modifiers.contains("opt") { flags.insert(.maskAlternate) }
            if modifiers.contains("ctrl") { flags.insert(.maskControl) }

            down.flags = flags
            up.flags = flags

            down.post(tap: .cghidEventTap)
            usleep(15000)
            up.post(tap: .cghidEventTap)
        }

    case "type":
        guard let text = json["text"] as? String else { return }
        for char in text {
            let str = String(char)
            let utf16 = Array(str.utf16)
            if let down = CGEvent(keyboardEventSource: nil, virtualKey: 0, keyDown: true),
               let up = CGEvent(keyboardEventSource: nil, virtualKey: 0, keyDown: false) {
                down.keyboardSetUnicodeString(stringLength: utf16.count, unicodeString: utf16)
                up.keyboardSetUnicodeString(stringLength: utf16.count, unicodeString: utf16)
                down.post(tap: .cghidEventTap)
                up.post(tap: .cghidEventTap)
                usleep(2000)
            }
        }

    default:
        break
    }
}

// Keep AppKit's main run loop alive so workspace/app activation state stays current.
// A single pending command bounds the queue and preserves input ordering.
DispatchQueue.global(qos: .userInteractive).async {
    let pending = DispatchSemaphore(value: 1)
    // readLine preserves UTF-8 characters even when a pipe splits their bytes.
    while let line = readLine() {
        if line.utf8.count > 65536 { continue }
        if let data = line.data(using: .utf8), let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any] {
            pending.wait()
            DispatchQueue.main.async { handleCommand(json); pending.signal() }
        }
    }
    DispatchQueue.main.async { releaseButtons(); exit(0) }
}
RunLoop.main.run()
