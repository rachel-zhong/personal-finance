// Local text extraction for pay documents. Runs entirely on this Mac with Apple's PDFKit and Vision;
// nothing is sent anywhere.
//
//   extract pdf <file.pdf>    → JSON lines, one per text line: {"page":1,"y":585.2,"x0":20.9,"x1":336.4,"text":"..."}
//                               (y in PDF points from the bottom; pages without a text layer are OCR'd instead)
//   extract ocr <file.png>    → JSON lines, one per recognized text block: {"page":1,"y":0.53,"x0":0.05,"x1":0.12,"text":"..."}
//                               (y and x as 0–1 fractions of the image, y from the top)
import Foundation
import PDFKit
import Vision
import AppKit

struct Line: Encodable { let page: Int; let y: Double; let x0: Double; let x1: Double; let text: String }

func emit(_ l: Line) {
  let data = try! JSONEncoder().encode(l)
  print(String(data: data, encoding: .utf8)!)
}

func ocr(_ cg: CGImage, page: Int) {
  let req = VNRecognizeTextRequest()
  req.recognitionLevel = .accurate
  req.usesLanguageCorrection = false
  do { try VNImageRequestHandler(cgImage: cg, options: [:]).perform([req]) } catch {
    FileHandle.standardError.write("OCR failed: \(error)\n".data(using: .utf8)!)
    exit(2)
  }
  for o in req.results ?? [] {
    guard let t = o.topCandidates(1).first?.string else { continue }
    let b = o.boundingBox
    emit(Line(page: page, y: 1 - Double(b.maxY), x0: Double(b.minX), x1: Double(b.maxX), text: t))
  }
}

let args = CommandLine.arguments
guard args.count == 3 else { FileHandle.standardError.write("usage: extract pdf|ocr <file>\n".data(using: .utf8)!); exit(1) }
let url = URL(fileURLWithPath: args[2])

if args[1] == "pdf" {
  guard let doc = PDFDocument(url: url) else { FileHandle.standardError.write("cannot open PDF\n".data(using: .utf8)!); exit(1) }
  for i in 0..<doc.pageCount {
    guard let page = doc.page(at: i) else { continue }
    let hasText = !(page.string ?? "").trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    if hasText, let sel = page.selection(for: page.bounds(for: .mediaBox)) {
      for l in sel.selectionsByLine() {
        let b = l.bounds(for: page)
        let t = (l.string ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        if !t.isEmpty { emit(Line(page: i + 1, y: Double(b.minY), x0: Double(b.minX), x1: Double(b.maxX), text: t)) }
      }
    } else {
      // No text layer: render the page and recognize it on-device.
      let img = page.thumbnail(of: CGSize(width: 2400, height: 3100), for: .mediaBox)
      var rect = CGRect(origin: .zero, size: img.size)
      if let cg = img.cgImage(forProposedRect: &rect, context: nil, hints: nil) { ocr(cg, page: i + 1) }
    }
  }
} else if args[1] == "ocr" {
  guard let img = NSImage(contentsOf: url) else { FileHandle.standardError.write("cannot open image\n".data(using: .utf8)!); exit(1) }
  var rect = CGRect(origin: .zero, size: img.size)
  guard let cg = img.cgImage(forProposedRect: &rect, context: nil, hints: nil) else { exit(1) }
  ocr(cg, page: 1)
} else {
  exit(1)
}
