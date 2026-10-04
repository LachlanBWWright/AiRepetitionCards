import ExpoModulesCore
import Vision
import PDFKit
import ImageIO
import UIKit

public class RecallOcrModule: Module {
  private let queue = DispatchQueue(label: "recall.ocr", qos: .userInitiated)

  public func definition() -> ModuleDefinition {
    Name("RecallOcr")
    AsyncFunction("recognize") { (uri: String, kind: String, firstPage: Int, lastPage: Int) -> [String: Any] in
      self.recognize(uri, kind, firstPage, lastPage)
    }.runOnQueue(queue)
  }

  private func failure(_ code: String) -> [String: Any] { ["ok": false, "code": code] }

  private func read(_ image: CGImage, orientation: CGImagePropertyOrientation = .up) throws -> String {
    let request = VNRecognizeTextRequest()
    request.recognitionLevel = .accurate
    request.recognitionLanguages = ["en-US"]
    request.usesLanguageCorrection = true
    try VNImageRequestHandler(cgImage: image, orientation: orientation).perform([request])
    return (request.results ?? []).compactMap { $0.topCandidates(1).first?.string }.joined(separator: "\n")
  }

  private func recognize(_ uri: String, _ kind: String, _ first: Int, _ last: Int) -> [String: Any] {
    guard let url = URL(string: uri), url.isFileURL,
      url.standardizedFileURL.path.hasPrefix(NSTemporaryDirectory()) ||
      url.standardizedFileURL.path.hasPrefix(FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0].path + "/")
    else { return failure("invalid-file") }
    guard let size = try? url.resourceValues(forKeys: [.fileSizeKey]).fileSize,
      size > 0, size <= 16 * 1024 * 1024 else { return failure("too-large") }
    guard first >= 1, last >= first, last - first < 20 else { return failure("page-range") }
    var pages: [[String: Any]] = []
    var count = 1
    var textSize = 0
    do {
      if kind == "pdf" {
        guard let document = PDFDocument(url: url) else { return failure("invalid-file") }
        if document.isLocked { return failure("encrypted-pdf") }
        count = document.pageCount
        guard last <= count else { return failure("page-range") }
        for index in (first - 1)..<last {
          let result: [String: Any]? = try autoreleasepool {
            guard let page = document.page(at: index) else { return nil }
            let bounds = page.bounds(for: .mediaBox)
            guard bounds.width.isFinite, bounds.height.isFinite, bounds.width > 0, bounds.height > 0 else { return nil }
            let scale = min(2400 / bounds.width, 2400 / bounds.height)
            let size = CGSize(width: bounds.width * scale, height: bounds.height * scale)
            let format = UIGraphicsImageRendererFormat()
            format.scale = 1
            format.opaque = true
            let image = UIGraphicsImageRenderer(size: size, format: format).image { context in
              UIColor.white.setFill()
              context.fill(CGRect(origin: .zero, size: size))
              context.cgContext.translateBy(x: 0, y: size.height)
              context.cgContext.scaleBy(x: scale, y: -scale)
              context.cgContext.translateBy(x: -bounds.minX, y: -bounds.minY)
              page.draw(with: .mediaBox, to: context.cgContext)
            }
            guard let cg = image.cgImage else { return nil }
            return ["pageNumber": index + 1, "text": try read(cg)]
          }
          guard let result else { return failure("invalid-file") }
          textSize += (result["text"] as? String)?.utf16.count ?? 0
          if textSize > 2000000 { return failure("too-large") }
          pages.append(result)
        }
      } else if kind == "image" {
        guard first == 1, last == 1, let source = CGImageSourceCreateWithURL(url as CFURL, nil),
          let image = CGImageSourceCreateThumbnailAtIndex(source, 0, [
            kCGImageSourceCreateThumbnailFromImageAlways: true,
            kCGImageSourceThumbnailMaxPixelSize: 2400,
            kCGImageSourceCreateThumbnailWithTransform: true
          ] as CFDictionary) else { return failure("invalid-file") }
        let text = try read(image)
        if text.utf16.count > 2000000 { return failure("too-large") }
        pages.append(["pageNumber": 1, "text": text])
      } else { return failure("unsupported-format") }
      return ["ok": true, "pageCount": count, "pages": pages]
    } catch { return failure("recognition-failed") }
  }
}
