package com.ganquanonline.snowstorm;

import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import android.util.Base64;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        forwardIntent(getIntent());
    }

    @Override
    public void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        forwardIntent(intent);
    }

    private void forwardIntent(Intent intent) {
        Uri uri = intent == null ? null : intent.getData();
        if (uri == null || !Intent.ACTION_VIEW.equals(intent.getAction()) || getBridge() == null || getBridge().getWebView() == null) return;
        try (InputStream input = getContentResolver().openInputStream(uri)) {
            if (input == null) return;
            ByteArrayOutputStream output = new ByteArrayOutputStream();
            byte[] buffer = new byte[8192];
            int count;
            while ((count = input.read(buffer)) != -1) output.write(buffer, 0, count);
            String encoded = Base64.encodeToString(output.toByteArray(), Base64.NO_WRAP);
            String name = uri.getLastPathSegment() == null ? "particle.json" : uri.getLastPathSegment();
            String script = "(function(){if(!window.snowstormMobileOpenContent)return false;" +
                "window.snowstormMobileOpenContent(" + org.json.JSONObject.quote(name) + "," +
                org.json.JSONObject.quote(encoded) + ");return true;})()";
            deliverWhenReady(script, 0);
        } catch (Exception error) {
            android.util.Log.w("Snowstorm", "Unable to open Android file", error);
        }
    }

    private void deliverWhenReady(String script, int attempt) {
        if (attempt >= 40 || getBridge() == null || getBridge().getWebView() == null) return;
        getBridge().getWebView().postDelayed(() -> getBridge().getWebView().evaluateJavascript(script, result -> {
            if (!"true".equals(result)) deliverWhenReady(script, attempt + 1);
        }), attempt == 0 ? 300 : 250);
    }
}
