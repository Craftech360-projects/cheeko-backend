package xiaozhi.common.utils;

import lombok.AllArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.core.io.ResourceLoader;
import org.springframework.core.io.Resource;
import org.springframework.stereotype.Component;
import xiaozhi.common.exception.RenException;


import java.io.BufferedReader;
import java.io.IOException;
import java.io.InputStreamReader;

/**
 * 资源处理工具
 */
@AllArgsConstructor
@Slf4j
@Component
public class ResourcesUtils {
    private ResourceLoader resourceLoader;

    /**
     * 读取资源，返回字符串
     * @param fileName 资源路径：resources下开始
     * @return 字符串
     */
    public String loadString(String fileName)  {
        Resource resource = resourceLoader.getResource("classpath:" + fileName);
        StringBuilder luaScriptBuilder = new StringBuilder();
        try (BufferedReader reader = new BufferedReader(
                new InputStreamReader(resource.getInputStream()))) {
            String line;
            while ((line = reader.readLine()) != null) {
                luaScriptBuilder.append(line).append("\n");
            }
        }  catch (IOException e){
            log.error("Method: loadString() failed to read resource--{}",e.getMessage());
            throw new RenException("Failed to read resource");
        }
        return luaScriptBuilder.toString();
    }
}
