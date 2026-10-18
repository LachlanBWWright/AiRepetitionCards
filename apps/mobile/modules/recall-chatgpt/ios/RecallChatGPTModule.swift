import ExpoModulesCore
import Foundation
import Network
import Security
import UIKit
import SafariServices

private final class ChatGPTBrowserDelegate: NSObject, SFSafariViewControllerDelegate {
  let cancel: () -> Void
  init(cancel: @escaping () -> Void) { self.cancel = cancel }
  func safariViewControllerDidFinish(_ controller: SFSafariViewController) { cancel() }
}

public class RecallChatGPTModule: Module {
  private let queue = DispatchQueue(label: "recall.chatgpt.callback")
  private var active: Session?
  // Browser properties are accessed only on the main queue.
  private var browser: SFSafariViewController?
  private var browserDelegate: ChatGPTBrowserDelegate?
  private var browserId: String?
  private var backgroundTask: UIBackgroundTaskIdentifier = .invalid
  private struct Session {
    let id: String
    let state: String
    let listener: NWListener
    var port: UInt16?
    var start: Promise?
    var awaiting = false
    var callback: Promise?
    var result: [String: Any]?
    var connections: [NWConnection] = []
  }
  private func failure(_ code: String) -> [String: Any] { ["ok": false, "code": code] }

  public func definition() -> ModuleDefinition {
    Name("RecallChatGPT")
    AsyncFunction("open") { (value: String, promise: Promise) in
      guard let id = self.active?.id,
        let url = URL(string: value), url.scheme == "https", url.host == "auth.openai.com",
        url.path == "/api/accounts/authorize", url.user == nil, url.password == nil, url.port == nil else {
        promise.resolve(self.failure("browser-unavailable")); return
      }
      DispatchQueue.main.async {
        guard self.queue.sync(execute: { self.active?.id == id }), self.browser == nil, let presenter = self.appContext?.utilities?.currentViewController() else {
          promise.resolve(self.failure("browser-unavailable")); return
        }
        // A system Safari sheet keeps Recall foregrounded while the loopback listener waits.
        // Web content and browser credentials remain isolated from the application.
        let browser = SFSafariViewController(url: url)
        let delegate = ChatGPTBrowserDelegate { [weak self] in self?.queue.async { self?.close(id) } }
        browser.delegate = delegate
        browser.modalPresentationStyle = .fullScreen
        self.browser = browser
        self.browserDelegate = delegate
        self.browserId = id
        presenter.present(browser, animated: true) { promise.resolve(["ok": true]) }
      }
    }.runOnQueue(queue)
    AsyncFunction("start") { (state: String, promise: Promise) in self.start(state, promise) }.runOnQueue(queue)
    AsyncFunction("callback") { (id: String, promise: Promise) in
      guard self.active?.id == id, self.active?.awaiting == false else { promise.resolve(self.failure("cancelled")); return }
      self.active?.awaiting = true
      if let result = self.active?.result { promise.resolve(result); self.close(id) }
      else { self.active?.callback = promise }
    }.runOnQueue(queue)
    AsyncFunction("stop") { (id: String) in self.close(id) }.runOnQueue(queue)
    AsyncFunction("verify") { (input: String, signature: String, modulus: String, exponent: String, algorithm: String) -> Bool in
      self.verify(input, signature, modulus, exponent, algorithm)
    }
    OnDestroy { self.queue.async { if let id = self.active?.id { self.close(id) } } }
  }
  private func close(_ id: String) {
    guard let session = active, session.id == id else { return }
    active = nil
    DispatchQueue.main.async {
      guard self.browserId == id else { return }
      self.browser?.dismiss(animated: true)
      self.browser = nil
      self.browserDelegate = nil
      self.browserId = nil
    }
    let task = backgroundTask
    backgroundTask = .invalid
    if task != .invalid { DispatchQueue.main.async { UIApplication.shared.endBackgroundTask(task) } }
    session.listener.stateUpdateHandler = nil
    session.listener.newConnectionHandler = nil
    session.listener.cancel()
    session.connections.forEach { $0.cancel() }
    session.start?.resolve(failure("cancelled"))
    session.callback?.resolve(failure("cancelled"))
  }
  private func start(_ state: String, _ promise: Promise) {
    guard state.range(of: "^[A-Za-z0-9_-]{43,128}$", options: .regularExpression) != nil else { promise.resolve(failure("invalid-state")); return }
    guard active == nil else { promise.resolve(failure("sign-in-in-progress")); return }
    let parameters = NWParameters.tcp
    parameters.requiredLocalEndpoint = .hostPort(host: "127.0.0.1", port: .any)
    guard let listener = try? NWListener(using: parameters) else { promise.resolve(failure("callback-listener-unavailable")); return }
    let id = UUID().uuidString
    active = Session(id: id, state: state, listener: listener, start: promise)
    // If the user leaves Recall during sign-in, use only the OS's bounded grace
    // period. Normal sign-in stays foregrounded in a system Safari sheet.
    DispatchQueue.main.async { [weak self] in
      guard let self else { return }
      let task = UIApplication.shared.beginBackgroundTask(withName: "ChatGPT sign-in") { [weak self] in
        guard let self else { return }
        self.queue.async { self.close(id) }
      }
      self.queue.async {
        if self.active?.id == id { self.backgroundTask = task }
        else if task != .invalid { DispatchQueue.main.async { UIApplication.shared.endBackgroundTask(task) } }
      }
    }
    listener.stateUpdateHandler = { [weak self] status in
      guard let self, self.active?.id == id else { return }
      switch status {
      case .ready:
        guard let port = listener.port?.rawValue else { self.close(id); return }
        self.active?.port = port
        let start = self.active?.start
        self.active?.start = nil
        start?.resolve(["ok": true, "id": id, "redirectUri": "http://127.0.0.1:\(port)/auth/callback"])
      case .failed:
        self.active?.start?.resolve(self.failure("callback-listener-unavailable"))
        self.active?.start = nil
        self.close(id)
      default: break
      }
    }
    listener.newConnectionHandler = { [weak self] connection in
      guard let self, self.active?.id == id, (self.active?.connections.count ?? 8) < 8 else { connection.cancel(); return }
      self.active?.connections.append(connection)
      connection.start(queue: self.queue)
      self.queue.asyncAfter(deadline: .now() + 3) { connection.cancel() }
      self.receive(connection, id, Data())
    }
    listener.start(queue: queue)
    queue.asyncAfter(deadline: .now() + 180) { [weak self] in self?.close(id) }
  }
  private func receive(_ connection: NWConnection, _ id: String, _ previous: Data) {
    connection.receive(minimumIncompleteLength: 1, maximumLength: 8192) { [weak self] data, _, complete, error in
      guard let self, self.active?.id == id else { connection.cancel(); return }
      let bytes = previous + (data ?? Data())
      if bytes.count > 8192 || error != nil { self.release(connection); return }
      guard let request = String(data: bytes, encoding: .utf8), let first = request.range(of: "\r\n") else {
        if complete { self.release(connection) } else { self.receive(connection, id, bytes) }
        return
      }
      let parts = request[..<first.lowerBound].split(separator: " ")
      let target = parts.count == 3 ? String(parts[1]) : ""
      let url = URLComponents(string: "http://127.0.0.1\(target)")
      let states = url?.queryItems?.filter { $0.name == "state" } ?? []
      let valid = parts.count == 3 && parts[0] == "GET" && parts[2] == "HTTP/1.1" && target.hasPrefix("/") && !target.hasPrefix("//") &&
        url?.host == "127.0.0.1" && url?.path == "/auth/callback" && url?.fragment == nil && states.count == 1 && states.first?.value == self.active?.state && self.active?.result == nil
      let body = valid ? "Return to Recall to finish connecting ChatGPT." : "Invalid sign-in callback."
      let response = "HTTP/1.1 \(valid ? "200 OK" : "400 Bad Request")\r\nContent-Type: text/plain; charset=utf-8\r\nCache-Control: no-store\r\nContent-Security-Policy: default-src 'none'\r\nConnection: close\r\nContent-Length: \(body.utf8.count)\r\n\r\n\(body)"
      if valid, let port = self.active?.port {
        let result: [String: Any] = ["ok": true, "url": "http://127.0.0.1:\(port)\(target)"]
        self.active?.result = result
        // Stop accepting new callbacks immediately; finish sending the response first.
        self.active?.listener.cancel()
        let callback = self.active?.callback
        self.active?.callback = nil
        callback?.resolve(result)
      }
      connection.send(content: response.data(using: .utf8), completion: .contentProcessed { _ in self.release(connection) })
    }
  }
  private func release(_ connection: NWConnection) {
    connection.cancel()
    active?.connections.removeAll { $0 === connection }
  }
  private func base64(_ value: String) -> Data? {
    let encoded = value.replacingOccurrences(of: "-", with: "+").replacingOccurrences(of: "_", with: "/")
    return Data(base64Encoded: encoded + String(repeating: "=", count: (4 - encoded.count % 4) % 4))
  }
  private func der(_ tag: UInt8, _ value: Data) -> Data {
    let count = value.count
    let length: [UInt8] = count < 128 ? [UInt8(count)] : count < 256 ? [0x81, UInt8(count)] : [0x82, UInt8(count >> 8), UInt8(count & 255)]
    return Data([tag] + length) + value
  }
  private func integer(_ value: Data) -> Data {
    let positive = value.first.map { $0 >= 128 } == true ? Data([0]) + value : value
    return der(0x02, positive)
  }
  private func verify(_ input: String, _ signature: String, _ modulus: String, _ exponent: String, _ algorithm: String) -> Bool {
    let algorithms: [String: SecKeyAlgorithm] = ["RS256": .rsaSignatureMessagePKCS1v15SHA256, "RS384": .rsaSignatureMessagePKCS1v15SHA384, "RS512": .rsaSignatureMessagePKCS1v15SHA512]
    guard input.utf8.count <= 64000, signature.count <= 1500, modulus.count <= 1500, exponent.count <= 16,
      let alg = algorithms[algorithm], let n = base64(modulus), n.count >= 256, n.count <= 1024,
      let e = base64(exponent), let sig = base64(signature), let data = input.data(using: .ascii) else { return false }
    let keyData = der(0x30, integer(n) + integer(e))
    let attributes: [CFString: Any] = [kSecAttrKeyType: kSecAttrKeyTypeRSA, kSecAttrKeyClass: kSecAttrKeyClassPublic]
    guard let key = SecKeyCreateWithData(keyData as CFData, attributes as CFDictionary, nil), SecKeyIsAlgorithmSupported(key, .verify, alg) else { return false }
    return SecKeyVerifySignature(key, alg, data as CFData, sig as CFData, nil)
  }
}
