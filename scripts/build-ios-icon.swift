import Foundation
import CoreGraphics
import ImageIO

// Reuse the existing artwork and flatten its transparent corners for Apple's icon catalog.
let source = URL(fileURLWithPath: "public/icons/icon-512.png")
let output = URL(fileURLWithPath: "ios/App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png")
guard let reader = CGImageSourceCreateWithURL(source as CFURL, nil),
      let image = CGImageSourceCreateImageAtIndex(reader, 0, nil),
      let space = CGColorSpace(name: CGColorSpace.sRGB),
      let context = CGContext(data: nil, width: 1024, height: 1024, bitsPerComponent: 8, bytesPerRow: 4096, space: space, bitmapInfo: CGImageAlphaInfo.noneSkipLast.rawValue) else {
    fputs("Could not read app artwork or prepare its canvas.\n", stderr); exit(1)
}
context.setFillColor(CGColor(red: 16.0/255, green: 17.0/255, blue: 19.0/255, alpha: 1))
context.fill(CGRect(x: 0, y: 0, width: 1024, height: 1024))
context.interpolationQuality = .high
context.draw(image, in: CGRect(x: 0, y: 0, width: 1024, height: 1024))
guard let result = context.makeImage(), let destination = CGImageDestinationCreateWithURL(output as CFURL, "public.png" as CFString, 1, nil) else {
    fputs("Could not encode app icon.\n", stderr); exit(1)
}
CGImageDestinationAddImage(destination, result, nil)
if !CGImageDestinationFinalize(destination) { fputs("Could not write app icon.\n", stderr); exit(1) }
