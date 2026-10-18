package expo.modules.recallchatgpt

import android.util.Base64
import expo.modules.kotlin.functions.Coroutine
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.math.BigInteger
import java.net.InetAddress
import java.net.ServerSocket
import java.net.Socket
import java.net.URI
import java.net.URLDecoder
import java.nio.charset.StandardCharsets
import java.security.KeyFactory
import java.security.MessageDigest
import java.security.Signature
import java.security.spec.RSAPublicKeySpec
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit

class RecallChatGPTModule : Module() {
  private class Listener(val server: ServerSocket, val state: String) {
    @Volatile var connection: Socket? = null
    @Volatile var awaiting = false
    fun close() {
      try { connection?.close() } catch (_: Exception) { }
      try { server.close() } catch (_: Exception) { }
    }
  }
  private val listeners = ConcurrentHashMap<String, Listener>()
  private val timer = Executors.newSingleThreadScheduledExecutor()
  private fun failure(code: String): Map<String, Any> = mapOf("ok" to false, "code" to code)

  override fun definition() = ModuleDefinition {
    Name("RecallChatGPT")
    AsyncFunction("start") Coroutine { state: String ->
      withContext(Dispatchers.IO) { start(state) }
    }
    AsyncFunction("callback") Coroutine { id: String ->
      withContext(Dispatchers.IO) { callback(id) }
    }
    AsyncFunction("stop") { id: String ->
      listeners.remove(id)?.close()
    }
    AsyncFunction("verify") Coroutine { input: String, signature: String, modulus: String, exponent: String, algorithm: String ->
      withContext(Dispatchers.IO) { verify(input, signature, modulus, exponent, algorithm) }
    }
    OnDestroy {
      listeners.values.forEach { it.close() }
      listeners.clear()
      timer.shutdownNow()
    }
  }

  @Synchronized private fun start(state: String): Map<String, Any> {
    if (!state.matches(Regex("[A-Za-z0-9_-]{43,128}"))) return failure("invalid-state")
    if (listeners.isNotEmpty()) return failure("sign-in-in-progress")
    return try {
      val socket = ServerSocket(0, 8, InetAddress.getByName("127.0.0.1"))
      val id = UUID.randomUUID().toString()
      val listener = Listener(socket, state)
      listeners[id] = listener
      timer.schedule({ listeners.remove(id)?.close() }, 180, TimeUnit.SECONDS)
      mapOf("ok" to true, "id" to id, "redirectUri" to "http://127.0.0.1:${socket.localPort}/auth/callback")
    } catch (_: Exception) { failure("callback-listener-unavailable") }
  }

  private fun callback(id: String): Map<String, Any> {
    val listener = listeners[id] ?: return failure("cancelled")
    synchronized(listener) {
      if (listener.awaiting) return failure("sign-in-in-progress")
      listener.awaiting = true
    }
    val port = listener.server.localPort
    try {
      while (!listener.server.isClosed) {
        val socket = listener.server.accept()
        listener.connection = socket
        socket.use {
          socket.soTimeout = 3000
          val input = socket.getInputStream()
          val line = StringBuilder()
          while (line.length < 8192) {
            val byte = input.read()
            if (byte < 0 || byte == 10) break
            line.append(byte.toChar())
          }
          val parts = line.toString().trimEnd('\r').split(' ')
          val target = parts.getOrNull(1) ?: ""
          val uri = try { URI(target) } catch (_: Exception) { null }
          val states = uri?.rawQuery?.split('&')?.mapNotNull { pair ->
            val keyValue = pair.split('=', limit = 2)
            if (keyValue.size == 2 && keyValue[0] == "state") URLDecoder.decode(keyValue[1], "UTF-8") else null
          } ?: emptyList()
          val valid = line.length < 8192 && parts.size == 3 && parts[0] == "GET" && parts[2] == "HTTP/1.1" &&
            target.startsWith("/") && !target.startsWith("//") && uri?.path == "/auth/callback" && uri.fragment == null &&
            states.size == 1 && MessageDigest.isEqual(states[0].toByteArray(), listener.state.toByteArray())
          val body = if (valid) "Return to Recall to finish connecting ChatGPT." else "Invalid sign-in callback."
          val response = "HTTP/1.1 ${if (valid) "200 OK" else "400 Bad Request"}\r\nContent-Type: text/plain; charset=utf-8\r\nCache-Control: no-store\r\nContent-Security-Policy: default-src 'none'\r\nConnection: close\r\nContent-Length: ${body.toByteArray().size}\r\n\r\n$body"
          socket.getOutputStream().write(response.toByteArray(StandardCharsets.UTF_8))
          if (valid) return mapOf("ok" to true, "url" to "http://127.0.0.1:$port$target")
        }
        listener.connection = null
      }
    } catch (_: Exception) {
      return failure(if (listener.server.isClosed) "cancelled" else "callback-listener-unavailable")
    } finally {
      listeners.remove(id, listener)
      listener.close()
    }
    return failure("cancelled")
  }

  private fun verify(input: String, signature: String, modulus: String, exponent: String, algorithm: String): Boolean {
    val name = when (algorithm) { "RS256" -> "SHA256withRSA"; "RS384" -> "SHA384withRSA"; "RS512" -> "SHA512withRSA"; else -> return false }
    if (input.length > 64000 || signature.length > 1500 || modulus.length > 1500 || exponent.length > 16) return false
    return try {
      val flags = Base64.URL_SAFE or Base64.NO_WRAP or Base64.NO_PADDING
      val n = BigInteger(1, Base64.decode(modulus, flags))
      val e = BigInteger(1, Base64.decode(exponent, flags))
      if (n.bitLength() !in 2048..8192 || e < BigInteger.valueOf(3) || !e.testBit(0)) return false
      val key = KeyFactory.getInstance("RSA").generatePublic(RSAPublicKeySpec(n, e))
      Signature.getInstance(name).run {
        initVerify(key)
        update(input.toByteArray(StandardCharsets.US_ASCII))
        verify(Base64.decode(signature, flags))
      }
    } catch (_: Exception) { false }
  }
}
