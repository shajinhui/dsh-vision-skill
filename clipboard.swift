import AppKit

guard CommandLine.arguments.count > 1 else {
    fputs("usage: swift clipboard.swift <output.png>\n", stderr)
    exit(2)
}

let outputPath = CommandLine.arguments[1]
let pasteboard = NSPasteboard.general

func writeData(_ data: Data) -> Bool {
    do {
        try data.write(to: URL(fileURLWithPath: outputPath), options: .atomic)
        return true
    } catch {
        return false
    }
}

func convertToPng(_ image: NSImage) -> Data? {
    guard let tiff = image.tiffRepresentation,
          let rep = NSBitmapImageRep(data: tiff),
          let png = rep.representation(using: .png, properties: [:]) else {
        return nil
    }
    return png
}

if let pngData = pasteboard.data(forType: .png), writeData(pngData) {
    exit(0)
}

if let image = NSImage(pasteboard: pasteboard),
   let pngData = convertToPng(image),
   writeData(pngData) {
    exit(0)
}

fputs("no image found in clipboard\n", stderr)
exit(1)
