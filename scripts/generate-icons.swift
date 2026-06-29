import AppKit
import Darwin
import Foundation

let fileManager = FileManager.default

func findRepoRoot(from start: URL) throws -> URL {
    var directory = start
    while true {
        let package = directory.appendingPathComponent("package.json").path
        let desktop = directory.appendingPathComponent("apps/desktop/src-tauri").path
        if fileManager.fileExists(atPath: package), fileManager.fileExists(atPath: desktop) {
            return directory
        }

        let parent = directory.deletingLastPathComponent()
        if parent.path == directory.path {
            throw NSError(domain: "IconGenerator", code: 1, userInfo: [
                NSLocalizedDescriptionKey: "Could not find the Taskly repository root."
            ])
        }
        directory = parent
    }
}

func loadSourceImage(from url: URL) throws -> NSImage {
    guard let image = NSImage(contentsOf: url) else {
        throw NSError(domain: "IconGenerator", code: 2, userInfo: [
            NSLocalizedDescriptionKey: "Could not read source image at \(url.path)."
        ])
    }

    if let rep = image.representations.first {
        image.size = NSSize(width: rep.pixelsWide, height: rep.pixelsHigh)
    }
    return image
}

func writePNG(_ rep: NSBitmapImageRep, to url: URL) throws {
    guard let data = rep.representation(using: .png, properties: [:]) else {
        throw NSError(domain: "IconGenerator", code: 3, userInfo: [
            NSLocalizedDescriptionKey: "Could not encode PNG for \(url.path)."
        ])
    }
    try data.write(to: url, options: .atomic)
}

func makeBitmap(size: Int, drawing: (CGFloat) -> Void) throws -> NSBitmapImageRep {
    guard let rep = NSBitmapImageRep(
        bitmapDataPlanes: nil,
        pixelsWide: size,
        pixelsHigh: size,
        bitsPerSample: 8,
        samplesPerPixel: 4,
        hasAlpha: true,
        isPlanar: false,
        colorSpaceName: .deviceRGB,
        bytesPerRow: 0,
        bitsPerPixel: 0
    ) else {
        throw NSError(domain: "IconGenerator", code: 4, userInfo: [
            NSLocalizedDescriptionKey: "Could not create \(size)x\(size) bitmap."
        ])
    }

    rep.size = NSSize(width: size, height: size)
    if let bitmapData = rep.bitmapData {
        memset(bitmapData, 0, rep.bytesPerRow * size)
    }

    NSGraphicsContext.saveGraphicsState()
    NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: rep)
    NSGraphicsContext.current?.imageInterpolation = .high
    drawing(CGFloat(size))
    NSGraphicsContext.restoreGraphicsState()

    return rep
}

func appIconRep(size: Int, source: NSImage) throws -> NSBitmapImageRep {
    try makeBitmap(size: size) { side in
        let inset = max(1, side * 0.105)
        let tile = NSRect(x: inset, y: inset, width: side - inset * 2, height: side - inset * 2)
        let radius = side * 0.175

        let shadow = NSShadow()
        shadow.shadowOffset = NSSize(width: 0, height: -side * 0.008)
        shadow.shadowBlurRadius = side * 0.018
        shadow.shadowColor = NSColor.black.withAlphaComponent(0.12)
        shadow.set()

        let tilePath = NSBezierPath(roundedRect: tile, xRadius: radius, yRadius: radius)
        NSColor.white.setFill()
        tilePath.fill()

        NSShadow().set()
        NSColor(calibratedWhite: 0.88, alpha: 1).setStroke()
        tilePath.lineWidth = max(1, side * 0.002)
        tilePath.stroke()

        let artSide = side * 0.62
        let artRect = NSRect(
            x: (side - artSide) / 2,
            y: (side - artSide) / 2,
            width: artSide,
            height: artSide
        )
        source.draw(
            in: artRect,
            from: NSRect(origin: .zero, size: source.size),
            operation: .sourceOver,
            fraction: 1,
            respectFlipped: true,
            hints: [.interpolation: NSImageInterpolation.high]
        )
    }
}

func simplifiedTrayIconRep(size: Int) throws -> NSBitmapImageRep {
    try makeBitmap(size: size) { side in
        let shadow = NSShadow()
        shadow.shadowOffset = NSSize(width: 0, height: -side * 0.015)
        shadow.shadowBlurRadius = side * 0.02
        shadow.shadowColor = NSColor.black.withAlphaComponent(0.22)
        shadow.set()

        let pancake = NSBezierPath(
            roundedRect: NSRect(x: side * 0.12, y: side * 0.18, width: side * 0.62, height: side * 0.58),
            xRadius: side * 0.2,
            yRadius: side * 0.2
        )
        NSColor(calibratedRed: 1.0, green: 0.79, blue: 0.35, alpha: 1).setFill()
        pancake.fill()

        NSShadow().set()
        NSColor(calibratedRed: 0.46, green: 0.19, blue: 0.02, alpha: 1).setStroke()
        pancake.lineWidth = max(2, side * 0.045)
        pancake.stroke()

        let syrup = NSBezierPath(
            roundedRect: NSRect(x: side * 0.19, y: side * 0.55, width: side * 0.48, height: side * 0.18),
            xRadius: side * 0.09,
            yRadius: side * 0.09
        )
        NSColor(calibratedRed: 0.86, green: 0.35, blue: 0.04, alpha: 1).setFill()
        syrup.fill()

        NSColor(calibratedRed: 0.58, green: 0.23, blue: 0.02, alpha: 1).setStroke()
        syrup.lineWidth = max(1, side * 0.025)
        syrup.stroke()

        let butter = NSBezierPath(
            roundedRect: NSRect(x: side * 0.38, y: side * 0.64, width: side * 0.18, height: side * 0.09),
            xRadius: side * 0.025,
            yRadius: side * 0.025
        )
        NSColor(calibratedRed: 1.0, green: 0.89, blue: 0.42, alpha: 1).setFill()
        butter.fill()

        NSColor.black.setFill()
        NSBezierPath(ovalIn: NSRect(x: side * 0.31, y: side * 0.41, width: side * 0.07, height: side * 0.1)).fill()
        NSBezierPath(ovalIn: NSRect(x: side * 0.50, y: side * 0.41, width: side * 0.07, height: side * 0.1)).fill()

        NSColor.white.setFill()
        NSBezierPath(ovalIn: NSRect(x: side * 0.325, y: side * 0.47, width: side * 0.024, height: side * 0.024)).fill()
        NSBezierPath(ovalIn: NSRect(x: side * 0.515, y: side * 0.47, width: side * 0.024, height: side * 0.024)).fill()

        let smile = NSBezierPath()
        smile.move(to: NSPoint(x: side * 0.39, y: side * 0.36))
        smile.curve(
            to: NSPoint(x: side * 0.52, y: side * 0.36),
            controlPoint1: NSPoint(x: side * 0.42, y: side * 0.31),
            controlPoint2: NSPoint(x: side * 0.49, y: side * 0.31)
        )
        NSColor.black.setStroke()
        smile.lineWidth = max(2, side * 0.04)
        smile.lineCapStyle = .round
        smile.stroke()

        let badgeShadow = NSShadow()
        badgeShadow.shadowOffset = NSSize(width: 0, height: -side * 0.01)
        badgeShadow.shadowBlurRadius = side * 0.018
        badgeShadow.shadowColor = NSColor.black.withAlphaComponent(0.25)
        badgeShadow.set()

        let badge = NSBezierPath(ovalIn: NSRect(x: side * 0.57, y: side * 0.16, width: side * 0.34, height: side * 0.34))
        NSColor(calibratedRed: 0.24, green: 0.72, blue: 0.24, alpha: 1).setFill()
        badge.fill()

        NSShadow().set()
        NSColor(calibratedRed: 0.16, green: 0.55, blue: 0.16, alpha: 1).setStroke()
        badge.lineWidth = max(2, side * 0.035)
        badge.stroke()

        let check = NSBezierPath()
        check.move(to: NSPoint(x: side * 0.655, y: side * 0.33))
        check.line(to: NSPoint(x: side * 0.72, y: side * 0.27))
        check.line(to: NSPoint(x: side * 0.83, y: side * 0.40))
        NSColor.white.setStroke()
        check.lineWidth = max(3, side * 0.055)
        check.lineCapStyle = .round
        check.lineJoinStyle = .round
        check.stroke()
    }
}

let root = try findRepoRoot(from: URL(fileURLWithPath: fileManager.currentDirectoryPath))
let iconsDir = root.appendingPathComponent("apps/desktop/src-tauri/icons")
let sourceURL = iconsDir.appendingPathComponent("app-icon-art.png")
let source = try loadSourceImage(from: sourceURL)

let pngSizes: [(String, Int)] = [
    ("16x16.png", 16),
    ("24x24.png", 24),
    ("32x32.png", 32),
    ("48x48.png", 48),
    ("64x64.png", 64),
    ("96x96.png", 96),
    ("128x128.png", 128),
    ("128x128@2x.png", 256),
    ("256x256.png", 256),
    ("512x512.png", 512),
    ("1024x1024.png", 1024),
    ("icon.png", 512),
    ("app-icon-1024.png", 1024)
]

for (name, size) in pngSizes {
    let rep = try appIconRep(size: size, source: source)
    try writePNG(rep, to: iconsDir.appendingPathComponent(name))
}

try writePNG(try simplifiedTrayIconRep(size: 128), to: iconsDir.appendingPathComponent("trayIcon.png"))
try writePNG(try simplifiedTrayIconRep(size: 256), to: iconsDir.appendingPathComponent("trayIcon@2x.png"))

print("Generated app icons and simplified tray icons in \(iconsDir.path)")
