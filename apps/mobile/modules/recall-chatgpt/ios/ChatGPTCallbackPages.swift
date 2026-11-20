import Foundation

/// The shared TypeScript renderer supplies static pages and their matching CSP.
struct ChatGPTCallbackPages {
  private let pages: [String: String]

  init?(_ value: String) {
    guard value.utf8.count <= 64000,
      let data = value.data(using: .utf8),
      let parsed = try? JSONSerialization.jsonObject(with: data),
      let pages = parsed as? [String: String],
      ["received", "cancelled", "invalid"].allSatisfy({
        guard let page = pages[$0] else { return false }
        return !page.isEmpty && page.utf8.count <= 16000
      }),
      let policy = pages["policy"], !policy.isEmpty, policy.utf8.count <= 1024,
      !policy.contains("\r"), !policy.contains("\n") else { return nil }
    self.pages = pages
  }

  func response(valid: Bool, errors: [String]) -> String {
    let state = !valid || (!errors.isEmpty && errors != ["access_denied"])
      ? "invalid" : errors == ["access_denied"] ? "cancelled" : "received"
    let body = pages[state] ?? ""
    let status = state == "invalid" ? "400 Bad Request" : "200 OK"
    let policy = pages["policy"] ?? "default-src 'none'"
    return "HTTP/1.1 \(status)\r\nContent-Type: text/html; charset=utf-8\r\nCache-Control: no-store\r\nReferrer-Policy: no-referrer\r\nX-Content-Type-Options: nosniff\r\nContent-Security-Policy: \(policy)\r\nConnection: close\r\nContent-Length: \(body.utf8.count)\r\n\r\n\(body)"
  }
}
