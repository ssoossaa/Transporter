// Reads the text of images with macOS's built-in OCR (Vision, the engine behind
// Live Text). Prints one JSON line per image:
//   {"file": "...", "lines": [{"text", "confidence", "x", "y", "w", "h"}]}
// Boxes are normalized to the image size, with the origin at the top left.
// Usage: transporter-ocr [--correct] image...
import AppKit
import Foundation
import Vision

var files = Array(CommandLine.arguments.dropFirst())
// Off by default: language correction "fixes" the author's wording, and we want it verbatim.
let correct = files.first == "--correct"
if correct { files.removeFirst() }

for file in files {
  var lines: [[String: Any]] = []
  if let image = NSImage(contentsOfFile: file),
     let cgImage = image.cgImage(forProposedRect: nil, context: nil, hints: nil) {
    let request = VNRecognizeTextRequest()
    request.recognitionLevel = .accurate
    request.automaticallyDetectsLanguage = true
    request.usesLanguageCorrection = correct
    try? VNImageRequestHandler(cgImage: cgImage).perform([request])
    for observation in request.results ?? [] {
      guard let candidate = observation.topCandidates(1).first else { continue }
      let box = observation.boundingBox
      lines.append([
        "text": candidate.string,
        "confidence": candidate.confidence,
        "x": box.minX, "y": 1 - box.maxY, "w": box.width, "h": box.height,
      ])
    }
  }
  let data = try JSONSerialization.data(withJSONObject: ["file": file, "lines": lines])
  print(String(decoding: data, as: UTF8.self))
}
