package com.rstechnologies.gastrofood;

import android.content.Context;
import android.content.SharedPreferences;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.nio.charset.StandardCharsets;
import java.security.KeyStore;
import java.security.MessageDigest;
import java.security.SecureRandom;

import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;

/**
 * GastroFlow Food customer-session storage, scoped to this Android app.
 * Token ciphertext and a unique nonce are stored in app-private preferences;
 * the non-exportable AES key is held by Android Keystore.
 *
 * NOT ENABLED for existing logins until read/write/migration acceptance on
 * physical devices. Never log keys, token values, ciphertext or errors.
 */
@CapacitorPlugin(name = "GastroFoodSecureSession")
public class FoodSecureSessionPlugin extends Plugin {
    private static final String KEY_ALIAS = "gastrofood-customer-session-v1";
    private static final String PREF_FILE = "gastrofood_encrypted_sessions_v1";
    private static final String CIPHER = "AES/GCM/NoPadding";
    private static final String PREFIX = "gastroflow_customer_token:";

    private String checkedKey(PluginCall call) {
        final String key = call.getString("key");
        if (key == null || !key.startsWith(PREFIX) || key.length() > 256 ||
            key.length() <= PREFIX.length()) {
            call.reject("Invalid customer session key");
            return null;
        }
        return key;
    }

    private String hashedKey(String key) throws Exception {
        byte[] hash = MessageDigest.getInstance("SHA-256")
            .digest(key.getBytes(StandardCharsets.UTF_8));
        return Base64.encodeToString(hash, Base64.NO_WRAP | Base64.URL_SAFE | Base64.NO_PADDING);
    }

    private SharedPreferences preferences() {
        return getContext().getSharedPreferences(PREF_FILE, Context.MODE_PRIVATE);
    }

    private synchronized SecretKey getOrCreateKey() throws Exception {
        KeyStore store = KeyStore.getInstance("AndroidKeyStore");
        store.load(null);
        if (store.containsAlias(KEY_ALIAS)) {
            KeyStore.SecretKeyEntry entry = (KeyStore.SecretKeyEntry) store.getEntry(KEY_ALIAS, null);
            if (entry == null) throw new IllegalStateException("Secure key unavailable");
            return entry.getSecretKey();
        }
        KeyGenerator generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore");
        generator.init(new KeyGenParameterSpec.Builder(KEY_ALIAS,
            KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT)
            .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
            .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
            .setKeySize(256)
            .setRandomizedEncryptionRequired(true)
            .build());
        return generator.generateKey();
    }

    @PluginMethod
    public void get(PluginCall call) {
        String key = checkedKey(call);
        if (key == null) return;
        try {
            String payload = preferences().getString(hashedKey(key), null);
            JSObject result = new JSObject();
            if (payload == null) {
                result.put("value", JSObject.NULL);
            } else {
                String[] parts = payload.split(":", -1);
                if (parts.length != 2) throw new IllegalStateException("Invalid encrypted session");
                byte[] iv = Base64.decode(parts[0], Base64.NO_WRAP);
                byte[] ciphertext = Base64.decode(parts[1], Base64.NO_WRAP);
                if (iv.length != 12 || ciphertext.length < 16) throw new IllegalStateException("Invalid encrypted session");
                Cipher cipher = Cipher.getInstance(CIPHER);
                cipher.init(Cipher.DECRYPT_MODE, getOrCreateKey(), new GCMParameterSpec(128, iv));
                cipher.updateAAD(key.getBytes(StandardCharsets.UTF_8));
                byte[] plaintext = cipher.doFinal(ciphertext);
                result.put("value", new String(plaintext, StandardCharsets.UTF_8));
            }
            call.resolve(result);
        } catch (Exception ignored) {
            call.reject("Unable to read secure customer session");
        }
    }

    @PluginMethod
    public void set(PluginCall call) {
        String key = checkedKey(call);
        if (key == null) return;
        String value = call.getString("value");
        if (value == null || value.isEmpty() || value.length() > 8192) {
            call.reject("Invalid customer session token");
            return;
        }
        try {
            Cipher cipher = Cipher.getInstance(CIPHER);
            cipher.init(Cipher.ENCRYPT_MODE, getOrCreateKey());
            cipher.updateAAD(key.getBytes(StandardCharsets.UTF_8));
            byte[] iv = cipher.getIV();
            if (iv.length != 12) throw new IllegalStateException("Invalid nonce length");
            byte[] encrypted = cipher.doFinal(value.getBytes(StandardCharsets.UTF_8));
            String payload = Base64.encodeToString(iv, Base64.NO_WRAP) + ":" +
                Base64.encodeToString(encrypted, Base64.NO_WRAP);
            if (!preferences().edit().putString(hashedKey(key), payload).commit())
                throw new IllegalStateException("Secure session write failed");
            call.resolve();
        } catch (Exception ignored) {
            call.reject("Unable to save secure customer session");
        }
    }

    @PluginMethod
    public void remove(PluginCall call) {
        String key = checkedKey(call);
        if (key == null) return;
        try {
            if (!preferences().edit().remove(hashedKey(key)).commit())
                throw new IllegalStateException("Secure session removal failed");
            call.resolve();
        } catch (Exception ignored) {
            call.reject("Unable to remove secure customer session");
        }
    }
}
