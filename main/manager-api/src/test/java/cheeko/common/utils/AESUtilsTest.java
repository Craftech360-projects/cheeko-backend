package cheeko.common.utils;

import static org.junit.jupiter.api.Assertions.assertEquals;

import org.junit.jupiter.api.Test;

public class AESUtilsTest {

    @Test
    public void testEncryptAndDecrypt() {
        String key = "cheeko1234567890";
        String plainText = "Hello, 小智!";

        System.out.println("原始Text: " + plainText);
        System.out.println("Secret Key: " + key);

        // Encrypt
        String encrypted = AESUtils.encrypt(key, plainText);
        System.out.println("EncryptResult: " + encrypted);

        // Decrypt
        String decrypted = AESUtils.decrypt(key, encrypted);
        System.out.println("DecryptResult: " + decrypted);

        // Validate
        assertEquals(plainText, decrypted, "加DecryptResult应该一致");
        System.out.println("加Decrypt一致性: " + plainText.equals(decrypted));
    }

    @Test
    public void testDifferentKeyLengths() {
        String[] keys = {
                "1234567890123456", // 16位
                "123456789012345678901234", // 24位
                "12345678901234567890123456789012", // 32位
                "short", // 短Secret Key
                "verylongkeythatwillbetruncatedto32bytes" // 长Secret Key
        };

        String plainText = "测试Text";

        for (String key : keys) {
            String encrypted = AESUtils.encrypt(key, plainText);
            String decrypted = AESUtils.decrypt(key, encrypted);
            assertEquals(plainText, decrypted, "Secret KeyLength: " + key.length());
        }
    }

    @Test
    public void testSpecialCharacters() {
        String key = "cheeko1234567890";
        String[] testTexts = {
                "Hello World",
                "你好世界",
                "Hello, 小智!",
                "特殊字符: !@#$%^&*()",
                "Number123和中文混合",
                "Emoji: 😀🎉🚀",
                "EmptyString测试",
                ""
        };

        for (String text : testTexts) {
            String encrypted = AESUtils.encrypt(key, text);
            String decrypted = AESUtils.decrypt(key, encrypted);
            assertEquals(text, decrypted, "测试Text: " + text);
        }
    }

    @Test
    public void testCrossLanguageCompatibility() {
        // 这些IsPythonVersionGenerates EncryptResult，用于测试跨Language兼容性
        String key = "cheeko1234567890";
        String plainText = "Hello, 小智!";

        // PythonVersionGenerates EncryptResult（RequiredRunPython测试后Get）
        // String pythonEncrypted = "fromPython测试中Gets EncryptResult";
        // String decrypted = AESUtils.decrypt(key, pythonEncrypted);
        // assertEquals(plainText, decrypted, "Java应该能DecryptPythonEncrypts Result");

        // GenerateJavaEncryptResult供Python测试
        String javaEncrypted = AESUtils.encrypt(key, plainText);
        System.out.println("JavaEncryptResult供Python测试: " + javaEncrypted);
    }
}