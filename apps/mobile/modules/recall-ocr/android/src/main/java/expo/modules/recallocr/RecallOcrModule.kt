package expo.modules.recallocr

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Color
import android.graphics.Matrix
import android.graphics.pdf.PdfRenderer
import android.os.ParcelFileDescriptor
import androidx.exifinterface.media.ExifInterface
import com.google.android.gms.tasks.Tasks
import com.google.mlkit.vision.common.InputImage
import com.google.mlkit.vision.text.TextRecognition
import com.google.mlkit.vision.text.latin.TextRecognizerOptions
import expo.modules.kotlin.functions.Coroutine
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.io.File
import java.net.URI
import kotlin.math.max
import kotlin.math.min

class RecallOcrModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("RecallOcr")
    AsyncFunction("recognize") Coroutine { uri: String, kind: String, first: Int, last: Int ->
      withContext(Dispatchers.IO) { recognize(uri, kind, first, last) }
    }
  }

  private fun failure(code: String): Map<String, Any> = mapOf("ok" to false, "code" to code)

  private fun recognize(uri: String, kind: String, first: Int, last: Int): Map<String, Any> {
    val context = appContext.reactContext ?: return failure("unavailable")
    try {
      val parsed = URI(uri)
      if (parsed.scheme != "file") return failure("invalid-file")
      val file = File(parsed).canonicalFile
      if (!file.path.startsWith(context.cacheDir.canonicalPath + File.separator)) return failure("invalid-file")
      if (file.length() !in 1..(16L * 1024 * 1024)) return failure("too-large")
      if (first < 1 || last < first || last - first >= 20) return failure("page-range")
      val recognizer = TextRecognition.getClient(TextRecognizerOptions.DEFAULT_OPTIONS)
      try {
        fun read(bitmap: Bitmap): String = Tasks.await(
          recognizer.process(InputImage.fromBitmap(bitmap, 0))
        ).text
        val pages = mutableListOf<Map<String, Any>>()
        var count = 1
        var textSize = 0
        if (kind == "pdf") {
          ParcelFileDescriptor.open(file, ParcelFileDescriptor.MODE_READ_ONLY).use { descriptor ->
            PdfRenderer(descriptor).use { renderer ->
              count = renderer.pageCount
              if (last > count) return failure("page-range")
              for (index in (first - 1) until last) {
                renderer.openPage(index).use { page ->
                  if (page.width <= 0 || page.height <= 0) return failure("invalid-file")
                  val scale = min(2400.0 / page.width, 2400.0 / page.height)
                  val bitmap = Bitmap.createBitmap(max(1, (page.width * scale).toInt()), max(1, (page.height * scale).toInt()), Bitmap.Config.ARGB_8888)
                  try {
                    bitmap.eraseColor(Color.WHITE)
                    page.render(bitmap, null, null, PdfRenderer.Page.RENDER_MODE_FOR_DISPLAY)
                    val text = read(bitmap)
                    textSize += text.length
                    if (textSize > 2000000) return failure("too-large")
                    pages.add(mapOf("pageNumber" to index + 1, "text" to text))
                  } finally { bitmap.recycle() }
                }
              }
            }
          }
        } else if (kind == "image") {
          if (first != 1 || last != 1) return failure("page-range")
          val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
          BitmapFactory.decodeFile(file.path, bounds)
          if (bounds.outWidth <= 0 || bounds.outHeight <= 0) return failure("invalid-file")
          var sample = 1
          while (max(bounds.outWidth, bounds.outHeight) / sample > 2400) sample *= 2
          val bitmap = BitmapFactory.decodeFile(file.path, BitmapFactory.Options().apply { inSampleSize = sample }) ?: return failure("invalid-file")
          try {
            val exif = ExifInterface(file)
            val matrix = Matrix()
            if (exif.isFlipped) matrix.postScale(-1f, 1f)
            matrix.postRotate(exif.rotationDegrees.toFloat())
            val oriented = Bitmap.createBitmap(bitmap, 0, 0, bitmap.width, bitmap.height, matrix, true)
            try {
              val text = read(oriented)
              if (text.length > 2000000) return failure("too-large")
              pages.add(mapOf("pageNumber" to 1, "text" to text))
            }
            finally { if (oriented !== bitmap) oriented.recycle() }
          } finally { bitmap.recycle() }
        } else return failure("unsupported-format")
        return mapOf("ok" to true, "pageCount" to count, "pages" to pages)
      } finally { recognizer.close() }
    } catch (_: SecurityException) { return failure("encrypted-or-inaccessible") }
      catch (_: Exception) { return failure("recognition-failed") }
  }
}
