package expo.modules.recallchatgpt

import org.json.JSONObject

/** Static HTML and matching CSP come from the shared TypeScript renderer. */
internal class ChatGPTCallbackPages private constructor(private val pages: Map<String, String>) {
  companion object {
    fun parse(value: String): ChatGPTCallbackPages? {
      if (value.toByteArray(Charsets.UTF_8).size > 64000) return null
      return try {
        val json = JSONObject(value)
        val pages = listOf("received", "cancelled", "invalid", "policy").associateWith { key ->
          json.opt(key) as? String ?: return null
        }
        if (pages.any { (key, body) ->
          body.isEmpty() || body.toByteArray(Charsets.UTF_8).size > (if (key == "policy") 1024 else 16000)
        }) return null
        val policy = pages.getValue("policy")
        if (policy.contains('\r') || policy.contains('\n')) return null
        ChatGPTCallbackPages(pages)
      } catch (_: Exception) { null }
    }
  }

  fun response(valid: Boolean, errors: List<String>): String {
    val state = when {
      !valid || (errors.isNotEmpty() && errors != listOf("access_denied")) -> "invalid"
      errors == listOf("access_denied") -> "cancelled"
      else -> "received"
    }
    val body = pages.getValue(state)
    val status = if (state == "invalid") "400 Bad Request" else "200 OK"
    return "HTTP/1.1 $status\r\nContent-Type: text/html; charset=utf-8\r\nCache-Control: no-store\r\nReferrer-Policy: no-referrer\r\nX-Content-Type-Options: nosniff\r\nContent-Security-Policy: ${pages.getValue("policy")}\r\nConnection: close\r\nContent-Length: ${body.toByteArray(Charsets.UTF_8).size}\r\n\r\n$body"
  }
}
