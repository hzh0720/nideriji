package com.oh_name;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.content.ContentResolver;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.graphics.Color;
import android.net.Uri;
import android.os.Bundle;
import android.util.Base64;
import android.webkit.JavascriptInterface;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Toast;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.Iterator;

public class LiteActivity extends Activity {
    private static final int FILE_CHOOSER_REQUEST = 3107;
    private static final int PICK_IMAGE_REQUEST = 3108;
    private static final int CALLBACK_CHUNK_SIZE = 20000;
    private static final String START_URL = "file:///android_asset/app.html";
    private static final String USER_AGENT = "OhApp/3.6.12 Platform/Android";

    private WebView webView;
    private ValueCallback<Uri[]> filePathCallback;
    private String pickImageCallbackId;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        webView = new WebView(this);
        webView.setBackgroundColor(Color.rgb(255, 248, 239));
        setContentView(webView);
        configureWebView();
        webView.loadUrl(START_URL);
    }

    @SuppressLint({"SetJavaScriptEnabled", "AddJavascriptInterface"})
    private void configureWebView() {
        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setDatabaseEnabled(true);
        settings.setLoadWithOverviewMode(true);
        settings.setUseWideViewPort(true);
        settings.setMediaPlaybackRequiresUserGesture(false);
        settings.setAllowFileAccess(true);
        settings.setAllowContentAccess(true);
        settings.setBuiltInZoomControls(false);
        settings.setDisplayZoomControls(false);
        settings.setUserAgentString(USER_AGENT);

        webView.addJavascriptInterface(new LiteBridge(), "NideRijiLite");
        webView.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri uri = request.getUrl();
                String host = uri.getHost();
                if ("file".equals(uri.getScheme())) {
                    return false;
                }
                if (host == null) {
                    return false;
                }
                startActivity(new Intent(Intent.ACTION_VIEW, uri));
                return true;
            }
        });
        webView.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onShowFileChooser(
                    WebView webView,
                    ValueCallback<Uri[]> callback,
                    FileChooserParams params
            ) {
                if (filePathCallback != null) {
                    filePathCallback.onReceiveValue(null);
                }
                filePathCallback = callback;
                Intent intent = params.createIntent();
                try {
                    startActivityForResult(intent, FILE_CHOOSER_REQUEST);
                } catch (ActivityNotFoundException error) {
                    filePathCallback = null;
                    Toast.makeText(LiteActivity.this, "No file picker available", Toast.LENGTH_SHORT).show();
                    return false;
                }
                return true;
            }
        });
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode == PICK_IMAGE_REQUEST) {
            String callbackId = pickImageCallbackId;
            pickImageCallbackId = null;
            if (callbackId == null) {
                return;
            }
            if (resultCode != RESULT_OK || data == null || data.getData() == null) {
                deliverCallback(callbackId, errorResponse(0, "Image picker cancelled"));
                return;
            }
            deliverCallback(callbackId, imageSelectionResponse(data.getData()));
            return;
        }
        if (requestCode != FILE_CHOOSER_REQUEST || filePathCallback == null) {
            return;
        }
        Uri[] results = WebChromeClient.FileChooserParams.parseResult(resultCode, data);
        filePathCallback.onReceiveValue(results);
        filePathCallback = null;
    }

    @Override
    public void onBackPressed() {
        if (webView != null && webView.canGoBack()) {
            webView.goBack();
            return;
        }
        super.onBackPressed();
    }

    public class LiteBridge {
        @JavascriptInterface
        public String request(String requestJson) {
            return performRequest(requestJson);
        }

        @JavascriptInterface
        public void requestAsync(String callbackId, String requestJson) {
            new Thread(() -> {
                String result = performRequest(requestJson);
                deliverCallback(callbackId, result);
            }).start();
        }

        @JavascriptInterface
        public String image(String token, String userId, String imageId) {
            return performImageRequest(token, userId, imageId);
        }

        @JavascriptInterface
        public void imageAsync(String callbackId, String token, String userId, String imageId) {
            new Thread(() -> {
                String result = performImageRequest(token, userId, imageId);
                deliverCallback(callbackId, result);
            }).start();
        }

        @JavascriptInterface
        public void uploadImageAsync(String callbackId, String token, String dataUrl, String fileName, String mimeType) {
            new Thread(() -> {
                String result = performUploadImageRequest(token, dataUrl, fileName, mimeType);
                deliverCallback(callbackId, result);
            }).start();
        }

        @JavascriptInterface
        public void pickImageAsync(String callbackId) {
            runOnUiThread(() -> {
                if (callbackId == null || callbackId.length() == 0) {
                    return;
                }
                if (pickImageCallbackId != null) {
                    deliverCallback(pickImageCallbackId, errorResponse(0, "Image picker replaced"));
                }
                pickImageCallbackId = callbackId;
                Intent intent = new Intent(Intent.ACTION_GET_CONTENT);
                intent.addCategory(Intent.CATEGORY_OPENABLE);
                intent.setType("image/*");
                try {
                    startActivityForResult(Intent.createChooser(intent, "Select image"), PICK_IMAGE_REQUEST);
                } catch (ActivityNotFoundException error) {
                    pickImageCallbackId = null;
                    deliverCallback(callbackId, errorResponse(0, "No image picker available"));
                }
            });
        }

        @JavascriptInterface
        public void toast(String message) {
            runOnUiThread(() -> Toast.makeText(LiteActivity.this, message, Toast.LENGTH_SHORT).show());
        }
    }

    private String imageSelectionResponse(Uri uri) {
        try {
            ContentResolver resolver = getContentResolver();
            String mime = resolver.getType(uri);
            if (mime == null || mime.trim().length() == 0) {
                mime = "image/jpeg";
            }
            byte[] bytes;
            try (InputStream stream = resolver.openInputStream(uri)) {
                if (stream == null) {
                    return errorResponse(0, "Could not read selected image");
                }
                bytes = readBytes(stream);
            }
            JSONObject response = new JSONObject();
            response.put("ok", true);
            response.put("status", 200);
            response.put("fileName", fileNameFromUri(uri, mime));
            response.put("mimeType", mime);
            response.put("dataUrl", "data:" + mime + ";base64," + Base64.encodeToString(bytes, Base64.NO_WRAP));
            return response.toString();
        } catch (Exception error) {
            return errorResponse(0, error.getMessage());
        }
    }

    private String fileNameFromUri(Uri uri, String mimeType) {
        String segment = uri == null ? "" : uri.getLastPathSegment();
        String name = safeFileName(segment, mimeType);
        return name.length() == 0 ? safeFileName("diary-image", mimeType) : name;
    }

    private String performRequest(String requestJson) {
        HttpURLConnection connection = null;
        try {
            JSONObject request = new JSONObject(requestJson);
            String urlValue = request.optString("url");
            if (!isAllowedUrl(urlValue)) {
                return errorResponse(0, "Blocked URL");
            }

            String method = request.optString("method", "POST").toUpperCase();
            String body = request.optString("body", "");
            URL url = new URL(urlValue);
            connection = (HttpURLConnection) url.openConnection();
            connection.setConnectTimeout(20000);
            connection.setReadTimeout(30000);
            connection.setInstanceFollowRedirects(true);
            connection.setRequestMethod(method);
            connection.setRequestProperty("User-Agent", USER_AGENT);

            JSONObject headers = request.optJSONObject("headers");
            if (headers != null) {
                Iterator<String> keys = headers.keys();
                while (keys.hasNext()) {
                    String key = keys.next();
                    connection.setRequestProperty(key, headers.optString(key));
                }
            }

            if (!"GET".equals(method) && body.length() > 0) {
                connection.setDoOutput(true);
                if (connection.getRequestProperty("Content-Type") == null) {
                    connection.setRequestProperty("Content-Type", "application/x-www-form-urlencoded;charset=UTF-8");
                }
                byte[] bytes = body.getBytes(StandardCharsets.UTF_8);
                try (OutputStream stream = connection.getOutputStream()) {
                    stream.write(bytes);
                }
            }

            int status = connection.getResponseCode();
            InputStream stream = status >= 400 ? connection.getErrorStream() : connection.getInputStream();
            String responseBody = readString(stream);
            JSONObject response = new JSONObject();
            response.put("ok", status >= 200 && status < 300);
            response.put("status", status);
            response.put("body", responseBody);
            response.put("contentType", connection.getContentType());
            return response.toString();
        } catch (Exception error) {
            return errorResponse(0, error.getMessage());
        } finally {
            if (connection != null) {
                connection.disconnect();
            }
        }
    }

    private String performImageRequest(String token, String userId, String imageId) {
        HttpURLConnection connection = null;
        try {
            String urlValue = "https://f.nideriji.cn/api/image/"
                    + Uri.encode(userId) + "/" + Uri.encode(imageId) + "/";
            connection = (HttpURLConnection) new URL(urlValue).openConnection();
            connection.setConnectTimeout(20000);
            connection.setReadTimeout(30000);
            connection.setRequestProperty("User-Agent", USER_AGENT);
            if (token != null && token.trim().length() > 0) {
                connection.setRequestProperty("auth", "token " + token.trim());
            }
            int status = connection.getResponseCode();
            if (status < 200 || status >= 300) {
                return errorResponse(status, "Image request failed");
            }
            byte[] bytes = readBytes(connection.getInputStream());
            String mime = connection.getContentType();
            if (mime == null || mime.trim().length() == 0) {
                mime = "image/jpeg";
            }
            JSONObject response = new JSONObject();
            response.put("ok", true);
            response.put("status", status);
            response.put("dataUrl", "data:" + mime + ";base64," + Base64.encodeToString(bytes, Base64.NO_WRAP));
            return response.toString();
        } catch (Exception error) {
            return errorResponse(0, error.getMessage());
        } finally {
            if (connection != null) {
                connection.disconnect();
            }
        }
    }

    private String performUploadImageRequest(String token, String dataUrl, String fileName, String mimeType) {
        try {
            byte[] bytes = decodeDataUrl(dataUrl);
            String contentType = normalizeMimeType(mimeType, dataUrl);
            String safeName = safeFileName(fileName, contentType);
            String[] paths = {"/api/upload_image", "/api/upload_image/"};
            String[] fieldNames = {"image", "file", "image_file"};
            JSONArray attempts = new JSONArray();
            JSONObject lastResponse = null;
            for (String path : paths) {
                for (String fieldName : fieldNames) {
                    JSONObject response = uploadMultipart(token, path, fieldName, safeName, contentType, bytes);
                    attempts.put(uploadAttemptSummary(response));
                    if (response.optBoolean("ok", false)) {
                        response.put("attempts", attempts);
                        return response.toString();
                    }
                    lastResponse = response;
                }
            }
            if (lastResponse != null) {
                lastResponse.put("attempts", attempts);
                return lastResponse.toString();
            }
            return errorResponse(0, "Image upload failed");
        } catch (Exception error) {
            return errorResponse(0, error.getMessage());
        }
    }

    private JSONObject uploadMultipart(
            String token,
            String path,
            String fieldName,
            String fileName,
            String mimeType,
            byte[] bytes
    ) {
        HttpURLConnection connection = null;
        String boundary = "----NideRijiLite" + System.currentTimeMillis();
        try {
            ByteArrayOutputStream body = new ByteArrayOutputStream();
            writeAscii(body, "--" + boundary + "\r\n");
            writeAscii(body, "Content-Disposition: form-data; name=\"" + fieldName
                    + "\"; filename=\"" + fileName + "\"\r\n");
            writeAscii(body, "Content-Type: " + mimeType + "\r\n\r\n");
            body.write(bytes);
            writeAscii(body, "\r\n--" + boundary + "--\r\n");
            byte[] bodyBytes = body.toByteArray();

            connection = (HttpURLConnection) new URL("https://nideriji.cn" + path).openConnection();
            connection.setConnectTimeout(20000);
            connection.setReadTimeout(45000);
            connection.setRequestMethod("POST");
            connection.setDoOutput(true);
            connection.setFixedLengthStreamingMode(bodyBytes.length);
            connection.setRequestProperty("User-Agent", USER_AGENT);
            connection.setRequestProperty("Accept", "application/json, text/plain, */*");
            connection.setRequestProperty("Origin", "https://nideriji.cn");
            connection.setRequestProperty("Referer", "https://nideriji.cn/w/");
            connection.setRequestProperty("Connection", "close");
            connection.setRequestProperty("Content-Type", "multipart/form-data; boundary=" + boundary);
            if (token != null && token.trim().length() > 0) {
                connection.setRequestProperty("auth", "token " + token.trim());
            }
            try (OutputStream stream = connection.getOutputStream()) {
                stream.write(bodyBytes);
            }
            int status = connection.getResponseCode();
            InputStream stream = status >= 400 ? connection.getErrorStream() : connection.getInputStream();
            JSONObject response = new JSONObject();
            response.put("ok", status >= 200 && status < 300);
            response.put("status", status);
            response.put("body", readString(stream));
            response.put("contentType", connection.getContentType());
            response.put("uploadPath", path);
            response.put("uploadField", fieldName);
            response.put("requestBytes", bodyBytes.length);
            return response;
        } catch (Exception error) {
            JSONObject response = new JSONObject();
            try {
                response.put("ok", false);
                response.put("status", 0);
                response.put("error", error.getMessage());
                response.put("uploadPath", path);
                response.put("uploadField", fieldName);
            } catch (Exception ignored) {
            }
            return response;
        } finally {
            if (connection != null) {
                connection.disconnect();
            }
        }
    }

    private JSONObject uploadAttemptSummary(JSONObject response) {
        JSONObject summary = new JSONObject();
        try {
            summary.put("ok", response.optBoolean("ok", false));
            summary.put("status", response.optInt("status", 0));
            summary.put("uploadPath", response.optString("uploadPath"));
            summary.put("uploadField", response.optString("uploadField"));
            summary.put("contentType", response.optString("contentType"));
            String body = response.optString("error", response.optString("body", ""));
            if (body.length() > 140) {
                body = body.substring(0, 140);
            }
            summary.put("body", body);
        } catch (Exception ignored) {
        }
        return summary;
    }

    private byte[] decodeDataUrl(String dataUrl) {
        if (dataUrl == null) {
            throw new IllegalArgumentException("Missing image data");
        }
        int comma = dataUrl.indexOf(',');
        String payload = comma >= 0 ? dataUrl.substring(comma + 1) : dataUrl;
        return Base64.decode(payload, Base64.DEFAULT);
    }

    private String normalizeMimeType(String mimeType, String dataUrl) {
        if (mimeType != null && mimeType.trim().length() > 0) {
            return mimeType.trim();
        }
        if (dataUrl != null && dataUrl.startsWith("data:")) {
            int semicolon = dataUrl.indexOf(';');
            if (semicolon > 5) {
                return dataUrl.substring(5, semicolon);
            }
        }
        return "image/jpeg";
    }

    private String safeFileName(String fileName, String mimeType) {
        String base = fileName == null ? "" : fileName.replaceAll("[^A-Za-z0-9._-]", "_");
        if (base.length() == 0) {
            base = "diary-image";
        }
        if (base.indexOf('.') < 0) {
            base += mimeType != null && mimeType.contains("png") ? ".png" : ".jpg";
        }
        return base;
    }

    private boolean isOkResponse(String responseJson) {
        try {
            return new JSONObject(responseJson).optBoolean("ok", false);
        } catch (Exception error) {
            return false;
        }
    }

    private void writeAscii(OutputStream stream, String value) throws IOException {
        stream.write(value.getBytes(StandardCharsets.US_ASCII));
    }

    private void deliverCallback(String callbackId, String result) {
        if (callbackId == null || callbackId.length() == 0) {
            return;
        }
        String callbackResult = result == null ? "" : result;
        runOnUiThread(() -> {
            int total = Math.max(1, (callbackResult.length() + CALLBACK_CHUNK_SIZE - 1) / CALLBACK_CHUNK_SIZE);
            for (int index = 0; index < total; index += 1) {
                int start = index * CALLBACK_CHUNK_SIZE;
                int end = Math.min(callbackResult.length(), start + CALLBACK_CHUNK_SIZE);
                String chunk = callbackResult.substring(start, end);
                String script = "window.NideRijiNative&&window.NideRijiNative.resolveChunk("
                        + JSONObject.quote(callbackId) + ","
                        + index + ","
                        + total + ","
                        + JSONObject.quote(chunk) + ")";
                webView.evaluateJavascript(script, null);
            }
        });
    }

    private boolean isAllowedUrl(String urlValue) {
        if (urlValue == null) {
            return false;
        }
        Uri uri = Uri.parse(urlValue);
        String host = uri.getHost();
        String scheme = uri.getScheme();
        if (!"https".equalsIgnoreCase(scheme) || host == null) {
            return false;
        }
        return "nideriji.cn".equals(host)
                || "f.nideriji.cn".equals(host)
                || host.endsWith(".nideriji.cn");
    }

    private String readString(InputStream stream) throws IOException {
        if (stream == null) {
            return "";
        }
        StringBuilder builder = new StringBuilder();
        try (BufferedReader reader = new BufferedReader(
                new InputStreamReader(stream, StandardCharsets.UTF_8)
        )) {
            String line;
            while ((line = reader.readLine()) != null) {
                builder.append(line);
            }
        }
        return builder.toString();
    }

    private byte[] readBytes(InputStream stream) throws IOException {
        ByteArrayOutputStream buffer = new ByteArrayOutputStream();
        byte[] chunk = new byte[8192];
        int read;
        while ((read = stream.read(chunk)) != -1) {
            buffer.write(chunk, 0, read);
        }
        return buffer.toByteArray();
    }

    private String errorResponse(int status, String message) {
        try {
            JSONObject response = new JSONObject();
            response.put("ok", false);
            response.put("status", status);
            response.put("error", message == null ? "Unknown error" : message);
            return response.toString();
        } catch (Exception ignored) {
            return "{\"ok\":false,\"status\":0,\"error\":\"Unknown error\"}";
        }
    }
}
