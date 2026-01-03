package cheeko.common.utils;

import java.nio.charset.StandardCharsets;
import java.util.Base64;

import javax.crypto.Cipher;
import javax.crypto.spec.SecretKeySpec;

public class AESUtils {

    private static final String ALGORITHM = "AES";
    private static final String TRANSFORMATION = "AES/ECB/PKCS5Padding";

    /**
     * AES Encryption
     * 
     * @param key       Secret key (16, 24, or 32 bits)
     * @param plainText String to be encrypted
     * @return Base64 string after encryption
     */
    public static String encrypt(String key, String plainText) {
        try {
            // Ensure secret key length is 16, 24, or 32 bits
            byte[] keyBytes = padKey(key.getBytes(StandardCharsets.UTF_8));
            SecretKeySpec secretKey = new SecretKeySpec(keyBytes, ALGORITHM);

            Cipher cipher = Cipher.getInstance(TRANSFORMATION);
            cipher.init(Cipher.ENCRYPT_MODE, secretKey);

            byte[] encryptedBytes = cipher.doFinal(plainText.getBytes(StandardCharsets.UTF_8));
            return Base64.getEncoder().encodeToString(encryptedBytes);
        } catch (Exception e) {
            throw new RuntimeException("AES encryption failed", e);
        }
    }

    /**
     * AES Decryption
     * 
     * @param key           Secret key (16, 24, or 32 bits)
     * @param encryptedText Base64 string to be decrypted
     * @return Decrypted string
     */
    public static String decrypt(String key, String encryptedText) {
        try {
            // Ensure secret key length is 16, 24, or 32 bits
            byte[] keyBytes = padKey(key.getBytes(StandardCharsets.UTF_8));
            SecretKeySpec secretKey = new SecretKeySpec(keyBytes, ALGORITHM);

            Cipher cipher = Cipher.getInstance(TRANSFORMATION);
            cipher.init(Cipher.DECRYPT_MODE, secretKey);

            byte[] encryptedBytes = Base64.getDecoder().decode(encryptedText);
            byte[] decryptedBytes = cipher.doFinal(encryptedBytes);
            return new String(decryptedBytes, StandardCharsets.UTF_8);
        } catch (Exception e) {
            throw new RuntimeException("AES decryption failed", e);
        }
    }

    /**
     * Pad secret key to specified length (16, 24, or 32 bits)
     * 
     * @param keyBytes Original secret key byte array
     * @return Padded secret key byte array
     */
    private static byte[] padKey(byte[] keyBytes) {
        int keyLength = keyBytes.length;
        if (keyLength == 16 || keyLength == 24 || keyLength == 32) {
            return keyBytes;
        }

        // If secret key length is insufficient, pad with 0; if exceeds, truncate to first 32 bits
        byte[] paddedKey = new byte[32];
        System.arraycopy(keyBytes, 0, paddedKey, 0, Math.min(keyLength, 32));
        return paddedKey;
    }
}
